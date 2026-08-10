// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"encoding/json"
	"html/template"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"allchat/internal/community"
)

func (i *Instance) soundboardAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	sounds, settings, err := i.community.ListSounds(r.Context(), member)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	manage, _ := i.community.HasPermission(r.Context(), member.ID, community.PermissionManageSoundboard)
	writeJSON(w, 200, map[string]any{"sounds": sounds, "settings": settings, "can_manage": manage})
}
func (i *Instance) uploadSoundAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		http.Error(w, "invalid upload", 400)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "audio file required", 400)
		return
	}
	defer file.Close()
	content := header.Header.Get("Content-Type")
	if content == "" {
		content = mime.TypeByExtension(filepath.Ext(header.Filename))
	}
	position, _ := strconv.Atoi(r.FormValue("position"))
	sound, err := i.community.UploadSound(r.Context(), member, r.FormValue("name"), r.FormValue("emoji"), content, position, file)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 201, sound)
}
func (i *Instance) updateSoundAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input struct {
		Name     string `json:"name"`
		Emoji    string `json:"emoji"`
		Position int    `json:"position"`
	}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		http.Error(w, "invalid JSON", 400)
		return
	}
	sound, err := i.community.UpdateSound(r.Context(), member, r.PathValue("soundID"), input.Name, input.Emoji, input.Position)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 200, sound)
}
func (i *Instance) deleteSoundAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if err := i.community.DeleteSound(r.Context(), member, r.PathValue("soundID")); err != nil {
		writeCommunityError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (i *Instance) soundboardSettingsAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input community.SoundboardSettings
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		http.Error(w, "invalid JSON", 400)
		return
	}
	settings, err := i.community.UpdateSoundboardSettings(r.Context(), member, input.MaxDurationMS)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 200, settings)
}
func (i *Instance) downloadSoundAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	sound, path, err := i.community.SoundDownload(r.Context(), member, r.PathValue("soundID"))
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", sound.ContentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, r, sound.Name, info.ModTime(), file)
}
func (i *Instance) soundboardPage(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	if allowed, _ := i.community.HasPermission(r.Context(), member.ID, community.PermissionManageSoundboard); !allowed {
		http.Error(w, "Forbidden", 403)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = soundboardTemplate.Execute(w, map[string]any{"CSRF": csrfCookieValue(r)})
}

var soundboardTemplate = template.Must(template.New("soundboard").Parse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Soundboard — AllChat</title><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/channel.css"><script src="/assets/app.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Community Settings</div><nav class="channel-nav settings-nav"><a href="/admin/channels">Channels</a><a href="/admin/roles">Roles</a><a href="/admin/invitations">Invitations</a><a href="/admin/soundboard" aria-current="page">Soundboard</a></nav></aside><main class="content-shell"><header class="content-header"><h1>Soundboard</h1></header><section class="content soundboard-admin"><h2>Community sounds</h2><p class="page-description">Upload short sounds Members can play in Voice Rooms and Direct Calls.</p><form id="sound-upload" class="card form-row" action="/api/v1/soundboard" method="post" enctype="multipart/form-data"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label>Name<input name="name" maxlength="64" required></label><label>Emoji<input name="emoji" maxlength="8" placeholder="Optional"></label><label>Audio (MP3, WAV, Ogg; up to 1 MiB)<input name="file" type="file" accept="audio/mpeg,audio/wav,audio/ogg" required></label><button type="submit">Upload sound</button></form><form id="sound-settings" class="card form-row"><label>Maximum clip length (seconds)<input name="seconds" type="number" min="1" max="30" required></label><button type="submit">Save limit</button></form><div id="sound-list" class="soundboard-grid"><p class="muted">Loading sounds…</p></div><p id="sound-status" role="status" aria-live="polite"></p></section></main></div></body></html>`))
