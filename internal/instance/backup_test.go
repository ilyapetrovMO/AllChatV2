package instance

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackupRestoreIncludesReferencedFilesAndSnapshotState(t *testing.T) {
	source := t.TempDir()
	db, err := openDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO members(id,username,username_key,password_hash,created_at) VALUES('member','Bot','bot','hash','now')`); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(source, "soundboard"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(source, "soundboard", "clip"), []byte("audio bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO soundboard_sounds(id,name,storage_name,content_type,size,duration_ms,position,uploader_id,created_at) VALUES('sound','Test','clip','audio/wav',11,1000,0,'member','now')`); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "instance.tar.gz")
	if err = Backup(context.Background(), source, archive); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE soundboard_sounds SET name='Mutated' WHERE id='sound'`); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}

	restored := filepath.Join(t.TempDir(), "restored")
	if err = Restore(context.Background(), restored, archive); err != nil {
		t.Fatal(err)
	}
	restoredDB, err := openDatabaseFile(filepath.Join(restored, "allchat.db"), true)
	if err != nil {
		t.Fatal(err)
	}
	defer restoredDB.Close()
	var name string
	if err = restoredDB.QueryRow(`SELECT name FROM soundboard_sounds WHERE id='sound'`).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "Test" {
		t.Fatalf("restored snapshot name = %q", name)
	}
	data, err := os.ReadFile(filepath.Join(restored, "soundboard", "clip"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "audio bytes" {
		t.Fatalf("restored blob = %q", data)
	}
}

func TestRestoreRejectsNonemptyTargetAndDamagedArchive(t *testing.T) {
	target := t.TempDir()
	if err := os.WriteFile(filepath.Join(target, "keep"), []byte("safe"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := Restore(context.Background(), target, filepath.Join(t.TempDir(), "missing"))
	if err == nil || !strings.Contains(err.Error(), "must be empty") {
		t.Fatalf("Restore error = %v", err)
	}

	damaged := filepath.Join(t.TempDir(), "damaged.tar.gz")
	if err = os.WriteFile(damaged, []byte("not an archive"), 0o600); err != nil {
		t.Fatal(err)
	}
	err = Restore(context.Background(), filepath.Join(t.TempDir(), "empty"), damaged)
	if err == nil {
		t.Fatal("Restore accepted damaged archive")
	}
}

func TestBackupBeforeMigrationCreatesRecoveryArchive(t *testing.T) {
	directory := t.TempDir()
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(filepath.Join(directory, "allchat.db")))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(1,'now')`); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = backupBeforeMigration(context.Background(), db, directory); err != nil {
		t.Fatal(err)
	}
	archives, err := filepath.Glob(filepath.Join(directory, "backups", "pre-migration-v1-to-v*.tar.gz"))
	if err != nil {
		t.Fatal(err)
	}
	if len(archives) != 1 {
		t.Fatalf("pre-migration archives = %v", archives)
	}
}

func TestMigrationFailureRollsBackAndCanRecover(t *testing.T) {
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	// Mark the database as v17 while leaving the v18 tables behind to force the
	// next forward migration to fail after it has started its transaction.
	if _, err = db.Exec(`DELETE FROM schema_migrations WHERE version=18`); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	config, err := NewConfig(directory, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if app, openErr := Open(config, logger); openErr == nil {
		app.Close()
		t.Fatal("migration unexpectedly succeeded")
	}
	db, err = openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	var version int
	if err = db.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 17 {
		t.Fatalf("failed migration left schema version %d", version)
	}
	if _, err = db.Exec(`DROP TABLE member_notification_settings; ALTER TABLE channel_notification_settings DROP COLUMN level`); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	app, err := Open(config, logger)
	if err != nil {
		t.Fatalf("recover migration: %v", err)
	}
	defer app.Close()
	if err = app.db.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != schemaVersion {
		t.Fatalf("recovered schema version = %d", version)
	}
}
