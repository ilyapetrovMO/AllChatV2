// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"context"
	"database/sql"
	"encoding/base64"
	"html/template"
	"net/http"
	"strconv"
)

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
	relayURL, _ := i.mobilePushRelayURL(r.Context())
	_ = communitySettingsTemplate.Execute(w, map[string]any{"CSRF": csrfCookieValue(r), "MaxAttachmentMiB": i.community.MaxAttachmentBytes() / (1 << 20), "HomeMarkdown": home, "PushRelayURL": relayURL, "PushKeyID": i.mobilePush.keyID, "PushPublicKey": base64.RawURLEncoding.EncodeToString(i.mobilePush.publicKey)})
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

var communitySettingsTemplate = template.Must(template.New("community-settings").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Community Settings — AllChat</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Community Settings</div><nav class="channel-nav settings-nav"><a href="/admin/settings" aria-current="page">General</a><a href="/admin/channels">Channels</a><a href="/admin/roles">Roles</a><a href="/admin/invitations">Invitations</a><a href="/admin/soundboard">Soundboard</a></nav></aside><main class="content-shell"><header class="content-header"><h1>Community Settings</h1></header><section class="content"><h2 class="page-title">General</h2><form class="card" method="post" action="/admin/settings"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label>Maximum attachment size (MiB)<input name="max_attachment_mib" type="number" min="1" max="256" step="1" value="{{.MaxAttachmentMiB}}" required></label><p class="muted">Applies immediately. Your reverse proxy must allow at least the same request size.</p><label>Mobile push relay<input name="push_relay_url" type="url" value="{{.PushRelayURL}}" placeholder="https://ru.elitedarklord.com"></label><p class="muted">Used only for Android and iOS background notifications. Leave empty to disable mobile push.</p><details><summary>Relay authorization identity</summary><p class="muted">Key ID: <code>{{.PushKeyID}}</code></p><textarea readonly rows="3">{{.PushPublicKey}}</textarea></details><button>Save settings</button></form></section></main></div></body></html>`))
