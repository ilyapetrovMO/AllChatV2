// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"context"
	"encoding/json"
	"errors"
	"html/template"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"allchat/internal/activities"
	"github.com/coder/websocket"
)

func activityMemberName(displayName, username string) string {
	if displayName != "" {
		return displayName
	}
	return username
}

func (i *Instance) activitiesAPI(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := i.authenticated(w, r); !ok {
		return
	}
	items, err := i.activities.Installations(r.Context())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "Activities unavailable"})
		return
	}
	writeJSON(w, 200, map[string]any{"activities": items})
}

func (i *Instance) setActivityEnabledAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		writeJSON(w, 403, map[string]string{"error": "Community Owner required"})
		return
	}
	var input struct {
		Enabled bool `json:"enabled"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	if err := i.activities.SetEnabled(r.Context(), r.PathValue("activityID"), input.Enabled); err != nil {
		writeActivityError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"enabled": input.Enabled})
}

func (i *Instance) installActivityAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		writeJSON(w, 403, map[string]string{"error": "Community Owner required"})
		return
	}
	bundle, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 10<<20))
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "Activity package exceeds 10 MiB"})
		return
	}
	installation, err := i.activities.InstallBundle(r.Context(), bundle)
	if err != nil {
		writeActivityError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, installation)
}

func (i *Instance) launchActivityAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input struct {
		ResourceID string `json:"resource_id"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input)
	}
	token, session, err := i.activities.Launch(r.Context(), r.PathValue("activityID"), member.ID, activityMemberName(member.DisplayName, member.Username), input.ResourceID)
	if err != nil {
		writeActivityError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"token": token, "session_id": session.ID, "activity_id": session.ActivityID, "resource_id": session.ResourceID, "expires_at": session.ExpiresAt.Format(time.RFC3339Nano), "runtime_url": "/activity-runtime/" + session.ActivityID + "/"})
}

func activityToken(r *http.Request) string {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) == 2 && strings.EqualFold(parts[0], "Activity") {
		return parts[1]
	}
	return ""
}
func (i *Instance) activitySession(w http.ResponseWriter, r *http.Request) (activities.Session, bool) {
	session, err := i.activities.Authenticate(r.Context(), activityToken(r))
	if err != nil {
		writeActivityError(w, err)
		return activities.Session{}, false
	}
	return session, true
}

func (i *Instance) activitySessionAPI(w http.ResponseWriter, r *http.Request) {
	if activityCORS(w, r) {
		return
	}
	session, ok := i.activitySession(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"activity_id": session.ActivityID,
		"member": map[string]string{"id": session.MemberID, "name": session.MemberName},
		"resource_id": session.ResourceID,
		"expires_at":  session.ExpiresAt.Format(time.RFC3339Nano),
		"host_api":    1,
	})
}

func (i *Instance) sketchboardsAPI(w http.ResponseWriter, r *http.Request) {
	if activityCORS(w, r) {
		return
	}
	session, ok := i.activitySession(w, r)
	if !ok {
		return
	}
	if session.ActivityID != activities.SketchboardID {
		writeJSON(w, 403, map[string]string{"error": "Activity scope mismatch"})
		return
	}
	if r.Method == http.MethodGet {
		boards, err := i.activities.Boards(r.Context(), session.MemberID)
		if err != nil {
			writeActivityError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"boards": boards})
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	board, err := i.activities.CreateBoard(r.Context(), session.MemberID, input.Name)
	if err != nil {
		writeActivityError(w, err)
		return
	}
	writeJSON(w, 201, board)
}

