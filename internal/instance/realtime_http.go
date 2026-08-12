// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"allchat/internal/community"
	"allchat/internal/identity"

	"github.com/coder/websocket"
)

const realtimePollInterval = 200 * time.Millisecond

type realtimeFrame struct {
	Type      string                      `json:"type"`
	Cursor    int64                       `json:"cursor"`
	ChannelID string                      `json:"channel_id,omitempty"`
	Payload   json.RawMessage             `json:"payload,omitempty"`
	Snapshot  *community.RealtimeSnapshot `json:"snapshot,omitempty"`
	Events    []community.RealtimeEvent   `json:"events,omitempty"`
}

type realtimeCommand struct {
	Type      string `json:"type"`
	ChannelID string `json:"channel_id,omitempty"`
	Active    bool   `json:"active,omitempty"`
}

func lightweightSnapshot(snapshot community.RealtimeSnapshot) community.RealtimeSnapshot {
	snapshot.Messages = map[string][]community.Message{}
	return snapshot
}

func (i *Instance) realtimeSnapshotAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	snapshot, err := i.community.RealtimeSnapshotMetadata(request.Context(), member)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, lightweightSnapshot(snapshot))
}

func (i *Instance) realtimeWebSocket(response http.ResponseWriter, request *http.Request) {
	member, sessionToken, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	oldest, latest, err := i.community.RealtimeBounds(request.Context())
	if err != nil {
		http.Error(response, "realtime unavailable", http.StatusServiceUnavailable)
		return
	}
	cursor := latest
	if rawCursor, supplied := request.URL.Query()["cursor"]; supplied {
		if len(rawCursor) != 1 {
			http.Error(response, "invalid realtime cursor", http.StatusBadRequest)
			return
		}
		cursor, err = strconv.ParseInt(rawCursor[0], 10, 64)
		if err != nil || cursor < 0 {
			http.Error(response, "invalid realtime cursor", http.StatusBadRequest)
			return
		}
	}

	connection, err := websocket.Accept(response, request, &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		return
	}
	defer connection.CloseNow()
	connection.SetReadLimit(4 << 10)
	connectionID := sessionToken + ":" + strconv.FormatInt(time.Now().UnixNano(), 10)
	i.live.connect(connectionID, member.ID, sessionToken, isMobileUserAgent(request.UserAgent()))
	defer i.live.disconnect(connectionID)

	// Capture the authorization baseline before announcing readiness. Once the
	// client observes ready it may immediately trigger a Permission change; if
	// the baseline were captured afterward, a visible-to-hidden transition in
	// that gap would never produce channel.removed.
	visible, err := i.visibleChannelIDs(request.Context(), member)
	if err != nil {
		_ = connection.Close(websocket.StatusInternalError, "authorization unavailable")
		return
	}

	if cursor > latest || (cursor > 0 && oldest > 0 && cursor < oldest-1) {
		snapshot, snapshotErr := i.community.RealtimeSnapshotMetadata(request.Context(), member)
		if snapshotErr != nil {
			_ = connection.Close(websocket.StatusInternalError, "snapshot unavailable")
			return
		}
		snapshot = lightweightSnapshot(snapshot)
		if !writeRealtimeFrame(request.Context(), connection, realtimeFrame{Type: "snapshot_required", Cursor: snapshot.Cursor, Snapshot: &snapshot}) {
			return
		}
		cursor = snapshot.Cursor
	} else if !writeRealtimeFrame(request.Context(), connection, realtimeFrame{Type: "ready", Cursor: cursor}) {
		return
	}

	readFailed := make(chan struct{}, 1)
	commands := make(chan realtimeCommand, 8)
	go func() {
		for {
			_, encoded, err := connection.Read(request.Context())
			if err != nil {
				readFailed <- struct{}{}
				return
			}
			var command realtimeCommand
			if json.Unmarshal(encoded, &command) == nil {
				switch command.Type {
				case "activity":
					i.live.activity(connectionID, command.Active)
					continue
				case "heartbeat":
					i.live.heartbeat(connectionID)
					continue
				case "disconnect":
					i.live.disconnectSession(sessionToken)
					continue
				}
				select {
				case commands <- command:
				default:
				}
			}
		}
	}()
	lastEphemeral := ""
	lastHeartbeat := time.Now()
	ticker := time.NewTicker(realtimePollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-request.Context().Done():
			return
		case <-readFailed:
			return
		case command := <-commands:
			switch command.Type {
			case "typing":
				if visible, _ := i.community.CanUseChannel(request.Context(), member.ID, command.ChannelID, community.PermissionSendMessages, false); visible {
					name := member.DisplayName
					if name == "" {
						name = member.Username
					}
					i.live.setTyping(member.ID, name, command.ChannelID)
				}
			}
		case <-ticker.C:
			if time.Since(lastHeartbeat) >= time.Second {
				if !writeRealtimeFrame(request.Context(), connection, realtimeFrame{Type: "heartbeat", Cursor: cursor}) {
					return
				}
				lastHeartbeat = time.Now()
			}
			currentMember, err := i.identity.MemberForSession(request.Context(), sessionToken)
			if err != nil {
				_ = connection.Close(websocket.StatusPolicyViolation, "Session expired")
				return
			}
			currentVisible, err := i.visibleChannelIDs(request.Context(), currentMember)
			if err != nil {
				return
			}
			for channelID := range visible {
				if !currentVisible[channelID] && !writeRealtimeFrame(request.Context(), connection, realtimeFrame{Type: "channel.removed", Cursor: cursor, ChannelID: channelID}) {
					return
				}
			}
			visible = currentVisible
			presence, typing := i.authorizedEphemeralState(request.Context(), currentMember)
			ephemeral, _ := json.Marshal(map[string]any{"presence": presence, "typing": typing})
			if string(ephemeral) != lastEphemeral {
				if !writeRealtimeFrame(request.Context(), connection, realtimeFrame{Type: "state.ephemeral", Cursor: cursor, Payload: ephemeral}) {
					return
				}
				lastEphemeral = string(ephemeral)
			}
			events, nextCursor, snapshotRequired, err := i.community.RealtimeEventsAfter(request.Context(), currentMember, cursor, 128)
			if err != nil {
				return
			}
			if snapshotRequired {
				snapshot, err := i.community.RealtimeSnapshotMetadata(request.Context(), currentMember)
				if err != nil {
					return
				}
				snapshot = lightweightSnapshot(snapshot)
				if !writeRealtimeFrame(request.Context(), connection, realtimeFrame{Type: "snapshot_required", Cursor: snapshot.Cursor, Snapshot: &snapshot}) {
					return
				}
				cursor = snapshot.Cursor
				continue
			}
			if len(events) > 0 && !writeRealtimeFrame(request.Context(), connection, realtimeFrame{Type: "events", Cursor: nextCursor, Events: events}) {
				return
			}
			if nextCursor > cursor {
				cursor = nextCursor
				if len(events) == 0 && !writeRealtimeFrame(request.Context(), connection, realtimeFrame{Type: "cursor", Cursor: cursor}) {
					return
				}
			}
		}
	}
}

