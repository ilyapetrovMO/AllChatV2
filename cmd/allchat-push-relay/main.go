package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	firebase "firebase.google.com/go/v4"
	"github.com/sideshow/apns2"
	"github.com/sideshow/apns2/token"

	"allchat/internal/pushrelay"
)

type config struct {
	listen          string
	workers         int
	queueCapacity   int
	shutdownTimeout time.Duration
	publicKeys      string
	firebaseProject string
	apnsKeyFile     string
	apnsKeyID       string
	apnsTeamID      string
	apnsTopic       string
	apnsVOIPTopic   string
	apnsProduction  bool
	public          bool
	globalRate      float64
	globalBurst     int
	ipRate          float64
	ipBurst         int
	tokenRate       float64
	tokenBurst      int
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(context.Background(), os.Args[1:], logger); err != nil {
		logger.Error("push relay stopped", "reason", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, logger *slog.Logger) error {
	cfg, err := parseConfig(args)
	if err != nil {
		return err
	}
	var authorization interface {
		Middleware(http.Handler) http.Handler
	}
	if cfg.public {
		authorization = pushrelay.NewPublicGate(pushrelay.PublicGateConfig{GlobalRate: cfg.globalRate, GlobalBurst: cfg.globalBurst, IPRate: cfg.ipRate, IPBurst: cfg.ipBurst, TokenRate: cfg.tokenRate, TokenBurst: cfg.tokenBurst})
		logger.Warn("public relay mode enabled; accepting all Instances with rate limits")
	} else {
		keys, err := pushrelay.ParsePublicKeys(cfg.publicKeys)
		if err != nil {
			return fmt.Errorf("ALLCHAT_RELAY_PUBLIC_KEYS: %w", err)
		}
		authorization = pushrelay.Verifier{Keys: keys, MaxSkew: 5 * time.Minute, Logger: logger}
	}

	// Provider clients are constructed exactly once and shared by every worker.
	firebaseApp, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: cfg.firebaseProject})
	if err != nil {
		return fmt.Errorf("initialize Firebase: %w", err)
	}
	fcmClient, err := firebaseApp.Messaging(ctx)
	if err != nil {
		return fmt.Errorf("initialize FCM: %w", err)
	}
	var apnsClient pushrelay.APNSClient
	if cfg.apnsKeyFile != "" {
		authKey, err := token.AuthKeyFromFile(cfg.apnsKeyFile)
		if err != nil {
			return fmt.Errorf("load APNs authentication key: %w", err)
		}
		client := apns2.NewTokenClient(&token.Token{AuthKey: authKey, KeyID: cfg.apnsKeyID, TeamID: cfg.apnsTeamID})
		if cfg.apnsProduction {
			client = client.Production()
		} else {
			client = client.Development()
		}
		apnsClient = client
	} else {
		logger.Info("APNs is disabled; iOS push jobs will fail delivery")
	}

	providers := pushrelay.Providers{
		FCM: fcmClient, APNS: apnsClient,
		APNSTopic: cfg.apnsTopic, APNSVOIPTopic: cfg.apnsVOIPTopic,
	}
	relay, err := pushrelay.New(providers, logger, cfg.workers, cfg.queueCapacity)
	if err != nil {
		return err
	}
	server := &http.Server{
		Addr:              cfg.listen,
		Handler:           relay.Handler(authorization),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	stopContext, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	serveErrors := make(chan error, 1)
	go func() {
		logger.Info("push relay listening", "address", cfg.listen, "workers", cfg.workers, "queue_capacity", cfg.queueCapacity)
		serveErrors <- server.ListenAndServe()
	}()

	select {
	case <-stopContext.Done():
		logger.Info("shutdown requested; stopping HTTP intake")
		shutdownContext, cancel := context.WithTimeout(context.Background(), cfg.shutdownTimeout)
		err = server.Shutdown(shutdownContext)
		cancel()
		if err != nil {
			_ = server.Close()
			logger.Warn("HTTP shutdown deadline exceeded", "reason", err)
		}
	case err = <-serveErrors:
		if err != nil && err != http.ErrServerClosed {
			_ = server.Close()
			relay.Drain()
			return fmt.Errorf("serve HTTP: %w", err)
		}
	}

	logger.Info("draining accepted push jobs")
	relay.Drain()
	logger.Info("push relay drained")
	return nil
}

func parseConfig(args []string) (config, error) {
	cfg := config{
		publicKeys:      os.Getenv("ALLCHAT_RELAY_PUBLIC_KEYS"),
		firebaseProject: os.Getenv("ALLCHAT_FIREBASE_PROJECT_ID"),
		apnsKeyFile:     os.Getenv("ALLCHAT_APNS_KEY_FILE"),
		apnsKeyID:       os.Getenv("ALLCHAT_APNS_KEY_ID"),
		apnsTeamID:      os.Getenv("ALLCHAT_APNS_TEAM_ID"),
		apnsTopic:       os.Getenv("ALLCHAT_APNS_TOPIC"),
		apnsVOIPTopic:   os.Getenv("ALLCHAT_APNS_VOIP_TOPIC"),
		apnsProduction:  envBool("ALLCHAT_APNS_PRODUCTION", true),
		public:          envBool("ALLCHAT_RELAY_PUBLIC", false),
	}
	flags := flag.NewFlagSet("allchat-push-relay", flag.ContinueOnError)
	flags.StringVar(&cfg.listen, "listen", ":8090", "HTTP listen address")
	flags.IntVar(&cfg.workers, "workers", 100, "push delivery worker count")
	flags.IntVar(&cfg.queueCapacity, "queue-capacity", 10000, "maximum queued pushes")
	flags.DurationVar(&cfg.shutdownTimeout, "shutdown-timeout", 15*time.Second, "HTTP shutdown timeout")
	flags.BoolVar(&cfg.public, "public", cfg.public, "accept all Instances with stateless rate limiting")
	flags.Float64Var(&cfg.globalRate, "public-global-rate", 500, "public-mode total requests per second")
	flags.IntVar(&cfg.globalBurst, "public-global-burst", 1000, "public-mode total request burst")
	flags.Float64Var(&cfg.ipRate, "public-ip-rate", 20, "public-mode requests per second per source IP")
	flags.IntVar(&cfg.ipBurst, "public-ip-burst", 100, "public-mode source IP burst")
	flags.Float64Var(&cfg.tokenRate, "public-token-rate", 1, "public-mode requests per second per device token")
	flags.IntVar(&cfg.tokenBurst, "public-token-burst", 20, "public-mode device token burst")
	if err := flags.Parse(args); err != nil {
		return config{}, err
	}
	if flags.NArg() != 0 {
		return config{}, fmt.Errorf("unexpected arguments: %v", flags.Args())
	}
	if cfg.workers < 1 || cfg.queueCapacity < 1 || cfg.shutdownTimeout <= 0 || cfg.globalRate <= 0 || cfg.ipRate <= 0 || cfg.tokenRate <= 0 || cfg.globalBurst < 1 || cfg.ipBurst < 1 || cfg.tokenBurst < 1 {
		return config{}, fmt.Errorf("workers, queue-capacity, and shutdown-timeout must be positive")
	}
	if !cfg.public && strings.TrimSpace(cfg.publicKeys) == "" {
		return config{}, fmt.Errorf("ALLCHAT_RELAY_PUBLIC_KEYS is required unless public mode is enabled")
	}
	if cfg.firebaseProject == "" {
		return config{}, fmt.Errorf("ALLCHAT_FIREBASE_PROJECT_ID is required")
	}
	apnsValues := []string{cfg.apnsKeyFile, cfg.apnsKeyID, cfg.apnsTeamID, cfg.apnsTopic}
	apnsConfigured := 0
	for _, value := range apnsValues {
		if value != "" {
			apnsConfigured++
		}
	}
	if apnsConfigured != 0 && apnsConfigured != len(apnsValues) {
		return config{}, fmt.Errorf("APNs is optional, but ALLCHAT_APNS_KEY_FILE, ALLCHAT_APNS_KEY_ID, ALLCHAT_APNS_TEAM_ID, and ALLCHAT_APNS_TOPIC must all be set when enabled")
	}
	if apnsConfigured == len(apnsValues) && cfg.apnsVOIPTopic == "" {
		cfg.apnsVOIPTopic = cfg.apnsTopic + ".voip"
	}
	return cfg, nil
}

func envBool(name string, fallback bool) bool {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
