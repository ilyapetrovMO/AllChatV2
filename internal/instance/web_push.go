// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"allchat/internal/community"
)

const (
	webPushWorkers       = 4
	webPushQueueCapacity = 256
)

type webPushKeys struct {
	Public  string `json:"public_key"`
	Private string `json:"private_key"`
}

type webPushService struct {
	db        *sql.DB
	community *community.Service
	logger    *slog.Logger
	keys      webPushKeys
	client    *http.Client
	queue     chan community.Message
	workers   sync.WaitGroup
	queueMu   sync.RWMutex
	closed    bool
}

type storedWebPushSubscription struct {
	MemberID, Endpoint, P256DH, Auth             string
	CommunityLevel, ChannelLevel                 string
	CommunityMuted, CommunitySound, ChannelMuted bool
}

func newWebPushService(db *sql.DB, communityService *community.Service, dataDir string, logger *slog.Logger) (*webPushService, error) {
	keys, err := loadOrCreateWebPushKeys(filepath.Join(dataDir, "web-push-vapid.json"))
	if err != nil {
		return nil, err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 100
	transport.MaxIdleConnsPerHost = 20
	service := &webPushService{
		db: db, community: communityService, logger: logger, keys: keys,
		client: &http.Client{Transport: transport, Timeout: 15 * time.Second},
		queue:  make(chan community.Message, webPushQueueCapacity),
	}
	for range webPushWorkers {
		service.workers.Add(1)
		go service.work()
	}
	return service, nil
}

func loadOrCreateWebPushKeys(path string) (webPushKeys, error) {
	data, err := os.ReadFile(path)
	if err == nil {
		var keys webPushKeys
		if json.Unmarshal(data, &keys) != nil || keys.Public == "" || keys.Private == "" {
			return webPushKeys{}, fmt.Errorf("invalid VAPID key file %s", path)
		}
		if err := os.Chmod(path, 0o600); err != nil {
			return webPushKeys{}, err
		}
		return keys, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return webPushKeys{}, err
	}
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return webPushKeys{}, err
	}
	keys := webPushKeys{Public: publicKey, Private: privateKey}
	encoded, err := json.Marshal(keys)
	if err != nil {
		return webPushKeys{}, err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, encoded, 0o600); err != nil {
		return webPushKeys{}, err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return webPushKeys{}, err
	}
	return keys, nil
}

func (service *webPushService) Enqueue(message community.Message) {
	service.queueMu.RLock()
	defer service.queueMu.RUnlock()
	if service.closed {
		return
	}
	select {
	case service.queue <- message:
	default:
		service.logger.Warn("Web Push queue is full", "channel_id", message.ChannelID)
	}
}

func (service *webPushService) Close() {
	service.queueMu.Lock()
	if !service.closed {
		service.closed = true
		close(service.queue)
	}
	service.queueMu.Unlock()
	service.workers.Wait()
}

func (service *webPushService) work() {
	defer service.workers.Done()
	for message := range service.queue {
		if err := service.deliverMessage(context.Background(), message); err != nil {
			service.logger.Warn("Web Push notification failed", "channel_id", message.ChannelID, "reason", err)
		}
	}
}

func (service *webPushService) deliverMessage(ctx context.Context, message community.Message) error {
	subscriptions, direct, channelName, err := service.subscriptionsForMessage(ctx, message)
	if err != nil {
		return err
	}
	mentioned := make(map[string]bool, len(message.Mentions))
	for _, mention := range message.Mentions {
		mentioned[mention.MemberID] = true
	}
	preview := strings.Join(strings.Fields(message.Body), " ")
	if preview == "" {
		preview = "Sent an attachment"
	}
	previewRunes := []rune(preview)
	if len(previewRunes) > 180 {
		preview = string(previewRunes[:177]) + "..."
	}
	title := message.AuthorName
	if !direct {
		title += " in #" + channelName
	}
	for _, subscription := range subscriptions {
		if !shouldSendWebPush(subscription, mentioned[subscription.MemberID]) {
			continue
		}
		allowed, permissionErr := service.community.CanUseChannel(ctx, subscription.MemberID, message.ChannelID, community.PermissionViewChannels, true)
		if permissionErr != nil || !allowed {
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"title": title, "body": preview, "url": "/channels/" + url.PathEscape(message.ChannelID),
			"tag": "allchat-" + message.ChannelID, "icon": "/favicon.ico", "silent": !subscription.CommunitySound,
		})
		requestContext, cancel := context.WithTimeout(ctx, 15*time.Second)
		response, sendErr := webpush.SendNotificationWithContext(requestContext, payload, &webpush.Subscription{
			Endpoint: subscription.Endpoint,
			Keys:     webpush.Keys{P256dh: subscription.P256DH, Auth: subscription.Auth},
		}, &webpush.Options{
			HTTPClient: service.client, Subscriber: "mailto:push@allchat.invalid",
			VAPIDPublicKey: service.keys.Public, VAPIDPrivateKey: service.keys.Private,
			TTL: 86400, Topic: webPushTopic(message.ChannelID),
		})
		cancel()
		if response != nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
			response.Body.Close()
			if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone {
				_, _ = service.db.ExecContext(ctx, "DELETE FROM web_push_subscriptions WHERE endpoint = ?", subscription.Endpoint)
			}
		}
		if sendErr != nil {
			service.logger.Warn("Web Push delivery failed", "member_id", subscription.MemberID, "reason", sendErr)
		} else if response != nil && (response.StatusCode < 200 || response.StatusCode >= 300) {
			service.logger.Warn("Web Push provider rejected notification", "member_id", subscription.MemberID, "status", response.StatusCode)
		}
	}
	return nil
}

