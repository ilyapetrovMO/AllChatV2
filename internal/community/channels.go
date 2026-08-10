// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"allchat/internal/identity"
)

type Category struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Position int    `json:"position"`
	Archived bool   `json:"archived"`
}

type Channel struct {
	ID         string `json:"id"`
	CategoryID string `json:"category_id"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Position   int    `json:"position"`
	Archived   bool   `json:"archived"`
}

type ChannelOverview struct {
	Categories []Category `json:"categories"`
	Channels   []Channel  `json:"channels"`
}

type CategoryInput struct {
	Name     string `json:"name"`
	Position int    `json:"position"`
}

type ChannelInput struct {
	CategoryID string `json:"category_id"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Position   int    `json:"position"`
}

type OverrideInput struct {
	RoleID     string `json:"role_id"`
	Permission string `json:"permission"`
	Effect     string `json:"effect"`
}

func (s *Service) ChannelOverview(ctx context.Context, member identity.Member, includeArchived bool) (ChannelOverview, error) {
	canManage, _ := s.HasPermission(ctx, member.ID, PermissionManageChannels)
	if includeArchived && !canManage {
		return ChannelOverview{}, ErrForbidden
	}
	categoryQuery := "SELECT id, name, position, archived_at IS NOT NULL FROM categories WHERE id != '" + directMessageCategoryID + "'"
	if !includeArchived {
		categoryQuery += " AND archived_at IS NULL"
	}
	categoryQuery += " ORDER BY position, name"
	rows, err := s.db.QueryContext(ctx, categoryQuery)
	if err != nil {
		return ChannelOverview{}, err
	}
	var overview ChannelOverview
	for rows.Next() {
		var item Category
		if err := rows.Scan(&item.ID, &item.Name, &item.Position, &item.Archived); err != nil {
			rows.Close()
			return ChannelOverview{}, err
		}
		overview.Categories = append(overview.Categories, item)
	}
	rows.Close()
	channelQuery := "SELECT id, category_id, name, type, position, archived_at IS NOT NULL FROM channels WHERE category_id != '" + directMessageCategoryID + "'"
	if !includeArchived {
		channelQuery += " AND archived_at IS NULL AND category_id IN (SELECT id FROM categories WHERE archived_at IS NULL)"
	}
	channelQuery += " ORDER BY position, name"
	rows, err = s.db.QueryContext(ctx, channelQuery)
	if err != nil {
		return ChannelOverview{}, err
	}
	var candidates []Channel
	for rows.Next() {
		var item Channel
		if err := rows.Scan(&item.ID, &item.CategoryID, &item.Name, &item.Type, &item.Position, &item.Archived); err != nil {
			return ChannelOverview{}, err
		}
		candidates = append(candidates, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return ChannelOverview{}, err
	}
	rows.Close()
	for _, item := range candidates {
		visible, err := s.CanUseChannel(ctx, member.ID, item.ID, PermissionViewChannels, true)
		if err != nil {
			return ChannelOverview{}, err
		}
		if visible {
			overview.Channels = append(overview.Channels, item)
		}
	}
	return overview, nil
}

func (s *Service) CreateCategory(ctx context.Context, actor identity.Member, input CategoryInput) (Category, error) {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageChannels); !ok {
		return Category{}, ErrForbidden
	}
	if err := validateName(input.Name); err != nil || input.Position < 0 {
		return Category{}, fmt.Errorf("%w: invalid Category", ErrInvalidInput)
	}
	id, err := randomID()
	if err != nil {
		return Category{}, err
	}
	_, err = s.db.ExecContext(ctx, "INSERT INTO categories(id, name, position) VALUES (?, ?, ?)", id, strings.TrimSpace(input.Name), input.Position)
	return Category{ID: id, Name: strings.TrimSpace(input.Name), Position: input.Position}, err
}

func (s *Service) UpdateCategory(ctx context.Context, actor identity.Member, categoryID string, input CategoryInput) (Category, error) {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageChannels); !ok {
		return Category{}, ErrForbidden
	}
	if err := validateName(input.Name); err != nil || input.Position < 0 {
		return Category{}, fmt.Errorf("%w: invalid Category", ErrInvalidInput)
	}
	result, err := s.db.ExecContext(ctx, "UPDATE categories SET name = ?, position = ? WHERE id = ?", strings.TrimSpace(input.Name), input.Position, categoryID)
	if err != nil {
		return Category{}, err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return Category{}, ErrNotFound
	}
	return Category{ID: categoryID, Name: strings.TrimSpace(input.Name), Position: input.Position}, nil
}

func (s *Service) SetCategoryArchived(ctx context.Context, actor identity.Member, categoryID string, archived bool) error {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageChannels); !ok {
		return ErrForbidden
	}
	var value any
	if archived {
		value = databaseTime(time.Now())
	}
	result, err := s.db.ExecContext(ctx, "UPDATE categories SET archived_at = ? WHERE id = ?", value, categoryID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) CreateChannel(ctx context.Context, actor identity.Member, input ChannelInput) (Channel, error) {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageChannels); !ok {
		return Channel{}, ErrForbidden
	}
	if err := validateName(input.Name); err != nil || input.Position < 0 || (input.Type != "text" && input.Type != "voice") {
		return Channel{}, fmt.Errorf("%w: invalid Channel", ErrInvalidInput)
	}
	id, err := randomID()
	if err != nil {
		return Channel{}, err
	}
	_, err = s.db.ExecContext(ctx, "INSERT INTO channels(id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?)", id, input.CategoryID, strings.TrimSpace(input.Name), input.Type, input.Position)
	if err != nil {
		return Channel{}, fmt.Errorf("%w: invalid Channel", ErrInvalidInput)
	}
	return Channel{ID: id, CategoryID: input.CategoryID, Name: strings.TrimSpace(input.Name), Type: input.Type, Position: input.Position}, nil
}

