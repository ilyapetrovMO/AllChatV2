// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package media

import "testing"

func TestOpusSinkDropsFramesWhileTransportRecovers(t *testing.T) {
	sink := &OpusSink{}
	if err := sink.WriteOpus([]byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	sent, dropped, last := sink.Stats()
	if sent != 0 || dropped != 1 || !last.IsZero() {
		t.Fatalf("sent=%d dropped=%d last=%v", sent, dropped, last)
	}
}
