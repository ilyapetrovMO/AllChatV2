// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"allchat/internal/identity"
)

const (
	defaultAttachmentBytes = int64(10 << 20)
	hardAttachmentBytes    = int64(25 << 20)
	defaultStorageBytes    = int64(1 << 30)
	hardStorageBytes       = int64(10 << 30)
	attachmentRecovery     = time.Hour
	quarantineLifetime     = 24 * time.Hour
)

type Attachment struct {
	ID          string `json:"id"`
	MessageID   string `json:"message_id,omitempty"`
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	URL         string `json:"url,omitempty"`
}

func newServiceWithAttachmentLimits(db *sql.DB, dataDir string) *Service {
	perFile := configuredLimit("ALLCHAT_MAX_ATTACHMENT_BYTES", defaultAttachmentBytes, hardAttachmentBytes)
	total := configuredLimit("ALLCHAT_MAX_ATTACHMENT_STORAGE_BYTES", defaultStorageBytes, hardStorageBytes)
	service := &Service{db: db, dataDir: dataDir, maxAttachmentBytes: perFile, maxStorageBytes: total, messageRequests: make(chan messagePublishRequest, 1024), messageStop: make(chan struct{}), messageDone: make(chan struct{})}
	go service.runMessageWriter()
	return service
}

func configuredLimit(name string, fallback, ceiling int64) int64 {
	value, err := strconv.ParseInt(os.Getenv(name), 10, 64)
	if err != nil || value < 1 {
		return fallback
	}
	if value > ceiling {
		return ceiling
	}
	return value
}

func (s *Service) UploadAttachment(ctx context.Context, member identity.Member, originalName, contentType string, source io.Reader) (Attachment, error) {
	if s.dataDir == "" {
		return Attachment{}, fmt.Errorf("Attachment storage is unavailable")
	}
	name := safeAttachmentName(originalName)
	if name == "" {
		return Attachment{}, fmt.Errorf("%w: Attachment name is invalid", ErrInvalidInput)
	}
	if contentType == "" || len(contentType) > 128 {
		contentType = "application/octet-stream"
	}
	var used int64
	if err := s.db.QueryRowContext(ctx, "SELECT COALESCE(SUM(size), 0) FROM attachments WHERE state != 'garbage'").Scan(&used); err != nil {
		return Attachment{}, err
	}
	if used >= s.maxStorageBytes {
		return Attachment{}, fmt.Errorf("%w: Attachment storage limit reached", ErrInvalidInput)
	}
	id, err := randomID()
	if err != nil {
		return Attachment{}, err
	}
	storageName, err := randomID()
	if err != nil {
		return Attachment{}, err
	}
	directory := filepath.Join(s.dataDir, "attachments")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return Attachment{}, err
	}
	temporary := filepath.Join(directory, storageName+".part")
	finalPath := filepath.Join(directory, storageName)
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return Attachment{}, err
	}
	size, copyErr := io.Copy(file, io.LimitReader(source, s.maxAttachmentBytes+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || size < 1 || size > s.maxAttachmentBytes || used+size > s.maxStorageBytes {
		_ = os.Remove(temporary)
		return Attachment{}, fmt.Errorf("%w: Attachment exceeds configured limits", ErrInvalidInput)
	}
	if err := os.Rename(temporary, finalPath); err != nil {
		_ = os.Remove(temporary)
		return Attachment{}, err
	}
	created := databaseTime(time.Now())
	if _, err := s.db.ExecContext(ctx, `INSERT INTO attachments(id, uploader_id, original_name, storage_name, content_type, size, state, created_at)
		VALUES (?, ?, ?, ?, ?, ?, 'quarantine', ?)`, id, member.ID, name, storageName, contentType, size, created); err != nil {
		_ = os.Remove(finalPath)
		return Attachment{}, err
	}
	return Attachment{ID: id, Name: name, ContentType: contentType, Size: size}, nil
}

func safeAttachmentName(value string) string {
	value = filepath.Base(strings.ReplaceAll(value, "\\", "/"))
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '/' || r == '\\' {
			return -1
		}
		return r
	}, strings.TrimSpace(value))
	runes := []rune(value)
	if len(runes) > 128 {
		value = string(runes[:128])
	}
	if value == "." || value == ".." {
		return ""
	}
	return value
}

