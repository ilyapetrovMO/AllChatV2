// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"html/template"
	"net/http"
	"strings"
	"sync"
	"time"

	"allchat/internal/community"
	"allchat/internal/identity"
	"allchat/internal/media"

	"github.com/coder/websocket"
	"github.com/pion/webrtc/v4"
)

type mediaCommand struct {
	Version     int                       `json:"version"`
	Type        string                    `json:"type"`
	RoomID      string                    `json:"room_id,omitempty"`
	SDP         webrtc.SessionDescription `json:"sdp,omitempty"`
	ResumeToken string                    `json:"resume_token,omitempty"`
	Takeover    bool                      `json:"takeover,omitempty"`
	Visible     bool                      `json:"visible,omitempty"`
	OwnerID     string                    `json:"owner_id,omitempty"`
	Quality     string                    `json:"quality,omitempty"`
	Muted       bool                      `json:"muted,omitempty"`
	SoundID     string                    `json:"sound_id,omitempty"`
	Candidate   webrtc.ICECandidateInit   `json:"candidate,omitempty"`
}

type mediaFrame struct {
	Version      int                        `json:"version"`
	Type         string                     `json:"type"`
	SDP          any                        `json:"sdp,omitempty"`
	ResumeToken  string                     `json:"resume_token,omitempty"`
	Participants []media.Participant        `json:"participants,omitempty"`
	Error        string                     `json:"error,omitempty"`
	Code         string                     `json:"code,omitempty"`
	MemberID     string                     `json:"member_id,omitempty"`
	Sound        *community.SoundboardSound `json:"sound,omitempty"`
	Candidate    *webrtc.ICECandidateInit   `json:"candidate,omitempty"`
}

func (i *Instance) mediaWebSocket(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	defer connection.CloseNow()
	connection.SetReadLimit(64 << 10)
	var writeMu sync.Mutex
	write := func(frame mediaFrame) bool {
		writeMu.Lock()
		defer writeMu.Unlock()
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		return connection.Write(ctx, websocket.MessageText, mustJSON(frame)) == nil
	}
	_, encoded, err := connection.Read(r.Context())
	if err != nil {
		return
	}
	var command mediaCommand
	if json.Unmarshal(encoded, &command) != nil || command.Version != 1 || command.Type != "join" || command.RoomID == "" || command.SDP.Type != webrtc.SDPTypeOffer {
		write(mediaFrame{Version: 1, Type: "error", Error: "invalid versioned media join"})
		return
	}
	_, allowed := i.authorizedVoiceChannel(r, member, command.RoomID)
	mediaRoomID := command.RoomID
	directCall := false
	if !allowed && i.media.CanJoinDirectCall(command.RoomID, member.ID) {
		allowed = true
		directCall = true
		mediaRoomID = command.RoomID
	}
	if !allowed {
		_ = connection.Close(websocket.StatusPolicyViolation, "Voice Room unavailable")
		return
	}
	var answer webrtc.SessionDescription
	var token string
	var peerLease uint64
	forward := func(signal media.Signal) {
		frame := mediaFrame{Version: 1, Type: signal.Type, SDP: signal.SDP, MemberID: signal.MemberID, Candidate: signal.Candidate, Participants: signal.Participants}
		if signal.SoundID != "" {
			frame.Sound = &community.SoundboardSound{ID: signal.SoundID, Name: signal.SoundName, Emoji: signal.SoundEmoji, AudioURL: signal.SoundURL}
		}
		write(frame)
	}
	if command.ResumeToken != "" {
		answer, token, peerLease, err = i.media.ResumeOffer(member.ID, mediaRoomID, command.ResumeToken, command.SDP, forward)
	} else if command.Takeover {
		answer, token, peerLease, err = i.media.TakeoverOffer(member.ID, mediaRoomID, command.SDP, forward)
	} else {
		answer, token, peerLease, err = i.media.AcceptOffer(member.ID, mediaRoomID, command.SDP, forward)
	}
	if err != nil {
		code := "join_failed"
		if errors.Is(err, media.ErrInvalidResume) {
			code = "invalid_resume"
		} else if errors.Is(err, media.ErrAlreadyActive) {
			code = "already_active"
		} else if errors.Is(err, media.ErrModerated) {
			code = "moderated"
		}
		write(mediaFrame{Version: 1, Type: "error", Code: code, Error: err.Error()})
		return
	}
	explicitLeave := false
	defer func() {
		if explicitLeave {
			i.media.RemovePeerLease(member.ID, peerLease)
		} else {
			i.media.DisconnectPeer(member.ID, peerLease)
		}
	}()
	if !write(mediaFrame{Version: 1, Type: "answer", SDP: answer, ResumeToken: token, Participants: i.media.Participants(mediaRoomID)}) {
		return
	}
	i.media.Renegotiate(member.ID)
	i.media.BroadcastParticipants(mediaRoomID)
	for {
		_, encoded, err = connection.Read(r.Context())
		if err != nil {
			return
		}
		if json.Unmarshal(encoded, &command) != nil || command.Version != 1 {
			continue
		}
		switch command.Type {
		case "heartbeat":
			// Keep otherwise-idle media signaling connections alive through
			// proxies and NAT mappings. Media state is carried by WebRTC.
			write(mediaFrame{Version: 1, Type: "heartbeat-ack"})
		case "answer":
			_ = i.media.HandleAnswer(member.ID, command.SDP)
		case "candidate":
			_ = i.media.AddICECandidate(member.ID, command.Candidate)
		case "offer":
			if answer, offerErr := i.media.HandleOffer(member.ID, command.SDP); offerErr == nil {
				write(mediaFrame{Version: 1, Type: "answer", SDP: answer})
			}
		case "screen-visibility":
			_ = i.media.SetScreenVisible(member.ID, command.Visible)
		case "screen-quality":
			_ = i.media.SetScreenQuality(member.ID, command.OwnerID, command.Quality)
		case "video-stopped":
			_ = i.media.SetScreenPublishing(member.ID, false)
			i.media.Broadcast(mediaRoomID, media.Signal{Type: "video-stopped", MemberID: member.ID})
		case "video-started":
			_ = i.media.SetScreenPublishing(member.ID, true)
			i.media.Broadcast(mediaRoomID, media.Signal{Type: "video-started", MemberID: member.ID})
		case "mute-state":
			_ = i.media.SetClientMuted(member.ID, command.Muted)
		case "soundboard-play":
			sound, soundErr := i.community.SoundForPlayback(r.Context(), member, command.SoundID, mediaRoomID, directCall)
			if soundErr != nil {
				write(mediaFrame{Version: 1, Type: "error", Error: soundErr.Error()})
				continue
			}
			i.media.Broadcast(mediaRoomID, media.Signal{Type: "soundboard-played", MemberID: member.ID, SoundID: sound.ID, SoundName: sound.Name, SoundEmoji: sound.Emoji, SoundURL: sound.AudioURL})
		case "leave":
			explicitLeave = true
			return
		}
	}
}

