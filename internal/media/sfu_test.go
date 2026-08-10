package media

import (
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

func TestAcceptOfferNegotiatesRealPionPeer(t *testing.T) {
	manager := NewManager(5 * time.Second)
	defer manager.Close()
	client, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2}, "microphone", "test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = client.AddTrack(track); err != nil {
		t.Fatal(err)
	}
	if _, err = client.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
		t.Fatal(err)
	}
	offer, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(client)
	if err = client.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gathered:
	case <-time.After(5 * time.Second):
		t.Fatal("client ICE gathering timed out")
	}
	answer, _, err := manager.AcceptOffer("member", "room", *client.LocalDescription(), func(Signal) {})
	if err != nil {
		t.Fatal(err)
	}
	if err = client.SetRemoteDescription(answer); err != nil {
		t.Fatal(err)
	}
	connected := make(chan struct{}, 1)
	client.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateConnected {
			select {
			case connected <- struct{}{}:
			default:
			}
		}
	})
	select {
	case <-connected:
	case <-time.After(10 * time.Second):
		t.Fatalf("client state = %s, want connected", client.ConnectionState())
	}
	if participants := manager.Participants("room"); len(participants) != 1 || participants[0].MemberID != "member" {
		t.Fatalf("participants = %+v", participants)
	}
}
