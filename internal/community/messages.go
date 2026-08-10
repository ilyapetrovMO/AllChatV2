// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"allchat/internal/identity"
)

type Message struct {
	ID              string        `json:"id"`
	ChannelID       string        `json:"channel_id"`
	AuthorID        string        `json:"author_id"`
	AuthorName      string        `json:"author_name"`
	AuthorAvatarURL string        `json:"author_avatar_url,omitempty"`
	Sequence        int64         `json:"sequence"`
	Body            string        `json:"body,omitempty"`
	CreatedAt       string        `json:"created_at"`
	EditedAt        string        `json:"edited_at,omitempty"`
	Deleted         bool          `json:"deleted"`
	RenderedHTML    string        `json:"rendered_html,omitempty"`
	Reply           *ReplyPreview `json:"reply,omitempty"`
	Mentions        []Mention     `json:"mentions,omitempty"`
	Reactions       []Reaction    `json:"reactions,omitempty"`
	Pinned          bool          `json:"pinned,omitempty"`
	Attachments     []Attachment  `json:"attachments,omitempty"`
}

type MessageInput struct {
	Body          string
	ReplyTo       string
	MentionIDs    []string
	AttachmentIDs []string
}

func (s *Service) PublishMessage(ctx context.Context, member identity.Member, channelID, body string) (Message, error) {
	return s.PublishRichMessage(ctx, member, channelID, MessageInput{Body: body})
}

func (s *Service) PublishRichMessage(ctx context.Context, member identity.Member, channelID string, input MessageInput) (Message, error) {
	body := input.Body
	if body == "" && len(input.AttachmentIDs) == 0 {
		return Message{}, fmt.Errorf("%w: Message must contain text or an Attachment", ErrInvalidInput)
	}
	if body != "" {
		if err := validateMessageBody(body); err != nil {
			return Message{}, err
		}
	}
	allowed, err := s.CanUseChannel(ctx, member.ID, channelID, PermissionSendMessages, false)
	if err != nil || !allowed {
		return Message{}, ErrForbidden
	}
	if direct, err := s.isDirectMessage(ctx, channelID); err != nil {
		return Message{}, err
	} else if direct {
		blocked, err := s.directMessageBlocked(ctx, channelID)
		if err != nil {
			return Message{}, err
		}
		if blocked {
			return Message{}, ErrForbidden
		}
	}
	if active, err := s.memberMayWrite(ctx, member.ID); err != nil || !active {
		return Message{}, ErrForbidden
	}
	id, err := randomID()
	if err != nil {
		return Message{}, err
	}
	now := databaseTime(time.Now())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, err
	}
	defer tx.Rollback()
	if err := validateReply(ctx, tx, channelID, input.ReplyTo); err != nil {
		return Message{}, err
	}
	if err := validateMentions(ctx, tx, input.MentionIDs); err != nil {
		return Message{}, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO channel_sequences(channel_id, next_sequence) VALUES (?, 1)", channelID); err != nil {
		return Message{}, err
	}
	var sequence int64
	if err := tx.QueryRowContext(ctx, "UPDATE channel_sequences SET next_sequence = next_sequence + 1 WHERE channel_id = ? RETURNING next_sequence - 1", channelID).Scan(&sequence); err != nil {
		return Message{}, err
	}
	rendered := renderMarkdown(body)
	if _, err := tx.ExecContext(ctx, "INSERT INTO messages(id, channel_id, author_id, sequence, body, created_at, reply_to_message_id, rendered_html) VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?)",
		id, channelID, member.ID, sequence, body, now, input.ReplyTo, rendered); err != nil {
		return Message{}, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO message_search(message_id, channel_id, body) VALUES (?, ?, ?)", id, channelID, body); err != nil {
		return Message{}, err
	}
	for _, mentionedID := range uniqueStrings(input.MentionIDs) {
		if _, err := tx.ExecContext(ctx, "INSERT INTO message_mentions(message_id, member_id) VALUES (?, ?)", id, mentionedID); err != nil {
			return Message{}, err
		}
	}
	if err := s.publishAttachments(ctx, tx, member.ID, id, input.AttachmentIDs); err != nil {
		return Message{}, err
	}
	message := Message{ID: id, ChannelID: channelID, AuthorID: member.ID, AuthorName: nameForMember(member), Sequence: sequence, Body: body, CreatedAt: now, RenderedHTML: rendered}
	if err := s.decorateMessageWith(ctx, tx, member.ID, &message); err != nil {
		return Message{}, err
	}
	if err := appendRealtimeEvent(ctx, tx, "message.created", channelID, message); err != nil {
		return Message{}, err
	}
	if err := tx.Commit(); err != nil {
		return Message{}, err
	}
	return message, nil
}

