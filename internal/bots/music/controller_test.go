// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package music

import (
	"context"
	"strings"
	"testing"
	"time"
)

type fakeChat struct {
	room Room
	sent []string
}

func (f *fakeChat) RoomForMember(context.Context, string) (Room, bool, error) {
	return f.room, f.room.ID != "", nil
}
func (f *fakeChat) Publish(_ context.Context, _, body, _ string) error {
	f.sent = append(f.sent, body)
	return nil
}

type fakeMedia struct {
	room     string
	connects int
}

func (f *fakeMedia) Connect(_ context.Context, room string) error {
	f.room = room
	f.connects++
	return nil
}
func (f *fakeMedia) Leave()         { f.room = "" }
func (f *fakeMedia) RoomID() string { return f.room }

type fakePlayer struct {
	status   PlayerStatus
	enqueued []string
}

func (f *fakePlayer) Enqueue(_ context.Context, source, _ string) (Track, error) {
	f.enqueued = append(f.enqueued, source)
	return Track{Title: source}, nil
}
func (f *fakePlayer) Status() PlayerStatus     { return f.status }
func (f *fakePlayer) Pause() error             { return nil }
func (f *fakePlayer) Resume() error            { return nil }
func (f *fakePlayer) Seek(time.Duration) error { return nil }
func (f *fakePlayer) Replay() error            { return nil }
func (f *fakePlayer) Skip(int) error           { return nil }
func (f *fakePlayer) Stop()                    {}
func (f *fakePlayer) SetVolume(int) error      { return nil }
func (f *fakePlayer) Queue() *Queue            { return NewQueue(10) }

func TestControllerFollowsRequesterWhenIdle(t *testing.T) {
	chat := &fakeChat{room: Room{ID: "voice-one", Name: "Music"}}
	media := &fakeMedia{}
	player := &fakePlayer{}
	c := NewController("!", "bot", chat, media, player, nil)
	c.Handle(context.Background(), IncomingMessage{ID: "m1", ChannelID: "text-one", ChannelType: "text", AuthorID: "member-one", Body: "!play test:tone"})
	if media.room != "voice-one" || media.connects != 1 || len(player.enqueued) != 1 {
		t.Fatalf("media=%+v enqueued=%v", media, player.enqueued)
	}
}

func TestControllerRejectsPlaybackControlFromAnotherRoom(t *testing.T) {
	chat := &fakeChat{room: Room{ID: "voice-two"}}
	media := &fakeMedia{room: "voice-one"}
	c := NewController("!", "bot", chat, media, &fakePlayer{}, nil)
	c.Handle(context.Background(), IncomingMessage{ID: "m2", ChannelID: "text-one", ChannelType: "text", AuthorID: "member-two", Body: "!pause"})
	if len(chat.sent) != 1 || !strings.Contains(chat.sent[0], "same Voice Room") {
		t.Fatalf("responses=%v", chat.sent)
	}
}

func TestControllerIgnoresDMsAndOwnMessages(t *testing.T) {
	chat := &fakeChat{}
	c := NewController("!", "bot", chat, &fakeMedia{}, &fakePlayer{}, nil)
	c.Handle(context.Background(), IncomingMessage{ChannelType: "dm", AuthorID: "member", Body: "!help"})
	c.Handle(context.Background(), IncomingMessage{ChannelType: "text", AuthorID: "bot", Body: "!help"})
	if len(chat.sent) != 0 {
		t.Fatalf("responses=%v", chat.sent)
	}
}
