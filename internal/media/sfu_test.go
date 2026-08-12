package media

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/pion/rtcp"
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
	answer, _, _, err := manager.AcceptOffer("member", "room", *client.LocalDescription(), func(Signal) {})
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
	viewerAnswer, _, _, err := manager.AcceptOffer("viewer", "room", viewerOffer, func(signal Signal) { viewerSignals <- signal })
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
	sender, err := source.AddTrack(screen)
	if err != nil {
		t.Fatal(err)
	}
	keyframeRequested := make(chan struct{}, 1)
	go func() {
		for {
			packets, _, readErr := sender.ReadRTCP()
			if readErr != nil {
				return
			}
			for _, packet := range packets {
				if _, ok := packet.(*rtcp.PictureLossIndication); ok {
					select {
					case keyframeRequested <- struct{}{}:
					default:
					}
				}
			}
		}
	}()
	sourceOffer, err := gatheredOffer(source)
	if err != nil {
		t.Fatal(err)
	}
	sourceAnswer, _, _, err := manager.AcceptOffer("source", "room", sourceOffer, func(Signal) {})
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
			select {
			case <-keyframeRequested:
				return
			case <-time.After(3 * time.Second):
				t.Fatal("source did not receive a keyframe request")
			}
		case <-time.After(100 * time.Millisecond):
		}
	}
	t.Fatal("viewer did not receive the source's screen RTP")
}

func TestSFUForwardsExistingScreenToLateViewer(t *testing.T) {
	manager := NewManager(5 * time.Second)
	defer manager.Close()
	source, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	screen, err := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000}, "screen", "source")
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
	sourceAnswer, _, _, err := manager.AcceptOffer("source", "room", sourceOffer, func(Signal) {})
	if err != nil {
		t.Fatal(err)
	}
	if err = source.SetRemoteDescription(sourceAnswer); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_ = screen.WriteSample(media.Sample{Data: []byte{0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xb4, 0x00}, Duration: 100 * time.Millisecond})
		manager.mu.Lock()
		published := manager.screenTracks["room"]["source"] != nil
		manager.mu.Unlock()
		if published {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	viewer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer viewer.Close()
	if _, err = viewer.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionSendrecv}); err != nil {
		t.Fatal(err)
	}
	received := make(chan struct{}, 1)
	viewer.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if track.Kind() == webrtc.RTPCodecTypeVideo {
			if _, _, readErr := track.ReadRTP(); readErr == nil {
				received <- struct{}{}
			}
		}
	})
	viewerOffer, err := gatheredOffer(viewer)
	if err != nil {
		t.Fatal(err)
	}
	signals := make(chan Signal, 8)
	viewerAnswer, _, _, err := manager.AcceptOffer("viewer", "room", viewerOffer, func(signal Signal) { signals <- signal })
	if err != nil {
		t.Fatal(err)
	}
	if err = viewer.SetRemoteDescription(viewerAnswer); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go answerServerOffers(ctx, viewer, manager, "viewer", signals)
	manager.Renegotiate("viewer")
	deadline = time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		_ = screen.WriteSample(media.Sample{Data: []byte{0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xb4, 0x00}, Duration: 100 * time.Millisecond})
		select {
		case <-received:
			return
		case <-time.After(100 * time.Millisecond):
		}
	}
	t.Fatal("late viewer did not receive the existing screen RTP")
}

func TestSetScreenPublishingRequiresAnActiveMediaSession(t *testing.T) {
	manager := NewManager(5 * time.Second)
	defer manager.Close()
	if err := manager.SetScreenPublishing("missing-member", false); !errors.Is(err, ErrNotPresent) {
		t.Fatalf("SetScreenPublishing error = %v, want ErrNotPresent", err)
	}
}

