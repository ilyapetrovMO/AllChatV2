package bootstrap

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"testing"
)

func TestConfigModesAndPublicURL(t *testing.T) {
	tests := []struct {
		name string
		cfg  Config
		want string
	}{
		{"IP", Config{SSHHost: "host.example.test", SSHPort: 2222, SSHUser: "operator", PublicIP: "192.0.2.20", TLSMode: TLSDirectIP, Release: "v1.2.3"}, "https://192.0.2.20"},
		{"hostname", Config{SSHHost: "host.example.test", SSHPort: 22, SSHUser: "operator", PublicIP: "192.0.2.20", TLSMode: TLSHostname, Hostname: "chat.example.test", Release: "v1.2.3"}, "https://chat.example.test"},
		{"DuckDNS", Config{SSHHost: "host.example.test", SSHPort: 22, SSHUser: "operator", PublicIP: "192.0.2.20", TLSMode: TLSDuckDNS, DuckSubdomain: "allchat-demo", DuckToken: "00000000-0000-0000-0000-000000000000", Release: "v1.2.3"}, "https://allchat-demo.duckdns.org"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.cfg.Validate(); err != nil {
				t.Fatal(err)
			}
			if got := test.cfg.BaseURL(); got != test.want {
				t.Fatalf("URL=%q", got)
			}
		})
	}
}

func TestConfigDefaultsToLatestRelease(t *testing.T) {
	cfg := Config{SSHHost: "host.example.test", SSHPort: 22, SSHUser: "operator", PublicIP: "192.0.2.20", TLSMode: TLSDirectIP}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	if cfg.ReleaseRef() != "latest" {
		t.Fatalf("release ref=%q", cfg.ReleaseRef())
	}
}

func TestResolvePublicIPUsesLiteralAddress(t *testing.T) {
	got, err := ResolvePublicIP(context.Background(), "192.0.2.20")
	if err != nil || got != "192.0.2.20" {
		t.Fatalf("IP=%q err=%v", got, err)
	}
}

func TestResolvePublicIPPrefersPublicIPv4FromHostname(t *testing.T) {
	lookup := func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("10.0.0.2")}, {IP: net.ParseIP("2001:db8::20")}, {IP: net.ParseIP("192.0.2.20")}}, nil
	}
	got, err := resolvePublicIP(context.Background(), "host.example.test", lookup)
	if err != nil || got != "192.0.2.20" {
		t.Fatalf("IP=%q err=%v", got, err)
	}
}

func TestResolvePublicIPRejectsPrivateDNSResults(t *testing.T) {
	lookup := func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("10.0.0.2")}, {IP: net.ParseIP("127.0.0.1")}}, nil
	}
	if _, err := resolvePublicIP(context.Background(), "host.example.test", lookup); err == nil {
		t.Fatal("accepted a hostname with no public address")
	}
}

func TestParseSupportedPlatform(t *testing.T) {
	p, err := ParsePlatform("ID=ubuntu\nVERSION_ID=24.04\n", "aarch64\n")
	if err != nil {
		t.Fatal(err)
	}
	if p.Architecture != "arm64" || p.Distribution != "ubuntu" {
		t.Fatalf("platform=%+v", p)
	}
	if _, err = ParsePlatform("ID=alpine\nVERSION_ID=3.20", "x86_64"); err == nil {
		t.Fatal("accepted unsupported distribution")
	}
	if _, err = ParsePlatform("ID=debian\nVERSION_ID=9", "x86_64"); err == nil {
		t.Fatal("accepted old Debian")
	}
}

func TestDownloadVerifiedChecksArtifactDigest(t *testing.T) {
	content := []byte("test release binary")
	digest := sha256.Sum256(content)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		body := content
		if strings.HasSuffix(request.URL.Path, "/SHA256SUMS") {
			body = []byte(fmt.Sprintf("%x  allchat_1.2.3_linux_amd64\n", digest))
		}
		return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Body: io.NopCloser(strings.NewReader(string(body))), Header: make(http.Header)}, nil
	})}
	got, err := DownloadVerified(context.Background(), client, "v1.2.3", "allchat_1.2.3_linux_amd64")
	if err != nil || string(got) != string(content) {
		t.Fatalf("content=%q err=%v", got, err)
	}
}

