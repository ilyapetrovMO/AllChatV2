// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"testing"
	"time"
)

func TestTURNCredentialIssuanceIsBoundedPerMember(t *testing.T) {
	app := &Instance{turnIssued: map[string][]time.Time{}}
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	for index := 0; index < 20; index++ {
		if !app.allowTURNCredentialIssue("member", now) {
			t.Fatalf("issuance %d unexpectedly rejected", index+1)
		}
	}
	if app.allowTURNCredentialIssue("member", now) {
		t.Fatal("twenty-first issuance inside one minute accepted")
	}
	if !app.allowTURNCredentialIssue("member", now.Add(time.Minute+time.Nanosecond)) {
		t.Fatal("issuance did not recover after rate window")
	}
}
