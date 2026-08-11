// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package music

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type ProcessRunner interface {
	Output(context.Context, string, ...string) ([]byte, error)
}
type execRunner struct{}

func (execRunner) Output(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).Output()
}

type Resolver struct {
	dataDir, library string
	runner           ProcessRunner
	maximum          time.Duration
}

func NewResolver(dataDir string, runner ProcessRunner) *Resolver {
	if runner == nil {
		runner = execRunner{}
	}
	return &Resolver{dataDir: dataDir, library: filepath.Join(dataDir, "library"), runner: runner, maximum: 6 * time.Hour}
}
func (r *Resolver) SetMaximum(value time.Duration) {
	if value > 0 {
		r.maximum = value
	}
}

func (r *Resolver) Resolve(ctx context.Context, source, requester string) (Track, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		return Track{}, fmt.Errorf("provide a URL, search, local file, or test:tone")
	}
	if source == "test:tone" {
		return Track{ID: trackID(source), Title: "AllChat resilience test tone", Source: source, StreamURL: source, Duration: 10 * time.Minute, RequestedBy: requester}, nil
	}
	if strings.HasPrefix(source, "local:") {
		return r.resolveLocal(ctx, strings.TrimSpace(strings.TrimPrefix(source, "local:")), requester)
	}
	query := source
	if parsed, err := url.Parse(source); err != nil || parsed.Scheme == "" {
		query = "ytsearch1:" + source
	}
	encoded, err := r.runner.Output(ctx, "yt-dlp", "--cache-dir", filepath.Join(r.dataDir, "cache"), "--no-playlist", "--no-warnings", "--dump-single-json", "-f", "bestaudio", query)
	if err != nil {
		return Track{}, processError("resolve music source with yt-dlp", err)
	}
	var value struct {
		ID         string  `json:"id"`
		Title      string  `json:"title"`
		URL        string  `json:"url"`
		WebpageURL string  `json:"webpage_url"`
		Duration   float64 `json:"duration"`
	}
	if json.Unmarshal(encoded, &value) != nil || value.URL == "" {
		return Track{}, fmt.Errorf("yt-dlp returned no playable audio")
	}
	duration := time.Duration(value.Duration * float64(time.Second))
	if duration > r.maximum {
		return Track{}, fmt.Errorf("track exceeds maximum duration %s", r.maximum)
	}
	if value.Title == "" {
		value.Title = source
	}
	canonical := value.WebpageURL
	if canonical == "" {
		canonical = source
	}
	return Track{ID: value.ID, Title: value.Title, Source: canonical, StreamURL: value.URL, Duration: duration, RequestedBy: requester}, nil
}
func (r *Resolver) resolveLocal(ctx context.Context, relative, requester string) (Track, error) {
	if relative == "" || filepath.IsAbs(relative) {
		return Track{}, fmt.Errorf("local music path must be relative")
	}
	clean := filepath.Clean(relative)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return Track{}, fmt.Errorf("local music path escapes library")
	}
	path := filepath.Join(r.library, clean)
	absolute, err := filepath.Abs(path)
	if err != nil {
		return Track{}, err
	}
	library, err := filepath.Abs(r.library)
	if err != nil {
		return Track{}, err
	}
	if absolute != library && !strings.HasPrefix(absolute, library+string(filepath.Separator)) {
		return Track{}, fmt.Errorf("local music path escapes library")
	}
	info, err := os.Stat(absolute)
	if err != nil || info.IsDir() {
		return Track{}, fmt.Errorf("local track unavailable")
	}
	encoded, err := r.runner.Output(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", absolute)
	if err != nil {
		return Track{}, fmt.Errorf("inspect local track: %w", err)
	}
	var result struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	_ = json.Unmarshal(encoded, &result)
	seconds, _ := strconv.ParseFloat(result.Format.Duration, 64)
	duration := time.Duration(seconds * float64(time.Second))
	if duration > r.maximum {
		return Track{}, fmt.Errorf("track exceeds maximum duration %s", r.maximum)
	}
	return Track{ID: trackID(absolute), Title: filepath.Base(absolute), Source: "local:" + filepath.ToSlash(clean), StreamURL: absolute, Duration: duration, RequestedBy: requester}, nil
}
func (r *Resolver) Search(ctx context.Context, query string) ([]Track, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("provide a search query")
	}
	encoded, err := r.runner.Output(ctx, "yt-dlp", "--cache-dir", filepath.Join(r.dataDir, "cache"), "--flat-playlist", "--no-warnings", "--dump-single-json", "ytsearch5:"+query)
	if err != nil {
		return nil, processError("search with yt-dlp", err)
	}
	var value struct {
		Entries []struct {
			ID         string  `json:"id"`
			Title      string  `json:"title"`
			URL        string  `json:"url"`
			WebpageURL string  `json:"webpage_url"`
			Duration   float64 `json:"duration"`
		}
	}
	if json.Unmarshal(encoded, &value) != nil {
		return nil, fmt.Errorf("invalid yt-dlp search response")
	}
	result := make([]Track, 0, len(value.Entries))
	for _, entry := range value.Entries {
		source := entry.WebpageURL
		if source == "" {
			source = entry.URL
		}
		result = append(result, Track{ID: entry.ID, Title: entry.Title, Source: source, Duration: time.Duration(entry.Duration * float64(time.Second))})
	}
	return result, nil
}

func processError(operation string, err error) error {
	var exitError *exec.ExitError
	if !errors.As(err, &exitError) {
		return fmt.Errorf("%s: %w", operation, err)
	}
	detail := strings.Join(strings.Fields(string(exitError.Stderr)), " ")
	if detail == "" {
		return fmt.Errorf("%s: %w", operation, err)
	}
	const maximum = 500
	if len(detail) > maximum {
		detail = detail[:maximum] + "…"
	}
	return fmt.Errorf("%s: %w: %s", operation, err, detail)
}
func trackID(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:8])
}
