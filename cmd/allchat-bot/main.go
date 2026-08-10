// AllChat is free software under the GNU Affero General Public License v3.0 or later.
// Command allchat-bot drives a development-only Member against the public HTTP API.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"math/rand/v2"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type bot struct {
	baseURL             *url.URL
	client              *http.Client
	username            string
	password            string
	invite              string
	interval            time.Duration
	memberID            string
	dmCursors           map[string]int64
	spontaneousDMChance int
}

type channel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

type directMessage struct {
	ID          string `json:"id"`
	Other       member `json:"other"`
	BlockedByMe bool   `json:"blocked_by_me"`
	BlockedMe   bool   `json:"blocked_me"`
}

type member struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

type message struct {
	ID       string `json:"id"`
	AuthorID string `json:"author_id"`
	Sequence int64  `json:"sequence"`
	Body     string `json:"body"`
	Deleted  bool   `json:"deleted"`
}

func main() {
	base := flag.String("url", envOr("ALLCHAT_BOT_URL", "http://127.0.0.1:8080"), "AllChat Instance URL")
	username := flag.String("username", envOr("ALLCHAT_BOT_USERNAME", "allchat-bot"), "bot Member Username")
	password := flag.String("password", os.Getenv("ALLCHAT_BOT_PASSWORD"), "bot Member password (prefer ALLCHAT_BOT_PASSWORD)")
	invite := flag.String("invite", os.Getenv("ALLCHAT_BOT_INVITE"), "Invitation token used to register when login fails")
	interval := flag.Duration("interval", envDuration("ALLCHAT_BOT_INTERVAL", 3*time.Second), "delay between Messages")
	spontaneousDMChance := flag.Int("spontaneous-dm-chance", envInt("ALLCHAT_BOT_SPONTANEOUS_DM_CHANCE", 600), "one spontaneous DM attempt per this many public Message intervals (0 disables)")
	flag.Parse()
	if *password == "" {
		log.Fatal("ALLCHAT_BOT_PASSWORD or -password is required")
	}
	parsed, err := url.Parse(*base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		log.Fatalf("invalid Instance URL %q", *base)
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		log.Fatal(err)
	}
	b := &bot{baseURL: parsed, client: &http.Client{Jar: jar, Timeout: 15 * time.Second}, username: *username, password: *password, invite: *invite, interval: *interval, dmCursors: make(map[string]int64), spontaneousDMChance: *spontaneousDMChance}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := b.run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}

func (b *bot) run(ctx context.Context) error {
	if err := b.authenticate(ctx); err != nil {
		return err
	}
	if err := b.updateAvatar(ctx); err != nil {
		log.Printf("update bot avatar: %v", err)
	}
	channels, err := b.channels(ctx)
	if err != nil {
		return err
	}
	if err := b.pollDirectMessages(ctx, false); err != nil {
		log.Printf("initialize Direct Messages: %v", err)
	}
	log.Printf("development bot %q connected; posting to %d Text Channel(s) and answering Direct Messages", b.username, len(channels))
	ticker := time.NewTicker(b.interval)
	defer ticker.Stop()
	dmTicker := time.NewTicker(time.Second)
	defer dmTicker.Stop()
	iteration := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-dmTicker.C:
			if err := b.pollDirectMessages(ctx, true); err != nil {
				log.Printf("poll Direct Messages: %v", err)
			}
		case <-ticker.C:
			iteration++
			if len(channels) > 0 {
				selected := channels[rand.IntN(len(channels))]
				if err := b.publishRandomMessage(ctx, selected); err != nil {
					log.Printf("post Message: %v", err)
				}
			}
			if b.spontaneousDMChance > 0 && rand.IntN(b.spontaneousDMChance) == 0 {
				if err := b.sendSpontaneousDirectMessage(ctx); err != nil {
					log.Printf("send spontaneous Direct Message: %v", err)
				}
			}
			if iteration%5 == 0 {
				mode := []string{"available", "dnd"}[(iteration/5)%2]
				if err := b.putJSON(ctx, "/api/v1/presence-mode", map[string]string{"mode": mode}, nil); err != nil {
					log.Printf("change Presence: %v", err)
				} else {
					log.Printf("Presence changed to %s", mode)
				}
			}
			if iteration%8 == 0 {
				displayName := randomDisplayName()
				if err := b.patchJSON(ctx, "/api/v1/profile", map[string]string{"username": b.username, "display_name": displayName}, nil); err != nil {
					log.Printf("change Display Name: %v", err)
				} else {
					log.Printf("Display Name changed to %q", displayName)
				}
			}
		}
	}
}

