// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"allchat/internal/community"
	"allchat/internal/identity"
	"allchat/internal/media"
	"allchat/internal/relay"
	_ "modernc.org/sqlite"
)

const schemaVersion = 24

//go:embed web/*
var embeddedWeb embed.FS

// Instance owns the lifetime of one Community's process-local resources.
type Instance struct {
	config         Config
	logger         *slog.Logger
	db             *sql.DB
	identity       *identity.Service
	community      *community.Service
	live           *liveState
	media          *media.Manager
	bootstrapToken string
	lock           *os.File
	server         *http.Server
	tlsConfig      *tls.Config
	acme           *acmeCertificateManager
	relay          *relay.Relay
	turnURLs       []string
	turnSecret     string
	turnMu         sync.Mutex
	turnIssued     map[string][]time.Time
	startedAt      time.Time

	closeOnce sync.Once
	closeErr  error
}

// Open acquires exclusive ownership of an Instance and initializes its schema.
func Open(config Config, logger *slog.Logger) (_ *Instance, err error) {
	if logger == nil {
		logger = slog.Default()
	}
	if err := os.MkdirAll(config.DataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}

	lock, err := acquireLock(filepath.Join(config.DataDir, "instance.lock"))
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = releaseLock(lock)
		}
	}()

	db, err := openDatabase(config.DataDir)
	if err != nil {
		return nil, fmt.Errorf("open SQLite: %w", err)
	}
	defer func() {
		if err != nil {
			_ = db.Close()
		}
	}()
	db.SetMaxOpenConns(1)

	if err := backupBeforeMigration(context.Background(), db, config.DataDir); err != nil {
		return nil, err
	}
	if err := initializeSchema(db); err != nil {
		return nil, err
	}
	identityService, err := identity.New(db, config.DataDir)
	if err != nil {
		return nil, fmt.Errorf("initialize identity service: %w", err)
	}
	bootstrapToken, err := identityService.BootstrapToken(context.Background())
	if err != nil {
		return nil, err
	}

	communityService := community.New(db, config.DataDir)
	if err := communityService.CleanupAttachments(context.Background()); err != nil {
		return nil, fmt.Errorf("clean Attachment storage: %w", err)
	}
	var tlsConfig *tls.Config
	var acmeManager *acmeCertificateManager
	if config.TLSCertFile != "" {
		certificate, loadErr := tls.LoadX509KeyPair(config.TLSCertFile, config.TLSKeyFile)
		if loadErr != nil {
			return nil, fmt.Errorf("load supplied TLS certificate: %w", loadErr)
		}
		leaf, parseErr := x509.ParseCertificate(certificate.Certificate[0])
		if parseErr != nil {
			return nil, fmt.Errorf("parse supplied TLS certificate: %w", parseErr)
		}
		now := time.Now()
		if now.Before(leaf.NotBefore) || now.After(leaf.NotAfter) {
			return nil, fmt.Errorf("supplied TLS certificate is not currently valid")
		}
		tlsConfig = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{certificate}}
	}
	if config.ACMEHost != "" {
		manager, managerErr := newACMECertificateManager(config.ACMEHost, config.ACMEEmail, config.DataDir, logger)
		if managerErr != nil {
			return nil, managerErr
		}
		tlsConfig = manager.TLSConfig()
		acmeManager = manager
	}
	mediaManager, mediaErr := media.NewManagerWithLimits(30*time.Second, config.MediaPortMin, config.MediaPortMax, config.MediaMaxParticipants)
	if mediaErr != nil {
		return nil, fmt.Errorf("configure media limits: %w", mediaErr)
	}
	app := &Instance{config: config, logger: logger, db: db, lock: lock, identity: identityService, community: communityService, live: newLiveState(), media: mediaManager, bootstrapToken: bootstrapToken, tlsConfig: tlsConfig, acme: acmeManager, turnIssued: map[string][]time.Time{}, startedAt: time.Now().UTC()}
	if config.TURNPublicIP != "" {
		secret, secretErr := loadOrCreateSecret(filepath.Join(config.DataDir, "turn-secret"))
		if secretErr != nil {
			return nil, secretErr
		}
		turnRelay, relayErr := relay.Start(relay.Config{ListenAddress: config.TURNListenAddress, PublicIP: net.ParseIP(config.TURNPublicIP), RelayMinPort: config.TURNRelayMinPort, RelayMaxPort: config.TURNRelayMaxPort, Realm: "allchat", SharedSecret: secret, TLSListenAddress: config.TURNTLSListenAddress, TLSConfig: tlsConfig})
		if relayErr != nil {
			return nil, fmt.Errorf("start embedded TURN relay: %w", relayErr)
		}
		app.relay = turnRelay
		app.turnSecret = secret
	} else if len(config.ExternalTURNURLs) > 0 {
		app.turnURLs = append([]string(nil), config.ExternalTURNURLs...)
		app.turnSecret = config.ExternalTURNSecret
	}
	app.server = &http.Server{
		Handler:           app.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	return app, nil
}

func backupBeforeMigration(ctx context.Context, db *sql.DB, dataDir string) error {
	exists, err := tableExists(ctx, db, "schema_migrations")
	if err != nil || !exists {
		return err
	}
	var version int
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&version); err != nil {
		return err
	}
	if version >= schemaVersion {
		return nil
	}
	directory := filepath.Join(dataDir, "backups")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create pre-migration backup directory: %w", err)
	}
	name := fmt.Sprintf("pre-migration-v%d-to-v%d-%s.tar.gz", version, schemaVersion, time.Now().UTC().Format("20060102T150405.000000000Z"))
	if err := Backup(ctx, dataDir, filepath.Join(directory, name)); err != nil {
		return fmt.Errorf("create pre-migration backup: %w", err)
	}
	return nil
}

