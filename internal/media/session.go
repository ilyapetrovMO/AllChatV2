// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package media

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtp"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

var (
	ErrAlreadyActive = errors.New("Member already has an active Media Session")
	ErrInvalidResume = errors.New("Media Session cannot be resumed")
	ErrNotPresent    = errors.New("Member is not in this Media Session")
	ErrModerated     = errors.New("Member was removed from this Media Session")
	ErrRoomFull      = errors.New("Media Session participant limit reached")
)

type Participant struct {
	MemberID      string `json:"member_id"`
	RoomID        string `json:"room_id"`
	Connected     bool   `json:"connected"`
	JoinedAt      string `json:"joined_at"`
	RejoinBefore  string `json:"rejoin_before,omitempty"`
	ServerMuted   bool   `json:"server_muted"`
	Speaking      bool   `json:"speaking"`
	Muted         bool   `json:"muted"`
	ScreenSharing bool   `json:"screen_sharing"`
}

type JoinResult struct {
	Participant Participant `json:"participant"`
	ResumeToken string      `json:"resume_token"`
}

type session struct {
	participant Participant
	resumeToken string
	rejoinUntil time.Time
	joinOrder   uint64
}

type rtpContinuity struct {
	mu             sync.Mutex
	initialized    bool
	inputSSRC      uint32
	inputSequence  uint16
	inputTime      uint32
	outputSequence uint16
	outputTime     uint32
}

func (c *rtpContinuity) rewrite(packet *rtp.Packet) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.initialized {
		c.initialized = true
		c.inputSSRC, c.inputSequence, c.inputTime = packet.SSRC, packet.SequenceNumber, packet.Timestamp
		c.outputSequence, c.outputTime = packet.SequenceNumber, packet.Timestamp
	} else if packet.SSRC != c.inputSSRC {
		c.inputSSRC, c.inputSequence, c.inputTime = packet.SSRC, packet.SequenceNumber, packet.Timestamp
		c.outputSequence++
		c.outputTime += 960
	} else {
		c.outputSequence += packet.SequenceNumber - c.inputSequence
		c.outputTime += packet.Timestamp - c.inputTime
		c.inputSequence, c.inputTime = packet.SequenceNumber, packet.Timestamp
	}
	packet.SequenceNumber, packet.Timestamp = c.outputSequence, c.outputTime
}

// Manager is the process-local authority for all Voice Rooms and Direct Calls.
// Restart intentionally clears it so clients never display stale participation.
type Manager struct {
	mu                  sync.Mutex
	api                 *webrtc.API
	rejoinWindow        time.Duration
	maxParticipants     int
	now                 func() time.Time
	byMember            map[string]*session
	rooms               map[string]map[string]*session
	peers               map[string]*Peer
	tracks              map[string]map[string]*webrtc.TrackLocalStaticRTP
	continuity          map[string]*rtpContinuity
	screenTracks        map[string]map[string]*webrtc.TrackLocalStaticRTP
	screenLayers        map[string]map[string]map[string]*webrtc.TrackLocalStaticRTP
	screenVisible       map[string]map[string]bool
	screenSubscriptions map[string]map[string]map[string]string
	calls               map[string]*DirectCall
	removedUntil        map[string]time.Time
	speakingTimers      map[string]*time.Timer
	lastSpoke           map[string]time.Time
	nextJoinOrder       uint64
	nextPeerLease       uint64
}

func NewManager(rejoinWindow time.Duration) *Manager {
	manager, err := NewManagerWithLimits(rejoinWindow, 50000, 50100, 25)
	if err != nil {
		panic(err)
	}
	return manager
}