func (b *bot) pollDirectMessages(ctx context.Context, reply bool) error {
	var list struct {
		DirectMessages []directMessage `json:"direct_messages"`
	}
	if err := b.getJSON(ctx, "/api/v1/dms", &list); err != nil {
		return err
	}
	for _, dm := range list.DirectMessages {
		if dm.BlockedByMe || dm.BlockedMe {
			continue
		}
		var history struct {
			Messages []message `json:"messages"`
		}
		if err := b.getJSON(ctx, "/api/v1/dms/"+url.PathEscape(dm.ID)+"/messages", &history); err != nil {
			return err
		}
		incoming, cursor, ok := newestIncoming(history.Messages, b.dmCursors[dm.ID], b.memberID)
		b.dmCursors[dm.ID] = cursor
		if !reply || !ok {
			continue
		}
		payload := map[string]any{"body": directReply(incoming.Body), "reply_to": incoming.ID}
		if err := b.postJSON(ctx, "/api/v1/dms/"+url.PathEscape(dm.ID)+"/messages", payload, nil); err != nil {
			log.Printf("reply to @%s: %v", dm.Other.Username, err)
			continue
		}
		log.Printf("replied to @%s in a Direct Message", dm.Other.Username)
	}
	return nil
}

func newestIncoming(messages []message, cursor int64, botMemberID string) (message, int64, bool) {
	var latest message
	previousCursor := cursor
	for _, item := range messages {
		if item.Sequence > cursor {
			cursor = item.Sequence
		}
		if item.Sequence > previousCursor && item.Sequence > latest.Sequence && item.AuthorID != botMemberID && !item.Deleted {
			latest = item
		}
	}
	if latest.Sequence <= 0 {
		return message{}, cursor, false
	}
	return latest, cursor, true
}

func (b *bot) sendSpontaneousDirectMessage(ctx context.Context) error {
	var list struct {
		Members []member `json:"members"`
	}
	if err := b.getJSON(ctx, "/api/v1/members", &list); err != nil {
		return err
	}
	candidates := make([]member, 0, len(list.Members))
	for _, candidate := range list.Members {
		if candidate.ID != b.memberID {
			candidates = append(candidates, candidate)
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	target := candidates[rand.IntN(len(candidates))]
	var dm directMessage
	if err := b.postJSON(ctx, "/api/v1/dms", map[string]string{"member_id": target.ID}, &dm); err != nil {
		return err
	}
	if err := b.postJSON(ctx, "/api/v1/dms/"+url.PathEscape(dm.ID)+"/messages", map[string]string{"body": spontaneousDirectMessage()}, nil); err != nil {
		return err
	}
	log.Printf("sent a spontaneous Direct Message to @%s", target.Username)
	return nil
}

func (b *bot) authenticate(ctx context.Context) error {
	var member struct {
		ID string `json:"id"`
	}
	err := b.postJSON(ctx, "/api/v1/auth/login", map[string]string{"username": b.username, "password": b.password}, &member)
	if err != nil && b.invite != "" {
		err = b.postJSON(ctx, "/api/v1/auth/register", map[string]string{"token": b.invite, "username": b.username, "password": b.password}, &member)
	}
	if err != nil {
		return fmt.Errorf("authenticate bot (provide a valid existing account or ALLCHAT_BOT_INVITE): %w", err)
	}
	b.memberID = member.ID
	return nil
}

func (b *bot) channels(ctx context.Context) ([]channel, error) {
	var overview struct {
		Channels []channel `json:"channels"`
	}
	if err := b.getJSON(ctx, "/api/v1/channels", &overview); err != nil {
		return nil, err
	}
	result := make([]channel, 0, len(overview.Channels))
	for _, item := range overview.Channels {
		if item.Type == "text" {
			result = append(result, item)
		}
	}
	return result, nil
}

func (b *bot) publishRandomMessage(ctx context.Context, target channel) error {
	payload := map[string]any{"body": randomMessage()}
	if rand.IntN(100) < 30 {
		attachmentID, err := b.uploadImage(ctx)
		if err != nil {
			return err
		}
		payload["attachment_ids"] = []string{attachmentID}
	}
	if err := b.postJSON(ctx, "/api/v1/channels/"+url.PathEscape(target.ID)+"/messages", payload, nil); err != nil {
		return err
	}
	log.Printf("posted a Message in #%s", target.Name)
	return nil
}

func (b *bot) uploadImage(ctx context.Context) (string, error) {
	var data bytes.Buffer
	if err := png.Encode(&data, randomImage()); err != nil {
		return "", err
	}
	request, err := b.request(ctx, http.MethodPost, "/api/v1/attachments", &data)
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "image/png")
	request.Header.Set("X-AllChat-Filename", fmt.Sprintf("bot-%d.png", time.Now().Unix()))
	b.addCSRF(request)
	var attachment struct {
		ID string `json:"id"`
	}
	if err := b.doJSON(request, &attachment); err != nil {
		return "", err
	}
	return attachment.ID, nil
}

func (b *bot) updateAvatar(ctx context.Context) error {
	var data bytes.Buffer
	if err := png.Encode(&data, randomImage()); err != nil {
		return err
	}
	request, err := b.request(ctx, http.MethodPut, "/api/v1/profile/avatar", &data)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "image/png")
	b.addCSRF(request)
	return b.doJSON(request, nil)
}

