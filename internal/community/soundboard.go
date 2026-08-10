// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"allchat/internal/identity"
)

const maxSoundBytes int64 = 1 << 20

type SoundboardSound struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Emoji       string `json:"emoji,omitempty"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	DurationMS  int    `json:"duration_ms"`
	Position    int    `json:"position"`
	AudioURL    string `json:"audio_url"`
}
type SoundboardSettings struct {
	MaxDurationMS int `json:"max_duration_ms"`
}

func (s *Service) ListSounds(ctx context.Context, member identity.Member) ([]SoundboardSound, SoundboardSettings, error) {
	if ok, _ := s.HasPermission(ctx, member.ID, PermissionUseSoundboard); !ok {
		return nil, SoundboardSettings{}, ErrForbidden
	}
	settings, err := s.SoundboardSettings(ctx)
	if err != nil {
		return nil, settings, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,emoji,content_type,size,duration_ms,position FROM soundboard_sounds ORDER BY position,name`)
	if err != nil {
		return nil, settings, err
	}
	defer rows.Close()
	items := []SoundboardSound{}
	for rows.Next() {
		var item SoundboardSound
		if err := rows.Scan(&item.ID, &item.Name, &item.Emoji, &item.ContentType, &item.Size, &item.DurationMS, &item.Position); err != nil {
			return nil, settings, err
		}
		item.AudioURL = "/api/v1/soundboard/" + item.ID + "/audio"
		items = append(items, item)
	}
	return items, settings, rows.Err()
}
func (s *Service) SoundboardSettings(ctx context.Context) (SoundboardSettings, error) {
	var value SoundboardSettings
	err := s.db.QueryRowContext(ctx, "SELECT max_duration_ms FROM soundboard_settings WHERE id=1").Scan(&value.MaxDurationMS)
	return value, err
}
func (s *Service) UpdateSoundboardSettings(ctx context.Context, actor identity.Member, maximum int) (SoundboardSettings, error) {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageSoundboard); !ok {
		return SoundboardSettings{}, ErrForbidden
	}
	if maximum < 1000 || maximum > 30000 {
		return SoundboardSettings{}, fmt.Errorf("%w: duration must be between 1 and 30 seconds", ErrInvalidInput)
	}
	_, err := s.db.ExecContext(ctx, "UPDATE soundboard_settings SET max_duration_ms=? WHERE id=1", maximum)
	return SoundboardSettings{MaxDurationMS: maximum}, err
}

func (s *Service) UploadSound(ctx context.Context, actor identity.Member, name, emoji, contentType string, position int, source io.Reader) (SoundboardSound, error) {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageSoundboard); !ok {
		return SoundboardSound{}, ErrForbidden
	}
	name = strings.TrimSpace(name)
	emoji = strings.TrimSpace(emoji)
	if name == "" || utf8.RuneCountInString(name) > 64 || utf8.RuneCountInString(emoji) > 8 {
		return SoundboardSound{}, fmt.Errorf("%w: invalid sound name or emoji", ErrInvalidInput)
	}
	if s.dataDir == "" {
		return SoundboardSound{}, fmt.Errorf("Soundboard storage is unavailable")
	}
	if err := requireStorageReserve(s.dataDir, maxSoundBytes); err != nil {
		return SoundboardSound{}, err
	}
	data, err := io.ReadAll(io.LimitReader(source, maxSoundBytes+1))
	if err != nil || len(data) == 0 || int64(len(data)) > maxSoundBytes {
		return SoundboardSound{}, fmt.Errorf("%w: sound exceeds 1 MiB", ErrInvalidInput)
	}
	duration, normalized := soundDuration(data, contentType)
	if duration < 1 {
		return SoundboardSound{}, fmt.Errorf("%w: file must be a valid MP3, WAV, or Ogg audio clip", ErrInvalidInput)
	}
	settings, err := s.SoundboardSettings(ctx)
	if err != nil {
		return SoundboardSound{}, err
	}
	if duration > settings.MaxDurationMS {
		return SoundboardSound{}, fmt.Errorf("%w: sound is longer than the Community limit", ErrInvalidInput)
	}
	id, err := randomID()
	if err != nil {
		return SoundboardSound{}, err
	}
	storage, err := randomID()
	if err != nil {
		return SoundboardSound{}, err
	}
	directory := filepath.Join(s.dataDir, "soundboard")
	if err = os.MkdirAll(directory, 0700); err != nil {
		return SoundboardSound{}, err
	}
	temporary := filepath.Join(directory, storage+".part")
	final := filepath.Join(directory, storage)
	if err = os.WriteFile(temporary, data, 0600); err != nil {
		return SoundboardSound{}, err
	}
	if err = os.Rename(temporary, final); err != nil {
		_ = os.Remove(temporary)
		return SoundboardSound{}, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO soundboard_sounds(id,name,emoji,storage_name,content_type,size,duration_ms,position,uploader_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, id, name, emoji, storage, normalized, len(data), duration, position, actor.ID, databaseTime(time.Now()))
	if err != nil {
		_ = os.Remove(final)
		return SoundboardSound{}, err
	}
	return SoundboardSound{ID: id, Name: name, Emoji: emoji, ContentType: normalized, Size: int64(len(data)), DurationMS: duration, Position: position, AudioURL: "/api/v1/soundboard/" + id + "/audio"}, nil
}
func (s *Service) UpdateSound(ctx context.Context, actor identity.Member, id, name, emoji string, position int) (SoundboardSound, error) {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageSoundboard); !ok {
		return SoundboardSound{}, ErrForbidden
	}
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 64 || utf8.RuneCountInString(emoji) > 8 {
		return SoundboardSound{}, ErrInvalidInput
	}
	result, err := s.db.ExecContext(ctx, "UPDATE soundboard_sounds SET name=?,emoji=?,position=? WHERE id=?", name, strings.TrimSpace(emoji), position, id)
	if err != nil {
		return SoundboardSound{}, err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return SoundboardSound{}, ErrNotFound
	}
	return s.sound(ctx, id)
}
func (s *Service) DeleteSound(ctx context.Context, actor identity.Member, id string) error {
	if ok, _ := s.HasPermission(ctx, actor.ID, PermissionManageSoundboard); !ok {
		return ErrForbidden
	}
	var storage string
	if err := s.db.QueryRowContext(ctx, "SELECT storage_name FROM soundboard_sounds WHERE id=?", id).Scan(&storage); err != nil {
		return ErrNotFound
	}
	if _, err := s.db.ExecContext(ctx, "DELETE FROM soundboard_sounds WHERE id=?", id); err != nil {
		return err
	}
	return os.Remove(filepath.Join(s.dataDir, "soundboard", storage))
}
func (s *Service) sound(ctx context.Context, id string) (SoundboardSound, error) {
	var item SoundboardSound
	err := s.db.QueryRowContext(ctx, "SELECT id,name,emoji,content_type,size,duration_ms,position FROM soundboard_sounds WHERE id=?", id).Scan(&item.ID, &item.Name, &item.Emoji, &item.ContentType, &item.Size, &item.DurationMS, &item.Position)
	if err != nil {
		return item, ErrNotFound
	}
	item.AudioURL = "/api/v1/soundboard/" + item.ID + "/audio"
	return item, nil
}
func (s *Service) SoundForPlayback(ctx context.Context, member identity.Member, id, channelID string, direct bool) (SoundboardSound, error) {
	allowed, _ := s.HasPermission(ctx, member.ID, PermissionUseSoundboard)
	if !direct && channelID != "" {
		allowed, _ = s.CanUseChannel(ctx, member.ID, channelID, PermissionUseSoundboard, false)
	}
	if !allowed {
		return SoundboardSound{}, ErrForbidden
	}
	return s.sound(ctx, id)
}
func (s *Service) SoundDownload(ctx context.Context, member identity.Member, id string) (SoundboardSound, string, error) {
	if ok, _ := s.HasPermission(ctx, member.ID, PermissionUseSoundboard); !ok {
		return SoundboardSound{}, "", ErrForbidden
	}
	item, err := s.sound(ctx, id)
	if err != nil {
		return item, "", err
	}
	var storage string
	if err = s.db.QueryRowContext(ctx, "SELECT storage_name FROM soundboard_sounds WHERE id=?", id).Scan(&storage); err != nil {
		return item, "", ErrNotFound
	}
	return item, filepath.Join(s.dataDir, "soundboard", storage), nil
}

