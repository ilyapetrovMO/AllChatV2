// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"allchat/internal/identity"
)

type Report struct {
	ID              string `json:"id"`
	ReporterID      string `json:"reporter_id"`
	TargetMemberID  string `json:"target_member_id,omitempty"`
	TargetMessageID string `json:"target_message_id,omitempty"`
	Reason          string `json:"reason"`
	Status          string `json:"status"`
	CreatedAt       string `json:"created_at"`
	ResolvedAt      string `json:"resolved_at,omitempty"`
	ResolvedBy      string `json:"resolved_by,omitempty"`
	Outcome         string `json:"outcome,omitempty"`
}

type ModerationRecord struct {
	ID               int64  `json:"id"`
	ActorID          string `json:"actor_id"`
	Action           string `json:"action"`
	TargetMemberID   string `json:"target_member_id,omitempty"`
	TargetMessageID  string `json:"target_message_id,omitempty"`
	TargetResourceID string `json:"target_resource_id,omitempty"`
	ReportID         string `json:"report_id,omitempty"`
	Reason           string `json:"reason"`
	Outcome          string `json:"outcome"`
	CreatedAt        string `json:"created_at"`
}

func (s *Service) CreateReport(ctx context.Context, reporter identity.Member, targetMemberID, targetMessageID, reason string) (Report, error) {
	reason = strings.TrimSpace(reason)
	if utf8.RuneCountInString(reason) < 3 || utf8.RuneCountInString(reason) > 1000 || (targetMemberID == "") == (targetMessageID == "") {
		return Report{}, ErrInvalidInput
	}
	if targetMessageID != "" {
		message, err := s.message(ctx, targetMessageID)
		if err != nil || message.Deleted {
			return Report{}, ErrNotFound
		}
		allowed, _ := s.CanUseChannel(ctx, reporter.ID, message.ChannelID, PermissionViewChannels, false)
		if !allowed {
			return Report{}, ErrNotFound
		}
		targetMemberID = ""
	} else {
		var exists bool
		if err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM members WHERE id = ?)", targetMemberID).Scan(&exists); err != nil || !exists || targetMemberID == reporter.ID {
			return Report{}, ErrNotFound
		}
	}
	id, err := randomID()
	if err != nil {
		return Report{}, err
	}
	created := databaseTime(time.Now())
	_, err = s.db.ExecContext(ctx, "INSERT INTO reports(id, reporter_id, target_member_id, target_message_id, reason, created_at) VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?)", id, reporter.ID, targetMemberID, targetMessageID, reason, created)
	if err != nil {
		return Report{}, err
	}
	return Report{ID: id, ReporterID: reporter.ID, TargetMemberID: targetMemberID, TargetMessageID: targetMessageID, Reason: reason, Status: "open", CreatedAt: created}, nil
}

func (s *Service) ListReports(ctx context.Context, actor identity.Member) ([]Report, error) {
	moderator, _ := s.HasPermission(ctx, actor.ID, PermissionModerate)
	query := "SELECT id, reporter_id, COALESCE(target_member_id,''), COALESCE(target_message_id,''), reason, status, created_at, COALESCE(resolved_at,''), COALESCE(resolved_by,''), COALESCE(outcome,'') FROM reports"
	args := []any{}
	if !moderator {
		query += " WHERE reporter_id = ?"
		args = append(args, actor.ID)
	}
	query += " ORDER BY created_at DESC"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var reports []Report
	for rows.Next() {
		var item Report
		if err := rows.Scan(&item.ID, &item.ReporterID, &item.TargetMemberID, &item.TargetMessageID, &item.Reason, &item.Status, &item.CreatedAt, &item.ResolvedAt, &item.ResolvedBy, &item.Outcome); err != nil {
			return nil, err
		}
		reports = append(reports, item)
	}
	return reports, rows.Err()
}

