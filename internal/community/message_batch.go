// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"allchat/internal/identity"
)

const messageBatchSize = 64
const messageBatchWindow = 5 * time.Millisecond

type messagePublishRequest struct {
	ctx                          context.Context
	member                       identity.Member
	channelID, id, now, rendered string
	input                        MessageInput
	result                       chan messagePublishResult
}

type messagePublishResult struct {
	message Message
	err     error
}

func (s *Service) enqueueMessage(request messagePublishRequest) (Message, error) {
	depth := int64(len(s.messageRequests) + 1)
	for current := s.messageQueueHigh.Load(); depth > current && !s.messageQueueHigh.CompareAndSwap(current, depth); current = s.messageQueueHigh.Load() {
	}
	select {
	case <-request.ctx.Done():
		return Message{}, request.ctx.Err()
	case <-s.messageStop:
		return Message{}, sql.ErrConnDone
	case s.messageRequests <- request:
	}
	select {
	case <-request.ctx.Done():
		return Message{}, request.ctx.Err()
	case result := <-request.result:
		return result.message, result.err
	}
}

func (s *Service) runMessageWriter() {
	defer close(s.messageDone)
	for {
		select {
		case first := <-s.messageRequests:
			batch := []messagePublishRequest{first}
			timer := time.NewTimer(messageBatchWindow)
		collect:
			for len(batch) < messageBatchSize {
				select {
				case request := <-s.messageRequests:
					batch = append(batch, request)
				case <-timer.C:
					break collect
				case <-s.messageStop:
					break collect
				}
			}
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			s.publishMessageBatch(batch)
		case <-s.messageStop:
			for {
				select {
				case request := <-s.messageRequests:
					s.publishMessageBatch([]messagePublishRequest{request})
				default:
					return
				}
			}
		}
	}
}

func (s *Service) publishMessageBatch(batch []messagePublishRequest) {
	ctx := context.Background()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		for _, request := range batch {
			request.result <- messagePublishResult{err: err}
		}
		return
	}
	results := make([]messagePublishResult, len(batch))
	for index, request := range batch {
		if err := request.ctx.Err(); err != nil {
			results[index].err = err
			continue
		}
		savepoint := fmt.Sprintf("message_%d", index)
		_, _ = tx.ExecContext(ctx, "SAVEPOINT "+savepoint)
		message, itemErr := s.publishMessageInTransaction(ctx, tx, request)
		if itemErr != nil {
			_, _ = tx.ExecContext(ctx, "ROLLBACK TO "+savepoint)
			_, _ = tx.ExecContext(ctx, "RELEASE "+savepoint)
			results[index].err = itemErr
			continue
		}
		_, _ = tx.ExecContext(ctx, "RELEASE "+savepoint)
		results[index].message = message
	}
	_, _ = tx.ExecContext(ctx, `DELETE FROM realtime_events WHERE cursor <=
		(SELECT COALESCE(MAX(cursor), 0) - ? FROM realtime_events)`, realtimeRetention)
	if err = tx.Commit(); err != nil {
		for index := range results {
			if results[index].err == nil {
				results[index] = messagePublishResult{err: err}
			}
		}
	}
	if err == nil {
		s.messageTransactions.Add(1)
		for _, result := range results {
			if result.err == nil {
				s.messageCommitted.Add(1)
			}
		}
	}
	for index, request := range batch {
		request.result <- results[index]
	}
}

func (s *Service) publishMessageInTransaction(ctx context.Context, tx *sql.Tx, request messagePublishRequest) (Message, error) {
	if err := validateReply(ctx, tx, request.channelID, request.input.ReplyTo); err != nil {
		return Message{}, err
	}
	if err := validateMentions(ctx, tx, request.input.MentionIDs); err != nil {
		return Message{}, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO channel_sequences(channel_id, next_sequence) VALUES (?, 1)", request.channelID); err != nil {
		return Message{}, err
	}
	var sequence int64
	if err := tx.QueryRowContext(ctx, "UPDATE channel_sequences SET next_sequence = next_sequence + 1 WHERE channel_id = ? RETURNING next_sequence - 1", request.channelID).Scan(&sequence); err != nil {
		return Message{}, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO messages(id, channel_id, author_id, sequence, body, created_at, reply_to_message_id, rendered_html) VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?)", request.id, request.channelID, request.member.ID, sequence, request.input.Body, request.now, request.input.ReplyTo, request.rendered); err != nil {
		return Message{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO unread_counts(member_id, channel_id, count)
		SELECT CASE WHEN member_low_id = ? THEN member_high_id ELSE member_low_id END, id, 1
		FROM direct_messages WHERE id = ? AND ? IN (member_low_id, member_high_id)
		ON CONFLICT(member_id, channel_id) DO UPDATE SET count = unread_counts.count + 1`, request.member.ID, request.channelID, request.member.ID); err != nil {
		return Message{}, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO message_search(message_id, channel_id, body) VALUES (?, ?, ?)", request.id, request.channelID, request.input.Body); err != nil {
		return Message{}, err
	}
	for _, mentionedID := range uniqueStrings(request.input.MentionIDs) {
		if _, err := tx.ExecContext(ctx, "INSERT INTO message_mentions(message_id, member_id) VALUES (?, ?)", request.id, mentionedID); err != nil {
			return Message{}, err
		}
	}
	if err := s.publishAttachments(ctx, tx, request.member.ID, request.id, request.input.AttachmentIDs); err != nil {
		return Message{}, err
	}
	message := Message{ID: request.id, ChannelID: request.channelID, AuthorID: request.member.ID, AuthorName: nameForMember(request.member), Sequence: sequence, Body: request.input.Body, CreatedAt: request.now, RenderedHTML: request.rendered, ClientID: request.input.ClientID}
	if err := s.decorateMessageWith(ctx, tx, request.member.ID, &message); err != nil {
		return Message{}, err
	}
	if err := appendRealtimeEventWithoutPrune(ctx, tx, "message.created", request.channelID, message); err != nil {
		return Message{}, err
	}
	return message, nil
}

func (s *Service) Close() {
	s.messageClose.Do(func() { close(s.messageStop); <-s.messageDone })
}
