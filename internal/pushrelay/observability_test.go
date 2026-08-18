package pushrelay

import (
	"strings"
	"testing"
)

func TestObservabilityIdentifiersAreSafeAndStable(t *testing.T) {
	if got := TokenFingerprint("0123456789abcdef"); got != "9f9f5111f7b27a781f1f1ddd" {
		t.Fatalf("fingerprint = %q", got)
	}
	requestID := NewRequestID()
	if !validRequestID(requestID) || strings.ContainsAny(requestID, "+/=") {
		t.Fatalf("unsafe request ID %q", requestID)
	}
	for _, invalid := range []string{"short", strings.Repeat("a", 65), "0123456789abcde\n"} {
		if validRequestID(invalid) {
			t.Fatalf("accepted invalid request ID %q", invalid)
		}
	}
}
