// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package media

import (
	"strings"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

type Signal struct {
	Type         string                     `json:"type"`
	SDP          *webrtc.SessionDescription `json:"sdp,omitempty"`
	MemberID     string                     `json:"member_id,omitempty"`
	SoundID      string                     `json:"sound_id,omitempty"`
	SoundName    string                     `json:"sound_name,omitempty"`
	SoundEmoji   string                     `json:"sound_emoji,omitempty"`
	SoundURL     string                     `json:"sound_url,omitempty"`
	Candidate    *webrtc.ICECandidateInit   `json:"candidate,omitempty"`
	Participants []Participant              `json:"participants,omitempty"`
}

func (m *Manager) BroadcastParticipants(roomID string) {
	m.Broadcast(roomID, Signal{Type: "participants", Participants: m.Participants(roomID)})
}

type Peer struct {
	memberID   string
	roomID     string
	lease      uint64
	connection *webrtc.PeerConnection
	signal     func(Signal)
	negotiate  sync.Mutex
	pending    bool
	tracks     map[string]*webrtc.RTPSender
	screens    map[string]*webrtc.RTPSender
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
func (m *Manager) AcceptOffer(memberID, roomID string, offer webrtc.SessionDescription, signal func(Signal)) (webrtc.SessionDescription, string, uint64, error) {
	return m.acceptOffer(memberID, roomID, "", offer, signal)
}

func (m *Manager) ResumeOffer(memberID, roomID, resumeToken string, offer webrtc.SessionDescription, signal func(Signal)) (webrtc.SessionDescription, string, uint64, error) {
	return m.acceptOffer(memberID, roomID, resumeToken, offer, signal)
}

func (m *Manager) TakeoverOffer(memberID, roomID string, offer webrtc.SessionDescription, signal func(Signal)) (webrtc.SessionDescription, string, uint64, error) {
	return m.acceptOfferWithTakeover(memberID, roomID, offer, signal)
}

func (m *Manager) acceptOffer(memberID, roomID, resumeToken string, offer webrtc.SessionDescription, signal func(Signal)) (webrtc.SessionDescription, string, uint64, error) {
	var joined JoinResult
	var err error
	if resumeToken == "" {
		joined, err = m.Join(memberID, roomID)
	} else {
		joined, err = m.Resume(memberID, roomID, resumeToken)
	}
	if err != nil {
		return webrtc.SessionDescription{}, "", 0, err
	}
	return m.acceptJoinedOffer(memberID, roomID, joined, offer, signal)
}

func (m *Manager) acceptJoinedOffer(memberID, roomID string, joined JoinResult, offer webrtc.SessionDescription, signal func(Signal)) (webrtc.SessionDescription, string, uint64, error) {
	connection, err := m.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		_ = m.Leave(memberID, roomID)
		return webrtc.SessionDescription{}, "", 0, err
	}
	m.mu.Lock()
	m.nextPeerLease++
	lease := m.nextPeerLease
	peer := &Peer{memberID: memberID, roomID: roomID, lease: lease, connection: connection, signal: signal, tracks: map[string]*webrtc.RTPSender{}, screens: map[string]*webrtc.RTPSender{}}
	previousPeer := m.peers[memberID]
	for sourceTrackID, track := range m.tracks[roomID] {
		if !strings.HasPrefix(sourceTrackID, memberID+":") {
			if sender, addErr := connection.AddTrack(track); addErr == nil {
				peer.tracks[sourceTrackID] = sender
			}
		}
	}
	existingScreens := make(map[string]*webrtc.TrackLocalStaticRTP, len(m.screenTracks[roomID]))
	for ownerID, screen := range m.screenTracks[roomID] {
		if ownerID != memberID {
			existingScreens[ownerID] = screen
		}
	}
	m.peers[memberID] = peer
	m.mu.Unlock()
	if previousPeer != nil {
		_ = previousPeer.connection.Close()
	}
	connection.OnTrack(func(remote *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		if remote.Kind() == webrtc.RTPCodecTypeVideo {
			m.forwardScreen(peer, remote)
			return
		}
		if remote.Kind() != webrtc.RTPCodecTypeAudio {
			return
		}
		trackKey := memberID + ":" + remote.ID()
		m.mu.Lock()
		local := m.tracks[peer.roomID][trackKey]
		continuityKey := peer.roomID + ":" + trackKey
		continuity := m.continuity[continuityKey]
		if continuity == nil {
			continuity = &rtpContinuity{}
			m.continuity[continuityKey] = continuity
		}
		m.mu.Unlock()
		if local == nil {
			var trackErr error
			local, trackErr = webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, remote.ID(), "member-"+memberID)
			if trackErr != nil {
				return
			}
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
			continuity.rewrite(packet)
			// A subscriber binding can disappear while its Media Session is being
			// replaced. Never terminate the publisher reader because one binding
			// failed; remaining and future subscribers must keep receiving RTP.
			_ = local.WriteRTP(packet)
		}
	})
	connection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		switch state {
		case webrtc.PeerConnectionStateConnected:
			m.markConnected(memberID, lease)
		case webrtc.PeerConnectionStateDisconnected:
			m.disconnectPeer(memberID, lease)
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			m.disconnectPeer(memberID, lease)
		}
	})
	connection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate != nil {
			value := candidate.ToJSON()
			signal(Signal{Type: "candidate", Candidate: &value})
		}
	})
	if err := connection.SetRemoteDescription(offer); err != nil {
		m.removePeerLease(memberID, lease)
		return webrtc.SessionDescription{}, "", 0, err
	}
	answer, err := connection.CreateAnswer(nil)
	if err != nil {
		m.removePeerLease(memberID, lease)
		return webrtc.SessionDescription{}, "", 0, err
	}
	gathered := webrtc.GatheringCompletePromise(connection)
	if err := connection.SetLocalDescription(answer); err != nil {
		m.removePeerLease(memberID, lease)
		return webrtc.SessionDescription{}, "", 0, err
	}
	<-gathered
	// The client's initial offer may contain no video media section. Adding an
	// existing screen before answering rejects that transceiver permanently in
	// some WebRTC implementations. Attach screens only after the initial
	// exchange is stable; Renegotiate then introduces them with a server offer.
	m.mu.Lock()
	for ownerID, screen := range existingScreens {
		if m.screenTracks[roomID][ownerID] == screen {
			if sender, addErr := connection.AddTrack(screen); addErr == nil {
				peer.screens[ownerID] = sender
			}
		}
	}
	m.mu.Unlock()
	return *connection.LocalDescription(), joined.ResumeToken, lease, nil
}