func (s *Service) ListMessages(ctx context.Context, member identity.Member, channelID string, before int64, limit int) ([]Message, error) {
	visible, err := s.CanUseChannel(ctx, member.ID, channelID, PermissionViewChannels, true)
	if err != nil || !visible {
		return nil, ErrNotFound
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	if before <= 0 {
		before = int64(^uint64(0) >> 1)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT msg.id, msg.channel_id, msg.author_id,
		COALESCE(NULLIF(m.display_name, ''), m.username), msg.sequence, COALESCE(msg.body, ''), msg.created_at,
		COALESCE(msg.edited_at, ''), msg.deleted_at IS NOT NULL
		FROM messages msg JOIN members m ON m.id = msg.author_id
		WHERE msg.channel_id = ? AND msg.sequence < ? ORDER BY msg.sequence DESC LIMIT ?`, channelID, before, limit)
	if err != nil {
		return nil, err
	}
	var result []Message
	for rows.Next() {
		var message Message
		if err := rows.Scan(&message.ID, &message.ChannelID, &message.AuthorID, &message.AuthorName, &message.Sequence, &message.Body, &message.CreatedAt, &message.EditedAt, &message.Deleted); err != nil {
			return nil, err
		}
		result = append(result, message)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for left, right := 0, len(result)-1; left < right; left, right = left+1, right-1 {
		result[left], result[right] = result[right], result[left]
	}
	for index := range result {
		if err := s.decorateMessage(ctx, member.ID, &result[index]); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (s *Service) EditMessage(ctx context.Context, member identity.Member, messageID, body string) (Message, error) {
	if err := validateMessageBody(body); err != nil {
		return Message{}, err
	}
	message, err := s.message(ctx, messageID)
	if err != nil || message.AuthorID != member.ID || message.Deleted {
		return Message{}, ErrNotFound
	}
	allowed, _ := s.CanUseChannel(ctx, member.ID, message.ChannelID, PermissionSendMessages, false)
	if !allowed {
		return Message{}, ErrForbidden
	}
	edited := databaseTime(time.Now())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, err
	}
	defer tx.Rollback()
	rendered := renderMarkdown(body)
	if _, err := tx.ExecContext(ctx, "UPDATE messages SET body = ?, rendered_html = ?, edited_at = ? WHERE id = ? AND deleted_at IS NULL", body, rendered, edited, messageID); err != nil {
		return Message{}, err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM message_search WHERE message_id = ?", messageID); err != nil {
		return Message{}, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO message_search(message_id, channel_id, body) VALUES (?, ?, ?)", messageID, message.ChannelID, body); err != nil {
		return Message{}, err
	}
	message.Body, message.RenderedHTML, message.EditedAt, message.AuthorName = body, rendered, edited, nameForMember(member)
	if err := s.decorateMessageWith(ctx, tx, member.ID, &message); err != nil {
		return Message{}, err
	}
	if err := appendRealtimeEvent(ctx, tx, "message.edited", message.ChannelID, message); err != nil {
		return Message{}, err
	}
	if err := tx.Commit(); err != nil {
		return Message{}, err
	}
	return message, nil
}

func (s *Service) DeleteMessage(ctx context.Context, member identity.Member, messageID string) error {
	message, err := s.message(ctx, messageID)
	if err != nil || message.AuthorID != member.ID || message.Deleted {
		return ErrNotFound
	}
	allowed, _ := s.CanUseChannel(ctx, member.ID, message.ChannelID, PermissionSendMessages, false)
	if !allowed {
		return ErrForbidden
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "UPDATE messages SET body = NULL, edited_at = NULL, deleted_at = ? WHERE id = ?", databaseTime(time.Now()), messageID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM message_search WHERE message_id = ?", messageID); err != nil {
		return err
	}
	if err := s.markMessageAttachmentsForGC(ctx, tx, messageID); err != nil {
		return err
	}
	message.Body, message.EditedAt, message.Deleted = "", "", true
	if err := appendRealtimeEvent(ctx, tx, "message.deleted", message.ChannelID, message); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) message(ctx context.Context, messageID string) (Message, error) {
	var message Message
	err := s.db.QueryRowContext(ctx, `SELECT id, channel_id, author_id, sequence, COALESCE(body, ''), created_at, COALESCE(edited_at, ''), deleted_at IS NOT NULL FROM messages WHERE id = ?`, messageID).
		Scan(&message.ID, &message.ChannelID, &message.AuthorID, &message.Sequence, &message.Body, &message.CreatedAt, &message.EditedAt, &message.Deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	return message, err
}

func (s *Service) memberMayWrite(ctx context.Context, memberID string) (bool, error) {
	var suspended, timedOut sql.NullString
	if err := s.db.QueryRowContext(ctx, "SELECT suspended_until, timed_out_until FROM members WHERE id = ?", memberID).Scan(&suspended, &timedOut); err != nil {
		return false, err
	}
	now := databaseTime(time.Now())
	return (!suspended.Valid || suspended.String <= now) && (!timedOut.Valid || timedOut.String <= now), nil
}

func validateMessageBody(body string) error {
	length := utf8.RuneCountInString(body)
	if length < 1 || length > 4000 || !utf8.ValidString(body) {
		return fmt.Errorf("%w: Message must contain 1-4000 valid UTF-8 characters", ErrInvalidInput)
	}
	return nil
}

func nameForMember(member identity.Member) string {
	if member.DisplayName != "" {
		return member.DisplayName
	}
	return member.Username
}
