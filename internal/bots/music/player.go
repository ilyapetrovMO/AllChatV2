// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package music

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"sync"
	"time"
)

type OpusWriter interface{ WriteOpus([]byte) error }

type PlayerStatus struct {
	Current  *Track        `json:"current,omitempty"`
	Position time.Duration `json:"position"`
	Paused   bool          `json:"paused"`
	Volume   int           `json:"volume"`
	Loop     LoopMode      `json:"loop"`
	Queue    []Track       `json:"queue"`
}

type Player struct {
	ctx      context.Context
	resolver *Resolver
	sink     OpusWriter
	queue    *Queue
	mu       sync.Mutex
	current  *Track
	position time.Duration
	paused   bool
	volume   int
	cancel   context.CancelFunc
	action   string
	wake     chan struct{}
}

func NewPlayer(ctx context.Context, resolver *Resolver, sink OpusWriter, maximum int) *Player {
	p := &Player{ctx: ctx, resolver: resolver, sink: sink, queue: NewQueue(maximum), volume: 100, wake: make(chan struct{}, 1)}
	go p.loop()
	return p
}
func (p *Player) Enqueue(ctx context.Context, source, requester string) (Track, error) {
	track, err := p.resolver.Resolve(ctx, source, requester)
	if err != nil {
		return Track{}, err
	}
	if err = p.queue.Add(track); err != nil {
		return Track{}, err
	}
	p.signal()
	return track, nil
}
func (p *Player) Queue() *Queue { return p.queue }
func (p *Player) Status() PlayerStatus {
	p.mu.Lock()
	defer p.mu.Unlock()
	var current *Track
	if p.current != nil {
		copy := *p.current
		current = &copy
	}
	return PlayerStatus{Current: current, Position: p.position, Paused: p.paused, Volume: p.volume, Loop: p.queue.Loop(), Queue: p.queue.Items()}
}
func (p *Player) Pause() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.current == nil {
		return fmt.Errorf("nothing is playing")
	}
	if p.paused {
		return nil
	}
	p.paused = true
	p.action = "pause"
	if p.cancel != nil {
		p.cancel()
	}
	return nil
}
func (p *Player) Resume() error {
	p.mu.Lock()
	if !p.paused {
		p.mu.Unlock()
		return fmt.Errorf("playback is not paused")
	}
	p.paused = false
	p.action = "restart"
	p.mu.Unlock()
	p.signal()
	return nil
}
func (p *Player) Seek(position time.Duration) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.current == nil {
		return fmt.Errorf("nothing is playing")
	}
	if position < 0 {
		position = 0
	}
	if p.current.Duration > 0 && position > p.current.Duration {
		position = p.current.Duration
	}
	p.position = position
	p.action = "restart"
	if p.cancel != nil {
		p.cancel()
	}
	return nil
}
func (p *Player) Replay() error { return p.Seek(0) }
func (p *Player) SetVolume(volume int) error {
	if volume < 0 || volume > 200 {
		return fmt.Errorf("volume must be between 0 and 200")
	}
	p.mu.Lock()
	p.volume = volume
	if p.current != nil {
		p.action = "restart"
		if p.cancel != nil {
			p.cancel()
		}
	}
	p.mu.Unlock()
	return nil
}
func (p *Player) Skip(count int) error {
	if count < 1 {
		count = 1
	}
	p.mu.Lock()
	if p.current == nil {
		p.mu.Unlock()
		return fmt.Errorf("nothing is playing")
	}
	p.action = "skip"
	if p.cancel != nil {
		p.cancel()
	}
	p.mu.Unlock()
	for index := 1; index < count; index++ {
		if _, ok := p.queue.Next(); !ok {
			break
		}
	}
	p.signal()
	return nil
}
func (p *Player) Stop() {
	p.queue.Clear()
	p.mu.Lock()
	p.action = "stop"
	p.paused = false
	if p.cancel != nil {
		p.cancel()
	}
	p.mu.Unlock()
	p.signal()
}
func (p *Player) signal() {
	select {
	case p.wake <- struct{}{}:
	default:
	}
}

