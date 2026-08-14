package instance

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestMetricsAreDisabledByDefaultAndContainNoContentLabels(t *testing.T) {
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	app := &Instance{db: db, config: Config{DataDir: directory}}
	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	response := httptest.NewRecorder()
	app.routes().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("disabled metrics status=%d", response.Code)
	}
	app.config.MetricsEnabled = true
	response = httptest.NewRecorder()
	app.routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("enabled metrics status=%d", response.Code)
	}
	body := response.Body.String()
	if !strings.Contains(body, "allchat_up 1") || strings.Contains(body, "member_id") || strings.Contains(body, "channel_id") {
		t.Fatalf("unsafe metrics: %s", body)
	}
}
func TestStorageHealthThresholds(t *testing.T) {
	if storageStatus(32<<20) != "critical" || storageStatus(128<<20) != "low" || storageStatus(512<<20) != "ready" {
		t.Fatal("unexpected storage thresholds")
	}
}

func TestDashboardStorageAndRuntimeMeasurements(t *testing.T) {
	directory := t.TempDir()
	database := filepath.Join(directory, "allchat.db")
	if err := os.WriteFile(database, make([]byte, 11), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(database+"-wal", make([]byte, 7), 0o600); err != nil {
		t.Fatal(err)
	}
	backupDirectory := filepath.Join(directory, "backups")
	if err := os.MkdirAll(backupDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backupDirectory, "one.tar.gz"), make([]byte, 13), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := fileFamilySize(database); got != 18 {
		t.Fatalf("database family size = %d, want 18", got)
	}
	if got := directorySize(backupDirectory); got != 13 {
		t.Fatalf("backup directory size = %d, want 13", got)
	}
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	if processMemoryBytes(memory) == 0 {
		t.Fatal("process memory measurement is zero")
	}
	if processCPUSeconds() < 0 {
		t.Fatal("process CPU measurement is negative")
	}
}