func (m *Manager) acceptOfferWithTakeover(memberID, roomID string, offer webrtc.SessionDescription, signal func(Signal)) (webrtc.SessionDescription, string, uint64, error) {
	joined, err := m.Takeover(memberID, roomID)
	if err != nil {
		return webrtc.SessionDescription{}, "", 0, err
	}
	return m.acceptJoinedOffer(memberID, roomID, joined, offer, signal)
}

// AddICECandidate applies a trickled browser candidate to an active peer.
func (m *Manager) AddICECandidate(memberID string, candidate webrtc.ICECandidateInit) error {
	m.mu.Lock()
	peer := m.peers[memberID]
	m.mu.Unlock()
	if peer == nil {
		return ErrNotPresent
	}
	return peer.connection.AddICECandidate(candidate)
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
	peer.negotiate.Lock()
	err := peer.connection.SetRemoteDescription(answer)
	pending := peer.pending
	peer.pending = false
	peer.negotiate.Unlock()
	if err == nil && pending {
		go peer.sendOffer()
	}
	return err
}

// Renegotiate offers every server-published track after the initial answer has
// been delivered. An answer cannot introduce extra media sections that were
// absent from the client's offer, so late joiners need this follow-up offer.
func (m *Manager) Renegotiate(memberID string) {
	m.mu.Lock()
	peer := m.peers[memberID]
	m.mu.Unlock()
	if peer != nil {
		go peer.sendOffer()
	}
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
	owners := make([]string, 0, len(m.screenLayers[roomID]))
	seen := map[string]bool{}
	for ownerID := range m.screenLayers[roomID] {
		if ownerID != memberID {
			owners = append(owners, ownerID)
			seen[ownerID] = true
		}
	}
	for ownerID := range m.screenTracks[roomID] {
		if ownerID != memberID && !seen[ownerID] {
			owners = append(owners, ownerID)
		}
	}
	m.mu.Unlock()
	quality := "low"
	if visible {
		quality = "high"
	}
	for _, ownerID := range owners {
		_ = m.SetScreenQuality(memberID, ownerID, quality)
	}
	return nil
}

