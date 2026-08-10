package community

import (
	"context"

	"allchat/internal/identity"
)

type MemberExport struct {
	Profile          identity.Member      `json:"profile"`
	AuthoredMessages []ExportMessage      `json:"authored_messages"`
	DirectMessages   []ExportConversation `json:"direct_messages"`
}
type ExportAttachment struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	URL         string `json:"url"`
}
type ExportMessage struct {
	ID           string             `json:"id"`
	ChannelID    string             `json:"channel_id"`
	Sequence     int64              `json:"sequence"`
	Body         string             `json:"body,omitempty"`
	CreatedAt    string             `json:"created_at"`
	Deleted      bool               `json:"deleted"`
	SentByMember bool               `json:"sent_by_member"`
	Attachments  []ExportAttachment `json:"attachments,omitempty"`
}
type ExportConversation struct {
	ID       string          `json:"id"`
	Messages []ExportMessage `json:"messages"`
}

func (s *Service) ExportMemberData(ctx context.Context, member identity.Member) (MemberExport, error) {
	result := MemberExport{Profile: member, AuthoredMessages: []ExportMessage{}, DirectMessages: []ExportConversation{}}
	rows, err := s.db.QueryContext(ctx, `SELECT id,channel_id,sequence,COALESCE(body,''),created_at,deleted_at IS NOT NULL FROM messages WHERE author_id=? ORDER BY channel_id,sequence`, member.ID)
	if err != nil {
		return result, err
	}
	var authored []ExportMessage
	for rows.Next() {
		var item ExportMessage
		if err = rows.Scan(&item.ID, &item.ChannelID, &item.Sequence, &item.Body, &item.CreatedAt, &item.Deleted); err != nil {
			rows.Close()
			return result, err
		}
		authored = append(authored, item)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	rows.Close()
	for _, item := range authored {
		allowed, _ := s.CanUseChannel(ctx, member.ID, item.ChannelID, PermissionViewChannels, false)
		if allowed {
			item.SentByMember = true
			item.Attachments, err = s.exportAttachments(ctx, item.ID)
			if err != nil {
				return result, err
			}
			result.AuthoredMessages = append(result.AuthoredMessages, item)
		}
	}
	dms, err := s.db.QueryContext(ctx, `SELECT id FROM direct_messages WHERE member_low_id=? OR member_high_id=? ORDER BY created_at`, member.ID, member.ID)
	if err != nil {
		return result, err
	}
	var ids []string
	for dms.Next() {
		var id string
		if err = dms.Scan(&id); err != nil {
			dms.Close()
			return result, err
		}
		ids = append(ids, id)
	}
	dms.Close()
	for _, id := range ids {
		conversation := ExportConversation{ID: id, Messages: []ExportMessage{}}
		messages, e := s.db.QueryContext(ctx, `SELECT id,sequence,COALESCE(body,''),created_at,deleted_at IS NOT NULL,author_id=? FROM messages WHERE channel_id=? ORDER BY sequence`, member.ID, id)
		if e != nil {
			return result, e
		}
		var conversationMessages []ExportMessage
		for messages.Next() {
			var item ExportMessage
			item.ChannelID = id
			if e = messages.Scan(&item.ID, &item.Sequence, &item.Body, &item.CreatedAt, &item.Deleted, &item.SentByMember); e != nil {
				messages.Close()
				return result, e
			}
			conversationMessages = append(conversationMessages, item)
		}
		if e = messages.Err(); e != nil {
			messages.Close()
			return result, e
		}
		messages.Close()
		for _, item := range conversationMessages {
			item.Attachments, e = s.exportAttachments(ctx, item.ID)
			if e != nil {
				return result, e
			}
			conversation.Messages = append(conversation.Messages, item)
		}
		result.DirectMessages = append(result.DirectMessages, conversation)
	}
	return result, nil
}
func (s *Service) exportAttachments(ctx context.Context, messageID string) ([]ExportAttachment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,original_name,content_type,size FROM attachments WHERE message_id=? AND state='published' ORDER BY created_at`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []ExportAttachment
	for rows.Next() {
		var item ExportAttachment
		if err = rows.Scan(&item.ID, &item.Name, &item.ContentType, &item.Size); err != nil {
			return nil, err
		}
		item.URL = "/api/v1/attachments/" + item.ID
		result = append(result, item)
	}
	return result, rows.Err()
}
