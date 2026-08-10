// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"net/http"

	"allchat/internal/media"
)

func (i *Instance) directCallAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	dm, err := i.community.DirectMessage(r.Context(), member, r.PathValue("dmID"))
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	if call, found := i.media.DirectCallForMember(dm.ID, member.ID); found {
		writeJSON(w, 200, call)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (i *Instance) startDirectCallAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	allowed, err := i.community.CanStartDirectCall(r.Context(), member, r.PathValue("dmID"))
	if err != nil || !allowed {
		writeCommunityError(w, communityError(err))
		return
	}
	dm, err := i.community.DirectMessage(r.Context(), member, r.PathValue("dmID"))
	if err != nil {
		writeCommunityError(w, err)
		return
	}
	call, err := i.media.StartDirectCall(dm.ID, member.ID, dm.Other.ID)
	if err != nil {
		writeMediaError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, call)
}
func (i *Instance) acceptDirectCallAPI(w http.ResponseWriter, r *http.Request) {
	i.directCallAction(w, r, "accept")
}
func (i *Instance) declineDirectCallAPI(w http.ResponseWriter, r *http.Request) {
	i.directCallAction(w, r, "decline")
}
func (i *Instance) endDirectCallAPI(w http.ResponseWriter, r *http.Request) {
	i.directCallAction(w, r, "end")
}
func (i *Instance) directCallAction(w http.ResponseWriter, r *http.Request, action string) {
	member, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	var item any
	var err error
	switch action {
	case "accept":
		item, err = i.media.AcceptDirectCall(r.PathValue("callID"), member.ID)
	case "decline":
		item, err = i.media.DeclineDirectCall(r.PathValue("callID"), member.ID)
	default:
		item, err = i.media.EndDirectCall(r.PathValue("callID"), member.ID)
	}
	if err != nil {
		writeMediaError(w, err)
		return
	}
	writeJSON(w, 200, item)
}
func writeMediaError(w http.ResponseWriter, err error) {
	status := http.StatusConflict
	if err == media.ErrCallState {
		status = http.StatusNotFound
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
func communityError(err error) error {
	if err != nil {
		return err
	}
	return media.ErrCallState
}
