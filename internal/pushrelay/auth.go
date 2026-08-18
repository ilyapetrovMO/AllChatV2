package pushrelay

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	HeaderKeyID     = "X-AllChat-Key-ID"
	HeaderTimestamp = "X-AllChat-Timestamp"
	HeaderSignature = "X-AllChat-Signature"
	maxRequestBytes = 8 << 10
)

type Verifier struct {
	Keys    map[string]ed25519.PublicKey
	MaxSkew time.Duration
	Now     func() time.Time
	Logger  *slog.Logger
}

func (v Verifier) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(response, request.Body, maxRequestBytes))
		if err != nil {
			writeError(response, http.StatusRequestEntityTooLarge, "request is too large")
			return
		}
		request.Body.Close()
		request.Body = io.NopCloser(bytes.NewReader(body))
		if err := v.Verify(request, body); err != nil {
			logger := v.Logger
			if logger == nil {
				logger = slog.Default()
			}
			attributes := []any{"reason", err.Error()}
			if requestID := request.Header.Get(HeaderRequestID); validRequestID(requestID) {
				attributes = append(attributes, "request_id", requestID)
			}
			logger.Warn("push request authorization rejected", attributes...)
			writeError(response, http.StatusUnauthorized, "invalid request signature")
			return
		}
		next.ServeHTTP(response, request)
	})
}

func (v Verifier) Verify(request *http.Request, body []byte) error {
	key := v.Keys[strings.TrimSpace(request.Header.Get(HeaderKeyID))]
	if len(key) != ed25519.PublicKeySize {
		return fmt.Errorf("unknown key")
	}
	timestampText := request.Header.Get(HeaderTimestamp)
	timestamp, err := strconv.ParseInt(timestampText, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid timestamp")
	}
	now := time.Now
	if v.Now != nil {
		now = v.Now
	}
	skew := v.MaxSkew
	if skew <= 0 {
		skew = 5 * time.Minute
	}
	delta := now().Sub(time.Unix(timestamp, 0))
	if delta < -skew || delta > skew {
		return fmt.Errorf("expired timestamp")
	}
	signature, err := base64.RawURLEncoding.DecodeString(request.Header.Get(HeaderSignature))
	if err != nil || !ed25519.Verify(key, canonicalRequest(request.Method, request.URL.Path, timestampText, body), signature) {
		return fmt.Errorf("invalid signature")
	}
	return nil
}

func SignRequest(request *http.Request, body []byte, keyID string, privateKey ed25519.PrivateKey, now time.Time) {
	timestamp := strconv.FormatInt(now.Unix(), 10)
	request.Header.Set(HeaderKeyID, keyID)
	request.Header.Set(HeaderTimestamp, timestamp)
	signature := ed25519.Sign(privateKey, canonicalRequest(request.Method, request.URL.Path, timestamp, body))
	request.Header.Set(HeaderSignature, base64.RawURLEncoding.EncodeToString(signature))
}

func canonicalRequest(method, path, timestamp string, body []byte) []byte {
	digest := sha256.Sum256(body)
	return []byte(strings.Join([]string{method, path, timestamp, hex.EncodeToString(digest[:])}, "\n"))
}
