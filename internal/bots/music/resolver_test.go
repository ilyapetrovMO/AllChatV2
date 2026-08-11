package music

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolverConfinesLocalTracksToMusicLibrary(t *testing.T) {
	directory := t.TempDir()
	library := filepath.Join(directory, "library")
	if err := os.MkdirAll(library, 0o700); err != nil {
		t.Fatal(err)
	}
	trackPath := filepath.Join(library, "example.ogg")
	if err := os.WriteFile(trackPath, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	resolver := NewResolver(directory, fakeRunner{output: []byte(`{"format":{"duration":"12.5"}}`)})
	track, err := resolver.Resolve(context.Background(), "local:example.ogg", "member-one")
	if err != nil || track.StreamURL != trackPath || track.Title != "example.ogg" {
		t.Fatalf("track=%+v err=%v", track, err)
	}
	for _, source := range []string{"local:../outside.ogg", "local:/etc/passwd"} {
		if _, err = resolver.Resolve(context.Background(), source, "member-one"); err == nil {
			t.Fatalf("unsafe source %q accepted", source)
		}
	}
}

type fakeRunner struct {
	output []byte
	err    error
}

func (r fakeRunner) Output(context.Context, string, ...string) ([]byte, error) {
	return r.output, r.err
}

func TestResolverReportsYTDLPFailureDetails(t *testing.T) {
	failure := &exec.ExitError{Stderr: []byte("ERROR: media source is unavailable")}
	resolver := NewResolver(t.TempDir(), fakeRunner{err: failure})
	_, err := resolver.Resolve(context.Background(), "https://media.example/watch?v=sample", "member-one")
	if err == nil || !strings.Contains(err.Error(), "media source is unavailable") {
		t.Fatalf("error = %v; want actionable yt-dlp stderr", err)
	}
	var exitError *exec.ExitError
	if !errors.As(err, &exitError) {
		t.Fatalf("error should retain exit status: %v", err)
	}
}
