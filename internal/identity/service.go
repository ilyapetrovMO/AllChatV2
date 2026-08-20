// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrInvalidSetup       = errors.New("setup token is invalid or has already been used")
	ErrInvalidInvitation  = errors.New("Invitation is invalid or no longer active")
	ErrAlreadySetup       = errors.New("Community Owner already exists")
	ErrRateLimited        = errors.New("too many authentication attempts")
	ErrInvalidUsername    = errors.New("username must be 3-32 letters, numbers, dots, underscores, or hyphens")
	ErrInvalidPassword    = errors.New("password must be between 12 and 1024 bytes")
	ErrInvalidRecovery    = errors.New("recovery token is invalid or no longer active")
	ErrSessionNotFound    = errors.New("Session was not found")
	ErrForbidden          = errors.New("permission denied")
)

const (
	bootstrapFilename = "setup.token"
	sessionLifetime   = 30 * 24 * time.Hour
	recoveryLifetime  = 15 * time.Minute
	argonTime         = uint32(3)
	argonMemory       = uint32(64 * 1024)
	argonThreads      = uint8(4)
	argonKeyLength    = uint32(32)
)

type Member struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name,omitempty"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	BannerURL   string `json:"banner_url,omitempty"`
	Owner       bool   `json:"owner"`
	Disabled    bool   `json:"disabled,omitempty"`
}

type SessionCredentials struct {
	Token     string
	CSRFToken string
	SessionID string
	ExpiresAt time.Time
}

type SessionInfo struct {
	ID           string `json:"id"`
	Device       string `json:"device"`
	CreatedAt    string `json:"created_at"`
	LastActivity string `json:"last_activity"`
	Current      bool   `json:"current"`
}

type RecoveryToken struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expires_at"`
}

type Service struct {
	db        *sql.DB
	dataDir   string
	now       func() time.Time
	limiter   *loginLimiter
	dummyHash string
}

func New(db *sql.DB, dataDir string) (*Service, error) {
	dummyHash, err := hashPassword("allchat-dummy-password")
	if err != nil {
		return nil, err
	}
	return &Service{
		db: db, dataDir: dataDir, now: time.Now,
		limiter: newLoginLimiter(5, time.Minute), dummyHash: dummyHash,
	}, nil
}

