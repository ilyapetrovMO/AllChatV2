package instance

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestMobilePushSigningIdentityIsStableAndPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mobile-push-signing.json")
	firstPublic, firstPrivate, err := loadOrCreateMobilePushSigningKey(path)
	if err != nil {
		t.Fatal(err)
	}
	secondPublic, secondPrivate, err := loadOrCreateMobilePushSigningKey(path)
	if err != nil {
		t.Fatal(err)
	}
	if !firstPublic.Equal(secondPublic) || !firstPrivate.Equal(secondPrivate) {
		t.Fatal("mobile push signing identity changed")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("signing key permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestMobilePushPayloadUsesHybridEncryption(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{"kind": "message", "body": "private content", "conversation_id": "channel"}
	encrypted, err := encryptMobilePushPayload(base64.RawURLEncoding.EncodeToString(publicDER), payload)
	if err != nil {
		t.Fatal(err)
	}
	encodedEnvelope, err := base64.RawURLEncoding.DecodeString(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]string
	if err := json.Unmarshal(encodedEnvelope, &envelope); err != nil {
		t.Fatal(err)
	}
	wrappedKey, _ := base64.RawURLEncoding.DecodeString(envelope["key"])
	aesKey, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, privateKey, wrappedKey, []byte("allchat-mobile-push-v1"))
	if err != nil {
		t.Fatal(err)
	}
	block, _ := aes.NewCipher(aesKey)
	gcm, _ := cipher.NewGCM(block)
	nonce, _ := base64.RawURLEncoding.DecodeString(envelope["nonce"])
	ciphertext, _ := base64.RawURLEncoding.DecodeString(envelope["ciphertext"])
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		t.Fatal(err)
	}
	if string(plaintext) == "" || string(plaintext) == string(encodedEnvelope) {
		t.Fatal("payload did not decrypt independently")
	}
	var decoded map[string]any
	if json.Unmarshal(plaintext, &decoded) != nil || decoded["body"] != "private content" {
		t.Fatalf("decrypted payload = %s", plaintext)
	}
}

func TestMobilePushNotificationPolicy(t *testing.T) {
	if !shouldSendMobilePush(mobilePushSubscription{CommunityLevel: "all_messages", ChannelLevel: "default"}, false) {
		t.Fatal("all-messages subscription rejected")
	}
	if shouldSendMobilePush(mobilePushSubscription{CommunityLevel: "mentions_only", ChannelLevel: "default"}, false) {
		t.Fatal("non-mention accepted by mentions-only subscription")
	}
	if !shouldSendMobilePush(mobilePushSubscription{CommunityLevel: "mentions_only", ChannelLevel: "default"}, true) {
		t.Fatal("structured Mention rejected")
	}
	if shouldSendMobilePush(mobilePushSubscription{CommunityLevel: "all_messages", ChannelLevel: "default", CommunityMuted: true}, true) {
		t.Fatal("muted subscription accepted")
	}
}

func TestPushRelayConfigurationRequiresHTTPS(t *testing.T) {
	var config Config
	if err := config.ConfigurePushRelay("https://ru.elitedarklord.com/"); err != nil || config.PushRelayURL != "https://ru.elitedarklord.com" {
		t.Fatalf("valid relay = %q, err=%v", config.PushRelayURL, err)
	}
	if err := config.ConfigurePushRelay("http://127.0.0.1:8090"); err == nil {
		t.Fatal("insecure relay accepted")
	}
}
