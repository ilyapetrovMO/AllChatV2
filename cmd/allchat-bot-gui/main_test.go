package main

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestLogBufferKeepsRecentLines(t *testing.T) {
	buffer := &logBuffer{}
	for index := 0; index < 100; index++ {
		fmt.Fprintf(buffer, "line-%03d\n", index)
	}
	output := buffer.String()
	if strings.Contains(output, "line-000") {
		t.Fatal("old log lines were not discarded")
	}
	if !strings.Contains(output, "line-099") {
		t.Fatal("newest log line is missing")
	}
}

func TestHTMXActionReturnsOnlyBotFragment(t *testing.T) {
	manager := &manager{bots: make(map[string]*botProcess), csrf: "test"}
	form := url.Values{"csrf": {"test"}}
	request := httptest.NewRequest(http.MethodPost, "/bots/missing/remove", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("HX-Request", "true")
	response := httptest.NewRecorder()
	manager.serve(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	if strings.Contains(response.Body.String(), "<!doctype html>") {
		t.Fatal("HTMX action returned the whole page")
	}
}

func TestPageUpdatesWithoutReloading(t *testing.T) {
	var rendered bytes.Buffer
	if err := page.Execute(&rendered, map[string]any{"CSRF": "test", "Bots": []botView{}}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(rendered.String(), "location.reload") {
		t.Fatal("status polling reloads the entire GUI")
	}
	if !strings.Contains(rendered.String(), `hx-get="/bots/fragment"`) {
		t.Fatal("bot status is not updated through an HTMX fragment")
	}
}

func TestBotUsernamesAreAutomaticAndSequential(t *testing.T) {
	manager := &manager{namePrefix: "bot-a1b2c3"}
	for index, want := range []string{"bot-a1b2c3", "bot-a1b2c3-1", "bot-a1b2c3-2"} {
		if got := manager.nextUsername(); got != want {
			t.Fatalf("username %d = %q, want %q", index, got, want)
		}
	}
}

func TestNewManagerUsesFreshBotNamespace(t *testing.T) {
	manager, err := newManager(".")
	if err != nil {
		t.Fatal(err)
	}
	defer manager.close()
	if !strings.HasPrefix(manager.nextUsername(), "bot-") {
		t.Fatalf("bot namespace = %q", manager.namePrefix)
	}
}

func TestPageOffersAutomaticPasswordsAndVoiceControls(t *testing.T) {
	var rendered bytes.Buffer
	bots := []botView{{ID: "voice-id", Capabilities: "voice · screen", Username: "bot", Status: "Running", Voice: true, Screen: true}}
	if err := page.Execute(&rendered, map[string]any{"CSRF": "test", "Bots": bots}); err != nil {
		t.Fatal(err)
	}
	output := rendered.String()
	for _, want := range []string{`name="auto_password" type="checkbox" checked`, `hx-post="/bots/voice-id/melody"`, `hx-post="/bots/voice-id/image"`} {
		if !strings.Contains(output, want) {
			t.Fatalf("page does not contain %q", want)
		}
	}
	if strings.Contains(output, `name="username"`) {
		t.Fatal("page still asks for a username")
	}
	if strings.Contains(output, `name="kind"`) {
		t.Fatal("page still exposes bot types")
	}
	for _, capability := range []string{`name="chat"`, `name="voice"`, `name="screen"`, `name="echo"`, `name="roleplay"`} {
		if !strings.Contains(output, capability) {
			t.Fatalf("page lacks capability toggle %s", capability)
		}
	}
}

func TestGeneratedDevelopmentPasswordIsStableAndValidLength(t *testing.T) {
	first := generatedPassword("bot3")
	if first != generatedPassword("bot3") {
		t.Fatal("generated password changed for the same development account")
	}
	if len(first) < 12 {
		t.Fatalf("generated password is only %d bytes", len(first))
	}
}
