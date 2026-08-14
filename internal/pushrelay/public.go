package pushrelay

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"math"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type PublicGateConfig struct {
	GlobalRate, IPRate, TokenRate    float64
	GlobalBurst, IPBurst, TokenBurst int
	MaxIPs, MaxTokens                int
	IdleTTL                          time.Duration
	Now                              func() time.Time
}

// PublicGate permits zero-configuration Instance access while bounding abuse
// by source address and unguessable provider token. It stores no durable state.
type PublicGate struct {
	config PublicGateConfig
	global *tokenBuckets
	ips    *tokenBuckets
	tokens *tokenBuckets
}

func NewPublicGate(config PublicGateConfig) *PublicGate {
	if config.IPRate <= 0 {
		config.IPRate = 20
	}
	if config.GlobalRate <= 0 {
		config.GlobalRate = 500
	}
	if config.GlobalBurst < 1 {
		config.GlobalBurst = 1_000
	}
	if config.TokenRate <= 0 {
		config.TokenRate = 1
	}
	if config.IPBurst < 1 {
		config.IPBurst = 100
	}
	if config.TokenBurst < 1 {
		config.TokenBurst = 20
	}
	if config.MaxIPs < 1 {
		config.MaxIPs = 10_000
	}
	if config.MaxTokens < 1 {
		config.MaxTokens = 100_000
	}
	if config.IdleTTL <= 0 {
		config.IdleTTL = 10 * time.Minute
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	return &PublicGate{config: config, global: newTokenBuckets(config.GlobalRate, config.GlobalBurst, 1, config.IdleTTL), ips: newTokenBuckets(config.IPRate, config.IPBurst, config.MaxIPs, config.IdleTTL), tokens: newTokenBuckets(config.TokenRate, config.TokenBurst, config.MaxTokens, config.IdleTTL)}
}

func (gate *PublicGate) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(response, request.Body, maxRequestBytes))
		if err != nil {
			writeError(response, http.StatusRequestEntityTooLarge, "request is too large")
			return
		}
		_ = request.Body.Close()
		request.Body = io.NopCloser(bytes.NewReader(body))
		var target struct {
			Token string `json:"token"`
		}
		if json.Unmarshal(body, &target) != nil || len(target.Token) < 16 || len(target.Token) > 4096 {
			writeError(response, http.StatusBadRequest, "invalid push request")
			return
		}
		now := gate.config.Now()
		if !gate.global.allow("all", now) {
			response.Header().Set("Retry-After", "1")
			writeError(response, http.StatusTooManyRequests, "relay rate limit exceeded")
			return
		}
		if !gate.ips.allow(publicSourceIP(request), now) {
			response.Header().Set("Retry-After", "1")
			writeError(response, http.StatusTooManyRequests, "source rate limit exceeded")
			return
		}
		digest := sha256.Sum256([]byte(target.Token))
		if !gate.tokens.allow(hex.EncodeToString(digest[:]), now) {
			response.Header().Set("Retry-After", "1")
			writeError(response, http.StatusTooManyRequests, "device rate limit exceeded")
			return
		}
		next.ServeHTTP(response, request)
	})
}

func publicSourceIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil {
		host = request.RemoteAddr
	}
	ip := net.ParseIP(strings.TrimSpace(host))
	if ip != nil && ip.IsLoopback() {
		forwarded := strings.Split(request.Header.Get("X-Forwarded-For"), ",")
		if candidate := net.ParseIP(strings.TrimSpace(forwarded[len(forwarded)-1])); candidate != nil {
			ip = candidate
		}
	}
	if ip == nil {
		return "unknown"
	}
	return ip.String()
}

type bucketState struct {
	tokens        float64
	updated, seen time.Time
}
type tokenBuckets struct {
	mu             sync.Mutex
	items          map[string]bucketState
	rate           float64
	burst, maximum int
	idle           time.Duration
	operations     uint64
}

func newTokenBuckets(rate float64, burst, maximum int, idle time.Duration) *tokenBuckets {
	return &tokenBuckets{items: make(map[string]bucketState), rate: rate, burst: burst, maximum: maximum, idle: idle}
}

func (b *tokenBuckets) allow(key string, now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.operations++
	if b.operations%256 == 0 {
		for current, state := range b.items {
			if now.Sub(state.seen) > b.idle {
				delete(b.items, current)
			}
		}
	}
	state, exists := b.items[key]
	if !exists {
		if len(b.items) >= b.maximum {
			return false
		}
		state = bucketState{tokens: float64(b.burst), updated: now}
	}
	state.tokens = math.Min(float64(b.burst), state.tokens+now.Sub(state.updated).Seconds()*b.rate)
	state.updated, state.seen = now, now
	if state.tokens < 1 {
		b.items[key] = state
		return false
	}
	state.tokens--
	b.items[key] = state
	return true
}