func (s *Service) UpdateChannel(ctx context.Context, actor identity.Member, channelID string, input ChannelInput) (Channel, error) {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageChannels); !ok {
		return Channel{}, ErrForbidden
	}
	if err := validateName(input.Name); err != nil || input.Position < 0 || (input.Type != "text" && input.Type != "voice") {
		return Channel{}, fmt.Errorf("%w: invalid Channel", ErrInvalidInput)
	}
	result, err := s.db.ExecContext(ctx, "UPDATE channels SET category_id = ?, name = ?, type = ?, position = ? WHERE id = ?", input.CategoryID, strings.TrimSpace(input.Name), input.Type, input.Position, channelID)
	if err != nil {
		return Channel{}, fmt.Errorf("%w: invalid Channel", ErrInvalidInput)
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return Channel{}, ErrNotFound
	}
	return Channel{ID: channelID, CategoryID: input.CategoryID, Name: strings.TrimSpace(input.Name), Type: input.Type, Position: input.Position}, nil
}

func (s *Service) SetChannelArchived(ctx context.Context, actor identity.Member, channelID string, archived bool) error {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageChannels); !ok {
		return ErrForbidden
	}
	var value any
	if archived {
		value = databaseTime(time.Now())
	}
	result, err := s.db.ExecContext(ctx, "UPDATE channels SET archived_at = ? WHERE id = ?", value, channelID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) SetChannelOverride(ctx context.Context, actor identity.Member, channelID string, input OverrideInput) error {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageChannels); !ok {
		return ErrForbidden
	}
	if !validPermissions[input.Permission] || (input.Effect != "allow" && input.Effect != "deny") {
		return fmt.Errorf("%w: invalid Permission override", ErrInvalidInput)
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO channel_permission_overrides(channel_id, role_id, permission, effect)
		VALUES (?, ?, ?, ?) ON CONFLICT(channel_id, role_id, permission) DO UPDATE SET effect = excluded.effect`,
		channelID, input.RoleID, input.Permission, input.Effect)
	return err
}

func (s *Service) PrepareChannelDeletion(ctx context.Context, actor identity.Member, channelID string) (string, error) {
	if !actor.Owner {
		return "", ErrForbidden
	}
	var exists bool
	if err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM channels WHERE id = ?)", channelID).Scan(&exists); err != nil || !exists {
		return "", ErrNotFound
	}
	token, err := randomSecret()
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256([]byte(token))
	_, err = s.db.ExecContext(ctx, `INSERT INTO deletion_confirmations(resource_type, resource_id, token_hash, expires_at) VALUES ('channel', ?, ?, ?)
		ON CONFLICT(resource_type, resource_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at`,
		channelID, hash[:], databaseTime(time.Now().Add(5*time.Minute)))
	return token, err
}

func (s *Service) DeleteChannel(ctx context.Context, actor identity.Member, channelID, token string) error {
	if !actor.Owner {
		return ErrForbidden
	}
	hash := sha256.Sum256([]byte(token))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var valid bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM deletion_confirmations
		WHERE resource_type = 'channel' AND resource_id = ? AND token_hash = ? AND expires_at > ?)`,
		channelID, hash[:], databaseTime(time.Now())).Scan(&valid); err != nil || !valid {
		return fmt.Errorf("%w: deletion confirmation is invalid or stale", ErrInvalidInput)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE attachments SET state = 'garbage', gc_after = ? WHERE message_id IN
		(SELECT id FROM messages WHERE channel_id = ?) AND state = 'published'`, databaseTime(time.Now().Add(attachmentRecovery)), channelID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM message_search WHERE channel_id = ?", channelID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM channels WHERE id = ?", channelID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM deletion_confirmations WHERE resource_type = 'channel' AND resource_id = ?", channelID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) CanUseChannel(ctx context.Context, memberID, channelID, permission string, allowArchived bool) (bool, error) {
	direct, err := s.isDirectMessage(ctx, channelID)
	if err != nil {
		return false, err
	}
	if direct {
		participant, _, err := s.directMessageParticipant(ctx, memberID, channelID)
		return participant, err
	}
	var archived bool
	var channelType string
	err = s.db.QueryRowContext(ctx, "SELECT archived_at IS NOT NULL, type FROM channels WHERE id = ?", channelID).Scan(&archived, &channelType)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil || (archived && !allowArchived) {
		return false, err
	}
	if permission == PermissionSendMessages && channelType != "text" {
		return false, nil
	}
	allowed, err := s.HasPermission(ctx, memberID, permission)
	if err != nil {
		return false, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT cpo.effect FROM channel_permission_overrides cpo
		JOIN member_roles mr ON mr.role_id = cpo.role_id
		WHERE mr.member_id = ? AND cpo.channel_id = ? AND cpo.permission = ?`, memberID, channelID, permission)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var effect string
		if err := rows.Scan(&effect); err != nil {
			return false, err
		}
		if effect == "deny" {
			return false, nil
		}
		if effect == "allow" {
			allowed = true
		}
	}
	return allowed, rows.Err()
}

func validateName(value string) error {
	length := len([]rune(strings.TrimSpace(value)))
	if length < 1 || length > 80 {
		return fmt.Errorf("name must be 1-80 characters")
	}
	return nil
}
