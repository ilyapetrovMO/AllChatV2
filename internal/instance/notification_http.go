// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"net/http"

	"allchat/internal/community"
)

func (i *Instance) notificationSettingsAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	rows, err := i.db.QueryContext(request.Context(), "SELECT channel_id FROM channel_notification_settings WHERE member_id = ? AND muted = 1", member.ID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "Notification settings unavailable"})
		return
	}
	defer rows.Close()
	muted := make([]string, 0)
	for rows.Next() {
		var channelID string
		if err := rows.Scan(&channelID); err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "Notification settings unavailable"})
			return
		}
		muted = append(muted, channelID)
	}
	writeJSON(response, http.StatusOK, map[string]any{"muted_channel_ids": muted})
}

func (i *Instance) setChannelMuteAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	channelID := request.PathValue("channelID")
	allowed, err := i.community.CanUseChannel(request.Context(), member.ID, channelID, community.PermissionViewChannels, false)
	if err != nil || !allowed {
		writeCommunityError(response, community.ErrForbidden)
		return
	}
	if request.Method == http.MethodPut {
		_, err = i.db.ExecContext(request.Context(), "INSERT INTO channel_notification_settings(member_id, channel_id, muted) VALUES (?, ?, 1) ON CONFLICT(member_id, channel_id) DO UPDATE SET muted = 1", member.ID, channelID)
	} else {
		_, err = i.db.ExecContext(request.Context(), "DELETE FROM channel_notification_settings WHERE member_id = ? AND channel_id = ?", member.ID, channelID)
	}
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "Could not update notification settings"})
		return
	}
	response.WriteHeader(http.StatusNoContent)
}
