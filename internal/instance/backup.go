package instance

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const backupFormatVersion = 1

type backupManifest struct {
	FormatVersion int               `json:"format_version"`
	SchemaVersion int               `json:"schema_version"`
	CreatedAt     string            `json:"created_at"`
	Files         map[string]string `json:"files"`
}

// Backup creates a point-in-time, self-contained archive while the Instance is running.
func Backup(ctx context.Context, dataDir, output string) (err error) {
	dataDir, err = filepath.Abs(dataDir)
	if err != nil {
		return err
	}
	if _, err = os.Stat(filepath.Join(dataDir, "allchat.db")); err != nil {
		return fmt.Errorf("open Instance database: %w", err)
	}
	stage, err := os.MkdirTemp("", "allchat-backup-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	snapshot := filepath.Join(stage, "allchat.db")
	db, err := openDatabase(dataDir)
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err = db.ExecContext(ctx, "VACUUM INTO "+sqliteLiteral(snapshot)); err != nil {
		return fmt.Errorf("snapshot SQLite: %w", err)
	}

	snapshotDB, err := openDatabaseFile(snapshot, true)
	if err != nil {
		return err
	}
	defer snapshotDB.Close()
	var version int
	if err = snapshotDB.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&version); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	files := map[string]string{"allchat.db": snapshot}
	for _, spec := range []struct{ table, dir string }{{"attachments", "attachments"}, {"soundboard_sounds", "soundboard"}} {
		exists, e := tableExists(ctx, snapshotDB, spec.table)
		if e != nil {
			return e
		}
		if !exists {
			continue
		}
		rows, e := snapshotDB.QueryContext(ctx, "SELECT storage_name FROM "+spec.table)
		if e != nil {
			return e
		}
		for rows.Next() {
			var name string
			if e = rows.Scan(&name); e != nil {
				rows.Close()
				return e
			}
			if filepath.Base(name) != name || name == "." || name == ".." {
				rows.Close()
				return fmt.Errorf("invalid stored file name %q", name)
			}
			source := filepath.Join(dataDir, spec.dir, name)
			if _, e = os.Stat(source); e != nil {
				rows.Close()
				return fmt.Errorf("referenced %s file %q: %w", spec.dir, name, e)
			}
			files[spec.dir+"/"+name] = source
		}
		if e = rows.Err(); e != nil {
			rows.Close()
			return e
		}
		rows.Close()
	}
	manifest := backupManifest{FormatVersion: backupFormatVersion, SchemaVersion: version, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Files: make(map[string]string, len(files))}
	for name, path := range files {
		digest, e := fileDigest(path)
		if e != nil {
			return e
		}
		manifest.Files[name] = digest
	}
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(output), 0o700); err != nil {
		return err
	}
	temporary := output + ".part"
	defer func() {
		if err != nil {
			_ = os.Remove(temporary)
		}
	}()
	out, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err = writeBackupArchive(out, manifestBytes, files); err == nil {
		err = out.Sync()
	}
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(temporary, output); err != nil {
		return err
	}
	return nil
}

// Restore validates an archive and reconstructs an empty Instance data directory.
func Restore(ctx context.Context, dataDir, archivePath string) error {
	dataDir, err := filepath.Abs(dataDir)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if len(entries) != 0 {
		return fmt.Errorf("restore target must be empty: %s", dataDir)
	}
	stage, err := os.MkdirTemp(filepath.Dir(dataDir), ".allchat-restore-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	manifest, err := extractAndValidateArchive(archivePath, stage)
	if err != nil {
		return err
	}
	db, err := openDatabaseFile(filepath.Join(stage, "allchat.db"), true)
	if err != nil {
		return err
	}
	defer db.Close()
	var integrity string
	if err = db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		return fmt.Errorf("backup database integrity check failed: %s: %w", integrity, err)
	}
	var version int
	if err = db.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&version); err != nil {
		return err
	}
	if version != manifest.SchemaVersion {
		return fmt.Errorf("manifest schema version %d does not match database %d", manifest.SchemaVersion, version)
	}
	if version > schemaVersion {
		return fmt.Errorf("backup schema version %d is newer than supported version %d", version, schemaVersion)
	}
	if err = db.Close(); err != nil {
		return err
	}
	if _, err = os.Stat(dataDir); errors.Is(err, os.ErrNotExist) {
		return os.Rename(stage, dataDir)
	}
	for _, entry := range []string{"allchat.db", "attachments", "soundboard"} {
		source := filepath.Join(stage, entry)
		if _, statErr := os.Stat(source); errors.Is(statErr, os.ErrNotExist) {
			continue
		}
		if err = os.Rename(source, filepath.Join(dataDir, entry)); err != nil {
			return err
		}
	}
	return nil
}

