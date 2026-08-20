// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"database/sql"
	"errors"
	"html"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"allchat/internal/identity"
)

type Mention struct {
	MemberID    string `json:"member_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name,omitempty"`
}

type ReplyPreview struct {
	MessageID  string `json:"message_id"`
	AuthorName string `json:"author_name"`
	Body       string `json:"body,omitempty"`
	Deleted    bool   `json:"deleted"`
}

type Reaction struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	Me    bool   `json:"me"`
}

var (
	markdownCode    = regexp.MustCompile("`([^`\\n]+)`")
	markdownBold    = regexp.MustCompile(`\*\*([^*\n]+)\*\*`)
	markdownItalic  = regexp.MustCompile(`\*([^*\n]+)\*`)
	markdownMention = regexp.MustCompile(`(^|[^\pL\pN._-])@([\pL\pN._-]{3,32})`)
	markdownFence   = regexp.MustCompile("(?s)```(?:([A-Za-z0-9_+-]+)(?:[ \\t]+|\\r?\\n))?(.*?)```")
)

func renderMarkdown(body string) string {
	matches := markdownFence.FindAllStringSubmatchIndex(body, -1)
	if len(matches) == 0 {
		return renderInlineMarkdown(body)
	}
	var rendered strings.Builder
	offset := 0
	for _, match := range matches {
		rendered.WriteString(renderInlineMarkdown(body[offset:match[0]]))
		language := ""
		if match[2] >= 0 {
			language = ` class="language-` + body[match[2]:match[3]] + `"`
		}
		code := strings.TrimSpace(body[match[4]:match[5]])
		rendered.WriteString("<pre><code" + language + ">" + html.EscapeString(code) + "</code></pre>")
		offset = match[1]
	}
	rendered.WriteString(renderInlineMarkdown(body[offset:]))
	return rendered.String()
}

func renderInlineMarkdown(body string) string {
	rendered := html.EscapeString(body)
	rendered = markdownCode.ReplaceAllString(rendered, "<code>$1</code>")
	rendered = markdownBold.ReplaceAllString(rendered, "<strong>$1</strong>")
	rendered = markdownItalic.ReplaceAllString(rendered, "<em>$1</em>")
	rendered = markdownMention.ReplaceAllString(rendered, `$1<mark class="mention">@$2</mark>`)
	return strings.ReplaceAll(rendered, "\n", "<br>")
}

