// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"allchat/internal/identity"
)

var (
	ErrForbidden       = errors.New("permission denied")
	ErrNotFound        = errors.New("resource not found")
	ErrInvalidRole     = errors.New("invalid Role")
	ErrImmutableRole   = errors.New("default Roles cannot be changed or retired")
	ErrHierarchy       = errors.New("Role hierarchy does not permit this action")
	ErrInvalidTransfer = errors.New("ownership transfer was not confirmed or authenticated")
	ErrInvalidInput    = errors.New("invalid input")
)

const (
	PermissionManageRoles       = "manage_roles"
	PermissionManageMembers     = "manage_members"
	PermissionManageChannels    = "manage_channels"
	PermissionCreateInvitations = "create_invitations"
	PermissionModerate          = "moderate"
	PermissionViewAudit         = "view_audit"
	PermissionViewChannels      = "view_channels"
	PermissionSendMessages      = "send_messages"
	PermissionConnectVoice      = "connect_voice"
	PermissionManageSoundboard  = "manage_soundboard"
	PermissionUseSoundboard     = "use_soundboard"
)

var validPermissions = map[string]bool{
	PermissionManageRoles: true, PermissionManageMembers: true, PermissionManageChannels: true,
	PermissionCreateInvitations: true, PermissionModerate: true, PermissionViewAudit: true,
	PermissionViewChannels: true, PermissionSendMessages: true, PermissionConnectVoice: true,
	PermissionManageSoundboard: true, PermissionUseSoundboard: true,
}

type Service struct {
	db                 *sql.DB
	dataDir            string
	maxAttachmentBytes int64
	maxStorageBytes    int64
}

func New(db *sql.DB, dataDir ...string) *Service {
	directory := ""
	if len(dataDir) > 0 {
		directory = dataDir[0]
	}
	return newServiceWithAttachmentLimits(db, directory)
}

type Role struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Position    int      `json:"position"`
	Default     bool     `json:"default"`
	Owner       bool     `json:"owner"`
	Permissions []string `json:"permissions"`
}

type RoleInput struct {
	Name        string   `json:"name"`
	Position    int      `json:"position"`
	Permissions []string `json:"permissions"`
}

type Invitation struct {
	ID        string `json:"id"`
	Token     string `json:"token,omitempty"`
	ExpiresAt string `json:"expires_at"`
	MaxUses   int    `json:"max_uses"`
	UseCount  int    `json:"use_count"`
	Revoked   bool   `json:"revoked"`
}

type InvitationInput struct {
	ExpiresInMinutes int `json:"expires_in_minutes"`
	MaxUses          int `json:"max_uses"`
}

