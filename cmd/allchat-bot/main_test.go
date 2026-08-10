// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package main

import (
	"bytes"
	"image/png"
	"testing"
)

func TestRandomImageProducesValidPNG(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, randomImage()); err != nil {
		t.Fatal(err)
	}
	decoded, err := png.Decode(bytes.NewReader(encoded.Bytes()))
	if err != nil {
		t.Fatalf("decode generated image: %v", err)
	}
	if decoded.Bounds().Dx() != 320 || decoded.Bounds().Dy() != 320 {
		t.Fatalf("generated image bounds = %v", decoded.Bounds())
	}
}

func TestRandomBotContentIsNonEmpty(t *testing.T) {
	if randomMessage() == "" || randomDisplayName() == "" || directReply("hello") == "" || spontaneousDirectMessage() == "" {
		t.Fatal("bot generated empty content")
	}
}

func TestChanceHonorsDisabledAndCertainBoundaries(t *testing.T) {
	for index := 0; index < 100; index++ {
		if chance(0) {
			t.Fatal("zero-percent chance fired")
		}
		if !chance(100) {
			t.Fatal("certain chance did not fire")
		}
	}
}

func TestNewestIncomingAdvancesCursorAndIgnoresBotMessages(t *testing.T) {
	messages := []message{
		{ID: "old", AuthorID: "member", Sequence: 2, Body: "old"},
		{ID: "bot", AuthorID: "bot", Sequence: 3, Body: "my reply"},
		{ID: "new", AuthorID: "member", Sequence: 4, Body: "new"},
		{ID: "deleted", AuthorID: "member", Sequence: 5, Deleted: true},
	}
	incoming, cursor, ok := newestIncoming(messages, 2, "bot")
	if !ok || incoming.ID != "new" || cursor != 5 {
		t.Fatalf("newest incoming = %+v, cursor = %d, ok = %v", incoming, cursor, ok)
	}
	if _, cursor, ok = newestIncoming(messages, cursor, "bot"); ok || cursor != 5 {
		t.Fatalf("unchanged poll cursor = %d, ok = %v", cursor, ok)
	}
}

func TestVoiceRequestRequiresAllThreeWholeWords(t *testing.T) {
	for _, input := range []string{"go into voice", "VOICE: go into it", "Could you go, please, into voice?"} {
		if !requestsVoice(input) {
			t.Fatalf("%q did not request voice", input)
		}
	}
	for _, input := range []string{"go voice", "going into voice", "go into voicemail"} {
		if requestsVoice(input) {
			t.Fatalf("%q unexpectedly requested voice", input)
		}
	}
}
