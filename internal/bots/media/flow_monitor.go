// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package media

import "time"

type FlowSnapshot struct {
	At                    time.Time
	Playing, Paused       bool
	MediaState            State
	ProducedPackets       uint64
	RTPPacketsSent        uint64
	RemotePacketsReceived uint64
	RemoteReportAvailable bool
}

type FlowMonitor struct {
	threshold                    time.Duration
	previous                     FlowSnapshot
	started                      bool
	producedAt, sentAt, remoteAt time.Time
	issue                        string
}

func NewFlowMonitor(threshold time.Duration) *FlowMonitor {
	if threshold <= 0 {
		threshold = 3 * time.Second
	}
	return &FlowMonitor{threshold: threshold}
}

func (m *FlowMonitor) Observe(snapshot FlowSnapshot) []Event {
	if snapshot.At.IsZero() {
		snapshot.At = time.Now().UTC()
	}
	if !m.started || !snapshot.Playing || snapshot.Paused || snapshot.MediaState != StateConnected {
		m.reset(snapshot)
		return nil
	}
	if snapshot.ProducedPackets != m.previous.ProducedPackets {
		m.producedAt = snapshot.At
	}
	if snapshot.RTPPacketsSent != m.previous.RTPPacketsSent {
		m.sentAt = snapshot.At
	}
	if snapshot.RemotePacketsReceived != m.previous.RemotePacketsReceived {
		m.remoteAt = snapshot.At
	}
	if snapshot.RemoteReportAvailable && !m.previous.RemoteReportAvailable {
		m.remoteAt = snapshot.At
	}
	kind := ""
	if snapshot.At.Sub(m.producedAt) >= m.threshold {
		kind = "audio_production_stalled"
	}
	if kind == "" && snapshot.ProducedPackets > m.previous.ProducedPackets && snapshot.At.Sub(m.sentAt) >= m.threshold {
		kind = "rtp_send_stalled"
	}
	if kind == "" && snapshot.RemoteReportAvailable && snapshot.RTPPacketsSent > m.previous.RTPPacketsSent && snapshot.At.Sub(m.remoteAt) >= 2*m.threshold {
		kind = "remote_receive_stalled"
	}
	events := []Event{}
	if kind != "" && kind != m.issue {
		events = append(events, Event{At: snapshot.At, Kind: kind, State: snapshot.MediaState, ProducedPackets: snapshot.ProducedPackets, RTPPacketsSent: snapshot.RTPPacketsSent, RemotePacketsReceived: snapshot.RemotePacketsReceived})
	} else if kind == "" && m.issue != "" {
		events = append(events, Event{At: snapshot.At, Kind: "audio_flow_recovered", State: snapshot.MediaState, Error: m.issue, ProducedPackets: snapshot.ProducedPackets, RTPPacketsSent: snapshot.RTPPacketsSent, RemotePacketsReceived: snapshot.RemotePacketsReceived})
	}
	m.issue = kind
	m.previous = snapshot
	return events
}

func (m *FlowMonitor) reset(snapshot FlowSnapshot) {
	m.started = true
	m.previous = snapshot
	m.producedAt = snapshot.At
	m.sentAt = snapshot.At
	m.remoteAt = snapshot.At
	m.issue = ""
}
