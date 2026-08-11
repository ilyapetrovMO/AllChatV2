// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package media

import (
	"testing"
	"time"
)

func TestFlowMonitorReportsContinuousToneProductionStall(t *testing.T) {
	monitor := NewFlowMonitor(2 * time.Second)
	start := time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)
	monitor.Observe(FlowSnapshot{At: start, Playing: true, MediaState: StateConnected, ProducedPackets: 100, RTPPacketsSent: 100})
	events := monitor.Observe(FlowSnapshot{At: start.Add(3 * time.Second), Playing: true, MediaState: StateConnected, ProducedPackets: 100, RTPPacketsSent: 100})
	if len(events) != 1 || events[0].Kind != "audio_production_stalled" {
		t.Fatalf("events=%+v", events)
	}
}

func TestFlowMonitorSeparatesRTPSendAndRemoteReceiveStalls(t *testing.T) {
	start := time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)
	rtp := NewFlowMonitor(2 * time.Second)
	rtp.Observe(FlowSnapshot{At: start, Playing: true, MediaState: StateConnected, ProducedPackets: 100, RTPPacketsSent: 100})
	rtp.Observe(FlowSnapshot{At: start.Add(time.Second), Playing: true, MediaState: StateConnected, ProducedPackets: 150, RTPPacketsSent: 100})
	events := rtp.Observe(FlowSnapshot{At: start.Add(2 * time.Second), Playing: true, MediaState: StateConnected, ProducedPackets: 200, RTPPacketsSent: 100})
	if len(events) != 1 || events[0].Kind != "rtp_send_stalled" {
		t.Fatalf("rtp events=%+v", events)
	}

	remote := NewFlowMonitor(2 * time.Second)
	remote.Observe(FlowSnapshot{At: start, Playing: true, MediaState: StateConnected, ProducedPackets: 100, RTPPacketsSent: 100, RemotePacketsReceived: 90, RemoteReportAvailable: true})
	remote.Observe(FlowSnapshot{At: start.Add(2 * time.Second), Playing: true, MediaState: StateConnected, ProducedPackets: 150, RTPPacketsSent: 150, RemotePacketsReceived: 90, RemoteReportAvailable: true})
	events = remote.Observe(FlowSnapshot{At: start.Add(6 * time.Second), Playing: true, MediaState: StateConnected, ProducedPackets: 200, RTPPacketsSent: 200, RemotePacketsReceived: 90, RemoteReportAvailable: true})
	if len(events) != 1 || events[0].Kind != "remote_receive_stalled" {
		t.Fatalf("remote events=%+v", events)
	}
}
