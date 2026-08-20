// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"crypto/sha256"
	"encoding/base64"
	"html/template"
	"io"
	"net/http"
	"strconv"

	"allchat/internal/community"
)

type profileInput struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

func (i *Instance) membersAPI(response http.ResponseWriter, request *http.Request) {
	if _, _, ok := i.authenticated(response, request); !ok {
		return
	}
	members, err := i.identity.ListMembers(request.Context())
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "Members unavailable"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"members": members})
}

func (i *Instance) disableMemberAPI(response http.ResponseWriter, request *http.Request) {
	actor, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	target, err := i.identity.MemberProfile(request.Context(), request.PathValue("memberID"))
	if err != nil {
		http.NotFound(response, request)
		return
	}
	if err := i.identity.SetMemberDisabled(request.Context(), actor, target, request.Method == http.MethodPut); err != nil {
		writeIdentityError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) deleteMemberAPI(response http.ResponseWriter, request *http.Request) {
	actor, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input struct {
		Confirmation string `json:"confirmation"`
	}
	if decodeJSON(request, &input) != nil || input.Confirmation != "understood" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "confirmation must be understood"})
		return
	}
	target, err := i.identity.MemberProfile(request.Context(), request.PathValue("memberID"))
	if err != nil {
		http.NotFound(response, request)
		return
	}
	if err := i.identity.DeleteMember(request.Context(), actor, target); err != nil {
		writeIdentityError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) registerAPI(response http.ResponseWriter, request *http.Request) {
	var input credentials
	if err := decodeJSON(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	member, session, err := i.identity.Register(request.Context(), input.Token, input.Username, input.Password, deviceLabel(request.UserAgent()))
	if err != nil {
		writeIdentityError(response, err)
		return
	}
	setSessionCookies(response, request, session)
	writeJSON(response, http.StatusCreated, member)
}

func (i *Instance) nativeRegisterAPI(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	var input credentials
	if err := decodeJSON(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	member, session, err := i.identity.Register(request.Context(), input.Token, input.Username, input.Password, nativeDeviceLabel(request))
	if err != nil {
		writeIdentityError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, nativeSession(member, session))
}

func (i *Instance) invitationsAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	invitations, err := i.community.ListInvitations(request.Context(), member)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"invitations": invitations})
}

func (i *Instance) createInvitationAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input community.InvitationInput
	if err := decodeJSON(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	invitation, err := i.community.CreateInvitation(request.Context(), member, input)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, invitation)
}

func (i *Instance) revokeInvitationAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := i.community.RevokeInvitation(request.Context(), member, request.PathValue("invitationID")); err != nil {
		writeCommunityError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) memberProfileAPI(response http.ResponseWriter, request *http.Request) {
	if _, _, ok := i.authenticated(response, request); !ok {
		return
	}
	member, err := i.identity.MemberProfile(request.Context(), request.PathValue("memberID"))
	if err != nil {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "Member not found"})
		return
	}
	writeJSON(response, http.StatusOK, member)
}

func (i *Instance) updateProfileAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input profileInput
	if err := decodeJSON(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	updated, err := i.identity.UpdateProfile(request.Context(), member.ID, input.Username, input.DisplayName)
	if err != nil {
		writeIdentityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, updated)
}

func (i *Instance) updateAvatarAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	data, err := io.ReadAll(io.LimitReader(request.Body, (8<<20)+1))
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid avatar"})
		return
	}
	contentType := http.DetectContentType(data)
	if err := i.identity.SetAvatar(request.Context(), member.ID, contentType, data); err != nil {
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) removeAvatarAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := i.identity.RemoveAvatar(request.Context(), member.ID); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "unable to remove avatar"})
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) memberAvatarAPI(response http.ResponseWriter, request *http.Request) {
	if _, _, ok := i.authenticated(response, request); !ok {
		return
	}
	if i.identity.IsMemberDisabled(request.Context(), request.PathValue("memberID")) {
		http.NotFound(response, request)
		return
	}
	data, contentType, err := i.identity.Avatar(request.Context(), request.PathValue("memberID"))
	if err != nil {
		http.NotFound(response, request)
		return
	}
	digest := sha256.Sum256(data)
	etag := `"` + base64.RawURLEncoding.EncodeToString(digest[:12]) + `"`
	response.Header().Set("ETag", etag)
	if request.Header.Get("If-None-Match") == etag {
		response.WriteHeader(http.StatusNotModified)
		return
	}
	response.Header().Set("Content-Type", contentType)
	response.Header().Set("Cache-Control", "private, no-cache")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = response.Write(data)
}

