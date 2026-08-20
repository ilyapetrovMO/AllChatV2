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
	return fmt.Sprintf("AllChat-server-%s-linux-%s", strings.TrimPrefix(version, "v"), arch)
}

func RelayAsset(version, arch string) string {
	return fmt.Sprintf("AllChat-server-push-relay-%s-linux-%s", strings.TrimPrefix(version, "v"), arch)
}

func AndroidAsset(version string) string {
	return fmt.Sprintf("AllChat-mobile-%s-android-universal.apk", strings.TrimPrefix(version, "v"))
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
	return downloadLatestVerified(ctx, client, version, arch,
		[]string{`AllChat-server-[0-9]+\.[0-9]+\.[0-9]+-linux-`, `allchat_[0-9]+\.[0-9]+\.[0-9]+_linux_`},
		func(version, arch string) []string {
			return []string{InstanceAsset(version, arch), legacyInstanceAsset(version, arch)}
		})
}

func DownloadRelayVerified(ctx context.Context, client *http.Client, version, arch string) (string, []byte, error) {
	return downloadLatestVerified(ctx, client, version, arch,
		[]string{`AllChat-server-push-relay-[0-9]+\.[0-9]+\.[0-9]+-linux-`, `allchat-push-relay_[0-9]+\.[0-9]+\.[0-9]+_linux_`},
		func(version, arch string) []string {
			return []string{RelayAsset(version, arch), legacyRelayAsset(version, arch)}
		})
}

func downloadLatestVerified(ctx context.Context, client *http.Client, version, arch string, prefixes []string, assetNames func(string, string) []string) (string, []byte, error) {
	if client == nil {
		client = http.DefaultClient
	}
	if strings.TrimSpace(version) != "" {
		base := releaseBaseURL + "/" + version + "/"
		checksums, err := download(ctx, client, base+"SHA256SUMS")
		if err != nil {
			return "", nil, fmt.Errorf("download release checksums: %w", err)
		}
		for _, asset := range assetNames(version, arch) {
			if checksumForAsset(checksums, asset) != "" {
				content, err := verifyDownload(ctx, client, base, checksums, asset)
				return asset, content, err
			}
		}
		return "", nil, fmt.Errorf("release %s has no server binary for %s", version, arch)
	}
	checksums, err := download(ctx, client, latestReleaseBaseURL+"/SHA256SUMS")
	if err != nil {
		return "", nil, fmt.Errorf("download latest release checksums: %w", err)
	}
	patterns := make([]*regexp.Regexp, 0, len(prefixes))
	for _, prefix := range prefixes {
		patterns = append(patterns, regexp.MustCompile(`^`+prefix+regexp.QuoteMeta(arch)+`$`))
	}
	asset := ""
	scanner := bufio.NewScanner(strings.NewReader(string(checksums)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 2 {
			for _, pattern := range patterns {
				if pattern.MatchString(checksumAsset(fields[1])) {
					asset = checksumAsset(fields[1])
					break
				}
			}
			if asset != "" {
				break
			}
		}
	}
	if asset == "" {
		return "", nil, fmt.Errorf("latest release has no server binary for %s", arch)
	}
	content, err := verifyDownload(ctx, client, latestReleaseBaseURL, checksums, asset)
	return asset, content, err
}

func verifyDownload(ctx context.Context, client *http.Client, base string, checksums []byte, asset string) ([]byte, error) {
	want := checksumForAsset(checksums, asset)
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

func checksumForAsset(checksums []byte, asset string) string {
	scanner := bufio.NewScanner(strings.NewReader(string(checksums)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 2 && checksumAsset(fields[1]) == asset {
			return fields[0]
		}
	}
	return ""
}

func legacyInstanceAsset(version, arch string) string {
	return fmt.Sprintf("allchat_%s_linux_%s", strings.TrimPrefix(version, "v"), arch)
}

func legacyRelayAsset(version, arch string) string {
	return fmt.Sprintf("allchat-push-relay_%s_linux_%s", strings.TrimPrefix(version, "v"), arch)
}

func checksumAsset(field string) string {
	return strings.TrimPrefix(strings.TrimPrefix(field, "*"), "./")
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
