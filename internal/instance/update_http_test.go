package instance

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"allchat/internal/buildinfo"
)

func TestVersionAPIReportsPublishedBuild(t *testing.T) {
	oldVersion, oldCommit := buildinfo.Version, buildinfo.Commit
	t.Cleanup(func() { buildinfo.Version, buildinfo.Commit = oldVersion, oldCommit })
	buildinfo.Version, buildinfo.Commit = "v1.2.3", "abc123"
	response := httptest.NewRecorder()
	(&Instance{}).versionAPI(response, httptest.NewRequest(http.MethodGet, "/api/v1/version", nil))
	var body struct {
		Version string `json:"version"`
		BuildID string `json:"build_id"`
		APK     bool   `json:"apk_available"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || body.Version != "v1.2.3" || body.BuildID != "v1.2.3:abc123" || !body.APK {
		t.Fatalf("unexpected response: status=%d body=%+v", response.Code, body)
	}
}

func TestDevelopmentBuildHasNoAPKUpdate(t *testing.T) {
	oldVersion := buildinfo.Version
	t.Cleanup(func() { buildinfo.Version = oldVersion })
	buildinfo.Version = "dev"
	response := httptest.NewRecorder()
	(&Instance{}).versionAPI(response, httptest.NewRequest(http.MethodGet, "/api/v1/version", nil))
	if response.Body.String() == "" || response.Body.String() == `{"apk_available":true}` {
		t.Fatal("development build advertised an APK")
	}
}
