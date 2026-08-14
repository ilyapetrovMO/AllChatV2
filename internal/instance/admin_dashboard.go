// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	runtimemetrics "runtime/metrics"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type dashboardStorageSource struct {
	Name  string `json:"name"`
	Bytes int64  `json:"bytes"`
}

type dashboardMessageBucket struct {
	At    time.Time `json:"at"`
	Count int64     `json:"count"`
}

func (i *Instance) adminDashboardPage(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	if !member.Owner {
		http.NotFound(response, request)
		return
	}
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = adminDashboardTemplate.Execute(response, nil)
}

func (i *Instance) adminDashboardAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	if !member.Owner {
		http.NotFound(response, request)
		return
	}
	now := time.Now().UTC()
	var members, messages, attachments int64
	if err := i.db.QueryRowContext(request.Context(), "SELECT COUNT(*) FROM members").Scan(&members); err != nil {
		writeCommunityError(response, err)
		return
	}
	if err := i.db.QueryRowContext(request.Context(), "SELECT COUNT(*) FROM messages").Scan(&messages); err != nil {
		writeCommunityError(response, err)
		return
	}
	if err := i.db.QueryRowContext(request.Context(), "SELECT COUNT(*) FROM attachments WHERE state = 'published'").Scan(&attachments); err != nil {
		writeCommunityError(response, err)
		return
	}
	presence, _ := i.live.snapshot()
	storage, disk := i.dashboardStorage(request)
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	startedAt := i.startedAt
	if startedAt.IsZero() {
		startedAt = now
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"checked_at":     now,
		"uptime_seconds": max(0, int64(now.Sub(startedAt).Seconds())),
		"health": map[string]any{
			"database": "ready",
			"storage":  storageStatus(uint64(max(0, disk["available_bytes"]))),
			"relay":    relayMode(i.config),
			"sfu":      "ready",
		},
		"counts": map[string]any{"members": members, "online_members": len(presence), "messages": messages, "attachments": attachments},
		"resources": map[string]any{
			"cpu_seconds": processCPUSeconds(), "cpu_cores": runtime.NumCPU(),
			"memory_bytes": processMemoryBytes(memory), "heap_bytes": memory.HeapAlloc,
			"disk_total_bytes": disk["total_bytes"], "disk_available_bytes": disk["available_bytes"],
			"app_storage_bytes": disk["app_storage_bytes"],
		},
		"storage_sources": storage,
		"message_rate":    i.dashboardMessageRate(request, now),
	})
}

func (i *Instance) dashboardStorage(request *http.Request) ([]dashboardStorageSource, map[string]int64) {
	queryInt := func(query string) int64 {
		var value int64
		_ = i.db.QueryRowContext(request.Context(), query).Scan(&value)
		return value
	}
	attachments := queryInt("SELECT COALESCE(SUM(size), 0) FROM attachments WHERE state != 'garbage'")
	soundboard := queryInt("SELECT COALESCE(SUM(size), 0) FROM soundboard_sounds")
	messages := queryInt("SELECT COALESCE(SUM(length(COALESCE(body,'')) + length(COALESCE(rendered_html,''))), 0) FROM messages")
	profiles := queryInt("SELECT COALESCE(SUM(length(COALESCE(avatar,'')) + length(COALESCE(banner,''))), 0) FROM members")
	database := fileFamilySize(filepath.Join(i.config.DataDir, "allchat.db"))
	backups := directorySize(filepath.Join(i.config.DataDir, "backups"))
	databaseOther := max(int64(0), database-messages-profiles)
	sources := []dashboardStorageSource{
		{Name: "Attachments", Bytes: attachments},
		{Name: "Soundboard", Bytes: soundboard},
		{Name: "Messages", Bytes: messages},
		{Name: "Profile media", Bytes: profiles},
		{Name: "Database and indexes", Bytes: databaseOther},
		{Name: "Backups", Bytes: backups},
	}
	appStorage := attachments + soundboard + database + backups
	var stat syscall.Statfs_t
	disk := map[string]int64{"app_storage_bytes": appStorage}
	if syscall.Statfs(i.config.DataDir, &stat) == nil {
		disk["total_bytes"] = int64(stat.Blocks) * int64(stat.Bsize)
		disk["available_bytes"] = int64(stat.Bavail) * int64(stat.Bsize)
	}
	return sources, disk
}

