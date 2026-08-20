// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package media

import (
	"errors"
	"time"
)

var (
	ErrBusy      = errors.New("Member is already busy")
	ErrCallState = errors.New("Direct Call state does not allow this action")
)

type DirectCall struct {
	ID              string `json:"id"`
	DirectMessageID string `json:"direct_message_id"`
	CallerID        string `json:"caller_id"`
	RecipientID     string `json:"recipient_id"`
	State           string `json:"state"`
	CreatedAt       string `json:"created_at"`
	ExpiresAt       string `json:"expires_at,omitempty"`
	FinishedAt      string `json:"finished_at,omitempty"`
}

func (m *Manager) StartDirectCall(dmID, callerID, recipientID string) (DirectCall, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.expireCallsLocked()
	if m.byMember[callerID] != nil || m.byMember[recipientID] != nil || m.callForMemberLocked(callerID) != nil || m.callForMemberLocked(recipientID) != nil {
		return DirectCall{}, ErrBusy
	}
	id, err := resumeToken()
	if err != nil {
		return DirectCall{}, err
	}
	now := m.now().UTC()
	expires := now.Add(30 * time.Second)
	call := DirectCall{ID: id, DirectMessageID: dmID, CallerID: callerID, RecipientID: recipientID, State: "ringing", CreatedAt: now.Format(time.RFC3339Nano), ExpiresAt: expires.Format(time.RFC3339Nano)}
	m.calls[id] = &call
	return call, nil
}

func (m *Manager) DirectCallForMember(dmID, memberID string) (DirectCall, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.expireCallsLocked()
	var terminal *DirectCall
	for _, call := range m.calls {
		if call.DirectMessageID == dmID && (call.CallerID == memberID || call.RecipientID == memberID) {
			if call.State == "ringing" || call.State == "accepted" {
				return *call, true
			}
			if terminal == nil || call.CreatedAt > terminal.CreatedAt {
				terminal = call
			}
		}
	}
	if terminal != nil {
		return *terminal, true
	}
	return DirectCall{}, false
}

// CurrentDirectCall returns the active ringing or accepted call for a Member.
func (m *Manager) CurrentDirectCall(memberID string) (DirectCall, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.expireCallsLocked()
	if call := m.callForMemberLocked(memberID); call != nil {
		return *call, true
	}
	return DirectCall{}, false
}
func (m *Manager) AcceptDirectCall(callID, memberID string) (DirectCall, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.expireCallsLocked()
	call := m.calls[callID]
	if call == nil || call.RecipientID != memberID {
		return DirectCall{}, ErrCallState
	}
	if call.State == "accepted" {
		return *call, nil
	}
	if call.State != "ringing" {
		return DirectCall{}, ErrCallState
	}
	call.State = "accepted"
	call.ExpiresAt = ""
	return *call, nil
}
func (m *Manager) DeclineDirectCall(callID, memberID string) (DirectCall, error) {
	return m.finishCall(callID, memberID, "declined")
}
func (m *Manager) EndDirectCall(callID, memberID string) (DirectCall, error) {
	return m.finishCall(callID, memberID, "ended")
}
func (m *Manager) finishCall(callID, memberID, state string) (DirectCall, error) {
	m.mu.Lock()
	call := m.calls[callID]
	if call == nil || (call.CallerID != memberID && call.RecipientID != memberID) {
		m.mu.Unlock()
		return DirectCall{}, ErrCallState
	}
	call.State = state
	call.FinishedAt = m.now().UTC().Format(time.RFC3339Nano)
	result := *call
	participants := []string{call.CallerID, call.RecipientID}
	m.mu.Unlock()
	for _, participant := range participants {
		m.RemovePeer(participant)
	}
	return result, nil
}

// EndCallsForMember immediately tears down ringing or accepted calls involving
// a Member. It is used by account and relationship policy changes such as a
// block or suspension so an already-connected peer cannot outlive access.
func (m *Manager) EndCallsForMember(memberID, state string) []DirectCall {
	return m.endCalls(state, func(call *DirectCall) bool {
		return call.CallerID == memberID || call.RecipientID == memberID
	})
}

func (m *Manager) EndCallsBetween(firstMemberID, secondMemberID, state string) []DirectCall {
	return m.endCalls(state, func(call *DirectCall) bool {
		return (call.CallerID == firstMemberID && call.RecipientID == secondMemberID) ||
			(call.CallerID == secondMemberID && call.RecipientID == firstMemberID)
	})
}

func (m *Manager) endCalls(state string, matches func(*DirectCall) bool) []DirectCall {
	m.mu.Lock()
	if state == "" {
		state = "ended"
	}
	now := m.now().UTC().Format(time.RFC3339Nano)
	ended := make([]DirectCall, 0, 1)
	participants := map[string]struct{}{}
	for _, call := range m.calls {
		if call.State != "ringing" && call.State != "accepted" {
			continue
		}
		if matches(call) {
			call.State = state
			call.FinishedAt = now
			ended = append(ended, *call)
			participants[call.CallerID] = struct{}{}
			participants[call.RecipientID] = struct{}{}
		}
	}
	m.mu.Unlock()
	for participant := range participants {
		m.RemovePeer(participant)
	}
	return ended
}
func (m *Manager) CanJoinDirectCall(callID, memberID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	call := m.calls[callID]
	return call != nil && call.State == "accepted" && (call.CallerID == memberID || call.RecipientID == memberID)
}
func (m *Manager) callForMemberLocked(memberID string) *DirectCall {
	for _, call := range m.calls {
		if (call.State == "ringing" || call.State == "accepted") && (call.CallerID == memberID || call.RecipientID == memberID) {
			return call
		}
	}
	return nil
}
func (m *Manager) expireCallsLocked() {
	now := m.now()
	for id, call := range m.calls {
		if call.State == "ringing" {
			expires, _ := time.Parse(time.RFC3339Nano, call.ExpiresAt)
			if !now.Before(expires) {
				call.State = "missed"
				call.FinishedAt = now.UTC().Format(time.RFC3339Nano)
			}
		} else if call.FinishedAt != "" {
			finished, _ := time.Parse(time.RFC3339Nano, call.FinishedAt)
			if now.Sub(finished) >= 5*time.Minute {
				delete(m.calls, id)
			}
		}
	}
}
