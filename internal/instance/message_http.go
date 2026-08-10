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
}

func (i *Instance) messagesAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	messages, err := i.community.ListMessages(r.Context(), m, r.PathValue("channelID"), before, limit)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"messages": messages})
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
		Body: input.Body, ReplyTo: input.ReplyTo, MentionIDs: input.MentionIDs, AttachmentIDs: input.AttachmentIDs,
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
	messages, err := i.community.ListMessages(r.Context(), m, r.PathValue("channelID"), 0, 100)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	directMessages, _ := i.community.ListDirectMessages(r.Context(), m)
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
	_ = channelTemplate.Execute(w, map[string]any{"Channel": channel, "Messages": messages, "Member": m, "Members": members, "Presence": presence, "Overview": overview, "DirectMessages": directMessages, "DirectMessage": directMessage, "Direct": directMessage != nil, "CSRF": csrfCookieValue(r), "LastSequence": lastSequence})
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
<main class="content-shell channel-content"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle aria-label="Open conversation navigation" aria-expanded="false">☰</button><span class="hash">{{if .Direct}}@{{else}}#{{end}}</span><h1>{{.Channel.Name}}</h1><span class="muted channel-topic">{{if .Direct}}Direct Message{{else}}Community Text Channel{{end}}</span><div class="header-actions">{{if .Direct}}{{if .DirectMessage.BlockedByMe}}<form method="post" action="/dms/{{.DirectMessage.ID}}/unblock"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><button class="button-ghost">Unblock</button></form>{{else}}<form method="post" action="/dms/{{.DirectMessage.ID}}/block"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><button class="button-ghost" data-confirm="Block this Member? Existing history remains visible.">Block</button></form>{{end}}{{end}}<button class="button-ghost" id="notifications" type="button">Enable notifications</button><form class="header-search" id="header-search" role="search"><label class="sr-only" for="channel-search">Search Messages</label><input id="channel-search" name="q" type="search" maxlength="200" placeholder="Search" autocomplete="off"></form></div></header><div class="conversation-layout"><section class="messages" id="messages" aria-live="polite">
{{range .Messages}}<article class="message" id="message-{{.ID}}">{{if .AuthorAvatarURL}}<img class="message-avatar" src="{{.AuthorAvatarURL}}" alt="">{{else}}<span class="message-avatar message-avatar-fallback" aria-hidden="true">{{initial .AuthorName}}</span>{{end}}<strong>{{.AuthorName}}</strong> {{if .Deleted}}<em class="muted">Message deleted</em>{{else}}{{if .Reply}}<small>Reply to {{.Reply.AuthorName}}: {{if .Reply.Deleted}}deleted message{{else}}{{.Reply.Body}}{{end}}</small>{{end}}<span class="body">{{safeHTML .RenderedHTML}}</span>{{range .Mentions}} <mark>@{{.Username}}</mark>{{end}}{{range .Attachments}}{{if isImage .ContentType}}<img class="message-image" src="{{.URL}}" alt="{{.Name}}" loading="lazy">{{else}}<a class="message-attachment" href="{{.URL}}">📎 {{.Name}}</a>{{end}}{{end}}{{range .Reactions}} <button class="button-ghost" type="button">{{.Emoji}} {{.Count}}</button>{{end}}{{if .Pinned}} <span class="badge">Pinned</span>{{end}}{{if .EditedAt}} <small class="edited">(edited)</small>{{end}}{{if eq .AuthorID $.Member.ID}}<div class="message-actions" aria-label="Message actions"><button class="message-action" type="button" data-edit-message data-message-id="{{.ID}}" data-message-body="{{.Body}}" aria-label="Edit Message">Edit</button><form method="post" action="/messages/{{.ID}}/delete"><input type="hidden" name="csrf_token" value="{{$.CSRF}}"><input type="hidden" name="channel_id" value="{{$.Channel.ID}}"><button class="message-action danger-text" data-confirm="Delete this Message permanently?" aria-label="Delete Message">Delete</button></form></div>{{end}}{{end}}</article>{{else}}<div class="content"><h2>Welcome to #{{$.Channel.Name}}</h2><p class="muted">This is the beginning of this Text Channel.</p></div>{{end}}
</section><aside class="search-pane" id="search-pane" aria-label="Search results" hidden><header><strong>Search Results</strong><button class="button-ghost" id="close-search" type="button" aria-label="Close search results">×</button></header><div id="search-results" aria-live="polite"></div></aside><aside class="participant-sidebar" aria-label="Conversation participants">{{if .Direct}}<div class="dm-profile-card">{{if .DirectMessage.Other.AvatarURL}}<img src="{{.DirectMessage.Other.AvatarURL}}" alt="">{{else}}<span class="profile-avatar-fallback">{{initial .DirectMessage.Other.Username}}</span>{{end}}<h2>{{if .DirectMessage.Other.DisplayName}}{{.DirectMessage.Other.DisplayName}}{{else}}{{.DirectMessage.Other.Username}}{{end}}</h2><p>@{{.DirectMessage.Other.Username}}</p><span class="badge">Direct Message</span></div>{{else}}<h2 class="participant-heading">Members — {{len .Members}}</h2><ul class="participant-list">{{range .Members}}{{$state := index $.Presence .ID}}<li data-participant-id="{{.ID}}"><span class="participant-avatar-wrap">{{if .AvatarURL}}<img src="{{.AvatarURL}}" alt="">{{else}}<span class="participant-avatar-fallback">{{initial .Username}}</span>{{end}}<span class="participant-presence {{if eq $state "online"}}online{{else if eq $state "dnd"}}dnd{{else}}offline{{end}}"></span></span><span>{{if .DisplayName}}{{.DisplayName}}{{else}}{{.Username}}{{end}}{{if .Owner}} <small>Owner</small>{{end}}</span></li>{{end}}</ul>{{end}}</aside></div><div class="composer-wrap"><button class="jump-to-present" id="jump-to-present" type="button" hidden>Jump to present <span aria-hidden="true">↓</span></button>{{if .Direct}}{{if or .DirectMessage.BlockedByMe .DirectMessage.BlockedMe}}<p class="blocked-conversation" role="status">You cannot send new Messages in this Direct Message while either Member has blocked the other.</p>{{end}}{{end}}<div class="editing-banner" id="editing-banner" hidden><span>Editing Message</span><button class="button-ghost" id="cancel-edit" type="button">Cancel</button></div><form class="composer" id="composer" method="post" action="/channels/{{.Channel.ID}}/messages" data-publish-action="/channels/{{.Channel.ID}}/messages"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label class="sr-only" for="message-body">Message {{if .Direct}}@{{else}}#{{end}}{{.Channel.Name}}</label><input id="message-body" name="body" maxlength="4000" placeholder="Message {{if .Direct}}@{{else}}#{{end}}{{.Channel.Name}}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" {{if .Direct}}{{if or .DirectMessage.BlockedByMe .DirectMessage.BlockedMe}}disabled{{end}}{{end}} required autofocus><label class="sr-only" for="attachment">Add Attachment</label><input id="attachment" type="file" {{if .Direct}}{{if or .DirectMessage.BlockedByMe .DirectMessage.BlockedMe}}disabled{{end}}{{end}}><button id="composer-submit" {{if .Direct}}{{if or .DirectMessage.BlockedByMe .DirectMessage.BlockedMe}}disabled{{end}}{{end}}>Send</button></form><p class="typing" id="typing" aria-live="polite"></p></div></main></div>
<script>
(()=>{const channel=document.body.dataset.channelId,member=document.body.dataset.memberId,key="allchat.realtime.cursor",messages=document.getElementById("messages");
let cursor=Number(localStorage.getItem(key)||0),retry=250,notificationsAllowed=true,disposed=false,activeSocket=null;
const channelNames={},mutedChannels=window.allchatMutedChannels||new Set();window.allchatMutedChannels=mutedChannels;fetch("/api/v1/channels").then(response=>response.ok?response.json():null).then(overview=>overview?.channels?.forEach(item=>channelNames[item.id]=item.name)).catch(()=>{});fetch("/api/v1/notification-settings").then(response=>response.ok?response.json():null).then(settings=>{settings?.muted_channel_ids?.forEach(id=>mutedChannels.add(id));updateNotificationButton()}).catch(()=>{});
function updateNotificationButton(){const button=document.getElementById("notifications"),muted=mutedChannels.has(channel);button.textContent=muted?"Unmute":Notification.permission==="default"?"Enable notifications":"Mute";button.setAttribute("aria-pressed",String(muted))}
const conversationFollower=createConversationFollower(messages,document.getElementById("jump-to-present"),120),scrollToLatest=conversationFollower.scrollToLatest;
conversationFollower.setFollowing(!location.hash);
if(conversationFollower.isFollowing())requestAnimationFrame(scrollToLatest);
function render(message,type){if(message.channel_id!==channel)return;let item=document.getElementById("message-"+message.id);
if(type==="message.created"&&!item){item=document.createElement("article");item.className="message";item.id="message-"+message.id;const avatar=document.createElement(message.author_avatar_url?"img":"span");avatar.className="message-avatar"+(message.author_avatar_url?"":" message-avatar-fallback");if(message.author_avatar_url){avatar.src=message.author_avatar_url;avatar.alt=""}else{avatar.textContent=Array.from(message.author_name||"?")[0].toUpperCase();avatar.setAttribute("aria-hidden","true")}const author=document.createElement("strong"),body=document.createElement("span");author.textContent=message.author_name;body.className="body";item.append(avatar,author," ",body);(message.attachments||[]).forEach(attachment=>{if(attachment.content_type?.startsWith("image/")){const image=document.createElement("img");image.className="message-image";image.src=attachment.url;image.alt=attachment.name;image.loading="lazy";item.append(image)}else{const link=document.createElement("a");link.className="message-attachment";link.href=attachment.url;link.textContent="📎 "+attachment.name;item.append(link)}});if(message.author_id===member){const actions=document.createElement("div"),edit=document.createElement("button");actions.className="message-actions";actions.setAttribute("aria-label","Message actions");edit.className="message-action";edit.type="button";edit.dataset.editMessage="";edit.dataset.messageId=message.id;edit.dataset.messageBody=message.body;edit.setAttribute("aria-label","Edit Message");edit.textContent="Edit";actions.append(edit);item.append(actions)}messages.append(item)}
if(!item)return;if(type==="message.deleted"){item.replaceChildren();const deleted=document.createElement("em");deleted.textContent="Message deleted";item.append(deleted);return}
const body=item.querySelector(".body");if(body){if(message.rendered_html)body.innerHTML=message.rendered_html;else body.textContent=message.body}const editAction=item.querySelector("[data-edit-message]");if(editAction)editAction.dataset.messageBody=message.body;if(type==="message.edited"&&!item.querySelector(".edited")){const edited=document.createElement("small");edited.className="edited";edited.textContent=" (edited)";item.append(edited)}if(conversationFollower.isFollowing())requestAnimationFrame(scrollToLatest)}
window.renderAllChatMessage=render;
function connect(){if(disposed)return;const protocol=location.protocol==="https:"?"wss:":"ws:",socket=new WebSocket(protocol+"//"+location.host+"/api/v1/realtime?cursor="+cursor);activeSocket=socket;window.allchatSocket=socket;
socket.onopen=()=>{retry=250;socket.send(JSON.stringify({type:"heartbeat"}));const heartbeat=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:"heartbeat"}));else clearInterval(heartbeat)},1000)};socket.onmessage=event=>{const frame=JSON.parse(event.data);if(frame.type==="snapshot_required"){localStorage.setItem(key,String(frame.cursor));location.reload();return}if(frame.type==="channel.removed"&&frame.channel_id===channel){location.href="/";return}if(frame.type==="state.ephemeral"){document.getElementById("typing").textContent=frame.payload.typing.some(item=>item.channel_id===channel)?"Someone is typing…":"";notificationsAllowed=frame.payload.presence[member]!=="dnd";const indicator=document.getElementById("member-presence"),dnd=frame.payload.presence[member]==="dnd";indicator.classList.toggle("dnd",dnd);indicator.classList.toggle("online",!dnd);document.querySelectorAll("[data-participant-id]").forEach(item=>{const state=frame.payload.presence[item.dataset.participantId]||"offline",dot=item.querySelector(".participant-presence");if(!dot)return;dot.classList.toggle("online",state==="online");dot.classList.toggle("dnd",state==="dnd");dot.classList.toggle("offline",state!=="online"&&state!=="dnd")})}if(frame.payload)render(frame.payload,frame.type);if(frame.type==="message.created"&&frame.payload.author_id!==member&&frame.payload.channel_id!==channel&&!window.allchatDirectMessageIDs?.has(frame.payload.channel_id)&&!mutedChannels.has(frame.payload.channel_id)&&(document.hidden||!document.hasFocus())&&notificationsAllowed&&Notification.permission==="granted"){const place=channelNames[frame.payload.channel_id]||"conversation",preview=frame.payload.body||(frame.payload.attachments?.length?"Sent an attachment":"New message"),notice=new Notification(frame.payload.author_name+" in #"+place,{body:preview.slice(0,180),tag:"allchat-"+frame.payload.channel_id});notice.onclick=()=>{window.focus();location.href="/channels/"+frame.payload.channel_id}}if(frame.cursor>=cursor){cursor=frame.cursor;localStorage.setItem(key,String(cursor))}};
socket.onclose=()=>{if(!disposed)setTimeout(connect,retry=Math.min(retry*2,5000))}}connect();document.addEventListener("allchat:before-conversation-swap",()=>{disposed=true;if(window.allchatSocket===activeSocket)window.allchatSocket=null;activeSocket?.close()},{once:true});
const runtime=new AbortController();document.addEventListener("allchat:before-conversation-swap",()=>runtime.abort(),{once:true});
document.getElementById("notifications").onclick=async()=>{if(!mutedChannels.has(channel)&&Notification.permission==="default"){await Notification.requestPermission();updateNotificationButton();return}const muted=mutedChannels.has(channel),response=await fetch("/api/v1/channels/"+channel+"/mute",{method:muted?"DELETE":"PUT",headers:{"X-CSRF-Token":document.querySelector('[name="csrf_token"]').value}});if(!response.ok)return;if(muted)mutedChannels.delete(channel);else mutedChannels.add(channel);updateNotificationButton()};
const composer=document.getElementById("composer"),bodyInput=document.getElementById("message-body"),fileInput=document.getElementById("attachment"),submitButton=document.getElementById("composer-submit"),editingBanner=document.getElementById("editing-banner");
bodyInput.required=false;const attachmentLabel=fileInput.previousElementSibling;attachmentLabel.className="attachment-button";attachmentLabel.textContent="+";attachmentLabel.title="Add Attachment";attachmentLabel.setAttribute("aria-label","Add Attachment");
fileInput.addEventListener("change",()=>{attachmentLabel.title=fileInput.files[0]?"Attached: "+fileInput.files[0].name:"Add Attachment";attachmentLabel.setAttribute("aria-label",attachmentLabel.title)});
const csrfToken=composer.querySelector('[name="csrf_token"]').value;
function stopEditing(){composer.action=composer.dataset.publishAction;delete composer.dataset.editing;bodyInput.value="";bodyInput.placeholder="Message #{{.Channel.Name}}";fileInput.disabled=false;submitButton.textContent="Send";editingBanner.hidden=true;bodyInput.focus()}
function beginEditing(button){composer.action="/messages/"+button.dataset.messageId+"/edit";composer.dataset.editing=button.dataset.messageId;bodyInput.value=button.dataset.messageBody;bodyInput.placeholder="Edit Message";fileInput.disabled=true;submitButton.textContent="Save";editingBanner.hidden=false;bodyInput.focus();bodyInput.setSelectionRange(bodyInput.value.length,bodyInput.value.length)}
document.addEventListener("click",event=>{const button=event.target.closest("[data-edit-message]");if(button)beginEditing(button)});
document.getElementById("cancel-edit").addEventListener("click",stopEditing);bodyInput.addEventListener("keydown",event=>{if(event.key==="Escape"&&composer.dataset.editing){event.preventDefault();stopEditing()}});
composer.addEventListener("submit",async event=>{event.preventDefault();if(!composer.dataset.editing&&!bodyInput.value.trim()&&!fileInput.files.length){bodyInput.focus();return}submitButton.disabled=true;try{if(composer.dataset.editing){const response=await fetch("/api/v1/messages/"+composer.dataset.editing,{method:"PATCH",headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken},body:JSON.stringify({body:bodyInput.value})});if(!response.ok)throw new Error("Message edit failed");const message=await response.json();window.renderAllChatMessage(message,"message.edited");stopEditing();return}const attachmentIDs=[];if(fileInput.files.length){const file=fileInput.files[0],upload=await fetch("/api/v1/attachments",{method:"POST",headers:{"X-CSRF-Token":csrfToken,"X-AllChat-Filename":file.name,"Content-Type":file.type||"application/octet-stream"},body:file});if(!upload.ok)throw new Error("Attachment upload failed");attachmentIDs.push((await upload.json()).id)}const response=await fetch("/api/v1/channels/"+document.body.dataset.channelId+"/messages",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken},body:JSON.stringify({body:bodyInput.value,attachment_ids:attachmentIDs})});if(!response.ok)throw new Error("Message send failed");const message=await response.json();window.renderAllChatMessage(message,"message.created");bodyInput.value="";fileInput.value=""}catch(error){alert(error.message)}finally{submitButton.disabled=false}});
bodyInput.addEventListener("input",()=>{if(!composer.dataset.editing&&window.allchatSocket?.readyState===WebSocket.OPEN)window.allchatSocket.send(JSON.stringify({type:"typing",channel_id:document.body.dataset.channelId}))});
const searchForm=document.getElementById("header-search"),searchInput=document.getElementById("channel-search"),searchPane=document.getElementById("search-pane"),searchResults=document.getElementById("search-results");
function closeSearch(){searchPane.hidden=true;document.querySelector(".conversation-layout").classList.remove("search-open");searchInput.focus()}
document.getElementById("close-search").addEventListener("click",closeSearch);searchForm.addEventListener("submit",async event=>{event.preventDefault();const query=searchInput.value.trim();if(!query)return;searchPane.hidden=false;document.querySelector(".conversation-layout").classList.add("search-open");searchResults.replaceChildren();const loading=document.createElement("p");loading.className="muted search-state";loading.textContent="Searching…";searchResults.append(loading);const response=await fetch("/api/v1/search?q="+encodeURIComponent(query)+"&limit=25");if(!response.ok){loading.textContent="Search failed.";return}const page=await response.json();searchResults.replaceChildren();if(!page.results.length){loading.textContent="No results found.";searchResults.append(loading);return}page.results.forEach(result=>{const link=document.createElement("a");link.className="pane-search-result";link.href=result.url;const channel=document.createElement("span");channel.className="pane-search-channel";channel.textContent="#"+result.channel_name+" · "+result.category_name;const author=document.createElement("strong");author.textContent=result.message.author_name;const snippet=document.createElement("p");snippet.textContent=result.snippet;link.append(channel,author,snippet);searchResults.append(link)})});
addEventListener("pagehide",()=>{if(window.allchatSocket?.readyState===WebSocket.OPEN)window.allchatSocket.send(JSON.stringify({type:"disconnect"}))});
const lastSequence=Number(document.body.dataset.lastSequence);if(lastSequence>0)fetch("/api/v1/channels/"+document.body.dataset.channelId+"/read-position",{method:"PUT",headers:{"Content-Type":"application/json","X-CSRF-Token":composer.querySelector('[name="csrf_token"]').value},body:JSON.stringify({sequence:lastSequence})});
})();</script></body></html>`))