func NewManagerWithLimits(rejoinWindow time.Duration, portMin, portMax uint16, maxParticipants int) (*Manager, error) {
	if rejoinWindow <= 0 {
		rejoinWindow = 15 * time.Second
	}
	engine := &webrtc.MediaEngine{}
	_ = engine.RegisterDefaultCodecs()
	_ = engine.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: sdp.AudioLevelURI}, webrtc.RTPCodecTypeAudio)
	for _, kind := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeAudio, webrtc.RTPCodecTypeVideo} {
		_ = engine.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: sdp.SDESMidURI}, kind)
	}
	_ = engine.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: sdp.SDESRTPStreamIDURI}, webrtc.RTPCodecTypeVideo)
	_ = engine.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: sdp.SDESRepairRTPStreamIDURI}, webrtc.RTPCodecTypeVideo)
	registry := &interceptor.Registry{}
	_ = webrtc.RegisterDefaultInterceptors(engine, registry)
	settings := webrtc.SettingEngine{}
	if err := settings.SetEphemeralUDPPortRange(portMin, portMax); err != nil {
		return nil, err
	}
	if maxParticipants < 2 {
		maxParticipants = 2
	}
	api := webrtc.NewAPI(webrtc.WithMediaEngine(engine), webrtc.WithInterceptorRegistry(registry), webrtc.WithSettingEngine(settings))
	return &Manager{api: api, rejoinWindow: rejoinWindow, maxParticipants: maxParticipants, now: time.Now, byMember: map[string]*session{}, rooms: map[string]map[string]*session{}, peers: map[string]*Peer{}, tracks: map[string]map[string]*webrtc.TrackLocalStaticRTP{}, continuity: map[string]*rtpContinuity{}, screenTracks: map[string]map[string]*webrtc.TrackLocalStaticRTP{}, screenLayers: map[string]map[string]map[string]*webrtc.TrackLocalStaticRTP{}, screenVisible: map[string]map[string]bool{}, screenSubscriptions: map[string]map[string]map[string]string{}, calls: map[string]*DirectCall{}, removedUntil: map[string]time.Time{}, speakingTimers: map[string]*time.Timer{}, lastSpoke: map[string]time.Time{}}, nil
}

func (m *Manager) WebRTCAPI() *webrtc.API { return m.api }

func (m *Manager) Join(memberID, roomID string) (JoinResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.expireLocked()
	return m.joinLocked(memberID, roomID)
}

func (m *Manager) joinLocked(memberID, roomID string) (JoinResult, error) {
	if until := m.removedUntil[roomID+":"+memberID]; m.now().Before(until) {
		return JoinResult{}, ErrModerated
	}
	if active := m.byMember[memberID]; active != nil {
		return JoinResult{}, ErrAlreadyActive
	}
	if len(m.rooms[roomID]) >= m.maxParticipants {
		return JoinResult{}, ErrRoomFull
	}
	token, err := resumeToken()
	if err != nil {
		return JoinResult{}, err
	}
	now := m.now().UTC()
	m.nextJoinOrder++
	item := &session{participant: Participant{MemberID: memberID, RoomID: roomID, Connected: true, JoinedAt: now.Format(time.RFC3339Nano)}, resumeToken: token, joinOrder: m.nextJoinOrder}
	m.byMember[memberID] = item
	if m.rooms[roomID] == nil {
		m.rooms[roomID] = map[string]*session{}
	}
	m.rooms[roomID][memberID] = item
	if m.screenVisible[roomID] == nil {
		m.screenVisible[roomID] = map[string]bool{}
	}
	m.screenVisible[roomID][memberID] = true
	return JoinResult{Participant: item.participant, ResumeToken: token}, nil
}

// Takeover replaces the authenticated Member's existing Media Session. It is
// the recovery path when a browser no longer has the token for a stale session.
func (m *Manager) Takeover(memberID, roomID string) (JoinResult, error) {
	m.mu.Lock()
	m.expireLocked()
	if until := m.removedUntil[roomID+":"+memberID]; m.now().Before(until) {
		m.mu.Unlock()
		return JoinResult{}, ErrModerated
	}
	targetCount := len(m.rooms[roomID])
	if current := m.byMember[memberID]; current != nil && current.participant.RoomID == roomID {
		targetCount--
	}
	if targetCount >= m.maxParticipants {
		m.mu.Unlock()
		return JoinResult{}, ErrRoomFull
	}
	oldPeer := m.peers[memberID]
	if item := m.byMember[memberID]; item != nil {
		m.removeLocked(item)
	}
	delete(m.peers, memberID)
	if oldPeer != nil {
		for sourceTrackID := range m.tracks[oldPeer.roomID] {
			if strings.HasPrefix(sourceTrackID, memberID+":") {
				delete(m.tracks[oldPeer.roomID], sourceTrackID)
			}
		}
		delete(m.screenTracks[oldPeer.roomID], memberID)
		delete(m.screenLayers[oldPeer.roomID], memberID)
	}
	joined, err := m.joinLocked(memberID, roomID)
	m.mu.Unlock()
	if oldPeer != nil {
		_ = oldPeer.connection.Close()
	}
	return joined, err
}

