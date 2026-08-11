// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"database/sql"
	"net/http"

	"allchat/internal/community"
)

type notificationSetting struct {
	Level        string `json:"level"`
	Muted        bool   `json:"muted"`
	SoundEnabled bool   `json:"sound_enabled"`
}

type channelNotificationSetting struct {
	Level string `json:"level"`
	Muted bool   `json:"muted"`
}

func validNotificationLevel(level string, allowDefault bool) bool {
	return level == "all_messages" || level == "mentions_only" || level == "nothing" || (allowDefault && level == "default")
}

func (i *Instance) notificationSettingsAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	communitySetting := notificationSetting{Level: "all_messages", SoundEnabled: true}
	err := i.db.QueryRowContext(request.Context(), "SELECT level, muted, sound_enabled FROM member_notification_settings WHERE member_id = ?", member.ID).Scan(&communitySetting.Level, &communitySetting.Muted, &communitySetting.SoundEnabled)
	if err != nil && err != sql.ErrNoRows {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "Notification settings unavailable"})
		return
	}
	rows, err := i.db.QueryContext(request.Context(), "SELECT channel_id, level, muted FROM channel_notification_settings WHERE member_id = ?", member.ID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "Notification settings unavailable"})
		return
	}
	defer rows.Close()
	channels, muted := map[string]channelNotificationSetting{}, make([]string, 0)
	for rows.Next() {
		var channelID string
		var setting channelNotificationSetting
		if err := rows.Scan(&channelID, &setting.Level, &setting.Muted); err != nil {
			writeJSON(response, 500, map[string]string{"error": "Notification settings unavailable"})
			return
		}
		channels[channelID] = setting
		if setting.Muted {
			muted = append(muted, channelID)
		}
	}
	writeJSON(response, http.StatusOK, map[string]any{"current_member_id": member.ID, "community": communitySetting, "channels": channels, "muted_channel_ids": muted})
}

func (i *Instance) updateNotificationSettingsAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input notificationSetting
	if decodeJSON(request, &input) != nil || !validNotificationLevel(input.Level, false) {
		writeJSON(response, 400, map[string]string{"error": "invalid notification settings"})
		return
	}
	_, err := i.db.ExecContext(request.Context(), `INSERT INTO member_notification_settings(member_id,level,muted,sound_enabled) VALUES(?,?,?,?)
		ON CONFLICT(member_id) DO UPDATE SET level=excluded.level, muted=excluded.muted, sound_enabled=excluded.sound_enabled`, member.ID, input.Level, input.Muted, input.SoundEnabled)
	if err != nil {
		writeJSON(response, 500, map[string]string{"error": "Could not update notification settings"})
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) updateChannelNotificationSettingsAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	channelID := request.PathValue("channelID")
	allowed, err := i.community.CanUseChannel(request.Context(), member.ID, channelID, community.PermissionViewChannels, true)
	if err != nil || !allowed {
		writeCommunityError(response, community.ErrForbidden)
		return
	}
	var input notificationSetting
	if decodeJSON(request, &input) != nil || !validNotificationLevel(input.Level, true) {
		writeJSON(response, 400, map[string]string{"error": "invalid notification settings"})
		return
	}
	_, err = i.db.ExecContext(request.Context(), `INSERT INTO channel_notification_settings(member_id,channel_id,muted,level) VALUES(?,?,?,?)
		ON CONFLICT(member_id,channel_id) DO UPDATE SET muted=excluded.muted, level=excluded.level`, member.ID, channelID, input.Muted, input.Level)
	if err != nil {
		writeJSON(response, 500, map[string]string{"error": "Could not update notification settings"})
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) setChannelMuteAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	channelID := request.PathValue("channelID")
	allowed, err := i.community.CanUseChannel(request.Context(), member.ID, channelID, community.PermissionViewChannels, true)
	if err != nil || !allowed {
		writeCommunityError(response, community.ErrForbidden)
		return
	}
	muted := request.Method == http.MethodPut
	_, err = i.db.ExecContext(request.Context(), `INSERT INTO channel_notification_settings(member_id,channel_id,muted,level) VALUES(?,?,?,'default')
		ON CONFLICT(member_id,channel_id) DO UPDATE SET muted=excluded.muted`, member.ID, channelID, muted)
	if err != nil {
		writeJSON(response, 500, map[string]string{"error": "Could not update notification settings"})
		return
	}
	response.WriteHeader(http.StatusNoContent)
}
