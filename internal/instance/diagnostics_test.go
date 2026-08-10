package instance

import (
	"net/http"
	"net/http/httptest"
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