// Run serves the Instance until the context is cancelled, then shuts down
// gracefully and releases ownership of the data directory.
func (i *Instance) Run(ctx context.Context) error {
	listener, err := net.Listen("tcp", i.config.ListenAddress)
	if err != nil {
		_ = i.Close()
		return fmt.Errorf("listen: %w", err)
	}
	if i.tlsConfig != nil {
		listener = tls.NewListener(listener, i.tlsConfig)
	}
	logArguments := []any{"event", "listening", "address", listener.Addr().String()}
	if i.bootstrapToken != "" {
		scheme := "http"
		if i.tlsConfig != nil {
			scheme = "https"
		}
		setupURL := scheme + "://" + listener.Addr().String() + "/setup?token=" + url.QueryEscape(i.bootstrapToken)
		logArguments = append(logArguments, "setup_url", setupURL)
	}
	i.logger.Info("Instance listening", logArguments...)
	if i.acme != nil {
		go i.acme.Run(ctx.Done())
	}
	go i.runAttachmentCleanup(ctx)

	serveResult := make(chan error, 1)
	go func() {
		serveResult <- i.server.Serve(listener)
	}()

	select {
	case err := <-serveResult:
		closeErr := i.Close()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve HTTP: %w", err)
		}
		return closeErr
	case <-ctx.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		shutdownErr := i.server.Shutdown(shutdownContext)
		serveErr := <-serveResult
		closeErr := i.Close()
		if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			return fmt.Errorf("serve HTTP: %w", serveErr)
		}
		return errors.Join(shutdownErr, closeErr)
	}
}

func (i *Instance) runAttachmentCleanup(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := i.community.CleanupAttachments(ctx); err != nil && ctx.Err() == nil {
				i.logger.Warn("Attachment cleanup failed", "error", err)
			}
		}
	}
}

// Close releases all process-local Instance resources. It is idempotent.
func (i *Instance) Close() error {
	i.closeOnce.Do(func() {
		i.media.Close()
		i.community.Close()
		if i.relay != nil {
			_ = i.relay.Close()
		}
		i.closeErr = errors.Join(i.db.Close(), releaseLock(i.lock))
	})
	return i.closeErr
}

