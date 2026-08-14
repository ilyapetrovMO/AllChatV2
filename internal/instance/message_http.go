// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"html/template"
	"net/http"
	"strconv"
	"strings"

	"allchat/internal/community"
)

type messageInput struct {
	Body          string   `json:"body"`
	ReplyTo       string   `json:"reply_to,omitempty"`
	MentionIDs    []string `json:"mention_ids,omitempty"`
	AttachmentIDs []string `json:"attachment_ids,omitempty"`
	ClientID      string   `json:"client_id,omitempty"`
}

func (i *Instance) messagesAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if before > 0 && after > 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "choose either before or after"})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	var messages []community.Message
	var err error
	if after > 0 {
		messages, err = i.community.ListMessagesAfter(r.Context(), m, r.PathValue("channelID"), after, limit)
	} else {
		messages, err = i.community.ListMessages(r.Context(), m, r.PathValue("channelID"), before, limit)
	}
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	if after > 0 {
		writeJSON(w, 200, forwardMessagePage(messages, limit))
		return
	}
	writeJSON(w, 200, messagePage(messages, limit))
}

func forwardMessagePage(messages []community.Message, requestedLimit int) map[string]any {
	limit := requestedLimit
	if limit < 1 || limit > 100 {
		limit = 50
	}
	hasMore, nextAfter := len(messages) == limit && len(messages) > 0, int64(0)
	if hasMore {
		nextAfter = messages[len(messages)-1].Sequence
	}
	return map[string]any{"messages": messages, "has_more": hasMore, "next_after": nextAfter}
}

func messagePage(messages []community.Message, requestedLimit int) map[string]any {
	limit := requestedLimit
	if limit < 1 || limit > 100 {
		limit = 50
	}
	hasMore := len(messages) == limit && len(messages) > 0 && messages[0].Sequence > 1
	nextBefore := int64(0)
	if hasMore {
		nextBefore = messages[0].Sequence
	}
	return map[string]any{"messages": messages, "has_more": hasMore, "next_before": nextBefore}
}
func (i *Instance) publishMessageAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input messageInput
	if decodeJSON(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	message, err := i.community.PublishRichMessage(r.Context(), m, r.PathValue("channelID"), community.MessageInput{
		Body: input.Body, ReplyTo: input.ReplyTo, MentionIDs: input.MentionIDs, AttachmentIDs: input.AttachmentIDs, ClientID: input.ClientID,
	})
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 201, message)
}

