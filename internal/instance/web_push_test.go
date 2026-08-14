package instance

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWebPushKeysAreGeneratedOnceAndKeptPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "web-push-vapid.json")
	first, err := loadOrCreateWebPushKeys(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := loadOrCreateWebPushKeys(path)
	if err != nil {
		t.Fatal(err)
	}
	if first != second || first.Public == "" || first.Private == "" {
		t.Fatal("VAPID identity was not persisted")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("VAPID key permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestWebPushEndpointValidationPreventsSSRF(t *testing.T) {
	for _, endpoint := range []string{
		"https://fcm.googleapis.com/fcm/send/id",
		"https://updates.push.services.mozilla.com/wpush/v2/id",
		"https://web.push.apple.com/QWERTY",
		"https://wns2-db5p.notify.windows.com/w/?token=id",
	} {
		if !validWebPushEndpoint(endpoint) {
			t.Errorf("valid endpoint rejected: %s", endpoint)
		}
	}
	for _, endpoint := range []string{"http://fcm.googleapis.com/id", "https://127.0.0.1/push", "https://example.com/push", "not a URL"} {
		if validWebPushEndpoint(endpoint) {
			t.Errorf("unsafe endpoint accepted: %s", endpoint)
		}
	}
}

func TestWebPushRespectsNotificationLevels(t *testing.T) {
	tests := []struct {
		name         string
		subscription storedWebPushSubscription
		mentioned    bool
		want         bool
	}{
		{name: "all messages", subscription: storedWebPushSubscription{CommunityLevel: "all_messages", ChannelLevel: "default", CommunitySound: true}, want: true},
		{name: "mention", subscription: storedWebPushSubscription{CommunityLevel: "mentions_only", ChannelLevel: "default"}, mentioned: true, want: true},
		{name: "not mentioned", subscription: storedWebPushSubscription{CommunityLevel: "mentions_only", ChannelLevel: "default"}},
		{name: "channel override", subscription: storedWebPushSubscription{CommunityLevel: "nothing", ChannelLevel: "all_messages"}, want: true},
		{name: "community muted", subscription: storedWebPushSubscription{CommunityLevel: "all_messages", ChannelLevel: "default", CommunityMuted: true}},
		{name: "channel muted", subscription: storedWebPushSubscription{CommunityLevel: "all_messages", ChannelLevel: "default", ChannelMuted: true}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := shouldSendWebPush(test.subscription, test.mentioned); got != test.want {
				t.Fatalf("shouldSendWebPush() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestEmbeddedWebPushWorkerShowsAndOpensNotifications(t *testing.T) {
	source, err := embeddedWeb.ReadFile("web/assets/push-service-worker.js")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, expected := range []string{"showNotification", "notificationclick", "clients.openWindow"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("service worker lacks %q", expected)
		}
	}
}