func (service *webPushService) subscriptionsForMessage(ctx context.Context, message community.Message) ([]storedWebPushSubscription, bool, string, error) {
	var direct bool
	var channelName string
	if err := service.db.QueryRowContext(ctx, `SELECT c.name, EXISTS(SELECT 1 FROM direct_messages dm WHERE dm.id=c.id) FROM channels c WHERE c.id=?`, message.ChannelID).Scan(&channelName, &direct); err != nil {
		return nil, false, "", err
	}
	rows, err := service.db.QueryContext(ctx, `SELECT s.member_id,s.endpoint,s.p256dh,s.auth,
		COALESCE(mns.level,'all_messages'),COALESCE(mns.muted,0),COALESCE(mns.sound_enabled,1),
		COALESCE(cns.level,'default'),COALESCE(cns.muted,0)
		FROM web_push_subscriptions s
		JOIN sessions se ON se.session_id=s.session_id AND se.revoked_at IS NULL AND se.expires_at>?
		LEFT JOIN member_notification_settings mns ON mns.member_id=s.member_id
		LEFT JOIN channel_notification_settings cns ON cns.member_id=s.member_id AND cns.channel_id=?
		WHERE s.member_id<>? AND (NOT ? OR EXISTS(SELECT 1 FROM direct_messages dm WHERE dm.id=? AND s.member_id IN(dm.member_low_id,dm.member_high_id)))`, time.Now().UTC().Format(time.RFC3339Nano), message.ChannelID, message.AuthorID, direct, message.ChannelID)
	if err != nil {
		return nil, false, "", err
	}
	defer rows.Close()
	var subscriptions []storedWebPushSubscription
	for rows.Next() {
		var item storedWebPushSubscription
		if err := rows.Scan(&item.MemberID, &item.Endpoint, &item.P256DH, &item.Auth, &item.CommunityLevel, &item.CommunityMuted, &item.CommunitySound, &item.ChannelLevel, &item.ChannelMuted); err != nil {
			return nil, false, "", err
		}
		subscriptions = append(subscriptions, item)
	}
	return subscriptions, direct, channelName, rows.Err()
}

func shouldSendWebPush(subscription storedWebPushSubscription, mentioned bool) bool {
	if subscription.CommunityMuted || subscription.ChannelMuted {
		return false
	}
	level := subscription.ChannelLevel
	if level == "default" || level == "" {
		level = subscription.CommunityLevel
	}
	return level == "all_messages" || (level == "mentions_only" && mentioned)
}

func webPushTopic(channelID string) string {
	encoded := base64.RawURLEncoding.EncodeToString([]byte(channelID))
	if len(encoded) > 32 {
		return encoded[:32]
	}
	return encoded
}

func validWebPushEndpoint(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Hostname() == "" || net.ParseIP(parsed.Hostname()) != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	for _, suffix := range []string{".googleapis.com", ".mozilla.com", ".push.apple.com", ".notify.windows.com"} {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

func validSubscriptionKey(value string, expectedLength int) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		decoded, err = base64.URLEncoding.DecodeString(value)
	}
	return err == nil && len(decoded) == expectedLength
}

func (i *Instance) webPushConfigAPI(response http.ResponseWriter, request *http.Request) {
	if _, _, ok := i.authenticated(response, request); !ok {
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"public_key": i.webPush.keys.Public})
}

func (i *Instance) webPushSubscriptionAPI(response http.ResponseWriter, request *http.Request) {
	member, sessionToken, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var subscription webpush.Subscription
	if decodeJSON(request, &subscription) != nil || !validWebPushEndpoint(subscription.Endpoint) || !validSubscriptionKey(subscription.Keys.Auth, 16) || !validSubscriptionKey(subscription.Keys.P256dh, 65) {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid Web Push subscription"})
		return
	}
	tokenHash := sha256.Sum256([]byte(sessionToken))
	_, err := i.db.ExecContext(request.Context(), `INSERT INTO web_push_subscriptions(endpoint,member_id,session_id,p256dh,auth,created_at)
		SELECT ?,?,session_id,?,?,? FROM sessions WHERE token_hash=? AND member_id=? AND revoked_at IS NULL
		ON CONFLICT(endpoint) DO UPDATE SET member_id=excluded.member_id,session_id=excluded.session_id,p256dh=excluded.p256dh,auth=excluded.auth,created_at=excluded.created_at`,
		subscription.Endpoint, member.ID, subscription.Keys.P256dh, subscription.Keys.Auth, time.Now().UTC().Format(time.RFC3339Nano), tokenHash[:], member.ID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "could not save Web Push subscription"})
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (i *Instance) deleteWebPushSubscriptionAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	var input struct {
		Endpoint string `json:"endpoint"`
	}
	if decodeJSON(request, &input) != nil || input.Endpoint == "" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid Web Push subscription"})
		return
	}
	if _, err := i.db.ExecContext(request.Context(), "DELETE FROM web_push_subscriptions WHERE endpoint=? AND member_id=?", input.Endpoint, member.ID); err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "could not remove Web Push subscription"})
		return
	}
	response.WriteHeader(http.StatusNoContent)
}
