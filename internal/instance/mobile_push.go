// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"allchat/internal/community"
	"allchat/internal/pushrelay"
)

const mobilePushQueueCapacity = 256

func MobilePushRelayIdentity(dataDir string) (string, error) {
	publicKey, _, err := loadOrCreateMobilePushSigningKey(filepath.Join(dataDir, "mobile-push-signing.json"))
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(publicKey)
	return "instance-" + base64.RawURLEncoding.EncodeToString(digest[:12]) + "=" + base64.RawURLEncoding.EncodeToString(publicKey), nil
}

type mobilePushSigningKeys struct {
	Public  string `json:"public_key"`
	Private string `json:"private_key"`
}

type mobilePushEvent struct {
	Message     *community.Message
	Kind        string
	CallID      string
	ChannelID   string
	AuthorID    string
	AuthorName  string
	RecipientID string
}

type mobilePushSubscription struct {
	MemberID, Token, Platform, PublicKey, InstanceURL string
	CommunityLevel, ChannelLevel                      string
	CommunityMuted, CommunitySound, ChannelMuted      bool
}

type mobilePushService struct {
	db         *sql.DB
	community  *community.Service
	logger     *slog.Logger
	privateKey ed25519.PrivateKey
	publicKey  ed25519.PublicKey
	keyID      string
	client     *http.Client
	queue      chan mobilePushEvent
	queueMu    sync.RWMutex
	closed     bool
	workers    sync.WaitGroup
}

func newMobilePushService(db *sql.DB, communityService *community.Service, dataDir string, logger *slog.Logger) (*mobilePushService, error) {
	publicKey, privateKey, err := loadOrCreateMobilePushSigningKey(filepath.Join(dataDir, "mobile-push-signing.json"))
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(publicKey)
	service := &mobilePushService{
		db: db, community: communityService, logger: logger, privateKey: privateKey, publicKey: publicKey,
		keyID:  "instance-" + base64.RawURLEncoding.EncodeToString(digest[:12]),
		client: &http.Client{Timeout: 15 * time.Second}, queue: make(chan mobilePushEvent, mobilePushQueueCapacity),
	}
	for range 4 {
		service.workers.Add(1)
		go service.work()
	}
	return service, nil
}

func loadOrCreateMobilePushSigningKey(path string) (ed25519.PublicKey, ed25519.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err == nil {
		var stored mobilePushSigningKeys
		if json.Unmarshal(data, &stored) != nil {
			return nil, nil, fmt.Errorf("invalid mobile push signing key")
		}
		publicKey, publicErr := base64.RawURLEncoding.DecodeString(stored.Public)
		privateKey, privateErr := base64.RawURLEncoding.DecodeString(stored.Private)
		if publicErr != nil || privateErr != nil || len(publicKey) != ed25519.PublicKeySize || len(privateKey) != ed25519.PrivateKeySize || !bytes.Equal(privateKey[32:], publicKey) {
			return nil, nil, fmt.Errorf("invalid mobile push signing key")
		}
		if err := os.Chmod(path, 0o600); err != nil {
			return nil, nil, err
		}
		return ed25519.PublicKey(publicKey), ed25519.PrivateKey(privateKey), nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, nil, err
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	encoded, _ := json.Marshal(mobilePushSigningKeys{Public: base64.RawURLEncoding.EncodeToString(publicKey), Private: base64.RawURLEncoding.EncodeToString(privateKey)})
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, encoded, 0o600); err != nil {
		return nil, nil, err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return nil, nil, err
	}
	return publicKey, privateKey, nil
}

func (service *mobilePushService) EnqueueMessage(message community.Message) {
	service.enqueue(mobilePushEvent{Message: &message, Kind: "message", ChannelID: message.ChannelID, AuthorID: message.AuthorID, AuthorName: message.AuthorName})
}

func (service *mobilePushService) EnqueueCall(callID, channelID, authorID, displayName, username, recipientID string) {
	authorName := displayName
	if authorName == "" {
		authorName = username
	}
	service.enqueue(mobilePushEvent{Kind: "call", CallID: callID, ChannelID: channelID, AuthorID: authorID, AuthorName: authorName, RecipientID: recipientID})
}

func (service *mobilePushService) enqueue(event mobilePushEvent) {
	service.queueMu.RLock()
	defer service.queueMu.RUnlock()
	if service.closed {
		return
	}
	select {
	case service.queue <- event:
	default:
		service.logger.Warn("mobile push queue is full", "kind", event.Kind)
	}
}

func (service *mobilePushService) Close() {
	service.queueMu.Lock()
	if !service.closed {
		service.closed = true
		close(service.queue)
	}
	service.queueMu.Unlock()
	service.workers.Wait()
}

