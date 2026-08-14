// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"allchat/internal/identity"
)

type SearchResult struct {
	Message      Message `json:"message"`
	ChannelName  string  `json:"channel_name"`
	CategoryName string  `json:"category_name"`
	Snippet      string  `json:"snippet"`
	URL          string  `json:"url"`
}

type SearchPage struct {
	Results    []SearchResult `json:"results"`
	NextCursor string         `json:"next_cursor,omitempty"`
}

type searchCursor struct {
	CreatedAt string `json:"created_at"`
	MessageID string `json:"message_id"`
}

type searchFilters struct {
	Text, Author, Channel, Has, Mentions, Before, After string
}

func (s *Service) SearchMessages(ctx context.Context, member identity.Member, query string, limit int) ([]SearchResult, error) {
	page, err := s.SearchMessagePage(ctx, member, query, "", limit)
	return page.Results, err
}

func (s *Service) SearchMessagePage(ctx context.Context, member identity.Member, query, cursor string, limit int) (SearchPage, error) {
	filters := parseSearchFilters(query)
	match, err := searchMatchQuery(filters.Text)
	if err != nil {
		if filters.Text != "" || (filters.Author == "" && filters.Channel == "" && filters.Has == "" && filters.Mentions == "" && filters.Before == "" && filters.After == "") {
			return SearchPage{}, err
		}
	}
	if limit < 1 || limit > 50 {
		limit = 20
	}
	position, err := decodeSearchCursor(cursor)
	if err != nil {
		return SearchPage{}, fmt.Errorf("%w: search cursor is invalid", ErrInvalidInput)
	}
	channelIDs, err := s.searchableChannelIDs(ctx, member)
	if err != nil {
		return SearchPage{}, err
	}
	if len(channelIDs) == 0 {
		return SearchPage{Results: []SearchResult{}}, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(channelIDs)), ",")
	statement := `SELECT msg.id, msg.channel_id, msg.author_id,
		COALESCE(NULLIF(author.display_name, ''), author.username), msg.sequence, COALESCE(msg.body, ''),
		msg.created_at, COALESCE(msg.edited_at, ''), msg.deleted_at IS NOT NULL,
		ch.name, cat.name
		FROM message_search search
		JOIN messages msg ON msg.id = search.message_id
		JOIN members author ON author.id = msg.author_id
		JOIN channels ch ON ch.id = msg.channel_id
		JOIN categories cat ON cat.id = ch.category_id
		WHERE msg.deleted_at IS NULL AND msg.channel_id IN (` + placeholders + `)`
	arguments := make([]any, 0, len(channelIDs)+4)
	for _, channelID := range channelIDs {
		arguments = append(arguments, channelID)
	}
	if match != "" {
		statement += " AND message_search MATCH ?"
		arguments = append(arguments, match)
	}
	if filters.Author != "" {
		statement += " AND (author.username_key = lower(?) OR lower(author.display_name) = lower(?))"
		arguments = append(arguments, filters.Author, filters.Author)
	}
	if filters.Channel != "" {
		statement += " AND lower(ch.name) = lower(?)"
		arguments = append(arguments, strings.TrimPrefix(filters.Channel, "#"))
	}
	if filters.Mentions != "" {
		statement += " AND EXISTS (SELECT 1 FROM message_mentions mm JOIN members mentioned ON mentioned.id=mm.member_id WHERE mm.message_id=msg.id AND (mentioned.username_key=lower(?) OR lower(mentioned.display_name)=lower(?)))"
		arguments = append(arguments, filters.Mentions, filters.Mentions)
	}
	if filters.Before != "" {
		statement += " AND msg.created_at < ?"
		arguments = append(arguments, filters.Before+"T23:59:59Z")
	}
	if filters.After != "" {
		statement += " AND msg.created_at >= ?"
		arguments = append(arguments, filters.After+"T00:00:00Z")
	}
	if filters.Has != "" {
		switch filters.Has {
		case "file":
			statement += " AND EXISTS (SELECT 1 FROM attachments a WHERE a.message_id=msg.id AND a.state='published')"
		case "image":
			statement += " AND EXISTS (SELECT 1 FROM attachments a WHERE a.message_id=msg.id AND a.state='published' AND a.content_type LIKE 'image/%')"
		case "link":
			statement += " AND (msg.body LIKE '%http://%' OR msg.body LIKE '%https://%')"
		}
	}
	if position.CreatedAt != "" {
		statement += " AND (msg.created_at < ? OR (msg.created_at = ? AND msg.id < ?))"
		arguments = append(arguments, position.CreatedAt, position.CreatedAt, position.MessageID)
	}
	statement += " ORDER BY msg.created_at DESC, msg.id DESC LIMIT ?"
	arguments = append(arguments, limit+1)
	rows, err := s.db.QueryContext(ctx, statement, arguments...)
	if err != nil {
		return SearchPage{}, fmt.Errorf("search Messages: %w", err)
	}
	var results []SearchResult
	for rows.Next() {
		var result SearchResult
		if err := rows.Scan(&result.Message.ID, &result.Message.ChannelID, &result.Message.AuthorID,
			&result.Message.AuthorName, &result.Message.Sequence, &result.Message.Body, &result.Message.CreatedAt,
			&result.Message.EditedAt, &result.Message.Deleted, &result.ChannelName, &result.CategoryName); err != nil {
			rows.Close()
			return SearchPage{}, err
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return SearchPage{}, err
	}
	rows.Close()
	page := SearchPage{Results: results}
	if len(page.Results) > limit {
		page.Results = page.Results[:limit]
		last := page.Results[len(page.Results)-1].Message
		page.NextCursor = encodeSearchCursor(searchCursor{CreatedAt: last.CreatedAt, MessageID: last.ID})
	}
	for index := range page.Results {
		result := &page.Results[index]
		if err := s.decorateMessage(ctx, member.ID, &result.Message); err != nil {
			return SearchPage{}, err
		}
		result.Snippet = searchSnippet(result.Message.Body)
		result.URL = "/channels/" + result.Message.ChannelID + "#message-" + result.Message.ID
	}
	return page, nil
}

