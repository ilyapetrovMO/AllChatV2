// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package main

import (
	"flag"
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