func soundDuration(data []byte, contentType string) (int, string) {
	if len(data) >= 44 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WAVE" {
		rate := binary.LittleEndian.Uint32(data[28:32])
		for at := 12; at+8 <= len(data); {
			size := int(binary.LittleEndian.Uint32(data[at+4 : at+8]))
			if string(data[at:at+4]) == "data" && rate > 0 {
				return size * 1000 / int(rate), "audio/wav"
			}
			at += 8 + size + (size & 1)
		}
	}
	if bytes.Contains(data[:min(len(data), 128)], []byte("OggS")) {
		rate := uint32(48000)
		if at := bytes.Index(data, []byte("\x01vorbis")); at >= 0 && at+16 <= len(data) {
			rate = binary.LittleEndian.Uint32(data[at+12 : at+16])
		}
		var granule uint64
		for at := 0; at+27 <= len(data); {
			next := bytes.Index(data[at:], []byte("OggS"))
			if next < 0 {
				break
			}
			at += next
			if at+14 <= len(data) {
				g := binary.LittleEndian.Uint64(data[at+6 : at+14])
				if g > granule {
					granule = g
				}
			}
			at += 4
		}
		if rate > 0 && granule > 0 {
			return int(granule * 1000 / uint64(rate)), "audio/ogg"
		}
	}
	start := 0
	if len(data) > 10 && string(data[:3]) == "ID3" {
		start = 10 + int(data[6]&0x7f)<<21 + int(data[7]&0x7f)<<14 + int(data[8]&0x7f)<<7 + int(data[9]&0x7f)
	}
	var durationMicroseconds int64
	rates := []int{44100, 48000, 32000}
	bitrates := []int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320}
	for at := start; at+4 <= len(data); {
		h := binary.BigEndian.Uint32(data[at : at+4])
		if h&0xffe00000 != 0xffe00000 {
			at++
			continue
		}
		version := (h >> 19) & 3
		layer := (h >> 17) & 3
		br := int((h >> 12) & 15)
		sr := int((h >> 10) & 3)
		if layer != 1 || br == 0 || br == 15 || sr == 3 {
			at++
			continue
		}
		sampleRate := rates[sr]
		sampleCount := 1152
		if version != 3 {
			sampleRate /= 2
			sampleCount = 576
			if version == 0 {
				sampleRate /= 2
			}
		}
		frame := 144*bitrates[br]*1000/sampleRate + int((h>>9)&1)
		if frame < 4 || at+frame > len(data) {
			break
		}
		durationMicroseconds += int64(sampleCount) * 1_000_000 / int64(sampleRate)
		at += frame
	}
	if durationMicroseconds > 0 {
		return int(durationMicroseconds / 1000), "audio/mpeg"
	}
	return 0, contentType
}
