// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"io"
	"net/http"
	"strings"
)

const maxRingtoneBytes = 2 << 20

func normalizedRingtoneContentType(value string) string {
	value = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
	switch value {
	case "audio/mpeg", "audio/mp3":
		return "audio/mpeg"
	case "audio/ogg", "application/ogg":
		return "audio/ogg"
	case "audio/wav", "audio/x-wav", "audio/wave":
		return "audio/wav"
	default:
		return ""
	}
}

func readRingtone(request *http.Request) ([]byte, string, error) {
	contentType := normalizedRingtoneContentType(request.Header.Get("Content-Type"))
	if contentType == "" {
		return nil, "", communityRingtoneError("unsupported ringtone type")
	}
	data, err := io.ReadAll(io.LimitReader(request.Body, maxRingtoneBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxRingtoneBytes {
		return nil, "", communityRingtoneError("ringtone must be between 1 byte and 2 MiB")
	}
	return data, contentType, nil
}

type communityRingtoneError string

func (e communityRingtoneError) Error() string { return string(e) }

func (i *Instance) updateCommunityRingtoneAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "permission denied"})
		return
	}
	data, contentType, err := readRingtone(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if _, err = i.db.ExecContext(r.Context(), "UPDATE community SET ringtone=?,ringtone_content_type=? WHERE id=1", data, contentType); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Could not save Community ringtone"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (i *Instance) removeCommunityRingtoneAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "permission denied"})
		return
	}
	if _, err := i.db.ExecContext(r.Context(), "UPDATE community SET ringtone=NULL,ringtone_content_type=NULL WHERE id=1"); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Could not remove Community ringtone"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (i *Instance) updateMemberRingtoneAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	data, contentType, err := readRingtone(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	_, err = i.db.ExecContext(r.Context(), `INSERT INTO member_notification_settings(member_id,level,muted,sound_enabled,ringtone,ringtone_content_type) VALUES(?,'all_messages',0,1,?,?)
		ON CONFLICT(member_id) DO UPDATE SET ringtone=excluded.ringtone,ringtone_content_type=excluded.ringtone_content_type`, member.ID, data, contentType)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "Could not save ringtone"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (i *Instance) removeMemberRingtoneAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if _, err := i.db.ExecContext(r.Context(), "UPDATE member_notification_settings SET ringtone=NULL,ringtone_content_type=NULL WHERE member_id=?", member.ID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Could not reset ringtone"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (i *Instance) resolvedRingtone(memberID string) (data []byte, contentType, source string, err error) {
	err = i.db.QueryRow("SELECT ringtone,ringtone_content_type FROM member_notification_settings WHERE member_id=? AND ringtone IS NOT NULL", memberID).Scan(&data, &contentType)
	if err == nil {
		return data, contentType, "member", nil
	}
	if err != sql.ErrNoRows {
		return nil, "", "", err
	}
	err = i.db.QueryRow("SELECT ringtone,ringtone_content_type FROM community WHERE id=1 AND ringtone IS NOT NULL").Scan(&data, &contentType)
	if err == nil {
		return data, contentType, "community", nil
	}
	if err == sql.ErrNoRows {
		return nil, "", "tone", nil
	}
	return nil, "", "", err
}

func (i *Instance) ringtoneAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	data, contentType, source, err := i.resolvedRingtone(member.ID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "Ringtone unavailable"})
		return
	}
	w.Header().Set("X-AllChat-Ringtone-Source", source)
	if source == "tone" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	digest := sha256.Sum256(data)
	etag := `"` + base64.RawURLEncoding.EncodeToString(digest[:12]) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("Content-Type", contentType)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	_, _ = w.Write(data)
}

func (i *Instance) ringtoneStatus(memberID string) (communitySet, memberSet bool) {
	_ = i.db.QueryRow("SELECT ringtone IS NOT NULL FROM community WHERE id=1").Scan(&communitySet)
	_ = i.db.QueryRow("SELECT ringtone IS NOT NULL FROM member_notification_settings WHERE member_id=?", memberID).Scan(&memberSet)
	return
}