// End removes the Member only when the request still names their current
// room. This makes a delayed browser hangup harmless after switching rooms.
func (m *Manager) End(memberID, roomID string) error {
	m.mu.Lock()
	item := m.byMember[memberID]
	if item == nil || item.participant.RoomID != roomID {
		m.mu.Unlock()
		return ErrNotPresent
	}
	peer := m.peers[memberID]
	delete(m.peers, memberID)
	m.removeLocked(item)
	if peer != nil {
		for sourceTrackID := range m.tracks[peer.roomID] {
			if strings.HasPrefix(sourceTrackID, memberID+":") {
				delete(m.tracks[peer.roomID], sourceTrackID)
			}
		}
		delete(m.screenTracks[peer.roomID], memberID)
		delete(m.screenLayers[peer.roomID], memberID)
	}
	m.mu.Unlock()
	if peer != nil {
		_ = peer.connection.Close()
	}
	return nil
}

func (m *Manager) Disconnect(memberID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if item := m.byMember[memberID]; item != nil {
		item.participant.Connected = false
		item.rejoinUntil = m.now().Add(m.rejoinWindow)
		item.participant.RejoinBefore = item.rejoinUntil.UTC().Format(time.RFC3339Nano)
	}
}

func (m *Manager) markConnected(memberID string, lease uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if peer := m.peers[memberID]; peer == nil || peer.lease != lease {
		return
	}
	if item := m.byMember[memberID]; item != nil {
		item.participant.Connected = true
		item.participant.RejoinBefore = ""
		item.rejoinUntil = time.Time{}
	}
}

func (m *Manager) Resume(memberID, roomID, token string) (JoinResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item := m.byMember[memberID]
	if item == nil || item.participant.RoomID != roomID || token == "" || token != item.resumeToken || (!item.participant.Connected && !m.now().Before(item.rejoinUntil)) {
		m.expireLocked()
		return JoinResult{}, ErrInvalidResume
	}
	item.participant.Connected = true
	item.participant.RejoinBefore = ""
	item.rejoinUntil = time.Time{}
	return JoinResult{Participant: item.participant, ResumeToken: item.resumeToken}, nil
}

func (m *Manager) Leave(memberID, roomID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	item := m.byMember[memberID]
	if item == nil || item.participant.RoomID != roomID {
		return ErrNotPresent
	}
	m.removeLocked(item)
	return nil
}

func (m *Manager) Participants(roomID string) []Participant {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.expireLocked()
	sessions := make([]*session, 0, len(m.rooms[roomID]))
	for _, item := range m.rooms[roomID] {
		sessions = append(sessions, item)
	}
	sort.Slice(sessions, func(first, second int) bool { return sessions[first].joinOrder < sessions[second].joinOrder })
	items := make([]Participant, 0, len(sessions))
	for _, item := range sessions {
		items = append(items, item.participant)
	}
	return items
}

func (m *Manager) SetServerMuted(roomID, memberID string, muted bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	item := m.byMember[memberID]
	if item == nil || item.participant.RoomID != roomID {
		return ErrNotPresent
	}
	item.participant.ServerMuted = muted
	if muted {
		item.participant.Speaking = false
	}
	return nil
}

func (m *Manager) MarkSpeaking(memberID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item := m.byMember[memberID]
	if item == nil || item.participant.ServerMuted || item.participant.Muted {
		return
	}
	item.participant.Speaking = true
	m.lastSpoke[memberID] = time.Now()
	if timer := m.speakingTimers[memberID]; timer != nil {
		timer.Reset(650 * time.Millisecond)
		return
	}
	m.speakingTimers[memberID] = time.AfterFunc(650*time.Millisecond, func() { m.clearSpeaking(memberID) })
}

