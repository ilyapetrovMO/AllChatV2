package music

import (
	"context"
	"os"
	"path/filepath"
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
