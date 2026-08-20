// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package identity

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestExpiredRecoveryTokenIsRejected(t *testing.T) {
	database, err := sql.Open("sqlite", "file::memory:?cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	database.SetMaxOpenConns(1)
	if _, err := database.Exec(`
		CREATE TABLE members (id TEXT PRIMARY KEY, username TEXT, username_key TEXT, password_hash TEXT, created_at TEXT);
		CREATE TABLE community (id INTEGER PRIMARY KEY, owner_member_id TEXT);
		CREATE TABLE sessions (token_hash BLOB PRIMARY KEY, member_id TEXT, created_at TEXT, last_seen_at TEXT, expires_at TEXT, revoked_at TEXT, session_id TEXT, user_agent TEXT, csrf_token_hash BLOB);
		CREATE TABLE recovery_tokens (token_hash BLOB PRIMARY KEY, member_id TEXT, created_at TEXT, expires_at TEXT, consumed_at TEXT, superseded_at TEXT);
		INSERT INTO members(id, username, username_key, password_hash, created_at) VALUES ('owner-id', 'owner', 'owner', 'unused', 'now');
		INSERT INTO community(id, owner_member_id) VALUES (1, 'owner-id');
	`); err != nil {
		t.Fatal(err)
	}

	service, err := New(database, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	clock := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return clock }
	token, err := service.IssueRecoveryToken(context.Background(), Member{ID: "owner-id", Owner: true}, "owner-id")
	if err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(recoveryLifetime + time.Nanosecond)
	if err := service.RedeemRecoveryToken(context.Background(), token.Token, "a replacement password"); !errors.Is(err, ErrInvalidRecovery) {
		t.Fatalf("expired token error = %v, want %v", err, ErrInvalidRecovery)
	}
}

func TestSessionWithoutCSRFSecretIsRejected(t *testing.T) {
	database, err := sql.Open("sqlite", "file::memory:?cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	database.SetMaxOpenConns(1)
	if _, err := database.Exec(`
		CREATE TABLE members (id TEXT PRIMARY KEY, username TEXT, username_key TEXT, password_hash TEXT, created_at TEXT, display_name TEXT, avatar BLOB, banner BLOB, suspended_until TEXT, disabled_at TEXT);
		CREATE TABLE community (id INTEGER PRIMARY KEY, owner_member_id TEXT);
		CREATE TABLE sessions (token_hash BLOB PRIMARY KEY, member_id TEXT, created_at TEXT, last_seen_at TEXT, expires_at TEXT, revoked_at TEXT, session_id TEXT, user_agent TEXT, csrf_token_hash BLOB);
		INSERT INTO members(id, username, username_key, password_hash, created_at) VALUES ('owner-id', 'owner', 'owner', 'unused', 'now');
		INSERT INTO community(id, owner_member_id) VALUES (1, 'owner-id');
	`); err != nil {
		t.Fatal(err)
	}

	service, err := New(database, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	sessionToken := "legacy-session-without-csrf"
	hash := tokenHash(sessionToken)
	if _, err := database.Exec(`
		INSERT INTO sessions(token_hash, member_id, created_at, last_seen_at, expires_at, session_id, user_agent, csrf_token_hash)
		VALUES (?, 'owner-id', ?, ?, ?, 'legacy', 'Browser', NULL)`, hash[:], databaseTime(now), databaseTime(now), databaseTime(now.Add(time.Hour))); err != nil {
		t.Fatal(err)
	}

	if _, err := service.MemberForSession(context.Background(), sessionToken); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("legacy Session error = %v, want %v", err, ErrInvalidCredentials)
	}
}