func (s *Service) ListRoles(ctx context.Context, actor identity.Member) ([]Role, error) {
	if _, err := s.highestPosition(ctx, actor.ID); err != nil {
		return nil, ErrForbidden
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, position, is_default, is_owner FROM roles WHERE retired_at IS NULL ORDER BY position DESC`)
	if err != nil {
		return nil, err
	}
	var roles []Role
	for rows.Next() {
		var role Role
		if err := rows.Scan(&role.ID, &role.Name, &role.Position, &role.Default, &role.Owner); err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for index := range roles {
		permissions, err := s.rolePermissions(ctx, roles[index].ID)
		if err != nil {
			return nil, err
		}
		roles[index].Permissions = permissions
	}
	return roles, nil
}

func (s *Service) CreateRole(ctx context.Context, actor identity.Member, input RoleInput) (Role, error) {
	if err := s.authorizeRoleChange(ctx, actor, input.Position); err != nil {
		return Role{}, err
	}
	if err := validateRoleInput(input); err != nil {
		return Role{}, err
	}
	id, err := randomID()
	if err != nil {
		return Role{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Role{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "INSERT INTO roles(id, name, position) VALUES (?, ?, ?)", id, strings.TrimSpace(input.Name), input.Position); err != nil {
		return Role{}, ErrInvalidRole
	}
	if err := replacePermissions(ctx, tx, id, input.Permissions); err != nil {
		return Role{}, err
	}
	if err := tx.Commit(); err != nil {
		return Role{}, err
	}
	return Role{ID: id, Name: strings.TrimSpace(input.Name), Position: input.Position, Permissions: uniquePermissions(input.Permissions)}, nil
}

func (s *Service) UpdateRole(ctx context.Context, actor identity.Member, roleID string, input RoleInput) (Role, error) {
	role, err := s.role(ctx, roleID)
	if err != nil {
		return Role{}, err
	}
	if role.Default {
		return Role{}, ErrImmutableRole
	}
	if err := s.authorizeRoleChange(ctx, actor, role.Position); err != nil {
		return Role{}, err
	}
	if err := s.authorizeRoleChange(ctx, actor, input.Position); err != nil {
		return Role{}, err
	}
	if err := validateRoleInput(input); err != nil {
		return Role{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Role{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "UPDATE roles SET name = ?, position = ? WHERE id = ?", strings.TrimSpace(input.Name), input.Position, roleID); err != nil {
		return Role{}, ErrInvalidRole
	}
	if err := replacePermissions(ctx, tx, roleID, input.Permissions); err != nil {
		return Role{}, err
	}
	if err := tx.Commit(); err != nil {
		return Role{}, err
	}
	return Role{ID: roleID, Name: strings.TrimSpace(input.Name), Position: input.Position, Permissions: uniquePermissions(input.Permissions)}, nil
}

func (s *Service) RetireRole(ctx context.Context, actor identity.Member, roleID string) error {
	role, err := s.role(ctx, roleID)
	if err != nil {
		return err
	}
	if role.Default {
		return ErrImmutableRole
	}
	if err := s.authorizeRoleChange(ctx, actor, role.Position); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "DELETE FROM member_roles WHERE role_id = ?", roleID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE roles SET retired_at = ? WHERE id = ?", now, roleID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) AssignRole(ctx context.Context, actor identity.Member, targetMemberID, roleID string) error {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageMembers); !ok {
		return ErrForbidden
	}
	actorPosition, err := s.highestPosition(ctx, actor.ID)
	if err != nil {
		return ErrForbidden
	}
	targetPosition, err := s.highestPosition(ctx, targetMemberID)
	if err != nil {
		return ErrNotFound
	}
	role, err := s.role(ctx, roleID)
	if err != nil {
		return err
	}
	if role.Owner || actorPosition <= targetPosition || actorPosition <= role.Position {
		return ErrHierarchy
	}
	_, err = s.db.ExecContext(ctx, "INSERT OR IGNORE INTO member_roles(member_id, role_id) VALUES (?, ?)", targetMemberID, roleID)
	return err
}

func (s *Service) TransferOwnership(ctx context.Context, actor identity.Member, targetMemberID string) error {
	if !actor.Owner || actor.ID == targetMemberID {
		return ErrInvalidTransfer
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM members WHERE id = ?)", targetMemberID).Scan(&exists); err != nil || !exists {
		return ErrNotFound
	}
	result, err := tx.ExecContext(ctx, "UPDATE community SET owner_member_id = ? WHERE id = 1 AND owner_member_id = ?", targetMemberID, actor.ID)
	if err != nil {
		return err
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		return ErrInvalidTransfer
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM member_roles WHERE role_id = 'owner' AND member_id IN (?, ?)", actor.ID, targetMemberID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO member_roles(member_id, role_id) VALUES (?, 'owner')", targetMemberID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO member_roles(member_id, role_id) VALUES (?, 'admin')", actor.ID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) HasPermission(ctx context.Context, memberID, permission string) (bool, error) {
	var allowed bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id JOIN role_permissions rp ON rp.role_id = r.id
		WHERE mr.member_id = ? AND r.retired_at IS NULL AND rp.permission = ?)`, memberID, permission).Scan(&allowed)
	return allowed, err
}

