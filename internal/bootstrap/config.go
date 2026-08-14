// Package bootstrap installs and upgrades an AllChat Instance on a supported VPS.
package bootstrap

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/mail"
	"net/url"
	"regexp"
	"strings"
)

type TLSMode string

const (
	TLSDirectIP TLSMode = "direct-ip"
	TLSHostname TLSMode = "hostname"
	TLSDuckDNS  TLSMode = "duckdns"
)

type Config struct {
	SSHHost           string
	SSHPort           int
	SSHUser           string
	SudoPassword      string
	PublicIP          string
	TLSMode           TLSMode
	Hostname          string
	ACMEEmail         string
	DuckSubdomain     string
	DuckToken         string
	Release           string
	PushRelayURL      string
	DeployRelay       bool
	PreserveRelay     bool
	FirebaseJSON      []byte
	FirebaseProjectID string
}

func (c *Config) ConfigureFirebaseServiceAccount(content []byte) error {
	if len(content) == 0 {
		c.FirebaseJSON, c.FirebaseProjectID = nil, ""
		return nil
	}
	var credentials struct {
		Type        string `json:"type"`
		ProjectID   string `json:"project_id"`
		ClientEmail string `json:"client_email"`
		PrivateKey  string `json:"private_key"`
	}
	if err := json.Unmarshal(content, &credentials); err != nil || credentials.Type != "service_account" || !firebaseProjectID.MatchString(credentials.ProjectID) || credentials.ClientEmail == "" || !strings.Contains(credentials.PrivateKey, "BEGIN PRIVATE KEY") {
		return fmt.Errorf("Firebase credentials must be a valid service-account JSON file")
	}
	c.FirebaseJSON = append([]byte(nil), content...)
	c.FirebaseProjectID = credentials.ProjectID
	return nil
}

const DefaultPushRelayURL = "https://ru.elitedarklord.com"

var dnsLabel = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)
var releaseTag = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+$`)
var duckToken = regexp.MustCompile(`^[A-Za-z0-9-]{16,128}$`)
var firebaseProjectID = regexp.MustCompile(`^[a-z][a-z0-9-]{4,61}[a-z0-9]$`)

func (c Config) Validate() error {
	if err := c.ValidateBeforePublicIP(); err != nil {
		return err
	}
	if !isPublicRoutableIP(net.ParseIP(strings.TrimSpace(c.PublicIP))) {
		return fmt.Errorf("a public routable Instance IP is required")
	}
	return nil
}

// ValidateBeforePublicIP checks user-supplied configuration before the VPS
// address has been resolved to the public IP used by media services.
func (c Config) ValidateBeforePublicIP() error {
	if strings.TrimSpace(c.SSHHost) == "" || strings.TrimSpace(c.SSHUser) == "" {
		return fmt.Errorf("SSH host and user are required")
	}
	if c.SSHPort < 1 || c.SSHPort > 65535 {
		return fmt.Errorf("SSH port must be between 1 and 65535")
	}
	if c.Release != "" && !releaseTag.MatchString(c.Release) {
		return fmt.Errorf("release must be a semantic tag such as v1.2.3")
	}
	if c.PushRelayURL != "" {
		parsed, err := url.Parse(c.PushRelayURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return fmt.Errorf("push relay URL must be an absolute HTTPS URL")
		}
	}
	if c.DeployRelay {
		if c.TLSMode == TLSDirectIP {
			return fmt.Errorf("private push relay deployment requires a public hostname or DuckDNS")
		}
		if c.PushRelayURL != c.BaseURL() {
			return fmt.Errorf("private push relay URL must use the Community base URL")
		}
		if len(c.FirebaseJSON) == 0 || strings.TrimSpace(c.FirebaseProjectID) == "" {
			return fmt.Errorf("a Firebase service-account JSON file is required")
		}
	}
	if c.ACMEEmail != "" {
		address, err := mail.ParseAddress(c.ACMEEmail)
		if err != nil || address.Address != c.ACMEEmail || strings.ContainsAny(c.ACMEEmail, "% \t\r\n") {
			return fmt.Errorf("ACME email is invalid")
		}
	}
	switch c.TLSMode {
	case TLSDirectIP:
		if c.Hostname != "" || c.DuckSubdomain != "" || c.DuckToken != "" {
			return fmt.Errorf("direct IP mode cannot include hostname settings")
		}
	case TLSHostname:
		if err := validateHostname(c.Hostname); err != nil {
			return err
		}
	case TLSDuckDNS:
		if !dnsLabel.MatchString(c.DuckSubdomain) || !duckToken.MatchString(c.DuckToken) {
			return fmt.Errorf("DuckDNS subdomain and token are required")
		}
	default:
		return fmt.Errorf("TLS mode is invalid")
	}
	return nil
}

// ResolvePublicIP derives the media-facing address from the SSH server address.
func ResolvePublicIP(ctx context.Context, host string) (string, error) {
	return resolvePublicIP(ctx, strings.Trim(strings.TrimSpace(host), "[]"), net.DefaultResolver.LookupIPAddr)
}

func resolvePublicIP(ctx context.Context, host string, lookup func(context.Context, string) ([]net.IPAddr, error)) (string, error) {
	if ip := net.ParseIP(host); isPublicRoutableIP(ip) {
		return ip.String(), nil
	}
	addresses, err := lookup(ctx, host)
	if err != nil {
		return "", fmt.Errorf("resolve VPS address %q: %w", host, err)
	}
	var ipv6 net.IP
	for _, address := range addresses {
		if !isPublicRoutableIP(address.IP) {
			continue
		}
		if address.IP.To4() != nil {
			return address.IP.String(), nil
		}
		if ipv6 == nil {
			ipv6 = address.IP
		}
	}
	if ipv6 != nil {
		return ipv6.String(), nil
	}
	return "", fmt.Errorf("VPS address %q does not resolve to a public IP", host)
}

func isPublicRoutableIP(ip net.IP) bool {
	return ip != nil && ip.IsGlobalUnicast() && !ip.IsPrivate()
}

// ReleaseRef returns the GitHub release selector used for downloads. An empty
// release intentionally follows GitHub's latest-release redirect.
func (c Config) ReleaseRef() string {
	if strings.TrimSpace(c.Release) == "" {
		return "latest"
	}
	return strings.TrimSpace(c.Release)
}

func validateHostname(value string) error {
	parsed, err := url.Parse("https://" + strings.TrimSpace(value))
	if err != nil || parsed.Hostname() == "" || parsed.Hostname() != value || net.ParseIP(value) != nil || !strings.Contains(value, ".") {
		return fmt.Errorf("hostname must be a DNS name without a scheme or path")
	}
	for _, label := range strings.Split(value, ".") {
		if !dnsLabel.MatchString(label) {
			return fmt.Errorf("hostname contains an invalid DNS label")
		}
	}
	return nil
}

func (c Config) ACMEIdentifier() string {
	switch c.TLSMode {
	case TLSDirectIP:
		return c.PublicIP
	case TLSDuckDNS:
		return c.DuckSubdomain + ".duckdns.org"
	default:
		return c.Hostname
	}
}

func (c Config) BaseURL() string { return "https://" + c.ACMEIdentifier() }
