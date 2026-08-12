// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"testing"

	"allchat/internal/community"
)

func TestMessagePagePublishesSequenceCursor(t *testing.T) {
	messages := make([]community.Message, 50)
	for index := range messages {
		messages[index].Sequence = int64(index + 51)
	}
	page := messagePage(messages, 50)
	if page["has_more"] != true || page["next_before"] != int64(51) {
		t.Fatalf("messagePage cursor = %#v", page)
	}
	page = messagePage(messages[:25], 50)
	if page["has_more"] != false || page["next_before"] != int64(0) {
		t.Fatalf("final messagePage cursor = %#v", page)
	}
}
