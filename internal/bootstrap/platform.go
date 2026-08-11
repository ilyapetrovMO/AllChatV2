package bootstrap

import (
	"fmt"
	"strconv"
	"strings"
)

type Platform struct {
	Distribution string
	Version      string
	Architecture string
}

func ParsePlatform(osRelease, machine string) (Platform, error) {
	values := map[string]string{}
	for _, line := range strings.Split(osRelease, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			values[key] = strings.Trim(strings.TrimSpace(value), `"`)
		}
	}
	p := Platform{Distribution: values["ID"], Version: values["VERSION_ID"]}
	switch strings.TrimSpace(machine) {
	case "x86_64", "amd64":
		p.Architecture = "amd64"
	case "aarch64", "arm64":
		p.Architecture = "arm64"
	case "armv7l", "armv7":
		p.Architecture = "armv7"
	default:
		return Platform{}, fmt.Errorf("unsupported host architecture %q", strings.TrimSpace(machine))
	}
	if p.Distribution != "debian" && p.Distribution != "ubuntu" {
		return Platform{}, fmt.Errorf("unsupported distribution %q", p.Distribution)
	}
	major, err := strconv.Atoi(strings.SplitN(p.Version, ".", 2)[0])
	if err != nil || (p.Distribution == "debian" && major < 12) || (p.Distribution == "ubuntu" && major < 22) {
		return Platform{}, fmt.Errorf("unsupported %s version %q", p.Distribution, p.Version)
	}
	return p, nil
}
