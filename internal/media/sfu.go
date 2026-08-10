// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package media

import (
	"errors"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

type Signal struct {
	Type       string                     `json:"type"`
	SDP        *webrtc.SessionDescription `json:"sdp,omitempty"`
	MemberID   string                     `json:"member_id,omitempty"`
	SoundID    string                     `json:"sound_id,omitempty"`
	SoundName  string                     `json:"sound_name,omitempty"`
	SoundEmoji string                     `json:"sound_emoji,omitempty"`
	SoundURL   string                     `json:"sound_url,omitempty"`
}

type Peer struct {
	memberID   string
	roomID     string
	connection *webrtc.PeerConnection
	signal     func(Signal)
	negotiate  sync.Mutex
}

// Broadcast sends an authoritative room event to each currently connected peer.
func (m *Manager) Broadcast(roomID string, signal Signal) {
	m.mu.Lock()
	callbacks := make([]func(Signal), 0, len(m.rooms[roomID]))
	for memberID := range m.rooms[roomID] {
		if peer := m.peers[memberID]; peer != nil && peer.signal != nil {
			callbacks = append(callbacks, peer.signal)
		}
	}
	m.mu.Unlock()
	for _, send := range callbacks {
		send(signal)
	}
}

// AcceptOffer creates one SFU PeerConnection and returns a fully gathered
// answer. Further participants are delivered through server-initiated offers.
func (m *Manager) AcceptOffer(memberID, roomID string, offer webrtc.SessionDescription, signal func(Signal)) (webrtc.SessionDescription, string, error) {
	return m.acceptOffer(memberID, roomID, "", offer, signal)
}

func (m *Manager) ResumeOffer(memberID, roomID, resumeToken string, offer webrtc.SessionDescription, signal func(Signal)) (webrtc.SessionDescription, string, error) {
	return m.acceptOffer(memberID, roomID, resumeToken, offer, signal)
}

func (m *Manager) acceptOffer(memberID, roomID, resumeToken string, offer webrtc.SessionDescription, signal func(Signal)) (webrtc.SessionDescription, string, error) {
	var joined JoinResult
	var err error
	if resumeToken == "" {
		joined, err = m.Join(memberID, roomID)
	} else {
		joined, err = m.Resume(memberID, roomID, resumeToken)
	}
	if err != nil {
		return webrtc.SessionDescription{}, "", err
	}
	connection, err := m.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		_ = m.Leave(memberID, roomID)
		return webrtc.SessionDescription{}, "", err
	}
	peer := &Peer{memberID: memberID, roomID: roomID, connection: connection, signal: signal}
	m.mu.Lock()
	for sourceTrackID, track := range m.tracks[roomID] {
		if !strings.HasPrefix(sourceTrackID, memberID+":") {
			_, _ = connection.AddTrack(track)
		}
	}
	if screen := m.screenTracks[roomID]; screen != nil {
		_, _ = connection.AddTrack(screen)
	}
	m.peers[memberID] = peer
	m.mu.Unlock()
	connection.OnTrack(func(remote *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		if remote.Kind() == webrtc.RTPCodecTypeVideo {
			m.forwardScreen(peer, remote)
			return
		}
		if remote.Kind() != webrtc.RTPCodecTypeAudio {
			return
		}
		local, trackErr := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, "audio-"+memberID, "member-"+memberID)
		if trackErr != nil {
			return
		}
		m.publishTrack(peer, local)
		defer m.unpublishTrack(peer, local)
		var audioLevelID uint8
		for _, extension := range receiver.GetParameters().HeaderExtensions {
			if extension.URI == sdp.AudioLevelURI {
				audioLevelID = uint8(extension.ID)
				break
			}
		}
		for {
			packet, _, readErr := remote.ReadRTP()
			if readErr != nil {
				return
			}
			if m.IsServerMuted(memberID) {
				continue
			}
			if audioLevelID != 0 {
				if level := packet.Header.GetExtension(audioLevelID); len(level) > 0 && audioLevelIndicatesSpeech(level[0]) {
					m.MarkSpeaking(memberID)
				}
			}
			if writeErr := local.WriteRTP(packet); writeErr != nil && !errors.Is(writeErr, io.ErrClosedPipe) {
				return
			}
		}
	})
	connection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		switch state {
		case webrtc.PeerConnectionStateConnected:
			m.markConnected(memberID)
		case webrtc.PeerConnectionStateDisconnected:
			m.DisconnectPeer(memberID)
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			m.DisconnectPeer(memberID)
		}
	})
	if err := connection.SetRemoteDescription(offer); err != nil {
		m.RemovePeer(memberID)
		return webrtc.SessionDescription{}, "", err
	}
	answer, err := connection.CreateAnswer(nil)
	if err != nil {
		m.RemovePeer(memberID)
		return webrtc.SessionDescription{}, "", err
	}
	gathered := webrtc.GatheringCompletePromise(connection)
	if err := connection.SetLocalDescription(answer); err != nil {
		m.RemovePeer(memberID)
		return webrtc.SessionDescription{}, "", err
	}
	<-gathered
	return *connection.LocalDescription(), joined.ResumeToken, nil
}

