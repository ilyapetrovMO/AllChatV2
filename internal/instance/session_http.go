// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"context"
	"html/template"
	"net/http"
	"strings"

	"allchat/internal/identity"
)

type recoveryRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func (i *Instance) sessionsAPI(response http.ResponseWriter, request *http.Request) {
	member, sessionToken, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	sessions, err := i.identity.ListSessions(request.Context(), member.ID, sessionToken)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "unable to list Sessions"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"sessions": sessions})
}

func (i *Instance) revokeSessionAPI(response http.ResponseWriter, request *http.Request) {
	member, sessionToken, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	sessionID := request.PathValue("sessionID")
	current := i.isCurrentSession(request.Context(), member.ID, sessionToken, sessionID)
	if err := i.identity.RevokeSessionByID(request.Context(), member.ID, sessionID); err != nil {
		writeIdentityError(response, err)
		return
	}
	if current {
		clearSessionCookies(response, request)
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) revokeAllSessionsAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := i.identity.RevokeAllSessions(request.Context(), member.ID); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "unable to revoke Sessions"})
		return
	}
	clearSessionCookies(response, request)
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) issueRecoveryTokenAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	token, err := i.identity.IssueRecoveryToken(request.Context(), member, request.PathValue("memberID"))
	if err != nil {
		writeIdentityError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, token)
}

func (i *Instance) recoverAPI(response http.ResponseWriter, request *http.Request) {
	var input recoveryRequest
	if err := decodeJSON(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if err := i.identity.RedeemRecoveryToken(request.Context(), input.Token, input.Password); err != nil {
		writeIdentityError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) sessionsPage(response http.ResponseWriter, request *http.Request) {
	member, sessionToken, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	sessions, err := i.identity.ListSessions(request.Context(), member.ID, sessionToken)
	if err != nil {
		http.Error(response, "unable to list Sessions", http.StatusInternalServerError)
		return
	}
	csrf, _ := request.Cookie(csrfCookieName)
	csrfValue := ""
	if csrf != nil {
		csrfValue = csrf.Value
	}
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = sessionsTemplate.Execute(response, map[string]any{"Sessions": sessions, "CSRF": csrfValue})
}

func (i *Instance) revokeSessionWeb(response http.ResponseWriter, request *http.Request) {
	member, sessionToken, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	sessionID := request.PathValue("sessionID")
	current := i.isCurrentSession(request.Context(), member.ID, sessionToken, sessionID)
	if err := i.identity.RevokeSessionByID(request.Context(), member.ID, sessionID); err != nil {
		http.Error(response, err.Error(), identityStatus(err))
		return
	}
	if current {
		clearSessionCookies(response, request)
		http.Redirect(response, request, "/login", http.StatusSeeOther)
		return
	}
	http.Redirect(response, request, "/sessions", http.StatusSeeOther)
}

func (i *Instance) revokeAllSessionsWeb(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := i.identity.RevokeAllSessions(request.Context(), member.ID); err != nil {
		http.Error(response, "unable to revoke Sessions", http.StatusInternalServerError)
		return
	}
	clearSessionCookies(response, request)
	http.Redirect(response, request, "/login", http.StatusSeeOther)
}

func (i *Instance) recoveryPage(response http.ResponseWriter, request *http.Request) {
	serveRecoveryPage(response, request.URL.Query().Get("token"))
}

func (i *Instance) recoverWeb(response http.ResponseWriter, request *http.Request) {
	if err := request.ParseForm(); err != nil {
		http.Error(response, "invalid request", http.StatusBadRequest)
		return
	}
	if err := i.identity.RedeemRecoveryToken(request.Context(), request.FormValue("token"), request.FormValue("password")); err != nil {
		http.Error(response, identity.ErrInvalidRecovery.Error(), identityStatus(err))
		return
	}
	http.Redirect(response, request, "/login", http.StatusSeeOther)
}

func (i *Instance) authenticated(response http.ResponseWriter, request *http.Request) (identity.Member, string, bool) {
	authentication, err := authenticationFromRequest(request)
	if err != nil {
		writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return identity.Member{}, "", false
	}
	member, err := i.identity.MemberForSession(request.Context(), authentication.token)
	if err != nil {
		writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return identity.Member{}, "", false
	}
	return member, authentication.token, true
}

func (i *Instance) authenticatedCSRF(response http.ResponseWriter, request *http.Request) (identity.Member, string, bool) {
	authentication, err := authenticationFromRequest(request)
	if err != nil {
		writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return identity.Member{}, "", false
	}
	member, err := i.identity.MemberForSession(request.Context(), authentication.token)
	if err != nil {
		writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return identity.Member{}, "", false
	}
	if !authentication.bearer && !i.requireCSRF(response, request) {
		return identity.Member{}, "", false
	}
	return member, authentication.token, true
}

type requestAuthentication struct {
	token  string
	bearer bool
}

func authenticationFromRequest(request *http.Request) (requestAuthentication, error) {
	authorization := strings.TrimSpace(request.Header.Get("Authorization"))
	if authorization != "" {
		parts := strings.Fields(authorization)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
			return requestAuthentication{}, identity.ErrInvalidCredentials
		}
		return requestAuthentication{token: parts[1], bearer: true}, nil
	}
	cookie, err := request.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return requestAuthentication{}, identity.ErrInvalidCredentials
	}
	return requestAuthentication{token: cookie.Value}, nil
}

