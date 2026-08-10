// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package music

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Room struct{ ID, Name string }
type IncomingMessage struct{ ID, ChannelID, ChannelType, AuthorID, Body string }

type Chat interface {
	RoomForMember(context.Context, string) (Room, bool, error)
	Publish(context.Context, string, string, string) error
}
type MediaSession interface {
	Connect(context.Context, string) error
	Leave()
	RoomID() string
}
type PlayerControl interface {
	Enqueue(context.Context, string, string) (Track, error)
	Status() PlayerStatus
	Pause() error
	Resume() error
	Seek(time.Duration) error
	Replay() error
	Skip(int) error
	Stop()
	SetVolume(int) error
	Queue() *Queue
}
type Searcher interface {
	Search(context.Context, string) ([]Track, error)
}

type Controller struct {
	prefix, memberID string
	chat             Chat
	media            MediaSession
	player           PlayerControl
	search           Searcher
	mu               sync.Mutex
	last             map[string]time.Time
	results          map[string][]Track
}

func NewController(prefix, memberID string, chat Chat, media MediaSession, player PlayerControl, search Searcher) *Controller {
	return &Controller{prefix: prefix, memberID: memberID, chat: chat, media: media, player: player, search: search, last: map[string]time.Time{}, results: map[string][]Track{}}
}

func (c *Controller) Handle(ctx context.Context, message IncomingMessage) {
	if message.ChannelType != "text" || message.AuthorID == c.memberID {
		return
	}
	command, matched, err := ParseCommand(message.Body, c.prefix)
	if !matched {
		return
	}
	if err != nil {
		c.reply(ctx, message, err.Error())
		return
	}
	c.mu.Lock()
	if since := time.Since(c.last[message.AuthorID]); since < time.Second {
		c.mu.Unlock()
		return
	}
	c.last[message.AuthorID] = time.Now()
	c.mu.Unlock()
	response, err := c.execute(ctx, message.AuthorID, command)
	if err != nil {
		response = "Music bot: " + err.Error()
	}
	if response != "" {
		c.reply(ctx, message, response)
	}
}

func (c *Controller) reply(ctx context.Context, message IncomingMessage, body string) {
	_ = c.chat.Publish(ctx, message.ChannelID, body, message.ID)
}

