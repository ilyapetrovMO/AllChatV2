package instance

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

func (i *Instance) diagnosticsAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		http.NotFound(w, r)
		return
	}
	status := map[string]any{"checked_at": time.Now().UTC(), "listener": map[string]any{"address": i.config.ListenAddress, "tls": i.config.TLSCertFile != "" || i.config.ACMEHost != ""}, "sfu": map[string]any{"status": "ready", "max_participants": i.config.MediaMaxParticipants, "port_min": i.config.MediaPortMin, "port_max": i.config.MediaPortMax}, "relay": map[string]any{"mode": relayMode(i.config)}, "metrics_enabled": i.config.MetricsEnabled, "migration": map[string]any{"supported_version": schemaVersion}}
	database := map[string]any{"status": "ready"}
	var version int
	if err := i.db.QueryRowContext(r.Context(), "SELECT COALESCE(MAX(version),0) FROM schema_migrations").Scan(&version); err != nil {
		database["status"] = "failed"
		database["error"] = "database unavailable"
	}
	database["schema_version"] = version
	status["database"] = database
	var fs syscall.Statfs_t
	storage := map[string]any{"status": "ready"}
	if err := syscall.Statfs(i.config.DataDir, &fs); err != nil {
		storage["status"] = "failed"
	} else {
		available := uint64(fs.Bavail) * uint64(fs.Bsize)
		storage["available_bytes"] = available
		storage["status"] = storageStatus(available)
	}
	status["storage"] = storage
	backups, _ := filepath.Glob(filepath.Join(i.config.DataDir, "backups", "*.tar.gz"))
	backup := map[string]any{"count": len(backups)}
	var newest time.Time
	for _, path := range backups {
		if info, err := os.Stat(path); err == nil && info.ModTime().After(newest) {
			newest = info.ModTime()
		}
	}
	if !newest.IsZero() {
		backup["latest_at"] = newest.UTC()
	}
	status["backup"] = backup
	writeJSON(w, 200, status)
}
func relayMode(c Config) string {
	if len(c.ExternalTURNURLs) > 0 {
		return "external"
	}
	if c.TURNPublicIP != "" {
		return "embedded"
	}
	return "disabled"
}
func storageStatus(available uint64) string {
	if available < 64<<20 {
		return "critical"
	}
	if available < 256<<20 {
		return "low"
	}
	return "ready"
}
func (i *Instance) metrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	var version int
	ready := 1
	if err := i.db.QueryRowContext(r.Context(), "SELECT COALESCE(MAX(version),0) FROM schema_migrations").Scan(&version); err != nil {
		ready = 0
	}
	var transactions, committed, queueHigh int64
	if i.community != nil {
		transactions, committed, queueHigh = i.community.MessagingMetrics()
	}
	fmt.Fprintf(w, "# HELP allchat_up Whether the Instance database is available.\n# TYPE allchat_up gauge\nallchat_up %d\n# HELP allchat_schema_version Current database schema version.\n# TYPE allchat_schema_version gauge\nallchat_schema_version %d\n# TYPE allchat_message_transactions_total counter\nallchat_message_transactions_total %d\n# TYPE allchat_messages_committed_total counter\nallchat_messages_committed_total %d\n# TYPE allchat_message_ingress_queue_high_water gauge\nallchat_message_ingress_queue_high_water %d\n", ready, version, transactions, committed, queueHigh)
}