// BootstrapToken returns the existing one-time token or creates it when the
// Instance has no Owner. The raw token exists only in a protected local file.
func (s *Service) BootstrapToken(ctx context.Context) (string, error) {
	ownerExists, err := s.ownerExists(ctx)
	if err != nil {
		return "", err
	}
	path := filepath.Join(s.dataDir, bootstrapFilename)
	if ownerExists {
		_ = os.Remove(path)
		return "", nil
	}
	if token, err := os.ReadFile(path); err == nil {
		return strings.TrimSpace(string(token)), nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("read setup token: %w", err)
	}

	token, err := randomToken(32)
	if err != nil {
		return "", err
	}
	temporary := path + ".new"
	if err := os.WriteFile(temporary, []byte(token+"\n"), 0o600); err != nil {
		return "", fmt.Errorf("write setup token: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return "", fmt.Errorf("publish setup token: %w", err)
	}
	return token, nil
}

func (s *Service) Bootstrap(ctx context.Context, token, username, password, device string) (Member, SessionCredentials, error) {
	if err := validateUsername(username); err != nil {
		return Member{}, SessionCredentials{}, err
	}
	if err := validatePassword(password); err != nil {
		return Member{}, SessionCredentials{}, err
	}
	expected, err := os.ReadFile(filepath.Join(s.dataDir, bootstrapFilename))
	if err != nil || subtle.ConstantTimeCompare([]byte(strings.TrimSpace(string(expected))), []byte(token)) != 1 {
		return Member{}, SessionCredentials{}, ErrInvalidSetup
	}

	passwordHash, err := hashPassword(password)
	if err != nil {
		return Member{}, SessionCredentials{}, err
	}
	memberID, err := randomToken(16)
	if err != nil {
		return Member{}, SessionCredentials{}, err
	}
	now := s.now().UTC()
	session, err := newSessionCredentials(now)
	if err != nil {
		return Member{}, SessionCredentials{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Member{}, SessionCredentials{}, fmt.Errorf("begin Owner setup: %w", err)
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM community WHERE id = 1 AND owner_member_id IS NOT NULL").Scan(&count); err != nil {
		return Member{}, SessionCredentials{}, fmt.Errorf("check Owner: %w", err)
	}
	if count != 0 {
		return Member{}, SessionCredentials{}, ErrAlreadySetup
	}
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO members(id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
		memberID, username, usernameKey(username), passwordHash, databaseTime(now)); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return Member{}, SessionCredentials{}, ErrInvalidUsername
		}
		return Member{}, SessionCredentials{}, fmt.Errorf("create Owner: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO community(id, owner_member_id) VALUES (1, ?)", memberID); err != nil {
		return Member{}, SessionCredentials{}, fmt.Errorf("assign Owner: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO member_roles(member_id, role_id) VALUES (?, 'owner')", memberID); err != nil {
		return Member{}, SessionCredentials{}, fmt.Errorf("assign Owner Role: %w", err)
	}
	if err := insertSession(ctx, tx, session, memberID, device, now); err != nil {
		return Member{}, SessionCredentials{}, err
	}
	if err := tx.Commit(); err != nil {
		return Member{}, SessionCredentials{}, fmt.Errorf("commit Owner setup: %w", err)
	}
	_ = os.Remove(filepath.Join(s.dataDir, bootstrapFilename))
	return Member{ID: memberID, Username: username, Owner: true}, session, nil
}

func (s *Service) Authenticate(ctx context.Context, username, password, source, device string) (Member, SessionCredentials, error) {
	key := usernameKey(username) + "|" + source
	sourceKey := "*|" + source
	if !s.limiter.Allow(key, s.now()) || !s.limiter.Allow(sourceKey, s.now()) {
		return Member{}, SessionCredentials{}, ErrRateLimited
	}

	var member Member
	var passwordHash string
	var hasAvatar, hasBanner bool
	var suspendedUntil, disabledAt sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT m.id, m.username, COALESCE(m.display_name, ''), m.avatar IS NOT NULL, m.banner IS NOT NULL, m.password_hash,
		       EXISTS(SELECT 1 FROM community c WHERE c.id = 1 AND c.owner_member_id = m.id), m.suspended_until, m.disabled_at
		FROM members m WHERE m.username_key = ?`, usernameKey(username)).
		Scan(&member.ID, &member.Username, &member.DisplayName, &hasAvatar, &hasBanner, &passwordHash, &member.Owner, &suspendedUntil, &disabledAt)
	if errors.Is(err, sql.ErrNoRows) {
		passwordHash = s.dummyHash
	} else if err != nil {
		return Member{}, SessionCredentials{}, fmt.Errorf("find Member: %w", err)
	}
	valid, err := verifyPassword(password, passwordHash)
	if err != nil || !valid || member.ID == "" || disabledAt.Valid || (suspendedUntil.Valid && suspendedUntil.String > databaseTime(s.now())) {
		s.limiter.Failed(key, s.now())
		s.limiter.Failed(sourceKey, s.now())
		return Member{}, SessionCredentials{}, ErrInvalidCredentials
	}
	s.limiter.Success(key)
	if hasAvatar {
		member.AvatarURL = "/api/v1/members/" + member.ID + "/avatar"
	}
	if hasBanner {
		member.BannerURL = "/api/v1/members/" + member.ID + "/banner"
	}

	now := s.now().UTC()
	session, err := newSessionCredentials(now)
	if err != nil {
		return Member{}, SessionCredentials{}, err
	}
	if err := insertSession(ctx, s.db, session, member.ID, device, now); err != nil {
		return Member{}, SessionCredentials{}, err
	}
	return member, session, nil
}

func (s *Service) MemberForSession(ctx context.Context, token string) (Member, error) {
	hash := tokenHash(token)
	var member Member
	var hasAvatar, hasBanner bool
	err := s.db.QueryRowContext(ctx, `
		SELECT m.id, m.username, COALESCE(m.display_name, ''), m.avatar IS NOT NULL, m.banner IS NOT NULL,
		       EXISTS(SELECT 1 FROM community c WHERE c.id = 1 AND c.owner_member_id = m.id)
		FROM sessions s JOIN members m ON m.id = s.member_id
		WHERE s.token_hash = ? AND s.csrf_token_hash IS NOT NULL
		  AND s.revoked_at IS NULL AND s.expires_at > ?
		  AND m.disabled_at IS NULL
		  AND (m.suspended_until IS NULL OR m.suspended_until <= ?)`,
		hash[:], databaseTime(s.now()), databaseTime(s.now())).Scan(&member.ID, &member.Username, &member.DisplayName, &hasAvatar, &hasBanner, &member.Owner)
	if errors.Is(err, sql.ErrNoRows) {
		return Member{}, ErrInvalidCredentials
	}
	if err != nil {
		return Member{}, fmt.Errorf("read Session: %w", err)
	}
	_, _ = s.db.ExecContext(ctx, "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
		databaseTime(s.now()), hash[:])
	if hasAvatar {
		member.AvatarURL = "/api/v1/members/" + member.ID + "/avatar"
	}
	if hasBanner {
		member.BannerURL = "/api/v1/members/" + member.ID + "/banner"
	}
	return member, nil
}

func (s *Service) Register(ctx context.Context, invitationToken, username, password, device string) (Member, SessionCredentials, error) {
	if err := validateUsername(username); err != nil {
		return Member{}, SessionCredentials{}, err
	}
	if err := validatePassword(password); err != nil {
		return Member{}, SessionCredentials{}, err
	}
	passwordHash, err := hashPassword(password)
	if err != nil {
		return Member{}, SessionCredentials{}, err
	}
	memberID, err := randomToken(16)
	if err != nil {
		return Member{}, SessionCredentials{}, err
	}
	now := s.now().UTC()
	session, err := newSessionCredentials(now)
	if err != nil {
		return Member{}, SessionCredentials{}, err
	}
	invitationHash := tokenHash(invitationToken)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Member{}, SessionCredentials{}, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
		UPDATE invitations SET use_count = use_count + 1
		WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? AND use_count < max_uses`,
		invitationHash[:], databaseTime(now))
	if err != nil {
		return Member{}, SessionCredentials{}, fmt.Errorf("consume Invitation: %w", err)
	}
	used, _ := result.RowsAffected()
	if used != 1 {
		return Member{}, SessionCredentials{}, ErrInvalidInvitation
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO members(id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
		memberID, username, usernameKey(username), passwordHash, databaseTime(now)); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return Member{}, SessionCredentials{}, ErrInvalidUsername
		}
		return Member{}, SessionCredentials{}, fmt.Errorf("create Member: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO member_roles(member_id, role_id) VALUES (?, 'member')", memberID); err != nil {
		return Member{}, SessionCredentials{}, fmt.Errorf("assign base Member Role: %w", err)
	}
	if err := insertSession(ctx, tx, session, memberID, device, now); err != nil {
		return Member{}, SessionCredentials{}, err
	}
	if err := tx.Commit(); err != nil {
		return Member{}, SessionCredentials{}, err
	}
	return Member{ID: memberID, Username: username}, session, nil
}

func (s *Service) MemberProfile(ctx context.Context, memberID string) (Member, error) {
	var member Member
	var hasAvatar, hasBanner bool
	err := s.db.QueryRowContext(ctx, `SELECT m.id, m.username, COALESCE(m.display_name, ''), m.avatar IS NOT NULL, m.banner IS NOT NULL,
		EXISTS(SELECT 1 FROM community c WHERE c.owner_member_id = m.id) FROM members m WHERE m.id = ?`, memberID).
		Scan(&member.ID, &member.Username, &member.DisplayName, &hasAvatar, &hasBanner, &member.Owner)
	if errors.Is(err, sql.ErrNoRows) {
		return Member{}, ErrInvalidCredentials
	}
	if err != nil {
		return Member{}, err
	}
	if hasAvatar {
		member.AvatarURL = "/api/v1/members/" + member.ID + "/avatar"
	}
	if hasBanner {
		member.BannerURL = "/api/v1/members/" + member.ID + "/banner"
	}
	return member, nil
}

func (s *Service) ListMembers(ctx context.Context) ([]Member, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT m.id, m.username, COALESCE(m.display_name, ''), m.avatar IS NOT NULL, m.banner IS NOT NULL,
		m.disabled_at IS NOT NULL,
		EXISTS(SELECT 1 FROM community c WHERE c.owner_member_id = m.id)
		FROM members m ORDER BY m.username_key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var members []Member
	for rows.Next() {
		var member Member
		var hasAvatar, hasBanner bool
		if err := rows.Scan(&member.ID, &member.Username, &member.DisplayName, &hasAvatar, &hasBanner, &member.Disabled, &member.Owner); err != nil {
			return nil, err
		}
		if hasAvatar {
			member.AvatarURL = "/api/v1/members/" + member.ID + "/avatar"
		}
		if hasBanner {
			member.BannerURL = "/api/v1/members/" + member.ID + "/banner"
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *Service) SetMemberDisabled(ctx context.Context, actor, target Member, disabled bool) error {
	if !actor.Owner || target.Owner || actor.ID == target.ID {
		return ErrForbidden
	}
	value := any(nil)
	if disabled {
		value = databaseTime(s.now())
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "UPDATE members SET disabled_at=? WHERE id=?", value, target.ID); err != nil {
		return err
	}
	if disabled {
		if _, err = tx.ExecContext(ctx, "UPDATE sessions SET revoked_at=? WHERE member_id=? AND revoked_at IS NULL", databaseTime(s.now()), target.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Service) IsMemberDisabled(ctx context.Context, memberID string) bool {
	var disabled bool
	_ = s.db.QueryRowContext(ctx, "SELECT disabled_at IS NOT NULL FROM members WHERE id=?", memberID).Scan(&disabled)
	return disabled
}

func (s *Service) DeleteMember(ctx context.Context, actor, target Member) error {
	if !actor.Owner || target.Owner || actor.ID == target.ID {
		return ErrForbidden
	}
	attachmentFiles, err := memberStorageNames(ctx, s.db, "SELECT storage_name FROM attachments WHERE uploader_id=?", target.ID)
	if err != nil {
		return err
	}
	soundFiles, err := memberStorageNames(ctx, s.db, "SELECT storage_name FROM soundboard_sounds WHERE uploader_id=?", target.ID)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "UPDATE reports SET resolved_by=NULL WHERE resolved_by=?", target.ID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM moderation_records WHERE report_id IN (SELECT id FROM reports WHERE reporter_id=? OR target_member_id=? OR target_message_id IN (SELECT id FROM messages WHERE author_id=?))`, target.ID, target.ID, target.ID); err != nil {
		return err
	}
	for _, statement := range []string{
		`DELETE FROM moderation_records WHERE actor_id=? OR target_member_id=?`, `DELETE FROM reports WHERE reporter_id=? OR target_member_id=?`,
		`DELETE FROM invitations WHERE created_by=?`, `DELETE FROM pinned_messages WHERE pinned_by=?`, `DELETE FROM soundboard_sounds WHERE uploader_id=?`,
		`DELETE FROM reports WHERE target_message_id IN (SELECT id FROM messages WHERE author_id=?)`, `DELETE FROM attachments WHERE uploader_id=?`,
		`DELETE FROM messages WHERE author_id=?`, `DELETE FROM members WHERE id=?`,
	} {
		args := []any{target.ID}
		if strings.Contains(statement, " OR ") {
			args = []any{target.ID, target.ID}
		}
		if _, err = tx.ExecContext(ctx, statement, args...); err != nil {
			return fmt.Errorf("delete Member data: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	for _, name := range attachmentFiles {
		_ = os.Remove(filepath.Join(s.dataDir, "attachments", name))
		_ = os.Remove(filepath.Join(s.dataDir, "attachments", name+".preview.jpg"))
		_ = os.Remove(filepath.Join(s.dataDir, "attachments", name+".preview.png"))
	}
	for _, name := range soundFiles {
		_ = os.Remove(filepath.Join(s.dataDir, "soundboard", name))
	}
	return nil
}

func memberStorageNames(ctx context.Context, db *sql.DB, query, memberID string) ([]string, error) {
	rows, err := db.QueryContext(ctx, query, memberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

func (s *Service) UpdateProfile(ctx context.Context, memberID, username, displayName string) (Member, error) {
	if err := validateUsername(username); err != nil {
		return Member{}, err
	}
	displayName = strings.TrimSpace(displayName)
	if len([]rune(displayName)) > 64 {
		return Member{}, fmt.Errorf("Display Name must be at most 64 characters")
	}
	if _, err := s.db.ExecContext(ctx, "UPDATE members SET username = ?, username_key = ?, display_name = ? WHERE id = ?",
		username, usernameKey(username), displayName, memberID); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return Member{}, ErrInvalidUsername
		}
		return Member{}, err
	}
	return s.MemberProfile(ctx, memberID)
}

func (s *Service) SetAvatar(ctx context.Context, memberID, contentType string, data []byte) error {
	if len(data) == 0 || len(data) > 8<<20 {
		return fmt.Errorf("avatar must be between 1 byte and 8 MiB")
	}
	if contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/webp" {
		return fmt.Errorf("avatar must be PNG, JPEG, or WebP")
	}
	_, err := s.db.ExecContext(ctx, "UPDATE members SET avatar = ?, avatar_content_type = ? WHERE id = ?", data, contentType, memberID)
	return err
}

func (s *Service) RemoveAvatar(ctx context.Context, memberID string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE members SET avatar = NULL, avatar_content_type = NULL WHERE id = ?", memberID)
	return err
}

func (s *Service) Avatar(ctx context.Context, memberID string) ([]byte, string, error) {
	var data []byte
	var contentType string
	if err := s.db.QueryRowContext(ctx, "SELECT avatar, avatar_content_type FROM members WHERE id = ? AND avatar IS NOT NULL", memberID).Scan(&data, &contentType); err != nil {
		return nil, "", err
	}
	return data, contentType, nil
}

func (s *Service) SetBanner(ctx context.Context, memberID, contentType string, data []byte) error {
	if len(data) == 0 || len(data) > 8<<20 {
		return fmt.Errorf("banner must be between 1 byte and 8 MiB")
	}
	if contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/webp" {
		return fmt.Errorf("banner must be PNG, JPEG, or WebP")
	}
	_, err := s.db.ExecContext(ctx, "UPDATE members SET banner = ?, banner_content_type = ? WHERE id = ?", data, contentType, memberID)
	return err
}

func (s *Service) RemoveBanner(ctx context.Context, memberID string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE members SET banner = NULL, banner_content_type = NULL WHERE id = ?", memberID)
	return err
}

func (s *Service) Banner(ctx context.Context, memberID string) ([]byte, string, error) {
	var data []byte
	var contentType string
	if err := s.db.QueryRowContext(ctx, "SELECT banner, banner_content_type FROM members WHERE id = ? AND banner IS NOT NULL", memberID).Scan(&data, &contentType); err != nil {
		return nil, "", err
	}
	return data, contentType, nil
}

func (s *Service) RevokeSession(ctx context.Context, token string) error {
	hash := tokenHash(token)
	_, err := s.db.ExecContext(ctx, "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
		databaseTime(s.now()), hash[:])
	if err != nil {
		return fmt.Errorf("revoke Session: %w", err)
	}
	return nil
}

func (s *Service) ListSessions(ctx context.Context, memberID, currentToken string) ([]SessionInfo, error) {
	currentHash := tokenHash(currentToken)
	rows, err := s.db.QueryContext(ctx, `
		SELECT session_id, user_agent, created_at, last_seen_at, token_hash = ?
		FROM sessions
		WHERE member_id = ? AND revoked_at IS NULL AND expires_at > ?
		ORDER BY created_at DESC`, currentHash[:], memberID, databaseTime(s.now()))
	if err != nil {
		return nil, fmt.Errorf("list Sessions: %w", err)
	}
	defer rows.Close()
	var sessions []SessionInfo
	for rows.Next() {
		var item SessionInfo
		if err := rows.Scan(&item.ID, &item.Device, &item.CreatedAt, &item.LastActivity, &item.Current); err != nil {
			return nil, fmt.Errorf("read Session: %w", err)
		}
		sessions = append(sessions, item)
	}
	return sessions, rows.Err()
}

func (s *Service) RevokeSessionByID(ctx context.Context, memberID, sessionID string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE sessions SET revoked_at = ?
		WHERE session_id = ? AND member_id = ? AND revoked_at IS NULL`,
		databaseTime(s.now()), sessionID, memberID)
	if err != nil {
		return fmt.Errorf("revoke Session: %w", err)
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ErrSessionNotFound
	}
	return nil
}

func (s *Service) RevokeAllSessions(ctx context.Context, memberID string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL",
		databaseTime(s.now()), memberID)
	if err != nil {
		return fmt.Errorf("revoke all Sessions: %w", err)
	}
	return nil
}

func (s *Service) VerifyCSRF(ctx context.Context, sessionToken, csrfToken string) bool {
	sessionHash := tokenHash(sessionToken)
	csrfHash := tokenHash(csrfToken)
	var valid bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM sessions
		WHERE token_hash = ? AND csrf_token_hash = ? AND revoked_at IS NULL AND expires_at > ?)`,
		sessionHash[:], csrfHash[:], databaseTime(s.now())).Scan(&valid)
	return err == nil && valid
}

func (s *Service) IssueRecoveryToken(ctx context.Context, actor Member, memberID string) (RecoveryToken, error) {
	if !actor.Owner {
		return RecoveryToken{}, ErrForbidden
	}
	var exists bool
	if err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM members WHERE id = ?)", memberID).Scan(&exists); err != nil || !exists {
		return RecoveryToken{}, ErrInvalidRecovery
	}
	token, err := randomToken(32)
	if err != nil {
		return RecoveryToken{}, err
	}
	hash := tokenHash(token)
	now := s.now().UTC()
	expires := now.Add(recoveryLifetime)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RecoveryToken{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "UPDATE recovery_tokens SET superseded_at = ? WHERE member_id = ? AND consumed_at IS NULL AND superseded_at IS NULL",
		databaseTime(now), memberID); err != nil {
		return RecoveryToken{}, fmt.Errorf("supersede Recovery Tokens: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO recovery_tokens(token_hash, member_id, created_at, expires_at)
		VALUES (?, ?, ?, ?)`, hash[:], memberID, databaseTime(now), databaseTime(expires)); err != nil {
		return RecoveryToken{}, fmt.Errorf("create Recovery Token: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return RecoveryToken{}, err
	}
	return RecoveryToken{Token: token, ExpiresAt: databaseTime(expires)}, nil
}

func (s *Service) RedeemRecoveryToken(ctx context.Context, token, password string) error {
	if err := validatePassword(password); err != nil {
		return err
	}
	passwordHash, err := hashPassword(password)
	if err != nil {
		return err
	}
	hash := tokenHash(token)
	now := s.now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var memberID string
	err = tx.QueryRowContext(ctx, `
		SELECT member_id FROM recovery_tokens
		WHERE token_hash = ? AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at > ?`,
		hash[:], databaseTime(now)).Scan(&memberID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidRecovery
	}
	if err != nil {
		return fmt.Errorf("read Recovery Token: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE members SET password_hash = ? WHERE id = ?", passwordHash, memberID); err != nil {
		return fmt.Errorf("replace password: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL",
		databaseTime(now), memberID); err != nil {
		return fmt.Errorf("revoke Sessions after recovery: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE recovery_tokens SET consumed_at = ? WHERE token_hash = ?",
		databaseTime(now), hash[:]); err != nil {
		return fmt.Errorf("consume Recovery Token: %w", err)
	}
	return tx.Commit()
}

func (s *Service) RecoverOwner(ctx context.Context, username, password string) error {
	if err := validateUsername(username); err != nil {
		return err
	}
	if err := validatePassword(password); err != nil {
		return err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var ownerID string
	err = tx.QueryRowContext(ctx, "SELECT owner_member_id FROM community WHERE id = 1").Scan(&ownerID)
	if err != nil {
		return fmt.Errorf("recover Owner: Community Owner has not been created")
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE members SET username = ?, username_key = ?, password_hash = ? WHERE id = ?",
		username, usernameKey(username), hash, ownerID); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return ErrInvalidUsername
		}
		return fmt.Errorf("update Owner: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL",
		databaseTime(s.now()), ownerID); err != nil {
		return fmt.Errorf("revoke Owner Sessions: %w", err)
	}
	return tx.Commit()
}

func (s *Service) VerifyMemberPassword(ctx context.Context, memberID, password string) bool {
	var encoded string
	if err := s.db.QueryRowContext(ctx, "SELECT password_hash FROM members WHERE id = ?", memberID).Scan(&encoded); err != nil {
		return false
	}
	valid, err := verifyPassword(password, encoded)
	return err == nil && valid
}

func (s *Service) AnonymizeMember(ctx context.Context, member Member, password, confirmation string) error {
	if member.Owner {
		return fmt.Errorf("Owner must transfer ownership before Account Deletion")
	}
	if confirmation != "DELETE MY ACCOUNT" || !s.VerifyMemberPassword(ctx, member.ID, password) {
		return ErrInvalidCredentials
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := databaseTime(s.now())
	username := "deleted-" + member.ID
	if len(username) > 64 {
		username = username[:64]
	}
	if _, err = tx.ExecContext(ctx, `UPDATE members SET username=?,username_key=?,display_name=NULL,avatar=NULL,avatar_content_type=NULL,banner=NULL,banner_content_type=NULL,password_hash=?,presence_mode='available',suspended_until=NULL,timed_out_until=NULL WHERE id=?`, username, username, "account-deleted", member.ID); err != nil {
		return err
	}
	for _, statement := range []string{`UPDATE sessions SET revoked_at=? WHERE member_id=? AND revoked_at IS NULL`, `DELETE FROM member_roles WHERE member_id=?`, `DELETE FROM read_positions WHERE member_id=?`, `DELETE FROM message_reactions WHERE member_id=?`, `DELETE FROM message_mentions WHERE member_id=?`, `DELETE FROM channel_notification_settings WHERE member_id=?`, `DELETE FROM member_notification_settings WHERE member_id=?`, `DELETE FROM web_push_subscriptions WHERE member_id=?`, `DELETE FROM mobile_push_subscriptions WHERE member_id=?`, `DELETE FROM member_blocks WHERE blocker_id=? OR blocked_id=?`} {
		args := []any{member.ID}
		if strings.Contains(statement, "revoked_at") {
			args = []any{now, member.ID}
		}
		if strings.Contains(statement, " OR ") {
			args = []any{member.ID, member.ID}
		}
		if _, err = tx.ExecContext(ctx, statement, args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Service) ownerExists(ctx context.Context) (bool, error) {
	var exists bool
	if err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM community WHERE id = 1 AND owner_member_id IS NOT NULL)").Scan(&exists); err != nil {
		return false, fmt.Errorf("check Community Owner: %w", err)
	}
	return exists, nil
}

type sessionInserter interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func insertSession(ctx context.Context, target sessionInserter, credentials SessionCredentials, memberID, device string, now time.Time) error {
	hash := tokenHash(credentials.Token)
	csrfHash := tokenHash(credentials.CSRFToken)
	_, err := target.ExecContext(ctx, `
		INSERT INTO sessions(token_hash, member_id, created_at, last_seen_at, expires_at, session_id, user_agent, csrf_token_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, hash[:], memberID, databaseTime(now), databaseTime(now), databaseTime(credentials.ExpiresAt), credentials.SessionID, device, csrfHash[:])
	if err != nil {
		return fmt.Errorf("create Session: %w", err)
	}
	return nil
}

func newSessionCredentials(now time.Time) (SessionCredentials, error) {
	token, err := randomToken(32)
	if err != nil {
		return SessionCredentials{}, err
	}
	csrf, err := randomToken(32)
	if err != nil {
		return SessionCredentials{}, err
	}
	sessionID, err := randomToken(12)
	if err != nil {
		return SessionCredentials{}, err
	}
	return SessionCredentials{Token: token, CSRFToken: csrf, SessionID: sessionID, ExpiresAt: now.Add(sessionLifetime)}, nil
}

func databaseTime(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000000000Z")
}

func validateUsername(username string) error {
	length := utf8.RuneCountInString(username)
	if length < 3 || length > 32 {
		return ErrInvalidUsername
	}
	for _, character := range username {
		if !unicode.IsLetter(character) && !unicode.IsNumber(character) && character != '.' && character != '_' && character != '-' {
			return ErrInvalidUsername
		}
	}
	return nil
}

func validatePassword(password string) error {
	if len(password) < 12 || len(password) > 1024 {
		return ErrInvalidPassword
	}
	return nil
}

func usernameKey(username string) string { return strings.ToLower(username) }

func randomToken(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("generate secure token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func tokenHash(token string) [32]byte { return sha256.Sum256([]byte(token)) }

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLength)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

func verifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, fmt.Errorf("invalid password hash")
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, fmt.Errorf("unsupported password hash version")
	}
	var memory, iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false, fmt.Errorf("invalid password hash parameters")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, fmt.Errorf("invalid password hash salt")
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, fmt.Errorf("invalid password hash value")
	}
	actual := argon2.IDKey([]byte(password), salt, iterations, memory, threads, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}

type loginLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	records map[string]attempts
}

type attempts struct {
	count int
	since time.Time
}

func newLoginLimiter(limit int, window time.Duration) *loginLimiter {
	return &loginLimiter{limit: limit, window: window, records: make(map[string]attempts)}
}

func (l *loginLimiter) Allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	record := l.records[key]
	if now.Sub(record.since) >= l.window {
		delete(l.records, key)
		return true
	}
	return record.count < l.limit
}

func (l *loginLimiter) Failed(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	record := l.records[key]
	if record.since.IsZero() || now.Sub(record.since) >= l.window {
		record = attempts{since: now}
	}
	record.count++
	l.records[key] = record
}

func (l *loginLimiter) Success(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.records, key)
}
