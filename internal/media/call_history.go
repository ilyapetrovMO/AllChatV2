// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package media

import "time"

// SetCallRecorder installs the durable history sink before calls are started.
// The sink must not call back into Manager. Failed writes remain queued for retry.
func (m *Manager) SetCallRecorder(record func(DirectCall) error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.recordCall = record
}
func (m *Manager) recordCallLocked(call DirectCall) {
	if m.recordCall == nil {
		return
	}
	m.pendingCalls = append(m.pendingCalls, call)
	m.flushCallsLocked()
}
func (m *Manager) flushCallsLocked() {
	for len(m.pendingCalls) > 0 {
		if err := m.recordCall(m.pendingCalls[0]); err != nil {
			m.scheduleCallsLocked()
			return
		}
		m.pendingCalls = m.pendingCalls[1:]
	}
}
func (m *Manager) scheduleCallsLocked() {
	if m.callTimer != nil || m.closed {
		return
	}
	m.callTimer = time.AfterFunc(time.Second, func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		m.callTimer = nil
		if m.closed {
			return
		}
		m.expireCallsLocked()
		m.flushCallsLocked()
		for _, call := range m.calls {
			if call.State == "ringing" {
				m.scheduleCallsLocked()
				break
			}
		}
	})
}
