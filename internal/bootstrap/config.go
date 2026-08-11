// Package bootstrap installs and upgrades an AllChat Instance on a supported VPS.
package bootstrap

import (
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
	SSHHost       string
	SSHPort       int
	SSHUser       string
	SudoPassword  string
	PublicIP      string
	TLSMode       TLSMode
	Hostname      string
	ACMEEmail     string
	DuckSubdomain string
	DuckToken     string
	Release       string
}

var dnsLabel = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)
var releaseTag = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+$`)
var duckToken = regexp.MustCompile(`^[A-Za-z0-9-]{16,128}$`)

func (c Config) Validate() error {
	if strings.TrimSpace(c.SSHHost) == "" || strings.TrimSpace(c.SSHUser) == "" {
		return fmt.Errorf("SSH host and user are required")
	}
	if c.SSHPort < 1 || c.SSHPort > 65535 {
		return fmt.Errorf("SSH port must be between 1 and 65535")
	}
	if ip := net.ParseIP(strings.TrimSpace(c.PublicIP)); ip == nil || ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() {
		return fmt.Errorf("a public routable Instance IP is required")
	}
	if !releaseTag.MatchString(c.Release) {
		return fmt.Errorf("release must be a semantic tag such as v1.2.3")
	}
	if c.ACMEEmail != "" {
		address, err := mail.ParseAddress(c.ACMEEmail)
		if err != nil || address.Address != c.ACMEEmail {
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
