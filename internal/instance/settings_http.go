// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"html/template"
	"io"
	"net/http"
	"strconv"
)

type communitySettingsView struct {
	Name                 string `json:"name"`
	AvatarURL            string `json:"avatar_url,omitempty"`
	MaxAttachmentMiB     int64  `json:"max_attachment_mib"`
	HomeMarkdown         string `json:"home_markdown"`
	PushRelayURL         string `json:"push_relay_url"`
	PushKeyID            string `json:"push_key_id"`
	PushPublicKey        string `json:"push_public_key"`
	CommunityRingtoneSet bool   `json:"community_ringtone_set"`
}

func (i *Instance) communitySettingsAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "permission denied"})
		return
	}
	home, err := i.community.CommunityHomeMarkdown(r.Context())
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	name, err := i.community.CommunityName(r.Context())
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	relayURL, err := i.mobilePushRelayURL(r.Context())
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	communityRingtoneSet, _ := i.ringtoneStatus(member.ID)
	writeJSON(w, http.StatusOK, communitySettingsView{
		Name: name, AvatarURL: communityAvatarURL(i.community.HasCommunityAvatar(r.Context())), MaxAttachmentMiB: i.community.MaxAttachmentBytes() / (1 << 20), HomeMarkdown: home,
		PushRelayURL: relayURL, PushKeyID: i.mobilePush.keyID,
		PushPublicKey:        base64.RawURLEncoding.EncodeToString(i.mobilePush.publicKey),
		CommunityRingtoneSet: communityRingtoneSet,
	})
}

func communityAvatarURL(exists bool) string {
	if exists {
		return "/api/v1/community-avatar"
	}
	return ""
}

func (i *Instance) updateCommunityAvatarAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "permission denied"})
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, (8<<20)+1))
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid avatar"})
		return
	}
	if err := i.community.SetCommunityAvatar(r.Context(), http.DetectContentType(data), data); err != nil {
		writeCommunityError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (i *Instance) removeCommunityAvatarAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "permission denied"})
		return
	}
	if err := i.community.RemoveCommunityAvatar(r.Context()); err != nil {
		writeCommunityError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (i *Instance) communityAvatarAPI(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := i.authenticated(w, r); !ok {
		return
	}
	data, contentType, err := i.community.CommunityAvatar(r.Context())
	if err != nil {
		http.NotFound(w, r)
		return
	}
	digest := sha256.Sum256(data)
	etag := `"` + base64.RawURLEncoding.EncodeToString(digest[:12]) + `"`
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	_, _ = w.Write(data)
}

func (i *Instance) updateCommunitySettingsAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "permission denied"})
		return
	}
	var input communitySettingsView
	if decodeJSON(r, &input) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if err := i.community.UpdateCommunityName(r.Context(), member, input.Name); err != nil {
		writeCommunityError(w, err)
		return
	}
	if err := i.community.UpdateMaxAttachmentBytes(r.Context(), member, input.MaxAttachmentMiB<<20); err != nil {
		writeCommunityError(w, err)
		return
	}
	if err := i.community.UpdateCommunityHomeMarkdown(r.Context(), member, input.HomeMarkdown); err != nil {
		writeCommunityError(w, err)
		return
	}
	var pushConfig Config
	if err := pushConfig.ConfigurePushRelay(input.PushRelayURL); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if _, err := i.db.ExecContext(r.Context(), `INSERT INTO mobile_push_settings(id,relay_url) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET relay_url=excluded.relay_url`, pushConfig.PushRelayURL); err != nil {
		writeCommunityError(w, err)
		return
	}
	input.PushRelayURL = pushConfig.PushRelayURL
	input.AvatarURL = communityAvatarURL(i.community.HasCommunityAvatar(r.Context()))
	input.PushKeyID = i.mobilePush.keyID
	input.PushPublicKey = base64.RawURLEncoding.EncodeToString(i.mobilePush.publicKey)
	input.CommunityRingtoneSet, _ = i.ringtoneStatus(member.ID)
	writeJSON(w, http.StatusOK, input)
}

