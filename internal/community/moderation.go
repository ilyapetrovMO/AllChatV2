// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"database/sql"
	"errors"
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
	ID              int64  `json:"id"`
	ActorID         string `json:"actor_id"`
	Action          string `json:"action"`
	TargetMemberID  string `json:"target_member_id,omitempty"`
	TargetMessageID string `json:"target_message_id,omitempty"`
	ReportID        string `json:"report_id,omitempty"`
	Reason          string `json:"reason"`
	Outcome         string `json:"outcome"`
	CreatedAt       string `json:"created_at"`
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
	rows, err := s.db.QueryContext(ctx, "SELECT id, actor_id, action, COALESCE(target_member_id,''), COALESCE(target_message_id,''), COALESCE(report_id,''), reason, outcome, created_at FROM moderation_records ORDER BY id DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []ModerationRecord
	for rows.Next() {
		var item ModerationRecord
		if err := rows.Scan(&item.ID, &item.ActorID, &item.Action, &item.TargetMemberID, &item.TargetMessageID, &item.ReportID, &item.Reason, &item.Outcome, &item.CreatedAt); err != nil {
			return nil, err
		}
		records = append(records, item)
	}
	return records, rows.Err()
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
