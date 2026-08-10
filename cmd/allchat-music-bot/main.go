// AllChat is free software under the GNU Affero General Public License v3.0 or later.
// Command allchat-music-bot runs the optional local music and media-resilience bot.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	botclient "allchat/internal/bots/client"
	"allchat/internal/bots/media"
	"allchat/internal/bots/music"
)

type chatAdapter struct{ client *botclient.Client }

func (a chatAdapter) RoomForMember(ctx context.Context, member string) (music.Room, bool, error) {
	room, ok, err := a.client.RoomForMember(ctx, member)
	return music.Room{ID: room.ID, Name: room.Name}, ok, err
}
func (a chatAdapter) Publish(ctx context.Context, channel, body, reply string) error {
	return a.client.Publish(ctx, channel, body, reply)
}

type runtimeStatus struct {
	UpdatedAt time.Time          `json:"updated_at"`
	Media     media.Status       `json:"media"`
	Player    music.PlayerStatus `json:"player"`
}

func main() {
	baseURL := flag.String("url", env("ALLCHAT_MUSIC_BOT_URL", env("ALLCHAT_BOT_URL", "http://127.0.0.1:8080")), "AllChat Instance URL")
	username := flag.String("username", env("ALLCHAT_MUSIC_BOT_USERNAME", "allchat-music-bot"), "Member username")
	password := flag.String("password", env("ALLCHAT_MUSIC_BOT_PASSWORD", env("ALLCHAT_BOT_PASSWORD", "")), "Member password")
	invite := flag.String("invite", env("ALLCHAT_MUSIC_BOT_INVITE", env("ALLCHAT_BOT_INVITE", "")), "Invitation token for first registration")
	prefix := flag.String("prefix", env("ALLCHAT_MUSIC_BOT_PREFIX", "!"), "command prefix")
	dataDir := flag.String("data-dir", env("ALLCHAT_MUSIC_BOT_DATA_DIR", ".dev/music"), "music data directory")
	controlDir := flag.String("control-dir", env("ALLCHAT_MUSIC_BOT_CONTROL_DIR", ""), "local GUI control directory")
	maxQueue := flag.Int("max-queue", envInt("ALLCHAT_MUSIC_BOT_MAX_QUEUE", 200), "maximum queued tracks")
	idleTimeout := flag.Duration("idle-timeout", envDuration("ALLCHAT_MUSIC_BOT_IDLE_TIMEOUT", 5*time.Minute), "leave an idle Voice Room after this duration")
	flag.Parse()
	if *password == "" {
		log.Fatal("ALLCHAT_MUSIC_BOT_PASSWORD (or -password) is required")
	}
	for _, binary := range []string{"ffmpeg", "ffprobe", "yt-dlp"} {
		if _, err := exec.LookPath(binary); err != nil {
			log.Fatalf("required executable %s was not found in PATH", binary)
		}
	}
	for _, dir := range []string{*dataDir, filepath.Join(*dataDir, "library"), filepath.Join(*dataDir, "cache")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			log.Fatal(err)
		}
	}
	if *controlDir != "" {
		if err := os.MkdirAll(*controlDir, 0700); err != nil {
			log.Fatal(err)
		}
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	client, err := botclient.New(*baseURL)
	if err != nil {
		log.Fatal(err)
	}
	if err = client.Authenticate(ctx, *username, *password, *invite); err != nil {
		log.Fatal(err)
	}
	session := media.NewSession(client.Base, client.HTTP)
	resolver := music.NewResolver(*dataDir, nil)
	player := music.NewPlayer(ctx, resolver, session.Sink(), *maxQueue)
	controller := music.NewController(*prefix, client.Member.ID, chatAdapter{client}, session, player, resolver)
	channels, err := client.Channels(ctx)
	if err != nil {
		log.Fatal(err)
	}
	types := map[string]string{}
	for _, channel := range channels {
		types[channel.ID] = channel.Type
	}
	go controlLoop(ctx, *controlDir, session, player, func() {
		if session.RoomID() == "" {
			log.Print("test tone ignored: music bot is not in a Voice Room")
			return
		}
		if _, err := player.Enqueue(ctx, "test:tone", "local-control"); err != nil {
			log.Printf("enqueue test tone: %v", err)
		}
	})
	go idleLoop(ctx, *idleTimeout, session, player)
	log.Printf("music bot signed in as %s; prefix %q; library %s", client.Member.Username, *prefix, filepath.Join(*dataDir, "library"))
	err = client.StreamMessages(ctx, func(message botclient.Message) {
		controller.Handle(ctx, music.IncomingMessage{ID: message.ID, ChannelID: message.ChannelID, ChannelType: types[message.ChannelID], AuthorID: message.AuthorID, Body: message.Body})
	})
	session.Leave()
	if err != nil && ctx.Err() == nil {
		log.Fatal(err)
	}
}

func controlLoop(ctx context.Context, dir string, session *media.Session, player *music.Player, tone func()) {
	if dir == "" {
		return
	}
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for name, action := range map[string]func(){"drop-signaling": session.DropSignaling, "drop-peer": session.DropPeer, "enqueue-test-tone": tone} {
				path := filepath.Join(dir, name)
				if _, err := os.Stat(path); err == nil {
					_ = os.Remove(path)
					action()
				}
			}
			status := runtimeStatus{UpdatedAt: time.Now(), Media: session.Status(), Player: player.Status()}
			encoded, _ := json.MarshalIndent(status, "", "  ")
			temporary := filepath.Join(dir, "status.json.tmp")
			if os.WriteFile(temporary, encoded, 0600) == nil {
				_ = os.Rename(temporary, filepath.Join(dir, "status.json"))
			}
		}
	}
}
func idleLoop(ctx context.Context, timeout time.Duration, session *media.Session, player *music.Player) {
	if timeout <= 0 {
		return
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	idleSince := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			status := player.Status()
			if session.RoomID() == "" || status.Current != nil || len(status.Queue) > 0 {
				idleSince = time.Time{}
				continue
			}
			if idleSince.IsZero() {
				idleSince = time.Now()
				continue
			}
			if time.Since(idleSince) >= timeout {
				session.Leave()
				idleSince = time.Time{}
				log.Printf("left idle Voice Room after %s", timeout)
			}
		}
	}
}
func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
func envInt(name string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(name))
	if err == nil && value > 0 {
		return value
	}
	return fallback
}
func envDuration(name string, fallback time.Duration) time.Duration {
	if value, err := time.ParseDuration(os.Getenv(name)); err == nil && value > 0 {
		return value
	}
	return fallback
}