func (s *Service) mentionIDsFromBody(ctx context.Context, body string) ([]string, error) {
	seen := map[string]bool{}
	var keys []string
	for _, match := range markdownMention.FindAllStringSubmatch(body, -1) {
		key := strings.ToLower(match[2])
		if !seen[key] {
			seen[key] = true
			keys = append(keys, key)
		}
	}
	if len(keys) == 0 {
		return nil, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")
	args := make([]any, len(keys))
	for index, key := range keys {
		args[index] = key
	}
	rows, err := s.db.QueryContext(ctx, "SELECT id FROM members WHERE username_key IN ("+placeholders+")", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func validateReply(ctx context.Context, tx *sql.Tx, channelID, replyID string) error {
	if replyID == "" {
		return nil
	}
	var replyChannel string
	if err := tx.QueryRowContext(ctx, "SELECT channel_id FROM messages WHERE id = ?", replyID).Scan(&replyChannel); err != nil || replyChannel != channelID {
		return ErrNotFound
	}
	return nil
}

func validateMentions(ctx context.Context, tx *sql.Tx, memberIDs []string) error {
	if len(memberIDs) > 50 {
		return ErrInvalidInput
	}
	for _, memberID := range uniqueStrings(memberIDs) {
		var exists bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM members WHERE id = ?)", memberID).Scan(&exists); err != nil || !exists {
			return ErrNotFound
		}
	}
	return nil
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

type richQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func messagePagePlaceholders(messages []Message) (string, []any) {
	placeholders := make([]string, len(messages))
	arguments := make([]any, len(messages))
	for index := range messages {
		placeholders[index], arguments[index] = "?", messages[index].ID
	}
	return strings.Join(placeholders, ","), arguments
}

// decorateMessagePage completes a Message page with a fixed number of
// set-based queries. The page is bounded by ListMessages, so every IN clause is
// bounded to at most 100 Message IDs.
func (s *Service) decorateMessagePage(ctx context.Context, viewerID string, messages []Message) error {
	if len(messages) == 0 {
		return nil
	}
	byID := make(map[string]*Message, len(messages))
	for index := range messages {
		byID[messages[index].ID] = &messages[index]
	}
	placeholders, ids := messagePagePlaceholders(messages)

	rows, err := s.db.QueryContext(ctx, `SELECT mm.message_id, m.id, m.username, COALESCE(m.display_name, '')
		FROM message_mentions mm JOIN members m ON m.id = mm.member_id
		WHERE mm.message_id IN (`+placeholders+`) ORDER BY mm.message_id, m.username_key`, ids...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var messageID string
		var mention Mention
		if err := rows.Scan(&messageID, &mention.MemberID, &mention.Username, &mention.DisplayName); err != nil {
			rows.Close()
			return err
		}
		byID[messageID].Mentions = append(byID[messageID].Mentions, mention)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	reactionArguments := append([]any{viewerID}, ids...)
	rows, err = s.db.QueryContext(ctx, `SELECT message_id, emoji, COUNT(*), MAX(member_id = ?)
		FROM message_reactions WHERE message_id IN (`+placeholders+`)
		GROUP BY message_id, emoji ORDER BY message_id, emoji`, reactionArguments...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var messageID string
		var reaction Reaction
		if err := rows.Scan(&messageID, &reaction.Emoji, &reaction.Count, &reaction.Me); err != nil {
			rows.Close()
			return err
		}
		byID[messageID].Reactions = append(byID[messageID].Reactions, reaction)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	rows, err = s.db.QueryContext(ctx, `SELECT message_id FROM pinned_messages WHERE message_id IN (`+placeholders+`)`, ids...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var messageID string
		if err := rows.Scan(&messageID); err != nil {
			rows.Close()
			return err
		}
		byID[messageID].Pinned = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	rows, err = s.db.QueryContext(ctx, `SELECT id, message_id, original_name, content_type, size FROM attachments
		WHERE message_id IN (`+placeholders+`) AND state = 'published' ORDER BY message_id, created_at`, ids...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var attachment Attachment
		if err := rows.Scan(&attachment.ID, &attachment.MessageID, &attachment.Name, &attachment.ContentType, &attachment.Size); err != nil {
			rows.Close()
			return err
		}
		attachment.URL = "/api/v1/attachments/" + attachment.ID
		if strings.HasPrefix(attachment.ContentType, "image/") {
			attachment.PreviewURL = attachment.URL + "/preview"
		}
		byID[attachment.MessageID].Attachments = append(byID[attachment.MessageID].Attachments, attachment)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	return rows.Close()
}

func (s *Service) decorateMessage(ctx context.Context, viewerID string, message *Message) error {
	return s.decorateMessageWith(ctx, s.db, viewerID, message)
}

func (s *Service) decorateMessageWith(ctx context.Context, queryer richQueryer, viewerID string, message *Message) error {
	var replyID string
	var authorHasAvatar bool
	if err := queryer.QueryRowContext(ctx, `SELECT COALESCE(msg.reply_to_message_id, ''), msg.rendered_html, author.avatar IS NOT NULL
		FROM messages msg JOIN members author ON author.id = msg.author_id WHERE msg.id = ?`, message.ID).Scan(&replyID, &message.RenderedHTML, &authorHasAvatar); err != nil {
		return err
	}
	if authorHasAvatar {
		message.AuthorAvatarURL = "/api/v1/members/" + message.AuthorID + "/avatar"
	}
	if replyID != "" {
		preview := &ReplyPreview{MessageID: replyID}
		err := queryer.QueryRowContext(ctx, `SELECT COALESCE(NULLIF(m.display_name, ''), m.username), COALESCE(msg.body, ''), msg.deleted_at IS NOT NULL
			FROM messages msg JOIN members m ON m.id = msg.author_id WHERE msg.id = ?`, replyID).Scan(&preview.AuthorName, &preview.Body, &preview.Deleted)
		if err == nil {
			if len([]rune(preview.Body)) > 120 {
				preview.Body = string([]rune(preview.Body)[:120])
			}
			message.Reply = preview
		}
	}
	rows, err := queryer.QueryContext(ctx, `SELECT m.id, m.username, COALESCE(m.display_name, '') FROM message_mentions mm
		JOIN members m ON m.id = mm.member_id WHERE mm.message_id = ? ORDER BY m.username_key`, message.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var mention Mention
		if err := rows.Scan(&mention.MemberID, &mention.Username, &mention.DisplayName); err != nil {
			rows.Close()
			return err
		}
		message.Mentions = append(message.Mentions, mention)
	}
	rows.Close()
	rows, err = queryer.QueryContext(ctx, `SELECT emoji, COUNT(*), MAX(member_id = ?) FROM message_reactions
		WHERE message_id = ? GROUP BY emoji ORDER BY emoji`, viewerID, message.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var reaction Reaction
		if err := rows.Scan(&reaction.Emoji, &reaction.Count, &reaction.Me); err != nil {
			rows.Close()
			return err
		}
		message.Reactions = append(message.Reactions, reaction)
	}
	rows.Close()
	_ = queryer.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM pinned_messages WHERE message_id = ?)", message.ID).Scan(&message.Pinned)
	attachments, err := s.messageAttachments(ctx, queryer, message.ID)
	if err != nil {
		return err
	}
	message.Attachments = attachments
	return nil
}

func (s *Service) SetReaction(ctx context.Context, member identity.Member, messageID, emoji string, add bool) error {
	if !validEmoji(emoji) {
		return ErrInvalidInput
	}
	message, err := s.message(ctx, messageID)
	if err != nil {
		return ErrNotFound
	}
	if visible, _ := s.CanUseChannel(ctx, member.ID, message.ChannelID, PermissionViewChannels, true); !visible {
		return ErrNotFound
	}
	if add {
		if direct, err := s.isDirectMessage(ctx, message.ChannelID); err != nil {
			return err
		} else if direct {
			blocked, err := s.directMessageBlocked(ctx, message.ChannelID)
			if err != nil {
				return err
			}
			if blocked {
				return ErrForbidden
			}
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if add {
		_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO message_reactions(message_id, member_id, emoji, created_at) VALUES (?, ?, ?, ?)", messageID, member.ID, emoji, databaseTime(time.Now()))
	} else {
		_, err = tx.ExecContext(ctx, "DELETE FROM message_reactions WHERE message_id = ? AND member_id = ? AND emoji = ?", messageID, member.ID, emoji)
	}
	if err != nil {
		return err
	}
	payload := map[string]any{"message_id": messageID, "member_id": member.ID, "emoji": emoji, "active": add}
	if err := appendRealtimeEvent(ctx, tx, "reaction.updated", message.ChannelID, payload); err != nil {
		return err
	}
	return tx.Commit()
}

func validEmoji(value string) bool {
	if value == "" || !utf8.ValidString(value) || utf8.RuneCountInString(value) > 12 {
		return false
	}
	hasBase := false
	hasKeycap := false
	for _, r := range value {
		if emojiBaseRune(r) {
			hasBase = true
			continue
		}
		if r == '\u20e3' {
			hasKeycap = true
			continue
		}
		if !emojiComponentRune(r) {
			return false
		}
	}
	if len(value) == 1 && (value[0] == '#' || value[0] == '*' || value[0] >= '0' && value[0] <= '9') {
		return false
	}
	return hasBase && (!strings.ContainsAny(value, "#*0123456789") || hasKeycap)
}

func emojiBaseRune(r rune) bool {
	return r == 0x00a9 || r == 0x00ae || r == 0x203c || r == 0x2049 || r == 0x2122 || r == 0x2139 ||
		inRuneRange(r, 0x2194, 0x2199) || inRuneRange(r, 0x21a9, 0x21aa) ||
		inRuneRange(r, 0x231a, 0x231b) || r == 0x2328 || r == 0x23cf || inRuneRange(r, 0x23e9, 0x23f3) || inRuneRange(r, 0x23f8, 0x23fa) ||
		r == 0x24c2 || inRuneRange(r, 0x25aa, 0x25ab) || r == 0x25b6 || r == 0x25c0 || inRuneRange(r, 0x25fb, 0x25fe) ||
		inRuneRange(r, 0x2600, 0x27ff) || inRuneRange(r, 0x2934, 0x2935) || inRuneRange(r, 0x2b05, 0x2b07) ||
		inRuneRange(r, 0x2b1b, 0x2b1c) || r == 0x2b50 || r == 0x2b55 || r == 0x3030 || r == 0x303d || r == 0x3297 || r == 0x3299 ||
		inRuneRange(r, 0x1f000, 0x1faff) || r == '#' || r == '*' || inRuneRange(r, '0', '9')
}

func emojiComponentRune(r rune) bool {
	return r == 0x200d || r == 0xfe0e || r == 0xfe0f || inRuneRange(r, 0x1f3fb, 0x1f3ff) ||
		inRuneRange(r, 0xe0020, 0xe007f)
}

func inRuneRange(r, first, last rune) bool {
	return r >= first && r <= last
}

func (s *Service) SetPinned(ctx context.Context, member identity.Member, messageID string, pinned bool) error {
	message, err := s.message(ctx, messageID)
	if err != nil {
		return ErrNotFound
	}
	if allowed, _ := s.CanUseChannel(ctx, member.ID, message.ChannelID, PermissionSendMessages, false); !allowed {
		return ErrForbidden
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if pinned {
		_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO pinned_messages(channel_id, message_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?)", message.ChannelID, messageID, member.ID, databaseTime(time.Now()))
	} else {
		_, err = tx.ExecContext(ctx, "DELETE FROM pinned_messages WHERE message_id = ?", messageID)
	}
	if err != nil {
		return err
	}
	if err := appendRealtimeEvent(ctx, tx, "pin.updated", message.ChannelID, map[string]any{"message_id": messageID, "pinned": pinned}); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) PinnedMessages(ctx context.Context, member identity.Member, channelID string) ([]Message, error) {
	visible, _ := s.CanUseChannel(ctx, member.ID, channelID, PermissionViewChannels, true)
	if !visible {
		return nil, ErrNotFound
	}
	rows, err := s.db.QueryContext(ctx, `SELECT msg.id FROM pinned_messages p JOIN messages msg ON msg.id = p.message_id
		WHERE p.channel_id = ? ORDER BY p.pinned_at DESC`, channelID)
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
	rows.Close()
	result := make([]Message, 0, len(ids))
	for _, id := range ids {
		message, err := s.message(ctx, id)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		var name string
		_ = s.db.QueryRowContext(ctx, `SELECT COALESCE(NULLIF(m.display_name, ''), m.username) FROM members m WHERE m.id = ?`, message.AuthorID).Scan(&name)
		message.AuthorName = name
		if err := s.decorateMessage(ctx, member.ID, &message); err != nil {
			return nil, err
		}
		result = append(result, message)
	}
	sort.SliceStable(result, func(a, b int) bool { return result[a].Sequence < result[b].Sequence })
	return result, nil
}
