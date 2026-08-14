// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"bytes"
	"html/template"
	"net/http"
	"strconv"
	"strings"

	"allchat/internal/community"
	"allchat/internal/identity"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
)

var communityMarkdown = goldmark.New(goldmark.WithExtensions(extension.GFM))

func (i *Instance) channelsAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	includeArchived := request.URL.Query().Get("include_archived") == "true"
	overview, err := i.community.ChannelOverview(request.Context(), member, includeArchived)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, overview)
}

func (i *Instance) createCategoryAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input community.CategoryInput
	if decodeJSON(request, &input) != nil {
		writeJSON(response, 400, map[string]string{"error": "invalid request"})
		return
	}
	item, err := i.community.CreateCategory(request.Context(), member, input)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, item)
}
func (i *Instance) updateCategoryAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input community.CategoryInput
	if decodeJSON(request, &input) != nil {
		writeJSON(response, 400, map[string]string{"error": "invalid request"})
		return
	}
	item, err := i.community.UpdateCategory(request.Context(), member, request.PathValue("categoryID"), input)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, 200, item)
}
func (i *Instance) archiveCategoryAPI(w http.ResponseWriter, r *http.Request) {
	i.setCategoryArchiveAPI(w, r, true)
}
func (i *Instance) restoreCategoryAPI(w http.ResponseWriter, r *http.Request) {
	i.setCategoryArchiveAPI(w, r, false)
}
func (i *Instance) setCategoryArchiveAPI(w http.ResponseWriter, r *http.Request, archived bool) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if err := i.community.SetCategoryArchived(r.Context(), m, r.PathValue("categoryID"), archived); err != nil {
		writeCommunityError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (i *Instance) createChannelAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input community.ChannelInput
	if decodeJSON(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	item, err := i.community.CreateChannel(r.Context(), m, input)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 201, item)
}
func (i *Instance) updateChannelAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input community.ChannelInput
	if decodeJSON(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	item, err := i.community.UpdateChannel(r.Context(), m, r.PathValue("channelID"), input)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 200, item)
}
func (i *Instance) archiveChannelAPI(w http.ResponseWriter, r *http.Request) {
	i.setChannelArchiveAPI(w, r, true)
}
func (i *Instance) restoreChannelAPI(w http.ResponseWriter, r *http.Request) {
	i.setChannelArchiveAPI(w, r, false)
}
func (i *Instance) setChannelArchiveAPI(w http.ResponseWriter, r *http.Request, archived bool) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if err := i.community.SetChannelArchived(r.Context(), m, r.PathValue("channelID"), archived); err != nil {
		writeCommunityError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (i *Instance) channelOverrideAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input community.OverrideInput
	if decodeJSON(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	if err := i.community.SetChannelOverride(r.Context(), m, r.PathValue("channelID"), input); err != nil {
		writeCommunityError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (i *Instance) prepareChannelDeletionAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	token, err := i.community.PrepareChannelDeletion(r.Context(), m, r.PathValue("channelID"))
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 201, map[string]string{"confirmation_token": token})
}
func (i *Instance) deleteChannelAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input struct {
		Token string `json:"confirmation_token"`
	}
	if decodeJSON(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	if err := i.community.DeleteChannel(r.Context(), m, r.PathValue("channelID"), input.Token); err != nil {
		writeCommunityError(w, err)
		return
	}
	w.WriteHeader(204)
}

func (i *Instance) renderHome(w http.ResponseWriter, r *http.Request, member identity.Member) {
	overview, err := i.community.ChannelOverview(r.Context(), member, false)
	if err != nil {
		http.Error(w, "channels unavailable", 500)
		return
	}
	directMessages, _ := i.community.ListDirectMessages(r.Context(), member)
	directMessages = directMessageShortlist(directMessages)
	members, _ := i.identity.ListMembers(r.Context())
	homeMarkdown, _ := i.community.CommunityHomeMarkdown(r.Context())
	var rendered bytes.Buffer
	_ = communityMarkdown.Convert([]byte(homeMarkdown), &rendered)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	var page bytes.Buffer
	_ = homeTemplate.Execute(&page, map[string]any{"Member": member, "Members": members, "Overview": overview, "DirectMessages": directMessages, "CSRF": csrfCookieValue(r)})
	body := strings.Replace(page.String(), `<h1>Home</h1>`, `<h1>Community Guide</h1>`, 1)
	if rendered.Len() > 0 {
		start := `<p class="eyebrow">AllChat Community</p>`
		end := `<form class="card form-row"`
		if left, right := strings.Index(body, start), strings.Index(body, end); left >= 0 && right > left {
			body = body[:left] + `<article class="community-markdown">` + rendered.String() + `</article>` + body[right:]
		}
	}
	body = removeHomeBlock(body, `<form class="card form-row" method="post" action="/dms">`, `</form>`)
	body = removeHomeBlock(body, `<div class="card"><h3>Instance status</h3>`, `</div>`)
	_, _ = w.Write([]byte(body))
}

func removeHomeBlock(body, start, end string) string {
	left := strings.Index(body, start)
	if left < 0 {
		return body
	}
	right := strings.Index(body[left:], end)
	if right < 0 {
		return body
	}
	return body[:left] + body[left+right+len(end):]
}
func (i *Instance) channelsAdminPage(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	overview, err := i.community.ChannelOverview(r.Context(), m, true)
	if err != nil {
		http.Error(w, err.Error(), communityStatus(err))
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = channelAdminTemplate.Execute(w, map[string]any{"Overview": overview, "CSRF": csrfCookieValue(r)})
}
func (i *Instance) createCategoryWeb(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	_ = r.ParseForm()
	position, _ := strconv.Atoi(r.FormValue("position"))
	if _, err := i.community.CreateCategory(r.Context(), m, community.CategoryInput{Name: r.FormValue("name"), Position: position}); err != nil {
		http.Error(w, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(w, r, "/admin/channels", 303)
}
func (i *Instance) createChannelWeb(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	_ = r.ParseForm()
	position, _ := strconv.Atoi(r.FormValue("position"))
	if _, err := i.community.CreateChannel(r.Context(), m, community.ChannelInput{CategoryID: r.FormValue("category_id"), Name: r.FormValue("name"), Type: r.FormValue("type"), Position: position}); err != nil {
		http.Error(w, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(w, r, "/admin/channels", 303)
}
func (i *Instance) archiveChannelWeb(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if err := i.community.SetChannelArchived(r.Context(), m, r.PathValue("channelID"), true); err != nil {
		http.Error(w, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(w, r, "/admin/channels", 303)
}

var homeTemplate = template.Must(template.New("home").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AllChat</title><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/channel.css"><script src="/assets/htmx.min.js" defer></script><script src="/assets/app.js" defer></script></head><body data-member-id="{{.Member.ID}}"><div class="app-shell"><aside class="community-rail" aria-label="Conversations and Community"><a class="community-mark dm-rail-mark" href="/dms" aria-label="Direct Messages" title="Direct Messages">✦</a><span class="rail-separator"></span><a class="community-mark" href="/" aria-current="page" aria-label="AllChat Community" title="AllChat Community">AC</a></aside><aside class="channel-sidebar"><div class="community-switcher"><button class="community-header" type="button" data-community-menu-toggle aria-haspopup="menu" aria-expanded="false"><span>AllChat Community</span><span aria-hidden="true">⌄</span></button><nav class="community-menu" data-community-menu role="menu" hidden><a role="menuitem" href="/">Community Home</a><a role="menuitem" href="/dms">Direct Messages</a>{{if .Member.Owner}}<a role="menuitem" href="/admin/channels">Community Settings</a><a role="menuitem" href="/admin/channels">Channels</a><a role="menuitem" href="/admin/invitations">Invitations</a><a role="menuitem" href="/admin/roles">Roles</a>{{end}}</nav></div><nav class="channel-nav" aria-label="Community conversations">{{if .DirectMessages}}<h2 class="channel-category">Direct Messages</h2>{{range .DirectMessages}}<a class="dm-link" href="/channels/{{.ID}}"><span class="dm-avatar-fallback">@</span><span>{{if .Other.DisplayName}}{{.Other.DisplayName}}{{else}}{{.Other.Username}}{{end}}</span></a>{{end}}{{end}}{{range .Overview.Categories}}<h2 class="channel-category">{{.Name}}</h2>{{end}}{{range .Overview.Channels}}<a class="channel-link" href="/channels/{{.ID}}">{{.Name}}</a>{{else}}<p class="muted">No channels yet.</p>{{end}}</nav><div class="member-panel"><div class="member-menu" id="member-menu" role="menu" hidden><div class="member-menu-identity"><strong>{{if .Member.DisplayName}}{{.Member.DisplayName}}{{else}}{{.Member.Username}}{{end}}</strong><span>@{{.Member.Username}}</span></div><div class="member-menu-group" aria-label="Presence status"><button type="button" role="menuitem" data-presence-mode="available"><span class="presence-choice online"></span>Online</button><button type="button" role="menuitem" data-presence-mode="dnd"><span class="presence-choice dnd"></span>Do Not Disturb</button></div><div class="member-menu-group"><form method="post" action="/logout"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><button type="submit" role="menuitem">Switch Account</button></form><button type="button" role="menuitem" id="copy-member-id" data-member-id="{{.Member.ID}}">Copy Member ID</button></div><p class="member-menu-status" id="member-menu-status" aria-live="polite"></p></div><button class="member-summary" id="member-menu-toggle" type="button" aria-label="Open Member menu" aria-haspopup="menu" aria-expanded="false">{{if .Member.AvatarURL}}<img class="member-avatar" src="{{.Member.AvatarURL}}" alt="">{{else}}<span class="member-avatar member-avatar-fallback" aria-hidden="true">?</span>{{end}}<span class="member-presence online" id="member-presence"></span><span class="member-identity"><strong>{{if .Member.DisplayName}}{{.Member.DisplayName}}{{else}}{{.Member.Username}}{{end}}</strong><small>@{{.Member.Username}}</small></span></button><a class="member-settings" href="/profile" aria-label="User Settings" title="User Settings">⚙</a></div></aside><main class="content-shell"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle aria-label="Open conversation navigation" aria-expanded="false">☰</button><h1>Home</h1><div class="header-actions"><a class="button-ghost" href="/search" aria-label="Search Messages">Search</a></div></header><section class="content"><p class="eyebrow">AllChat Community</p><h2 class="page-title">Welcome, {{if .Member.DisplayName}}{{.Member.DisplayName}}{{else}}{{.Member.Username}}{{end}}</h2><p class="page-description">Select a Text Channel or Direct Message from the sidebar to start chatting.</p><form class="card form-row" method="post" action="/dms"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label>Start a Direct Message<select name="member_id" required><option value="">Choose a Member</option>{{range .Members}}{{if ne .ID $.Member.ID}}<option value="{{.ID}}">{{if .DisplayName}}{{.DisplayName}} (@{{.Username}}){{else}}@{{.Username}}{{end}}</option>{{end}}{{end}}</select></label><button>Open DM</button></form><div class="card"><h3>Instance status</h3><p class="muted">Check that SQLite and the application are ready.</p><button type="button" hx-get="/api/v1/health" hx-target="#health">Check health</button><pre id="health" aria-live="polite"></pre></div></section></main></div></body></html>`))
var channelAdminTemplate = template.Must(template.New("channels-admin").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manage channels — AllChat</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/" aria-label="AllChat home">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Community Settings</div><nav class="channel-nav settings-nav"><a href="/admin/channels" aria-current="page">Channels</a><a href="/admin/roles">Roles</a><a href="/admin/invitations">Invitations</a><a href="/profile">My Account</a></nav></aside><main class="content-shell"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle aria-label="Open settings navigation" aria-expanded="false">☰</button><h1>Channels</h1></header><section class="content"><h2 class="page-title">Channel management</h2><p class="page-description">Organize how your community discovers text and voice spaces.</p><div class="card"><h3>Categories</h3><ul class="list">{{range .Overview.Categories}}<li class="list-item"><span class="list-item-main"><strong>{{.Name}}</strong> <span class="faint">Position {{.Position}}</span></span>{{if .Archived}}<span class="badge">Archived</span>{{end}}</li>{{else}}<li class="muted">No categories yet.</li>{{end}}</ul><form class="form-row" method="post" action="/admin/categories"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label>Name<input name="name" placeholder="General" required></label><label>Position<input type="number" name="position" value="0" min="0"></label><button>Create category</button></form></div><div class="card"><h3>Channels</h3><ul class="list">{{range .Overview.Channels}}<li class="list-item"><span class="list-item-main"><strong># {{.Name}}</strong> <span class="badge">{{.Type}}</span></span>{{if .Archived}}<span class="badge">Archived</span>{{else}}<form method="post" action="/admin/channels/{{.ID}}/archive"><input type="hidden" name="csrf_token" value="{{$.CSRF}}"><button class="button-ghost" data-confirm="Archive this channel?">Archive</button></form>{{end}}</li>{{else}}<li class="muted">No channels yet.</li>{{end}}</ul><form class="form-row" method="post" action="/admin/channels"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label>Category<select name="category_id">{{range .Overview.Categories}}<option value="{{.ID}}">{{.Name}}</option>{{end}}</select></label><label>Name<input name="name" placeholder="general" required></label><label>Type<select name="type"><option value="text">Text</option><option value="voice">Voice</option></select></label><label>Position<input type="number" name="position" value="0" min="0"></label><button>Create channel</button></form></div></section></main></div></body></html>`))
