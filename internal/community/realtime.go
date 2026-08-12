// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"allchat/internal/identity"
)

const realtimeRetention = 10_000

type RealtimeEvent struct {
	Cursor    int64           `json:"cursor"`
	Type      string          `json:"type"`
	ChannelID string          `json:"channel_id"`
	Payload   json.RawMessage `json:"payload"`
}

type RealtimeSnapshot struct {
	Cursor         int64                `json:"cursor"`
	Channels       []Channel            `json:"channels"`
	DirectMessages []DirectMessage      `json:"direct_messages,omitempty"`
	Messages       map[string][]Message `json:"messages"`
}

type eventWriter interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func appendRealtimeEvent(ctx context.Context, target eventWriter, eventType, channelID string, payload any) error {
	if err := appendRealtimeEventWithoutPrune(ctx, target, eventType, channelID, payload); err != nil {
		return err
	}
	_, _ = target.ExecContext(ctx, `DELETE FROM realtime_events WHERE cursor <=
		(SELECT COALESCE(MAX(cursor), 0) - ? FROM realtime_events)`, realtimeRetention)
	return nil
}

func appendRealtimeEventWithoutPrune(ctx context.Context, target eventWriter, eventType, channelID string, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode realtime event: %w", err)
	}
	if _, err := target.ExecContext(ctx, `INSERT INTO realtime_events(event_type, channel_id, payload, created_at)
		VALUES (?, ?, ?, ?)`, eventType, channelID, string(encoded), databaseTimeNow()); err != nil {
		return fmt.Errorf("append realtime event: %w", err)
	}
	return nil
}

func (s *Service) RealtimeBounds(ctx context.Context) (oldest, latest int64, err error) {
	err = s.db.QueryRowContext(ctx, "SELECT COALESCE(MIN(cursor), 0), COALESCE(MAX(cursor), 0) FROM realtime_events").Scan(&oldest, &latest)
	return
}

func (s *Service) RealtimeEventsAfter(ctx context.Context, member identity.Member, cursor int64, limit int) ([]RealtimeEvent, int64, bool, error) {
	oldest, latest, err := s.RealtimeBounds(ctx)
	if err != nil {
		return nil, 0, false, err
	}
	if cursor < 0 || cursor > latest || (cursor > 0 && oldest > 0 && cursor < oldest-1) {
		return nil, latest, true, nil
	}
	if limit < 1 || limit > 256 {
		limit = 128
	}
	rows, err := s.db.QueryContext(ctx, `SELECT cursor, event_type, channel_id, payload
		FROM realtime_events WHERE cursor > ? ORDER BY cursor LIMIT ?`, cursor, limit)
	if err != nil {
		return nil, latest, false, err
	}
	candidates := make([]RealtimeEvent, 0, limit)
	nextCursor := cursor
	for rows.Next() {
		var event RealtimeEvent
		var payload string
		if err := rows.Scan(&event.Cursor, &event.Type, &event.ChannelID, &payload); err != nil {
			rows.Close()
			return nil, latest, false, err
		}
		event.Payload = json.RawMessage(payload)
		candidates = append(candidates, event)
		nextCursor = event.Cursor
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, latest, false, err
	}
	rows.Close()
	overview, err := s.ChannelOverview(ctx, member, false)
	if err != nil {
		return nil, latest, false, err
	}
	visible := make(map[string]bool, len(overview.Channels))
	for _, channel := range overview.Channels {
		visible[channel.ID] = true
	}
	directRows, err := s.db.QueryContext(ctx, `SELECT id FROM direct_messages
		WHERE member_low_id = ? OR member_high_id = ?`, member.ID, member.ID)
	if err != nil {
		return nil, latest, false, err
	}
	for directRows.Next() {
		var channelID string
		if err := directRows.Scan(&channelID); err != nil {
			directRows.Close()
			return nil, latest, false, err
		}
		visible[channelID] = true
	}
	if err := directRows.Err(); err != nil {
		directRows.Close()
		return nil, latest, false, err
	}
	directRows.Close()
	events := make([]RealtimeEvent, 0, len(candidates))
	for _, event := range candidates {
		if visible[event.ChannelID] {
			events = append(events, event)
		}
	}
	return events, nextCursor, false, nil
}

func (s *Service) RealtimeSnapshot(ctx context.Context, member identity.Member) (RealtimeSnapshot, error) {
	snapshot, err := s.RealtimeSnapshotMetadata(ctx, member)
	if err != nil {
		return RealtimeSnapshot{}, err
	}
	for _, channel := range snapshot.Channels {
		if channel.Type != "text" {
			continue
		}
		messages, err := s.ListMessages(ctx, member, channel.ID, 0, 100)
		if err != nil {
			return RealtimeSnapshot{}, err
		}
		snapshot.Messages[channel.ID] = messages
	}
	for _, directMessage := range snapshot.DirectMessages {
		messages, err := s.ListMessages(ctx, member, directMessage.ID, 0, 100)
		if err != nil {
			return RealtimeSnapshot{}, err
		}
		snapshot.Messages[directMessage.ID] = messages
	}
	return snapshot, nil
}

func (s *Service) RealtimeSnapshotMetadata(ctx context.Context, member identity.Member) (RealtimeSnapshot, error) {
	_, cursor, err := s.RealtimeBounds(ctx)
	if err != nil {
		return RealtimeSnapshot{}, err
	}
	overview, err := s.ChannelOverview(ctx, member, false)
	if err != nil {
		return RealtimeSnapshot{}, err
	}
	snapshot := RealtimeSnapshot{Cursor: cursor, Channels: overview.Channels, Messages: make(map[string][]Message)}
	directMessages, err := s.ListDirectMessages(ctx, member)
	if err != nil {
		return RealtimeSnapshot{}, err
	}
	snapshot.DirectMessages = directMessages
	return snapshot, nil
}

func databaseTimeNow() string { return databaseTime(time.Now()) }