func (service *mobilePushService) work() {
	defer service.workers.Done()
	for event := range service.queue {
		if err := service.deliver(context.Background(), event); err != nil {
			service.logger.Warn("mobile push event failed", "kind", event.Kind, "reason", err)
		}
	}
}

func (service *mobilePushService) deliver(ctx context.Context, event mobilePushEvent) error {
	relayURL, err := service.relayURL(ctx)
	if err != nil || relayURL == "" {
		return err
	}
	subscriptions, channelName, err := service.subscriptions(ctx, event)
	if err != nil {
		return err
	}
	mentioned := map[string]bool{}
	if event.Message != nil {
		for _, mention := range event.Message.Mentions {
			mentioned[mention.MemberID] = true
		}
	}
	avatarVersion, err := service.avatarVersion(ctx, event.AuthorID)
	if err != nil {
		return err
	}
	skippedPolicy, skippedPermission, invalidEncryption, attempted, accepted := 0, 0, 0, 0, 0
	for _, subscription := range subscriptions {
		if event.Kind == "message" && !shouldSendMobilePush(subscription, mentioned[subscription.MemberID]) {
			skippedPolicy++
			continue
		}
		if event.Kind == "message" {
			allowed, permissionErr := service.community.CanUseChannel(ctx, subscription.MemberID, event.ChannelID, community.PermissionViewChannels, true)
			if permissionErr != nil || !allowed {
				skippedPermission++
				continue
			}
		}
		payload := mobilePushPayload(event, subscription, channelName, avatarVersion)
		encrypted, encryptErr := encryptMobilePushPayload(subscription.PublicKey, payload)
		if encryptErr != nil {
			invalidEncryption++
			service.logger.Warn("invalid mobile push encryption key", "kind", event.Kind, "platform", subscription.Platform, "token_fingerprint", pushrelay.TokenFingerprint(subscription.Token))
			continue
		}
		job := pushrelay.PushJob{Platform: subscription.Platform, Kind: event.Kind, Token: subscription.Token, Payload: encrypted, CollapseID: event.ChannelID}
		requestID := pushrelay.NewRequestID()
		attempted++
		started := time.Now()
		if err := service.send(ctx, relayURL, requestID, job); err != nil {
			service.logger.Warn("mobile push relay rejected request", "request_id", requestID, "kind", event.Kind, "platform", subscription.Platform, "token_fingerprint", pushrelay.TokenFingerprint(subscription.Token), "duration_ms", time.Since(started).Milliseconds(), "status", err)
		} else {
			accepted++
			service.logger.Info("mobile push relay accepted request", "request_id", requestID, "kind", event.Kind, "platform", subscription.Platform, "token_fingerprint", pushrelay.TokenFingerprint(subscription.Token), "duration_ms", time.Since(started).Milliseconds())
		}
	}
	service.logger.Info("mobile push event evaluated", "kind", event.Kind, "candidate_subscriptions", len(subscriptions), "attempted", attempted, "accepted", accepted, "skipped_policy", skippedPolicy, "skipped_permission", skippedPermission, "invalid_encryption", invalidEncryption)
	return nil
}

func mobilePushPayload(event mobilePushEvent, subscription mobilePushSubscription, channelName, avatarVersion string) map[string]any {
	payload := map[string]any{
		"version": 2, "kind": event.Kind, "instance_url": subscription.InstanceURL,
		"conversation_id": event.ChannelID, "author_id": event.AuthorID,
		"author": event.AuthorName, "sound": subscription.CommunitySound,
	}
	if avatarVersion != "" {
		payload["avatar_version"] = avatarVersion
	}
	if event.Kind == "call" {
		payload["call_id"] = event.CallID
		payload["title"] = "Incoming call"
		payload["body"] = event.AuthorName + " is calling"
		return payload
	}
	preview := strings.Join(strings.Fields(event.Message.Body), " ")
	if preview == "" {
		preview = "Sent an attachment"
	}
	runes := []rune(preview)
	if len(runes) > 160 {
		preview = string(runes[:157]) + "..."
	}
	payload["title"] = event.AuthorName
	if channelName != "" {
		payload["title"] = event.AuthorName + " in #" + channelName
	}
	payload["body"] = preview
	return payload
}

