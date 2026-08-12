// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"html/template"
	"net/http"
	"strconv"
	"strings"

	"allchat/internal/community"
)

const directMessageShortlistLimit = 5

func directMessageShortlist(items []community.DirectMessage) []community.DirectMessage {
	if len(items) <= directMessageShortlistLimit {
		return items
	}
	return items[:directMessageShortlistLimit]
}

func (i *Instance) directMessagesPage(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	directMessages, err := i.community.ListDirectMessages(request.Context(), member)
	if err != nil {
		http.Error(response, err.Error(), communityStatus(err))
		return
	}
	members, err := i.identity.ListMembers(request.Context())
	if err != nil {
		http.Error(response, "could not load Members", http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = directMessagesTemplate.Execute(response, map[string]any{
		"Member": member, "Members": members, "DirectMessages": directMessages, "CSRF": csrfCookieValue(request),
	})
}

func (i *Instance) directMessagesAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	items, err := i.community.ListDirectMessages(request.Context(), member)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"direct_messages": items})
}

func (i *Instance) openDirectMessageWeb(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := request.ParseForm(); err != nil {
		http.Error(response, "invalid request", http.StatusBadRequest)
		return
	}
	item, err := i.community.OpenDirectMessage(request.Context(), member, strings.TrimSpace(request.FormValue("member_id")))
	if err != nil {
		http.Error(response, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(response, request, "/channels/"+item.ID, http.StatusSeeOther)
}

func (i *Instance) setDirectMessageBlockWeb(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	item, err := i.community.DirectMessage(request.Context(), member, request.PathValue("dmID"))
	if err != nil {
		http.Error(response, err.Error(), communityStatus(err))
		return
	}
	blocked := strings.HasSuffix(request.URL.Path, "/block")
	if err := i.community.SetBlock(request.Context(), member, item.Other.ID, blocked); err != nil {
		http.Error(response, err.Error(), communityStatus(err))
		return
	}
	if blocked {
		i.media.EndCallsBetween(member.ID, item.Other.ID, "blocked")
	}
	http.Redirect(response, request, "/channels/"+item.ID, http.StatusSeeOther)
}

func (i *Instance) openDirectMessageAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input struct {
		MemberID string `json:"member_id"`
	}
	if decodeJSON(request, &input) != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	item, err := i.community.OpenDirectMessage(request.Context(), member, input.MemberID)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, item)
}

func (i *Instance) directMessageAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	item, err := i.community.DirectMessage(request.Context(), member, request.PathValue("dmID"))
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, item)
}

func (i *Instance) directMessageMessagesAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	before, _ := strconv.ParseInt(request.URL.Query().Get("before"), 10, 64)
	limit, _ := strconv.Atoi(request.URL.Query().Get("limit"))
	messages, err := i.community.ListMessages(request.Context(), member, request.PathValue("dmID"), before, limit)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, messagePage(messages, limit))
}

func (i *Instance) publishDirectMessageAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input messageInput
	if decodeJSON(request, &input) != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	message, err := i.community.PublishRichMessage(request.Context(), member, request.PathValue("dmID"), community.MessageInput{
		Body: input.Body, ReplyTo: input.ReplyTo, MentionIDs: input.MentionIDs, AttachmentIDs: input.AttachmentIDs,
	})
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, message)
}

func (i *Instance) setBlockAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := i.community.SetBlock(request.Context(), member, request.PathValue("memberID"), request.Method == http.MethodPut); err != nil {
		writeCommunityError(response, err)
		return
	}
	if request.Method == http.MethodPut {
		i.media.EndCallsBetween(member.ID, request.PathValue("memberID"), "blocked")
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) updateDirectMessageReadPositionAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input struct {
		Sequence int64 `json:"sequence"`
	}
	if decodeJSON(request, &input) != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	state, err := i.community.UpdateReadPosition(request.Context(), member, request.PathValue("dmID"), input.Sequence)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, state)
}

var directMessagesTemplate = template.Must(template.New("direct-messages").Funcs(template.FuncMap{
	"initial": func(value string) string {
		characters := []rune(value)
		if len(characters) == 0 {
			return "?"
		}
		return strings.ToUpper(string(characters[0]))
	},
}).Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Direct Messages — AllChat</title><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/channel.css"><script src="/assets/app.js" defer></script></head><body><div class="app-shell"><aside class="community-rail" aria-label="Conversations and Community"><a class="community-mark dm-rail-mark" href="/dms" aria-current="page" aria-label="Direct Messages" title="Direct Messages">✦</a><span class="rail-separator"></span><a class="community-mark" href="/" aria-label="AllChat Community" title="AllChat Community">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Direct Messages</div><nav class="channel-nav" aria-label="Direct Messages"><a class="dm-mobile-community-link" data-community-return href="/">← Community</a><form class="form-row" method="post" action="/dms"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label class="sr-only" for="dm-member">Find or start a conversation</label><select id="dm-member" name="member_id" required><option value="">Find or start a conversation</option>{{range .Members}}{{if ne .ID $.Member.ID}}<option value="{{.ID}}">{{if .DisplayName}}{{.DisplayName}} (@{{.Username}}){{else}}@{{.Username}}{{end}}</option>{{end}}{{end}}</select><button aria-label="Start Direct Message">+</button></form><h2 class="channel-category">Direct Messages</h2>{{range .DirectMessages}}<a class="dm-link" href="/channels/{{.ID}}">{{if .Other.AvatarURL}}<img src="{{.Other.AvatarURL}}" alt="">{{else}}<span class="dm-avatar-fallback">{{initial .Other.Username}}</span>{{end}}<span>{{if .Other.DisplayName}}{{.Other.DisplayName}}{{else}}{{.Other.Username}}{{end}}</span></a>{{else}}<p class="muted">No conversations yet.</p>{{end}}</nav><div class="member-panel"><a class="member-summary" href="/profile">{{if .Member.AvatarURL}}<img class="member-avatar" src="{{.Member.AvatarURL}}" alt="">{{else}}<span class="member-avatar member-avatar-fallback">{{initial .Member.Username}}</span>{{end}}<span class="member-presence online"></span><span class="member-identity"><strong>{{if .Member.DisplayName}}{{.Member.DisplayName}}{{else}}{{.Member.Username}}{{end}}</strong><small>@{{.Member.Username}}</small></span></a><a class="member-settings" href="/profile" aria-label="User Settings" title="User Settings">⚙</a></div></aside><main class="content-shell"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle aria-label="Open Direct Message navigation" aria-expanded="false">☰</button><h1>Direct Messages</h1><a class="mobile-community-return button-ghost" data-community-return href="/" aria-label="Back to Community">Community</a></header><section class="dm-home"><div><p class="eyebrow">Your conversations</p><h2 class="page-title">Direct Messages</h2><p class="page-description">Choose a conversation from the sidebar, or start one with another Member.</p><form class="card form-row" method="post" action="/dms"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label>Start a Direct Message<select name="member_id" required><option value="">Choose a Member</option>{{range .Members}}{{if ne .ID $.Member.ID}}<option value="{{.ID}}">{{if .DisplayName}}{{.DisplayName}} (@{{.Username}}){{else}}@{{.Username}}{{end}}</option>{{end}}{{end}}</select></label><button>Open DM</button></form></div></section></main></div></body></html>`))