func (i *Instance) authorizedEphemeralState(ctx context.Context, member identity.Member) (map[string]string, []typingState) {
	presence, typing := i.live.snapshot()
	for memberID, state := range presence {
		if mode, err := i.community.PresenceMode(ctx, memberID); err == nil && mode == "dnd" {
			presence[memberID] = "dnd"
		} else {
			presence[memberID] = state
		}
	}
	filtered := typing[:0]
	for _, item := range typing {
		visible, _ := i.community.CanUseChannel(ctx, member.ID, item.ChannelID, community.PermissionViewChannels, true)
		if visible && item.MemberID != member.ID {
			filtered = append(filtered, item)
		}
	}
	return presence, filtered
}

func (i *Instance) visibleChannelIDs(ctx context.Context, member identity.Member) (map[string]bool, error) {
	overview, err := i.community.ChannelOverview(ctx, member, false)
	if err != nil {
		return nil, err
	}
	visible := make(map[string]bool, len(overview.Channels))
	for _, channel := range overview.Channels {
		visible[channel.ID] = true
	}
	return visible, nil
}

func writeRealtimeFrame(parent context.Context, connection *websocket.Conn, frame realtimeFrame) bool {
	encoded, err := json.Marshal(frame)
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()
	return connection.Write(ctx, websocket.MessageText, encoded) == nil
}
