package pushrelay

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPublicGateAcceptsUnsignedRequestsAndLimitsDeviceToken(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	gate := NewPublicGate(PublicGateConfig{IPRate: 100, IPBurst: 10, TokenRate: 1, TokenBurst: 1, Now: func() time.Time { return now }})
	handler := gate.Middleware(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) { response.WriteHeader(http.StatusNoContent) }))
	body := []byte(validPushJSON)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/push", bytes.NewReader(body))
	request.RemoteAddr = "198.51.100.20:1234"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("first status=%d", response.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/v1/push", bytes.NewReader(body))
	request.RemoteAddr = "198.51.100.21:1234"
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") != "1" {
		t.Fatalf("limited status=%d headers=%v", response.Code, response.Header())
	}

	now = now.Add(time.Second)
	request = httptest.NewRequest(http.MethodPost, "/api/v1/push", bytes.NewReader(body))
	request.RemoteAddr = "198.51.100.21:1234"
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("refilled status=%d", response.Code)
	}
}

func TestPublicGateUsesForwardedAddressOnlyFromLoopback(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/", nil)
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("X-Forwarded-For", "192.0.2.10, 198.51.100.25")
	if got := publicSourceIP(request); got != "198.51.100.25" {
		t.Fatalf("loopback proxy IP=%q", got)
	}
	request.RemoteAddr = "203.0.113.30:1234"
	if got := publicSourceIP(request); got != "203.0.113.30" {
		t.Fatalf("spoofed IP=%q", got)
	}
}

func TestPublicGateRejectsOversizedOrMissingTokens(t *testing.T) {
	gate := NewPublicGate(PublicGateConfig{})
	handler := gate.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("invalid request reached handler") }))
	for _, body := range [][]byte{[]byte(`{"platform":"android"}`), bytes.Repeat([]byte("x"), maxRequestBytes+1)} {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/push", bytes.NewReader(body))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code < 400 {
			t.Fatalf("body length %d status=%d", len(body), response.Code)
		}
	}
}
