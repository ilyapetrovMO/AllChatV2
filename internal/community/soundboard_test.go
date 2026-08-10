// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"encoding/binary"
	"testing"
)

func TestSoundDurationAcceptsWAVAndRejectsArbitraryBytes(t *testing.T) {
	data := make([]byte, 44+8000)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:8], uint32(len(data)-8))
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:20], 16)
	binary.LittleEndian.PutUint16(data[20:22], 1)
	binary.LittleEndian.PutUint16(data[22:24], 1)
	binary.LittleEndian.PutUint32(data[24:28], 8000)
	binary.LittleEndian.PutUint32(data[28:32], 8000)
	binary.LittleEndian.PutUint16(data[32:34], 1)
	binary.LittleEndian.PutUint16(data[34:36], 8)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:44], 8000)
	if duration, contentType := soundDuration(data, "application/octet-stream"); duration != 1000 || contentType != "audio/wav" {
		t.Fatalf("soundDuration(WAV) = %d, %q; want 1000, audio/wav", duration, contentType)
	}
	if duration, _ := soundDuration([]byte("not audio"), "application/octet-stream"); duration != 0 {
		t.Fatalf("soundDuration(invalid) = %d, want 0", duration)
	}
}

func TestSoundDurationReadsMP3FrameTiming(t *testing.T) {
	const frameBytes = 417
	data := make([]byte, frameBytes*10)
	for offset := 0; offset < len(data); offset += frameBytes {
		copy(data[offset:offset+4], []byte{0xff, 0xfb, 0x90, 0x00}) // MPEG-1 Layer III, 128 kbps, 44.1 kHz.
	}
	duration, contentType := soundDuration(data, "application/octet-stream")
	if duration < 250 || duration > 270 || contentType != "audio/mpeg" {
		t.Fatalf("soundDuration(MP3) = %d, %q; want about 261 ms, audio/mpeg", duration, contentType)
	}
}
