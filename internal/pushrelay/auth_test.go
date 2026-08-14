package pushrelay

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestVerifierMiddleware(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0)
	verifier := Verifier{Keys: map[string]ed25519.PublicKey{"instance": publicKey}, Now: func() time.Time { return now }}
	body := []byte(`{"platform":"android"}`)
	handler := verifier.Middleware(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	}))

	request := httptest.NewRequest(http.MethodPost, "/api/v1/push", bytes.NewReader(body))
	SignRequest(request, body, "instance", privateKey, now)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("signed request status = %d, want %d", response.Code, http.StatusNoContent)
	}

	tampered := httptest.NewRequest(http.MethodPost, "/api/v1/push", bytes.NewReader(append(body, ' ')))
	SignRequest(tampered, body, "instance", privateKey, now)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, tampered)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("tampered request status = %d, want %d", response.Code, http.StatusUnauthorized)
	}

	expired := httptest.NewRequest(http.MethodPost, "/api/v1/push", bytes.NewReader(body))
	SignRequest(expired, body, "instance", privateKey, now.Add(-6*time.Minute))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, expired)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expired request status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestParsePublicKeys(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(publicKey)
	keys, err := ParsePublicKeys("instance=" + encoded)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(keys["instance"], publicKey) {
		t.Fatal("parsed key differs")
	}
	if _, err := ParsePublicKeys("instance=bad"); err == nil {
		t.Fatal("invalid key accepted")
	}
}
