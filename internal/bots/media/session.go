// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/pion/interceptor"
	"github.com/pion/rtp"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

type State string

const (
	StateIdle       State = "idle"
	StateConnecting State = "connecting"
	StateConnected  State = "connected"
	StateRecovering State = "recovering"
)

type Status struct {
	State         State         `json:"state"`
	RoomID        string        `json:"room_id,omitempty"`
	ConnectedAt   time.Time     `json:"connected_at,omitempty"`
	OutageStarted time.Time     `json:"outage_started,omitempty"`
	LastOutage    time.Duration `json:"last_outage,omitempty"`
	Recoveries    int           `json:"recoveries"`
	PacketsSent   uint64        `json:"packets_sent"`
	DroppedFrames uint64        `json:"dropped_frames"`
	LastPacketAt  time.Time     `json:"last_packet_at,omitempty"`
	LastError     string        `json:"last_error,omitempty"`
}

type FlowStats struct {
	RTPPacketsSent        uint64  `json:"rtp_packets_sent"`
	RTPBytesSent          uint64  `json:"rtp_bytes_sent"`
	PacketsDiscarded      uint64  `json:"packets_discarded_on_send"`
	RemoteReportAvailable bool    `json:"remote_report_available"`
	RemotePacketsReceived uint64  `json:"remote_packets_received"`
	RemotePacketsLost     int64   `json:"remote_packets_lost"`
	RemoteJitter          float64 `json:"remote_jitter_seconds"`
}

type Session struct {
	base     *url.URL
	client   *http.Client
	sink     *OpusSink
	mu       sync.Mutex
	status   Status
	cancel   context.CancelFunc
	socket   *websocket.Conn
	peer     *webrtc.PeerConnection
	explicit bool
	events   func(Event)
}

func NewSession(base *url.URL, client *http.Client) *Session {
	return &Session{base: base, client: client, sink: &OpusSink{}}
}
func (s *Session) Sink() *OpusSink { return s.sink }
func (s *Session) RoomID() string  { return s.Status().RoomID }
func (s *Session) SetEventHandler(handler func(Event)) {
	s.mu.Lock()
	s.events = handler
	s.mu.Unlock()
}
func (s *Session) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := s.status
	sent, dropped, last := s.sink.Stats()
	result.PacketsSent, result.DroppedFrames, result.LastPacketAt = sent, dropped, last
	return result
}

func (s *Session) FlowStats() FlowStats {
	s.mu.Lock()
	peer := s.peer
	s.mu.Unlock()
	if peer == nil {
		return FlowStats{}
	}
	result := FlowStats{}
	for _, raw := range peer.GetStats() {
		switch value := raw.(type) {
		case webrtc.OutboundRTPStreamStats:
			if value.Kind == "audio" {
				result.RTPPacketsSent += uint64(value.PacketsSent)
				result.RTPBytesSent += value.BytesSent
				result.PacketsDiscarded += uint64(value.PacketsDiscardedOnSend)
			}
		case webrtc.RemoteInboundRTPStreamStats:
			if value.Kind == "audio" {
				result.RemoteReportAvailable = true
				result.RemotePacketsReceived += uint64(value.PacketsReceived)
				result.RemotePacketsLost += int64(value.PacketsLost)
				if value.Jitter > result.RemoteJitter {
					result.RemoteJitter = value.Jitter
				}
			}
		}
	}
	return result
}

func (s *Session) Connect(parent context.Context, roomID string) error {
	s.mu.Lock()
	if s.cancel != nil {
		s.mu.Unlock()
		return fmt.Errorf("already connected")
	}
	ctx, cancel := context.WithCancel(parent)
	s.cancel = cancel
	s.explicit = false
	s.status = Status{State: StateConnecting, RoomID: roomID}
	s.mu.Unlock()
	s.emit(Event{Kind: "connect_requested", State: StateConnecting, RoomID: roomID})
	go s.run(ctx, roomID)
	return nil
}
func (s *Session) Leave() {
	s.mu.Lock()
	s.explicit = true
	socket, cancel := s.socket, s.cancel
	s.mu.Unlock()
	s.emit(Event{Kind: "leave_requested", RoomID: s.RoomID()})
	if socket != nil {
		ctx, c := context.WithTimeout(context.Background(), time.Second)
		_ = write(ctx, socket, map[string]any{"version": 1, "type": "leave"})
		c()
	}
	if cancel != nil {
		cancel()
	}
}
func (s *Session) DropSignaling() {
	s.mu.Lock()
	socket := s.socket
	s.mu.Unlock()
	s.emit(Event{Kind: "fault_injected", RoomID: s.RoomID(), Error: "drop signaling"})
	if socket != nil {
		socket.CloseNow()
	}
}
func (s *Session) DropPeer() {
	s.mu.Lock()
	peer := s.peer
	s.mu.Unlock()
	s.emit(Event{Kind: "fault_injected", RoomID: s.RoomID(), Error: "drop peer"})
	if peer != nil {
		_ = peer.Close()
	}
}