// SetScreenQuality selects a simulcast layer for one viewer without reducing
// quality for other viewers in the same room.
func (m *Manager) SetScreenQuality(viewerID, ownerID, quality string) error {
	if quality != "low" && quality != "medium" && quality != "high" {
		return ErrNotPresent
	}
	m.mu.Lock()
	viewer, owner := m.byMember[viewerID], m.byMember[ownerID]
	if viewer == nil || owner == nil || viewer.participant.RoomID != owner.participant.RoomID || viewerID == ownerID {
		m.mu.Unlock()
		return ErrNotPresent
	}
	roomID := viewer.participant.RoomID
	if m.screenSubscriptions[roomID] == nil {
		m.screenSubscriptions[roomID] = map[string]map[string]string{}
	}
	if m.screenSubscriptions[roomID][viewerID] == nil {
		m.screenSubscriptions[roomID][viewerID] = map[string]string{}
	}
	m.screenSubscriptions[roomID][viewerID][ownerID] = quality
	peer := m.peers[viewerID]
	track := m.screenLayerLocked(roomID, ownerID, quality)
	var negotiate bool
	if peer != nil && track != nil {
		if sender := peer.screens[ownerID]; sender != nil {
			_ = sender.ReplaceTrack(track)
		} else if added, err := peer.connection.AddTrack(track); err == nil {
			peer.screens[ownerID] = added
			negotiate = true
		}
	}
	ownerPeer := m.peers[ownerID]
	maximum := m.maximumScreenQualityLocked(roomID, ownerID)
	m.mu.Unlock()
	if negotiate {
		go peer.sendOffer()
	}
	if ownerPeer != nil {
		ownerPeer.signal(Signal{Type: "screen-" + maximum})
	}
	return nil
}

func (m *Manager) screenLayerLocked(roomID, ownerID, quality string) *webrtc.TrackLocalStaticRTP {
	layers := m.screenLayers[roomID][ownerID]
	order := map[string][]string{"low": {"q", "h", "f", ""}, "medium": {"h", "q", "f", ""}, "high": {"f", "h", "q", ""}}
	for _, rid := range order[quality] {
		if layers[rid] != nil {
			return layers[rid]
		}
	}
	return m.screenTracks[roomID][ownerID]
}

func (m *Manager) maximumScreenQualityLocked(roomID, ownerID string) string {
	maximum, rank := "low", map[string]int{"low": 0, "medium": 1, "high": 2}
	for viewerID := range m.rooms[roomID] {
		if viewerID == ownerID {
			continue
		}
		quality := m.screenSubscriptions[roomID][viewerID][ownerID]
		if quality == "" {
			if m.screenVisible[roomID][viewerID] {
				quality = "high"
			} else {
				quality = "low"
			}
		}
		if rank[quality] > rank[maximum] {
			maximum = quality
		}
	}
	return maximum
}

