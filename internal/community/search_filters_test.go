// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import "testing"

func TestParseSearchFilters(t *testing.T) {
	got := parseSearchFilters(`release notes from:alice in:#general has:image mentions:bob after:2026-01-01 before:2026-12-31`)
	if got.Text != "release notes" || got.Author != "alice" || got.Channel != "#general" || got.Has != "image" || got.Mentions != "bob" || got.After != "2026-01-01" || got.Before != "2026-12-31" {
		t.Fatalf("filters = %#v", got)
	}
}
