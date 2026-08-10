// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import "testing"

func TestACMEProfileUsesShortLivedCertificatesOnlyForIPAddresses(t *testing.T) {
	for _, test := range []struct {
		identifier string
		want       string
	}{
		{"chat.example.com", ""},
		{"192.0.2.10", "shortlived"},
		{"2001:db8::1", "shortlived"},
	} {
		if got := acmeProfile(test.identifier); got != test.want {
			t.Errorf("acmeProfile(%q) = %q, want %q", test.identifier, got, test.want)
		}
	}
}
