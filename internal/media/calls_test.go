package media

import (
	"errors"
	"testing"
	"time"
)

func TestDirectCallRequiresConsentAndEnforcesBusyState(t *testing.T) {
	manager := NewManager(time.Second)
	defer manager.Close()
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }
	call, err := manager.StartDirectCall("dm", "caller", "recipient")
	if err != nil {
		t.Fatal(err)
	}
	if manager.CanJoinDirectCall(call.ID, "caller") {
		t.Fatal("caller could join before consent")
	}
	if current, found := manager.CurrentDirectCall("recipient"); !found || current.ID != call.ID || current.State != "ringing" {
		t.Fatalf("current call = %+v, %v", current, found)
	}
	if _, err = manager.StartDirectCall("other", "caller", "third"); !errors.Is(err, ErrBusy) {
		t.Fatalf("busy error = %v", err)
	}
	if _, err = manager.AcceptDirectCall(call.ID, "caller"); !errors.Is(err, ErrCallState) {
		t.Fatalf("caller accepted own call: %v", err)
	}
	accepted, err := manager.AcceptDirectCall(call.ID, "recipient")
	if err != nil || accepted.State != "accepted" {
		t.Fatalf("accept = %+v, %v", accepted, err)
	}
	acceptedAgain, err := manager.AcceptDirectCall(call.ID, "recipient")
	if err != nil || acceptedAgain.State != "accepted" {
		t.Fatalf("repeated accept = %+v, %v", acceptedAgain, err)
	}
	if !manager.CanJoinDirectCall(call.ID, "caller") || !manager.CanJoinDirectCall(call.ID, "recipient") || manager.CanJoinDirectCall(call.ID, "third") {
		t.Fatal("accepted call participant authorization incorrect")
	}
}

func TestDirectCallRingingExpires(t *testing.T) {
	manager := NewManager(time.Second)
	defer manager.Close()
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }
	call, err := manager.StartDirectCall("dm", "caller", "recipient")
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(31 * time.Second)
	missed, found := manager.DirectCallForMember("dm", "recipient")
	if !found || missed.State != "missed" || missed.FinishedAt == "" {
		t.Fatalf("missed call event = %+v, %v", missed, found)
	}
	if _, err = manager.AcceptDirectCall(call.ID, "recipient"); !errors.Is(err, ErrCallState) {
		t.Fatalf("expired accept error = %v", err)
	}
}

func TestPolicyChangeEndsCallAndReleasesBusyState(t *testing.T) {
	manager := NewManager(time.Second)
	defer manager.Close()
	call, err := manager.StartDirectCall("dm", "caller", "recipient")
	if err != nil {
		t.Fatal(err)
	}
	if ended := manager.EndCallsForMember("recipient", "blocked"); len(ended) != 1 || ended[0].State != "blocked" {
		t.Fatalf("ended = %+v", ended)
	}
	if manager.CanJoinDirectCall(call.ID, "caller") {
		t.Fatal("blocked call remained joinable")
	}
	if _, err := manager.StartDirectCall("dm-2", "caller", "other"); err != nil {
		t.Fatalf("terminal call retained busy state: %v", err)
	}
}