func (c *Controller) execute(ctx context.Context, memberID string, command Command) (string, error) {
	switch command.Name {
	case "help":
		return "Music commands: `!join`, `!play <URL|search|local:path|test:tone>`, `!search`, `!pause`, `!resume`, `!seek`, `!replay`, `!skip`, `!stop`, `!queue`, `!nowplaying`, `!remove`, `!move`, `!clear`, `!shuffle`, `!loop off|track|queue`, `!volume 0-200`, `!leave`", nil
	case "queue":
		return formatQueue(c.player.Status()), nil
	case "nowplaying":
		return formatNowPlaying(c.player.Status()), nil
	case "search":
		if c.search == nil || strings.TrimSpace(command.Argument) == "" {
			return "", fmt.Errorf("provide a search query")
		}
		tracks, err := c.search.Search(ctx, command.Argument)
		if err != nil {
			return "", err
		}
		c.mu.Lock()
		c.results[memberID] = tracks
		c.mu.Unlock()
		var lines []string
		for i, track := range tracks {
			lines = append(lines, fmt.Sprintf("%d. %s (%s)", i+1, track.Title, formatDuration(track.Duration)))
		}
		return "Search results (use `!play 1`):\n" + strings.Join(lines, "\n"), nil
	case "join":
		room, err := c.requireRoom(ctx, memberID, false)
		if err != nil {
			return "", err
		}
		if c.media.RoomID() == room.ID {
			return "Already in **" + room.Name + "**.", nil
		}
		if c.media.RoomID() != "" {
			c.media.Leave()
		}
		if err = c.media.Connect(ctx, room.ID); err != nil {
			return "", err
		}
		return "Joining **" + room.Name + "**.", nil
	case "leave":
		room, found, err := c.chat.RoomForMember(ctx, memberID)
		if err != nil {
			return "", err
		}
		if !found || c.media.RoomID() == "" || room.ID != c.media.RoomID() {
			return "", fmt.Errorf("join the same Voice Room as the music bot")
		}
		c.player.Stop()
		c.media.Leave()
		return "Left the Voice Room and cleared playback.", nil
	}
	if _, err := c.requireRoom(ctx, memberID, true); err != nil {
		return "", err
	}
	switch command.Name {
	case "play":
		source := strings.TrimSpace(command.Argument)
		if source == "" {
			return "", fmt.Errorf("provide a URL, search, local file, or `test:tone`")
		}
		if number, err := strconv.Atoi(source); err == nil {
			c.mu.Lock()
			choices := c.results[memberID]
			c.mu.Unlock()
			if number < 1 || number > len(choices) {
				return "", fmt.Errorf("search result is out of range")
			}
			source = choices[number-1].Source
		}
		track, err := c.player.Enqueue(ctx, source, memberID)
		if err != nil {
			return "", err
		}
		return "Queued **" + track.Title + "**.", nil
	case "pause":
		return ok("Paused.", c.player.Pause())
	case "resume":
		return ok("Resumed.", c.player.Resume())
	case "replay":
		return ok("Replaying.", c.player.Replay())
	case "seek":
		d, err := parsePosition(command.Argument)
		if err != nil {
			return "", err
		}
		return ok("Seeked to "+formatDuration(d)+".", c.player.Seek(d))
	case "skip":
		n := 1
		if command.Argument != "" {
			var err error
			n, err = strconv.Atoi(command.Argument)
			if err != nil {
				return "", fmt.Errorf("skip count must be a number")
			}
		}
		return ok("Skipped.", c.player.Skip(n))
	case "stop":
		c.player.Stop()
		return "Stopped and cleared the queue.", nil
	case "remove":
		n, err := strconv.Atoi(command.Argument)
		if err != nil {
			return "", fmt.Errorf("provide a queue position")
		}
		track, err := c.player.Queue().Remove(n)
		if err != nil {
			return "", err
		}
		return "Removed **" + track.Title + "**.", nil
	case "move":
		fields := strings.Fields(command.Argument)
		if len(fields) != 2 {
			return "", fmt.Errorf("use `move <from> <to>`")
		}
		from, e1 := strconv.Atoi(fields[0])
		to, e2 := strconv.Atoi(fields[1])
		if e1 != nil || e2 != nil {
			return "", fmt.Errorf("queue positions must be numbers")
		}
		return ok("Moved queue item.", c.player.Queue().Move(from, to))
	case "clear":
		c.player.Queue().Clear()
		return "Cleared the queue.", nil
	case "shuffle":
		c.player.Queue().Shuffle()
		return "Shuffled the queue.", nil
	case "loop":
		return ok("Loop mode: **"+command.Argument+"**.", c.player.Queue().SetLoop(LoopMode(strings.ToLower(command.Argument))))
	case "volume":
		n, err := strconv.Atoi(command.Argument)
		if err != nil {
			return "", fmt.Errorf("volume must be a number")
		}
		return ok(fmt.Sprintf("Volume: **%d%%**.", n), c.player.SetVolume(n))
	}
	return "", nil
}

func (c *Controller) requireRoom(ctx context.Context, memberID string, follow bool) (Room, error) {
	room, found, err := c.chat.RoomForMember(ctx, memberID)
	if err != nil {
		return Room{}, err
	}
	if !found {
		return Room{}, fmt.Errorf("join a Voice Room first")
	}
	active := c.media.RoomID()
	if active == "" && follow {
		if err = c.media.Connect(ctx, room.ID); err != nil {
			return Room{}, err
		}
		active = room.ID
	}
	if active != "" && active != room.ID {
		return Room{}, fmt.Errorf("join the same Voice Room as the music bot")
	}
	return room, nil
}
func ok(message string, err error) (string, error) {
	if err != nil {
		return "", err
	}
	return message, nil
}
func parsePosition(value string) (time.Duration, error) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) > 3 || value == "" {
		return 0, fmt.Errorf("use seconds or `mm:ss`")
	}
	var total int
	for _, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return 0, fmt.Errorf("invalid playback position")
		}
		total = total*60 + n
	}
	return time.Duration(total) * time.Second, nil
}
func formatDuration(value time.Duration) string {
	if value < 0 {
		value = 0
	}
	seconds := int(value.Seconds())
	return fmt.Sprintf("%d:%02d", seconds/60, seconds%60)
}
func formatNowPlaying(status PlayerStatus) string {
	if status.Current == nil {
		return "Nothing is playing."
	}
	state := ""
	if status.Paused {
		state = " (paused)"
	}
	return fmt.Sprintf("Now playing **%s** — %s / %s%s", status.Current.Title, formatDuration(status.Position), formatDuration(status.Current.Duration), state)
}
func formatQueue(status PlayerStatus) string {
	if len(status.Queue) == 0 {
		return formatNowPlaying(status) + " Queue is empty."
	}
	lines := []string{formatNowPlaying(status)}
	for i, t := range status.Queue {
		if i == 10 {
			lines = append(lines, fmt.Sprintf("…and %d more", len(status.Queue)-i))
			break
		}
		lines = append(lines, fmt.Sprintf("%d. %s (%s)", i+1, t.Title, formatDuration(t.Duration)))
	}
	return strings.Join(lines, "\n")
}