func (i *Instance) updateBannerAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	data, err := io.ReadAll(io.LimitReader(request.Body, (8<<20)+1))
	if err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid banner"})
		return
	}
	contentType := http.DetectContentType(data)
	if err := i.identity.SetBanner(request.Context(), member.ID, contentType, data); err != nil {
		writeJSON(response, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) removeBannerAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := i.identity.RemoveBanner(request.Context(), member.ID); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "unable to remove banner"})
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) memberBannerAPI(response http.ResponseWriter, request *http.Request) {
	if _, _, ok := i.authenticated(response, request); !ok {
		return
	}
	if i.identity.IsMemberDisabled(request.Context(), request.PathValue("memberID")) {
		http.NotFound(response, request)
		return
	}
	data, contentType, err := i.identity.Banner(request.Context(), request.PathValue("memberID"))
	if err != nil {
		http.NotFound(response, request)
		return
	}
	response.Header().Set("Content-Type", contentType)
	response.Header().Set("Cache-Control", "private, no-cache")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = response.Write(data)
}

func (i *Instance) joinPage(response http.ResponseWriter, request *http.Request) {
	serveJoinPage(response, request.URL.Query().Get("token"))
}

func (i *Instance) joinWeb(response http.ResponseWriter, request *http.Request) {
	if err := request.ParseForm(); err != nil {
		http.Error(response, "invalid request", http.StatusBadRequest)
		return
	}
	_, session, err := i.identity.Register(request.Context(), request.FormValue("token"), request.FormValue("username"), request.FormValue("password"), deviceLabel(request.UserAgent()))
	if err != nil {
		http.Error(response, err.Error(), identityStatus(err))
		return
	}
	setSessionCookies(response, request, session)
	http.Redirect(response, request, "/", http.StatusSeeOther)
}