func (i *Instance) requireCSRF(response http.ResponseWriter, request *http.Request) bool {
	session, sessionErr := request.Cookie(sessionCookieName)
	csrf, csrfErr := request.Cookie(csrfCookieName)
	provided := request.Header.Get("X-CSRF-Token")
	if provided == "" {
		if err := request.ParseForm(); err == nil {
			provided = request.FormValue("csrf_token")
		}
	}
	if sessionErr != nil || csrfErr != nil || provided == "" || provided != csrf.Value || !i.identity.VerifyCSRF(request.Context(), session.Value, provided) {
		writeJSON(response, http.StatusForbidden, map[string]string{"error": "CSRF validation failed"})
		return false
	}
	return true
}

func (i *Instance) isCurrentSession(ctx context.Context, memberID, token, sessionID string) bool {
	sessions, err := i.identity.ListSessions(ctx, memberID, token)
	if err != nil {
		return false
	}
	for _, session := range sessions {
		if session.ID == sessionID {
			return session.Current
		}
	}
	return false
}

func clearSessionCookies(response http.ResponseWriter, request *http.Request) {
	http.SetCookie(response, &http.Cookie{Name: sessionCookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: request.TLS != nil})
	http.SetCookie(response, &http.Cookie{Name: csrfCookieName, Value: "", Path: "/", MaxAge: -1, SameSite: http.SameSiteStrictMode, Secure: request.TLS != nil})
}

var sessionsTemplate = template.Must(template.New("sessions").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sessions — AllChat</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Member Settings</div><nav class="channel-nav settings-nav"><a href="/profile">My Account</a><a href="/sessions" aria-current="page">Sessions</a><a href="/search">Search</a><a href="/">Back to Community</a></nav></aside><main class="content-shell"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle aria-label="Open settings navigation" aria-expanded="false">☰</button><h1>Sessions</h1></header><section class="content"><h2 class="page-title">Devices</h2><p class="page-description">Review browsers signed into your Member account.</p><ul class="list">{{range .Sessions}}<li class="list-item"><span class="list-item-main"><strong>{{.Device}}</strong>{{if .Current}} <span class="badge badge-success">Current</span>{{end}}<br><span class="muted">Last active {{.LastActivity}}</span></span><form method="post" action="/sessions/{{.ID}}/revoke"><input type="hidden" name="csrf_token" value="{{$.CSRF}}"><button class="button-danger" data-confirm="Revoke this Session?">Revoke</button></form></li>{{end}}</ul><form class="card" method="post" action="/sessions/revoke-all"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><strong>Sign out everywhere</strong><p class="muted">This immediately revokes all Sessions, including this one.</p><button class="button-danger" data-confirm="Revoke every Session?">Revoke all Sessions</button></form></section></main></div></body></html>`))

var recoveryTemplate = template.Must(template.New("recovery").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recover account — AllChat</title><link rel="stylesheet" href="/assets/app.css"></head><body class="auth-layout"><main class="auth-card"><h1>Recover account</h1><p class="subtitle">Choose a new password for your AllChat Member account.</p><form method="post" action="/recover"><input type="hidden" name="token" value="{{.}}"><label>New password<input type="password" name="password" minlength="12" required autocomplete="new-password"></label><button>Replace password</button></form></main></body></html>`))

func serveRecoveryPage(response http.ResponseWriter, token string) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = recoveryTemplate.Execute(response, token)
}