func (s *Service) CreateInvitation(ctx context.Context, actor identity.Member, input InvitationInput) (Invitation, error) {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionCreateInvitations); !ok {
		return Invitation{}, ErrForbidden
	}
	if input.ExpiresInMinutes < 1 || input.ExpiresInMinutes > 60*24*30 || input.MaxUses < 1 || input.MaxUses > 100 {
		return Invitation{}, fmt.Errorf("%w: Invitation expiry or use count is outside safe limits", ErrInvalidInput)
	}
	id, err := randomID()
	if err != nil {
		return Invitation{}, err
	}
	token, err := randomSecret()
	if err != nil {
		return Invitation{}, err
	}
	hash := sha256.Sum256([]byte(token))
	now := time.Now().UTC()
	expires := now.Add(time.Duration(input.ExpiresInMinutes) * time.Minute)
	_, err = s.db.ExecContext(ctx, `INSERT INTO invitations(id, token_hash, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)`,
		id, hash[:], actor.ID, databaseTime(now), databaseTime(expires), input.MaxUses)
	if err != nil {
		return Invitation{}, err
	}
	return Invitation{ID: id, Token: token, ExpiresAt: databaseTime(expires), MaxUses: input.MaxUses}, nil
}

func (s *Service) ListInvitations(ctx context.Context, actor identity.Member) ([]Invitation, error) {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionCreateInvitations); !ok {
		return nil, ErrForbidden
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, expires_at, max_uses, use_count, revoked_at IS NOT NULL FROM invitations ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Invitation
	for rows.Next() {
		var invitation Invitation
		if err := rows.Scan(&invitation.ID, &invitation.ExpiresAt, &invitation.MaxUses, &invitation.UseCount, &invitation.Revoked); err != nil {
			return nil, err
		}
		result = append(result, invitation)
	}
	return result, rows.Err()
}

func (s *Service) RevokeInvitation(ctx context.Context, actor identity.Member, invitationID string) error {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionCreateInvitations); !ok {
		return ErrForbidden
	}
	result, err := s.db.ExecContext(ctx, "UPDATE invitations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", databaseTime(time.Now()), invitationID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) authorizeRoleChange(ctx context.Context, actor identity.Member, position int) error {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageRoles); !ok {
		return ErrForbidden
	}
	highest, err := s.highestPosition(ctx, actor.ID)
	if err != nil || position >= highest {
		return ErrHierarchy
	}
	return nil
}

func (s *Service) highestPosition(ctx context.Context, memberID string) (int, error) {
	var position int
	err := s.db.QueryRowContext(ctx, `SELECT MAX(r.position) FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.member_id = ? AND r.retired_at IS NULL`, memberID).Scan(&position)
	return position, err
}

func (s *Service) role(ctx context.Context, roleID string) (Role, error) {
	var role Role
	err := s.db.QueryRowContext(ctx, "SELECT id, name, position, is_default, is_owner FROM roles WHERE id = ? AND retired_at IS NULL", roleID).
		Scan(&role.ID, &role.Name, &role.Position, &role.Default, &role.Owner)
	if errors.Is(err, sql.ErrNoRows) {
		return Role{}, ErrNotFound
	}
	if err != nil {
		return Role{}, err
	}
	role.Permissions, err = s.rolePermissions(ctx, roleID)
	return role, err
}

func (s *Service) rolePermissions(ctx context.Context, roleID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission", roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var permission string
		if err := rows.Scan(&permission); err != nil {
			return nil, err
		}
		result = append(result, permission)
	}
	return result, rows.Err()
}

type executor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func replacePermissions(ctx context.Context, target executor, roleID string, permissions []string) error {
	if _, err := target.ExecContext(ctx, "DELETE FROM role_permissions WHERE role_id = ?", roleID); err != nil {
		return err
	}
	for _, permission := range uniquePermissions(permissions) {
		if !validPermissions[permission] {
			return ErrInvalidRole
		}
		if _, err := target.ExecContext(ctx, "INSERT INTO role_permissions(role_id, permission) VALUES (?, ?)", roleID, permission); err != nil {
			return err
		}
	}
	return nil
}

func validateRoleInput(input RoleInput) error {
	name := strings.TrimSpace(input.Name)
	if len(name) < 2 || len(name) > 50 || input.Position <= 0 || input.Position >= 1000 {
		return ErrInvalidRole
	}
	for _, permission := range input.Permissions {
		if !validPermissions[permission] {
			return ErrInvalidRole
		}
	}
	return nil
}

func uniquePermissions(input []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(input))
	for _, permission := range input {
		if !seen[permission] {
			seen[permission] = true
			result = append(result, permission)
		}
	}
	return result
}

func randomID() (string, error) {
	data := make([]byte, 12)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func randomSecret() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func databaseTime(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000000000Z")
}
