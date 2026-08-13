// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"

	"allchat/internal/identity"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
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
	PreviewURL  string `json:"preview_url,omitempty"`
}

var attachmentPreviewLock sync.Mutex

func newServiceWithAttachmentLimits(db *sql.DB, dataDir string) *Service {
	perFile := configuredLimit("ALLCHAT_MAX_ATTACHMENT_BYTES", defaultAttachmentBytes, hardAttachmentBytes)
	total := configuredLimit("ALLCHAT_MAX_ATTACHMENT_STORAGE_BYTES", defaultStorageBytes, hardStorageBytes)
	service := &Service{db: db, dataDir: dataDir, maxStorageBytes: total, messageRequests: make(chan messagePublishRequest, 1024), messageStop: make(chan struct{}), messageDone: make(chan struct{})}
	if _, err := db.Exec(`INSERT OR IGNORE INTO attachment_settings(id,max_file_bytes) VALUES(1,?)`, perFile); err == nil {
		_ = db.QueryRow(`SELECT max_file_bytes FROM attachment_settings WHERE id=1`).Scan(&perFile)
	}
	service.maxAttachmentBytes.Store(perFile)
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

func (s *Service) UpdateMaxAttachmentBytes(ctx context.Context, actor identity.Member, maximum int64) error {
	if !actor.Owner {
		return ErrForbidden
	}
	if maximum < 1<<20 || maximum > hardAttachmentBytes {
		return fmt.Errorf("%w: attachment limit must be between 1 and 25 MiB", ErrInvalidInput)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE attachment_settings SET max_file_bytes=? WHERE id=1`, maximum); err != nil {
		return err
	}
	s.maxAttachmentBytes.Store(maximum)
	return nil
}

func (s *Service) UploadAttachment(ctx context.Context, member identity.Member, originalName, contentType string, source io.Reader) (Attachment, error) {
	if s.dataDir == "" {
		return Attachment{}, fmt.Errorf("Attachment storage is unavailable")
	}
	maximum := s.MaxAttachmentBytes()
	if err := requireStorageReserve(s.dataDir, maximum); err != nil {
		return Attachment{}, err
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
	size, copyErr := io.Copy(file, io.LimitReader(source, maximum+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || size < 1 || size > maximum || used+size > s.maxStorageBytes {
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

func requireStorageReserve(dataDir string, incoming int64) error {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(dataDir, &stat); err != nil {
		return err
	}
	available := int64(stat.Bavail) * int64(stat.Bsize)
	reserve := int64(256 << 20)
	if value := configuredLimit("ALLCHAT_STORAGE_RESERVE_BYTES", reserve, 10<<30); value > reserve {
		reserve = value
	}
	if available-incoming < reserve {
		return fmt.Errorf("%w: storage reserve reached", ErrInvalidInput)
	}
	return nil
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
		if strings.HasPrefix(item.ContentType, "image/") {
			item.PreviewURL = item.URL + "/preview"
		}
		attachments = append(attachments, item)
	}
	return attachments, rows.Err()
}

// AttachmentPreview returns a bounded conversation image, generating it lazily.
// Small images reuse the immutable original; callers still cross the same
// authorization seam as a full Attachment download.
func (s *Service) AttachmentPreview(ctx context.Context, member identity.Member, attachmentID string) (Attachment, string, string, error) {
	item, original, err := s.AttachmentDownload(ctx, member, attachmentID)
	if err != nil {
		return Attachment{}, "", "", err
	}
	if !strings.HasPrefix(item.ContentType, "image/") {
		return Attachment{}, "", "", ErrNotFound
	}
	attachmentPreviewLock.Lock()
	defer attachmentPreviewLock.Unlock()
	for _, candidate := range []struct{ suffix, contentType string }{{".preview.jpg", "image/jpeg"}, {".preview.png", "image/png"}} {
		if _, err := os.Stat(original + candidate.suffix); err == nil {
			return item, original + candidate.suffix, candidate.contentType, nil
		}
	}
	file, err := os.Open(original)
	if err != nil {
		return Attachment{}, "", "", err
	}
	config, _, err := image.DecodeConfig(file)
	file.Close()
	if err != nil || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 32_000_000 {
		return Attachment{}, "", "", fmt.Errorf("%w: image preview is unavailable", ErrInvalidInput)
	}
	if config.Width <= 1280 && config.Height <= 1280 {
		return item, original, item.ContentType, nil
	}
	file, err = os.Open(original)
	if err != nil {
		return Attachment{}, "", "", err
	}
	decoded, _, err := image.Decode(file)
	file.Close()
	if err != nil {
		return Attachment{}, "", "", fmt.Errorf("decode image preview: %w", err)
	}
	width, height := previewDimensions(config.Width, config.Height, 1280)
	resized := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.CatmullRom.Scale(resized, resized.Bounds(), decoded, decoded.Bounds(), draw.Over, nil)
	previewType, extension := "image/jpeg", ".jpg"
	if imageHasTransparency(resized) {
		previewType, extension = "image/png", ".png"
	}
	preview := original + ".preview" + extension
	temporary := preview + ".part"
	output, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return Attachment{}, "", "", err
	}
	if previewType == "image/png" {
		err = png.Encode(output, resized)
	} else {
		err = jpeg.Encode(output, resized, &jpeg.Options{Quality: 82})
	}
	closeErr := output.Close()
	if err != nil || closeErr != nil {
		_ = os.Remove(temporary)
		if err != nil {
			return Attachment{}, "", "", err
		}
		return Attachment{}, "", "", closeErr
	}
	if err := os.Rename(temporary, preview); err != nil {
		_ = os.Remove(temporary)
		return Attachment{}, "", "", err
	}
	return item, preview, previewType, nil
}

func previewDimensions(width, height, limit int) (int, int) {
	scale := min(float64(limit)/float64(width), float64(limit)/float64(height))
	return max(1, int(float64(width)*scale)), max(1, int(float64(height)*scale))
}

func imageHasTransparency(source image.Image) bool {
	bounds := source.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, alpha := source.At(x, y).RGBA()
			if alpha != 0xffff {
				return true
			}
		}
	}
	return false
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
		_ = os.Remove(filepath.Join(s.dataDir, "attachments", item.storage+".preview.jpg"))
		_ = os.Remove(filepath.Join(s.dataDir, "attachments", item.storage+".preview.png"))
	}
	return nil
}
