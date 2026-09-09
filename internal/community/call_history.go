// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"allchat/internal/media"
)

// RecordCallEvent appends a server-authored event to the DM's normal sequence.
// The stable ID makes retries idempotent, including its realtime publication.
func (s *Service) RecordCallEvent(ctx context.Context, call media.DirectCall) error {
	actor, at, body := call.CallerID, call.CreatedAt, "Call started"
	switch call.State {
	case "ringing":
	case "accepted":
		actor, at, body = call.RecipientID, call.AcceptedAt, "Call accepted"
	case "declined":
		actor, at, body = call.RecipientID, call.FinishedAt, "Call declined"
	case "missed":
		at, body = call.FinishedAt, "Missed call"
	default:
		at, body = call.FinishedAt, "Call finished"
	}
	parsed, err := time.Parse(time.RFC3339Nano, at)
	if err != nil {
		return fmt.Errorf("call event timestamp: %w", err)
	}
	data, err := json.Marshal(call)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	id := "call-event-" + call.ID + "-" + call.State
	var exists bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM messages WHERE id = ?)", id).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	var valid bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM direct_messages WHERE id=? AND ? IN(member_low_id,member_high_id) AND ? IN(member_low_id,member_high_id))`, call.DirectMessageID, call.CallerID, call.RecipientID).Scan(&valid); err != nil {
		return err
	}
	if !valid || call.CallerID == call.RecipientID {
		return ErrNotFound
	}
	var name string
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(NULLIF(display_name,''),username) FROM members WHERE id=?", actor).Scan(&name); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO channel_sequences(channel_id,next_sequence) VALUES(?,1)", call.DirectMessageID); err != nil {
		return err
	}
	var sequence int64
	if err := tx.QueryRowContext(ctx, "UPDATE channel_sequences SET next_sequence=next_sequence+1 WHERE channel_id=? RETURNING next_sequence-1", call.DirectMessageID).Scan(&sequence); err != nil {
		return err
	}
	created := databaseTime(parsed)
	if _, err := tx.ExecContext(ctx, `INSERT INTO messages(id,channel_id,author_id,sequence,body,created_at,rendered_html,call_event) VALUES(?,?,?,?,?,?,?,?)`, id, call.DirectMessageID, actor, sequence, body, created, body, string(data)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO unread_counts(member_id,channel_id,count)
 SELECT CASE WHEN member_low_id=? THEN member_high_id ELSE member_low_id END,id,1 FROM direct_messages WHERE id=?
 ON CONFLICT(member_id,channel_id) DO UPDATE SET count=unread_counts.count+1`, actor, call.DirectMessageID); err != nil {
		return err
	}
	message := Message{ID: id, ChannelID: call.DirectMessageID, AuthorID: actor, AuthorName: name, Sequence: sequence, Body: body, RenderedHTML: body, CreatedAt: created, CallEvent: &call}
	if err := appendRealtimeEvent(ctx, tx, "message.created", call.DirectMessageID, message); err != nil {
		return err
	}
	return tx.Commit()
}

// A restart clears live media sessions. Close their durable histories as well,
// including when the previous process did not get a chance to shut down cleanly.
func (s *Service) RecoverCallHistory(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `SELECT call_event FROM (
 SELECT call_event, ROW_NUMBER() OVER (PARTITION BY json_extract(call_event,'$.id') ORDER BY sequence DESC) AS latest
 FROM messages WHERE call_event IS NOT NULL) WHERE latest=1 AND json_extract(call_event,'$.state') IN('ringing','accepted')`)
	if err != nil {
		return err
	}
	var calls []media.DirectCall
	for rows.Next() {
		var raw string
		var call media.DirectCall
		if err := rows.Scan(&raw); err != nil {
			rows.Close()
			return err
		}
		if err := json.Unmarshal([]byte(raw), &call); err != nil {
			rows.Close()
			return err
		}
		calls = append(calls, call)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, call := range calls {
		call.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if call.State == "ringing" {
			call.State = "missed"
		} else {
			call.State = "ended"
		}
		if err := s.RecordCallEvent(ctx, call); err != nil {
			return err
		}
	}
	return nil
}
