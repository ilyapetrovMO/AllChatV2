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
