// AllChat is free software under the GNU Affero General Public License v3.0 or later.
// Command allchat-voice-bot joins the first visible Voice Room and echoes Opus RTP.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/pion/interceptor"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

type channel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

type echoBot struct {
	baseURL                    *url.URL
	client                     *http.Client
	username, password, invite string
}

func main() {
	base := envOr("ALLCHAT_VOICE_BOT_URL", envOr("ALLCHAT_BOT_URL", "http://127.0.0.1:8080"))
	username := envOr("ALLCHAT_VOICE_BOT_USERNAME", "allchat-echo-bot")
	password := envOr("ALLCHAT_VOICE_BOT_PASSWORD", os.Getenv("ALLCHAT_BOT_PASSWORD"))
	invite := envOr("ALLCHAT_VOICE_BOT_INVITE", os.Getenv("ALLCHAT_BOT_INVITE"))
	if password == "" {
		log.Fatal("ALLCHAT_VOICE_BOT_PASSWORD (or ALLCHAT_BOT_PASSWORD) is required")
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		log.Fatalf("invalid Instance URL %q", base)
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		log.Fatal(err)
	}
	bot := &echoBot{baseURL: parsed, client: &http.Client{Jar: jar, Timeout: 15 * time.Second}, username: username, password: password, invite: invite}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := bot.run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}

func (b *echoBot) run(ctx context.Context) error {
	if err := b.authenticate(ctx); err != nil {
		return err
	}
	channels, err := b.channels(ctx)
	if err != nil {
		return err
	}
	target, ok := firstVoiceChannel(channels)
	if !ok {
		return fmt.Errorf("no visible Voice Channels; create one or grant the bot Connect Voice permission")
	}
	iceServers, err := b.iceServers(ctx)
	if err != nil {
		return err
	}
	mediaEngine := &webrtc.MediaEngine{}
	if err = mediaEngine.RegisterDefaultCodecs(); err != nil {
		return err
	}
	if err = mediaEngine.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: sdp.AudioLevelURI}, webrtc.RTPCodecTypeAudio); err != nil {
		return err
	}
	interceptors := &interceptor.Registry{}
	if err = webrtc.RegisterDefaultInterceptors(mediaEngine, interceptors); err != nil {
		return err
	}
	peer, err := webrtc.NewAPI(webrtc.WithMediaEngine(mediaEngine), webrtc.WithInterceptorRegistry(interceptors)).NewPeerConnection(webrtc.Configuration{ICEServers: iceServers})
	if err != nil {
		return err
	}
	defer peer.Close()
	echo, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2}, "echo", "allchat-echo-bot")
	if err != nil {
		return err
	}
	if _, err = peer.AddTrack(echo); err != nil {
		return err
	}
	var sourceMu sync.Mutex
	var activeSource string
	var activeAt time.Time
	peer.OnTrack(func(remote *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		if remote.Kind() != webrtc.RTPCodecTypeAudio {
			return
		}
		var audioLevelID uint8
		for _, extension := range receiver.GetParameters().HeaderExtensions {
			if extension.URI == sdp.AudioLevelURI {
				audioLevelID = uint8(extension.ID)
				break
			}
		}
		for {
			packet, _, readErr := remote.ReadRTP()
			if readErr != nil {
				return
			}
			if audioLevelID != 0 {
				level := packet.Header.GetExtension(audioLevelID)
				if len(level) == 0 || (level[0]&0x80 == 0 && level[0]&0x7f >= 50) {
					continue
				}
			}
			now := time.Now()
			sourceMu.Lock()
			if activeSource == "" || activeSource == remote.StreamID() || now.Sub(activeAt) > 500*time.Millisecond {
				activeSource = remote.StreamID()
				activeAt = now
				sourceMu.Unlock()
				if writeErr := echo.WriteRTP(packet); writeErr != nil {
					return
				}
				continue
			}
			sourceMu.Unlock()
		}
	})
	offer, err := peer.CreateOffer(nil)
	if err != nil {
		return err
	}
	gathered := webrtc.GatheringCompletePromise(peer)
	if err = peer.SetLocalDescription(offer); err != nil {
		return err
	}
	select {
	case <-gathered:
	case <-ctx.Done():
		return ctx.Err()
	}
	socket, err := b.dialMedia(ctx)
	if err != nil {
		return err
	}
	defer func() {
		leaveContext, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = writeSignal(leaveContext, socket, map[string]any{"version": 1, "type": "leave"})
		_ = socket.Close(websocket.StatusNormalClosure, "echo bot stopped")
	}()
	if err = writeSignal(ctx, socket, map[string]any{"version": 1, "type": "join", "room_id": target.ID, "sdp": peer.LocalDescription()}); err != nil {
		return err
	}
	log.Printf("voice echo bot %q joining %q; speak in the room to hear your audio returned", b.username, target.Name)
	for {
		_, payload, readErr := socket.Read(ctx)
		if readErr != nil {
			return readErr
		}
		var frame struct {
			Type  string                     `json:"type"`
			SDP   *webrtc.SessionDescription `json:"sdp"`
			Error string                     `json:"error"`
		}
		if json.Unmarshal(payload, &frame) != nil {
			continue
		}
		switch frame.Type {
		case "answer":
			if frame.SDP != nil && peer.RemoteDescription() == nil {
				if err = peer.SetRemoteDescription(*frame.SDP); err != nil {
					return err
				}
				log.Printf("voice echo bot connected to %q", target.Name)
			}
		case "offer":
			if frame.SDP == nil {
				continue
			}
			if err = peer.SetRemoteDescription(*frame.SDP); err != nil {
				return err
			}
			answer, answerErr := peer.CreateAnswer(nil)
			if answerErr != nil {
				return answerErr
			}
			answerGathered := webrtc.GatheringCompletePromise(peer)
			if err = peer.SetLocalDescription(answer); err != nil {
				return err
			}
			select {
			case <-answerGathered:
			case <-ctx.Done():
				return ctx.Err()
			}
			if err = writeSignal(ctx, socket, map[string]any{"version": 1, "type": "answer", "sdp": peer.LocalDescription()}); err != nil {
				return err
			}
		case "error":
			return fmt.Errorf("media server: %s", frame.Error)
		}
	}
}

