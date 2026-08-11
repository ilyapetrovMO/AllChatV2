// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package acceptance_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestNativeSessionAuthenticatesHTTPAndRealtimeWithoutCSRF(t *testing.T) {
	app := startInstance(t, t.TempDir())
	bootstrapOwner(t, newClient(t), app, "native-owner", "correct horse battery staple")

	loginBody, _ := json.Marshal(map[string]string{"username": "native-owner", "password": "correct horse battery staple"})
	loginRequest, _ := http.NewRequest(http.MethodPost, app.url("/api/v1/auth/native/login"), bytes.NewReader(loginBody))
	loginRequest.Header.Set("Content-Type", "application/json")
	loginRequest.Header.Set("X-AllChat-Device", "Example Android phone")
	loginResponse, err := (&http.Client{Timeout: 5 * time.Second}).Do(loginRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer loginResponse.Body.Close()
	if loginResponse.StatusCode != http.StatusOK {
		t.Fatalf("native login status = %d body=%s", loginResponse.StatusCode, readAll(t, loginResponse.Body))
	}
	if len(loginResponse.Cookies()) != 0 {
		t.Fatalf("native login unexpectedly set cookies: %#v", loginResponse.Cookies())
	}
	var session struct {
		SessionToken string         `json:"session_token"`
		SessionID    string         `json:"session_id"`
		ExpiresAt    string         `json:"expires_at"`
		Member       map[string]any `json:"member"`
	}
	if err := json.NewDecoder(loginResponse.Body).Decode(&session); err != nil {
		t.Fatal(err)
	}
	if session.SessionToken == "" || session.SessionID == "" || session.ExpiresAt == "" || session.Member["username"] != "native-owner" {
		t.Fatalf("native Session response = %+v", session)
	}

	profileBody, _ := json.Marshal(map[string]string{"username": "native-owner", "display_name": "Native Owner"})
	profileRequest, _ := http.NewRequest(http.MethodPatch, app.url("/api/v1/profile"), bytes.NewReader(profileBody))
	profileRequest.Header.Set("Content-Type", "application/json")
	profileRequest.Header.Set("Authorization", "Bearer "+session.SessionToken)
	profileResponse, err := (&http.Client{Timeout: 5 * time.Second}).Do(profileRequest)
	if err != nil {
		t.Fatal(err)
	}
	profileResponse.Body.Close()
	if profileResponse.StatusCode != http.StatusOK {
		t.Fatalf("bearer mutation status = %d", profileResponse.StatusCode)
	}

	bootstrapRequest, _ := http.NewRequest(http.MethodGet, app.url("/api/v1/mobile/bootstrap"), nil)
	bootstrapRequest.Header.Set("Authorization", "Bearer "+session.SessionToken)
	bootstrapResponse, err := (&http.Client{Timeout: 5 * time.Second}).Do(bootstrapRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer bootstrapResponse.Body.Close()
	var bootstrap struct {
		Version    int              `json:"version"`
		Member     map[string]any   `json:"member"`
		Categories []map[string]any `json:"categories"`
		Channels   []map[string]any `json:"channels"`
		Messages   map[string]any   `json:"messages"`
		Cursor     int64            `json:"cursor"`
	}
	if bootstrapResponse.StatusCode != http.StatusOK || json.NewDecoder(bootstrapResponse.Body).Decode(&bootstrap) != nil {
		t.Fatalf("native bootstrap status = %d", bootstrapResponse.StatusCode)
	}
	if bootstrap.Version != 1 || bootstrap.Member["display_name"] != "Native Owner" || bootstrap.Categories == nil || bootstrap.Channels == nil || bootstrap.Messages == nil || bootstrap.Cursor < 0 {
		t.Fatalf("native bootstrap = %+v", bootstrap)
	}

	realtimeURL := app.url("/api/v1/realtime")
	realtimeURL = "ws" + realtimeURL[len("http"):]
	connection, response, err := websocket.Dial(context.Background(), realtimeURL, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + session.SessionToken}}})
	if err != nil {
		status := 0
		if response != nil {
			status = response.StatusCode
		}
		t.Fatalf("native realtime dial: %v status=%d", err, status)
	}
	_, encoded, err := connection.Read(context.Background())
	connection.CloseNow()
	if err != nil {
		t.Fatal(err)
	}
	var ready struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(encoded, &ready) != nil || ready.Type != "ready" {
		t.Fatalf("native realtime first frame = %s", encoded)
	}

	logoutRequest, _ := http.NewRequest(http.MethodPost, app.url("/api/v1/auth/logout"), nil)
	logoutRequest.Header.Set("Authorization", "Bearer "+session.SessionToken)
	logoutResponse, err := (&http.Client{Timeout: 5 * time.Second}).Do(logoutRequest)
	if err != nil {
		t.Fatal(err)
	}
	logoutResponse.Body.Close()
	if logoutResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("native logout status = %d", logoutResponse.StatusCode)
	}

	sessionRequest, _ := http.NewRequest(http.MethodGet, app.url("/api/v1/session"), nil)
	sessionRequest.Header.Set("Authorization", "Bearer "+session.SessionToken)
	sessionResponse, err := (&http.Client{Timeout: 5 * time.Second}).Do(sessionRequest)
	if err != nil {
		t.Fatal(err)
	}
	sessionResponse.Body.Close()
	if sessionResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked native Session status = %d", sessionResponse.StatusCode)
	}
}