func (s *Service) publishAttachments(ctx context.Context, tx *sql.Tx, memberID, messageID string, attachmentIDs []string) error {
	attachmentIDs = uniqueStrings(attachmentIDs)
	if len(attachmentIDs) > 10 {
		return fmt.Errorf("%w: at most 10 Attachments per Message", ErrInvalidInput)
	}
	for _, attachmentID := range attachmentIDs {
		result, err := tx.ExecContext(ctx, `UPDATE attachments SET message_id = ?, state = 'published'
			WHERE id = ? AND uploader_id = ? AND state = 'quarantine' AND message_id IS NULL`, messageID, attachmentID, memberID)
		if err != nil {
			return err
		}
		count, _ := result.RowsAffected()
		if count != 1 {
			return ErrNotFound
		}
	}
	return nil
}

func (s *Service) messageAttachments(ctx context.Context, queryer richQueryer, messageID string) ([]Attachment, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT id, message_id, original_name, content_type, size FROM attachments
		WHERE message_id = ? AND state = 'published' ORDER BY created_at`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var attachments []Attachment
	for rows.Next() {
		var item Attachment
		if err := rows.Scan(&item.ID, &item.MessageID, &item.Name, &item.ContentType, &item.Size); err != nil {
			return nil, err
		}
		item.URL = "/api/v1/attachments/" + item.ID
		attachments = append(attachments, item)
	}
	return attachments, rows.Err()
}

func (s *Service) AttachmentDownload(ctx context.Context, member identity.Member, attachmentID string) (Attachment, string, error) {
	var item Attachment
	var channelID, storageName string
	err := s.db.QueryRowContext(ctx, `SELECT a.id, a.message_id, a.original_name, a.content_type, a.size, a.storage_name, msg.channel_id
		FROM attachments a JOIN messages msg ON msg.id = a.message_id WHERE a.id = ? AND a.state = 'published'`, attachmentID).
		Scan(&item.ID, &item.MessageID, &item.Name, &item.ContentType, &item.Size, &storageName, &channelID)
	if errors.Is(err, sql.ErrNoRows) {
		return Attachment{}, "", ErrNotFound
	}
	if err != nil {
		return Attachment{}, "", err
	}
	visible, _ := s.CanUseChannel(ctx, member.ID, channelID, PermissionViewChannels, true)
	if !visible {
		return Attachment{}, "", ErrNotFound
	}
	return item, filepath.Join(s.dataDir, "attachments", storageName), nil
}

func (s *Service) markMessageAttachmentsForGC(ctx context.Context, tx *sql.Tx, messageID string) error {
	_, err := tx.ExecContext(ctx, "UPDATE attachments SET state = 'garbage', gc_after = ? WHERE message_id = ? AND state = 'published'", databaseTime(time.Now().Add(attachmentRecovery)), messageID)
	return err
}

func (s *Service) CleanupAttachments(ctx context.Context) error {
	cutoff := databaseTime(time.Now())
	rows, err := s.db.QueryContext(ctx, `SELECT id, storage_name FROM attachments
		WHERE (state = 'garbage' AND gc_after <= ?) OR (state = 'quarantine' AND created_at <= ?)`, cutoff, databaseTime(time.Now().Add(-quarantineLifetime)))
	if err != nil {
		return err
	}
	type stale struct{ id, storage string }
	var items []stale
	for rows.Next() {
		var item stale
		if err := rows.Scan(&item.id, &item.storage); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	for _, item := range items {
		if err := os.Remove(filepath.Join(s.dataDir, "attachments", item.storage)); err != nil && !errors.Is(err, os.ErrNotExist) {
			continue
		}
		_, _ = s.db.ExecContext(ctx, "DELETE FROM attachments WHERE id = ?", item.id)
	}
	return nil
}