func (s *Session) run(ctx context.Context, roomID string) {
	resume, attempt := "", 0
	for ctx.Err() == nil {
		s.emit(Event{Kind: "connect_attempt", State: StateConnecting, RoomID: roomID, Attempt: attempt + 1, ResumeAttempt: resume != ""})
		err, token := s.connectOnce(ctx, roomID, resume)
		if s.Status().State == StateConnected {
			attempt = 0
		}
		if token != "" {
			resume = token
		}
		if ctx.Err() != nil {
			break
		}
		s.mu.Lock()
		if s.explicit {
			s.mu.Unlock()
			break
		}
		now := time.Now()
		if s.status.OutageStarted.IsZero() {
			s.status.OutageStarted = now
		}
		s.status.State = StateRecovering
		if err != nil {
			s.status.LastError = err.Error()
		}
		s.mu.Unlock()
		delays := []time.Duration{500 * time.Millisecond, time.Second, 2 * time.Second, 4 * time.Second, 10 * time.Second}
		delay := delays[min(attempt, len(delays)-1)]
		attempt++
		status := s.Status()
		s.emit(Event{Kind: "recovery_started", State: StateRecovering, RoomID: roomID, Attempt: attempt, Error: status.LastError, Delay: delay, ResumeAttempt: resume != "", PacketsSent: status.PacketsSent, DroppedFrames: status.DroppedFrames})
		select {
		case <-ctx.Done():
			break
		case <-time.After(delay):
		}
	}
	s.sink.Unbind(nil)
	s.mu.Lock()
	s.status.State = StateIdle
	s.status.RoomID = ""
	s.cancel = nil
	s.socket = nil
	s.peer = nil
	s.mu.Unlock()
	s.emit(Event{Kind: "session_idle", State: StateIdle})
}