func parseSearchFilters(query string) searchFilters {
	var filters searchFilters
	var text []string
	for _, term := range strings.Fields(strings.TrimSpace(query)) {
		parts := strings.SplitN(term, ":", 2)
		if len(parts) != 2 || parts[1] == "" {
			text = append(text, term)
			continue
		}
		value := strings.Trim(parts[1], `"`)
		switch strings.ToLower(parts[0]) {
		case "from":
			filters.Author = value
		case "in":
			filters.Channel = value
		case "has":
			filters.Has = strings.ToLower(value)
		case "mentions":
			filters.Mentions = value
		case "before":
			filters.Before = value
		case "after":
			filters.After = value
		default:
			text = append(text, term)
		}
	}
	filters.Text = strings.Join(text, " ")
	return filters
}

func (s *Service) searchableChannelIDs(ctx context.Context, member identity.Member) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id FROM channels WHERE type = 'text'")
	if err != nil {
		return nil, err
	}
	var candidates []string
	for rows.Next() {
		var channelID string
		if err := rows.Scan(&channelID); err != nil {
			rows.Close()
			return nil, err
		}
		candidates = append(candidates, channelID)
	}
	rows.Close()
	var visible []string
	for _, channelID := range candidates {
		allowed, _ := s.CanUseChannel(ctx, member.ID, channelID, PermissionViewChannels, true)
		if allowed {
			visible = append(visible, channelID)
		}
	}
	return visible, nil
}

func decodeSearchCursor(value string) (searchCursor, error) {
	if value == "" {
		return searchCursor{}, nil
	}
	encoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return searchCursor{}, err
	}
	var cursor searchCursor
	if err := json.Unmarshal(encoded, &cursor); err != nil || cursor.CreatedAt == "" || cursor.MessageID == "" {
		return searchCursor{}, fmt.Errorf("invalid cursor")
	}
	return cursor, nil
}

func encodeSearchCursor(cursor searchCursor) string {
	encoded, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func searchMatchQuery(query string) (string, error) {
	query = strings.TrimSpace(query)
	if query == "" || !utf8.ValidString(query) || utf8.RuneCountInString(query) > 200 {
		return "", fmt.Errorf("%w: search query must contain 1-200 valid UTF-8 characters", ErrInvalidInput)
	}
	terms := strings.Fields(query)
	if len(terms) > 10 {
		terms = terms[:10]
	}
	for index, term := range terms {
		terms[index] = `"` + strings.ReplaceAll(term, `"`, `""`) + `"`
	}
	return strings.Join(terms, " "), nil
}

func searchSnippet(body string) string {
	runes := []rune(body)
	if len(runes) <= 240 {
		return body
	}
	return string(runes[:240]) + "…"
}
