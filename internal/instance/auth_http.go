// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"strings"
	"time"

	"allchat/internal/identity"
)

const sessionCookieName = "allchat_session"
const csrfCookieName = "allchat_csrf"

type credentials struct {
	Token    string `json:"token"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type nativeSessionResponse struct {
	Member       identity.Member `json:"member"`
	SessionToken string          `json:"session_token"`
	SessionID    string          `json:"session_id"`
	ExpiresAt    string          `json:"expires_at"`
}

func (i *Instance) setupAPI(response http.ResponseWriter, request *http.Request) {
	var input credentials
	if err := decodeJSON(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	member, session, err := i.identity.Bootstrap(request.Context(), input.Token, input.Username, input.Password, deviceLabel(request.UserAgent()))
	if err != nil {
		writeIdentityError(response, err)
		return
	}
	i.bootstrapToken = ""
	setSessionCookies(response, request, session)
	writeJSON(response, http.StatusCreated, member)
}

func (i *Instance) loginAPI(response http.ResponseWriter, request *http.Request) {
	var input credentials
	if err := decodeJSON(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	member, session, err := i.identity.Authenticate(request.Context(), input.Username, input.Password, sourceIP(request), deviceLabel(request.UserAgent()))
	if err != nil {
		writeIdentityError(response, err)
		return
	}
	setSessionCookies(response, request, session)
	writeJSON(response, http.StatusOK, member)
}

func (i *Instance) nativeLoginAPI(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	var input credentials
	if err := decodeJSON(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	member, session, err := i.identity.Authenticate(request.Context(), input.Username, input.Password, sourceIP(request), nativeDeviceLabel(request))
	if err != nil {
		writeIdentityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, nativeSession(member, session))
}

func nativeSession(member identity.Member, session identity.SessionCredentials) nativeSessionResponse {
	return nativeSessionResponse{Member: member, SessionToken: session.Token, SessionID: session.SessionID, ExpiresAt: session.ExpiresAt.UTC().Format(time.RFC3339Nano)}
}

func nativeDeviceLabel(request *http.Request) string {
	label := strings.TrimSpace(request.Header.Get("X-AllChat-Device"))
	if label == "" {
		label = "AllChat Android"
	}
	if len(label) > 100 {
		label = label[:100]
	}
	return label
}

func (i *Instance) logoutAPI(response http.ResponseWriter, request *http.Request) {
	_, sessionToken, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := i.identity.RevokeSession(request.Context(), sessionToken); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "unable to revoke Session"})
		return
	}
	clearSessionCookies(response, request)
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) sessionAPI(response http.ResponseWriter, request *http.Request) {
	member, err := i.currentMember(request)
	if err != nil {
		writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	writeJSON(response, http.StatusOK, member)
}

func (i *Instance) setupPage(response http.ResponseWriter, request *http.Request) {
	serveAuthPage(response, "Set up AllChat", "/setup", request.URL.Query().Get("token"), "Create Community Owner")
}

func (i *Instance) setupWeb(response http.ResponseWriter, request *http.Request) {
	if err := request.ParseForm(); err != nil {
		http.Error(response, "invalid request", http.StatusBadRequest)
		return
	}
	_, session, err := i.identity.Bootstrap(request.Context(), request.FormValue("token"), request.FormValue("username"), request.FormValue("password"), deviceLabel(request.UserAgent()))
	if err != nil {
		http.Error(response, err.Error(), identityStatus(err))
		return
	}
	i.bootstrapToken = ""
	setSessionCookies(response, request, session)
	http.Redirect(response, request, "/", http.StatusSeeOther)
}

func (i *Instance) loginPage(response http.ResponseWriter, _ *http.Request) {
	serveAuthPage(response, "Sign in to AllChat", "/login", "", "Sign in")
}

func (i *Instance) loginWeb(response http.ResponseWriter, request *http.Request) {
	if err := request.ParseForm(); err != nil {
		http.Error(response, "invalid request", http.StatusBadRequest)
		return
	}
	_, session, err := i.identity.Authenticate(request.Context(), request.FormValue("username"), request.FormValue("password"), sourceIP(request), deviceLabel(request.UserAgent()))
	if err != nil {
		http.Error(response, err.Error(), identityStatus(err))
		return
	}
	setSessionCookies(response, request, session)
	http.Redirect(response, request, "/", http.StatusSeeOther)
}

func (i *Instance) logoutWeb(response http.ResponseWriter, request *http.Request) {
	if !i.requireCSRF(response, request) {
		return
	}
	i.logout(response, request)
	http.Redirect(response, request, "/login", http.StatusSeeOther)
}

func (i *Instance) homePage(response http.ResponseWriter, request *http.Request) {
	if request.URL.Path != "/" {
		http.NotFound(response, request)
		return
	}
	member, err := i.currentMember(request)
	if err != nil {
		http.Redirect(response, request, "/login", http.StatusSeeOther)
		return
	}
	i.renderHome(response, request, member)
}

func (i *Instance) currentMember(request *http.Request) (identity.Member, error) {
	authentication, err := authenticationFromRequest(request)
	if err != nil {
		return identity.Member{}, identity.ErrInvalidCredentials
	}
	return i.identity.MemberForSession(request.Context(), authentication.token)
}

func (i *Instance) logout(response http.ResponseWriter, request *http.Request) {
	if cookie, err := request.Cookie(sessionCookieName); err == nil {
		_ = i.identity.RevokeSession(request.Context(), cookie.Value)
	}
	http.SetCookie(response, &http.Cookie{Name: sessionCookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: request.TLS != nil})
	http.SetCookie(response, &http.Cookie{Name: csrfCookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: false, SameSite: http.SameSiteStrictMode, Secure: request.TLS != nil})
}

func setSessionCookies(response http.ResponseWriter, request *http.Request, credentials identity.SessionCredentials) {
	http.SetCookie(response, &http.Cookie{
		Name: sessionCookieName, Value: credentials.Token, Path: "/", Expires: time.Now().Add(30 * 24 * time.Hour),
		HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: request.TLS != nil,
	})
	http.SetCookie(response, &http.Cookie{
		Name: csrfCookieName, Value: credentials.CSRFToken, Path: "/", Expires: time.Now().Add(30 * 24 * time.Hour),
		HttpOnly: false, SameSite: http.SameSiteStrictMode, Secure: request.TLS != nil,
	})
}

func decodeJSON(request *http.Request, destination any) error {
	request.Body = http.MaxBytesReader(nil, request.Body, 1<<20)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) == nil {
		return fmt.Errorf("multiple JSON values")
	}
	return nil
}

func writeIdentityError(response http.ResponseWriter, err error) {
	message := err.Error()
	if errors.Is(err, identity.ErrInvalidCredentials) {
		message = identity.ErrInvalidCredentials.Error()
	}
	writeJSON(response, identityStatus(err), map[string]string{"error": message})
}

func identityStatus(err error) int {
	switch {
	case errors.Is(err, identity.ErrRateLimited):
		return http.StatusTooManyRequests
	case errors.Is(err, identity.ErrInvalidCredentials):
		return http.StatusUnauthorized
	case errors.Is(err, identity.ErrInvalidSetup), errors.Is(err, identity.ErrAlreadySetup):
		return http.StatusConflict
	case errors.Is(err, identity.ErrInvalidInvitation):
		return http.StatusBadRequest
	case errors.Is(err, identity.ErrInvalidUsername), errors.Is(err, identity.ErrInvalidPassword):
		return http.StatusUnprocessableEntity
	case errors.Is(err, identity.ErrInvalidRecovery):
		return http.StatusBadRequest
	case errors.Is(err, identity.ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, identity.ErrSessionNotFound):
		return http.StatusNotFound
	default:
		return http.StatusInternalServerError
	}
}

func deviceLabel(userAgent string) string {
	for _, candidate := range []string{"Firefox", "Edg", "Chrome", "Safari"} {
		if strings.Contains(userAgent, candidate) {
			if candidate == "Edg" {
				return "Microsoft Edge"
			}
			return candidate
		}
	}
	userAgent = strings.TrimSpace(userAgent)
	if userAgent == "" {
		return "Unknown client"
	}
	if len(userAgent) > 100 {
		return userAgent[:100]
	}
	return userAgent
}

func isMobileUserAgent(userAgent string) bool {
	value := strings.ToLower(userAgent)
	for _, marker := range []string{"android", "iphone", "ipad", "ipod", "mobile"} {
		if strings.Contains(value, marker) {
			return true
		}
	}
	return false
}

func sourceIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil {
		return request.RemoteAddr
	}
	return host
}

var authPage = template.Must(template.New("auth").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}} — AllChat</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/htmx.min.js" defer></script></head>
<body class="auth-layout"><main class="auth-card"><h1>{{.Title}}</h1><p class="subtitle">Welcome to your AllChat Community</p><form method="post" action="{{.Action}}">
{{if .Token}}<input type="hidden" name="token" value="{{.Token}}">{{end}}
<label>Username <input name="username" required autocomplete="username"></label>
<label>Password <input type="password" name="password" required minlength="12" autocomplete="{{if .Token}}new-password{{else}}current-password{{end}}"></label>
<button type="submit">{{.Button}}</button></form></main></body></html>`))

func serveAuthPage(response http.ResponseWriter, title, action, token, button string) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = authPage.Execute(response, map[string]string{"Title": title, "Action": action, "Token": token, "Button": button})
}