// SetScreenPublishing explicitly gates a Member's forwarded video without
// destroying its negotiated transceiver. Browsers may emit padding or frozen
// frames after replaceTrack(nil); recipients must not treat those as media.
func (m *Manager) SetScreenPublishing(memberID string, publishing bool) error {
	m.mu.Lock()
	item := m.byMember[memberID]
	if item == nil {
		m.mu.Unlock()
		return ErrNotPresent
	}
	roomID := item.participant.RoomID
	item.participant.ScreenSharing = publishing
	if len(m.screenLayers[roomID][memberID]) == 0 && m.screenTracks[roomID][memberID] == nil {
		m.mu.Unlock()
		return nil
	}
	peers := make([]*Peer, 0, len(m.rooms[roomID]))
	for otherID := range m.rooms[roomID] {
		peer := m.peers[otherID]
		if peer == nil || otherID == memberID {
			continue
		}
		sender := peer.screens[memberID]
		track := m.screenLayerLocked(roomID, memberID, m.viewerScreenQualityLocked(roomID, otherID, memberID))
		if sender != nil {
			if publishing && track != nil {
				_ = sender.ReplaceTrack(track)
			} else {
				_ = sender.ReplaceTrack(nil)
			}
			continue
		}
		if publishing && track != nil {
			if added, addErr := peer.connection.AddTrack(track); addErr == nil {
				peer.screens[memberID] = added
				peers = append(peers, peer)
			}
		}
	}
	m.mu.Unlock()
	for _, peer := range peers {
		go peer.sendOffer()
	}
	return nil
}

func (m *Manager) viewerScreenQualityLocked(roomID, viewerID, ownerID string) string {
	if quality := m.screenSubscriptions[roomID][viewerID][ownerID]; quality != "" {
		return quality
	}
	if m.screenVisible[roomID][viewerID] {
		return "high"
	}
	return "low"
}

func (m *Manager) RemovePeer(memberID string) {
	m.detachPeer(memberID, 0, true, true)
}

// RemovePeerLease removes a Media Session only when the explicit leave came
// from its current signaling lease.
func (m *Manager) RemovePeerLease(memberID string, lease uint64) {
	m.removePeerLease(memberID, lease)
}

// DisconnectPeer disconnects only the peer created by the matching signaling
// lease. Cleanup from a stale WebSocket must never detach its replacement.
func (m *Manager) DisconnectPeer(memberID string, lease uint64) {
	m.detachPeer(memberID, lease, false, false)
}

func (m *Manager) disconnectPeer(memberID string, lease uint64) {
	m.DisconnectPeer(memberID, lease)
}

func (m *Manager) removePeerLease(memberID string, lease uint64) {
	m.detachPeer(memberID, lease, true, false)
}

