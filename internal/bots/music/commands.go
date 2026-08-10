// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package music

import (
	"fmt"
	"strings"
)

type Command struct {
	Name     string
	Argument string
}

var aliases = map[string]string{
	"p": "play", "q": "queue", "np": "nowplaying", "now": "nowplaying",
	"dc": "leave", "disconnect": "leave", "next": "skip", "s": "skip",
	"vol": "volume", "resume": "resume", "unpause": "resume",
}

var commands = map[string]bool{
	"join": true, "leave": true, "play": true, "search": true, "pause": true,
	"resume": true, "seek": true, "replay": true, "skip": true, "stop": true,
	"queue": true, "nowplaying": true, "remove": true, "move": true, "clear": true,
	"shuffle": true, "loop": true, "volume": true, "help": true,
}

func ParseCommand(body, prefix string) (Command, bool, error) {
	body, prefix = strings.TrimSpace(body), strings.TrimSpace(prefix)
	if prefix == "" {
		return Command{}, false, fmt.Errorf("command prefix is empty")
	}
	if !strings.HasPrefix(body, prefix) {
		return Command{}, false, nil
	}
	fields := strings.Fields(strings.TrimSpace(strings.TrimPrefix(body, prefix)))
	if len(fields) == 0 {
		return Command{}, false, nil
	}
	name := strings.ToLower(fields[0])
	if alias := aliases[name]; alias != "" {
		name = alias
	}
	if !commands[name] {
		return Command{}, true, fmt.Errorf("unknown music command %q", fields[0])
	}
	argument := ""
	if len(fields) > 1 {
		argument = strings.Join(fields[1:], " ")
	}
	return Command{Name: name, Argument: argument}, true, nil
}
