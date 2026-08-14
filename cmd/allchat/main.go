// AllChat is free software: you can redistribute it and/or modify it under the
// terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or any later version.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"allchat/internal/buildinfo"
	"allchat/internal/instance"
)

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) > 0 && args[0] == "version" {
		fmt.Fprintln(os.Stdout, buildinfo.String())
		return 0
	}
	if len(args) > 0 && args[0] == "setup-link" {
		return runSetupLink(args[1:])
	}
	if len(args) > 0 && args[0] == "recover-owner" {
		return runRecoverOwner(args[1:], os.Stdin)
	}
	if len(args) > 0 && args[0] == "backup" {
		return runBackup(args[1:])
	}
	if len(args) > 0 && args[0] == "restore" {
		return runRestore(args[1:])
	}
	flags := flag.NewFlagSet("allchat", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	dataDir := flags.String("data-dir", "", "directory containing Instance data")
	listenAddress := flags.String("listen", "127.0.0.1:8080", "HTTP listen address")
	tlsCert := flags.String("tls-cert", "", "PEM TLS certificate file")
	tlsKey := flags.String("tls-key", "", "PEM TLS private key file")
	acmeHost := flags.String("acme-host", "", "public DNS hostname for automatic ACME TLS")
	acme := flags.String("acme", "", "automatically manage HTTPS for a public DNS hostname or IP address")
	acmeEmail := flags.String("acme-email", "", "contact email for ACME registration")
	turnPublicIP := flags.String("turn-public-ip", "", "public IP advertised by the embedded TURN relay")
	turnListen := flags.String("turn-listen", ":3478", "embedded TURN UDP listen address")
	turnMin := flags.Int("turn-relay-min-port", 49160, "first embedded TURN UDP relay port")
	turnMax := flags.Int("turn-relay-max-port", 49259, "last embedded TURN UDP relay port")
	externalTURNURLs := flags.String("external-turn-urls", "", "comma-separated external TURN REST URLs")
	mediaMin := flags.Int("media-min-port", 50000, "first WebRTC SFU UDP port")
	mediaMax := flags.Int("media-max-port", 50100, "last WebRTC SFU UDP port")
	mediaParticipants := flags.Int("media-max-participants", 25, "maximum participants in one Media Session")
	mediaAudioBitrate := flags.Int("media-audio-bitrate", 64000, "maximum sender audio bitrate in bits per second")
	mediaScreenBitrate := flags.Int("media-screen-bitrate", 2500000, "maximum sender screen bitrate in bits per second")
	metrics := flags.Bool("metrics", false, "enable the unlabeled Prometheus endpoint at /metrics")
	pushRelay := flags.String("push-relay", os.Getenv("ALLCHAT_PUSH_RELAY_URL"), "default hosted mobile push relay URL")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "unexpected positional arguments")
		return 2
	}
	if err := applyACMEShorthand(flags, listenAddress, acme, acmeHost); err != nil {
		fmt.Fprintf(os.Stderr, "invalid TLS configuration: %v\n", err)
		return 2
	}

	config, err := instance.NewConfig(*dataDir, *listenAddress)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid configuration: %v\n", err)
		return 2
	}
	if err := config.ConfigureTLS(*tlsCert, *tlsKey, *acmeHost, *acmeEmail); err != nil {
		fmt.Fprintf(os.Stderr, "invalid TLS configuration: %v\n", err)
		return 2
	}
	if err := config.ConfigureTURN(*turnPublicIP, *turnListen, *turnMin, *turnMax); err != nil {
		fmt.Fprintf(os.Stderr, "invalid TURN configuration: %v\n", err)
		return 2
	}
	if err := config.ConfigureExternalTURN(*externalTURNURLs, os.Getenv("ALLCHAT_EXTERNAL_TURN_SECRET")); err != nil {
		fmt.Fprintf(os.Stderr, "invalid external TURN configuration: %v\n", err)
		return 2
	}
	if err := config.ConfigureMedia(*mediaMin, *mediaMax, *mediaParticipants); err != nil {
		fmt.Fprintf(os.Stderr, "invalid media configuration: %v\n", err)
		return 2
	}
	if err := config.ConfigureMediaBitrates(*mediaAudioBitrate, *mediaScreenBitrate); err != nil {
		fmt.Fprintf(os.Stderr, "invalid media bitrate configuration: %v\n", err)
		return 2
	}
	if err := config.ConfigurePushRelay(*pushRelay); err != nil {
		fmt.Fprintf(os.Stderr, "invalid push relay configuration: %v\n", err)
		return 2
	}
	config.MetricsEnabled = *metrics

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	app, err := instance.Open(config, logger)
	if err != nil {
		fmt.Fprintf(os.Stderr, "start Instance: %v\n", err)
		return 1
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := app.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintf(os.Stderr, "run Instance: %v\n", err)
		return 1
	}
	return 0
}