func (i *Instance) sketchboardAPI(w http.ResponseWriter, r *http.Request) {
	if activityCORS(w, r) {
		return
	}
	session, ok := i.activitySession(w, r)
	if !ok {
		return
	}
	boardID := r.PathValue("boardID")
	switch r.Method {
	case http.MethodGet:
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		state, err := i.activities.BoardState(r.Context(), session.MemberID, boardID, after)
		if err != nil {
			writeActivityError(w, err)
			return
		}
		writeJSON(w, 200, state)
	case http.MethodDelete:
		if err := i.activities.DeleteBoard(r.Context(), session.MemberID, boardID); err != nil {
			writeActivityError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type sketchboardFrame struct {
	Type    string          `json:"type"`
	Token   string          `json:"token,omitempty"`
	BoardID string          `json:"board_id,omitempty"`
	After   int64           `json:"after,omitempty"`
	Kind    string          `json:"kind,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

func (i *Instance) sketchboardRealtime(w http.ResponseWriter, r *http.Request) {
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{CompressionMode: websocket.CompressionDisabled, InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer connection.CloseNow()
	connection.SetReadLimit(70 << 10)
	_, encoded, err := connection.Read(r.Context())
	if err != nil {
		return
	}
	var hello sketchboardFrame
	if json.Unmarshal(encoded, &hello) != nil || hello.Type != "authenticate" || hello.BoardID == "" {
		_ = connection.Close(websocket.StatusPolicyViolation, "authentication required")
		return
	}
	session, err := i.activities.Authenticate(r.Context(), hello.Token)
	if err != nil || session.ActivityID != activities.SketchboardID {
		_ = connection.Close(websocket.StatusPolicyViolation, "invalid Activity Session")
		return
	}
	if _, err := i.activities.BoardState(r.Context(), session.MemberID, hello.BoardID, hello.After); err != nil {
		_ = connection.Close(websocket.StatusPolicyViolation, "board unavailable")
		return
	}
	i.activities.Touch(hello.BoardID, activities.Participant{MemberID: session.MemberID, Name: session.MemberName})
	defer i.activities.Leave(hello.BoardID, session.MemberID)
	frames := make(chan sketchboardFrame, 16)
	failed := make(chan struct{}, 1)
	go func() {
		for {
			_, payload, readErr := connection.Read(r.Context())
			if readErr != nil {
				failed <- struct{}{}
				return
			}
			var frame sketchboardFrame
			if json.Unmarshal(payload, &frame) == nil {
				select {
				case frames <- frame:
				default:
				}
			}
		}
	}()
	after := hello.After
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	write := func(value any) bool {
		ctx, cancel := contextWithTimeout(r, 5*time.Second)
		defer cancel()
		return connection.Write(ctx, websocket.MessageText, activityJSON(value)) == nil
	}
	if !write(map[string]any{"type": "ready", "member_id": session.MemberID}) {
		return
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case <-failed:
			return
		case frame := <-frames:
			if frame.Type == "operation" {
				_, appendErr := i.activities.AppendOperation(r.Context(), session.MemberID, hello.BoardID, frame.Kind, frame.Payload)
				if appendErr != nil {
					if !write(map[string]any{"type": "error", "error": appendErr.Error()}) {
						return
					}
				}
			}
			if frame.Type == "heartbeat" {
				i.activities.Touch(hello.BoardID, activities.Participant{MemberID: session.MemberID, Name: session.MemberName})
			}
		case <-ticker.C:
			i.activities.Touch(hello.BoardID, activities.Participant{MemberID: session.MemberID, Name: session.MemberName})
			state, stateErr := i.activities.BoardState(r.Context(), session.MemberID, hello.BoardID, after)
			if stateErr != nil {
				_ = connection.Close(websocket.StatusNormalClosure, "board deleted")
				return
			}
			if len(state.Operations) > 0 {
				after = state.Operations[len(state.Operations)-1].Sequence
			}
			if !write(map[string]any{"type": "state", "sequence": state.Sequence, "operations": state.Operations, "participants": state.Board.Participants}) {
				return
			}
		}
	}
}

func contextWithTimeout(r *http.Request, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), d)
}
func activityJSON(value any) []byte { encoded, _ := json.Marshal(value); return encoded }
func activityCORS(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Access-Control-Allow-Origin", "null")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

func writeActivityError(w http.ResponseWriter, err error) {
	status := 500
	if errors.Is(err, activities.ErrInvalid) {
		status = 400
	} else if errors.Is(err, activities.ErrForbidden) {
		status = 403
	} else if errors.Is(err, activities.ErrNotFound) {
		status = 404
	} else if errors.Is(err, activities.ErrDisabled) {
		status = 409
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (i *Instance) activitiesPage(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	items, err := i.activities.Installations(r.Context())
	if err != nil {
		http.Error(w, "Activities unavailable", 500)
		return
	}
	_ = activitiesTemplate.Execute(w, map[string]any{"Member": member, "Activities": items, "CSRF": csrfCookieValue(r)})
}
func (i *Instance) activitiesAdminPage(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		http.Error(w, "Community Owner required", http.StatusForbidden)
		return
	}
	items, err := i.activities.Installations(r.Context())
	if err != nil {
		http.Error(w, "Activities unavailable", 500)
		return
	}
	_ = activitiesAdminTemplate.Execute(w, map[string]any{"Activities": items, "CSRF": csrfCookieValue(r)})
}
func (i *Instance) setActivityEnabledWeb(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	if !member.Owner {
		http.Error(w, "Community Owner required", 403)
		return
	}
	enabled := r.FormValue("enabled") == "true"
	if err := i.activities.SetEnabled(r.Context(), r.PathValue("activityID"), enabled); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	http.Redirect(w, r, "/admin/activities", http.StatusSeeOther)
}
func (i *Instance) activityHostPage(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	activityID := r.PathValue("activityID")
	token, session, err := i.activities.Launch(r.Context(), activityID, member.ID, activityMemberName(member.DisplayName, member.Username), "")
	if err != nil {
		http.Error(w, err.Error(), 409)
		return
	}
	_ = activityHostTemplate.Execute(w, map[string]any{"Token": token, "ActivityID": session.ActivityID})
}
func (i *Instance) activityRuntime(w http.ResponseWriter, r *http.Request) {
	activityID := r.PathValue("activityID")
	name := r.PathValue("path")
	var source []byte
	var err error
	if activityID == activities.SketchboardID {
		if name != "" && name != "index.html" {
			http.NotFound(w, r)
			return
		}
		source, err = embeddedWeb.ReadFile("web/activities/sketchboard/index.html")
		name = "index.html"
	} else {
		source, name, err = i.activities.RuntimeFile(r.Context(), activityID, name)
	}
	if err != nil {
		writeActivityError(w, err)
		return
	}
	contentType := mime.TypeByExtension(filepath.Ext(name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(source)
}

var activitiesTemplate = template.Must(template.New("activities").Parse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activities — AllChat</title><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/activities.css"><script src="/assets/app.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Activities</div><nav class="channel-nav settings-nav"><a href="/activities" aria-current="page">Activities</a><a href="/">Back to Community</a></nav></aside><main class="content-shell"><header class="content-header"><h1>Activities</h1></header><section class="content"><h2 class="page-title">Community Activities</h2><p class="page-description">Open an Activity to create or join a shared experience.</p><div class="activity-catalog">{{range .Activities}}<article class="card"><div class="activity-icon">✎</div><div><h3>{{.Manifest.Name}}</h3><p>{{.Manifest.Description}}</p><small>By {{.Manifest.Developer}} · {{.Manifest.Version}}</small></div>{{if .Enabled}}<a class="button" href="/activities/{{.Manifest.ID}}">Open</a>{{else}}<span class="badge">Disabled</span>{{end}}</article>{{end}}</div></section></main></div></body></html>`))
var activitiesAdminTemplate = template.Must(template.New("activities-admin").Parse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activities — Community Settings</title><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/activities.css"><script src="/assets/app.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Community Settings</div><nav class="channel-nav settings-nav"><a href="/admin/settings">General</a><a href="/admin/activities" aria-current="page">Activities</a></nav></aside><main class="content-shell"><header class="content-header"><h1>Activities</h1></header><section class="content"><h2 class="page-title">Installed Activities</h2><p class="page-description">Review capabilities and control which Activities Members may launch.</p><form class="card activity-package-form" data-activity-package><input type="hidden" name="csrf_token" value="{{.CSRF}}"><label>Install Activity package<input type="file" name="package" accept=".zip,application/zip" required></label><button>Install disabled</button><span role="status"></span></form><div class="activity-catalog">{{range .Activities}}<article class="card"><div class="activity-icon">✎</div><div><h3>{{.Manifest.Name}}</h3><p>{{.Manifest.Description}}</p><small>By {{.Manifest.Developer}} · {{.Manifest.Version}} · Capabilities: {{range .Manifest.Capabilities}}{{.}} {{end}}</small></div><form method="post" action="/admin/activities/{{.Manifest.ID}}"><input type="hidden" name="csrf_token" value="{{$.CSRF}}"><input type="hidden" name="enabled" value="{{if .Enabled}}false{{else}}true{{end}}"><button {{if .Enabled}}class="button-danger"{{end}}>{{if .Enabled}}Disable{{else}}Enable{{end}}</button></form></article>{{end}}</div></section></main></div></body></html>`))
var activityHostTemplate = template.Must(template.New("activity-host").Parse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity — AllChat</title><link rel="stylesheet" href="/assets/activities.css"></head><body class="activity-host"><header><a href="/activities">← Activities</a><strong>Activity</strong></header><iframe title="AllChat Activity" sandbox="allow-scripts" src="/activity-runtime/{{.ActivityID}}/#{{.Token}}"></iframe></body></html>`))