func (i *Instance) profilePage(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	profile, err := i.identity.MemberProfile(request.Context(), member.ID)
	if err != nil {
		http.Error(response, "profile unavailable", http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = profileTemplate.Execute(response, map[string]any{"Profile": profile, "CSRF": csrfCookieValue(request)})
}

func (i *Instance) profileWeb(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := request.ParseForm(); err != nil {
		http.Error(response, "invalid request", http.StatusBadRequest)
		return
	}
	if _, err := i.identity.UpdateProfile(request.Context(), member.ID, request.FormValue("username"), request.FormValue("display_name")); err != nil {
		http.Error(response, err.Error(), identityStatus(err))
		return
	}
	http.Redirect(response, request, "/profile", http.StatusSeeOther)
}

func (i *Instance) invitationsPage(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	invitations, err := i.community.ListInvitations(request.Context(), member)
	if err != nil {
		http.Error(response, err.Error(), communityStatus(err))
		return
	}
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = invitationsTemplate.Execute(response, map[string]any{"Invitations": invitations, "CSRF": csrfCookieValue(request), "Created": request.URL.Query().Get("created")})
}

func (i *Instance) createInvitationWeb(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := request.ParseForm(); err != nil {
		http.Error(response, "invalid request", http.StatusBadRequest)
		return
	}
	expires, _ := strconv.Atoi(request.FormValue("expires_in_minutes"))
	uses, _ := strconv.Atoi(request.FormValue("max_uses"))
	invitation, err := i.community.CreateInvitation(request.Context(), member, community.InvitationInput{ExpiresInMinutes: expires, MaxUses: uses})
	if err != nil {
		http.Error(response, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(response, request, "/admin/invitations?created="+invitation.Token, http.StatusSeeOther)
}

func (i *Instance) revokeInvitationWeb(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := i.community.RevokeInvitation(request.Context(), member, request.PathValue("invitationID")); err != nil {
		http.Error(response, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(response, request, "/admin/invitations", http.StatusSeeOther)
}

var joinTemplate = template.Must(template.New("join").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Join AllChat</title><link rel="stylesheet" href="/assets/app.css"></head><body class="auth-layout"><main class="auth-card"><h1>Join Community</h1><p class="subtitle">Create your local Member account</p><form method="post" action="/join"><input type="hidden" name="token" value="{{.}}"><label>Username<input name="username" required autocomplete="username"></label><label>Password<input type="password" name="password" minlength="12" required autocomplete="new-password"></label><button>Join AllChat</button></form></main></body></html>`))

func serveJoinPage(response http.ResponseWriter, token string) {
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	_ = joinTemplate.Execute(response, token)
}

var profileTemplate = template.Must(template.New("profile").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Profile — AllChat</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/" aria-label="AllChat home">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Member Settings</div><nav class="channel-nav settings-nav"><a href="/profile" aria-current="page">My Account</a><a href="/sessions">Sessions</a><a href="/search">Search</a><a href="/">Back to Community</a></nav></aside><main class="content-shell"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle aria-label="Open settings navigation" aria-expanded="false">☰</button><h1>My Account</h1></header><section class="content"><h2 class="page-title">Profile</h2><p class="page-description">Control how other Members recognize you.</p><form class="card" method="post" action="/profile" data-avatar-url="{{.Profile.AvatarURL}}" data-banner-url="{{.Profile.BannerURL}}"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label>Username<input name="username" value="{{.Profile.Username}}" required></label><label>Display Name<input name="display_name" value="{{.Profile.DisplayName}}" placeholder="Optional"></label><button>Save changes</button></form></section></main></div></body></html>`))

var invitationsTemplate = template.Must(template.New("invitations").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invitations — AllChat</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Community Settings</div><nav class="channel-nav settings-nav"><a href="/admin/channels">Channels</a><a href="/admin/roles">Roles</a><a href="/admin/invitations" aria-current="page">Invitations</a><a href="/">Back to Community</a></nav></aside><main class="content-shell"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle aria-label="Open settings navigation" aria-expanded="false">☰</button><h1>Invitations</h1></header><section class="content"><h2 class="page-title">Invite Members</h2><p class="page-description">Create controlled, expiring access to your Community.</p>{{if .Created}}<div class="notice"><strong>Invitation created</strong><p>Share this join URL: <code>/join?token={{.Created}}</code></p></div>{{end}}<div class="card"><h3>Active and recent Invitations</h3><ul class="list">{{range .Invitations}}<li class="list-item"><span class="list-item-main"><strong>{{.UseCount}} / {{.MaxUses}} uses</strong><br><span class="muted">Expires {{.ExpiresAt}}</span></span>{{if .Revoked}}<span class="badge badge-danger">Revoked</span>{{else}}<form method="post" action="/admin/invitations/{{.ID}}/revoke"><input type="hidden" name="csrf_token" value="{{$.CSRF}}"><button class="button-danger" data-confirm="Revoke this Invitation?">Revoke</button></form>{{end}}</li>{{else}}<li class="muted">No Invitations yet.</li>{{end}}</ul></div><form class="card" method="post" action="/admin/invitations"><h3>Create Invitation</h3><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label>Expires in minutes<input type="number" name="expires_in_minutes" value="1440" min="1"></label><label>Maximum uses<input type="number" name="max_uses" value="1" min="1"></label><button>Create Invitation</button></form></section></main></div></body></html>`))
