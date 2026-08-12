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
	ClientID        string        `json:"client_id,omitempty"`
}

type MessageInput struct {
	Body          string
	ReplyTo       string
	MentionIDs    []string
	AttachmentIDs []string
	ClientID      string
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
	rendered := renderMarkdown(body)
	return s.enqueueMessage(messagePublishRequest{ctx: ctx, member: member, channelID: channelID, id: id, now: now, rendered: rendered, input: input, result: make(chan messagePublishResult, 1)})
}

func (s *Service) ListMessages(ctx context.Context, member identity.Member, channelID string, before int64, limit int) ([]Message, error) {
	return s.listMessages(ctx, member, channelID, before, limit, false)
}

// ListMessagesAfter returns the next page after a Conversation Sequence. It
// complements ListMessages so bounded clients can evict either edge and later
// recover it without offset pagination.
func (s *Service) ListMessagesAfter(ctx context.Context, member identity.Member, channelID string, after int64, limit int) ([]Message, error) {
	return s.listMessages(ctx, member, channelID, after, limit, true)
}

func (s *Service) listMessages(ctx context.Context, member identity.Member, channelID string, cursor int64, limit int, forward bool) ([]Message, error) {
	visible, err := s.CanUseChannel(ctx, member.ID, channelID, PermissionViewChannels, true)
	if err != nil || !visible {
		return nil, ErrNotFound
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	predicate, order := "msg.sequence < ?", "DESC"
	if forward {
		predicate, order = "msg.sequence > ?", "ASC"
	} else if cursor <= 0 {
		cursor = int64(^uint64(0) >> 1)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT msg.id, msg.channel_id, msg.author_id,
		COALESCE(NULLIF(m.display_name, ''), m.username), m.avatar IS NOT NULL,
		msg.sequence, COALESCE(msg.body, ''), msg.created_at, COALESCE(msg.edited_at, ''),
		msg.deleted_at IS NOT NULL, msg.rendered_html, COALESCE(msg.reply_to_message_id, ''),
		COALESCE(NULLIF(reply_author.display_name, ''), reply_author.username, ''),
		COALESCE(reply.body, ''), COALESCE(reply.deleted_at IS NOT NULL, FALSE)
		FROM messages msg JOIN members m ON m.id = msg.author_id
		LEFT JOIN messages reply ON reply.id = msg.reply_to_message_id
		LEFT JOIN members reply_author ON reply_author.id = reply.author_id
		WHERE msg.channel_id = ? AND `+predicate+` ORDER BY msg.sequence `+order+` LIMIT ?`, channelID, cursor, limit)
	if err != nil {
		return nil, err
	}
	var result []Message
	for rows.Next() {
		var message Message
		var authorHasAvatar bool
		var replyID, replyAuthor, replyBody string
		var replyDeleted bool
		if err := rows.Scan(&message.ID, &message.ChannelID, &message.AuthorID, &message.AuthorName, &authorHasAvatar, &message.Sequence, &message.Body, &message.CreatedAt, &message.EditedAt, &message.Deleted, &message.RenderedHTML, &replyID, &replyAuthor, &replyBody, &replyDeleted); err != nil {
			return nil, err
		}
		if authorHasAvatar {
			message.AuthorAvatarURL = "/api/v1/members/" + message.AuthorID + "/avatar"
		}
		if replyID != "" {
			if characters := []rune(replyBody); len(characters) > 120 {
				replyBody = string(characters[:120])
			}
			message.Reply = &ReplyPreview{MessageID: replyID, AuthorName: replyAuthor, Body: replyBody, Deleted: replyDeleted}
		}
		result = append(result, message)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if !forward {
		for left, right := 0, len(result)-1; left < right; left, right = left+1, right-1 {
			result[left], result[right] = result[right], result[left]
		}
	}
	if err := s.decorateMessagePage(ctx, member.ID, result); err != nil {
		return nil, err
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
