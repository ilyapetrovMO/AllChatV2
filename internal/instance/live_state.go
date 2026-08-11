// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"sync"
	"time"
)

const (
	presenceIdleAfter        = 5 * time.Minute
	presenceOfflineGrace     = 2 * time.Second
	presenceHeartbeatTimeout = 3 * time.Second
	typingLifetime           = 5 * time.Second
	typingRateLimit          = time.Second
)

type liveConnection struct {
	MemberID     string
	SessionToken string
	ActiveAt     time.Time
	SeenAt       time.Time
	Disconnected time.Time
	Mobile       bool
}

type typingState struct {
	MemberID   string    `json:"member_id"`
	MemberName string    `json:"member_name"`
	ChannelID  string    `json:"channel_id"`
	ExpiresAt  time.Time `json:"expires_at"`
	LastSent   time.Time `json:"-"`
}

type liveState struct {
	mu          sync.Mutex
	connections map[string]liveConnection
	typing      map[string]typingState
	departures  map[string]time.Time
	lastStates  map[string]string
}

func newLiveState() *liveState {
	return &liveState{connections: make(map[string]liveConnection), typing: make(map[string]typingState), departures: make(map[string]time.Time), lastStates: make(map[string]string)}
}

func (s *liveState) connect(connectionID, memberID, sessionToken string, mobile ...bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	s.connections[connectionID] = liveConnection{MemberID: memberID, SessionToken: sessionToken, ActiveAt: now, SeenAt: now, Mobile: len(mobile) > 0 && mobile[0]}
	delete(s.departures, memberID)
}

func (s *liveState) activity(connectionID string, active bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	connection, ok := s.connections[connectionID]
	if !ok {
		return
	}
	if active {
		connection.ActiveAt = time.Now()
	} else {
		connection.ActiveAt = time.Now().Add(-presenceIdleAfter)
	}
	connection.SeenAt = time.Now()
	s.connections[connectionID] = connection
}

func (s *liveState) heartbeat(connectionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	connection, ok := s.connections[connectionID]
	if ok {
		connection.SeenAt = time.Now()
		s.connections[connectionID] = connection
	}
}

func (s *liveState) disconnect(connectionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	connection, ok := s.connections[connectionID]
	if ok {
		connection.Disconnected = time.Now()
		s.connections[connectionID] = connection
	}
}

func (s *liveState) disconnectSession(sessionToken string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for id, connection := range s.connections {
		if connection.SessionToken == sessionToken {
			delete(s.connections, id)
			s.departures[connection.MemberID] = now
		}
	}
}

func (s *liveState) setTyping(memberID, memberName, channelID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	key := memberID + "\x00" + channelID
	current := s.typing[key]
	if now.Sub(current.LastSent) < typingRateLimit {
		return false
	}
	s.typing[key] = typingState{MemberID: memberID, MemberName: memberName, ChannelID: channelID, ExpiresAt: now.Add(typingLifetime), LastSent: now}
	return true
}

func (s *liveState) snapshot() (map[string]string, []typingState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	presence := make(map[string]string)
	for id, connection := range s.connections {
		if now.Sub(connection.SeenAt) >= presenceHeartbeatTimeout {
			delete(s.connections, id)
			s.departures[connection.MemberID] = now
			continue
		}
		if !connection.Disconnected.IsZero() && now.Sub(connection.Disconnected) >= presenceOfflineGrace {
			delete(s.connections, id)
			continue
		}
		state := "idle"
		if now.Sub(connection.ActiveAt) < presenceIdleAfter {
			if connection.Mobile {
				state = "mobile"
			} else {
				state = "online"
			}
		}
		if presencePriority(state) > presencePriority(presence[connection.MemberID]) {
			presence[connection.MemberID] = state
		}
		s.lastStates[connection.MemberID] = presence[connection.MemberID]
	}
	for memberID, departedAt := range s.departures {
		if _, connected := presence[memberID]; connected {
			delete(s.departures, memberID)
			continue
		}
		if now.Sub(departedAt) < presenceOfflineGrace {
			presence[memberID] = s.lastStates[memberID]
		} else {
			delete(s.departures, memberID)
			delete(s.lastStates, memberID)
		}
	}
	typing := make([]typingState, 0, len(s.typing))
	for key, state := range s.typing {
		if now.After(state.ExpiresAt) {
			delete(s.typing, key)
			continue
		}
		typing = append(typing, state)
	}
	return presence, typing
}

func presencePriority(state string) int {
	switch state {
	case "online":
		return 3
	case "mobile":
		return 2
	case "idle":
		return 1
	default:
		return 0
	}
}
