// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"allchat/internal/identity"
)

const directMessageCategoryID = "__direct_messages"

type DirectMessage struct {
	ID          string          `json:"id"`
	Other       identity.Member `json:"other"`
	BlockedByMe bool            `json:"blocked_by_me"`
	BlockedMe   bool            `json:"blocked_me"`
	Unread      int64           `json:"unread"`
	CreatedAt   string          `json:"created_at"`
}

func (s *Service) OpenDirectMessage(ctx context.Context, member identity.Member, otherMemberID string) (DirectMessage, error) {
	if otherMemberID == "" || otherMemberID == member.ID {
		return DirectMessage{}, ErrInvalidInput
	}
	var exists bool
	if err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM members WHERE id = ?)", otherMemberID).Scan(&exists); err != nil {
		return DirectMessage{}, err
	}
	if !exists {
		return DirectMessage{}, ErrNotFound
	}
	low, high := orderedMemberIDs(member.ID, otherMemberID)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DirectMessage{}, err
	}
	defer tx.Rollback()
	var id string
	err = tx.QueryRowContext(ctx, "SELECT id FROM direct_messages WHERE member_low_id = ? AND member_high_id = ?", low, high).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		id, err = randomID()
		if err != nil {
			return DirectMessage{}, err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO channels(id, category_id, name, type, position)
			VALUES (?, ?, ?, 'text', 0)`, id, directMessageCategoryID, "dm-"+id); err != nil {
			return DirectMessage{}, fmt.Errorf("create Direct Message conversation: %w", err)
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO direct_messages(id, member_low_id, member_high_id, created_at)
			VALUES (?, ?, ?, ?)`, id, low, high, databaseTimeNow()); err != nil {
			return DirectMessage{}, fmt.Errorf("create Direct Message: %w", err)
		}
	} else if err != nil {
		return DirectMessage{}, err
	}
	if err := tx.Commit(); err != nil {
		return DirectMessage{}, err
	}
	return s.DirectMessage(ctx, member, id)
}

func (s *Service) DirectMessage(ctx context.Context, member identity.Member, id string) (DirectMessage, error) {
	var item DirectMessage
	var low, high string
	if err := s.db.QueryRowContext(ctx, `SELECT id, member_low_id, member_high_id, created_at
		FROM direct_messages WHERE id = ? AND ? IN (member_low_id, member_high_id)`, id, member.ID).
		Scan(&item.ID, &low, &high, &item.CreatedAt); errors.Is(err, sql.ErrNoRows) {
		return DirectMessage{}, ErrNotFound
	} else if err != nil {
		return DirectMessage{}, err
	}
	otherID := low
	if otherID == member.ID {
		otherID = high
	}
	var hasAvatar bool
	if err := s.db.QueryRowContext(ctx, `SELECT id, username, COALESCE(display_name, ''), avatar IS NOT NULL
		FROM members WHERE id = ?`, otherID).Scan(&item.Other.ID, &item.Other.Username, &item.Other.DisplayName, &hasAvatar); err != nil {
		return DirectMessage{}, err
	}
	if hasAvatar {
		item.Other.AvatarURL = "/api/v1/members/" + otherID + "/avatar"
	}
	if err := s.db.QueryRowContext(ctx, `SELECT
		EXISTS(SELECT 1 FROM member_blocks WHERE blocker_id = ? AND blocked_id = ?),
		EXISTS(SELECT 1 FROM member_blocks WHERE blocker_id = ? AND blocked_id = ?)`,
		member.ID, otherID, otherID, member.ID).Scan(&item.BlockedByMe, &item.BlockedMe); err != nil {
		return DirectMessage{}, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(
		(SELECT count FROM unread_counts WHERE member_id = ? AND channel_id = ?), 0)`,
		member.ID, id).Scan(&item.Unread); err != nil {
		return DirectMessage{}, err
	}
	return item, nil
}

func (s *Service) ListDirectMessages(ctx context.Context, member identity.Member) ([]DirectMessage, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM direct_messages
		WHERE member_low_id = ? OR member_high_id = ?
		ORDER BY COALESCE((SELECT MAX(created_at) FROM messages WHERE channel_id = direct_messages.id), created_at) DESC`, member.ID, member.ID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	result := make([]DirectMessage, 0, len(ids))
	for _, id := range ids {
		item, err := s.DirectMessage(ctx, member, id)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) SetBlock(ctx context.Context, member identity.Member, otherMemberID string, blocked bool) error {
	if otherMemberID == "" || otherMemberID == member.ID {
		return ErrInvalidInput
	}
	var exists bool
	if err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM members WHERE id = ?)", otherMemberID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	if blocked {
		_, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO member_blocks(blocker_id, blocked_id, created_at)
			VALUES (?, ?, ?)`, member.ID, otherMemberID, databaseTimeNow())
		return err
	}
	_, err := s.db.ExecContext(ctx, "DELETE FROM member_blocks WHERE blocker_id = ? AND blocked_id = ?", member.ID, otherMemberID)
	return err
}

// CanStartDirectCall is the shared initiation guard used by the later Direct Call module.
func (s *Service) CanStartDirectCall(ctx context.Context, member identity.Member, directMessageID string) (bool, error) {
	participant, blocked, err := s.directMessageParticipant(ctx, member.ID, directMessageID)
	if err != nil || !participant {
		return false, err
	}
	return !blocked, nil
}

func (s *Service) directMessageParticipant(ctx context.Context, memberID, conversationID string) (bool, bool, error) {
	var participant bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM direct_messages
		WHERE id = ? AND ? IN (member_low_id, member_high_id))`, conversationID, memberID).Scan(&participant)
	if err != nil || !participant {
		return participant, false, err
	}
	blocked, err := s.directMessageBlocked(ctx, conversationID)
	return true, blocked, err
}

func (s *Service) directMessageBlocked(ctx context.Context, conversationID string) (bool, error) {
	var blocked bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM direct_messages dm JOIN member_blocks b
		ON (b.blocker_id = dm.member_low_id AND b.blocked_id = dm.member_high_id)
		OR (b.blocker_id = dm.member_high_id AND b.blocked_id = dm.member_low_id)
		WHERE dm.id = ?)`, conversationID).Scan(&blocked)
	return blocked, err
}

func (s *Service) isDirectMessage(ctx context.Context, conversationID string) (bool, error) {
	var direct bool
	err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM direct_messages WHERE id = ?)", conversationID).Scan(&direct)
	return direct, err
}

func orderedMemberIDs(first, second string) (string, string) {
	if strings.Compare(first, second) < 0 {
		return first, second
	}
	return second, first
}
