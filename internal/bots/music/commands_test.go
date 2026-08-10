package music

import "testing"

func TestParseRecognizesDiscordStylePlaybackCommandsAndAliases(t *testing.T) {
	tests := []struct {
		body, name, argument string
	}{
		{"!play never gonna give you up", "play", "never gonna give you up"},
		{"  !P https://media.example/song  ", "play", "https://media.example/song"},
		{"!np", "nowplaying", ""},
		{"!dc", "leave", ""},
		{"!loop queue", "loop", "queue"},
	}
	for _, test := range tests {
		command, ok, err := ParseCommand(test.body, "!")
		if err != nil || !ok || command.Name != test.name || command.Argument != test.argument {
			t.Fatalf("ParseCommand(%q) = %+v, %v, %v", test.body, command, ok, err)
		}
	}
	if _, ok, err := ParseCommand("ordinary Message", "!"); err != nil || ok {
		t.Fatalf("ordinary Message parsed as command: ok=%v err=%v", ok, err)
	}
}
