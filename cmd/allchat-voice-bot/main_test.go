package main

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/coder/websocket"
)

func TestFirstVoiceChannelUsesOverviewOrder(t *testing.T) {
	selected, ok := firstVoiceChannel([]channel{{ID: "text", Type: "text"}, {ID: "first", Name: "Lounge", Type: "voice"}, {ID: "second", Type: "voice"}})
	if !ok || selected.ID != "first" || selected.Name != "Lounge" {
		t.Fatalf("selected = %+v, %v", selected, ok)
	}
	if _, ok = firstVoiceChannel([]channel{{ID: "text", Type: "text"}}); ok {
		t.Fatal("selected Voice Channel from text-only overview")
	}
}

func TestDummyScreenFrameIsEmbeddedVP8Keyframe(t *testing.T) {
	frame, err := dummyScreenFrame()
	if err != nil {
		t.Fatal(err)
	}
	if len(frame) < 10 || frame[0]&1 != 0 {
		t.Fatalf("dummy frame is not a VP8 keyframe: %x", frame[:min(len(frame), 10)])
	}
	// A VP8 keyframe carries the 0x9d012a start code followed by width and height.
	if frame[3] != 0x9d || frame[4] != 0x01 || frame[5] != 0x2a {
		t.Fatalf("dummy frame has invalid VP8 start code: %x", frame[:10])
	}
}

func TestDummyScreenIsEnabledByDefaultAndCanBeDisabled(t *testing.T) {
	t.Setenv("ALLCHAT_VOICE_BOT_SCREEN", "")
	if !envEnabled("ALLCHAT_VOICE_BOT_SCREEN", true) {
		t.Fatal("dummy screen was disabled by default")
	}
	t.Setenv("ALLCHAT_VOICE_BOT_SCREEN", "off")
	if envEnabled("ALLCHAT_VOICE_BOT_SCREEN", true) {
		t.Fatal("dummy screen ignored explicit opt-out")
	}
}

func TestDialMediaSuccessfulUpgradeDoesNotPanic(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
	}))
	defer server.Close()
	baseURL, _ := url.Parse(server.URL)
	jar, _ := cookiejar.New(nil)
	bot := &echoBot{baseURL: baseURL, client: &http.Client{Jar: jar}}
	connection, err := bot.dialMedia(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	connection.CloseNow()
}
