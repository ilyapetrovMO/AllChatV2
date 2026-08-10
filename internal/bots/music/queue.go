// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package music

import (
	"fmt"
	"math/rand/v2"
	"sync"
	"time"
)

type Track struct {
	ID          string        `json:"id"`
	Title       string        `json:"title"`
	Source      string        `json:"source"`
	StreamURL   string        `json:"-"`
	Duration    time.Duration `json:"duration"`
	RequestedBy string        `json:"requested_by"`
}

type LoopMode string

const (
	LoopOff   LoopMode = "off"
	LoopTrack LoopMode = "track"
	LoopQueue LoopMode = "queue"
)

type Queue struct {
	mu      sync.Mutex
	items   []Track
	maximum int
	loop    LoopMode
}

func NewQueue(maximum int) *Queue {
	if maximum < 1 {
		maximum = 200
	}
	return &Queue{maximum: maximum, loop: LoopOff}
}

func (q *Queue) Add(track Track) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) >= q.maximum {
		return fmt.Errorf("queue is full (%d tracks)", q.maximum)
	}
	q.items = append(q.items, track)
	return nil
}
func (q *Queue) Items() []Track {
	q.mu.Lock()
	defer q.mu.Unlock()
	return append([]Track(nil), q.items...)
}
func (q *Queue) Clear() { q.mu.Lock(); q.items = nil; q.mu.Unlock() }
func (q *Queue) Remove(position int) (Track, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	position--
	if position < 0 || position >= len(q.items) {
		return Track{}, fmt.Errorf("queue position is out of range")
	}
	item := q.items[position]
	q.items = append(q.items[:position], q.items[position+1:]...)
	return item, nil
}
func (q *Queue) Move(from, to int) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	from--
	to--
	if from < 0 || from >= len(q.items) || to < 0 || to >= len(q.items) {
		return fmt.Errorf("queue position is out of range")
	}
	item := q.items[from]
	q.items = append(q.items[:from], q.items[from+1:]...)
	q.items = append(q.items, Track{})
	copy(q.items[to+1:], q.items[to:])
	q.items[to] = item
	return nil
}
func (q *Queue) Shuffle() {
	q.mu.Lock()
	rand.Shuffle(len(q.items), func(a, b int) { q.items[a], q.items[b] = q.items[b], q.items[a] })
	q.mu.Unlock()
}
func (q *Queue) SetLoop(mode LoopMode) error {
	if mode != LoopOff && mode != LoopTrack && mode != LoopQueue {
		return fmt.Errorf("loop must be off, track, or queue")
	}
	q.mu.Lock()
	q.loop = mode
	q.mu.Unlock()
	return nil
}
func (q *Queue) Loop() LoopMode { q.mu.Lock(); defer q.mu.Unlock(); return q.loop }
func (q *Queue) Next() (Track, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) == 0 {
		return Track{}, false
	}
	item := q.items[0]
	q.items = q.items[1:]
	return item, true
}
func (q *Queue) Finished(track Track) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.loop == LoopTrack {
		q.items = append([]Track{track}, q.items...)
	} else if q.loop == LoopQueue {
		q.items = append(q.items, track)
	}
}
