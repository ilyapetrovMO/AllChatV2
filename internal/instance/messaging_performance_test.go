// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"strings"
	"testing"
)

func TestMessagingSQLitePolicyAndCoveringIndexes(t *testing.T) {
	db, err := openDatabase(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := initializeSchema(db); err != nil {
		t.Fatal(err)
	}

	pragmas := map[string]string{
		"journal_mode":       "wal",
		"synchronous":        "1",
		"busy_timeout":       "5000",
		"wal_autocheckpoint": "1000",
		"cache_size":         "-16384",
	}
	for pragma, expected := range pragmas {
		var actual string
		if err := db.QueryRow("PRAGMA " + pragma).Scan(&actual); err != nil {
			t.Fatalf("PRAGMA %s: %v", pragma, err)
		}
		if strings.ToLower(actual) != expected {
			t.Errorf("PRAGMA %s = %q, want %q", pragma, actual, expected)
		}
	}

	assertPlanUses := func(query, index string) {
		t.Helper()
		rows, err := db.Query("EXPLAIN QUERY PLAN " + query)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var plan strings.Builder
		for rows.Next() {
			var id, parent, unused int
			var detail string
			if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
				t.Fatal(err)
			}
			plan.WriteString(detail)
		}
		if !strings.Contains(plan.String(), index) {
			t.Errorf("query plan %q does not use %s", plan.String(), index)
		}
	}
	assertPlanUses("SELECT message_id FROM pinned_messages WHERE message_id IN ('one','two')", "pinned_messages_message")
	assertPlanUses("SELECT id FROM attachments WHERE message_id IN ('one','two') AND state='published' ORDER BY message_id, created_at", "attachments_message_state_created")
	assertPlanUses("SELECT id FROM messages WHERE channel_id='channel' AND sequence < 100 ORDER BY sequence DESC LIMIT 50", "messages_channel_sequence")
}
