// AllChat is free software under the GNU Affero General Public License v3.0 or later.
// Command allchat-voice-bot joins the first visible Voice Room and echoes Opus RTP.
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	"github.com/pion/webrtc/v4/pkg/media"
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
	shareScreen                bool
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
	bot := &echoBot{baseURL: parsed, client: &http.Client{Jar: jar, Timeout: 15 * time.Second}, username: username, password: password, invite: invite, shareScreen: envEnabled("ALLCHAT_VOICE_BOT_SCREEN", true)}
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
	if b.shareScreen {
		screen, screenErr := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000}, "screen", "allchat-echo-bot-screen")
		if screenErr != nil {
			return screenErr
		}
		if _, screenErr = peer.AddTrack(screen); screenErr != nil {
			return screenErr
		}
		frame, frameErr := dummyScreenFrame()
		if frameErr != nil {
			return frameErr
		}
		go publishDummyScreen(ctx, screen, frame)
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
	if b.shareScreen {
		log.Printf("voice echo bot is sharing its embedded SMPTE test image")
	}
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

func envEnabled(name string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

const dummyScreenIVF = "REtJRgAAIABWUDgwQAG0AAEAAAABAAAAAQAAAAAAAACnAgAAAAAAAAAAAACwJgCdASpAAbQAAAcIhYWIhYSIAgIC0MXF+Jfg9yldK+Afjf4Efrb/W98D+yXyCsD/gP4D/Jfwy/pPAA///0/7bF/Af6L/AeAB/gPWA/wH+Fev/1f+WS/0f4Znp/3X+kD/Vf8Ap23PUaRhlt308l+DGeX+HMZG6+sev/G8ndQHZlosBbZciM66FoZyIAZHz4swUL2kMaXz1j3c7dzVnLxLfmHZtpDGl89gwksSS9py8S35h3dYduxpaj63dzt3NWcvEt7Fsea2iEMTEJjdyIIv5PikfKUjOsZq+UpGesLVeGOpjOdS4o6N0tnlTWvWtFssUeQWw2d7tHuRfa1qJb1L5PGIQ3O8x4V41DRdWyIDa8CxwFBC9a1VU4flnZFmtxA2NTkRnUdTi1k7WxEMQxpa20T/LisvbGl89ZcyLs4A/v3xQAw3ceDi1ytQbMGOPoo1w6/RnBHPYRtGrqk+VT8Laafv4L28ETK+8OY1oOwOK7HYz1StFIYerWhUZ7GxTH0b+MzYZpiJtTJw9G4n7lvV88onxai60C+c74cQbOyR/mxWu8Di0NY547anYFb214wz5riR8sYsT2qCOGS0WJmfK0WM9tAClE8JSmUqTwpROSAKUBShLewwK2ms2gG8SQf5PKMAEqkH8wFgqtwMoFAANSChP/8fGjEgbzxuAeGXEFjtkAmzbwUmgv//noK19XYbOiXFCgxCoZeZnvkoBP6TN94U0huQNGniiYAAcE6iEAFYbf0FQKXH3gcU9KQ/jS3/0JheQVVnltuLRvvnV3+qQCXCH/wAduQCHvLK/ZIvs6MED0tNTJUAKeYpI9QACAP6rmB3HNLQKIhchmVAAWc/AAaCuNwfWrPahZ0hjMnABjv7QAABGYYeryEADFPHnAAAAAAAABlA"

func dummyScreenFrame() ([]byte, error) {
	ivf, err := base64.StdEncoding.DecodeString(dummyScreenIVF)
	if err != nil || len(ivf) < 44 || string(ivf[:4]) != "DKIF" || string(ivf[8:12]) != "VP80" {
		return nil, fmt.Errorf("decode embedded dummy screen")
	}
	size := int(binary.LittleEndian.Uint32(ivf[32:36]))
	if size < 1 || 44+size > len(ivf) {
		return nil, fmt.Errorf("embedded dummy screen frame is invalid")
	}
	return ivf[44 : 44+size], nil
}

func publishDummyScreen(ctx context.Context, track *webrtc.TrackLocalStaticSample, frame []byte) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := track.WriteSample(media.Sample{Data: frame, Duration: time.Second}); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
