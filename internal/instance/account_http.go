package instance

import "net/http"

func (i *Instance) exportAccountAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	data, err := i.community.ExportMemberData(r.Context(), member)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "unable to export Account"})
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="allchat-account-export.json"`)
	writeJSON(w, 200, data)
}
func (i *Instance) deleteAccountAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var input struct {
		Password     string `json:"password"`
		Confirmation string `json:"confirmation"`
	}
	if decodeJSON(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	if err := i.identity.AnonymizeMember(r.Context(), member, input.Password, input.Confirmation); err != nil {
		if member.Owner {
			writeJSON(w, 409, map[string]string{"error": err.Error()})
			return
		}
		writeIdentityError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
