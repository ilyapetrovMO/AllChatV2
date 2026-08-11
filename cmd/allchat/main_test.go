// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package main

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestACMEShorthandDefaultsToHTTPSListener(t *testing.T) {
	flags := flag.NewFlagSet("test", flag.ContinueOnError)
	listen := flags.String("listen", "127.0.0.1:8080", "")
	acme := flags.String("acme", "", "")
	host := flags.String("acme-host", "", "")
	if err := flags.Parse([]string{"--acme", "192.0.2.10"}); err != nil {
		t.Fatal(err)
	}
	if err := applyACMEShorthand(flags, listen, acme, host); err != nil {
		t.Fatal(err)
	}
	if *listen != ":443" || *host != "192.0.2.10" {
		t.Fatalf("listen=%q host=%q", *listen, *host)
	}
}

func TestSetupLinkUsesProtectedToken(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "setup.token"), []byte("opaque-test-token\n"), 0600); err != nil {
		t.Fatal(err)
	}
	oldOut, oldErr := os.Stdout, os.Stderr
	outRead, outWrite, _ := os.Pipe()
	errRead, errWrite, _ := os.Pipe()
	os.Stdout, os.Stderr = outWrite, errWrite
	code := runSetupLink([]string{"--data-dir", dir, "--base-url", "https://chat.example.test"})
	outWrite.Close()
	errWrite.Close()
	os.Stdout, os.Stderr = oldOut, oldErr
	var output bytes.Buffer
	_, _ = output.ReadFrom(outRead)
	var errors bytes.Buffer
	_, _ = errors.ReadFrom(errRead)
	if code != 0 || errors.Len() != 0 {
		t.Fatalf("code=%d stderr=%q", code, errors.String())
	}
	if got := strings.TrimSpace(output.String()); got != "https://chat.example.test/setup?token=opaque-test-token" {
		t.Fatalf("setup link = %q", got)
	}
}

func TestSetupLinkReturnsCommunityAfterOwnerSetup(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "allchat.db"), []byte("initialized"), 0600); err != nil {
		t.Fatal(err)
	}
	oldOut, oldErr := os.Stdout, os.Stderr
	outRead, outWrite, _ := os.Pipe()
	errRead, errWrite, _ := os.Pipe()
	os.Stdout, os.Stderr = outWrite, errWrite
	code := runSetupLink([]string{"--data-dir", dir, "--base-url", "https://chat.example.test"})
	outWrite.Close()
	errWrite.Close()
	os.Stdout, os.Stderr = oldOut, oldErr
	var output bytes.Buffer
	_, _ = output.ReadFrom(outRead)
	var errors bytes.Buffer
	_, _ = errors.ReadFrom(errRead)
	if code != 0 || strings.TrimSpace(output.String()) != "https://chat.example.test/" || errors.Len() != 0 {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, output.String(), errors.String())
	}
}

func TestACMEShorthandPreservesExplicitListener(t *testing.T) {
	flags := flag.NewFlagSet("test", flag.ContinueOnError)
	listen := flags.String("listen", "127.0.0.1:8080", "")
	acme := flags.String("acme", "", "")
	host := flags.String("acme-host", "", "")
	if err := flags.Parse([]string{"--listen", ":8443", "--acme", "chat.example.com"}); err != nil {
		t.Fatal(err)
	}
	if err := applyACMEShorthand(flags, listen, acme, host); err != nil {
		t.Fatal(err)
	}
	if *listen != ":8443" || *host != "chat.example.com" {
		t.Fatalf("listen=%q host=%q", *listen, *host)
	}
}