func initializeSchema(db *sql.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin schema initialization: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`); err != nil {
		return fmt.Errorf("create schema migrations: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		"INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
		1, time.Now().UTC().Format(time.RFC3339Nano),
	); err != nil {
		return fmt.Errorf("record initial schema: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS members (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			username_key TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS community (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			owner_member_id TEXT NOT NULL UNIQUE REFERENCES members(id)
		);
		CREATE TABLE IF NOT EXISTS sessions (
			token_hash BLOB PRIMARY KEY,
			member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
			created_at TEXT NOT NULL,
			last_seen_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			revoked_at TEXT
		);
		CREATE INDEX IF NOT EXISTS sessions_member_id ON sessions(member_id);
	`); err != nil {
		return fmt.Errorf("create identity schema: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		"INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
		2, time.Now().UTC().Format(time.RFC3339Nano),
	); err != nil {
		return fmt.Errorf("record identity schema: %w", err)
	}
	var currentVersion int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&currentVersion); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if currentVersion < 3 {
		if _, err := tx.ExecContext(ctx, `
			ALTER TABLE sessions ADD COLUMN session_id TEXT;
			ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT 'Unknown client';
			ALTER TABLE sessions ADD COLUMN csrf_token_hash BLOB;
			UPDATE sessions SET session_id = lower(hex(token_hash)) WHERE session_id IS NULL;
			CREATE UNIQUE INDEX sessions_session_id ON sessions(session_id);
			CREATE TABLE recovery_tokens (
				token_hash BLOB PRIMARY KEY,
				member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				consumed_at TEXT,
				superseded_at TEXT
			);
			CREATE INDEX recovery_tokens_member_id ON recovery_tokens(member_id);
		`); err != nil {
			return fmt.Errorf("create Session management schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
			3, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Session management schema: %w", err)
		}
	}
	if currentVersion < 4 {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE roles (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				position INTEGER NOT NULL,
				is_default INTEGER NOT NULL DEFAULT 0,
				is_owner INTEGER NOT NULL DEFAULT 0,
				retired_at TEXT
			);
			CREATE UNIQUE INDEX roles_position_active ON roles(position) WHERE retired_at IS NULL;
			CREATE TABLE role_permissions (
				role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
				permission TEXT NOT NULL,
				PRIMARY KEY(role_id, permission)
			);
			CREATE TABLE member_roles (
				member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
				role_id TEXT NOT NULL REFERENCES roles(id),
				PRIMARY KEY(member_id, role_id)
			);
			INSERT INTO roles(id, name, position, is_default, is_owner) VALUES
				('owner', 'Owner', 1000, 1, 1),
				('admin', 'Admin', 750, 1, 0),
				('moderator', 'Moderator', 500, 1, 0),
				('member', 'Member', 0, 1, 0);
			INSERT INTO role_permissions(role_id, permission) VALUES
				('owner', 'manage_roles'), ('owner', 'manage_members'), ('owner', 'manage_channels'), ('owner', 'create_invitations'), ('owner', 'moderate'), ('owner', 'view_audit'), ('owner', 'view_channels'), ('owner', 'send_messages'), ('owner', 'connect_voice'),
				('admin', 'manage_roles'), ('admin', 'manage_members'), ('admin', 'manage_channels'), ('admin', 'create_invitations'), ('admin', 'moderate'), ('admin', 'view_audit'), ('admin', 'view_channels'), ('admin', 'send_messages'), ('admin', 'connect_voice'),
				('moderator', 'create_invitations'), ('moderator', 'moderate'), ('moderator', 'view_audit'), ('moderator', 'view_channels'), ('moderator', 'send_messages'), ('moderator', 'connect_voice'),
				('member', 'view_channels'), ('member', 'send_messages'), ('member', 'connect_voice');
			INSERT OR IGNORE INTO member_roles(member_id, role_id)
				SELECT owner_member_id, 'owner' FROM community WHERE id = 1;
		`); err != nil {
			return fmt.Errorf("create Role schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 4, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Role schema: %w", err)
		}
	}
	if currentVersion < 5 {
		if _, err := tx.ExecContext(ctx, `
			ALTER TABLE members ADD COLUMN display_name TEXT;
			ALTER TABLE members ADD COLUMN avatar BLOB;
			ALTER TABLE members ADD COLUMN avatar_content_type TEXT;
			ALTER TABLE members ADD COLUMN suspended_until TEXT;
			ALTER TABLE members ADD COLUMN timed_out_until TEXT;
			CREATE TABLE invitations (
				id TEXT PRIMARY KEY,
				token_hash BLOB NOT NULL UNIQUE,
				created_by TEXT NOT NULL REFERENCES members(id),
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				max_uses INTEGER NOT NULL,
				use_count INTEGER NOT NULL DEFAULT 0,
				revoked_at TEXT
			);
		`); err != nil {
			return fmt.Errorf("create Invitation and profile schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 5, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Invitation and profile schema: %w", err)
		}
	}
	if currentVersion < 6 {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE categories (
				id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL, archived_at TEXT
			);
			CREATE TABLE channels (
				id TEXT PRIMARY KEY,
				category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				type TEXT NOT NULL CHECK(type IN ('text', 'voice')),
				position INTEGER NOT NULL,
				archived_at TEXT,
				UNIQUE(category_id, name)
			);
			CREATE TABLE channel_permission_overrides (
				channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
				role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
				permission TEXT NOT NULL,
				effect TEXT NOT NULL CHECK(effect IN ('allow', 'deny')),
				PRIMARY KEY(channel_id, role_id, permission)
			);
			CREATE TABLE deletion_confirmations (
				resource_type TEXT NOT NULL,
				resource_id TEXT NOT NULL,
				token_hash BLOB NOT NULL,
				expires_at TEXT NOT NULL,
				PRIMARY KEY(resource_type, resource_id)
			);
		`); err != nil {
			return fmt.Errorf("create Channel schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 6, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Channel schema: %w", err)
		}
	}
	if currentVersion < 7 {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE channel_sequences (
				channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
				next_sequence INTEGER NOT NULL
			);
			CREATE TABLE messages (
				id TEXT PRIMARY KEY,
				channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
				author_id TEXT NOT NULL REFERENCES members(id),
				sequence INTEGER NOT NULL,
				body TEXT,
				created_at TEXT NOT NULL,
				edited_at TEXT,
				deleted_at TEXT,
				UNIQUE(channel_id, sequence)
			);
			CREATE INDEX messages_channel_sequence ON messages(channel_id, sequence DESC);
		`); err != nil {
			return fmt.Errorf("create Message schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 7, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Message schema: %w", err)
		}
	}
	if currentVersion < 8 {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE realtime_events (
				cursor INTEGER PRIMARY KEY AUTOINCREMENT,
				event_type TEXT NOT NULL,
				channel_id TEXT NOT NULL,
				payload TEXT NOT NULL,
				created_at TEXT NOT NULL
			);
			CREATE INDEX realtime_events_channel_cursor ON realtime_events(channel_id, cursor);
		`); err != nil {
			return fmt.Errorf("create realtime event schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 8, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record realtime event schema: %w", err)
		}
	}
	if currentVersion < 9 {
		if _, err := tx.ExecContext(ctx, `
			ALTER TABLE members ADD COLUMN presence_mode TEXT NOT NULL DEFAULT 'available' CHECK(presence_mode IN ('available', 'dnd'));
			CREATE TABLE read_positions (
				member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
				channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
				sequence INTEGER NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY(member_id, channel_id)
			);
		`); err != nil {
			return fmt.Errorf("create conversation state schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 9, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record conversation state schema: %w", err)
		}
	}
	if currentVersion < 10 {
		if _, err := tx.ExecContext(ctx, `
			ALTER TABLE messages ADD COLUMN reply_to_message_id TEXT REFERENCES messages(id);
			ALTER TABLE messages ADD COLUMN rendered_html TEXT NOT NULL DEFAULT '';
			CREATE TABLE message_mentions (
				message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
				member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
				PRIMARY KEY(message_id, member_id)
			);
			CREATE TABLE message_reactions (
				message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
				member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
				emoji TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY(message_id, member_id, emoji)
			);
			CREATE TABLE pinned_messages (
				channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
				message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
				pinned_by TEXT NOT NULL REFERENCES members(id),
				pinned_at TEXT NOT NULL,
				PRIMARY KEY(channel_id, message_id)
			);
		`); err != nil {
			return fmt.Errorf("create rich Message schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 10, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record rich Message schema: %w", err)
		}
	}
	if currentVersion < 11 {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE attachments (
				id TEXT PRIMARY KEY,
				uploader_id TEXT NOT NULL REFERENCES members(id),
				message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
				original_name TEXT NOT NULL,
				storage_name TEXT NOT NULL UNIQUE,
				content_type TEXT NOT NULL,
				size INTEGER NOT NULL,
				state TEXT NOT NULL CHECK(state IN ('quarantine', 'published', 'garbage')),
				created_at TEXT NOT NULL,
				gc_after TEXT
			);
			CREATE INDEX attachments_state_gc ON attachments(state, gc_after);
		`); err != nil {
			return fmt.Errorf("create Attachment schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 11, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Attachment schema: %w", err)
		}
	}
	if currentVersion < 12 {
		if _, err := tx.ExecContext(ctx, `
			CREATE VIRTUAL TABLE message_search USING fts5(
				message_id UNINDEXED,
				channel_id UNINDEXED,
				body,
				tokenize = 'unicode61'
			);
			INSERT INTO message_search(message_id, channel_id, body)
				SELECT id, channel_id, body FROM messages WHERE deleted_at IS NULL AND body IS NOT NULL;
		`); err != nil {
			return fmt.Errorf("create Message search schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 12, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Message search schema: %w", err)
		}
	}
	if currentVersion < 13 {
		if _, err := tx.ExecContext(ctx, `
			INSERT OR IGNORE INTO categories(id, name, position, archived_at)
				VALUES ('__direct_messages', 'Direct Messages', 2147483647, CURRENT_TIMESTAMP);
			CREATE TABLE direct_messages (
				id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
				member_low_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
				member_high_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				CHECK(member_low_id < member_high_id),
				UNIQUE(member_low_id, member_high_id)
			);
			CREATE INDEX direct_messages_high_member ON direct_messages(member_high_id);
			CREATE TABLE member_blocks (
				blocker_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
				blocked_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL,
				CHECK(blocker_id != blocked_id),
				PRIMARY KEY(blocker_id, blocked_id)
			);
		`); err != nil {
			return fmt.Errorf("create Direct Message schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 13, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Direct Message schema: %w", err)
		}
	}
	if currentVersion < 14 {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE channel_notification_settings (
				member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
				channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
				muted INTEGER NOT NULL DEFAULT 1 CHECK(muted IN (0, 1)),
				PRIMARY KEY(member_id, channel_id)
			);
		`); err != nil {
			return fmt.Errorf("create notification settings schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 14, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record notification settings schema: %w", err)
		}
	}
	if currentVersion < 15 {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE reports (
				id TEXT PRIMARY KEY,
				reporter_id TEXT NOT NULL REFERENCES members(id),
				target_member_id TEXT REFERENCES members(id),
				target_message_id TEXT REFERENCES messages(id),
				reason TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
				created_at TEXT NOT NULL,
				resolved_at TEXT,
				resolved_by TEXT REFERENCES members(id),
				outcome TEXT,
				CHECK((target_member_id IS NOT NULL) != (target_message_id IS NOT NULL))
			);
			CREATE INDEX reports_reporter_created ON reports(reporter_id, created_at DESC);
			CREATE INDEX reports_status_created ON reports(status, created_at DESC);
			CREATE TABLE moderation_records (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				actor_id TEXT NOT NULL REFERENCES members(id),
				action TEXT NOT NULL,
				target_member_id TEXT REFERENCES members(id),
				target_message_id TEXT,
				report_id TEXT REFERENCES reports(id),
				reason TEXT NOT NULL,
				outcome TEXT NOT NULL,
				created_at TEXT NOT NULL
			);
		`); err != nil {
			return fmt.Errorf("create moderation schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 15, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record moderation schema: %w", err)
		}
	}
	if currentVersion < 16 {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE soundboard_sounds (
				id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '',
				storage_name TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL,
				size INTEGER NOT NULL, duration_ms INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0,
				uploader_id TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL
			);
			CREATE INDEX soundboard_sounds_position ON soundboard_sounds(position, created_at);
			CREATE TABLE soundboard_settings (id INTEGER PRIMARY KEY CHECK(id=1), max_duration_ms INTEGER NOT NULL CHECK(max_duration_ms BETWEEN 1000 AND 30000));
			INSERT INTO soundboard_settings(id,max_duration_ms) VALUES(1,10000);
			INSERT OR IGNORE INTO role_permissions(role_id,permission) VALUES
				('owner','manage_soundboard'),('owner','use_soundboard'),
				('admin','manage_soundboard'),('admin','use_soundboard'),
				('moderator','use_soundboard'),('member','use_soundboard');
		`); err != nil {
			return fmt.Errorf("create Soundboard schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 16, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Soundboard schema: %w", err)
		}
	}
	if currentVersion < 17 {
		if _, err := tx.ExecContext(ctx, `ALTER TABLE moderation_records ADD COLUMN target_resource_id TEXT;`); err != nil {
			return fmt.Errorf("extend Moderation Record schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 17, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Moderation Record schema: %w", err)
		}
	}
	if currentVersion < 18 {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE member_notification_settings (
				member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
				level TEXT NOT NULL DEFAULT 'all_messages' CHECK(level IN ('all_messages', 'mentions_only', 'nothing')),
				muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0, 1)),
				sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK(sound_enabled IN (0, 1))
			);
			ALTER TABLE channel_notification_settings ADD COLUMN level TEXT NOT NULL DEFAULT 'default' CHECK(level IN ('default', 'all_messages', 'mentions_only', 'nothing'));
		`); err != nil {
			return fmt.Errorf("extend notification settings schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 18, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record notification settings schema: %w", err)
		}
	}
	if currentVersion < 19 {
		if _, err := tx.ExecContext(ctx, `
			CREATE INDEX pinned_messages_message ON pinned_messages(message_id);
			CREATE INDEX attachments_message_state_created ON attachments(message_id, state, created_at);
		`); err != nil {
			return fmt.Errorf("index Message decoration paths: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 19, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Message decoration index migration: %w", err)
		}
	}
	if currentVersion < 20 {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE unread_counts (
				member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
				channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
				count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
				PRIMARY KEY(member_id, channel_id)
			);
			INSERT INTO unread_counts(member_id, channel_id, count)
			SELECT participant.member_id, participant.channel_id, COUNT(messages.id)
			FROM (
				SELECT id AS channel_id, member_low_id AS member_id FROM direct_messages
				UNION ALL
				SELECT id, member_high_id FROM direct_messages
			) participant
			LEFT JOIN read_positions ON read_positions.member_id = participant.member_id AND read_positions.channel_id = participant.channel_id
			LEFT JOIN messages ON messages.channel_id = participant.channel_id
				AND messages.author_id != participant.member_id
				AND messages.sequence > COALESCE(read_positions.sequence, 0)
			GROUP BY participant.member_id, participant.channel_id;
		`); err != nil {
			return fmt.Errorf("create incremental unread state: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 20, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record incremental unread schema: %w", err)
		}
	}
	if currentVersion < 21 {
		if _, err := tx.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS attachment_settings (
				id INTEGER PRIMARY KEY CHECK(id=1),
				max_file_bytes INTEGER NOT NULL CHECK(max_file_bytes BETWEEN 1048576 AND 26214400)
			);
		`); err != nil {
			return fmt.Errorf("create Attachment settings schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 21, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Attachment settings schema: %w", err)
		}
	}
	if currentVersion < 22 {
		if _, err := tx.ExecContext(ctx, `
			ALTER TABLE attachment_settings RENAME TO attachment_settings_v21;
			CREATE TABLE attachment_settings (
				id INTEGER PRIMARY KEY CHECK(id=1),
				max_file_bytes INTEGER NOT NULL CHECK(max_file_bytes BETWEEN 1048576 AND 268435456)
			);
			INSERT INTO attachment_settings(id,max_file_bytes) SELECT id,max_file_bytes FROM attachment_settings_v21;
			DROP TABLE attachment_settings_v21;
		`); err != nil {
			return fmt.Errorf("raise Attachment size ceiling: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 22, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Attachment ceiling migration: %w", err)
		}
	}
	if currentVersion < 23 {
		rows, err := tx.QueryContext(ctx, "PRAGMA table_info(community)")
		if err != nil {
			return fmt.Errorf("inspect Community schema: %w", err)
		}
		hasHome := false
		for rows.Next() {
			var cid, notNull, primaryKey int
			var name, kind string
			var defaultValue any
			if scanErr := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &primaryKey); scanErr != nil {
				rows.Close()
				return scanErr
			}
			hasHome = hasHome || name == "home_markdown"
		}
		rows.Close()
		if !hasHome {
			if _, err := tx.ExecContext(ctx, `ALTER TABLE community ADD COLUMN home_markdown TEXT NOT NULL DEFAULT '';`); err != nil {
				return fmt.Errorf("add Community home content: %w", err)
			}
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 23, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Community home migration: %w", err)
		}
	}
	if currentVersion < 24 {
		rows, err := tx.QueryContext(ctx, "PRAGMA table_info(members)")
		if err != nil {
			return fmt.Errorf("inspect Member schema: %w", err)
		}
		columns := map[string]bool{}
		for rows.Next() {
			var cid, notNull, primaryKey int
			var name, kind string
			var defaultValue any
			if scanErr := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &primaryKey); scanErr != nil {
				rows.Close()
				return scanErr
			}
			columns[name] = true
		}
		rows.Close()
		if !columns["banner"] {
			if _, err := tx.ExecContext(ctx, "ALTER TABLE members ADD COLUMN banner BLOB"); err != nil {
				return fmt.Errorf("add Member banner image: %w", err)
			}
		}
		if !columns["banner_content_type"] {
			if _, err := tx.ExecContext(ctx, "ALTER TABLE members ADD COLUMN banner_content_type TEXT"); err != nil {
				return fmt.Errorf("add Member banner content type: %w", err)
			}
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", 24, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return fmt.Errorf("record Member banner migration: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit schema initialization: %w", err)
	}
	return nil
}

func (i *Instance) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", i.health)
	mux.HandleFunc("GET /api/v1/admin/diagnostics", i.diagnosticsAPI)
	mux.HandleFunc("GET /api/v1/admin/dashboard", i.adminDashboardAPI)
	if i.config.MetricsEnabled {
		mux.HandleFunc("GET /metrics", i.metrics)
	}
	mux.HandleFunc("POST /api/v1/auth/setup", i.setupAPI)
	mux.HandleFunc("POST /api/v1/auth/login", i.loginAPI)
	mux.HandleFunc("POST /api/v1/auth/native/login", i.nativeLoginAPI)
	mux.HandleFunc("POST /api/v1/auth/logout", i.logoutAPI)
	mux.HandleFunc("POST /api/v1/auth/recover", i.recoverAPI)
	mux.HandleFunc("POST /api/v1/auth/register", i.registerAPI)
	mux.HandleFunc("POST /api/v1/auth/native/register", i.nativeRegisterAPI)
	mux.HandleFunc("GET /api/v1/session", i.sessionAPI)
	mux.HandleFunc("GET /api/v1/mobile/bootstrap", i.mobileBootstrapAPI)
	mux.HandleFunc("GET /api/v1/sessions", i.sessionsAPI)
	mux.HandleFunc("DELETE /api/v1/sessions", i.revokeAllSessionsAPI)
	mux.HandleFunc("DELETE /api/v1/sessions/{sessionID}", i.revokeSessionAPI)
	mux.HandleFunc("POST /api/v1/admin/members/{memberID}/recovery-token", i.issueRecoveryTokenAPI)
	mux.HandleFunc("GET /api/v1/roles", i.rolesAPI)
	mux.HandleFunc("POST /api/v1/roles", i.createRoleAPI)
	mux.HandleFunc("PATCH /api/v1/roles/{roleID}", i.updateRoleAPI)
	mux.HandleFunc("DELETE /api/v1/roles/{roleID}", i.retireRoleAPI)
	mux.HandleFunc("POST /api/v1/members/{memberID}/roles/{roleID}", i.assignRoleAPI)
	mux.HandleFunc("POST /api/v1/ownership/transfer", i.transferOwnershipAPI)
	mux.HandleFunc("GET /api/v1/invitations", i.invitationsAPI)
	mux.HandleFunc("POST /api/v1/invitations", i.createInvitationAPI)
	mux.HandleFunc("DELETE /api/v1/invitations/{invitationID}", i.revokeInvitationAPI)
	mux.HandleFunc("GET /api/v1/members/{memberID}", i.memberProfileAPI)
	mux.HandleFunc("GET /api/v1/members", i.membersAPI)
	mux.HandleFunc("GET /api/v1/members/{memberID}/avatar", i.memberAvatarAPI)
	mux.HandleFunc("GET /api/v1/members/{memberID}/banner", i.memberBannerAPI)
	mux.HandleFunc("PATCH /api/v1/profile", i.updateProfileAPI)
	mux.HandleFunc("PUT /api/v1/profile/avatar", i.updateAvatarAPI)
	mux.HandleFunc("DELETE /api/v1/profile/avatar", i.removeAvatarAPI)
	mux.HandleFunc("PUT /api/v1/profile/banner", i.updateBannerAPI)
	mux.HandleFunc("DELETE /api/v1/profile/banner", i.removeBannerAPI)
	mux.HandleFunc("GET /api/v1/channels", i.channelsAPI)
	mux.HandleFunc("POST /api/v1/categories", i.createCategoryAPI)
	mux.HandleFunc("PATCH /api/v1/categories/{categoryID}", i.updateCategoryAPI)
	mux.HandleFunc("POST /api/v1/categories/{categoryID}/archive", i.archiveCategoryAPI)
	mux.HandleFunc("POST /api/v1/categories/{categoryID}/restore", i.restoreCategoryAPI)
	mux.HandleFunc("POST /api/v1/channels", i.createChannelAPI)
	mux.HandleFunc("PATCH /api/v1/channels/{channelID}", i.updateChannelAPI)
	mux.HandleFunc("POST /api/v1/channels/{channelID}/archive", i.archiveChannelAPI)
	mux.HandleFunc("POST /api/v1/channels/{channelID}/restore", i.restoreChannelAPI)
	mux.HandleFunc("PUT /api/v1/channels/{channelID}/overrides", i.channelOverrideAPI)
	mux.HandleFunc("POST /api/v1/channels/{channelID}/deletion-confirmation", i.prepareChannelDeletionAPI)
	mux.HandleFunc("DELETE /api/v1/channels/{channelID}", i.deleteChannelAPI)
	mux.HandleFunc("GET /api/v1/channels/{channelID}/messages", i.messagesAPI)
	mux.HandleFunc("POST /api/v1/channels/{channelID}/messages", i.publishMessageAPI)
	mux.HandleFunc("PATCH /api/v1/messages/{messageID}", i.editMessageAPI)
	mux.HandleFunc("DELETE /api/v1/messages/{messageID}", i.deleteMessageAPI)
	mux.HandleFunc("PUT /api/v1/messages/{messageID}/reactions", i.reactionAPI)
	mux.HandleFunc("DELETE /api/v1/messages/{messageID}/reactions", i.reactionAPI)
	mux.HandleFunc("PUT /api/v1/messages/{messageID}/pin", i.pinMessageAPI)
	mux.HandleFunc("DELETE /api/v1/messages/{messageID}/pin", i.pinMessageAPI)
	mux.HandleFunc("GET /api/v1/channels/{channelID}/pins", i.pinnedMessagesAPI)
	mux.HandleFunc("POST /api/v1/attachments", i.uploadAttachmentAPI)
	mux.HandleFunc("GET /api/v1/attachments/{attachmentID}", i.downloadAttachmentAPI)
	mux.HandleFunc("GET /api/v1/attachments/{attachmentID}/preview", i.previewAttachmentAPI)
	mux.HandleFunc("GET /api/v1/search", i.searchMessagesAPI)
	mux.HandleFunc("GET /api/v1/community-home", i.communityHomeAPI)
	mux.HandleFunc("GET /api/v1/link-preview", i.linkPreviewAPI)
	mux.HandleFunc("GET /api/v1/link-preview/image", i.linkPreviewImageAPI)
	mux.HandleFunc("GET /api/v1/dms", i.directMessagesAPI)
	mux.HandleFunc("POST /api/v1/dms", i.openDirectMessageAPI)
	mux.HandleFunc("GET /api/v1/dms/{dmID}", i.directMessageAPI)
	mux.HandleFunc("GET /api/v1/dms/{dmID}/messages", i.directMessageMessagesAPI)
	mux.HandleFunc("POST /api/v1/dms/{dmID}/messages", i.publishDirectMessageAPI)
	mux.HandleFunc("PUT /api/v1/dms/{dmID}/read-position", i.updateDirectMessageReadPositionAPI)
	mux.HandleFunc("PUT /api/v1/blocks/{memberID}", i.setBlockAPI)
	mux.HandleFunc("DELETE /api/v1/blocks/{memberID}", i.setBlockAPI)
	mux.HandleFunc("GET /api/v1/realtime", i.realtimeWebSocket)
	mux.HandleFunc("GET /api/v1/realtime/snapshot", i.realtimeSnapshotAPI)
	mux.HandleFunc("GET /api/v1/state/channels", i.channelStatesAPI)
	mux.HandleFunc("PUT /api/v1/channels/{channelID}/read-position", i.updateReadPositionAPI)
	mux.HandleFunc("PUT /api/v1/presence-mode", i.updatePresenceModeAPI)
	mux.HandleFunc("GET /api/v1/presence", i.presenceAPI)
	mux.HandleFunc("GET /api/v1/notification-settings", i.notificationSettingsAPI)
	mux.HandleFunc("PUT /api/v1/notification-settings", i.updateNotificationSettingsAPI)
	mux.HandleFunc("PUT /api/v1/channels/{channelID}/notification-settings", i.updateChannelNotificationSettingsAPI)
	mux.HandleFunc("PUT /api/v1/channels/{channelID}/mute", i.setChannelMuteAPI)
	mux.HandleFunc("DELETE /api/v1/channels/{channelID}/mute", i.setChannelMuteAPI)
	mux.HandleFunc("GET /api/v1/reports", i.reportsAPI)
	mux.HandleFunc("POST /api/v1/reports", i.createReportAPI)
	mux.HandleFunc("POST /api/v1/reports/{reportID}/resolve", i.resolveReportAPI)
	mux.HandleFunc("GET /api/v1/moderation-records", i.moderationRecordsAPI)
	mux.HandleFunc("POST /api/v1/moderation-actions", i.moderationActionAPI)
	mux.HandleFunc("POST /api/v1/moderation-records/purge", i.purgeModerationRecordsAPI)
	mux.HandleFunc("GET /api/v1/account/export", i.exportAccountAPI)
	mux.HandleFunc("POST /api/v1/account/delete", i.deleteAccountAPI)
	mux.HandleFunc("GET /api/v1/media", i.mediaWebSocket)
	mux.HandleFunc("GET /api/v1/media/config", i.mediaConfigAPI)
	mux.HandleFunc("DELETE /api/v1/media/rooms/{roomID}/session", i.endOwnMediaSessionAPI)
	mux.HandleFunc("GET /api/v1/soundboard", i.soundboardAPI)
	mux.HandleFunc("POST /api/v1/soundboard", i.uploadSoundAPI)
	mux.HandleFunc("PATCH /api/v1/soundboard/{soundID}", i.updateSoundAPI)
	mux.HandleFunc("DELETE /api/v1/soundboard/{soundID}", i.deleteSoundAPI)
	mux.HandleFunc("GET /api/v1/soundboard/{soundID}/audio", i.downloadSoundAPI)
	mux.HandleFunc("PUT /api/v1/soundboard/settings", i.soundboardSettingsAPI)
	mux.HandleFunc("GET /api/v1/voice/{channelID}/participants", i.voiceParticipantsAPI)
	mux.HandleFunc("GET /api/v1/dms/{dmID}/call", i.directCallAPI)
	mux.HandleFunc("GET /api/v1/calls/current", i.currentDirectCallAPI)
	mux.HandleFunc("POST /api/v1/dms/{dmID}/calls", i.startDirectCallAPI)
	mux.HandleFunc("POST /api/v1/calls/{callID}/accept", i.acceptDirectCallAPI)
	mux.HandleFunc("POST /api/v1/calls/{callID}/decline", i.declineDirectCallAPI)
	mux.HandleFunc("POST /api/v1/calls/{callID}/end", i.endDirectCallAPI)
	mux.HandleFunc("PUT /api/v1/media/rooms/{roomID}/participants/{memberID}/mute", i.muteMediaParticipantAPI)
	mux.HandleFunc("DELETE /api/v1/media/rooms/{roomID}/participants/{memberID}/mute", i.unmuteMediaParticipantAPI)
	mux.HandleFunc("POST /api/v1/media/rooms/{roomID}/participants/{memberID}/disconnect", i.disconnectMediaParticipantAPI)
	mux.HandleFunc("GET /api/v1/turn-credentials", i.turnCredentialsAPI)
	mux.HandleFunc("GET /setup", i.setupPage)
	mux.HandleFunc("POST /setup", i.setupWeb)
	mux.HandleFunc("GET /login", i.loginPage)
	mux.HandleFunc("POST /login", i.loginWeb)
	mux.HandleFunc("POST /logout", i.logoutWeb)
	mux.HandleFunc("GET /sessions", i.sessionsPage)
	mux.HandleFunc("GET /voice-video", i.voiceSettingsPage)
	mux.HandleFunc("POST /sessions/{sessionID}/revoke", i.revokeSessionWeb)
	mux.HandleFunc("POST /sessions/revoke-all", i.revokeAllSessionsWeb)
	mux.HandleFunc("GET /recover", i.recoveryPage)
	mux.HandleFunc("POST /recover", i.recoverWeb)
	mux.HandleFunc("GET /admin/roles", i.rolesPage)
	mux.HandleFunc("GET /admin/soundboard", i.soundboardPage)
	mux.HandleFunc("POST /admin/roles", i.createRoleWeb)
	mux.HandleFunc("POST /admin/roles/{roleID}", i.updateRoleWeb)
	mux.HandleFunc("POST /admin/roles/{roleID}/retire", i.retireRoleWeb)
	mux.HandleFunc("GET /join", i.joinPage)
	mux.HandleFunc("POST /join", i.joinWeb)
	mux.HandleFunc("GET /profile", i.profilePage)
	mux.HandleFunc("POST /profile", i.profileWeb)
	mux.HandleFunc("GET /admin/invitations", i.invitationsPage)
	mux.HandleFunc("POST /admin/invitations", i.createInvitationWeb)
	mux.HandleFunc("POST /admin/invitations/{invitationID}/revoke", i.revokeInvitationWeb)
	mux.HandleFunc("GET /admin/channels", i.channelsAdminPage)
	mux.HandleFunc("GET /admin/settings", i.communitySettingsPage)
	mux.HandleFunc("GET /admin/dashboard", i.adminDashboardPage)
	mux.HandleFunc("POST /admin/settings", i.updateCommunitySettingsWeb)
	mux.HandleFunc("POST /admin/categories", i.createCategoryWeb)
	mux.HandleFunc("POST /admin/channels", i.createChannelWeb)
	mux.HandleFunc("POST /admin/channels/{channelID}/archive", i.archiveChannelWeb)
	mux.HandleFunc("GET /channels/{channelID}", i.channelPage)
	mux.HandleFunc("POST /channels/{channelID}/messages", i.publishMessageWeb)
	mux.HandleFunc("POST /messages/{messageID}/edit", i.editMessageWeb)
	mux.HandleFunc("POST /messages/{messageID}/delete", i.deleteMessageWeb)
	mux.HandleFunc("GET /search", i.searchPage)
	mux.HandleFunc("GET /dms", i.directMessagesPage)
	mux.HandleFunc("POST /dms", i.openDirectMessageWeb)
	mux.HandleFunc("POST /dms/{dmID}/block", i.setDirectMessageBlockWeb)
	mux.HandleFunc("POST /dms/{dmID}/unblock", i.setDirectMessageBlockWeb)
	mux.HandleFunc("GET /favicon.ico", func(response http.ResponseWriter, _ *http.Request) {
		icon, err := embeddedWeb.ReadFile("web/assets/favicon.svg")
		if err != nil {
			http.Error(response, "favicon unavailable", http.StatusInternalServerError)
			return
		}
		response.Header().Set("Content-Type", "image/svg+xml")
		response.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = response.Write(icon)
	})
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", noCache(http.FileServerFS(mustSub(embeddedWeb, "web/assets")))))
	mux.HandleFunc("GET /", i.homePage)
	return mux
}

func openDatabase(dataDir string) (*sql.DB, error) {
	databasePath := filepath.Join(dataDir, "allchat.db")
	databaseURL := (&url.URL{Scheme: "file", Path: databasePath}).String()
	dsn := databaseURL + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=wal_autocheckpoint(1000)&_pragma=cache_size(-16384)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open SQLite: %w", err)
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

func (i *Instance) health(response http.ResponseWriter, request *http.Request) {
	ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
	defer cancel()
	if err := i.db.PingContext(ctx); err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]any{"status": "unavailable"})
		return
	}

	var version int
	if err := i.db.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&version); err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]any{"status": "unavailable"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"status": "ok", "schema_version": version})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(response, request)
	})
}

func mustSub(source fs.FS, directory string) fs.FS {
	result, err := fs.Sub(source, directory)
	if err != nil {
		panic(err)
	}
	return result
}

func acquireLock(path string) (*os.File, error) {
	lock, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open Instance lock: %w", err)
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = lock.Close()
		return nil, fmt.Errorf("Instance data directory is already owned by another process")
	}
	if err := lock.Truncate(0); err != nil {
		_ = releaseLock(lock)
		return nil, fmt.Errorf("reset Instance lock: %w", err)
	}
	if _, err := lock.WriteString(strconv.Itoa(os.Getpid()) + "\n"); err != nil {
		_ = releaseLock(lock)
		return nil, fmt.Errorf("record Instance owner: %w", err)
	}
	return lock, nil
}

func releaseLock(lock *os.File) error {
	if lock == nil {
		return nil
	}
	unlockErr := syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	closeErr := lock.Close()
	return errors.Join(unlockErr, closeErr)
}