func (m *Manager) SetClientMuted(memberID string, muted bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	item := m.byMember[memberID]
	if item == nil {
		return ErrNotPresent
	}
	item.participant.Muted = muted
	if muted {
		item.participant.Speaking = false
	}
	return nil
}

func (m *Manager) clearSpeaking(memberID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if elapsed := time.Since(m.lastSpoke[memberID]); elapsed < 650*time.Millisecond {
		m.speakingTimers[memberID].Reset(650*time.Millisecond - elapsed)
		return
	}
	if item := m.byMember[memberID]; item != nil {
		item.participant.Speaking = false
	}
	delete(m.speakingTimers, memberID)
	delete(m.lastSpoke, memberID)
}
func (m *Manager) IsServerMuted(memberID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	item := m.byMember[memberID]
	return item != nil && item.participant.ServerMuted
}
func (m *Manager) DisconnectMember(roomID, memberID string) error {
	m.mu.Lock()
	item := m.byMember[memberID]
	if item == nil || item.participant.RoomID != roomID {
		m.mu.Unlock()
		return ErrNotPresent
	}
	m.removedUntil[roomID+":"+memberID] = m.now().Add(5 * time.Minute)
	m.mu.Unlock()
	m.RemovePeer(memberID)
	return nil
}

func (m *Manager) Close() {
	m.mu.Lock()
	peers := make([]*Peer, 0, len(m.peers))
	for _, peer := range m.peers {
		peers = append(peers, peer)
	}
	m.byMember = map[string]*session{}
	m.rooms = map[string]map[string]*session{}
	m.peers = map[string]*Peer{}
	m.tracks = map[string]map[string]*webrtc.TrackLocalStaticRTP{}
	m.continuity = map[string]*rtpContinuity{}
	m.screenTracks = map[string]map[string]*webrtc.TrackLocalStaticRTP{}
	m.screenLayers = map[string]map[string]map[string]*webrtc.TrackLocalStaticRTP{}
	m.screenVisible = map[string]map[string]bool{}
	m.screenSubscriptions = map[string]map[string]map[string]string{}
	m.calls = map[string]*DirectCall{}
	m.removedUntil = map[string]time.Time{}
	m.speakingTimers = map[string]*time.Timer{}
	m.lastSpoke = map[string]time.Time{}
	m.nextJoinOrder = 0
	m.mu.Unlock()
	for _, peer := range peers {
		_ = peer.connection.Close()
	}
}

func (m *Manager) expireLocked() {
	now := m.now()
	for _, item := range m.byMember {
		if !item.participant.Connected && !now.Before(item.rejoinUntil) {
			if peer := m.peers[item.participant.MemberID]; peer != nil {
				delete(m.peers, item.participant.MemberID)
				go peer.connection.Close()
			}
			m.removeLocked(item)
		}
	}
}

func (m *Manager) removeLocked(item *session) {
	if timer := m.speakingTimers[item.participant.MemberID]; timer != nil {
		timer.Stop()
		delete(m.speakingTimers, item.participant.MemberID)
		delete(m.lastSpoke, item.participant.MemberID)
	}
	delete(m.byMember, item.participant.MemberID)
	room := m.rooms[item.participant.RoomID]
	delete(room, item.participant.MemberID)
	delete(m.screenVisible[item.participant.RoomID], item.participant.MemberID)
	delete(m.screenTracks[item.participant.RoomID], item.participant.MemberID)
	delete(m.screenLayers[item.participant.RoomID], item.participant.MemberID)
	delete(m.screenSubscriptions[item.participant.RoomID], item.participant.MemberID)
	for _, subscriptions := range m.screenSubscriptions[item.participant.RoomID] {
		delete(subscriptions, item.participant.MemberID)
	}
	if len(room) == 0 {
		delete(m.rooms, item.participant.RoomID)
		delete(m.screenTracks, item.participant.RoomID)
		delete(m.screenLayers, item.participant.RoomID)
		delete(m.screenVisible, item.participant.RoomID)
		delete(m.screenSubscriptions, item.participant.RoomID)
	}
}

func resumeToken() (string, error) {
	value := make([]byte, 24)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}