func (s *Service) ResolveReport(ctx context.Context, actor identity.Member, reportID, outcome string) (Report, error) {
	if allowed, _ := s.HasPermission(ctx, actor.ID, PermissionModerate); !allowed {
		return Report{}, ErrForbidden
	}
	outcome = strings.TrimSpace(outcome)
	if utf8.RuneCountInString(outcome) < 3 || utf8.RuneCountInString(outcome) > 1000 {
		return Report{}, ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Report{}, err
	}
	defer tx.Rollback()
	var item Report
	err = tx.QueryRowContext(ctx, "SELECT id, reporter_id, COALESCE(target_member_id,''), COALESCE(target_message_id,''), reason, status, created_at FROM reports WHERE id = ?", reportID).Scan(&item.ID, &item.ReporterID, &item.TargetMemberID, &item.TargetMessageID, &item.Reason, &item.Status, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Report{}, ErrNotFound
	}
	if err != nil {
		return Report{}, err
	}
	if item.Status != "open" {
		return Report{}, ErrInvalidInput
	}
	now := databaseTime(time.Now())
	if _, err = tx.ExecContext(ctx, "UPDATE reports SET status='resolved', resolved_at=?, resolved_by=?, outcome=? WHERE id=?", now, actor.ID, outcome, reportID); err != nil {
		return Report{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO moderation_records(actor_id, action, target_member_id, target_message_id, report_id, reason, outcome, created_at) VALUES (?, 'resolve_report', NULLIF(?,''), NULLIF(?,''), ?, ?, ?, ?)", actor.ID, item.TargetMemberID, item.TargetMessageID, item.ID, item.Reason, outcome, now); err != nil {
		return Report{}, err
	}
	if err = tx.Commit(); err != nil {
		return Report{}, err
	}
	item.Status = "resolved"
	item.ResolvedAt = now
	item.ResolvedBy = actor.ID
	item.Outcome = outcome
	return item, nil
}

func (s *Service) ListModerationRecords(ctx context.Context, actor identity.Member) ([]ModerationRecord, error) {
	if allowed, _ := s.HasPermission(ctx, actor.ID, PermissionViewAudit); !allowed {
		return nil, ErrForbidden
	}
	rows, err := s.db.QueryContext(ctx, "SELECT id, actor_id, action, COALESCE(target_member_id,''), COALESCE(target_message_id,''), COALESCE(report_id,''), reason, outcome, created_at, COALESCE(target_resource_id,'') FROM moderation_records ORDER BY id DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []ModerationRecord
	for rows.Next() {
		var item ModerationRecord
		if err := rows.Scan(&item.ID, &item.ActorID, &item.Action, &item.TargetMemberID, &item.TargetMessageID, &item.ReportID, &item.Reason, &item.Outcome, &item.CreatedAt, &item.TargetResourceID); err != nil {
			return nil, err
		}
		records = append(records, item)
	}
	return records, rows.Err()
}

type ModerationAction struct {
	Action          string `json:"action"`
	TargetMemberID  string `json:"target_member_id,omitempty"`
	TargetMessageID string `json:"target_message_id,omitempty"`
	InvitationID    string `json:"invitation_id,omitempty"`
	Reason          string `json:"reason"`
	DurationMinutes int    `json:"duration_minutes,omitempty"`
}

func (s *Service) ApplyModeration(ctx context.Context, actor identity.Member, input ModerationAction) (ModerationRecord, error) {
	input.Action, input.Reason = strings.TrimSpace(input.Action), strings.TrimSpace(input.Reason)
	if utf8.RuneCountInString(input.Reason) < 3 || utf8.RuneCountInString(input.Reason) > 1000 {
		return ModerationRecord{}, ErrInvalidInput
	}
	if input.Action != "delete_message" && input.Action != "revoke_invitation" {
		if err := s.CanModerateMember(ctx, actor, input.TargetMemberID); err != nil {
			return ModerationRecord{}, err
		}
	} else if allowed, _ := s.HasPermission(ctx, actor.ID, PermissionModerate); !allowed {
		return ModerationRecord{}, ErrForbidden
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ModerationRecord{}, err
	}
	defer tx.Rollback()
	now, outcome := databaseTime(time.Now()), "applied"
	switch input.Action {
	case "warn":
		if input.TargetMemberID == "" {
			return ModerationRecord{}, ErrInvalidInput
		}
	case "timeout", "suspend":
		if input.DurationMinutes < 1 || input.DurationMinutes > 525600 {
			return ModerationRecord{}, ErrInvalidInput
		}
		column := "timed_out_until"
		if input.Action == "suspend" {
			column = "suspended_until"
		}
		until := databaseTime(time.Now().Add(time.Duration(input.DurationMinutes) * time.Minute))
		if _, err = tx.ExecContext(ctx, "UPDATE members SET "+column+"=? WHERE id=?", until, input.TargetMemberID); err != nil {
			return ModerationRecord{}, err
		}
		outcome = "applied until " + until
		if input.Action == "suspend" {
			if _, err = tx.ExecContext(ctx, "UPDATE sessions SET revoked_at=? WHERE member_id=? AND revoked_at IS NULL", now, input.TargetMemberID); err != nil {
				return ModerationRecord{}, err
			}
		}
	case "kick":
		result, e := tx.ExecContext(ctx, "UPDATE sessions SET revoked_at=? WHERE member_id=? AND revoked_at IS NULL", now, input.TargetMemberID)
		if e != nil {
			return ModerationRecord{}, e
		}
		count, _ := result.RowsAffected()
		outcome = "revoked " + strconv.FormatInt(count, 10) + " sessions"
	case "revoke_invitation":
		result, e := tx.ExecContext(ctx, "UPDATE invitations SET revoked_at=? WHERE id=? AND revoked_at IS NULL", now, input.InvitationID)
		if e != nil {
			return ModerationRecord{}, e
		}
		if count, _ := result.RowsAffected(); count != 1 {
			return ModerationRecord{}, ErrNotFound
		}
	case "delete_message":
		var channelID string
		err = tx.QueryRowContext(ctx, "SELECT channel_id FROM messages WHERE id=? AND deleted_at IS NULL", input.TargetMessageID).Scan(&channelID)
		if errors.Is(err, sql.ErrNoRows) {
			return ModerationRecord{}, ErrNotFound
		}
		if err != nil {
			return ModerationRecord{}, err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE messages SET body=NULL, rendered_html='', edited_at=NULL, deleted_at=? WHERE id=?", now, input.TargetMessageID); err != nil {
			return ModerationRecord{}, err
		}
		if _, err = tx.ExecContext(ctx, "DELETE FROM message_search WHERE message_id=?", input.TargetMessageID); err != nil {
			return ModerationRecord{}, err
		}
		if err = s.markMessageAttachmentsForGC(ctx, tx, input.TargetMessageID); err != nil {
			return ModerationRecord{}, err
		}
		var message Message
		e := tx.QueryRowContext(ctx, `SELECT id,channel_id,author_id,sequence,created_at FROM messages WHERE id=?`, input.TargetMessageID).Scan(&message.ID, &message.ChannelID, &message.AuthorID, &message.Sequence, &message.CreatedAt)
		if e != nil {
			return ModerationRecord{}, e
		}
		message.Deleted = true
		if err = appendRealtimeEvent(ctx, tx, "message.deleted", channelID, message); err != nil {
			return ModerationRecord{}, err
		}
	default:
		return ModerationRecord{}, ErrInvalidInput
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO moderation_records(actor_id,action,target_member_id,target_message_id,target_resource_id,reason,outcome,created_at) VALUES(?,?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),?,?,?)`, actor.ID, input.Action, input.TargetMemberID, input.TargetMessageID, input.InvitationID, input.Reason, outcome, now)
	if err != nil {
		return ModerationRecord{}, err
	}
	id, _ := result.LastInsertId()
	if err = tx.Commit(); err != nil {
		return ModerationRecord{}, err
	}
	return ModerationRecord{ID: id, ActorID: actor.ID, Action: input.Action, TargetMemberID: input.TargetMemberID, TargetMessageID: input.TargetMessageID, TargetResourceID: input.InvitationID, Reason: input.Reason, Outcome: outcome, CreatedAt: now}, nil
}

func (s *Service) PurgeModerationRecords(ctx context.Context, actor identity.Member, before string) (ModerationRecord, error) {
	if !actor.Owner {
		return ModerationRecord{}, ErrForbidden
	}
	cutoff, err := time.Parse(time.RFC3339, before)
	if err != nil || !cutoff.Before(time.Now()) {
		return ModerationRecord{}, ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ModerationRecord{}, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, "DELETE FROM moderation_records WHERE created_at < ?", databaseTime(cutoff))
	if err != nil {
		return ModerationRecord{}, err
	}
	count, _ := result.RowsAffected()
	now, outcome := databaseTime(time.Now()), fmt.Sprintf("purged %d records before %s", count, databaseTime(cutoff))
	insert, err := tx.ExecContext(ctx, "INSERT INTO moderation_records(actor_id,action,reason,outcome,created_at) VALUES(?,'purge_records','Owner maintenance action',?,?)", actor.ID, outcome, now)
	if err != nil {
		return ModerationRecord{}, err
	}
	id, _ := insert.LastInsertId()
	if err = tx.Commit(); err != nil {
		return ModerationRecord{}, err
	}
	return ModerationRecord{ID: id, ActorID: actor.ID, Action: "purge_records", Reason: "Owner maintenance action", Outcome: outcome, CreatedAt: now}, nil
}

func (s *Service) CanModerateMember(ctx context.Context, actor identity.Member, targetMemberID string) error {
	allowed, _ := s.HasPermission(ctx, actor.ID, PermissionModerate)
	if !allowed {
		return ErrForbidden
	}
	actorPosition, err := s.highestPosition(ctx, actor.ID)
	if err != nil {
		return ErrForbidden
	}
	targetPosition, err := s.highestPosition(ctx, targetMemberID)
	if err != nil {
		return ErrNotFound
	}
	if actor.ID == targetMemberID || actorPosition <= targetPosition {
		return ErrHierarchy
	}
	return nil
}

func (s *Service) RecordModeration(ctx context.Context, actor identity.Member, action, targetMemberID, reason, outcome string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return ErrInvalidInput
	}
	_, err := s.db.ExecContext(ctx, "INSERT INTO moderation_records(actor_id, action, target_member_id, reason, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?)", actor.ID, action, targetMemberID, reason, outcome, databaseTime(time.Now()))
	return err
}