func runSetupLink(args []string) int {
	flags := flag.NewFlagSet("allchat setup-link", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	dataDir := flags.String("data-dir", "", "directory containing Instance data")
	baseURL := flags.String("base-url", "", "public Instance URL")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *dataDir == "" || *baseURL == "" || flags.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "setup-link requires --data-dir and --base-url")
		return 2
	}
	parsed, err := url.Parse(*baseURL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil {
		fmt.Fprintln(os.Stderr, "setup-link requires an absolute http or https --base-url")
		return 2
	}
	token, err := os.ReadFile(filepath.Join(*dataDir, "setup.token"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if _, databaseErr := os.Stat(filepath.Join(*dataDir, "allchat.db")); databaseErr == nil {
				parsed.Path, parsed.RawQuery, parsed.Fragment = "/", "", ""
				fmt.Fprintln(os.Stdout, parsed.String())
				return 0
			}
		}
		fmt.Fprintf(os.Stderr, "read setup token: %v\n", err)
		return 1
	}
	parsed.Path = "/setup"
	parsed.RawQuery = url.Values{"token": []string{strings.TrimSpace(string(token))}}.Encode()
	parsed.Fragment = ""
	fmt.Fprintln(os.Stdout, parsed.String())
	return 0
}

func applyACMEShorthand(flags *flag.FlagSet, listenAddress, acme, acmeHost *string) error {
	if *acme != "" && *acmeHost != "" {
		return fmt.Errorf("--acme and --acme-host are mutually exclusive")
	}
	if *acme == "" {
		return nil
	}
	*acmeHost = *acme
	listenWasSet := false
	flags.Visit(func(current *flag.Flag) { listenWasSet = listenWasSet || current.Name == "listen" })
	if !listenWasSet {
		*listenAddress = ":443"
	}
	return nil
}

func runBackup(args []string) int {
	flags := flag.NewFlagSet("allchat backup", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	dataDir := flags.String("data-dir", "", "directory containing Instance data")
	output := flags.String("output", "", "destination .tar.gz archive")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *dataDir == "" || *output == "" || flags.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "backup requires --data-dir and --output")
		return 2
	}
	if err := instance.Backup(context.Background(), *dataDir, *output); err != nil {
		fmt.Fprintf(os.Stderr, "backup Instance: %v\n", err)
		return 1
	}
	fmt.Fprintf(os.Stdout, "Backup written to %s\n", *output)
	return 0
}

func runRestore(args []string) int {
	flags := flag.NewFlagSet("allchat restore", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	dataDir := flags.String("data-dir", "", "new or empty Instance data directory")
	input := flags.String("input", "", "source .tar.gz archive")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *dataDir == "" || *input == "" || flags.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "restore requires --data-dir and --input")
		return 2
	}
	if err := instance.Restore(context.Background(), *dataDir, *input); err != nil {
		fmt.Fprintf(os.Stderr, "restore Instance: %v\n", err)
		return 1
	}
	fmt.Fprintf(os.Stdout, "Backup restored to %s\n", *dataDir)
	return 0
}

func runRecoverOwner(args []string, passwordInput io.Reader) int {
	flags := flag.NewFlagSet("allchat recover-owner", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	dataDir := flags.String("data-dir", "", "directory containing offline Instance data")
	username := flags.String("username", "", "replacement Owner username")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *dataDir == "" || *username == "" || flags.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "recover-owner requires --data-dir and --username")
		return 2
	}
	passwordBytes, err := io.ReadAll(io.LimitReader(passwordInput, 1025))
	if err != nil {
		fmt.Fprintf(os.Stderr, "read replacement password: %v\n", err)
		return 1
	}
	password := string(passwordBytes)
	password = string([]byte(strings.TrimRight(password, "\r\n")))
	if err := instance.RecoverOwner(context.Background(), *dataDir, *username, password); err != nil {
		fmt.Fprintf(os.Stderr, "recover Owner: %v\n", err)
		return 1
	}
	fmt.Fprintln(os.Stdout, "Community Owner credentials recovered; all existing Sessions were revoked")
	return 0
}