func (service *mobilePushService) avatarVersion(ctx context.Context, memberID string) (string, error) {
	var avatar []byte
	err := service.db.QueryRowContext(ctx, "SELECT avatar FROM members WHERE id=? AND avatar IS NOT NULL", memberID).Scan(&avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(avatar)
	return base64.RawURLEncoding.EncodeToString(digest[:12]), nil
}

func (service *mobilePushService) relayURL(ctx context.Context) (string, error) {
	var value string
	err := service.db.QueryRowContext(ctx, "SELECT relay_url FROM mobile_push_settings WHERE id=1").Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return strings.TrimRight(value, "/"), err
}

func (service *mobilePushService) subscriptions(ctx context.Context, event mobilePushEvent) ([]mobilePushSubscription, string, error) {
	channelName := ""
	direct := event.Kind == "call"
	if event.Kind == "message" {
		if err := service.db.QueryRowContext(ctx, `SELECT CASE WHEN EXISTS(SELECT 1 FROM direct_messages dm WHERE dm.id=c.id) THEN '' ELSE c.name END, EXISTS(SELECT 1 FROM direct_messages dm WHERE dm.id=c.id) FROM channels c WHERE c.id=?`, event.ChannelID).Scan(&channelName, &direct); err != nil {
			return nil, "", err
		}
	}
	rows, err := service.db.QueryContext(ctx, `SELECT s.member_id,s.token,s.platform,s.public_key,s.instance_url,
		COALESCE(mns.level,'all_messages'),COALESCE(mns.muted,0),COALESCE(mns.sound_enabled,1),COALESCE(cns.level,'default'),COALESCE(cns.muted,0)
		FROM mobile_push_subscriptions s JOIN sessions se ON se.session_id=s.session_id AND se.revoked_at IS NULL AND se.expires_at>?
		LEFT JOIN member_notification_settings mns ON mns.member_id=s.member_id
		LEFT JOIN channel_notification_settings cns ON cns.member_id=s.member_id AND cns.channel_id=?
		WHERE s.member_id<>? AND (?='' OR s.member_id=?) AND (NOT ? OR EXISTS(SELECT 1 FROM direct_messages dm WHERE dm.id=? AND s.member_id IN(dm.member_low_id,dm.member_high_id)))`,
		time.Now().UTC().Format(time.RFC3339Nano), event.ChannelID, event.AuthorID, event.RecipientID, event.RecipientID, direct, event.ChannelID)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	var subscriptions []mobilePushSubscription
	for rows.Next() {
		var item mobilePushSubscription
		if err := rows.Scan(&item.MemberID, &item.Token, &item.Platform, &item.PublicKey, &item.InstanceURL, &item.CommunityLevel, &item.CommunityMuted, &item.CommunitySound, &item.ChannelLevel, &item.ChannelMuted); err != nil {
			return nil, "", err
		}
		subscriptions = append(subscriptions, item)
	}
	return subscriptions, channelName, rows.Err()
}

func shouldSendMobilePush(subscription mobilePushSubscription, mentioned bool) bool {
	if subscription.CommunityMuted || subscription.ChannelMuted {
		return false
	}
	level := subscription.ChannelLevel
	if level == "" || level == "default" {
		level = subscription.CommunityLevel
	}
	return level == "all_messages" || (level == "mentions_only" && mentioned)
}

func encryptMobilePushPayload(encodedPublicKey string, payload any) (string, error) {
	publicDER, err := base64.RawURLEncoding.DecodeString(encodedPublicKey)
	if err != nil {
		return "", err
	}
	parsed, err := x509.ParsePKIXPublicKey(publicDER)
	if err != nil {
		return "", err
	}
	publicKey, ok := parsed.(*rsa.PublicKey)
	if !ok || publicKey.N.BitLen() < 2048 {
		return "", fmt.Errorf("RSA key must be at least 2048 bits")
	}
	plaintext, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	aesKey := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, aesKey); err != nil {
		return "", err
	}
	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	wrappedKey, err := encryptAndroidOAEP(publicKey, aesKey)
	if err != nil {
		return "", err
	}
	envelope, _ := json.Marshal(map[string]string{
		"key": base64.RawURLEncoding.EncodeToString(wrappedKey), "nonce": base64.RawURLEncoding.EncodeToString(nonce), "ciphertext": base64.RawURLEncoding.EncodeToString(gcm.Seal(nil, nonce, plaintext, nil)),
	})
	return base64.RawURLEncoding.EncodeToString(envelope), nil
}

// encryptAndroidOAEP uses SHA-256 for OAEP and SHA-1 for MGF1. Android Keystore
// requires that combination, with an empty label, on supported pre-API-35 devices.
func encryptAndroidOAEP(publicKey *rsa.PublicKey, message []byte) ([]byte, error) {
	const hashSize = sha256.Size
	size := publicKey.Size()
	if len(message) > size-2*hashSize-2 {
		return nil, fmt.Errorf("message too long for RSA-OAEP")
	}
	encoded := make([]byte, size)
	seed := encoded[1 : 1+hashSize]
	database := encoded[1+hashSize:]
	labelHash := sha256.Sum256(nil)
	copy(database, labelHash[:])
	database[len(database)-len(message)-1] = 1
	copy(database[len(database)-len(message):], message)
	if _, err := io.ReadFull(rand.Reader, seed); err != nil {
		return nil, err
	}
	mgf1SHA1XOR(database, seed)
	mgf1SHA1XOR(seed, database)

	messageInteger := new(big.Int).SetBytes(encoded)
	ciphertextInteger := new(big.Int).Exp(messageInteger, big.NewInt(int64(publicKey.E)), publicKey.N)
	ciphertext := ciphertextInteger.Bytes()
	result := make([]byte, size)
	copy(result[size-len(ciphertext):], ciphertext)
	return result, nil
}

