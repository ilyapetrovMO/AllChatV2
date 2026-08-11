package bootstrap

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
)

var releaseBaseURL = "https://github.com/ilyapetrovMO/AllChatV2/releases/download"

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
	content, err := download(ctx, client, base+asset)
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