func audioLevelIndicatesSpeech(value byte) bool {
	// RFC 6464 levels are negative dBov: smaller values are louder. Some
	// browsers keep the optional VAD bit asserted for background input, so it
	// must not independently activate the UI speaking indicator.
	return value&0x7f < 35
}

func (m *Manager) HandleAnswer(memberID string, answer webrtc.SessionDescription) error {
	m.mu.Lock()
	peer := m.peers[memberID]
	m.mu.Unlock()
	if peer == nil {
		return ErrNotPresent
	}
	return peer.connection.SetRemoteDescription(answer)
}

func (m *Manager) HandleOffer(memberID string, offer webrtc.SessionDescription) (webrtc.SessionDescription, error) {
	m.mu.Lock()
	peer := m.peers[memberID]
	m.mu.Unlock()
	if peer == nil {
		return webrtc.SessionDescription{}, ErrNotPresent
	}
	peer.negotiate.Lock()
	defer peer.negotiate.Unlock()
	if err := peer.connection.SetRemoteDescription(offer); err != nil {
		return webrtc.SessionDescription{}, err
	}
	answer, err := peer.connection.CreateAnswer(nil)
	if err != nil {
		return webrtc.SessionDescription{}, err
	}
	gathered := webrtc.GatheringCompletePromise(peer.connection)
	if err = peer.connection.SetLocalDescription(answer); err != nil {
		return webrtc.SessionDescription{}, err
	}
	<-gathered
	return *peer.connection.LocalDescription(), nil
}

func (m *Manager) SetScreenVisible(memberID string, visible bool) error {
	m.mu.Lock()
	item := m.byMember[memberID]
	if item == nil {
		m.mu.Unlock()
		return ErrNotPresent
	}
	roomID := item.participant.RoomID
	if m.screenVisible[roomID] == nil {
		m.screenVisible[roomID] = map[string]bool{}
	}
	m.screenVisible[roomID][memberID] = visible
	ownerID := m.screenOwner[roomID]
	owner := m.peers[ownerID]
	anyVisible := false
	for otherID, isVisible := range m.screenVisible[roomID] {
		if otherID != ownerID && isVisible {
			anyVisible = true
			break
		}
	}
	m.mu.Unlock()
	if owner != nil {
		quality := "screen-low"
		if anyVisible {
			quality = "screen-high"
		}
		owner.signal(Signal{Type: quality})
	}
	return nil
}

func (m *Manager) RemovePeer(memberID string) {
	m.detachPeer(memberID, true)
}

func (m *Manager) DisconnectPeer(memberID string) {
	m.detachPeer(memberID, false)
}

func (m *Manager) detachPeer(memberID string, removeSession bool) {
	m.mu.Lock()
	peer := m.peers[memberID]
	if peer == nil {
		m.mu.Unlock()
		return
	}
	delete(m.peers, memberID)
	item := m.byMember[memberID]
	if item != nil && removeSession {
		m.removeLocked(item)
	} else if item != nil {
		item.participant.Connected = false
		item.rejoinUntil = m.now().Add(m.rejoinWindow)
		item.participant.RejoinBefore = item.rejoinUntil.UTC().Format(time.RFC3339Nano)
	}
	for sourceTrackID := range m.tracks[peer.roomID] {
		if strings.HasPrefix(sourceTrackID, memberID+":") {
			delete(m.tracks[peer.roomID], sourceTrackID)
		}
	}
	if m.screenOwner[peer.roomID] == memberID {
		delete(m.screenOwner, peer.roomID)
		delete(m.screenTracks, peer.roomID)
	}
	m.mu.Unlock()
	_ = peer.connection.Close()
}

