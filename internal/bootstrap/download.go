package bootstrap

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
)

var releaseBaseURL = "https://github.com/ilyapetrovMO/AllChatV2/releases/download"
var latestReleaseBaseURL = "https://github.com/ilyapetrovMO/AllChatV2/releases/latest/download"

func InstanceAsset(version, arch string) string {
	return fmt.Sprintf("allchat_%s_linux_%s", strings.TrimPrefix(version, "v"), arch)
}

func DownloadVerified(ctx context.Context, client *http.Client, version, asset string) ([]byte, error) {
	if client == nil {
		client = http.DefaultClient
	}
	base := releaseBaseURL + "/" + version + "/"
	checksums, err := download(ctx, client, base+"SHA256SUMS")
	if err != nil {
		return nil, fmt.Errorf("download release checksums: %w", err)
	}
	return verifyDownload(ctx, client, base, checksums, asset)
}

// DownloadInstanceVerified downloads the requested server build. An empty
// version selects the newest published release and discovers its versioned
// asset name from the signed checksum manifest.
func DownloadInstanceVerified(ctx context.Context, client *http.Client, version, arch string) (string, []byte, error) {
	if client == nil {
		client = http.DefaultClient
	}
	if strings.TrimSpace(version) != "" {
		asset := InstanceAsset(version, arch)
		content, err := DownloadVerified(ctx, client, version, asset)
		return asset, content, err
	}
	checksums, err := download(ctx, client, latestReleaseBaseURL+"/SHA256SUMS")
	if err != nil {
		return "", nil, fmt.Errorf("download latest release checksums: %w", err)
	}
	pattern := regexp.MustCompile(`^allchat_[0-9]+\.[0-9]+\.[0-9]+_linux_` + regexp.QuoteMeta(arch) + `$`)
	asset := ""
	scanner := bufio.NewScanner(strings.NewReader(string(checksums)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 2 && pattern.MatchString(strings.TrimPrefix(fields[1], "*")) {
			asset = strings.TrimPrefix(fields[1], "*")
			break
		}
	}
	if asset == "" {
		return "", nil, fmt.Errorf("latest release has no server binary for %s", arch)
	}
	content, err := verifyDownload(ctx, client, latestReleaseBaseURL, checksums, asset)
	return asset, content, err
}

func verifyDownload(ctx context.Context, client *http.Client, base string, checksums []byte, asset string) ([]byte, error) {
	want := ""
	scanner := bufio.NewScanner(strings.NewReader(string(checksums)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == asset {
			want = fields[0]
			break
		}
	}
	if len(want) != sha256.Size*2 {
		return nil, fmt.Errorf("release checksum for %s is missing", asset)
	}
	content, err := download(ctx, client, strings.TrimSuffix(base, "/")+"/"+asset)
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", asset, err)
	}
	digest := sha256.Sum256(content)
	if !strings.EqualFold(hex.EncodeToString(digest[:]), want) {
		return nil, fmt.Errorf("checksum mismatch for %s", asset)
	}
	return content, nil
}

func download(ctx context.Context, client *http.Client, location string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, location, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %s", response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, 256<<20))
}