func TestSFUForwardsScreensFromMultiplePublishers(t *testing.T) {
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
	received := make(chan string, 4)
	viewer.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if track.Kind() != webrtc.RTPCodecTypeVideo {
			return
		}
		if _, _, readErr := track.ReadRTP(); readErr == nil {
			received <- track.ID()
		}
	})
	offer, err := gatheredOffer(viewer)
	if err != nil {
		t.Fatal(err)
	}
	signals := make(chan Signal, 8)
	answer, _, _, err := manager.AcceptOffer("viewer", "room", offer, func(signal Signal) { signals <- signal })
	if err != nil {
		t.Fatal(err)
	}
	if err = viewer.SetRemoteDescription(answer); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go answerServerOffers(ctx, viewer, manager, "viewer", signals)

	sources := make([]*webrtc.PeerConnection, 0, 3)
	tracks := make([]*webrtc.TrackLocalStaticSample, 0, 3)
	for _, memberID := range []string{"source-one", "source-two", "source-three"} {
		source, createErr := webrtc.NewPeerConnection(webrtc.Configuration{})
		if createErr != nil {
			t.Fatal(createErr)
		}
		defer source.Close()
		screen, trackErr := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000}, "screen", memberID)
		if trackErr != nil {
			t.Fatal(trackErr)
		}
		if _, trackErr = source.AddTrack(screen); trackErr != nil {
			t.Fatal(trackErr)
		}
		sourceOffer, offerErr := gatheredOffer(source)
		if offerErr != nil {
			t.Fatal(offerErr)
		}
		sourceAnswer, _, _, acceptErr := manager.AcceptOffer(memberID, "room", sourceOffer, func(Signal) {})
		if acceptErr != nil {
			t.Fatal(acceptErr)
		}
		if setErr := source.SetRemoteDescription(sourceAnswer); setErr != nil {
			t.Fatal(setErr)
		}
		sources = append(sources, source)
		tracks = append(tracks, screen)
	}

	seen := map[string]bool{}
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) && len(seen) < 3 {
		for _, track := range tracks {
			_ = track.WriteSample(media.Sample{Data: []byte{0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xb4, 0x00}, Duration: 100 * time.Millisecond})
		}
		select {
		case id := <-received:
			seen[id] = true
		case <-time.After(100 * time.Millisecond):
		}
	}
	if len(seen) != 3 {
		t.Fatalf("viewer received video tracks %v, want three publishers", seen)
	}
	sharing := 0
	for _, participant := range manager.Participants("room") {
		if participant.ScreenSharing {
			sharing++
		}
	}
	if sharing != 3 {
		t.Fatalf("screen-sharing participants = %d, want 3", sharing)
	}
}

func TestSFUForwardsAudioFromMultiplePublishers(t *testing.T) {
	manager := NewManager(5 * time.Second)
	defer manager.Close()
	viewer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer viewer.Close()
	if _, err = viewer.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
		t.Fatal(err)
	}
	received := make(chan byte, 16)
	viewer.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if track.Kind() != webrtc.RTPCodecTypeAudio {
			return
		}
		go func() {
			if packet, _, readErr := track.ReadRTP(); readErr == nil && len(packet.Payload) > 0 {
				received <- packet.Payload[len(packet.Payload)-1]
			}
		}()
	})
	offer, err := gatheredOffer(viewer)
	if err != nil {
		t.Fatal(err)
	}
	signals := make(chan Signal, 8)
	answer, _, _, err := manager.AcceptOffer("viewer", "room", offer, func(signal Signal) { signals <- signal })
	if err != nil {
		t.Fatal(err)
	}
	if err = viewer.SetRemoteDescription(answer); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go answerServerOffers(ctx, viewer, manager, "viewer", signals)

	var sources []*webrtc.PeerConnection
	var tracks []*webrtc.TrackLocalStaticSample
	for _, memberID := range []string{"bot1", "bot2", "bot3"} {
		source, createErr := webrtc.NewPeerConnection(webrtc.Configuration{})
		if createErr != nil {
			t.Fatal(createErr)
		}
		defer source.Close()
		memberTracks := make([]*webrtc.TrackLocalStaticSample, 0, 2)
		for _, prefix := range []string{"echo-", "melody-"} {
			track, trackErr := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2}, prefix+memberID, "member-"+memberID)
			if trackErr != nil {
				t.Fatal(trackErr)
			}
			if _, trackErr = source.AddTrack(track); trackErr != nil {
				t.Fatal(trackErr)
			}
			memberTracks = append(memberTracks, track)
		}
		sourceOffer, offerErr := gatheredOffer(source)
		if offerErr != nil {
			t.Fatal(offerErr)
		}
		sourceAnswer, _, _, acceptErr := manager.AcceptOffer(memberID, "room", sourceOffer, func(Signal) {})
		if acceptErr != nil {
			t.Fatal(acceptErr)
		}
		if setErr := source.SetRemoteDescription(sourceAnswer); setErr != nil {
			t.Fatal(setErr)
		}
		sources = append(sources, source)
		tracks = append(tracks, memberTracks...)
	}
	seen := map[byte]bool{}
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) && len(seen) < 6 {
		for index, track := range tracks {
			_ = track.WriteSample(media.Sample{Data: []byte{0xf8, 0xff, 0xfe, byte(index + 1)}, Duration: 20 * time.Millisecond})
		}
		select {
		case marker := <-received:
			seen[marker] = true
		case <-time.After(100 * time.Millisecond):
		}
	}
	if len(seen) != 6 {
		t.Fatalf("viewer received audio payload markers %v, want both tracks from all three publishers", seen)
	}
}

func answerServerOffers(ctx context.Context, viewer *webrtc.PeerConnection, manager *Manager, memberID string, signals <-chan Signal) {
	for {
		select {
		case <-ctx.Done():
			return
		case signal := <-signals:
			if signal.Type != "offer" || signal.SDP == nil || viewer.SetRemoteDescription(*signal.SDP) != nil {
				continue
			}
			answer, err := viewer.CreateAnswer(nil)
			if err != nil {
				continue
			}
			gathered := webrtc.GatheringCompletePromise(viewer)
			if viewer.SetLocalDescription(answer) != nil {
				continue
			}
			<-gathered
			_ = manager.HandleAnswer(memberID, *viewer.LocalDescription())
		}
	}
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
