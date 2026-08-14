// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"allchat/internal/identity"
)

type ChannelState struct {
	ChannelID    string `json:"channel_id"`
	ReadSequence int64  `json:"read_sequence"`
	LastSequence int64  `json:"last_sequence"`
	Unread       int64  `json:"unread"`
}

func (s *Service) SetPresenceMode(ctx context.Context, member identity.Member, mode string) error {
	if mode != "available" && mode != "dnd" {
		return ErrInvalidInput
	}
	_, err := s.db.ExecContext(ctx, "UPDATE members SET presence_mode = ? WHERE id = ?", mode, member.ID)
	return err
}

func (s *Service) PresenceMode(ctx context.Context, memberID string) (string, error) {
	var mode string
	err := s.db.QueryRowContext(ctx, "SELECT presence_mode FROM members WHERE id = ?", memberID).Scan(&mode)
	return mode, err
}

func (s *Service) UpdateReadPosition(ctx context.Context, member identity.Member, channelID string, sequence int64) (ChannelState, error) {
	visible, err := s.CanUseChannel(ctx, member.ID, channelID, PermissionViewChannels, true)
	if err != nil || !visible {
		return ChannelState{}, ErrNotFound
	}
	var last int64
	if err := s.db.QueryRowContext(ctx, "SELECT COALESCE(MAX(sequence), 0) FROM messages WHERE channel_id = ?", channelID).Scan(&last); err != nil {
		return ChannelState{}, err
	}
	if sequence < 0 || sequence > last {
		return ChannelState{}, ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ChannelState{}, err
	}
	defer tx.Rollback()
	var previous int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE((SELECT sequence FROM read_positions
		WHERE member_id = ? AND channel_id = ?), 0)`, member.ID, channelID).Scan(&previous); err != nil {
		return ChannelState{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO read_positions(member_id, channel_id, sequence, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(member_id, channel_id) DO UPDATE SET sequence = MAX(read_positions.sequence, excluded.sequence), updated_at = excluded.updated_at`,
		member.ID, channelID, sequence, databaseTime(time.Now()))
	if err != nil {
		return ChannelState{}, err
	}
	var stored int64
	if err := tx.QueryRowContext(ctx, "SELECT sequence FROM read_positions WHERE member_id = ? AND channel_id = ?", member.ID, channelID).Scan(&stored); err != nil {
		return ChannelState{}, err
	}
	if stored > previous {
		var newlyRead int64
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages
			WHERE channel_id = ? AND author_id != ? AND sequence > ? AND sequence <= ?`,
			channelID, member.ID, previous, stored).Scan(&newlyRead); err != nil {
			return ChannelState{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE unread_counts SET count = MAX(0, count - ?)
			WHERE member_id = ? AND channel_id = ?`, newlyRead, member.ID, channelID); err != nil {
			return ChannelState{}, err
		}
	}
	var unread int64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages
		WHERE channel_id = ? AND author_id != ? AND sequence > ?`, channelID, member.ID, stored).Scan(&unread); err != nil {
		return ChannelState{}, err
	}
	state := ChannelState{ChannelID: channelID, ReadSequence: stored, LastSequence: last, Unread: unread}
	if err := appendRealtimeEvent(ctx, tx, "read.updated", channelID, map[string]any{"member_id": member.ID, "state": state}); err != nil {
		return ChannelState{}, err
	}
	if err := tx.Commit(); err != nil {
		return ChannelState{}, err
	}
	return state, nil
}

func (s *Service) ChannelStates(ctx context.Context, member identity.Member) ([]ChannelState, error) {
	overview, err := s.ChannelOverview(ctx, member, false)
	if err != nil {
		return nil, err
	}
	states := make([]ChannelState, 0, len(overview.Channels))
	for _, channel := range overview.Channels {
		if channel.Type != "text" {
			continue
		}
		var read, last, unread int64
		err := s.db.QueryRowContext(ctx, `SELECT
			COALESCE((SELECT sequence FROM read_positions WHERE member_id = ? AND channel_id = ?), 0),
			COALESCE((SELECT MAX(sequence) FROM messages WHERE channel_id = ?), 0),
			COALESCE((SELECT COUNT(*) FROM messages WHERE channel_id = ? AND author_id != ?
				AND sequence > COALESCE((SELECT sequence FROM read_positions WHERE member_id = ? AND channel_id = ?), 0)), 0)`,
			member.ID, channel.ID, channel.ID, channel.ID, member.ID, member.ID, channel.ID).Scan(&read, &last, &unread)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		states = append(states, ChannelState{ChannelID: channel.ID, ReadSequence: read, LastSequence: last, Unread: unread})
	}
	return states, nil
}
