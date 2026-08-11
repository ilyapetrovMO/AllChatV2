// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package media

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestJSONLRecorderPersistsReconnectTimeline(t *testing.T) {
	path := filepath.Join(t.TempDir(), "reconnections.jsonl")
	recorder := NewJSONLRecorder(path, 1024)
	event := Event{At: time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC), Kind: "recovery_started", RoomID: "voice-example", Attempt: 2, Error: "media heartbeat timed out"}
	if err := recorder.Record(event); err != nil {
		t.Fatal(err)
	}
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var got Event
	if err = json.Unmarshal(encoded, &got); err != nil {
		t.Fatalf("invalid JSONL: %v", err)
	}
	if got.Kind != event.Kind || got.Attempt != 2 || got.Error != event.Error {
		t.Fatalf("event=%+v", got)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode=%o", info.Mode().Perm())
	}
}
