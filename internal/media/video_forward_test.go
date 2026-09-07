package media

import (
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"testing"
)

func TestVideoLayerSwitchWaitsForKeyframeAndPreservesRTPContinuity(t *testing.T) {
	codec := webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000}
	first, _ := webrtc.NewTrackLocalStaticRTP(codec, "first", "source")
	second, _ := webrtc.NewTrackLocalStaticRTP(codec, "second", "source")
	output, _ := webrtc.NewTrackLocalStaticRTP(codec, "screen", "viewer")
	sub := &videoSubscription{output: output}
	packet := func(seq uint16, stamp uint32, key bool) *rtp.Packet {
		data := byte(1)
		if key {
			data = 0
		}
		return &rtp.Packet{Header: rtp.Header{SequenceNumber: seq, Timestamp: stamp}, Payload: []byte{0x10, data, 0, 0}}
	}
	sub.selectTrack(first)
	sub.write(first, packet(100, 90000, true))
	sub.selectTrack(second)
	sub.write(second, packet(1000, 800000, false))
	if sub.outputSequence != 100 {
		t.Fatal("switched on an undecodable delta frame")
	}
	sub.write(second, packet(1001, 803000, true))
	if sub.outputSequence != 101 || sub.outputTime != 93000 {
		t.Fatalf("discontinuous RTP: %d %d", sub.outputSequence, sub.outputTime)
	}
	sub.write(first, packet(101, 93000, true))
	if sub.outputSequence != 101 {
		t.Fatal("obsolete layer changed output")
	}
	sub.selectTrack(nil)
	sub.write(second, packet(1002, 806000, true))
	if sub.outputSequence != 101 {
		t.Fatal("stopped publication forwarded media")
	}
}
