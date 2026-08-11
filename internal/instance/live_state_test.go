// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"testing"
	"time"
)

func TestPresenceAggregatesDevicesAndAppliesFinalDisconnectGrace(t *testing.T) {
	state := newLiveState()
	state.connect("first", "member", "session-one")
	state.connect("second", "member", "session-two")
	state.activity("first", false)
	presence, _ := state.snapshot()
	if presence["member"] != "online" {
		t.Fatalf("one active device should make aggregate Presence online: %v", presence)
	}
	state.activity("second", false)
	presence, _ = state.snapshot()
	if presence["member"] != "idle" {
		t.Fatalf("all idle devices should make aggregate Presence idle: %v", presence)
	}
	state.disconnectSession("session-one")
	presence, _ = state.snapshot()
	if presence["member"] != "idle" {
		t.Fatalf("disconnecting one device flickered aggregate Presence: %v", presence)
	}
	state.disconnectSession("session-two")
	presence, _ = state.snapshot()
	if _, present := presence["member"]; !present {
		t.Fatal("final disconnect skipped the offline grace period")
	}
	time.Sleep(presenceOfflineGrace + 100*time.Millisecond)
	presence, _ = state.snapshot()
	if _, present := presence["member"]; present {
		t.Fatalf("Presence remained connected after final-disconnect grace: %v", presence)
	}
}

func TestTypingStateCarriesTheMemberDisplayName(t *testing.T) {
	state := newLiveState()
	if !state.setTyping("member-example", "Example Member", "channel-example") {
		t.Fatal("first typing update was rate limited")
	}
	_, typing := state.snapshot()
	if len(typing) != 1 || typing[0].MemberName != "Example Member" {
		t.Fatalf("typing=%+v", typing)
	}
}
