package media

import (
	"context"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
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

func TestSFUForwardsNonSimulcastScreenToExistingViewer(t *testing.T) {
	manager := NewManager(5 * time.Second)
	defer manager.Close()
	viewer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer viewer.Close()
	if _, err = viewer.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionSendrecv}); err != nil {
		t.Fatal(err)
	}
	videoPackets := make(chan struct{}, 1)
	viewer.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if track.Kind() != webrtc.RTPCodecTypeVideo {
			return
		}
		if _, _, readErr := track.ReadRTP(); readErr == nil {
			videoPackets <- struct{}{}
		}
	})
	viewerOffer, err := gatheredOffer(viewer)
	if err != nil {
		t.Fatal(err)
	}
	viewerSignals := make(chan Signal, 4)
	viewerAnswer, _, err := manager.AcceptOffer("viewer", "room", viewerOffer, func(signal Signal) { viewerSignals <- signal })
	if err != nil {
		t.Fatal(err)
	}
	if err = viewer.SetRemoteDescription(viewerAnswer); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case signal := <-viewerSignals:
				if signal.Type != "offer" || signal.SDP == nil {
					continue
				}
				if setErr := viewer.SetRemoteDescription(*signal.SDP); setErr != nil {
					return
				}
				answer, createErr := viewer.CreateAnswer(nil)
				if createErr != nil {
					return
				}
				gathered := webrtc.GatheringCompletePromise(viewer)
				if viewer.SetLocalDescription(answer) != nil {
					return
				}
				<-gathered
				_ = manager.HandleAnswer("viewer", *viewer.LocalDescription())
			}
		}
	}()

	source, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	screen, err := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000}, "screen", "screen")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = source.AddTrack(screen); err != nil {
		t.Fatal(err)
	}
	sourceOffer, err := gatheredOffer(source)
	if err != nil {
		t.Fatal(err)
	}
	sourceAnswer, _, err := manager.AcceptOffer("source", "room", sourceOffer, func(Signal) {})
	if err != nil {
		t.Fatal(err)
	}
	if err = source.SetRemoteDescription(sourceAnswer); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		_ = screen.WriteSample(media.Sample{Data: []byte{0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xb4, 0x00}, Duration: 100 * time.Millisecond})
		select {
		case <-videoPackets:
			return
		case <-time.After(100 * time.Millisecond):
		}
	}
	t.Fatal("viewer did not receive the source's screen RTP")
}

func gatheredOffer(peer *webrtc.PeerConnection) (webrtc.SessionDescription, error) {
	offer, err := peer.CreateOffer(nil)
	if err != nil {
		return webrtc.SessionDescription{}, err
	}
	gathered := webrtc.GatheringCompletePromise(peer)
	if err = peer.SetLocalDescription(offer); err != nil {
		return webrtc.SessionDescription{}, err
	}
	<-gathered
	return *peer.LocalDescription(), nil
}