func (i *Instance) communitySettingsPage(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		http.Error(w, "permission denied", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	home, _ := i.community.CommunityHomeMarkdown(r.Context())
	name, _ := i.community.CommunityName(r.Context())
	relayURL, _ := i.mobilePushRelayURL(r.Context())
	communityRingtoneSet, _ := i.ringtoneStatus(member.ID)
	_ = communitySettingsTemplate.Execute(w, map[string]any{"CSRF": csrfCookieValue(r), "Name": name, "MaxAttachmentMiB": i.community.MaxAttachmentBytes() / (1 << 20), "HomeMarkdown": home, "PushRelayURL": relayURL, "PushKeyID": i.mobilePush.keyID, "PushPublicKey": base64.RawURLEncoding.EncodeToString(i.mobilePush.publicKey), "CommunityRingtoneSet": communityRingtoneSet})
}

func (i *Instance) updateCommunitySettingsWeb(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		http.Error(w, "permission denied", http.StatusForbidden)
		return
	}
	_ = r.ParseForm()
	if err := i.community.UpdateCommunityName(r.Context(), member, r.FormValue("name")); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	maximumMiB, err := strconv.ParseInt(r.FormValue("max_attachment_mib"), 10, 64)
	if err != nil || i.community.UpdateMaxAttachmentBytes(r.Context(), member, maximumMiB<<20) != nil {
		http.Error(w, "attachment limit must be between 1 and 256 MiB", http.StatusBadRequest)
		return
	}
	if err := i.community.UpdateCommunityHomeMarkdown(r.Context(), member, r.FormValue("home_markdown")); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var pushConfig Config
	if err := pushConfig.ConfigurePushRelay(r.FormValue("push_relay_url")); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if _, err := i.db.ExecContext(r.Context(), `INSERT INTO mobile_push_settings(id,relay_url) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET relay_url=excluded.relay_url`, pushConfig.PushRelayURL); err != nil {
		http.Error(w, "could not save mobile push relay", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/admin/settings?saved=1", http.StatusSeeOther)
}

func (i *Instance) mobilePushRelayURL(ctx context.Context) (string, error) {
	var value string
	err := i.db.QueryRowContext(ctx, "SELECT relay_url FROM mobile_push_settings WHERE id=1").Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

func (i *Instance) communityHomeAPI(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := i.authenticated(w, r); !ok {
		return
	}
	value, err := i.community.CommunityHomeMarkdown(r.Context())
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"markdown": value})
}

var communitySettingsTemplate = template.Must(template.New("community-settings").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Community Settings — AllChat</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script><script src="/assets/ringtone-settings.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Community Settings</div><nav class="channel-nav settings-nav"><a href="/admin/settings" aria-current="page">General</a><a href="/admin/channels">Channels</a><a href="/admin/roles">Roles</a><a href="/admin/invitations">Invitations</a><a href="/admin/soundboard">Soundboard</a></nav></aside><main class="content-shell"><header class="content-header"><h1>Community Settings</h1></header><section class="content"><h2 class="page-title">General</h2><form class="card" method="post" action="/admin/settings"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label>Community name<input name="name" maxlength="100" value="{{.Name}}" required></label><label>Maximum attachment size (MiB)<input name="max_attachment_mib" type="number" min="1" max="256" step="1" value="{{.MaxAttachmentMiB}}" required></label><p class="muted">Applies immediately. Your reverse proxy must allow at least the same request size.</p><label>Mobile push relay<input name="push_relay_url" type="url" value="{{.PushRelayURL}}" placeholder="https://ru.elitedarklord.com"></label><p class="muted">Used only for Android and iOS background notifications. Leave empty to disable mobile push.</p><details><summary>Relay authorization identity</summary><p class="muted">Key ID: <code>{{.PushKeyID}}</code></p><textarea readonly rows="3">{{.PushPublicKey}}</textarea></details><button>Save settings</button></form><section class="card" data-community-ringtone data-active="{{.CommunityRingtoneSet}}"><h2>Community ringtone</h2><p data-ringtone-status>{{if .CommunityRingtoneSet}}Custom Community ringtone{{else}}Generated tone{{end}}</p><label>Audio file (MP3, WAV, or Ogg; up to 2 MiB)<input type="file" accept="audio/mpeg,audio/wav,audio/ogg" data-ringtone-file></label><button type="button" data-ringtone-remove {{if not .CommunityRingtoneSet}}hidden{{end}}>Remove custom ringtone</button><p class="muted" data-ringtone-notice></p></section></section></main></div></body></html>`))
