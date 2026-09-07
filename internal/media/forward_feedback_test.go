package media

import (
	"testing"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

func TestForwardSenderRetransmitsRequestedPacket(t *testing.T) {
	publisher, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer publisher.Close()
	viewer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer viewer.Close()
	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000}, "screen", "screen-owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = addForwardTrack(publisher, track, nil); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	viewer.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		first, _, readErr := remote.ReadRTP()
		if readErr != nil {
			result <- readErr
			return
		}
		if err := viewer.WriteRTCP([]rtcp.Packet{&rtcp.TransportLayerNack{MediaSSRC: uint32(remote.SSRC()), Nacks: []rtcp.NackPair{{PacketID: first.SequenceNumber}}}}); err != nil {
			result <- err
			return
		}
		for {
			packet, _, err := remote.ReadRTP()
			if err != nil {
				result <- err
				return
			}
			if packet.SequenceNumber == first.SequenceNumber {
				result <- nil
				return
			}
		}
	})
	offer, err := gatheredOffer(publisher)
	if err != nil {
		t.Fatal(err)
	}
	if err = viewer.SetRemoteDescription(offer); err != nil {
		t.Fatal(err)
	}
	answer, err := viewer.CreateAnswer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(viewer)
	if err = viewer.SetLocalDescription(answer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gathered:
	case <-time.After(5 * time.Second):
		t.Fatal("gathering timed out")
	}
	if err = publisher.SetRemoteDescription(*viewer.LocalDescription()); err != nil {
		t.Fatal(err)
	}
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	sequence := uint16(100)
	for {
		select {
		case err := <-result:
			if err != nil {
				t.Fatal(err)
			}
			return
		case <-deadline.C:
			t.Fatal("forward sender did not consume NACK and retransmit")
		case <-ticker.C:
			sequence++
			if err := track.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: sequence, Timestamp: uint32(sequence) * 3000}, Payload: []byte{0x10, 0, 0, 0}}); err != nil {
				t.Fatal(err)
			}
		}
	}
}
