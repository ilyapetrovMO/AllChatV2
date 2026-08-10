package music

import "testing"

func TestQueueSupportsMoveRemoveShuffleAndLoopWithoutPersistentState(t *testing.T) {
	queue := NewQueue(4)
	for _, title := range []string{"one", "two", "three"} {
		if err := queue.Add(Track{Title: title, Source: title}); err != nil {
			t.Fatal(err)
		}
	}
	if err := queue.Move(3, 1); err != nil {
		t.Fatal(err)
	}
	if got := queue.Items(); got[0].Title != "three" || got[1].Title != "one" {
		t.Fatalf("moved queue = %+v", got)
	}
	removed, err := queue.Remove(2)
	if err != nil || removed.Title != "one" {
		t.Fatalf("removed = %+v, %v", removed, err)
	}
	queue.SetLoop(LoopQueue)
	first, ok := queue.Next()
	if !ok || first.Title != "three" {
		t.Fatalf("first = %+v, %v", first, ok)
	}
	queue.Finished(first)
	if got := queue.Items(); len(got) != 2 || got[1].Title != "three" {
		t.Fatalf("looped queue = %+v", got)
	}
}