func (i *Instance) dashboardMessageRate(request *http.Request, now time.Time) map[string]any {
	const minutes = 30
	start := now.Truncate(time.Minute).Add(-(minutes - 1) * time.Minute)
	counts := make(map[string]int64, minutes)
	rows, err := i.db.QueryContext(request.Context(), `SELECT substr(created_at, 1, 16), COUNT(*) FROM messages
		WHERE created_at >= ? GROUP BY substr(created_at, 1, 16)`, start.Format("2006-01-02T15:04:05.000000000Z"))
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var minute string
			var count int64
			if rows.Scan(&minute, &count) == nil {
				counts[minute] = count
			}
		}
	}
	buckets := make([]dashboardMessageBucket, 0, minutes)
	for index := 0; index < minutes; index++ {
		at := start.Add(time.Duration(index) * time.Minute)
		buckets = append(buckets, dashboardMessageBucket{At: at, Count: counts[at.Format("2006-01-02T15:04")]})
	}
	var current int64
	_ = i.db.QueryRowContext(request.Context(), "SELECT COUNT(*) FROM messages WHERE created_at >= ?", now.Add(-time.Minute).Format("2006-01-02T15:04:05.000000000Z")).Scan(&current)
	return map[string]any{"messages_per_minute": current, "buckets": buckets}
}

func processCPUSeconds() float64 {
	samples := []runtimemetrics.Sample{{Name: "/cpu/classes/total:cpu-seconds"}, {Name: "/cpu/classes/idle:cpu-seconds"}}
	runtimemetrics.Read(samples)
	total, idle := samples[0].Value.Float64(), samples[1].Value.Float64()
	return max(0, total-idle)
}

func processMemoryBytes(memory runtime.MemStats) uint64 {
	if runtime.GOOS == "linux" {
		if value, err := os.ReadFile("/proc/self/statm"); err == nil {
			fields := strings.Fields(string(value))
			if len(fields) > 1 {
				if pages, parseErr := strconv.ParseUint(fields[1], 10, 64); parseErr == nil {
					return pages * uint64(os.Getpagesize())
				}
			}
		}
	}
	return memory.Sys
}

func fileFamilySize(path string) int64 {
	var total int64
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		if info, err := os.Stat(candidate); err == nil {
			total += info.Size()
		}
	}
	return total
}

func directorySize(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if info, infoErr := entry.Info(); infoErr == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}

var adminDashboardTemplate = template.Must(template.New("admin-dashboard").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard — AllChat</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script><script src="/assets/admin-dashboard.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Community Settings</div><nav class="channel-nav settings-nav"><a href="/admin/dashboard" aria-current="page">Dashboard</a><a href="/admin/settings">General</a><a href="/admin/channels">Channels</a><a href="/admin/roles">Roles</a><a href="/admin/invitations">Invitations</a><a href="/admin/soundboard">Soundboard</a></nav></aside><main class="content-shell"><header class="content-header"><h1>Admin Dashboard</h1></header><section class="content admin-dashboard" data-admin-dashboard><div class="dashboard-heading"><div><h2 class="page-title">Instance overview</h2><p class="page-description">Live health, capacity, storage, and Community activity.</p></div><span class="muted" data-dashboard-updated>Loading…</span></div><div class="dashboard-stat-grid" data-dashboard-stats></div><div class="dashboard-chart-grid"><section class="card dashboard-chart"><h3>Resource usage</h3><p class="muted">Process CPU and memory sampled while this dashboard is open.</p><div data-resource-chart></div></section><section class="card dashboard-chart"><h3>Messages sent</h3><p class="muted">Messages per minute over the last 30 minutes.</p><div data-message-chart></div></section></div><section class="card"><h3>Storage by source</h3><p class="muted">Message and profile values are logical payload sizes inside SQLite; database and index overhead is shown separately.</p><div class="dashboard-storage" data-dashboard-storage></div></section><section class="card dashboard-health"><h3>Subsystem health</h3><div data-dashboard-health></div></section><p class="notice notice-error" data-dashboard-error hidden></p></section></main></div></body></html>`))