func (m *Manager) detachPeer(memberID string, lease uint64, removeSession, force bool) {
	m.mu.Lock()
	peer := m.peers[memberID]
	if peer == nil || (!force && peer.lease != lease) {
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
	delete(m.screenTracks[peer.roomID], memberID)
	delete(m.screenLayers[peer.roomID], memberID)
	roomID := peer.roomID
	m.mu.Unlock()
	_ = peer.connection.Close()
	m.BroadcastParticipants(roomID)
}

func (m *Manager) forwardScreen(source *Peer, remote *webrtc.TrackRemote) {
	// Visibility can arrive before the browser publishes its first simulcast
	// layer. Reassert the desired layer as soon as any layer appears so a
	// browser previously left on screen-low enables the full layer we forward.
	source.signal(Signal{Type: m.screenQuality(source.roomID, source.memberID)})
	rid := remote.RID()
	m.mu.Lock()
	local, err := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, "screen-"+source.memberID+"-"+rid, "screen-"+source.memberID)
	if err != nil {
		m.mu.Unlock()
		return
	}
	if m.screenLayers[source.roomID] == nil {
		m.screenLayers[source.roomID] = map[string]map[string]*webrtc.TrackLocalStaticRTP{}
	}
	if m.screenLayers[source.roomID][source.memberID] == nil {
		m.screenLayers[source.roomID][source.memberID] = map[string]*webrtc.TrackLocalStaticRTP{}
	}
	m.screenLayers[source.roomID][source.memberID][rid] = local
	if m.screenTracks[source.roomID] == nil {
		m.screenTracks[source.roomID] = map[string]*webrtc.TrackLocalStaticRTP{}
	}
	if rid == "f" || rid == "" {
		m.screenTracks[source.roomID][source.memberID] = local
	}
	if item := m.byMember[source.memberID]; item != nil {
		item.participant.ScreenSharing = true
	}
	peers := make([]*Peer, 0, len(m.rooms[source.roomID]))
	for memberID := range m.rooms[source.roomID] {
		if peer := m.peers[memberID]; peer != nil && memberID != source.memberID {
			selected := m.screenLayerLocked(source.roomID, source.memberID, m.viewerScreenQualityLocked(source.roomID, memberID, source.memberID))
			if sender := peer.screens[source.memberID]; sender != nil {
				_ = sender.ReplaceTrack(selected)
			} else if selected != nil {
				if added, addErr := peer.connection.AddTrack(selected); addErr == nil {
					peer.screens[source.memberID] = added
					peers = append(peers, peer)
				}
			}
		}
	}
	m.mu.Unlock()
	for _, peer := range peers {
		go peer.sendOffer()
	}
	// Video sources need periodic picture-loss feedback. Without it, a viewer
	// that misses the first keyframe remains black and packet loss leaves every
	// viewer frozen indefinitely because this SFU terminates the original RTCP
	// feedback path when it republishes the RTP track.
	requestKeyframe := func() {
		_ = source.connection.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(remote.SSRC())}})
	}
	done := make(chan struct{})
	go func() {
		requestKeyframe()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				requestKeyframe()
			case <-done:
				return
			}
		}
	}()
	defer close(done)
	defer func() {
		m.mu.Lock()
		if m.screenLayers[source.roomID][source.memberID][rid] == local {
			delete(m.screenLayers[source.roomID][source.memberID], rid)
		}
		if m.screenTracks[source.roomID][source.memberID] == local {
			delete(m.screenTracks[source.roomID], source.memberID)
		}
		noLayers := len(m.screenLayers[source.roomID][source.memberID]) == 0
		if noLayers {
			if item := m.byMember[source.memberID]; item != nil {
				item.participant.ScreenSharing = false
			}
		}
		for memberID := range m.rooms[source.roomID] {
			if peer := m.peers[memberID]; peer != nil && memberID != source.memberID {
				if sender := peer.screens[source.memberID]; sender != nil && sender.Track() == local {
					replacement := m.screenLayerLocked(source.roomID, source.memberID, m.viewerScreenQualityLocked(source.roomID, memberID, source.memberID))
					if replacement == nil {
						_ = sender.ReplaceTrack(nil)
					} else {
						_ = sender.ReplaceTrack(replacement)
					}
				}
			}
		}
		m.mu.Unlock()
	}()
	for {
		packet, _, readErr := remote.ReadRTP()
		if readErr != nil {
			return
		}
		_ = local.WriteRTP(packet)
	}
}

func (m *Manager) screenQuality(roomID, ownerID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return "screen-" + m.maximumScreenQualityLocked(roomID, ownerID)
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
			if sender := peer.tracks[sourceTrackID]; sender != nil {
				_ = sender.ReplaceTrack(track)
			} else if added, addErr := peer.connection.AddTrack(track); addErr == nil {
				peer.tracks[sourceTrackID] = added
				peers = append(peers, peer)
			}
		}
	}
	m.mu.Unlock()
	for _, peer := range peers {
		go peer.sendOffer()
	}
}

func (m *Manager) unpublishTrack(source *Peer, track *webrtc.TrackLocalStaticRTP) {
	m.mu.Lock()
	// A replacement Media Session may already be writing into the same stable
	// publication. Cleanup from the superseded peer must not detach it.
	if m.peers[source.memberID] != source {
		m.mu.Unlock()
		return
	}
	trackKey := source.memberID + ":" + track.ID()
	if m.tracks[source.roomID][trackKey] != track {
		m.mu.Unlock()
		return
	}
	delete(m.tracks[source.roomID], trackKey)
	for memberID := range m.rooms[source.roomID] {
		if peer := m.peers[memberID]; peer != nil && memberID != source.memberID {
			if sender := peer.tracks[trackKey]; sender != nil && sender.Track() == track {
				_ = sender.ReplaceTrack(nil)
			}
		}
	}
	m.mu.Unlock()
}

func (p *Peer) sendOffer() {
	p.negotiate.Lock()
	defer p.negotiate.Unlock()
	if p.connection.SignalingState() != webrtc.SignalingStateStable {
		p.pending = true
		return
	}
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