func mgf1SHA1XOR(output, seed []byte) {
	var counter [4]byte
	for offset := 0; offset < len(output); offset += sha1.Size {
		binary.BigEndian.PutUint32(counter[:], uint32(offset/sha1.Size))
		digest := sha1.New()
		_, _ = digest.Write(seed)
		_, _ = digest.Write(counter[:])
		mask := digest.Sum(nil)
		for index := 0; index < len(mask) && offset+index < len(output); index++ {
			output[offset+index] ^= mask[index]
		}
	}
}

func (service *mobilePushService) send(ctx context.Context, relayURL, requestID string, job pushrelay.PushJob) error {
	body, _ := json.Marshal(job)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, relayURL+"/api/v1/push", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(pushrelay.HeaderRequestID, requestID)
	pushrelay.SignRequest(request, body, service.keyID, service.privateKey, time.Now())
	response, err := service.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode != http.StatusAccepted {
		return fmt.Errorf("HTTP %d", response.StatusCode)
	}
	return nil
}

func validMobileInstanceURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil && parsed.RawQuery == "" && parsed.Fragment == ""
}

func (i *Instance) mobilePushConfigAPI(response http.ResponseWriter, request *http.Request) {
	if _, _, ok := i.authenticated(response, request); !ok {
		return
	}
	relayURL, _ := i.mobilePushRelayURL(request.Context())
	writeJSON(response, http.StatusOK, map[string]any{"enabled": relayURL != "", "relay_url": relayURL, "key_id": i.mobilePush.keyID, "public_key": base64.RawURLEncoding.EncodeToString(i.mobilePush.publicKey)})
}

func (i *Instance) mobilePushSubscriptionAPI(response http.ResponseWriter, request *http.Request) {
	member, sessionToken, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input struct {
		Token       string `json:"token"`
		Platform    string `json:"platform"`
		PublicKey   string `json:"public_key"`
		InstanceURL string `json:"instance_url"`
	}
	if decodeJSON(request, &input) != nil || (input.Platform != "android" && input.Platform != "ios") || len(input.Token) < 16 || len(input.Token) > 4096 || !validMobileInstanceURL(input.InstanceURL) {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid mobile push subscription"})
		return
	}
	if _, err := encryptMobilePushPayload(input.PublicKey, map[string]string{"test": "test"}); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid mobile push encryption key"})
		return
	}
	tokenHash := sha256.Sum256([]byte(sessionToken))
	result, err := i.db.ExecContext(request.Context(), `INSERT INTO mobile_push_subscriptions(token,member_id,session_id,platform,public_key,instance_url,created_at)
		SELECT ?,?,session_id,?,?,?,? FROM sessions WHERE token_hash=? AND member_id=? AND revoked_at IS NULL
		ON CONFLICT(token) DO UPDATE SET member_id=excluded.member_id,session_id=excluded.session_id,platform=excluded.platform,public_key=excluded.public_key,instance_url=excluded.instance_url,created_at=excluded.created_at`,
		input.Token, member.ID, input.Platform, input.PublicKey, input.InstanceURL, time.Now().UTC().Format(time.RFC3339Nano), tokenHash[:], member.ID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "could not save mobile push subscription"})
		return
	}
	if count, _ := result.RowsAffected(); count != 1 {
		writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "Session is no longer active"})
		return
	}
	i.logger.Info("mobile push subscription registered", "platform", input.Platform, "token_fingerprint", pushrelay.TokenFingerprint(input.Token))
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) deleteMobilePushSubscriptionAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input struct {
		Token string `json:"token"`
	}
	if decodeJSON(request, &input) != nil || input.Token == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid mobile push subscription"})
		return
	}
	_, err := i.db.ExecContext(request.Context(), "DELETE FROM mobile_push_subscriptions WHERE token=? AND member_id=?", input.Token, member.ID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "could not remove mobile push subscription"})
		return
	}
	i.logger.Info("mobile push subscription removed", "token_fingerprint", pushrelay.TokenFingerprint(input.Token))
	response.WriteHeader(http.StatusNoContent)
}
