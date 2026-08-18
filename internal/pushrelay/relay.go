package pushrelay

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type PushJob struct {
	Platform   string `json:"platform"`
	Kind       string `json:"kind,omitempty"`
	Token      string `json:"token"`
	Payload    string `json:"payload"`
	CollapseID string `json:"collapse_id,omitempty"`
	RequestID  string `json:"-"`
}

type Sender interface {
	Send(context.Context, PushJob) error
}

type Relay struct {
	queue     chan PushJob
	sender    Sender
	logger    *slog.Logger
	workers   sync.WaitGroup
	queueMu   sync.RWMutex
	closed    bool
	accepted  atomic.Uint64
	delivered atomic.Uint64
	failed    atomic.Uint64
}

func New(sender Sender, logger *slog.Logger, workers, queueCapacity int) (*Relay, error) {
	if sender == nil || workers < 1 || queueCapacity < 1 {
		return nil, fmt.Errorf("sender, positive worker count, and positive queue capacity are required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	relay := &Relay{queue: make(chan PushJob, queueCapacity), sender: sender, logger: logger}
	for range workers {
		relay.workers.Add(1)
		go relay.work()
	}
	return relay, nil
}

type Middleware interface {
	Middleware(http.Handler) http.Handler
}

func (r *Relay) Handler(authorization Middleware) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("POST /api/v1/push", authorization.Middleware(http.HandlerFunc(r.push)))
	mux.HandleFunc("GET /healthz", r.health)
	return mux
}

func (r *Relay) Drain() {
	r.queueMu.Lock()
	if !r.closed {
		r.closed = true
		close(r.queue)
	}
	r.queueMu.Unlock()
	r.workers.Wait()
}

func (r *Relay) push(response http.ResponseWriter, request *http.Request) {
	if contentType := request.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		writeError(response, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		return
	}
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var job PushJob
	if err := decoder.Decode(&job); err != nil {
		writeError(response, http.StatusBadRequest, "invalid push request")
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeError(response, http.StatusBadRequest, "invalid push request")
		return
	}
	if err := validateJob(job); err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	job.RequestID = request.Header.Get(HeaderRequestID)
	if !validRequestID(job.RequestID) {
		job.RequestID = NewRequestID()
	}
	r.queueMu.RLock()
	if r.closed {
		r.queueMu.RUnlock()
		writeError(response, http.StatusServiceUnavailable, "push relay is shutting down")
		return
	}
	select {
	case r.queue <- job:
		r.accepted.Add(1)
		r.logger.Info("push request accepted", "request_id", job.RequestID, "platform", job.Platform, "kind", normalizedKind(job.Kind), "token_fingerprint", TokenFingerprint(job.Token), "queue_depth", len(r.queue))
		r.queueMu.RUnlock()
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusAccepted)
		_, _ = response.Write([]byte(`{"status":"accepted"}`))
	default:
		r.queueMu.RUnlock()
		writeError(response, http.StatusServiceUnavailable, "push queue is full")
	}
}

func validateJob(job PushJob) error {
	if job.Platform != "android" && job.Platform != "ios" {
		return fmt.Errorf("platform must be android or ios")
	}
	if job.Kind != "" && job.Kind != "message" && job.Kind != "call" {
		return fmt.Errorf("kind must be message or call")
	}
	if len(job.Token) < 16 || len(job.Token) > 4096 {
		return fmt.Errorf("invalid device token")
	}
	if len(job.Payload) < 1 || len(job.Payload) > 3072 {
		return fmt.Errorf("encrypted payload must be between 1 and 3072 bytes")
	}
	if len(job.CollapseID) > 64 {
		return fmt.Errorf("collapse_id exceeds 64 bytes")
	}
	return nil
}

func (r *Relay) work() {
	defer r.workers.Done()
	for job := range r.queue {
		started := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		err := r.sender.Send(ctx, job)
		cancel()
		if err != nil {
			r.failed.Add(1)
			r.logger.Error("push delivery failed", "request_id", job.RequestID, "platform", job.Platform, "kind", normalizedKind(job.Kind), "token_fingerprint", TokenFingerprint(job.Token), "duration_ms", time.Since(started).Milliseconds(), "reason", err.Error())
			continue
		}
		r.delivered.Add(1)
		r.logger.Info("push delivered", "request_id", job.RequestID, "platform", job.Platform, "kind", normalizedKind(job.Kind), "token_fingerprint", TokenFingerprint(job.Token), "duration_ms", time.Since(started).Milliseconds())
	}
}

func (r *Relay) health(response http.ResponseWriter, _ *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(response).Encode(map[string]any{
		"status": "ok", "queue_depth": len(r.queue), "queue_capacity": cap(r.queue),
		"accepted": r.accepted.Load(), "delivered": r.delivered.Load(), "failed": r.failed.Load(),
	})
}

func normalizedKind(kind string) string {
	if kind == "call" {
		return "call"
	}
	return "message"
}

func writeError(response http.ResponseWriter, status int, message string) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(map[string]string{"error": message})
}
