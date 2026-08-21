package activities

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func activityTestService(t *testing.T) (*Service, context.Context) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+t.Name()+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.Exec(`
		PRAGMA foreign_keys=ON;
		CREATE TABLE members(id TEXT PRIMARY KEY,username TEXT NOT NULL,display_name TEXT);
		INSERT INTO members VALUES('owner','owner','Board Owner'),('other','other','Other Member');
		CREATE TABLE activity_installations(activity_id TEXT PRIMARY KEY,version TEXT NOT NULL,manifest TEXT NOT NULL,enabled INTEGER NOT NULL,installed_at TEXT NOT NULL,updated_at TEXT NOT NULL);
		INSERT INTO activity_installations VALUES('allchat.sketchboard','1.0.0','{}',1,'now','now');
		CREATE TABLE activity_sessions(id TEXT PRIMARY KEY,token_hash BLOB NOT NULL UNIQUE,activity_id TEXT NOT NULL REFERENCES activity_installations(activity_id),member_id TEXT NOT NULL REFERENCES members(id),resource_id TEXT,created_at TEXT NOT NULL,expires_at TEXT NOT NULL);
		CREATE TABLE sketchboards(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES members(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,snapshot BLOB NOT NULL,next_sequence INTEGER NOT NULL);
		CREATE TABLE sketchboard_operations(board_id TEXT NOT NULL REFERENCES sketchboards(id),sequence INTEGER NOT NULL,member_id TEXT NOT NULL REFERENCES members(id),kind TEXT NOT NULL,payload BLOB NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(board_id,sequence));
	`)
	if err != nil {
		t.Fatal(err)
	}
	service := New(db)
	service.now = func() time.Time { return time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC) }
	return service, context.Background()
}

func TestSketchboardOwnershipSessionsAndOrderedOperations(t *testing.T) {
	service, ctx := activityTestService(t)
	board, err := service.CreateBoard(ctx, "owner", "Launch plan")
	if err != nil {
		t.Fatal(err)
	}
	if !board.CanDelete || board.OwnerName != "Board Owner" {
		t.Fatalf("board=%+v", board)
	}
	if err := service.DeleteBoard(ctx, "other", board.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-owner delete=%v", err)
	}
	token, session, err := service.Launch(ctx, SketchboardID, "other", "Other Member", board.ID)
	if err != nil {
		t.Fatal(err)
	}
	authenticated, err := service.Authenticate(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if authenticated.MemberID != "other" || authenticated.ResourceID != board.ID || session.ActivityID != SketchboardID {
		t.Fatalf("session=%+v authenticated=%+v", session, authenticated)
	}
	first, err := service.AppendOperation(ctx, "owner", board.ID, "stroke", json.RawMessage(`{"points":[[1,2],[3,4]]}`))
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.AppendOperation(ctx, "other", board.ID, "clear", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if first.Sequence != 1 || second.Sequence != 2 {
		t.Fatalf("sequences=%d,%d", first.Sequence, second.Sequence)
	}
	state, err := service.BoardState(ctx, "other", board.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Operations) != 1 || state.Operations[0].Sequence != 2 {
		t.Fatalf("state=%+v", state)
	}
	service.Touch(board.ID, Participant{MemberID: "other", Name: "Other Member"})
	boards, err := service.Boards(ctx, "other")
	if err != nil {
		t.Fatal(err)
	}
	if len(boards) != 1 || boards[0].CanDelete || len(boards[0].Participants) != 1 {
		t.Fatalf("boards=%+v", boards)
	}
	if err := service.DeleteBoard(ctx, "owner", board.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Authenticate(ctx, token); !errors.Is(err, ErrForbidden) {
		t.Fatalf("deleted board session=%v", err)
	}
}

func TestDisablingActivityRevokesSessions(t *testing.T) {
	service, ctx := activityTestService(t)
	token, _, err := service.Launch(ctx, SketchboardID, "owner", "Board Owner", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.SetEnabled(ctx, SketchboardID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Authenticate(ctx, token); !errors.Is(err, ErrForbidden) {
		t.Fatalf("disabled session=%v", err)
	}
	if _, _, err := service.Launch(ctx, SketchboardID, "owner", "Board Owner", ""); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled launch=%v", err)
	}
}

func TestInstallBundleAndServeRuntimeFile(t *testing.T) {
	service, ctx := activityTestService(t)
	service.dataDir = t.TempDir()
	bundle := activityBundle(t, map[string]string{
		"manifest.json": `{"id":"example.timer","name":"Timer","developer":"Example","version":"1.0.0","host_api_versions":[1],"capabilities":["community.identity"],"entry_point":"index.html"}`,
		"index.html":    `<!doctype html><title>Timer</title>`,
	})
	installation, err := service.InstallBundle(ctx, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if installation.Enabled || installation.Manifest.Integrity == "" {
		t.Fatalf("installation=%+v", installation)
	}
	if _, _, err := service.RuntimeFile(ctx, "example.timer", ""); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled runtime=%v", err)
	}
	if err := service.SetEnabled(ctx, "example.timer", true); err != nil {
		t.Fatal(err)
	}
	contents, name, err := service.RuntimeFile(ctx, "example.timer", "")
	if err != nil || name != "index.html" || !bytes.Contains(contents, []byte("Timer")) {
		t.Fatalf("name=%q contents=%q err=%v", name, contents, err)
	}
}

func TestInstallBundleRejectsUnsafeOrIncompletePackages(t *testing.T) {
	service, ctx := activityTestService(t)
	service.dataDir = t.TempDir()
	unsafe := activityBundle(t, map[string]string{
		"manifest.json": `{"id":"example.unsafe","name":"Unsafe","developer":"Example","version":"1","host_api_versions":[1],"entry_point":"index.html"}`,
		"../escape.js":  `alert(1)`,
		"index.html":    `ok`,
	})
	if _, err := service.InstallBundle(ctx, unsafe); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsafe package=%v", err)
	}
	missing := activityBundle(t, map[string]string{
		"manifest.json": `{"id":"example.missing","name":"Missing","developer":"Example","version":"1","host_api_versions":[1],"entry_point":"index.html"}`,
	})
	if _, err := service.InstallBundle(ctx, missing); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing entry point=%v", err)
	}
}

func activityBundle(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for name, contents := range files {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(contents)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