func (s *Session) connectOnce(ctx context.Context, roomID, resume string) (error, string) {
	s.setState(StateConnecting, "")
	ice, err := s.iceServers(ctx)
	if err != nil {
		return err, resume
	}
	engine := &webrtc.MediaEngine{}
	if err = engine.RegisterDefaultCodecs(); err != nil {
		return err, resume
	}
	_ = engine.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: sdp.AudioLevelURI}, webrtc.RTPCodecTypeAudio)
	registry := &interceptor.Registry{}
	if err = webrtc.RegisterDefaultInterceptors(engine, registry); err != nil {
		return err, resume
	}
	peer, err := webrtc.NewAPI(webrtc.WithMediaEngine(engine), webrtc.WithInterceptorRegistry(registry)).NewPeerConnection(webrtc.Configuration{ICEServers: ice})
	if err != nil {
		return err, resume
	}
	track, err := newAudioTrack("music", "allchat-music")
	if err != nil {
		peer.Close()
		return err, resume
	}
	sender, err := peer.AddTrack(track)
	if err != nil {
		peer.Close()
		return err, resume
	}
	go func() {
		buffer := make([]byte, 1500)
		for {
			if _, _, readErr := sender.Read(buffer); readErr != nil {
				return
			}
		}
	}()
	offer, err := peer.CreateOffer(nil)
	if err != nil {
		peer.Close()
		return err, resume
	}
	gathered := webrtc.GatheringCompletePromise(peer)
	if err = peer.SetLocalDescription(offer); err != nil {
		peer.Close()
		return err, resume
	}
	select {
	case <-gathered:
	case <-ctx.Done():
		peer.Close()
		return ctx.Err(), resume
	}
	socket, err := s.dial(ctx)
	if err != nil {
		peer.Close()
		return err, resume
	}
	s.mu.Lock()
	s.socket = socket
	s.peer = peer
	s.mu.Unlock()
	defer func() {
		s.sink.Unbind(track)
		socket.CloseNow()
		peer.Close()
		s.mu.Lock()
		if s.socket == socket {
			s.socket = nil
		}
		if s.peer == peer {
			s.peer = nil
		}
		s.mu.Unlock()
	}()
	if err = write(ctx, socket, map[string]any{"version": 1, "type": "join", "room_id": roomID, "resume_token": resume, "sdp": peer.LocalDescription()}); err != nil {
		return err, resume
	}
	lastAck := time.Now()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	stateChange := make(chan error, 1)
	peer.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		s.emit(Event{Kind: "peer_state_changed", RoomID: roomID, PeerState: state.String()})
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			select {
			case stateChange <- fmt.Errorf("peer connection %s", state):
			default:
			}
		}
		if state == webrtc.PeerConnectionStateDisconnected {
			go func() {
				time.Sleep(5 * time.Second)
				if peer.ConnectionState() == webrtc.PeerConnectionStateDisconnected {
					select {
					case stateChange <- fmt.Errorf("peer connection disconnected"):
					default:
					}
				}
			}()
		}
	})
	type readResult struct {
		payload []byte
		err     error
	}
	reads := make(chan readResult, 1)
	go func() {
		for {
			_, payload, e := socket.Read(ctx)
			reads <- readResult{payload, e}
			if e != nil {
				return
			}
		}
	}()
	connected := false
	for {
		select {
		case <-ctx.Done():
			return ctx.Err(), resume
		case err = <-stateChange:
			return err, resume
		case <-ticker.C:
			if time.Since(lastAck) > 25*time.Second {
				s.emit(Event{Kind: "heartbeat_timeout", RoomID: roomID, HeartbeatAge: time.Since(lastAck)})
				return fmt.Errorf("media heartbeat timed out"), resume
			}
			if err = write(ctx, socket, map[string]any{"version": 1, "type": "heartbeat"}); err != nil {
				return err, resume
			}
		case result := <-reads:
			if result.err != nil {
				s.emit(Event{Kind: "signaling_read_failed", RoomID: roomID, Error: result.err.Error()})
				return result.err, resume
			}
			var frame struct {
				Type        string                     `json:"type"`
				Error       string                     `json:"error"`
				Code        string                     `json:"code"`
				ResumeToken string                     `json:"resume_token"`
				SDP         *webrtc.SessionDescription `json:"sdp"`
				Candidate   *webrtc.ICECandidateInit   `json:"candidate"`
			}
			if json.Unmarshal(result.payload, &frame) != nil {
				continue
			}
			switch frame.Type {
			case "heartbeat-ack":
				lastAck = time.Now()
			case "error":
				if frame.Code == "invalid_resume" {
					resume = ""
				}
				s.emit(Event{Kind: "protocol_error", RoomID: roomID, Error: frame.Code + ": " + frame.Error, ResumeAttempt: resume != ""})
				return fmt.Errorf("media: %s", frame.Error), resume
			case "answer":
				if frame.SDP != nil {
					if err = peer.SetRemoteDescription(*frame.SDP); err != nil {
						return err, resume
					}
					resume = frame.ResumeToken
					if !connected {
						connected = true
						s.sink.Bind(track)
						s.connected()
					}
				}
			case "candidate":
				if frame.Candidate != nil {
					_ = peer.AddICECandidate(*frame.Candidate)
				}
			case "offer":
				if frame.SDP != nil {
					if err = peer.SetRemoteDescription(*frame.SDP); err != nil {
						return err, resume
					}
					answer, e := peer.CreateAnswer(nil)
					if e != nil {
						return e, resume
					}
					done := webrtc.GatheringCompletePromise(peer)
					if e = peer.SetLocalDescription(answer); e != nil {
						return e, resume
					}
					select {
					case <-done:
					case <-ctx.Done():
						return ctx.Err(), resume
					}
					if e = write(ctx, socket, map[string]any{"version": 1, "type": "answer", "sdp": peer.LocalDescription()}); e != nil {
						return e, resume
					}
				}
			}
		}
	}
}

func (s *Session) connected() {
	s.mu.Lock()
	now := time.Now()
	recovered := !s.status.OutageStarted.IsZero()
	if !s.status.OutageStarted.IsZero() {
		s.status.LastOutage = now.Sub(s.status.OutageStarted)
		s.status.OutageStarted = time.Time{}
		s.status.Recoveries++
	}
	s.status.State = StateConnected
	s.status.ConnectedAt = now
	s.status.LastError = ""
	status := s.status
	s.mu.Unlock()
	kind := "connected"
	if recovered {
		kind = "recovery_completed"
	}
	sent, dropped, _ := s.sink.Stats()
	s.emit(Event{Kind: kind, State: StateConnected, RoomID: status.RoomID, Outage: status.LastOutage, PacketsSent: sent, DroppedFrames: dropped})
}

