// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"net/http"

	"allchat/internal/community"
)

func (i *Instance) reportsAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	items, err := i.community.ListReports(r.Context(), m)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"reports": items})
}
func (i *Instance) createReportAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input struct {
		TargetMemberID  string `json:"target_member_id"`
		TargetMessageID string `json:"target_message_id"`
		Reason          string `json:"reason"`
	}
	if decodeJSON(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	item, err := i.community.CreateReport(r.Context(), m, input.TargetMemberID, input.TargetMessageID, input.Reason)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}
func (i *Instance) resolveReportAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input struct {
		Outcome string `json:"outcome"`
	}
	if decodeJSON(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	item, err := i.community.ResolveReport(r.Context(), m, r.PathValue("reportID"), input.Outcome)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 200, item)
}
func (i *Instance) moderationRecordsAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	items, err := i.community.ListModerationRecords(r.Context(), m)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"records": items})
}

func (i *Instance) moderationActionAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input community.ModerationAction
	if decodeJSON(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	record, err := i.community.ApplyModeration(r.Context(), m, input)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

func (i *Instance) purgeModerationRecordsAPI(w http.ResponseWriter, r *http.Request) {
	m, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input struct {
		Before string `json:"before"`
	}
	if decodeJSON(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	record, err := i.community.PurgeModerationRecords(r.Context(), m, input.Before)
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, record)
}