func writeBackupArchive(output io.Writer, manifest []byte, files map[string]string) error {
	gz := gzip.NewWriter(output)
	tarWriter := tar.NewWriter(gz)
	write := func(name string, source io.Reader, size int64) error {
		if err := tarWriter.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: size, ModTime: time.Unix(0, 0)}); err != nil {
			return err
		}
		_, err := io.Copy(tarWriter, source)
		return err
	}
	if err := write("manifest.json", strings.NewReader(string(manifest)), int64(len(manifest))); err != nil {
		return err
	}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		file, err := os.Open(files[name])
		if err != nil {
			return err
		}
		info, err := file.Stat()
		if err == nil {
			err = write(name, file, info.Size())
		}
		file.Close()
		if err != nil {
			return err
		}
	}
	if err := tarWriter.Close(); err != nil {
		return err
	}
	return gz.Close()
}

func extractAndValidateArchive(path, stage string) (backupManifest, error) {
	file, err := os.Open(path)
	if err != nil {
		return backupManifest{}, err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return backupManifest{}, err
	}
	defer gz.Close()
	tarReader := tar.NewReader(gz)
	extracted := map[string]string{}
	for {
		header, e := tarReader.Next()
		if errors.Is(e, io.EOF) {
			break
		}
		if e != nil {
			return backupManifest{}, e
		}
		name := filepath.ToSlash(header.Name)
		if header.Typeflag != tar.TypeReg || name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "../") {
			return backupManifest{}, fmt.Errorf("unsafe backup entry %q", name)
		}
		if name != "manifest.json" && name != "allchat.db" && !strings.HasPrefix(name, "attachments/") && !strings.HasPrefix(name, "soundboard/") {
			return backupManifest{}, fmt.Errorf("unexpected backup entry %q", name)
		}
		if header.Size < 0 || header.Size > 20<<30 {
			return backupManifest{}, fmt.Errorf("invalid backup entry size")
		}
		destination := filepath.Join(stage, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			return backupManifest{}, err
		}
		out, e := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if e != nil {
			return backupManifest{}, e
		}
		hash := sha256.New()
		_, e = io.CopyN(io.MultiWriter(out, hash), tarReader, header.Size)
		closeErr := out.Close()
		if e == nil {
			e = closeErr
		}
		if e != nil {
			return backupManifest{}, e
		}
		extracted[name] = hex.EncodeToString(hash.Sum(nil))
	}
	data, err := os.ReadFile(filepath.Join(stage, "manifest.json"))
	if err != nil {
		return backupManifest{}, fmt.Errorf("read manifest: %w", err)
	}
	var manifest backupManifest
	if err = json.Unmarshal(data, &manifest); err != nil {
		return manifest, err
	}
	if manifest.FormatVersion != backupFormatVersion {
		return manifest, fmt.Errorf("unsupported backup format version %d", manifest.FormatVersion)
	}
	delete(extracted, "manifest.json")
	if len(extracted) != len(manifest.Files) {
		return manifest, fmt.Errorf("backup file set does not match manifest")
	}
	for name, expected := range manifest.Files {
		if extracted[name] != expected {
			return manifest, fmt.Errorf("checksum mismatch for %s", name)
		}
	}
	return manifest, nil
}

func fileDigest(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
func sqliteLiteral(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
func tableExists(ctx context.Context, db *sql.DB, name string) (bool, error) {
	var count int
	err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", name).Scan(&count)
	return count == 1, err
}
func openDatabaseFile(path string, readOnly bool) (*sql.DB, error) {
	mode := "rwc"
	if readOnly {
		mode = "ro"
	}
	return sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?mode="+mode+"&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
}