func (i *Instance) reactionAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input struct {
		Emoji string `json:"emoji"`
	}
	if decodeJSON(r, &input) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if err := i.community.SetReaction(r.Context(), m, r.PathValue("messageID"), input.Emoji, r.Method == http.MethodPut); err != nil {
		writeCommunityError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (i *Instance) pinMessageAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if err := i.community.SetPinned(r.Context(), m, r.PathValue("messageID"), r.Method == http.MethodPut); err != nil {
		writeCommunityError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (i *Instance) pinnedMessagesAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	messages, err := i.community.PinnedMessages(r.Context(), m, r.PathValue("channelID"))
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
}
func (i *Instance) editMessageAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input messageInput
	if decodeJSON(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	message, err := i.community.EditMessage(r.Context(), m, r.PathValue("messageID"), input.Body)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 200, message)
}
func (i *Instance) deleteMessageAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if err := i.community.DeleteMessage(r.Context(), m, r.PathValue("messageID")); err != nil {
		writeCommunityError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (i *Instance) channelPage(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	overview, _ := i.community.ChannelOverview(r.Context(), m, false)
	for _, candidate := range overview.Channels {
		if candidate.ID == r.PathValue("channelID") && candidate.Type == "voice" {
			i.renderVoiceRoom(w, r, m, candidate, overview)
			return
		}
	}
	messages, err := i.community.ListMessages(r.Context(), m, r.PathValue("channelID"), 0, 50)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	directMessages, _ := i.community.ListDirectMessages(r.Context(), m)
	directMessages = directMessageShortlist(directMessages)
	members, _ := i.identity.ListMembers(r.Context())
	presence, _ := i.authorizedEphemeralState(r.Context(), m)
	var channel community.Channel
	var directMessage *community.DirectMessage
	for _, candidate := range overview.Channels {
		if candidate.ID == r.PathValue("channelID") {
			channel = candidate
		}
	}
	if channel.ID == "" {
		item, directErr := i.community.DirectMessage(r.Context(), m, r.PathValue("channelID"))
		if directErr != nil {
			http.NotFound(w, r)
			return
		}
		directMessage = &item
		name := item.Other.DisplayName
		if name == "" {
			name = item.Other.Username
		}
		channel = community.Channel{ID: item.ID, Name: name, Type: "text"}
	}
	var lastSequence int64
	if len(messages) > 0 {
		lastSequence = messages[len(messages)-1].Sequence
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	firstSequence := int64(0)
	if len(messages) > 0 {
		firstSequence = messages[0].Sequence
	}
	_ = channelTemplate.Execute(w, map[string]any{"Channel": channel, "Messages": messages, "Member": m, "Members": members, "Presence": presence, "Overview": overview, "DirectMessages": directMessages, "DirectMessage": directMessage, "Direct": directMessage != nil, "CSRF": csrfCookieValue(r), "LastSequence": lastSequence, "FirstSequence": firstSequence, "MaxAttachmentBytes": i.community.MaxAttachmentBytes()})
}
func (i *Instance) publishMessageWeb(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	_ = r.ParseForm()
	if _, err := i.community.PublishRichMessage(r.Context(), m, r.PathValue("channelID"), community.MessageInput{Body: r.FormValue("body"), AttachmentIDs: r.Form["attachment_id"]}); err != nil {
		http.Error(w, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(w, r, "/channels/"+r.PathValue("channelID"), 303)
}
func (i *Instance) editMessageWeb(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	_ = r.ParseForm()
	message, err := i.community.EditMessage(r.Context(), m, r.PathValue("messageID"), r.FormValue("body"))
	if err != nil {
		http.Error(w, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(w, r, "/channels/"+message.ChannelID, 303)
}
func (i *Instance) deleteMessageWeb(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	_ = r.ParseForm()
	channelID := r.FormValue("channel_id")
	if err := i.community.DeleteMessage(r.Context(), m, r.PathValue("messageID")); err != nil {
		http.Error(w, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(w, r, "/channels/"+channelID, 303)
}

var channelTemplate = template.Must(template.New("channel").Funcs(template.FuncMap{
	"safeHTML": func(value string) template.HTML { return template.HTML(value) },
	"isImage":  func(contentType string) bool { return strings.HasPrefix(contentType, "image/") },
	"isVideo":  func(contentType string) bool { return strings.HasPrefix(contentType, "video/") },
	"isAudio":  func(contentType string) bool { return strings.HasPrefix(contentType, "audio/") },
	"initial": func(value string) string {
		characters := []rune(value)
		if len(characters) == 0 {
			return "?"
		}
		return strings.ToUpper(string(characters[0]))
	},
}).Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title># {{.Channel.Name}} — AllChat</title><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/channel.css"><script src="/assets/app.js" defer></script><script src="/assets/channel-scroll.js"></script>
</head><body data-channel-id="{{.Channel.ID}}" data-member-id="{{.Member.ID}}" data-last-sequence="{{.LastSequence}}"><div class="app-shell"><aside class="community-rail" aria-label="Conversations and Community"><a class="community-mark dm-rail-mark" href="/dms" aria-label="Direct Messages" title="Direct Messages">✦</a><span class="rail-separator"></span><a class="community-mark" href="/" aria-label="AllChat Community" title="AllChat Community">AC</a></aside><aside class="channel-sidebar"><div class="community-switcher"><button class="community-header" type="button" data-community-menu-toggle aria-haspopup="menu" aria-expanded="false"><span>AllChat Community</span><span aria-hidden="true">⌄</span></button><nav class="community-menu" data-community-menu role="menu" hidden><a role="menuitem" href="/">Community Home</a><a role="menuitem" href="/dms">Direct Messages</a>{{if .Member.Owner}}<a role="menuitem" href="/admin/channels">Community Settings</a><a role="menuitem" href="/admin/invitations">Invite Members</a><a role="menuitem" href="/admin/channels">Create Channel</a>{{end}}<a role="menuitem" href="/profile">Edit Community Profile</a></nav></div><nav class="channel-nav" aria-label="Community conversations">{{if .DirectMessages}}<h2 class="channel-category">Direct Messages</h2>{{range .DirectMessages}}<a class="dm-link" href="/channels/{{.ID}}" {{if eq .ID $.Channel.ID}}aria-current="page"{{end}}>{{if .Other.AvatarURL}}<img src="{{.Other.AvatarURL}}" alt="">{{else}}<span class="dm-avatar-fallback">{{initial .Other.Username}}</span>{{end}}<span>{{if .Other.DisplayName}}{{.Other.DisplayName}}{{else}}{{.Other.Username}}{{end}}</span></a>{{end}}{{end}}{{range .Overview.Categories}}<h2 class="channel-category">{{.Name}}</h2>{{end}}{{range .Overview.Channels}}<a class="channel-link" href="/channels/{{.ID}}" {{if eq .ID $.Channel.ID}}aria-current="page"{{end}}>{{.Name}}</a>{{end}}</nav><div class="member-panel"><div class="member-menu" id="member-menu" role="menu" hidden><div class="member-menu-identity"><strong>{{if .Member.DisplayName}}{{.Member.DisplayName}}{{else}}{{.Member.Username}}{{end}}</strong><span>@{{.Member.Username}}</span></div><div class="member-menu-group" aria-label="Presence status"><button type="button" role="menuitem" data-presence-mode="available"><span class="presence-choice online"></span>Online</button><button type="button" role="menuitem" data-presence-mode="dnd"><span class="presence-choice dnd"></span>Do Not Disturb</button></div><div class="member-menu-group"><form method="post" action="/logout"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><button type="submit" role="menuitem">Switch Account</button></form><button type="button" role="menuitem" id="copy-member-id" data-member-id="{{.Member.ID}}">Copy Member ID</button></div><p class="member-menu-status" id="member-menu-status" aria-live="polite"></p></div><button class="member-summary" id="member-menu-toggle" type="button" aria-label="Open Member menu" aria-haspopup="menu" aria-expanded="false">{{if .Member.AvatarURL}}<img class="member-avatar" src="{{.Member.AvatarURL}}" alt="">{{else}}<span class="member-avatar member-avatar-fallback" aria-hidden="true">{{initial .Member.Username}}</span>{{end}}<span class="member-presence online" id="member-presence"></span><span class="member-identity"><strong>{{if .Member.DisplayName}}{{.Member.DisplayName}}{{else}}{{.Member.Username}}{{end}}</strong><small>@{{.Member.Username}}</small></span></button><a class="member-settings" href="/profile" aria-label="User Settings" title="User Settings">⚙</a></div></aside>
<main class="content-shell channel-content"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle aria-label="Open conversation navigation" aria-expanded="false">☰</button><span class="hash">{{if .Direct}}@{{else}}#{{end}}</span><h1>{{.Channel.Name}}</h1><span class="muted channel-topic">{{if .Direct}}Direct Message{{else}}Community Text Channel{{end}}</span><div class="header-actions">{{if .Direct}}{{if .DirectMessage.BlockedByMe}}<form method="post" action="/dms/{{.DirectMessage.ID}}/unblock"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><button class="button-ghost">Unblock</button></form>{{else}}<form method="post" action="/dms/{{.DirectMessage.ID}}/block"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><button class="button-ghost" data-confirm="Block this Member? Existing history remains visible.">Block</button></form>{{end}}{{end}}<button class="notification-bell button-ghost" id="notifications" type="button" aria-label="Notifications">🔔</button><form class="header-search" id="header-search" role="search"><label class="sr-only" for="channel-search">Search Messages</label><input id="channel-search" name="q" type="search" maxlength="200" placeholder="Search" autocomplete="off"></form></div></header><div class="conversation-layout"><section class="messages" id="messages" aria-live="polite">
{{range .Messages}}<article class="message" id="message-{{.ID}}">{{if .AuthorAvatarURL}}<img class="message-avatar" src="{{.AuthorAvatarURL}}" alt="">{{else}}<span class="message-avatar message-avatar-fallback" aria-hidden="true">{{initial .AuthorName}}</span>{{end}}<strong>{{.AuthorName}}</strong> {{if .Deleted}}<em class="muted">Message deleted</em>{{else}}{{if .Reply}}<small>Reply to {{.Reply.AuthorName}}: {{if .Reply.Deleted}}deleted message{{else}}{{.Reply.Body}}{{end}}</small>{{end}}<span class="body">{{safeHTML .RenderedHTML}}</span>{{range .Mentions}} <mark>@{{.Username}}</mark>{{end}}{{range .Attachments}}{{if isImage .ContentType}}<button class="message-image-button" type="button" data-original-src="{{.URL}}" aria-label="Open {{.Name}}"><img class="message-image" src="{{.PreviewURL}}" alt="{{.Name}}" loading="lazy"></button>{{else if isVideo .ContentType}}<video class="message-video" controls preload="metadata"><source src="{{.URL}}" type="{{.ContentType}}"><a href="{{.URL}}">Download {{.Name}}</a></video>{{else if isAudio .ContentType}}<audio class="message-audio" controls preload="metadata"><source src="{{.URL}}" type="{{.ContentType}}"><a href="{{.URL}}">Download {{.Name}}</a></audio>{{else}}<a class="message-attachment" href="{{.URL}}">📎 {{.Name}}</a>{{end}}{{end}}{{range .Reactions}} <button class="button-ghost" type="button">{{.Emoji}} {{.Count}}</button>{{end}}{{if .Pinned}} <span class="badge">Pinned</span>{{end}}{{end}}<time class="message-time" datetime="{{.CreatedAt}}" data-created-at="{{.CreatedAt}}"></time>{{if .EditedAt}} <small class="edited">edited</small>{{end}}{{if eq .AuthorID $.Member.ID}}<div class="message-actions" aria-label="Message actions"><button class="message-action" type="button" data-edit-message data-message-id="{{.ID}}" data-message-body="{{.Body}}" aria-label="Edit Message">Edit</button><form method="post" action="/messages/{{.ID}}/delete"><input type="hidden" name="csrf_token" value="{{$.CSRF}}"><input type="hidden" name="channel_id" value="{{$.Channel.ID}}"><button class="message-action danger-text" data-confirm="Delete this Message permanently?" aria-label="Delete Message">Delete</button></form></div>{{end}}</article>{{else}}<div class="content"><h2>Welcome to #{{$.Channel.Name}}</h2><p class="muted">This is the beginning of this Text Channel.</p></div>{{end}}
</section><aside class="search-pane" id="search-pane" aria-label="Search results" hidden><header><strong>Search Results</strong><button class="button-ghost" id="close-search" type="button" aria-label="Close search results">×</button></header><div id="search-results" aria-live="polite"></div></aside><aside class="participant-sidebar" aria-label="Conversation participants">{{if .Direct}}<div class="dm-profile-card">{{if .DirectMessage.Other.AvatarURL}}<img src="{{.DirectMessage.Other.AvatarURL}}" alt="">{{else}}<span class="profile-avatar-fallback">{{initial .DirectMessage.Other.Username}}</span>{{end}}<h2>{{if .DirectMessage.Other.DisplayName}}{{.DirectMessage.Other.DisplayName}}{{else}}{{.DirectMessage.Other.Username}}{{end}}</h2><p>@{{.DirectMessage.Other.Username}}</p><span class="badge">Direct Message</span></div>{{else}}<h2 class="participant-heading">Members — {{len .Members}}</h2><ul class="participant-list">{{range .Members}}{{$state := index $.Presence .ID}}<li data-participant-id="{{.ID}}"><span class="participant-avatar-wrap">{{if .AvatarURL}}<img src="{{.AvatarURL}}" alt="">{{else}}<span class="participant-avatar-fallback">{{initial .Username}}</span>{{end}}<span class="participant-presence {{if eq $state "online"}}online{{else if eq $state "dnd"}}dnd{{else}}offline{{end}}"></span></span><span>{{if .DisplayName}}{{.DisplayName}}{{else}}{{.Username}}{{end}}{{if .Owner}} <small>Owner</small>{{end}}</span></li>{{end}}</ul>{{end}}</aside></div><div class="composer-wrap"><button class="jump-to-present" id="jump-to-present" type="button" hidden>Jump to present <span aria-hidden="true">↓</span></button>{{if .Direct}}{{if or .DirectMessage.BlockedByMe .DirectMessage.BlockedMe}}<p class="blocked-conversation" role="status">You cannot send new Messages in this Direct Message while either Member has blocked the other.</p>{{end}}{{end}}<div class="editing-banner" id="editing-banner" hidden><span>Editing Message</span><button class="button-ghost" id="cancel-edit" type="button">Cancel</button></div><div class="attachment-preview-list" id="attachment-previews" aria-label="Selected attachments" hidden></div><form class="composer" id="composer" method="post" action="/channels/{{.Channel.ID}}/messages" data-publish-action="/channels/{{.Channel.ID}}/messages"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label class="sr-only" for="message-body">Message {{if .Direct}}@{{else}}#{{end}}{{.Channel.Name}}</label><input id="message-body" name="body" maxlength="4000" placeholder="Message {{if .Direct}}@{{else}}#{{end}}{{.Channel.Name}}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" {{if .Direct}}{{if or .DirectMessage.BlockedByMe .DirectMessage.BlockedMe}}disabled{{end}}{{end}} required autofocus><label class="sr-only" for="attachment">Add Attachment</label><input id="attachment" type="file" multiple {{if .Direct}}{{if or .DirectMessage.BlockedByMe .DirectMessage.BlockedMe}}disabled{{end}}{{end}}><button id="composer-submit" aria-label="Send Message" {{if .Direct}}{{if or .DirectMessage.BlockedMe .DirectMessage.BlockedByMe}}disabled{{end}}{{end}}>Send</button></form><p class="typing" id="typing" aria-live="polite"></p></div></main></div>
<script>
(()=>{const channel=document.body.dataset.channelId,member=document.body.dataset.memberId,key="allchat.realtime.cursor:"+channel,messages=document.getElementById("messages");
let cursor=Number(localStorage.getItem(key)||0),retry=250,disposed=false,activeSocket=null;
const conversationFollower=createConversationFollower(messages,document.getElementById("jump-to-present"),120),scrollToLatest=conversationFollower.scrollToLatest;
conversationFollower.setFollowing(!location.hash);
if(conversationFollower.isFollowing()){requestAnimationFrame(scrollToLatest);setTimeout(scrollToLatest,100)}
function attachmentElement(attachment){const contentType=attachment.content_type||"";if(contentType.startsWith("image/")){const button=document.createElement("button"),image=document.createElement("img");button.type="button";button.className="message-image-button";button.dataset.originalSrc=attachment.url;button.setAttribute("aria-label","Open "+attachment.name);image.className="message-image";image.src=attachment.preview_url||attachment.url+"/preview";image.alt=attachment.name;image.loading="lazy";button.append(image);return button}if(contentType.startsWith("video/")||contentType.startsWith("audio/")){const media=document.createElement(contentType.startsWith("video/")?"video":"audio"),source=document.createElement("source"),fallback=document.createElement("a");media.className=contentType.startsWith("video/")?"message-video":"message-audio";media.controls=true;media.preload="metadata";source.src=attachment.url;source.type=contentType;fallback.href=attachment.url;fallback.textContent="Download "+attachment.name;media.append(source,fallback);return media}const link=document.createElement("a");link.className="message-attachment";link.href=attachment.url;link.append(window.allchatIcon("paperclip"),document.createTextNode(attachment.name));return link}
function formatTimestamp(value){const date=new Date(value),now=new Date(),same=date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth()&&date.getDate()===now.getDate();return same?date.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):date.toLocaleString([],{dateStyle:"medium",timeStyle:"short"})}
function hydrateTimestamp(item,message){item.dataset.sequence=message.sequence;let stamp=item.querySelector(".message-time");if(!stamp){stamp=document.createElement("time");stamp.className="message-time"}const author=item.querySelector(":scope > strong");if(author)author.after(stamp);else item.prepend(stamp);stamp.dateTime=message.created_at;stamp.dataset.createdAt=message.created_at;stamp.textContent=formatTimestamp(message.created_at)}
function firstPreviewURL(body){const match=(body||"").match(/https?:\/\/[^\s<>]+/i);if(!match)return "";const raw=match[0].replace(/[),.!?;:'\"]+$/,"");try{const parsed=new URL(raw);return parsed.protocol==="http:"||parsed.protocol==="https:"?parsed.href:""}catch{return ""}}
function previewElement(preview){const card=document.createElement("a"),content=document.createElement("span"),site=document.createElement("small"),title=document.createElement("strong"),description=document.createElement("span");card.className="link-preview-card";card.dataset.linkPreview="";card.href=preview.url;card.target="_blank";card.rel="noopener noreferrer nofollow";content.className="link-preview-content";site.className="link-preview-site";site.textContent=preview.site_name||new URL(preview.url).hostname;title.className="link-preview-title";title.textContent=preview.title||preview.url;description.className="link-preview-description";description.textContent=preview.description||"";content.append(site,title);if(preview.description)content.append(description);card.append(content);if(preview.image_url){const image=document.createElement("img");image.className="link-preview-image";image.src="/api/v1/link-preview/image?url="+encodeURIComponent(preview.image_url);image.alt="";image.loading="lazy";card.append(image)}return card}
async function hydrateLinkPreview(item,body){const target=firstPreviewURL(body),existing=item.querySelector("[data-link-preview]");if(!target){existing?.remove();delete item.dataset.previewURL;return}if(item.dataset.previewURL===target)return;existing?.remove();item.dataset.previewURL=target;try{const response=await fetch("/api/v1/link-preview?url="+encodeURIComponent(target));if(!response.ok||item.dataset.previewURL!==target)return;const preview=await response.json(),card=previewElement(preview),actions=item.querySelector(".message-actions");item.insertBefore(card,actions)}catch{}}
function render(message,type){if(message.channel_id!==channel)return;let item=document.getElementById("message-"+message.id);if(!item&&message.client_id){item=messages.querySelector('[data-client-id="'+CSS.escape(message.client_id)+'"]');if(item){item.id="message-"+message.id;item.classList.remove("optimistic");item.removeAttribute("aria-busy")}}
if(type==="message.created"&&!item){item=document.createElement("article");item.className="message";item.id="message-"+message.id;const avatar=document.createElement(message.author_avatar_url?"img":"span");avatar.className="message-avatar"+(message.author_avatar_url?"":" message-avatar-fallback");if(message.author_avatar_url){avatar.src=message.author_avatar_url;avatar.alt=""}else{avatar.textContent=Array.from(message.author_name||"?")[0].toUpperCase();avatar.setAttribute("aria-hidden","true")}const author=document.createElement("strong"),body=document.createElement("span");author.textContent=message.author_name;body.className="body";item.append(avatar,author," ",body);(message.attachments||[]).forEach(attachment=>item.append(attachmentElement(attachment)));if(message.author_id===member){const actions=document.createElement("div"),edit=document.createElement("button");actions.className="message-actions";actions.setAttribute("aria-label","Message actions");edit.className="message-action";edit.type="button";edit.dataset.editMessage="";edit.dataset.messageId=message.id;edit.dataset.messageBody=message.body;edit.setAttribute("aria-label","Edit Message");edit.textContent="Edit";actions.append(edit);item.append(actions)}const bottom=messages.querySelector('[data-virtual-spacer="newer"]');bottom?bottom.before(item):messages.append(item)}
if(!item)return;if(type==="message.deleted"){item.replaceChildren();const deleted=document.createElement("em");deleted.textContent="Message deleted";item.append(deleted);return}
let replyPreview=item.querySelector(".reply-preview");if(message.reply){if(!replyPreview){replyPreview=document.createElement("small");replyPreview.className="reply-preview";item.insertBefore(replyPreview,item.querySelector(".body"))}replyPreview.textContent="Reply to "+message.reply.author_name+": "+(message.reply.deleted?"deleted message":message.reply.body)}else replyPreview?.remove();
const body=item.querySelector(".body");if(body){if(message.rendered_html)body.innerHTML=message.rendered_html;else body.textContent=message.body}hydrateTimestamp(item,message);const editAction=item.querySelector("[data-edit-message]");if(editAction)editAction.dataset.messageBody=message.body;if(type==="message.edited"&&!item.querySelector(".edited")){const edited=document.createElement("small");edited.className="edited";edited.textContent=" edited";item.append(edited)}hydrateLinkPreview(item,message.body);if(conversationFollower.isFollowing()||conversationFollower.nearBottom())requestAnimationFrame(()=>requestAnimationFrame(scrollToLatest))}
window.renderAllChatMessage=render;document.querySelectorAll("#messages > .message").forEach(item=>{hydrateLinkPreview(item,item.querySelector(".body")?.textContent||"");const stamp=item.querySelector(".message-time"),author=item.querySelector(":scope > strong");if(stamp){if(author)author.after(stamp);stamp.textContent=formatTimestamp(stamp.dataset.createdAt)}});
const conversationWindowLimit=300;let historyBefore={{.FirstSequence}},loadingHistory=false,historyExhausted=historyBefore<=1,newerTruncated=false;
function trimHistory(edge="older"){const items=[...messages.querySelectorAll(":scope > .message")],remove=items.length-conversationWindowLimit;if(remove<=0){messages.dataset.windowSize=String(items.length);return}if(edge==="newer"){for(let index=items.length-remove;index<items.length;index++)items[index].remove();newerTruncated=true}else{for(let index=0;index<remove;index++)items[index].remove();const first=messages.querySelector(":scope > .message");if(first?.dataset.sequence){historyBefore=Number(first.dataset.sequence);historyExhausted=false}}messages.dataset.windowSize=String(messages.querySelectorAll(":scope > .message").length)}
const activeMessageLimit=80,virtual={older:[],newer:[]};
function virtualHeight(edge){return virtual[edge].reduce((sum,item)=>sum+item.height,0)}
function syncVirtualSpacers(){for(const edge of ["older","newer"]){let spacer=messages.querySelector('[data-virtual-spacer="'+edge+'"]');if(!spacer){spacer=document.createElement("div");spacer.dataset.virtualSpacer=edge;spacer.setAttribute("aria-hidden","true");edge==="older"?messages.prepend(spacer):messages.append(spacer)}spacer.style.height=virtualHeight(edge)+"px";spacer.hidden=!virtual[edge].length}messages.dataset.virtualized=String(virtual.older.length+virtual.newer.length)}
function virtualizeMessages(edge="older"){const items=[...messages.querySelectorAll(":scope > .message")],remove=items.length-activeMessageLimit;if(remove>0){const selected=edge==="newer"?items.slice(-remove):items.slice(0,remove),records=selected.map(item=>({html:item.outerHTML,height:item.getBoundingClientRect().height||48}));if(edge==="newer")virtual.newer.unshift(...records);else virtual.older.push(...records);selected.forEach(item=>item.remove())}let excess=virtual.older.length+virtual.newer.length+messages.querySelectorAll(":scope > .message").length-conversationWindowLimit;while(excess>0){excess--;if(edge==="older")virtual.older.shift();else virtual.newer.pop()}syncVirtualSpacers()}
function restoreVirtual(edge){const records=virtual[edge].splice(0),template=document.createElement("template");if(!records.length)return;template.innerHTML=records.map(item=>item.html).join("");const spacer=messages.querySelector('[data-virtual-spacer="'+edge+'"]');edge==="older"?spacer.after(template.content):spacer.before(template.content);syncVirtualSpacers();virtualizeMessages(edge==="older"?"newer":"older")}
async function loadOlderMessages(){if(virtual.older.length){const height=messages.scrollHeight;restoreVirtual("older");messages.scrollTop+=messages.scrollHeight-height;return}if(loadingHistory||historyExhausted)return;loadingHistory=true;const anchor=messages.querySelector(":scope > .message"),height=messages.scrollHeight;try{const response=await fetch("/api/v1/channels/"+channel+"/messages?before="+historyBefore+"&limit=50");if(!response.ok)throw new Error();const result=await response.json(),page=result.messages||[];if(!page.length){historyExhausted=true;return}for(const message of page){render(message,"message.created");const item=document.getElementById("message-"+message.id);if(anchor&&item)messages.insertBefore(item,anchor)}historyBefore=result.next_before||page[0].sequence;historyExhausted=!result.has_more;messages.scrollTop+=messages.scrollHeight-height;trimHistory("newer");virtualizeMessages("newer")}finally{loadingHistory=false}}
async function loadPresent(){if(virtual.newer.length)restoreVirtual("newer");while(newerTruncated){const last=messages.querySelector(":scope > .message:last-of-type"),after=Number(last?.dataset.sequence||0);if(!after)break;const response=await fetch("/api/v1/channels/"+channel+"/messages?after="+after+"&limit=100");if(!response.ok)throw new Error("Message history unavailable");const result=await response.json(),page=result.messages||[];for(const message of page)render(message,"message.created");trimHistory("older");newerTruncated=!!result.has_more;if(!page.length)break}virtualizeMessages("older")}
async function catchUpPresent(){const last=messages.querySelector(":scope > .message:last-of-type"),after=Number(last?.dataset.sequence||0);if(!after)return;const response=await fetch("/api/v1/channels/"+channel+"/messages?after="+after+"&limit=100");if(!response.ok)return;const result=await response.json();for(const message of result.messages||[])render(message,"message.created");trimHistory("older")}
conversationFollower.setPresentLoader(loadPresent);
window.allchatConversationWindow={limit:conversationWindowLimit,activeLimit:activeMessageLimit,trim:trimHistory,virtualize:virtualizeMessages,loadPresent,catchUpPresent};
messages.addEventListener("scroll",()=>{if(messages.scrollTop<80)loadOlderMessages();if(conversationFollower.nearBottom()){if(virtual.newer.length)restoreVirtual("newer");trimHistory();virtualizeMessages("older")}},{passive:true});
document.addEventListener("click",event=>{const button=event.target.closest?.(".message-image-button");if(!button)return;const dialog=document.createElement("dialog"),image=document.createElement("img"),close=document.createElement("button");dialog.className="message-image-dialog";image.src=button.dataset.originalSrc;image.alt=button.querySelector("img")?.alt||"Expanded image";close.type="button";close.textContent="×";close.setAttribute("aria-label","Close image");close.onclick=()=>dialog.close();dialog.addEventListener("close",()=>dialog.remove());dialog.append(image,close);document.body.append(dialog);dialog.showModal()});
function connect(){if(disposed)return;const protocol=location.protocol==="https:"?"wss:":"ws:",socket=new WebSocket(protocol+"//"+location.host+"/api/v1/realtime?cursor="+cursor);activeSocket=socket;window.allchatSocket=socket;
socket.onopen=()=>{retry=250;socket.send(JSON.stringify({type:"heartbeat"}));const heartbeat=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:"heartbeat"}));else clearInterval(heartbeat)},1000)};
function typingSummary(items){const names=[...new Set((items||[]).filter(item=>item.channel_id===channel&&item.member_name).map(item=>item.member_name))];if(!names.length)return "";if(names.length>3)return "Several people are typing…";return names.join(", ")+(names.length===1?" is typing…":" are typing…")}window.allchatTypingSummary=typingSummary;
socket.onmessage=event=>{const frame=JSON.parse(event.data);if(frame.type==="ready"){cursor=frame.cursor;localStorage.setItem(key,String(cursor));catchUpPresent();return}if(frame.type==="heartbeat"&&frame.cursor>cursor){catchUpPresent();cursor=frame.cursor;localStorage.setItem(key,String(cursor));return}if(frame.type==="events"&&Array.isArray(frame.events)){frame.events.forEach(item=>socket.onmessage({data:JSON.stringify({type:item.type,cursor:item.cursor,channel_id:item.channel_id,payload:item.payload})}));if(frame.cursor>=cursor){cursor=frame.cursor;localStorage.setItem(key,String(cursor))}return}if(frame.type==="snapshot_required"){localStorage.setItem(key,String(frame.cursor));location.reload();return}if(frame.type==="channel.removed"&&frame.channel_id===channel){location.href="/";return}if(frame.type==="state.ephemeral"){document.getElementById("typing").textContent=typingSummary(frame.payload.typing);const indicator=document.getElementById("member-presence"),dnd=frame.payload.presence[member]==="dnd";indicator.classList.toggle("dnd",dnd);indicator.classList.toggle("online",!dnd);document.querySelectorAll("[data-participant-id]").forEach(item=>{const state=frame.payload.presence[item.dataset.participantId]||"offline",dot=item.querySelector(".participant-presence");if(!dot)return;dot.classList.toggle("online",state==="online");dot.classList.toggle("dnd",state==="dnd");dot.classList.toggle("offline",state!=="online"&&state!=="dnd")})}if(frame.payload){render(frame.payload,frame.type);trimHistory(frame.type==="message.created"?"older":"newer");virtualizeMessages(frame.type==="message.created"?"older":"newer")}if(frame.cursor>=cursor){cursor=frame.cursor;localStorage.setItem(key,String(cursor))}};
socket.onclose=()=>{if(!disposed)setTimeout(connect,retry=Math.min(retry*2,5000))}}connect();document.addEventListener("allchat:before-conversation-swap",()=>{disposed=true;if(window.allchatSocket===activeSocket)window.allchatSocket=null;activeSocket?.close()},{once:true});
const runtime=new AbortController();document.addEventListener("allchat:before-conversation-swap",()=>runtime.abort(),{once:true});
const timestampTimer=setInterval(()=>document.querySelectorAll("#messages .message-time").forEach(stamp=>stamp.textContent=formatTimestamp(stamp.dataset.createdAt)),60000);runtime.signal.addEventListener("abort",()=>clearInterval(timestampTimer));
const composer=document.getElementById("composer"),bodyInput=document.getElementById("message-body"),fileInput=document.getElementById("attachment"),submitButton=document.getElementById("composer-submit"),editingBanner=document.getElementById("editing-banner");
const mentionMenu=document.createElement("div");mentionMenu.className="mention-suggestions";mentionMenu.hidden=true;mentionMenu.setAttribute("role","listbox");mentionMenu.setAttribute("aria-label","Mention a Member");composer.append(mentionMenu);let mentionMembers=[],mentionStart=-1,mentionIndex=0;
fetch("/api/v1/members").then(response=>response.ok?response.json():null).then(value=>{mentionMembers=value?.members||[]}).catch(()=>{});
function closeMentions(){mentionMenu.hidden=true;mentionMenu.replaceChildren();mentionStart=-1;bodyInput.removeAttribute("aria-activedescendant")}
function chooseMention(member){if(mentionStart<0)return;const caret=bodyInput.selectionStart,prefix=bodyInput.value.slice(0,mentionStart),suffix=bodyInput.value.slice(caret);bodyInput.value=prefix+"@"+member.username+" "+suffix;const next=prefix.length+member.username.length+2;bodyInput.setSelectionRange(next,next);closeMentions();bodyInput.focus();bodyInput.dispatchEvent(new Event("input",{bubbles:true}))}
function refreshMentions(){const caret=bodyInput.selectionStart,before=bodyInput.value.slice(0,caret),match=before.match(/(?:^|\s)@([\p{L}\p{N}._-]*)$/u);if(!match){closeMentions();return}const query=match[1].toLocaleLowerCase(),matches=mentionMembers.filter(item=>item.username.toLocaleLowerCase().startsWith(query)||(item.display_name||"").toLocaleLowerCase().includes(query)).slice(0,8);if(!matches.length){closeMentions();return}mentionStart=caret-match[1].length-1;mentionIndex=Math.min(mentionIndex,matches.length-1);mentionMenu.replaceChildren(...matches.map((member,index)=>{const option=document.createElement("button");option.type="button";option.id="mention-option-"+member.id;option.role="option";option.dataset.mentionIndex=index;option.setAttribute("aria-selected",String(index===mentionIndex));const name=document.createElement("strong"),username=document.createElement("small");name.textContent=member.display_name||member.username;username.textContent="@"+member.username;option.append(name,username);option.addEventListener("pointerdown",event=>event.preventDefault());option.addEventListener("click",()=>chooseMention(member));return option}));mentionMenu.hidden=false;bodyInput.setAttribute("aria-activedescendant",mentionMenu.children[mentionIndex].id)}
bodyInput.addEventListener("input",refreshMentions);bodyInput.addEventListener("keydown",event=>{if(mentionMenu.hidden)return;const options=[...mentionMenu.children];if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();mentionIndex=(mentionIndex+(event.key==="ArrowDown"?1:-1)+options.length)%options.length;options.forEach((option,index)=>option.setAttribute("aria-selected",String(index===mentionIndex)));bodyInput.setAttribute("aria-activedescendant",options[mentionIndex].id)}else if(event.key==="Enter"||event.key==="Tab"){event.preventDefault();options[mentionIndex]?.click()}else if(event.key==="Escape"){event.preventDefault();closeMentions()}});bodyInput.addEventListener("blur",()=>setTimeout(closeMentions,120));
const replyBanner=document.createElement("div"),replyLabel=document.createElement("span"),cancelReply=document.createElement("button");replyBanner.className="editing-banner";replyBanner.hidden=true;replyBanner.setAttribute("role","status");cancelReply.className="button-ghost";cancelReply.type="button";cancelReply.textContent="Cancel";replyBanner.append(replyLabel,cancelReply);editingBanner.before(replyBanner);
function ensureReplyActions(root=document){root.querySelectorAll?.(".message").forEach(item=>{if(item.querySelector("[data-reply-message]")||!item.querySelector(".body"))return;let actions=item.querySelector(".message-actions");if(!actions){actions=document.createElement("div");actions.className="message-actions";actions.setAttribute("aria-label","Message actions");item.append(actions)}const button=document.createElement("button");button.className="message-action";button.type="button";button.dataset.replyMessage=item.id.replace("message-","");button.dataset.replyAuthor=item.querySelector("strong")?.textContent||"Member";button.setAttribute("aria-label","Reply to Message");button.textContent="Reply";actions.prepend(button)})}
function stopReply(){delete composer.dataset.replying;replyBanner.hidden=true;replyLabel.textContent=""}
function beginReply(button){if(composer.dataset.editing)stopEditing();composer.dataset.replying=button.dataset.replyMessage;replyLabel.textContent="Replying to "+button.dataset.replyAuthor;replyBanner.hidden=false;bodyInput.focus()}
ensureReplyActions();new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)ensureReplyActions(node.matches?.(".message")?node.parentElement:node)}))).observe(messages,{childList:true});cancelReply.addEventListener("click",stopReply);
bodyInput.required=false;const attachmentLabel=fileInput.previousElementSibling,attachmentPreviews=document.getElementById("attachment-previews");attachmentLabel.className="attachment-button";attachmentLabel.textContent="+";attachmentLabel.title="Add attachments";attachmentLabel.setAttribute("aria-label","Add attachments");let selectedFiles=[],attachmentPreviewURLs=[];
function renderAttachmentPreviews(){attachmentPreviewURLs.forEach(URL.revokeObjectURL);attachmentPreviewURLs=[];attachmentPreviews.replaceChildren();selectedFiles.forEach((file,index)=>{const item=document.createElement("article"),preview=file.type.startsWith("image/")?document.createElement("img"):document.createElement("span"),details=document.createElement("span"),name=document.createElement("strong"),size=document.createElement("small"),remove=document.createElement("button");item.className="attachment-preview";item.dataset.attachmentPreview="";if(preview.tagName==="IMG"){const url=URL.createObjectURL(file);attachmentPreviewURLs.push(url);preview.src=url;preview.alt=""}else{preview.className="attachment-file-icon";preview.append(window.allchatIcon(file.type.startsWith("audio/")?"music":"file"));preview.setAttribute("aria-hidden","true")}details.className="attachment-preview-details";name.textContent=file.name;size.textContent=file.size<1024?file.size+" B":(file.size/1024).toFixed(1)+" KB";details.append(name,size);remove.type="button";remove.className="attachment-preview-remove";remove.setAttribute("aria-label","Remove attachment");remove.textContent="×";remove.onclick=()=>{selectedFiles.splice(index,1);renderAttachmentPreviews()};item.append(preview,details,remove);attachmentPreviews.append(item)});attachmentPreviews.hidden=!selectedFiles.length;attachmentLabel.title=selectedFiles.length?selectedFiles.length+" attachment"+(selectedFiles.length===1?"":"s")+" selected":"Add attachments";attachmentLabel.setAttribute("aria-label",attachmentLabel.title)}
function addAttachments(files){const maximum={{.MaxAttachmentBytes}},accepted=[];for(const file of files){if(file.size>maximum){alert(file.name+" is "+(file.size/1024/1024).toFixed(1)+" MiB. This Instance allows attachments up to "+(maximum/1024/1024).toFixed(0)+" MiB.");continue}accepted.push(file)}selectedFiles.push(...accepted);renderAttachmentPreviews()}
function clearAttachments(){selectedFiles=[];fileInput.value="";renderAttachmentPreviews()}
fileInput.addEventListener("change",()=>{addAttachments([...fileInput.files]);fileInput.value=""});
bodyInput.addEventListener("paste",event=>{const clipboard=event.clipboardData;if(!clipboard)return;const itemFiles=[...clipboard.items].filter(item=>item.kind==="file").map(item=>item.getAsFile()).filter(Boolean),files=itemFiles.length?itemFiles:[...clipboard.files];if(!files.length)return;event.preventDefault();addAttachments(files)});
let dragDepth=0;composer.addEventListener("dragenter",event=>{if(!event.dataTransfer?.types?.includes("Files"))return;event.preventDefault();dragDepth++;composer.classList.add("file-drag-active")});composer.addEventListener("dragover",event=>{if(!event.dataTransfer?.types?.includes("Files"))return;event.preventDefault();event.dataTransfer.dropEffect="copy"});composer.addEventListener("dragleave",()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)composer.classList.remove("file-drag-active")});composer.addEventListener("drop",event=>{dragDepth=0;composer.classList.remove("file-drag-active");if(!event.dataTransfer?.files?.length)return;event.preventDefault();addAttachments([...event.dataTransfer.files])});
runtime.signal.addEventListener("abort",()=>attachmentPreviewURLs.forEach(URL.revokeObjectURL));
const csrfToken=composer.querySelector('[name="csrf_token"]').value;
function stopEditing(){composer.action=composer.dataset.publishAction;delete composer.dataset.editing;bodyInput.value="";bodyInput.placeholder="Message #{{.Channel.Name}}";fileInput.disabled=false;submitButton.textContent="Send";editingBanner.hidden=true;bodyInput.focus()}
function beginEditing(button){stopReply();composer.action="/messages/"+button.dataset.messageId+"/edit";composer.dataset.editing=button.dataset.messageId;bodyInput.value=button.dataset.messageBody;bodyInput.placeholder="Edit Message";fileInput.disabled=true;submitButton.textContent="Save";editingBanner.hidden=false;bodyInput.focus();bodyInput.setSelectionRange(bodyInput.value.length,bodyInput.value.length)}
document.addEventListener("click",event=>{const edit=event.target.closest("[data-edit-message]"),reply=event.target.closest("[data-reply-message]");if(edit)beginEditing(edit);else if(reply)beginReply(reply)});
document.getElementById("cancel-edit").addEventListener("click",stopEditing);bodyInput.addEventListener("keydown",event=>{if(event.key==="Escape"&&composer.dataset.editing){event.preventDefault();stopEditing()}else if(event.key==="Escape"&&composer.dataset.replying){event.preventDefault();stopReply()}});
composer.addEventListener("submit",async event=>{event.preventDefault();if(!composer.dataset.editing&&!bodyInput.value.trim()&&!selectedFiles.length){bodyInput.focus();return}submitButton.disabled=true;let optimistic=null;try{if(composer.dataset.editing){const response=await fetch("/api/v1/messages/"+composer.dataset.editing,{method:"PATCH",headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken},body:JSON.stringify({body:bodyInput.value})});if(!response.ok)throw new Error("Message edit failed");const message=await response.json();window.renderAllChatMessage(message,"message.edited");stopEditing();return}const attachmentIDs=[];for(const file of selectedFiles){const upload=await fetch("/api/v1/attachments?filename="+encodeURIComponent(file.name),{method:"POST",headers:{"X-CSRF-Token":csrfToken,"Content-Type":file.type||"application/octet-stream"},body:file});if(!upload.ok)throw new Error("Attachment upload failed");attachmentIDs.push((await upload.json()).id)}const clientID=crypto.randomUUID(),bodyValue=bodyInput.value,replyValue=composer.dataset.replying||"";if(!attachmentIDs.length){const summary=document.querySelector(".member-summary"),author=summary?.querySelector("strong")?.textContent.trim()||"You";render({id:"pending-"+clientID,client_id:clientID,channel_id:channel,author_id:member,author_name:author,sequence:"",body:bodyValue,created_at:new Date().toISOString()},"message.created");optimistic=messages.querySelector('[data-client-id="'+CSS.escape(clientID)+'"]')||document.getElementById("message-pending-"+clientID);if(optimistic){optimistic.dataset.clientId=clientID;optimistic.classList.add("optimistic");optimistic.setAttribute("aria-busy","true")}}bodyInput.value="";clearAttachments();stopReply();const response=await fetch("/api/v1/channels/"+document.body.dataset.channelId+"/messages",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken},body:JSON.stringify({body:bodyValue,attachment_ids:attachmentIDs,reply_to:replyValue,client_id:clientID})});if(!response.ok)throw new Error("Message send failed");const message=await response.json();window.renderAllChatMessage(message,"message.created")}catch(error){optimistic?.remove();alert(error.message)}finally{submitButton.disabled=false}});
bodyInput.addEventListener("input",()=>{if(!composer.dataset.editing&&window.allchatSocket?.readyState===WebSocket.OPEN)window.allchatSocket.send(JSON.stringify({type:"typing",channel_id:document.body.dataset.channelId}))});
const searchForm=document.getElementById("header-search"),searchInput=document.getElementById("channel-search"),searchPane=document.getElementById("search-pane"),searchResults=document.getElementById("search-results");
function closeSearch(){searchPane.hidden=true;document.querySelector(".conversation-layout").classList.remove("search-open");searchInput.focus()}
document.getElementById("close-search").addEventListener("click",closeSearch);searchForm.addEventListener("submit",async event=>{event.preventDefault();const query=searchInput.value.trim();if(!query)return;searchPane.hidden=false;document.querySelector(".conversation-layout").classList.add("search-open");searchResults.replaceChildren();const loading=document.createElement("p");loading.className="muted search-state";loading.textContent="Searching…";searchResults.append(loading);const response=await fetch("/api/v1/search?q="+encodeURIComponent(query)+"&limit=25");if(!response.ok){loading.textContent="Search failed.";return}const page=await response.json();searchResults.replaceChildren();if(!page.results.length){loading.textContent="No results found.";searchResults.append(loading);return}page.results.forEach(result=>{const link=document.createElement("a");link.className="pane-search-result";link.href=result.url;const channel=document.createElement("span");channel.className="pane-search-channel";channel.textContent="#"+result.channel_name+" · "+result.category_name;const author=document.createElement("strong");author.textContent=result.message.author_name;const snippet=document.createElement("p");snippet.textContent=result.snippet;link.append(channel,author,snippet);searchResults.append(link)})});
addEventListener("pagehide",()=>{if(window.allchatSocket?.readyState===WebSocket.OPEN)window.allchatSocket.send(JSON.stringify({type:"disconnect"}))});
const lastSequence=Number(document.body.dataset.lastSequence);if(lastSequence>0)fetch("/api/v1/channels/"+document.body.dataset.channelId+"/read-position",{method:"PUT",headers:{"Content-Type":"application/json","X-CSRF-Token":composer.querySelector('[name="csrf_token"]').value},body:JSON.stringify({sequence:lastSequence})});
})();</script></body></html>`))
