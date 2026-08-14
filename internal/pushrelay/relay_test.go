package pushrelay

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

type blockingSender struct {
	started chan struct{}
	release chan struct{}
	count   atomic.Int32
}

func (sender *blockingSender) Send(context.Context, PushJob) error {
	sender.count.Add(1)
	select {
	case sender.started <- struct{}{}:
	default:
	}
	<-sender.release
	return nil
}

func TestRelayReturnsAcceptedAndBackpressure(t *testing.T) {
	publicKey, privateKey, _ := ed25519.GenerateKey(nil)
	sender := &blockingSender{started: make(chan struct{}, 1), release: make(chan struct{})}
	relay, err := New(sender, slog.New(slog.NewTextHandler(io.Discard, nil)), 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	handler := relay.Handler(Verifier{Keys: map[string]ed25519.PublicKey{"test": publicKey}})

	if status := sendSignedPush(handler, privateKey); status != http.StatusAccepted {
		t.Fatalf("first status = %d", status)
	}
	select {
	case <-sender.started:
	case <-time.After(time.Second):
		t.Fatal("worker did not start")
	}
	if status := sendSignedPush(handler, privateKey); status != http.StatusAccepted {
		t.Fatalf("second status = %d", status)
	}
	if status := sendSignedPush(handler, privateKey); status != http.StatusServiceUnavailable {
		t.Fatalf("full queue status = %d, want 503", status)
	}

	close(sender.release)
	relay.Drain()
	if sender.count.Load() != 2 {
		t.Fatalf("delivery count = %d, want 2", sender.count.Load())
	}
}

func TestRelayRejectsUnsignedAndTrailingJSON(t *testing.T) {
	publicKey, privateKey, _ := ed25519.GenerateKey(nil)
	sender := &blockingSender{started: make(chan struct{}, 1), release: make(chan struct{})}
	relay, _ := New(sender, nil, 1, 1)
	handler := relay.Handler(Verifier{Keys: map[string]ed25519.PublicKey{"test": publicKey}})

	body := []byte(validPushJSON)
	unsigned := httptest.NewRequest(http.MethodPost, "/api/v1/push", bytes.NewReader(body))
	unsigned.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, unsigned)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned status = %d", response.Code)
	}

	body = append(body, []byte(` {}`)...)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/push", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	SignRequest(request, body, "test", privateKey, time.Now())
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("trailing JSON status = %d", response.Code)
	}

	close(sender.release)
	relay.Drain()
}

const validPushJSON = `{"platform":"android","token":"0123456789abcdef","payload":"ciphertext"}`

func sendSignedPush(handler http.Handler, privateKey ed25519.PrivateKey) int {
	body := []byte(validPushJSON)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/push", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	SignRequest(request, body, "test", privateKey, time.Now())
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response.Code
}
