// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"errors"
	"html/template"
	"net/http"
	"strconv"
	"strings"

	"allchat/internal/community"
)

type ownershipTransferRequest struct {
	TargetMemberID string `json:"target_member_id"`
	Password       string `json:"password"`
	Confirmed      bool   `json:"confirmed"`
}

func (i *Instance) rolesAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	roles, err := i.community.ListRoles(request.Context(), member)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"roles": roles})
}

func (i *Instance) createRoleAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input community.RoleInput
	if err := decodeJSON(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	role, err := i.community.CreateRole(request.Context(), member, input)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, role)
}

func (i *Instance) updateRoleAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input community.RoleInput
	if err := decodeJSON(request, &input); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	role, err := i.community.UpdateRole(request.Context(), member, request.PathValue("roleID"), input)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, role)
}

func (i *Instance) retireRoleAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := i.community.RetireRole(request.Context(), member, request.PathValue("roleID")); err != nil {
		writeCommunityError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) assignRoleAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := i.community.AssignRole(request.Context(), member, request.PathValue("memberID"), request.PathValue("roleID")); err != nil {
		writeCommunityError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) transferOwnershipAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input ownershipTransferRequest
	if err := decodeJSON(request, &input); err != nil || !input.Confirmed || !i.identity.VerifyMemberPassword(request.Context(), member.ID, input.Password) {
		writeCommunityError(response, community.ErrInvalidTransfer)
		return
	}
	if err := i.community.TransferOwnership(request.Context(), member, input.TargetMemberID); err != nil {
		writeCommunityError(response, err)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) rolesPage(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	roles, err := i.community.ListRoles(request.Context(), member)
	if err != nil {
		http.Error(response, "unable to list Roles", communityStatus(err))
		return
	}
	csrf := csrfCookieValue(request)
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = rolesTemplate.Execute(response, map[string]any{"Roles": roles, "CSRF": csrf})
}

func (i *Instance) createRoleWeb(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	input, err := roleInputFromForm(request)
	if err == nil {
		_, err = i.community.CreateRole(request.Context(), member, input)
	}
	if err != nil {
		http.Error(response, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(response, request, "/admin/roles", http.StatusSeeOther)
}

func (i *Instance) updateRoleWeb(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	input, err := roleInputFromForm(request)
	if err == nil {
		_, err = i.community.UpdateRole(request.Context(), member, request.PathValue("roleID"), input)
	}
	if err != nil {
		http.Error(response, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(response, request, "/admin/roles", http.StatusSeeOther)
}

func (i *Instance) retireRoleWeb(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	if err := i.community.RetireRole(request.Context(), member, request.PathValue("roleID")); err != nil {
		http.Error(response, err.Error(), communityStatus(err))
		return
	}
	http.Redirect(response, request, "/admin/roles", http.StatusSeeOther)
}

func roleInputFromForm(request *http.Request) (community.RoleInput, error) {
	if err := request.ParseForm(); err != nil {
		return community.RoleInput{}, err
	}
	position, err := strconv.Atoi(request.FormValue("position"))
	if err != nil {
		return community.RoleInput{}, err
	}
	var permissions []string
	for _, value := range strings.Split(request.FormValue("permissions"), ",") {
		if value = strings.TrimSpace(value); value != "" {
			permissions = append(permissions, value)
		}
	}
	return community.RoleInput{Name: request.FormValue("name"), Position: position, Permissions: permissions}, nil
}

func writeCommunityError(response http.ResponseWriter, err error) {
	message := err.Error()
	if errors.Is(err, community.ErrForbidden) || errors.Is(err, community.ErrHierarchy) {
		message = "permission denied"
	}
	writeJSON(response, communityStatus(err), map[string]string{"error": message})
}

func communityStatus(err error) int {
	switch {
	case errors.Is(err, community.ErrForbidden), errors.Is(err, community.ErrHierarchy):
		return http.StatusForbidden
	case errors.Is(err, community.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, community.ErrInvalidRole), errors.Is(err, community.ErrInvalidTransfer):
		return http.StatusUnprocessableEntity
	case errors.Is(err, community.ErrInvalidInput):
		return http.StatusUnprocessableEntity
	case errors.Is(err, community.ErrImmutableRole):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

func csrfCookieValue(request *http.Request) string {
	cookie, _ := request.Cookie(csrfCookieName)
	if cookie == nil {
		return ""
	}
	return cookie.Value
}

var rolesTemplate = template.Must(template.New("roles").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Roles — AllChat</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Community Settings</div><nav class="channel-nav settings-nav"><a href="/admin/channels">Channels</a><a href="/admin/roles" aria-current="page">Roles</a><a href="/admin/invitations">Invitations</a><a href="/">Back to Community</a></nav></aside><main class="content-shell"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle aria-label="Open settings navigation" aria-expanded="false">☰</button><h1>Roles</h1></header><section class="content"><h2 class="page-title">Community Roles</h2><p class="page-description">Control hierarchy and named Permissions.</p><ul class="list">{{range .Roles}}<li class="list-item"><div class="list-item-main"><strong>{{.Name}}</strong> <span class="badge">Position {{.Position}}</span><p class="muted">{{range .Permissions}}{{.}} · {{end}}</p>{{if not .Default}}<form class="form-row" method="post" action="/admin/roles/{{.ID}}"><input type="hidden" name="csrf_token" value="{{$.CSRF}}"><label>Name<input name="name" value="{{.Name}}"></label><label>Position<input name="position" type="number" value="{{.Position}}"></label><label>Permissions<input name="permissions" value="{{range $i, $p := .Permissions}}{{if $i}},{{end}}{{$p}}{{end}}"></label><button>Save</button></form><form method="post" action="/admin/roles/{{.ID}}/retire"><input type="hidden" name="csrf_token" value="{{$.CSRF}}"><button class="button-danger" data-confirm="Retire this Role?">Retire</button></form>{{else}}<span class="badge">Built in</span>{{end}}</div></li>{{end}}</ul><form class="card" method="post" action="/admin/roles"><h3>Create Role</h3><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label>Name<input name="name" required></label><label>Position<input name="position" type="number" required></label><label>Permissions<input name="permissions" placeholder="view_channels,send_messages"></label><button>Create Role</button></form></section></main></div></body></html>`))