func TestDownloadInstanceVerifiedDiscoversLatestVersionedAsset(t *testing.T) {
	content := []byte("latest server binary")
	digest := sha256.Sum256(content)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		body := content
		if strings.HasSuffix(request.URL.Path, "/SHA256SUMS") {
			body = []byte(fmt.Sprintf("%x  allchat_2.4.6_linux_amd64\n", digest))
		}
		return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Body: io.NopCloser(strings.NewReader(string(body))), Header: make(http.Header)}, nil
	})}
	asset, got, err := DownloadInstanceVerified(context.Background(), client, "", "amd64")
	if err != nil || asset != "allchat_2.4.6_linux_amd64" || string(got) != string(content) {
		t.Fatalf("asset=%q content=%q err=%v", asset, got, err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func TestInstallScriptPreservesSSHAndProvidesRollback(t *testing.T) {
	cfg := Config{SSHHost: "host.example.test", SSHPort: 2200, SSHUser: "operator", PublicIP: "192.0.2.30", TLSMode: TLSHostname, Hostname: "chat.example.test", ACMEEmail: "admin@example.test", Release: "v1.0.0"}
	script := installScript(cfg)
	for _, expected := range []string{"ufw allow 2200/tcp", "bootstrap-managed", "allchat.previous", "allchat.failed-", "allchat restore", "chown -R allchat:allchat /var/lib/allchat", "required_kb", "systemctl start allchat.service", "--acme chat.example.test"} {
		if !strings.Contains(script, expected) {
			t.Errorf("script missing %q", expected)
		}
	}
	command := exec.Command("sh", "-n")
	command.Stdin = strings.NewReader(script)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("invalid install script: %v: %s", err, output)
	}
}

func TestInstallScriptOmitsEmptyACMEEmailOption(t *testing.T) {
	cfg := Config{SSHHost: "host.example.test", SSHPort: 22, SSHUser: "root", PublicIP: "192.0.2.30", TLSMode: TLSDirectIP, Release: "v1.0.0"}
	script := installScript(cfg)
	if strings.Contains(script, "--acme-email") {
		t.Fatalf("empty optional ACME email rendered as a bare flag:\n%s", script)
	}
}

type fakeRemote struct {
	commands []string
	upload   bool
}

func (f *fakeRemote) Run(_ context.Context, command string, _ io.Reader) (string, error) {
	f.commands = append(f.commands, command)
	if strings.HasPrefix(command, "cat /etc/os-release") {
		return "ID=debian\nVERSION_ID=12\n---ALLCHAT-ARCH---\nx86_64", nil
	}
	if strings.Contains(command, "setup-link") {
		return "https://chat.example.test/setup?token=test\n", nil
	}
	return "", nil
}
func (f *fakeRemote) Upload(_ context.Context, _ string, _ io.Reader, _ uint32) error {
	f.upload = true
	return nil
}

func TestInstallerReturnsSetupLink(t *testing.T) {
	remote := &fakeRemote{}
	cfg := Config{SSHHost: "host.example.test", SSHPort: 22, SSHUser: "operator", PublicIP: "192.0.2.30", TLSMode: TLSHostname, Hostname: "chat.example.test", Release: "v1.0.0"}
	link, err := (Installer{}).Install(context.Background(), remote, strings.NewReader("binary"), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !remote.upload || link != "https://chat.example.test/setup?token=test" {
		t.Fatalf("upload=%v link=%q", remote.upload, link)
	}
}

func TestInstallerStopsOnInspectionFailure(t *testing.T) {
	remote := failingRemote{}
	cfg := Config{SSHHost: "host.example.test", SSHPort: 22, SSHUser: "operator", PublicIP: "192.0.2.30", TLSMode: TLSDirectIP, Release: "v1.0.0"}
	if _, err := (Installer{}).Install(context.Background(), remote, strings.NewReader("binary"), cfg); err == nil {
		t.Fatal("expected failure")
	}
}

type failingRemote struct{}

func (failingRemote) Run(context.Context, string, io.Reader) (string, error) {
	return "", errors.New("offline")
}
func (failingRemote) Upload(context.Context, string, io.Reader, uint32) error { return nil }