func firstVoiceChannel(channels []channel) (channel, bool) {
	for _, item := range channels {
		if item.Type == "voice" {
			return item, true
		}
	}
	return channel{}, false
}

func (b *echoBot) authenticate(ctx context.Context) error {
	input := map[string]string{"username": b.username, "password": b.password}
	if err := b.sendJSON(ctx, http.MethodPost, "/api/v1/auth/login", input, nil); err == nil {
		return nil
	}
	if b.invite == "" {
		return fmt.Errorf("login failed and no ALLCHAT_VOICE_BOT_INVITE was provided")
	}
	input["token"] = b.invite
	if err := b.sendJSON(ctx, http.MethodPost, "/api/v1/auth/register", input, nil); err != nil {
		return fmt.Errorf("authenticate voice bot: %w", err)
	}
	return nil
}

func (b *echoBot) channels(ctx context.Context) ([]channel, error) {
	var overview struct {
		Channels []channel `json:"channels"`
	}
	if err := b.sendJSON(ctx, http.MethodGet, "/api/v1/channels", nil, &overview); err != nil {
		return nil, err
	}
	return overview.Channels, nil
}

func (b *echoBot) iceServers(ctx context.Context) ([]webrtc.ICEServer, error) {
	var body struct {
		IceServers []webrtc.ICEServer `json:"ice_servers"`
	}
	if err := b.sendJSON(ctx, http.MethodGet, "/api/v1/turn-credentials", nil, &body); err != nil {
		return nil, err
	}
	return body.IceServers, nil
}

func (b *echoBot) dialMedia(ctx context.Context) (*websocket.Conn, error) {
	target := *b.baseURL
	if target.Scheme == "https" {
		target.Scheme = "wss"
	} else {
		target.Scheme = "ws"
	}
	target.Path = "/api/v1/media"
	target.RawQuery = ""
	headers := http.Header{}
	for _, cookie := range b.client.Jar.Cookies(b.baseURL) {
		headers.Add("Cookie", cookie.String())
	}
	connection, response, err := websocket.Dial(ctx, target.String(), &websocket.DialOptions{HTTPHeader: headers})
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	return connection, err
}

func (b *echoBot) sendJSON(ctx context.Context, method, path string, input, output any) error {
	var body *bytes.Reader
	if input == nil {
		body = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	target := b.baseURL.ResolveReference(&url.URL{Path: path})
	request, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return err
	}
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := b.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("%s %s: %s", method, path, response.Status)
	}
	if output != nil {
		return json.NewDecoder(response.Body).Decode(output)
	}
	return nil
}

func writeSignal(ctx context.Context, socket *websocket.Conn, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return socket.Write(ctx, websocket.MessageText, payload)
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