func randomImage() image.Image {
	const size = 320
	result := image.NewRGBA(image.Rect(0, 0, size, size))
	background := color.RGBA{R: uint8(rand.IntN(180) + 40), G: uint8(rand.IntN(180) + 40), B: uint8(rand.IntN(180) + 40), A: 255}
	accent := color.RGBA{R: uint8(rand.IntN(256)), G: uint8(rand.IntN(256)), B: uint8(rand.IntN(256)), A: 255}
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			if (x/32+y/32)%2 == 0 {
				result.Set(x, y, background)
			} else {
				result.Set(x, y, accent)
			}
		}
	}
	return result
}

func randomMessage() string {
	openers := []string{"Quick update", "Hello from the bot", "Community pulse", "Automated check-in", "A wild Message appeared"}
	details := []string{"everything looks lively.", "testing realtime delivery.", "here is some synthetic traffic.", "keeping the conversation moving.", "the embedded client is receiving this."}
	return openers[rand.IntN(len(openers))] + " — " + details[rand.IntN(len(details))]
}

func randomDisplayName() string {
	names := []string{"AllChat Bot", "Community Helper", "Realtime Robot", "Friendly Automaton", "Synthetic Member"}
	return names[rand.IntN(len(names))]
}

func directReply(body string) string {
	if strings.TrimSpace(body) == "" {
		return "I saw your attachment — the development bot is awake."
	}
	replies := []string{"Got it — the development bot received your DM.", "Hello! I am answering DMs now.", "Message received. The private realtime path is working."}
	return replies[rand.IntN(len(replies))]
}

func spontaneousDirectMessage() string {
	messages := []string{"Rare bot check-in: hope your testing is going well!", "A very occasional hello from the development bot.", "Tiny DM smoke test from your friendly synthetic Member."}
	return messages[rand.IntN(len(messages))]
}

func (b *bot) getJSON(ctx context.Context, path string, output any) error {
	request, err := b.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	return b.doJSON(request, output)
}

func (b *bot) postJSON(ctx context.Context, path string, input, output any) error {
	return b.sendJSON(ctx, http.MethodPost, path, input, output)
}

func (b *bot) putJSON(ctx context.Context, path string, input, output any) error {
	return b.sendJSON(ctx, http.MethodPut, path, input, output)
}

func (b *bot) patchJSON(ctx context.Context, path string, input, output any) error {
	return b.sendJSON(ctx, http.MethodPatch, path, input, output)
}

func (b *bot) sendJSON(ctx context.Context, method, path string, input, output any) error {
	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(input); err != nil {
		return err
	}
	request, err := b.request(ctx, method, path, &body)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	if method != http.MethodGet {
		b.addCSRF(request)
	}
	return b.doJSON(request, output)
}

func (b *bot) request(ctx context.Context, method, path string, body *bytes.Buffer) (*http.Request, error) {
	target := b.baseURL.ResolveReference(&url.URL{Path: path})
	if body == nil {
		return http.NewRequestWithContext(ctx, method, target.String(), nil)
	}
	return http.NewRequestWithContext(ctx, method, target.String(), body)
}

func (b *bot) addCSRF(request *http.Request) {
	for _, cookie := range b.client.Jar.Cookies(b.baseURL) {
		if cookie.Name == "allchat_csrf" {
			request.Header.Set("X-CSRF-Token", cookie.Value)
			return
		}
	}
}

func (b *bot) doJSON(request *http.Request, output any) error {
	response, err := b.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var problem struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(response.Body).Decode(&problem)
		if problem.Error == "" {
			problem.Error = response.Status
		}
		return fmt.Errorf("%s %s: %s", request.Method, request.URL.Path, problem.Error)
	}
	if output == nil || response.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(output)
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(os.Getenv(name))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func envInt(name string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value < 0 {
		return fallback
	}
	return value
}
