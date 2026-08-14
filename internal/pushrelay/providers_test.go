package pushrelay

import (
	"context"
	"testing"

	"firebase.google.com/go/v4/messaging"
	"github.com/sideshow/apns2"
)

type fakeFCM struct{ message *messaging.Message }

func (fake *fakeFCM) Send(_ context.Context, message *messaging.Message) (string, error) {
	fake.message = message
	return "message-id", nil
}

type fakeAPNS struct{ notification *apns2.Notification }

func (fake *fakeAPNS) PushWithContext(_ apns2.Context, notification *apns2.Notification) (*apns2.Response, error) {
	fake.notification = notification
	return &apns2.Response{StatusCode: 200}, nil
}

func TestProvidersMapJobs(t *testing.T) {
	fcm := &fakeFCM{}
	apns := &fakeAPNS{}
	providers := Providers{FCM: fcm, APNS: apns, APNSTopic: "org.allchat", APNSVOIPTopic: "org.allchat.voip"}

	android := PushJob{Platform: "android", Kind: "message", Token: "android-token", Payload: "encrypted", CollapseID: "thread"}
	if err := providers.Send(context.Background(), android); err != nil {
		t.Fatal(err)
	}
	if fcm.message.Token != android.Token || fcm.message.Data["payload"] != android.Payload || fcm.message.Android.Priority != "high" {
		t.Fatalf("unexpected FCM message: %#v", fcm.message)
	}

	ios := PushJob{Platform: "ios", Kind: "call", Token: "ios-token", Payload: "encrypted"}
	if err := providers.Send(context.Background(), ios); err != nil {
		t.Fatal(err)
	}
	if apns.notification.Topic != "org.allchat.voip" || apns.notification.PushType != apns2.PushTypeVOIP || apns.notification.Priority != apns2.PriorityHigh {
		t.Fatalf("unexpected APNs notification: %#v", apns.notification)
	}
}
