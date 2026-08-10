package media

import (
	"errors"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

func TestManagerEnforcesOneSessionAndBoundedResume(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	manager := NewManager(10 * time.Second)
	manager.now = func() time.Time { return now }
	joined, err := manager.Join("member-a", "voice-one")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Join("member-a", "voice-two"); !errors.Is(err, ErrAlreadyActive) {
		t.Fatalf("second join error = %v", err)
	}
	manager.Disconnect("member-a")
	if got := manager.Participants("voice-one"); len(got) != 1 || got[0].Connected {
		t.Fatalf("participants after disconnect = %+v", got)
	}
	if _, err := manager.Resume("member-a", "voice-one", joined.ResumeToken); err != nil {
		t.Fatal(err)
	}
	manager.Disconnect("member-a")
	now = now.Add(11 * time.Second)
	if _, err := manager.Resume("member-a", "voice-one", joined.ResumeToken); !errors.Is(err, ErrInvalidResume) {
		t.Fatalf("expired resume error = %v", err)
	}
	if got := manager.Participants("voice-one"); len(got) != 0 {
		t.Fatalf("expired participants = %+v", got)
	}
}

func TestManagerNeverHidesParticipantsAndRestartClearsSessions(t *testing.T) {
	manager := NewManager(time.Second)
	if _, err := manager.Join("one", "room"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Join("two", "room"); err != nil {
		t.Fatal(err)
	}
	if got := manager.Participants("room"); len(got) != 2 {
		t.Fatalf("participants = %+v", got)
	}
	manager.Close()
	if got := manager.Participants("room"); len(got) != 0 {
		t.Fatalf("participants after restart = %+v", got)
	}
}

func TestManagerEnforcesRoomCapacityAndModeratedRejoin(t *testing.T) {
	manager, err := NewManagerWithLimits(time.Second, 50000, 50031, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	if _, err = manager.Join("one", "room"); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Join("two", "room"); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Join("three", "room"); !errors.Is(err, ErrRoomFull) {
		t.Fatalf("third join error = %v", err)
	}
	if err = manager.DisconnectMember("room", "one"); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Join("one", "room"); !errors.Is(err, ErrModerated) {
		t.Fatalf("moderated immediate rejoin error = %v", err)
	}
}

func TestScreenVisibilitySignalsAdaptiveLayerChoice(t *testing.T) {
	manager := NewManager(time.Second)
	defer manager.Close()
	if _, err := manager.Join("sharer", "room"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Join("viewer", "room"); err != nil {
		t.Fatal(err)
	}
	signals := make(chan Signal, 2)
	manager.mu.Lock()
	manager.screenTracks["room"] = map[string]*webrtc.TrackLocalStaticRTP{"sharer": nil}
	manager.peers["sharer"] = &Peer{memberID: "sharer", roomID: "room", signal: func(signal Signal) { signals <- signal }}
	manager.mu.Unlock()
	if err := manager.SetScreenVisible("viewer", false); err != nil {
		t.Fatal(err)
	}
	if signal := <-signals; signal.Type != "screen-low" {
		t.Fatalf("hidden viewer signal = %q", signal.Type)
	}
	if err := manager.SetScreenVisible("viewer", true); err != nil {
		t.Fatal(err)
	}
	if signal := <-signals; signal.Type != "screen-high" {
		t.Fatalf("visible viewer signal = %q", signal.Type)
	}
	manager.mu.Lock()
	delete(manager.peers, "sharer") // synthetic Peer has no connection to close
	manager.mu.Unlock()
}

func TestSpeakingStateClearsAfterAudioStops(t *testing.T) {
	manager := NewManager(time.Second)
	defer manager.Close()
	if _, err := manager.Join("speaker", "room"); err != nil {
		t.Fatal(err)
	}
	manager.MarkSpeaking("speaker")
	if participants := manager.Participants("room"); len(participants) != 1 || !participants[0].Speaking {
		t.Fatalf("speaking participants = %+v", participants)
	}
	time.Sleep(750 * time.Millisecond)
	if participants := manager.Participants("room"); len(participants) != 1 || participants[0].Speaking {
		t.Fatalf("speaking state did not clear = %+v", participants)
	}
}

func TestSpeakingStateStillDecaysAfterServerMuteCheck(t *testing.T) {
	manager := NewManager(time.Second)
	defer manager.Close()
	if _, err := manager.Join("speaker", "room"); err != nil {
		t.Fatal(err)
	}
	manager.MarkSpeaking("speaker")
	if manager.IsServerMuted("speaker") {
		t.Fatal("speaker unexpectedly server muted")
	}
	time.Sleep(750 * time.Millisecond)
	if participant := manager.Participants("room")[0]; participant.Speaking {
		t.Fatalf("speaking state survived the final RTP packet: %+v", participant)
	}
}

func TestAudioLevelRejectsQuietBackgroundEvenWithVADBit(t *testing.T) {
	if audioLevelIndicatesSpeech(0x80 | 80) {
		t.Fatal("quiet background level was classified as speech")
	}
	if !audioLevelIndicatesSpeech(20) {
		t.Fatal("loud audio level was not classified as speech")
	}
}

func TestMutedParticipantCannotRemainSpeaking(t *testing.T) {
	manager := NewManager(time.Second)
	defer manager.Close()
	if _, err := manager.Join("speaker", "room"); err != nil {
		t.Fatal(err)
	}
	manager.MarkSpeaking("speaker")
	if err := manager.SetClientMuted("speaker", true); err != nil {
		t.Fatal(err)
	}
	manager.MarkSpeaking("speaker")
	participant := manager.Participants("room")[0]
	if participant.Speaking || !participant.Muted {
		t.Fatalf("muted participant = %+v", participant)
	}
}

func TestParticipantsRemainInJoinOrder(t *testing.T) {
	manager := NewManager(time.Second)
	defer manager.Close()
	for _, memberID := range []string{"first", "second", "third"} {
		if _, err := manager.Join(memberID, "room"); err != nil {
			t.Fatal(err)
		}
		time.Sleep(time.Millisecond)
	}
	for attempt := 0; attempt < 100; attempt++ {
		participants := manager.Participants("room")
		if len(participants) != 3 || participants[0].MemberID != "first" || participants[1].MemberID != "second" || participants[2].MemberID != "third" {
			t.Fatalf("participant order changed: %+v", participants)
		}
	}
}
