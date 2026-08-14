package pushrelay

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"firebase.google.com/go/v4/messaging"
	"github.com/sideshow/apns2"
)

type FCMClient interface {
	Send(context.Context, *messaging.Message) (string, error)
}

type APNSClient interface {
	PushWithContext(apns2.Context, *apns2.Notification) (*apns2.Response, error)
}

type Providers struct {
	FCM           FCMClient
	APNS          APNSClient
	APNSTopic     string
	APNSVOIPTopic string
}

func (p Providers) Send(ctx context.Context, job PushJob) error {
	if job.Platform == "android" {
		return p.sendFCM(ctx, job)
	}
	return p.sendAPNS(ctx, job)
}

func (p Providers) sendFCM(ctx context.Context, job PushJob) error {
	if p.FCM == nil {
		return fmt.Errorf("provider_unavailable")
	}
	ttl := 30 * time.Second
	if normalizedKind(job.Kind) == "message" {
		ttl = 24 * time.Hour
	}
	_, err := p.FCM.Send(ctx, &messaging.Message{
		Token:   job.Token,
		Data:    map[string]string{"payload": job.Payload, "kind": normalizedKind(job.Kind)},
		Android: &messaging.AndroidConfig{Priority: "high", TTL: &ttl, CollapseKey: job.CollapseID},
	})
	if err != nil {
		return fmt.Errorf("fcm_%s", fcmErrorCode(err))
	}
	return nil
}

func (p Providers) sendAPNS(ctx context.Context, job PushJob) error {
	if p.APNS == nil {
		return fmt.Errorf("provider_unavailable")
	}
	payload, err := json.Marshal(map[string]any{
		"aps":     map[string]any{"content-available": 1},
		"payload": job.Payload,
		"kind":    normalizedKind(job.Kind),
	})
	if err != nil {
		return fmt.Errorf("payload_encoding")
	}
	notification := &apns2.Notification{
		DeviceToken: job.Token, Payload: payload, CollapseID: job.CollapseID,
		Topic: p.APNSTopic, Priority: apns2.PriorityLow, PushType: apns2.PushTypeBackground,
		Expiration: time.Now().Add(24 * time.Hour),
	}
	if normalizedKind(job.Kind) == "call" {
		notification.Topic = p.APNSVOIPTopic
		notification.Priority = apns2.PriorityHigh
		notification.PushType = apns2.PushTypeVOIP
		notification.Expiration = time.Now().Add(30 * time.Second)
	}
	result, err := p.APNS.PushWithContext(ctx, notification)
	if err != nil {
		return fmt.Errorf("apns_transport")
	}
	if !result.Sent() {
		return fmt.Errorf("apns_%s", result.Reason)
	}
	return nil
}

func fcmErrorCode(err error) string {
	switch {
	case messaging.IsRegistrationTokenNotRegistered(err), messaging.IsUnregistered(err):
		return "unregistered"
	case messaging.IsInvalidArgument(err):
		return "invalid_argument"
	case messaging.IsQuotaExceeded(err), messaging.IsMessageRateExceeded(err):
		return "quota_exceeded"
	case messaging.IsSenderIDMismatch(err), messaging.IsMismatchedCredential(err):
		return "credential_mismatch"
	case messaging.IsThirdPartyAuthError(err):
		return "authentication"
	case messaging.IsServerUnavailable(err), messaging.IsUnavailable(err):
		return "unavailable"
	case messaging.IsInternal(err):
		return "internal"
	default:
		return "unknown"
	}
}