func (s *Session) emit(event Event) {
	s.mu.Lock()
	handler := s.events
	if event.At.IsZero() {
		event.At = time.Now().UTC()
	}
	s.mu.Unlock()
	if handler != nil {
		handler(event)
	}
}
func (s *Session) setState(state State, errText string) {
	s.mu.Lock()
	s.status.State = state
	if errText != "" {
		s.status.LastError = errText
	}
	s.mu.Unlock()
}
func (s *Session) iceServers(ctx context.Context) ([]webrtc.ICEServer, error) {
	var out struct {
		IceServers []webrtc.ICEServer `json:"ice_servers"`
	}
	if err := s.json(ctx, http.MethodGet, "/api/v1/turn-credentials", nil, &out); err != nil {
		return nil, err
	}
	return out.IceServers, nil
}
func (s *Session) dial(ctx context.Context) (*websocket.Conn, error) {
	target := *s.base
	if target.Scheme == "https" {
		target.Scheme = "wss"
	} else {
		target.Scheme = "ws"
	}
	target.Path = "/api/v1/media"
	target.RawQuery = ""
	headers := http.Header{}
	for _, cookie := range s.client.Jar.Cookies(s.base) {
		headers.Add("Cookie", cookie.String())
	}
	connection, response, err := websocket.Dial(ctx, target.String(), &websocket.DialOptions{HTTPHeader: headers})
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	return connection, err
}
func (s *Session) json(ctx context.Context, method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		encoded, e := json.Marshal(input)
		if e != nil {
			return e
		}
		body = bytes.NewReader(encoded)
	}
	request, e := http.NewRequestWithContext(ctx, method, s.base.ResolveReference(&url.URL{Path: path}).String(), body)
	if e != nil {
		return e
	}
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, e := s.client.Do(request)
	if e != nil {
		return e
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("%s %s: %s", method, path, response.Status)
	}
	if output != nil {
		return json.NewDecoder(response.Body).Decode(output)
	}
	return nil
}
func write(ctx context.Context, socket *websocket.Conn, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return socket.Write(writeCtx, websocket.MessageText, payload)
}

type OpusSink struct {
	mu               sync.RWMutex
	track            *audioTrack
	packets, dropped uint64
	last             time.Time
}

func (s *OpusSink) Bind(track *audioTrack) { s.mu.Lock(); s.track = track; s.mu.Unlock() }
func (s *OpusSink) Unbind(track *audioTrack) {
	s.mu.Lock()
	if track == nil || s.track == track {
		s.track = nil
	}
	s.mu.Unlock()
}
func (s *OpusSink) WriteOpus(payload []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.track == nil {
		s.dropped++
		return nil
	}
	if err := s.track.WriteOpus(payload); err != nil {
		if errors.Is(err, io.ErrClosedPipe) {
			s.dropped++
			return nil
		}
		return err
	}
	s.packets++
	s.last = time.Now()
	return nil
}
func (s *OpusSink) Stats() (uint64, uint64, time.Time) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.packets, s.dropped, s.last
}

type audioTrack struct {
	track     *webrtc.TrackLocalStaticRTP
	mu        sync.Mutex
	extension uint8
	sequence  uint16
	timestamp uint32
}

func newAudioTrack(id, stream string) (*audioTrack, error) {
	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2}, id, stream)
	if err != nil {
		return nil, err
	}
	return &audioTrack{track: track}, nil
}
func (t *audioTrack) Bind(ctx webrtc.TrackLocalContext) (webrtc.RTPCodecParameters, error) {
	t.mu.Lock()
	for _, ext := range ctx.HeaderExtensions() {
		if ext.URI == sdp.AudioLevelURI {
			t.extension = uint8(ext.ID)
		}
	}
	t.mu.Unlock()
	return t.track.Bind(ctx)
}
func (t *audioTrack) Unbind(ctx webrtc.TrackLocalContext) error { return t.track.Unbind(ctx) }
func (t *audioTrack) ID() string                                { return t.track.ID() }
func (t *audioTrack) RID() string                               { return t.track.RID() }
func (t *audioTrack) StreamID() string                          { return t.track.StreamID() }
func (t *audioTrack) Kind() webrtc.RTPCodecType                 { return t.track.Kind() }
func (t *audioTrack) WriteOpus(payload []byte) error {
	t.mu.Lock()
	packet := &rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: t.sequence, Timestamp: t.timestamp}, Payload: payload}
	t.sequence++
	t.timestamp += 960
	if t.extension != 0 {
		level, _ := (rtp.AudioLevelExtension{Level: 10, Voice: true}).Marshal()
		_ = packet.Header.SetExtension(t.extension, level)
	}
	t.mu.Unlock()
	return t.track.WriteRTP(packet)
}
