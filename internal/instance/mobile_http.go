// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"net/http"

	"allchat/internal/community"
	"allchat/internal/identity"
)

type mobileBootstrapResponse struct {
	Version        int                            `json:"version"`
	Community      mobileCommunity                `json:"community"`
	Member         identity.Member                `json:"member"`
	Members        []identity.Member              `json:"members"`
	Categories     []community.Category           `json:"categories"`
	Channels       []community.Channel            `json:"channels"`
	DirectMessages []community.DirectMessage      `json:"direct_messages"`
	Messages       map[string][]community.Message `json:"messages"`
	ChannelStates  []community.ChannelState       `json:"channel_states"`
	Presence       map[string]string              `json:"presence"`
	Typing         []typingState                  `json:"typing"`
	Notifications  notificationSettingsView       `json:"notifications"`
	Media          mobileMediaConfig              `json:"media"`
	Cursor         int64                          `json:"cursor"`
}

type mobileCommunity struct {
	Name string `json:"name"`
}

type mobileMediaConfig struct {
	AudioBitrate  int `json:"audio_bitrate"`
	ScreenBitrate int `json:"screen_bitrate"`
}

func (i *Instance) mobileBootstrapAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	snapshot, err := i.community.RealtimeSnapshot(request.Context(), member)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	overview, err := i.community.ChannelOverview(request.Context(), member, false)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	states, err := i.community.ChannelStates(request.Context(), member)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	members, err := i.identity.ListMembers(request.Context())
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "Members unavailable"})
		return
	}
	notifications, err := i.notificationSettings(request.Context(), member.ID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "Notification settings unavailable"})
		return
	}
	presence, typing := i.authorizedEphemeralState(request.Context(), member)
	response.Header().Set("Cache-Control", "no-store")
	writeJSON(response, http.StatusOK, mobileBootstrapResponse{
		Version: 1, Community: mobileCommunity{Name: "AllChat Community"}, Member: member, Members: nonNilSlice(members),
		Categories: nonNilSlice(overview.Categories), Channels: nonNilSlice(overview.Channels), DirectMessages: nonNilSlice(snapshot.DirectMessages),
		Messages: snapshot.Messages, ChannelStates: nonNilSlice(states), Presence: presence, Typing: nonNilSlice(typing), Notifications: notifications,
		Media: mobileMediaConfig{AudioBitrate: i.config.MediaAudioBitrate, ScreenBitrate: i.config.MediaScreenBitrate}, Cursor: snapshot.Cursor,
	})
}

func nonNilSlice[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}
