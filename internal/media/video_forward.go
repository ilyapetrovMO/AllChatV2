package media

import (
	"strings"
	"sync"

	"github.com/pion/rtp"
	"github.com/pion/rtp/codecs"
	"github.com/pion/webrtc/v4"
)

// A viewer keeps one outgoing RTP identity while the selected source changes.
// Selection waits for a VP8 keyframe; packets from the former layer cannot
// enter the new sequence space. Other codecs remain on their single source.
type videoSubscription struct {
	mu                            sync.Mutex
	output                        *webrtc.TrackLocalStaticRTP
	selected                      *webrtc.TrackLocalStaticRTP
	current                       *webrtc.TrackLocalStaticRTP
	initialized                   bool
	inputSequence, outputSequence uint16
	inputTime, outputTime         uint32
	pictureOffset, lastPicture    uint16
	pictureInitialized            bool
}

func (s *videoSubscription) selectTrack(track *webrtc.TrackLocalStaticRTP) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.selected != track {
		s.selected = track
		s.current = nil
	}
}

func (s *videoSubscription) write(source *webrtc.TrackLocalStaticRTP, input *rtp.Packet) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if source != s.selected || len(input.Payload) == 0 {
		return
	}
	switching := s.current != source
	vp8 := strings.EqualFold(source.Codec().MimeType, webrtc.MimeTypeVP8)
	var descriptor codecs.VP8Packet
	if vp8 {
		payload, err := descriptor.Unmarshal(input.Payload)
		if err != nil {
			return
		}
		if switching && (descriptor.S != 1 || descriptor.PID != 0 || len(payload) == 0 || payload[0]&1 != 0) {
			return
		}
	}
	packet := input.Clone()
	// Extension IDs, MID, RID and transport sequence numbers belong to the
	// publisher's transport. Subscriber interceptors own outgoing extensions.
	packet.Extension, packet.ExtensionProfile, packet.Extensions = false, 0, nil
	if !s.initialized {
		s.initialized = true
		s.outputSequence = packet.SequenceNumber
		s.outputTime = packet.Timestamp
	} else if switching {
		s.outputSequence++
		s.outputTime += 3000
	} else {
		s.outputSequence += packet.SequenceNumber - s.inputSequence
		s.outputTime += packet.Timestamp - s.inputTime
	}
	s.inputSequence, s.inputTime = packet.SequenceNumber, packet.Timestamp
	packet.SequenceNumber, packet.Timestamp = s.outputSequence, s.outputTime
	// A receiver's VP8 reference frame identifiers must also remain continuous.
	if vp8 && descriptor.I == 1 {
		if switching && s.pictureInitialized {
			s.pictureOffset = s.lastPicture + 1 - descriptor.PictureID
		}
		picture := (descriptor.PictureID + s.pictureOffset) & 0x7fff
		s.lastPicture = picture
		s.pictureInitialized = true
		if len(packet.Payload) >= 3 && packet.Payload[2]&0x80 != 0 && len(packet.Payload) >= 4 {
			packet.Payload[2], packet.Payload[3] = 0x80|byte(picture>>8), byte(picture)
		} else if len(packet.Payload) >= 3 {
			packet.Payload[2] = byte(picture & 0x7f)
		}
	}
	s.current = source
	_ = s.output.WriteRTP(packet)
}

// Caller holds Manager.mu. Returns true only when SDP topology changed.
func (m *Manager) routeScreenLocked(peer *Peer, owner string, track *webrtc.TrackLocalStaticRTP) bool {
	if peer.video == nil {
		peer.video = map[string]*videoSubscription{}
	}
	sub := peer.video[owner]
	if sub == nil {
		if track == nil {
			return false
		}
		output, err := webrtc.NewTrackLocalStaticRTP(track.Codec(), "screen-"+owner, "screen-"+owner)
		if err != nil {
			return false
		}
		sub = &videoSubscription{output: output}
		peer.video[owner] = sub
	}
	sub.selectTrack(track)
	if track == nil {
		if sender := peer.screens[owner]; sender != nil {
			_ = sender.ReplaceTrack(nil)
		}
		return false
	}
	if request := m.screenRequests[track]; request != nil {
		go request()
	}
	if sender := peer.screens[owner]; sender != nil {
		_ = sender.ReplaceTrack(sub.output)
		return false
	}
	sender, err := addForwardTrack(peer.connection, sub.output, func() {
		m.mu.Lock()
		sub.mu.Lock()
		selected := sub.selected
		sub.mu.Unlock()
		request := m.screenRequests[selected]
		m.mu.Unlock()
		if request != nil {
			request()
		}
	})
	if err != nil {
		return false
	}
	peer.screens[owner] = sender
	return true
}

func (m *Manager) SetPublisherQuality(memberID, quality string, lease uint64) error {
	if quality != "low" && quality != "medium" && quality != "high" {
		return ErrNotPresent
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	source := m.peerForLeaseLocked(memberID, []uint64{lease})
	if source == nil {
		return ErrSuperseded
	}
	source.maximumLayer = quality
	if item := m.byMember[memberID]; item == nil || !item.participant.ScreenSharing {
		return nil
	}
	for viewerID := range m.rooms[source.roomID] {
		if viewer := m.peers[viewerID]; viewer != nil && viewerID != memberID {
			track := m.screenLayerLocked(source.roomID, memberID, m.viewerScreenQualityLocked(source.roomID, viewerID, memberID))
			if m.routeScreenLocked(viewer, memberID, track) {
				go viewer.sendOffer()
			}
		}
	}
	return nil
}
