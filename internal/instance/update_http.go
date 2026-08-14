package instance

import (
	"net/http"
	"regexp"
	"strconv"

	"allchat/internal/bootstrap"
	"allchat/internal/buildinfo"
)

var releaseVersion = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+$`)

func (i *Instance) versionAPI(response http.ResponseWriter, _ *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	writeJSON(response, http.StatusOK, map[string]any{
		"version":       buildinfo.Version,
		"build_id":      buildinfo.Version + ":" + buildinfo.Commit,
		"apk_available": releaseVersion.MatchString(buildinfo.Version),
	})
}

func (i *Instance) androidUpdateAPI(response http.ResponseWriter, request *http.Request) {
	if _, _, ok := i.authenticated(response, request); !ok {
		return
	}
	if !releaseVersion.MatchString(buildinfo.Version) {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "This Instance is not running a published release."})
		return
	}
	asset := bootstrap.AndroidAsset(buildinfo.Version)
	content, err := bootstrap.DownloadVerified(request.Context(), nil, buildinfo.Version, asset)
	if err != nil {
		i.logger.Error("download Android update", "version", buildinfo.Version, "error", err)
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "The Android update is temporarily unavailable."})
		return
	}
	response.Header().Set("Cache-Control", "private, no-store")
	response.Header().Set("Content-Disposition", `attachment; filename="`+asset+`"`)
	response.Header().Set("Content-Type", "application/vnd.android.package-archive")
	response.Header().Set("Content-Length", strconv.Itoa(len(content)))
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(content)
}
