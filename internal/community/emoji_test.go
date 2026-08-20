package community

import "testing"

func TestValidEmojiAcceptsUnicodeEmojiSequences(t *testing.T) {
	for _, emoji := range []string{
		"🇺🇦", "1️⃣", "↔️", "👩🏽‍💻", "👨‍👩‍👧‍👦", "🏳️‍🌈", "🏴\U000E0067\U000E0062\U000E0065\U000E006E\U000E0067\U000E007F",
	} {
		if !validEmoji(emoji) {
			t.Errorf("validEmoji(%q)=false", emoji)
		}
	}
}

func TestValidEmojiRejectsTextAndMalformedSequences(t *testing.T) {
	for _, value := range []string{"", "hello", "A😀B", string([]byte{0xff, 0xfe})} {
		if validEmoji(value) {
			t.Errorf("validEmoji(%q)=true", value)
		}
	}
}
