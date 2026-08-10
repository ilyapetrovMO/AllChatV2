package instance

import (
	"fmt"
	"testing"

	"allchat/internal/community"
)

func TestDirectMessageShortlistNeverExceedsFiveMostRecentItems(t *testing.T) {
	items := make([]community.DirectMessage, 8)
	for index := range items {
		items[index].ID = fmt.Sprintf("dm-%d", index)
	}
	shortlist := directMessageShortlist(items)
	if len(shortlist) != 5 {
		t.Fatalf("shortlist length=%d", len(shortlist))
	}
	for index, item := range shortlist {
		if item.ID != items[index].ID {
			t.Fatalf("shortlist[%d]=%q", index, item.ID)
		}
	}
}
