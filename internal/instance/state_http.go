// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"net/http"
)

func (i *Instance) channelStatesAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	states, err := i.community.ChannelStates(request.Context(), member)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"channels": states})
}

func (i *Instance) updateReadPositionAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input struct {
		Sequence int64 `json:"sequence"`
	}
	if decodeJSON(request, &input) != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	state, err := i.community.UpdateReadPosition(request.Context(), member, request.PathValue("channelID"), input.Sequence)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, state)
}

func (i *Instance) updatePresenceModeAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input struct {
		Mode string `json:"mode"`
	}
	if decodeJSON(request, &input) != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if err := i.community.SetPresenceMode(request.Context(), member, input.Mode); err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"mode": input.Mode})
}

func (i *Instance) presenceAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	presence, typing := i.authorizedEphemeralState(request.Context(), member)
	writeJSON(response, http.StatusOK, map[string]any{"presence": presence, "typing": typing})
}
