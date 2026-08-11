// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package media

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Event is a credential-free diagnostic point in a Media Session lifecycle.
type Event struct {
	At                    time.Time     `json:"at"`
	Kind                  string        `json:"kind"`
	State                 State         `json:"state,omitempty"`
	RoomID                string        `json:"room_id,omitempty"`
	PeerState             string        `json:"peer_state,omitempty"`
	Attempt               int           `json:"attempt,omitempty"`
	Error                 string        `json:"error,omitempty"`
	Delay                 time.Duration `json:"delay_ns,omitempty"`
	Outage                time.Duration `json:"outage_ns,omitempty"`
	HeartbeatAge          time.Duration `json:"heartbeat_age_ns,omitempty"`
	ResumeAttempt         bool          `json:"resume_attempt,omitempty"`
	PacketsSent           uint64        `json:"packets_sent,omitempty"`
	DroppedFrames         uint64        `json:"dropped_frames,omitempty"`
	ProducedPackets       uint64        `json:"produced_packets,omitempty"`
	RTPPacketsSent        uint64        `json:"rtp_packets_sent,omitempty"`
	RemotePacketsReceived uint64        `json:"remote_packets_received,omitempty"`
	RemoteReportAvailable bool          `json:"remote_report_available,omitempty"`
	RTPBytesSent          uint64        `json:"rtp_bytes_sent,omitempty"`
	PacketsDiscarded      uint64        `json:"packets_discarded_on_send,omitempty"`
	RemotePacketsLost     int64         `json:"remote_packets_lost,omitempty"`
	RemoteJitter          float64       `json:"remote_jitter_seconds,omitempty"`
	TrackID               string        `json:"track_id,omitempty"`
	PlaybackPosition      time.Duration `json:"playback_position_ns,omitempty"`
	EncoderStarts         uint64        `json:"encoder_starts,omitempty"`
	EncoderError          string        `json:"encoder_error,omitempty"`
}

type JSONLRecorder struct {
	mu      sync.Mutex
	path    string
	maximum int64
}

func NewJSONLRecorder(path string, maximumBytes int64) *JSONLRecorder {
	if maximumBytes < 1024 {
		maximumBytes = 2 << 20
	}
	return &JSONLRecorder{path: path, maximum: maximumBytes}
}

func (r *JSONLRecorder) Record(event Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if event.At.IsZero() {
		event.At = time.Now().UTC()
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	if err = os.MkdirAll(filepath.Dir(r.path), 0o700); err != nil {
		return err
	}
	if info, statErr := os.Stat(r.path); statErr == nil && info.Size()+int64(len(encoded)) > r.maximum {
		_ = os.Remove(r.path + ".1")
		if err = os.Rename(r.path, r.path+".1"); err != nil {
			return fmt.Errorf("rotate media diagnostics: %w", err)
		}
	}
	file, err := os.OpenFile(r.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err = file.Chmod(0o600); err == nil {
		_, err = file.Write(encoded)
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	return closeErr
}
