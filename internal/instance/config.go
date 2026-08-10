// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"fmt"
	"net"
	"path/filepath"
	"strconv"
	"strings"
)

// Config contains the boot-critical settings required by an Instance.
type Config struct {
	DataDir              string
	ListenAddress        string
	TLSCertFile          string
	TLSKeyFile           string
	ACMEHost             string
	ACMEEmail            string
	TURNPublicIP         string
	TURNListenAddress    string
	TURNRelayMinPort     uint16
	TURNRelayMaxPort     uint16
	TURNTLSListenAddress string
	ExternalTURNURLs     []string
	ExternalTURNSecret   string
	MediaPortMin         uint16
	MediaPortMax         uint16
	MediaMaxParticipants int
	MediaAudioBitrate    int
	MediaScreenBitrate   int
	MetricsEnabled       bool
}

// ConfigureExternalTURN disables the embedded listener and uses an operator's
// TURN REST deployment. All URLs share the supplied secret; browsers still
// receive only short-lived, per-Member credentials.
func (c *Config) ConfigureExternalTURN(rawURLs, sharedSecret string) error {
	rawURLs = strings.TrimSpace(rawURLs)
	sharedSecret = strings.TrimSpace(sharedSecret)
	if rawURLs == "" && sharedSecret == "" {
		return nil
	}
	if rawURLs == "" || len(sharedSecret) < 32 {
		return fmt.Errorf("external TURN URLs and a shared secret of at least 32 characters are required")
	}
	if c.TURNPublicIP != "" {
		return fmt.Errorf("embedded and external TURN modes are mutually exclusive")
	}
	var urls []string
	for _, value := range strings.Split(rawURLs, ",") {
		value = strings.TrimSpace(value)
		if !strings.HasPrefix(value, "turn:") && !strings.HasPrefix(value, "turns:") {
			return fmt.Errorf("external TURN URL must use turn: or turns:")
		}
		urls = append(urls, value)
	}
	c.ExternalTURNURLs = urls
	c.ExternalTURNSecret = sharedSecret
	return nil
}

func (c *Config) ConfigureTURN(publicIP, listenAddress string, minPort, maxPort int) error {
	publicIP = strings.TrimSpace(publicIP)
	if publicIP == "" {
		return nil
	}
	ip := net.ParseIP(publicIP)
	if ip == nil || ip.IsUnspecified() {
		return fmt.Errorf("TURN public IP is invalid")
	}
	if _, _, err := net.SplitHostPort(listenAddress); err != nil {
		return fmt.Errorf("TURN listen address must be host:port")
	}
	if minPort < 1024 || maxPort > 65535 || maxPort < minPort || maxPort-minPort+1 < 16 {
		return fmt.Errorf("TURN relay range must contain at least 16 ports between 1024 and 65535")
	}
	c.TURNPublicIP = ip.String()
	c.TURNListenAddress = listenAddress
	c.TURNRelayMinPort = uint16(minPort)
	c.TURNRelayMaxPort = uint16(maxPort)
	host, _, _ := net.SplitHostPort(listenAddress)
	c.TURNTLSListenAddress = net.JoinHostPort(host, "5349")
	return nil
}

func (c *Config) ConfigureTLS(certFile, keyFile, acmeHost, acmeEmail string) error {
	certFile = strings.TrimSpace(certFile)
	keyFile = strings.TrimSpace(keyFile)
	acmeHost = strings.TrimSpace(acmeHost)
	if (certFile == "") != (keyFile == "") {
		return fmt.Errorf("TLS certificate and key must be supplied together")
	}
	if certFile != "" && acmeHost != "" {
		return fmt.Errorf("supplied TLS and ACME modes are mutually exclusive")
	}
	if acmeHost != "" {
		if strings.ContainsAny(acmeHost, "/\\ ") || (net.ParseIP(acmeHost) == nil && strings.Contains(acmeHost, ":")) {
			return fmt.Errorf("ACME identifier must be a DNS hostname or IP address")
		}
	}
	c.TLSCertFile = certFile
	c.TLSKeyFile = keyFile
	c.ACMEHost = acmeHost
	c.ACMEEmail = strings.TrimSpace(acmeEmail)
	return nil
}

// NewConfig validates and normalizes boot-critical settings before resources
// such as public listeners are opened.
func NewConfig(dataDir, listenAddress string) (Config, error) {
	if strings.TrimSpace(dataDir) == "" {
		return Config{}, fmt.Errorf("data directory is required")
	}
	absoluteDataDir, err := filepath.Abs(dataDir)
	if err != nil {
		return Config{}, fmt.Errorf("resolve data directory: %w", err)
	}

	host, portText, err := net.SplitHostPort(listenAddress)
	if err != nil {
		return Config{}, fmt.Errorf("listen address must be host:port: %w", err)
	}
	if strings.ContainsAny(host, "/\\") {
		return Config{}, fmt.Errorf("listen host is invalid")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 0 || port > 65535 {
		return Config{}, fmt.Errorf("listen port must be between 0 and 65535")
	}

	return Config{DataDir: absoluteDataDir, ListenAddress: listenAddress, MediaPortMin: 50000, MediaPortMax: 50100, MediaMaxParticipants: 25, MediaAudioBitrate: 64_000, MediaScreenBitrate: 2_500_000}, nil
}

func (c *Config) ConfigureMedia(minPort, maxPort, maxParticipants int) error {
	if minPort < 1024 || maxPort > 65535 || maxPort < minPort || maxPort-minPort+1 < 32 {
		return fmt.Errorf("media UDP range must contain at least 32 ports")
	}
	if maxParticipants < 2 || maxParticipants > 100 {
		return fmt.Errorf("media participant limit must be between 2 and 100")
	}
	c.MediaPortMin = uint16(minPort)
	c.MediaPortMax = uint16(maxPort)
	c.MediaMaxParticipants = maxParticipants
	return nil
}

func (c *Config) ConfigureMediaBitrates(audio, screen int) error {
	if audio < 16_000 || audio > 128_000 || screen < 250_000 || screen > 8_000_000 {
		return fmt.Errorf("media bitrates must be 16-128 Kbps audio and 250-8000 Kbps screen video")
	}
	c.MediaAudioBitrate = audio
	c.MediaScreenBitrate = screen
	return nil
}
