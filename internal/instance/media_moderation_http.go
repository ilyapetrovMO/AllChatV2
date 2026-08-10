// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import "net/http"

func (i *Instance) muteMediaParticipantAPI(w http.ResponseWriter, r *http.Request) {
	i.moderateMediaParticipant(w, r, "mute")
}
func (i *Instance) unmuteMediaParticipantAPI(w http.ResponseWriter, r *http.Request) {
	i.moderateMediaParticipant(w, r, "unmute")
}
func (i *Instance) disconnectMediaParticipantAPI(w http.ResponseWriter, r *http.Request) {
	i.moderateMediaParticipant(w, r, "disconnect")
}
func (i *Instance) moderateMediaParticipant(w http.ResponseWriter, r *http.Request, action string) {
	actor, _, ok := i.authenticatedCSRF(w, r)
	if !ok {
		return
	}
	roomID, targetID := r.PathValue("roomID"), r.PathValue("memberID")
	if _, allowed := i.authorizedVoiceChannel(r, actor, roomID); !allowed {
		http.NotFound(w, r)
		return
	}
	if err := i.community.CanModerateMember(r.Context(), actor, targetID); err != nil {
		writeCommunityError(w, err)
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if decodeJSON(r, &input) != nil || input.Reason == "" {
		writeJSON(w, 400, map[string]string{"error": "reason is required"})
		return
	}
	if err := i.community.RecordModeration(r.Context(), actor, "media_"+action, targetID, input.Reason, "requested"); err != nil {
		writeJSON(w, 500, map[string]string{"error": "moderation record failed"})
		return
	}
	var err error
	switch action {
	case "mute":
		err = i.media.SetServerMuted(roomID, targetID, true)
	case "unmute":
		err = i.media.SetServerMuted(roomID, targetID, false)
	default:
		err = i.media.DisconnectMember(roomID, targetID)
	}
	if err != nil {
		_ = i.community.RecordModeration(r.Context(), actor, "media_"+action, targetID, input.Reason, "failed: "+err.Error())
		writeMediaError(w, err)
		return
	}
	_ = i.community.RecordModeration(r.Context(), actor, "media_"+action, targetID, input.Reason, "applied")
	w.WriteHeader(http.StatusNoContent)
}