func (i *Instance) endOwnMediaSessionAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	if err := i.media.End(member.ID, r.PathValue("roomID")); err != nil && !errors.Is(err, media.ErrNotPresent) {
		http.Error(w, "could not end Media Session", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (i *Instance) voiceParticipantsAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	channel, allowed := i.authorizedVoiceChannel(r, member, r.PathValue("channelID"))
	if !allowed {
		http.NotFound(w, r)
		return
	}
	names := map[string]string{}
	memberProfiles := map[string]identity.Member{}
	members, _ := i.identity.ListMembers(r.Context())
	for _, item := range members {
		name := item.DisplayName
		if name == "" {
			name = item.Username
		}
		names[item.ID] = name
		memberProfiles[item.ID] = item
	}
	writeJSON(w, 200, map[string]any{"participants": i.media.Participants(channel.ID), "names": names, "members": memberProfiles})
}

func (i *Instance) mediaConfigAPI(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := i.authenticated(w, r); !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"audio_bitrate": i.config.MediaAudioBitrate, "screen_bitrate": i.config.MediaScreenBitrate})
}

func (i *Instance) authorizedVoiceChannel(r *http.Request, member identity.Member, channelID string) (community.Channel, bool) {
	overview, err := i.community.ChannelOverview(r.Context(), member, false)
	if err != nil {
		return community.Channel{}, false
	}
	for _, channel := range overview.Channels {
		if channel.ID == channelID && channel.Type == "voice" {
			allowed, _ := i.community.CanUseChannel(r.Context(), member.ID, channelID, community.PermissionConnectVoice, false)
			return channel, allowed
		}
	}
	return community.Channel{}, false
}

func mustJSON(value any) []byte { encoded, _ := json.Marshal(value); return encoded }

func (i *Instance) renderVoiceRoom(w http.ResponseWriter, r *http.Request, member identity.Member, channel community.Channel, overview community.ChannelOverview) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	var page bytes.Buffer
	_ = voiceRoomTemplate.Execute(&page, map[string]any{"Member": member, "Channel": channel, "Overview": overview, "CSRF": csrfCookieValue(r)})
	communityName, _ := i.community.CommunityName(r.Context())
	_, _ = w.Write([]byte(strings.ReplaceAll(page.String(), "AllChat Community", template.HTMLEscapeString(communityName))))
}

var voiceRoomTemplate = template.Must(template.New("voice-room").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{.Channel.Name}} — AllChat Voice</title><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/channel.css"><script src="/assets/app.js" defer></script></head><body data-member-id="{{.Member.ID}}" data-channel-id="{{.Channel.ID}}"><div class="app-shell"><aside class="community-rail"><a class="community-mark dm-rail-mark" href="/dms">✦</a><span class="rail-separator"></span><a class="community-mark" href="/">AC</a></aside><aside class="channel-sidebar"><div class="community-header">AllChat Community</div><nav class="channel-nav">{{range .Overview.Categories}}<h2 class="channel-category">{{.Name}}</h2>{{end}}{{range .Overview.Channels}}<a class="channel-link {{if eq .Type "voice"}}voice-link{{end}}" href="/channels/{{.ID}}" {{if eq .ID $.Channel.ID}}aria-current="page"{{end}}>{{.Name}}</a>{{end}}</nav></aside><main class="content-shell media-stage-view" data-media-stage="{{.Channel.ID}}"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle>☰</button><span class="hash">🔊</span><h1>{{.Channel.Name}}</h1><span class="media-stage-status">Voice Room</span></header><section class="media-stage"><div class="media-stage-grid" data-media-stage-grid><p class="media-stage-empty">Join this Voice Room from the sidebar to see participants here.</p></div></section></main></div></body></html>`))