func (m *Manager) forwardScreen(source *Peer, remote *webrtc.TrackRemote) {
	// The browser orders screen simulcast layers low-to-high as q/h/f. The MVP
	// SFU forwards the full layer and drains lower layers; receivers can still
	// use congestion control while avoiding duplicate rendered tracks.
	if rid := remote.RID(); rid != "" && rid != "f" {
		for {
			if _, _, err := remote.ReadRTP(); err != nil {
				return
			}
		}
	}
	m.mu.Lock()
	if owner := m.screenOwner[source.roomID]; owner != "" && owner != source.memberID {
		m.mu.Unlock()
		source.signal(Signal{Type: "screen-rejected"})
		return
	}
	m.screenOwner[source.roomID] = source.memberID
	local, err := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, "screen-"+source.memberID, "screen-"+source.memberID)
	if err != nil {
		m.mu.Unlock()
		return
	}
	m.screenTracks[source.roomID] = local
	peers := make([]*Peer, 0, len(m.rooms[source.roomID]))
	for memberID := range m.rooms[source.roomID] {
		if peer := m.peers[memberID]; peer != nil && memberID != source.memberID {
			_, _ = peer.connection.AddTrack(local)
			peers = append(peers, peer)
		}
	}
	m.mu.Unlock()
	for _, peer := range peers {
		go peer.sendOffer()
	}
	defer func() {
		m.mu.Lock()
		if m.screenOwner[source.roomID] == source.memberID {
			delete(m.screenOwner, source.roomID)
			delete(m.screenTracks, source.roomID)
		}
		targets := append([]*Peer(nil), peers...)
		m.mu.Unlock()
		for _, peer := range targets {
			for _, sender := range peer.connection.GetSenders() {
				if sender.Track() == local {
					_ = peer.connection.RemoveTrack(sender)
				}
			}
			go peer.sendOffer()
		}
	}()
	for {
		packet, _, readErr := remote.ReadRTP()
		if readErr != nil {
			return
		}
		if writeErr := local.WriteRTP(packet); writeErr != nil && !errors.Is(writeErr, io.ErrClosedPipe) {
			return
		}
	}
}

func (m *Manager) publishTrack(source *Peer, track *webrtc.TrackLocalStaticRTP) {
	m.mu.Lock()
	if m.tracks[source.roomID] == nil {
		m.tracks[source.roomID] = map[string]*webrtc.TrackLocalStaticRTP{}
	}
	sourceTrackID := source.memberID + ":" + track.ID()
	m.tracks[source.roomID][sourceTrackID] = track
	peers := make([]*Peer, 0, len(m.rooms[source.roomID]))
	for memberID := range m.rooms[source.roomID] {
		if peer := m.peers[memberID]; peer != nil && memberID != source.memberID {
			_, _ = peer.connection.AddTrack(track)
			peers = append(peers, peer)
		}
	}
	m.mu.Unlock()
	for _, peer := range peers {
		go peer.sendOffer()
	}
}

func (m *Manager) unpublishTrack(source *Peer, track *webrtc.TrackLocalStaticRTP) {
	m.mu.Lock()
	delete(m.tracks[source.roomID], source.memberID+":"+track.ID())
	peers := make([]*Peer, 0, len(m.rooms[source.roomID]))
	for memberID := range m.rooms[source.roomID] {
		if peer := m.peers[memberID]; peer != nil && memberID != source.memberID {
			for _, sender := range peer.connection.GetSenders() {
				if sender.Track() == track {
					_ = peer.connection.RemoveTrack(sender)
				}
			}
			peers = append(peers, peer)
		}
	}
	m.mu.Unlock()
	for _, peer := range peers {
		go peer.sendOffer()
	}
}

func (p *Peer) sendOffer() {
	p.negotiate.Lock()
	defer p.negotiate.Unlock()
	offer, err := p.connection.CreateOffer(nil)
	if err != nil {
		return
	}
	gathered := webrtc.GatheringCompletePromise(p.connection)
	if p.connection.SetLocalDescription(offer) != nil {
		return
	}
	<-gathered
	local := *p.connection.LocalDescription()
	p.signal(Signal{Type: "offer", SDP: &local})
}
