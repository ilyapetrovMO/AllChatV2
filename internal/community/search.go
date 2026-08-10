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

func (s *Service) SearchMessages(ctx context.Context, member identity.Member, query string, limit int) ([]SearchResult, error) {
	page, err := s.SearchMessagePage(ctx, member, query, "", limit)
	return page.Results, err
}

func (s *Service) SearchMessagePage(ctx context.Context, member identity.Member, query, cursor string, limit int) (SearchPage, error) {
	match, err := searchMatchQuery(query)
	if err != nil {
		return SearchPage{}, err
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
		WHERE message_search MATCH ? AND msg.deleted_at IS NULL AND msg.channel_id IN (` + placeholders + `)`
	arguments := make([]any, 0, len(channelIDs)+4)
	arguments = append(arguments, match)
	for _, channelID := range channelIDs {
		arguments = append(arguments, channelID)
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