func (p *Player) loop() {
	for {
		select {
		case <-p.ctx.Done():
			p.Stop()
			return
		case <-p.wake:
		}
		for {
			p.mu.Lock()
			current := p.current
			p.mu.Unlock()
			if current == nil {
				next, ok := p.queue.Next()
				if !ok {
					break
				}
				p.mu.Lock()
				p.current = &next
				p.position = 0
				p.action = ""
				p.mu.Unlock()
				current = &next
			}
			completed := p.playCurrent()
			p.mu.Lock()
			action := p.action
			track := *p.current
			if completed || action == "skip" || action == "stop" {
				p.current = nil
				p.position = 0
				p.paused = false
				p.action = ""
			}
			paused := p.paused
			p.mu.Unlock()
			if completed {
				p.queue.Finished(track)
			}
			if paused {
				break
			}
			if action == "restart" {
				continue
			}
			if action == "stop" {
				break
			}
		}
	}
}

func (p *Player) playCurrent() bool {
	p.mu.Lock()
	track := *p.current
	position, volume := p.position, p.volume
	ctx, cancel := context.WithCancel(p.ctx)
	p.cancel = cancel
	p.action = ""
	p.mu.Unlock()
	defer cancel()
	args := []string{"-loglevel", "error"}
	if position > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", position.Seconds()))
	}
	if track.StreamURL == "test:tone" {
		args = append(args, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=600")
	} else {
		args = append(args, "-i", track.StreamURL)
	}
	args = append(args, "-vn", "-ac", "2", "-ar", "48000", "-af", "volume="+strconv.FormatFloat(float64(volume)/100, 'f', 2, 64), "-c:a", "libopus", "-b:a", "128k", "-frame_duration", "20", "-f", "ogg", "pipe:1")
	command := exec.CommandContext(ctx, "ffmpeg", args...)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return false
	}
	if err = command.Start(); err != nil {
		return false
	}
	packets := newOggPacketReader(stdout)
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	headers := 0
	for {
		packet, readErr := packets.Next()
		if readErr != nil {
			_ = command.Wait()
			return readErr == io.EOF && ctx.Err() == nil
		}
		if headers < 2 {
			headers++
			continue
		}
		select {
		case <-ctx.Done():
			_ = command.Wait()
			return false
		case <-ticker.C:
		}
		if err = p.sink.WriteOpus(packet); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			cancel()
			_ = command.Wait()
			return false
		}
		p.mu.Lock()
		p.position += 20 * time.Millisecond
		p.mu.Unlock()
	}
}

type oggPacketReader struct {
	reader  io.Reader
	partial []byte
	pending [][]byte
}

func newOggPacketReader(reader io.Reader) *oggPacketReader { return &oggPacketReader{reader: reader} }
func (r *oggPacketReader) Next() ([]byte, error) {
	for len(r.pending) == 0 {
		header := make([]byte, 27)
		if _, err := io.ReadFull(r.reader, header); err != nil {
			return nil, err
		}
		if string(header[:4]) != "OggS" {
			return nil, fmt.Errorf("invalid Ogg stream")
		}
		segments := int(header[26])
		laces := make([]byte, segments)
		if _, err := io.ReadFull(r.reader, laces); err != nil {
			return nil, err
		}
		size := 0
		for _, length := range laces {
			size += int(length)
		}
		body := make([]byte, size)
		if _, err := io.ReadFull(r.reader, body); err != nil {
			return nil, err
		}
		offset := 0
		for _, lengthByte := range laces {
			length := int(lengthByte)
			r.partial = append(r.partial, body[offset:offset+length]...)
			offset += length
			if length < 255 {
				r.pending = append(r.pending, append([]byte(nil), r.partial...))
				r.partial = nil
			}
		}
		_ = binary.LittleEndian.Uint64(header[6:14])
	}
	packet := r.pending[0]
	r.pending = r.pending[1:]
	return packet, nil
}
