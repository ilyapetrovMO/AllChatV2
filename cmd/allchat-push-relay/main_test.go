package main

import (
	"strings"
	"testing"
)

func TestParseConfigAllowsAndroidOnlyRelay(t *testing.T) {
	clearProviderEnvironment(t)
	t.Setenv("ALLCHAT_FIREBASE_PROJECT_ID", "allchat-mobile")
	cfg, err := parseConfig(nil)
	if err != nil {
		t.Fatalf("parse Android-only config: %v", err)
	}
	if cfg.apnsKeyFile != "" || cfg.apnsTopic != "" {
		t.Fatalf("APNs unexpectedly configured: %+v", cfg)
	}
}

func TestParseConfigRejectsPartialAPNSConfiguration(t *testing.T) {
	clearProviderEnvironment(t)
	t.Setenv("ALLCHAT_FIREBASE_PROJECT_ID", "allchat-mobile")
	t.Setenv("ALLCHAT_APNS_KEY_ID", "ABC123")
	_, err := parseConfig(nil)
	if err == nil || !strings.Contains(err.Error(), "APNs is optional") {
		t.Fatalf("partial APNs error = %v", err)
	}
}

func clearProviderEnvironment(t *testing.T) {
	for _, name := range []string{
		"ALLCHAT_FIREBASE_PROJECT_ID", "ALLCHAT_APNS_KEY_FILE", "ALLCHAT_APNS_KEY_ID",
		"ALLCHAT_APNS_TEAM_ID", "ALLCHAT_APNS_TOPIC", "ALLCHAT_APNS_VOIP_TOPIC",
	} {
		t.Setenv(name, "")
	}
}
