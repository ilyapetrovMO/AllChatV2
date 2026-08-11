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

func TestPresenceDistinguishesMobileActiveIdleAndDesktopActive(t *testing.T) {
	state := newLiveState()
	state.connect("phone", "member", "phone-session", true)
	presence, _ := state.snapshot()
	if presence["member"] != "mobile" {
		t.Fatalf("mobile Presence=%q", presence["member"])
	}
	state.mu.Lock()
	phone := state.connections["phone"]
	phone.ActiveAt = time.Now().Add(-presenceIdleAfter)
	state.connections["phone"] = phone
	state.mu.Unlock()
	presence, _ = state.snapshot()
	if presence["member"] != "idle" {
		t.Fatalf("AFK Presence=%q", presence["member"])
	}
	state.connect("desktop", "member", "desktop-session")
	presence, _ = state.snapshot()
	if presence["member"] != "online" {
		t.Fatalf("desktop should win aggregate Presence: %v", presence)
	}
}

func TestMobileUserAgentDetection(t *testing.T) {
	for _, userAgent := range []string{"ExampleBrowser/1.0 (Android 15; Mobile)", "ExampleBrowser/1.0 (iPhone; CPU iPhone OS 18_0)"} {
		if !isMobileUserAgent(userAgent) {
			t.Fatalf("mobile user agent was not detected: %q", userAgent)
		}
	}
	if isMobileUserAgent("ExampleBrowser/1.0 (Desktop Linux)") {
		t.Fatal("desktop user agent was detected as mobile")
	}
}
