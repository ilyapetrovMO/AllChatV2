// AllChat is free software under the GNU Affero General Public License v3.0 or later.
// Command allchat-bot-gui is a local-only process manager for development bots.
package main

import (
	"context"
	crand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"image"
	"image/color"
	"image/png"
	"log"
	"math/rand/v2"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type botProcess struct {
	ID, Username                          string
	StartedAt                             time.Time
	Commands                              []*exec.Cmd
	Running                               bool
	activeChildren                        int
	Exit                                  string
	log                                   *logBuffer
	controlDir                            string
	Chat, Voice, Music                    bool
	Screen, Echo                          bool
	Roleplay                              bool
	GenerateAudioChance, ReplyAudioChance int
	stopping                              bool
	voiceBinary                           string
	voiceEnv                              []string
	voiceCommand                          *exec.Cmd
	requestedUntil                        time.Time
}

type botConfig struct {
	Chat, Voice, Music, Screen, Echo, Roleplay                                 bool
	PublicMessageChance, ChannelReplyChance, DMReplyChance, VoiceRequestChance int
	GenerateAudioChance, ReplyAudioChance                                      int
}

type logBuffer struct {
	mu    sync.Mutex
	lines []string
	text  strings.Builder
}

func (b *logBuffer) Write(value []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.text.Write(value)
	for {
		line, rest, found := strings.Cut(b.text.String(), "\n")
		if !found {
			break
		}
		b.lines = append(b.lines, line)
		if len(b.lines) > 80 {
			b.lines = b.lines[len(b.lines)-80:]
		}
		b.text.Reset()
		b.text.WriteString(rest)
	}
	return len(value), nil
}

func (b *logBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	lines := append([]string(nil), b.lines...)
	if b.text.Len() > 0 {
		lines = append(lines, b.text.String())
	}
	return strings.Join(lines, "\n")
}

type manager struct {
	mu             sync.Mutex
	buildMu        sync.Mutex
	bots           map[string]*botProcess
	binaries       map[string]string
	buildDir       string
	repo           string
	csrf           string
	nextBot        int
	namePrefix     string
	simulationOnce sync.Once
	closed         chan struct{}
}

func newManager(repo string) (*manager, error) {
	buildDir, err := os.MkdirTemp("", "allchat-bot-gui-")
	if err != nil {
		return nil, err
	}
	token := make([]byte, 24)
	if _, err := crand.Read(token); err != nil {
		os.RemoveAll(buildDir)
		return nil, err
	}
	encoded := hex.EncodeToString(token)
	return &manager{bots: make(map[string]*botProcess), binaries: make(map[string]string), buildDir: buildDir, repo: repo, csrf: encoded, namePrefix: "bot-" + encoded[:6], closed: make(chan struct{})}, nil
}

func (m *manager) close() {
	select {
	case <-m.closed:
	default:
		close(m.closed)
	}
	m.mu.Lock()
	bots := make([]*botProcess, 0, len(m.bots))
	for _, bot := range m.bots {
		bots = append(bots, bot)
	}
	m.mu.Unlock()
	for _, bot := range bots {
		m.stop(bot.ID)
	}
	os.RemoveAll(m.buildDir)
}

func (m *manager) binary(command string) (string, error) {
	m.buildMu.Lock()
	defer m.buildMu.Unlock()
	m.mu.Lock()
	if path := m.binaries[command]; path != "" {
		m.mu.Unlock()
		return path, nil
	}
	m.mu.Unlock()
	path := filepath.Join(m.buildDir, command)
	build := exec.Command("go", "build", "-buildvcs=false", "-o", path, "./cmd/"+command)
	build.Dir = m.repo
	if output, err := build.CombinedOutput(); err != nil {
		return "", fmt.Errorf("build %s: %w\n%s", command, err, output)
	}
	m.mu.Lock()
	m.binaries[command] = path
	m.mu.Unlock()
	return path, nil
}

func (m *manager) spawn(config botConfig, username, baseURL, password, invite, interval string) error {
	if !config.Chat && !config.Voice && !config.Music {
		return fmt.Errorf("select at least chat, voice, or music")
	}
	id := strconv.FormatInt(time.Now().UnixNano(), 36)
	controlDir := filepath.Join(m.buildDir, "controls", id)
	if err := os.MkdirAll(controlDir, 0700); err != nil {
		return err
	}
	buffer := &logBuffer{}
	bot := &botProcess{ID: id, Username: username, StartedAt: time.Now(), Running: true, log: buffer, controlDir: controlDir, Chat: config.Chat, Voice: config.Voice, Music: config.Music, Screen: config.Screen, Echo: config.Echo, Roleplay: config.Roleplay, GenerateAudioChance: config.GenerateAudioChance, ReplyAudioChance: config.ReplyAudioChance}
	baseEnv := append(os.Environ(), "ALLCHAT_BOT_URL="+baseURL, "ALLCHAT_BOT_PASSWORD="+password, "ALLCHAT_BOT_INVITE="+invite, "ALLCHAT_BOT_REGISTER_FIRST=1", "ALLCHAT_BOT_CONTROL_DIR="+controlDir)
	if config.Chat {
		binary, err := m.binary("allchat-bot")
		if err != nil {
			return err
		}
		command := exec.Command(binary, "-username", username, "-interval", interval,
			"-public-message-chance", strconv.Itoa(config.PublicMessageChance),
			"-channel-reply-chance", strconv.Itoa(config.ChannelReplyChance),
			"-dm-reply-chance", strconv.Itoa(config.DMReplyChance),
			"-voice-request-chance", strconv.Itoa(config.VoiceRequestChance))
		command.Dir, command.Stdout, command.Stderr, command.Env = m.repo, buffer, buffer, baseEnv
		bot.Commands = append(bot.Commands, command)
	}
	if config.Voice {
		binary, err := m.binary("allchat-voice-bot")
		if err != nil {
			return err
		}
		voiceEnv := append(baseEnv, "ALLCHAT_VOICE_BOT_USERNAME="+username, "ALLCHAT_VOICE_BOT_SCREEN="+map[bool]string{true: "1", false: "0"}[config.Screen], "ALLCHAT_VOICE_BOT_ECHO="+map[bool]string{true: "1", false: "0"}[config.Echo], "ALLCHAT_VOICE_BOT_CONTROL_DIR="+controlDir)
		if config.Chat {
			voiceEnv = append(voiceEnv, "ALLCHAT_VOICE_BOT_REGISTER=0")
		}
		bot.voiceBinary, bot.voiceEnv = binary, voiceEnv
		if !config.Roleplay {
			command := m.voiceCommand(bot)
			bot.Commands = append(bot.Commands, command)
			bot.voiceCommand = command
		}
	}
	if config.Music {
		binary, err := m.binary("allchat-music-bot")
		if err != nil {
			return err
		}
		musicEnv := append(baseEnv,
			"ALLCHAT_MUSIC_BOT_USERNAME="+username,
			"ALLCHAT_MUSIC_BOT_PASSWORD="+password,
			"ALLCHAT_MUSIC_BOT_INVITE="+invite,
			"ALLCHAT_MUSIC_BOT_CONTROL_DIR="+controlDir,
			"ALLCHAT_MUSIC_BOT_DATA_DIR="+filepath.Join(m.repo, ".dev", "music", id))
		command := exec.Command(binary)
		command.Dir, command.Stdout, command.Stderr, command.Env = m.repo, buffer, buffer, musicEnv
		bot.Commands = append(bot.Commands, command)
	}
	for index, command := range bot.Commands {
		if index > 0 && config.Chat && config.Voice {
			time.Sleep(1200 * time.Millisecond)
		}
		if err := command.Start(); err != nil {
			for _, started := range bot.Commands {
				if started.Process != nil {
					_ = started.Process.Kill()
				}
			}
			return err
		}
		bot.activeChildren++
	}
	m.mu.Lock()
	m.bots[id] = bot
	m.mu.Unlock()
	for _, child := range bot.Commands {
		go m.watchChild(bot, child)
	}
	if config.Roleplay && config.Voice {
		m.simulationOnce.Do(func() { go m.simulationLoop() })
		go m.watchVoiceRequests(bot)
	}
	return nil
}

func (m *manager) nextUsername() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	index := m.nextBot
	m.nextBot++
	prefix := m.namePrefix
	if prefix == "" {
		prefix = "bot"
	}
	if index == 0 {
		return prefix
	}
	return prefix + "-" + strconv.Itoa(index)
}

func generatedPassword(username string) string {
	return "allchat-local-debug-password-" + username
}

func (m *manager) botAction(id string, action func(*botProcess) error) error {
	m.mu.Lock()
	bot := m.bots[id]
	m.mu.Unlock()
	if bot == nil || !bot.Running || !bot.Voice {
		return fmt.Errorf("running voice bot not found")
	}
	if err := action(bot); err != nil {
		fmt.Fprintf(bot.log, "debug control failed: %v\n", err)
		return err
	}
	return nil
}

func (m *manager) musicControl(id, action string) error {
	m.mu.Lock()
	bot := m.bots[id]
	m.mu.Unlock()
	if bot == nil || !bot.Running || !bot.Music {
		return fmt.Errorf("running music bot not found")
	}
	if action != "drop-signaling" && action != "drop-peer" && action != "enqueue-test-tone" {
		return fmt.Errorf("invalid music control")
	}
	return os.WriteFile(filepath.Join(bot.controlDir, action), []byte(time.Now().Format(time.RFC3339Nano)), 0600)
}

func (m *manager) voiceCommand(bot *botProcess) *exec.Cmd {
	command := exec.Command(bot.voiceBinary)
	command.Dir, command.Stdout, command.Stderr, command.Env = m.repo, bot.log, bot.log, bot.voiceEnv
	return command
}

func (m *manager) watchChild(bot *botProcess, command *exec.Cmd) {
	err := command.Wait()
	m.mu.Lock()
	defer m.mu.Unlock()
	bot.activeChildren--
	if bot.voiceCommand == command {
		bot.voiceCommand = nil
	}
	bot.Running = bot.activeChildren > 0
	if err != nil && !bot.stopping {
		bot.Exit = strings.TrimSpace(bot.Exit + " " + err.Error())
	} else if !bot.Running {
		bot.Exit = "exited normally"
	}
}

func (m *manager) startVoice(bot *botProcess) error {
	m.mu.Lock()
	if bot.stopping || bot.voiceCommand != nil {
		m.mu.Unlock()
		return nil
	}
	command := m.voiceCommand(bot)
	m.mu.Unlock()
	if err := command.Start(); err != nil {
		return err
	}
	m.mu.Lock()
	bot.Commands = append(bot.Commands, command)
	bot.voiceCommand = command
	bot.activeChildren++
	bot.Running = true
	m.mu.Unlock()
	go m.watchChild(bot, command)
	return nil
}

func (m *manager) stopVoice(bot *botProcess) {
	m.mu.Lock()
	command := bot.voiceCommand
	m.mu.Unlock()
	if command != nil && command.Process != nil {
		_ = command.Process.Signal(os.Interrupt)
	}
}

func (m *manager) watchVoiceRequests(bot *botProcess) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	var triggerTime time.Time
	for {
		select {
		case <-m.closed:
			return
		case <-ticker.C:
		}
		m.mu.Lock()
		if bot.stopping || !bot.Running {
			m.mu.Unlock()
			return
		}
		until := bot.requestedUntil
		m.mu.Unlock()
		if info, err := os.Stat(filepath.Join(bot.controlDir, "join-voice")); err == nil && info.ModTime().After(triggerTime) {
			triggerTime = info.ModTime()
			m.mu.Lock()
			bot.requestedUntil = time.Now().Add(time.Minute)
			m.mu.Unlock()
			if err := m.startVoice(bot); err != nil {
				fmt.Fprintf(bot.log, "join requested voice session: %v\n", err)
			}
			continue
		}
		if !until.IsZero() && time.Now().After(until) {
			m.mu.Lock()
			if bot.requestedUntil.Equal(until) {
				bot.requestedUntil = time.Time{}
				m.mu.Unlock()
				m.stopVoice(bot)
			} else {
				m.mu.Unlock()
			}
		}
	}
}

func (m *manager) stopVoiceUnlessRequested(bot *botProcess) {
	m.mu.Lock()
	requested := time.Now().Before(bot.requestedUntil)
	m.mu.Unlock()
	if !requested {
		m.stopVoice(bot)
	}
}

func (m *manager) simulationLoop() {
	interval := 3 * time.Minute
	if value := strings.TrimSpace(os.Getenv("ALLCHAT_BOT_SIMULATION_INTERVAL")); value != "" {
		if parsed, err := time.ParseDuration(value); err == nil && parsed > 0 {
			interval = parsed
		}
	}
	timer := time.NewTimer(interval)
	defer timer.Stop()
	for {
		select {
		case <-m.closed:
			return
		case <-timer.C:
		}
		m.runSimulationSession()
		timer.Reset(interval)
	}
}

func (m *manager) runSimulationSession() {
	m.mu.Lock()
	candidates := []*botProcess{}
	for _, bot := range m.bots {
		if bot.Roleplay && bot.Voice && bot.Running && !bot.stopping {
			candidates = append(candidates, bot)
		}
	}
	m.mu.Unlock()
	if len(candidates) == 0 {
		return
	}
	rand.Shuffle(len(candidates), func(i, j int) { candidates[i], candidates[j] = candidates[j], candidates[i] })
	selected := candidates[:1+rand.IntN(len(candidates))]
	for _, bot := range selected {
		if err := m.startVoice(bot); err != nil {
			fmt.Fprintf(bot.log, "join simulated voice session: %v\n", err)
			continue
		}
		if rand.IntN(3) == 0 {
			_ = os.WriteFile(filepath.Join(bot.controlDir, "voice-callout"), []byte(time.Now().Format(time.RFC3339Nano)), 0600)
		}
	}
	duration := time.Duration(10+rand.IntN(111)) * time.Second
	deadline := time.NewTimer(duration)
	ticker := time.NewTicker(7 * time.Second)
	defer deadline.Stop()
	defer ticker.Stop()
	for {
		select {
		case <-m.closed:
			for _, bot := range selected {
				m.stopVoice(bot)
			}
			return
		case <-deadline.C:
			for _, bot := range selected {
				m.stopVoiceUnlessRequested(bot)
			}
			return
		case <-ticker.C:
			bot := selected[rand.IntN(len(selected))]
			if chancePercent(bot.GenerateAudioChance) {
				_ = m.playMelody(bot.ID)
				for _, listener := range selected {
					if listener.ID != bot.ID && chancePercent(listener.ReplyAudioChance) {
						time.AfterFunc(time.Duration(500+rand.IntN(2000))*time.Millisecond, func() { _ = m.playMelody(listener.ID) })
					}
				}
			}
			if bot.Screen && rand.IntN(3) == 0 {
				_ = m.newScreenImage(bot.ID)
			}
		}
	}
}

func (m *manager) playMelody(id string) error {
	return m.botAction(id, func(bot *botProcess) error {
		path := filepath.Join(bot.controlDir, "melody.ogg")
		filter := `aevalsrc=0.12*sin(2*PI*(440+110*floor(mod(t\,1.5)/0.5))*t):s=48000:d=3`
		output, err := exec.Command("ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", filter, "-c:a", "libopus", "-frame_duration", "20", "-f", "ogg", path+".tmp").CombinedOutput()
		if err != nil {
			return fmt.Errorf("generate melody: %w: %s", err, output)
		}
		if err := os.Rename(path+".tmp", path); err != nil {
			return err
		}
		fmt.Fprintln(bot.log, "playing three-second melody")
		return nil
	})
}

func (m *manager) newScreenImage(id string) error {
	return m.botAction(id, func(bot *botProcess) error {
		seed := time.Now().UnixNano()
		canvas := image.NewRGBA(image.Rect(0, 0, 640, 360))
		palette := []color.RGBA{{uint8(seed), 88, 190, 255}, {70, uint8(seed >> 8), 130, 255}, {240, 170, uint8(seed >> 16), 255}}
		for y := 0; y < 360; y++ {
			for x := 0; x < 640; x++ {
				canvas.Set(x, y, palette[((x/80)+(y/60))%len(palette)])
			}
		}
		pngPath := filepath.Join(bot.controlDir, "screen.png")
		file, err := os.Create(pngPath)
		if err != nil {
			return err
		}
		if err = png.Encode(file, canvas); err != nil {
			file.Close()
			return err
		}
		if err = file.Close(); err != nil {
			return err
		}
		path := filepath.Join(bot.controlDir, "screen.ivf")
		output, err := exec.Command("ffmpeg", "-loglevel", "error", "-y", "-i", pngPath, "-frames:v", "1", "-c:v", "libvpx", "-pix_fmt", "yuv420p", "-f", "ivf", path+".tmp").CombinedOutput()
		if err != nil {
			return fmt.Errorf("generate screen image: %w: %s", err, output)
		}
		if err := os.Rename(path+".tmp", path); err != nil {
			return err
		}
		fmt.Fprintln(bot.log, "generated a new screen-share image")
		return nil
	})
}

func (m *manager) stop(id string) {
	m.mu.Lock()
	bot := m.bots[id]
	running := bot != nil && bot.Running
	var commands []*exec.Cmd
	if bot != nil {
		bot.stopping = true
		commands = append(commands, bot.Commands...)
	}
	m.mu.Unlock()
	if !running {
		return
	}
	for _, command := range commands {
		if command.Process != nil {
			_ = command.Process.Signal(os.Interrupt)
		}
	}
	go func() {
		time.Sleep(2 * time.Second)
		m.mu.Lock()
		running := bot.Running
		m.mu.Unlock()
		if running {
			for _, command := range commands {
				if command.Process != nil {
					_ = command.Process.Kill()
				}
			}
		}
	}()
}

func (m *manager) remove(id string) {
	m.stop(id)
	m.mu.Lock()
	delete(m.bots, id)
	m.mu.Unlock()
}

type botView struct {
	ID           string `json:"id"`
	Capabilities string `json:"capabilities"`
	Username     string `json:"username"`
	Started      string `json:"started"`
	Status       string `json:"status"`
	Exit         string `json:"exit"`
	Logs         string `json:"logs"`
	Voice        bool   `json:"voice"`
	Screen       bool   `json:"screen"`
	Music        bool   `json:"music"`
	MusicStatus  string `json:"music_status"`
}

func (m *manager) views() []botView {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]botView, 0, len(m.bots))
	for _, bot := range m.bots {
		status := "Stopped"
		if bot.Running {
			status = "Running"
		}
		capabilities := []string{}
		if bot.Chat {
			capabilities = append(capabilities, "chat", "DMs", "files")
		}
		if bot.Voice {
			capabilities = append(capabilities, "voice")
		}
		if bot.Screen {
			capabilities = append(capabilities, "screen")
		}
		if bot.Echo {
			capabilities = append(capabilities, "echo")
		}
		if bot.Roleplay {
			capabilities = append(capabilities, "roleplay")
		}
		musicStatus := ""
		if bot.Music {
			capabilities = append(capabilities, "music", "resilience controls")
			if data, err := os.ReadFile(filepath.Join(bot.controlDir, "status.json")); err == nil {
				var value struct {
					Media struct {
						State      string `json:"state"`
						RoomID     string `json:"room_id"`
						Recoveries int    `json:"recoveries"`
						LastError  string `json:"last_error"`
					} `json:"media"`
					Player struct {
						Current *struct{ Title string } `json:"current"`
						Paused  bool
					} `json:"player"`
				}
				if json.Unmarshal(data, &value) == nil {
					musicStatus = fmt.Sprintf("media: %s · room: %s · recoveries: %d", value.Media.State, value.Media.RoomID, value.Media.Recoveries)
					if value.Player.Current != nil {
						musicStatus += " · playing: " + value.Player.Current.Title
					}
					if value.Media.LastError != "" {
						musicStatus += " · last error: " + value.Media.LastError
					}
				}
			}
		}
		result = append(result, botView{ID: bot.ID, Capabilities: strings.Join(capabilities, " · "), Username: bot.Username, Started: bot.StartedAt.Format("15:04:05"), Status: status, Exit: bot.Exit, Logs: bot.log.String(), Voice: bot.Voice, Screen: bot.Screen, Music: bot.Music, MusicStatus: musicStatus})
	}
	sort.Slice(result, func(left, right int) bool { return result[left].Started < result[right].Started })
	return result
}

func (m *manager) authorized(request *http.Request) bool {
	return request.FormValue("csrf") == m.csrf
}

func formChance(request *http.Request, name string, fallback int) int {
	value := strings.TrimSpace(request.FormValue(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return -1
	}
	return parsed
}

func chancePercent(value int) bool { return value >= 100 || (value > 0 && rand.IntN(100) < value) }

func (m *manager) serve(response http.ResponseWriter, request *http.Request) {
	if request.Method == http.MethodGet {
		if request.URL.Path == "/assets/htmx.min.js" {
			response.Header().Set("Cache-Control", "public, max-age=3600")
			http.ServeFile(response, request, filepath.Join(m.repo, "internal/instance/web/assets/htmx.min.js"))
			return
		}
		if request.URL.Path == "/bots/fragment" {
			response.Header().Set("Content-Type", "text/html; charset=utf-8")
			response.Header().Set("Cache-Control", "no-store")
			_ = page.ExecuteTemplate(response, "bots", map[string]any{"CSRF": m.csrf, "Bots": m.views()})
			return
		}
		response.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = page.Execute(response, map[string]any{"CSRF": m.csrf, "Bots": m.views()})
		return
	}
	if err := request.ParseForm(); err != nil || !m.authorized(request) {
		http.Error(response, "invalid request", http.StatusBadRequest)
		return
	}
	switch {
	case request.URL.Path == "/bots":
		count, _ := strconv.Atoi(request.FormValue("count"))
		if count < 1 || count > 20 {
			http.Error(response, "count must be between 1 and 20", http.StatusBadRequest)
			return
		}
		config := botConfig{Chat: request.FormValue("chat") != "", Voice: request.FormValue("voice") != "", Music: request.FormValue("music") != "", Screen: request.FormValue("screen") != "", Echo: request.FormValue("echo") != "", Roleplay: request.FormValue("roleplay") != ""}
		if config.Music {
			// The music bot is a separate Member/process, not an added capability of a traffic bot.
			config.Chat, config.Voice, config.Screen, config.Echo, config.Roleplay = false, false, false, false, false
		}
		config.PublicMessageChance = formChance(request, "public_message_chance", 10)
		config.ChannelReplyChance = formChance(request, "channel_reply_chance", 3)
		config.DMReplyChance = formChance(request, "dm_reply_chance", 35)
		config.VoiceRequestChance = formChance(request, "voice_request_chance", 2)
		config.GenerateAudioChance = formChance(request, "generate_audio_chance", 10)
		config.ReplyAudioChance = formChance(request, "reply_audio_chance", 20)
		for name, value := range map[string]int{"public message": config.PublicMessageChance, "channel reply": config.ChannelReplyChance, "DM reply": config.DMReplyChance, "voice request": config.VoiceRequestChance, "generate audio": config.GenerateAudioChance, "reply to audio": config.ReplyAudioChance} {
			if value < 0 || value > 100 {
				http.Error(response, name+" chance must be between 0 and 100", http.StatusBadRequest)
				return
			}
		}
		if config.Screen {
			config.Voice = true
		}
		if config.Roleplay {
			config.Chat, config.Voice = true, true
		}
		for index := 1; index <= count; index++ {
			username := m.nextUsername()
			password := request.FormValue("password")
			if request.FormValue("auto_password") != "" {
				password = generatedPassword(username)
			}
			if password == "" {
				http.Error(response, "password is required when auto-generation is disabled", http.StatusBadRequest)
				return
			}
			if err := m.spawn(config, username, request.FormValue("url"), password, request.FormValue("invite"), request.FormValue("interval")); err != nil {
				http.Error(response, err.Error(), http.StatusInternalServerError)
				return
			}
		}
	case strings.HasSuffix(request.URL.Path, "/stop"):
		m.stop(strings.TrimSuffix(strings.TrimPrefix(request.URL.Path, "/bots/"), "/stop"))
	case strings.HasSuffix(request.URL.Path, "/remove"):
		m.remove(strings.TrimSuffix(strings.TrimPrefix(request.URL.Path, "/bots/"), "/remove"))
	case strings.HasSuffix(request.URL.Path, "/melody"):
		_ = m.playMelody(strings.TrimSuffix(strings.TrimPrefix(request.URL.Path, "/bots/"), "/melody"))
	case strings.HasSuffix(request.URL.Path, "/image"):
		_ = m.newScreenImage(strings.TrimSuffix(strings.TrimPrefix(request.URL.Path, "/bots/"), "/image"))
	case strings.HasSuffix(request.URL.Path, "/drop-signaling"):
		_ = m.musicControl(strings.TrimSuffix(strings.TrimPrefix(request.URL.Path, "/bots/"), "/drop-signaling"), "drop-signaling")
	case strings.HasSuffix(request.URL.Path, "/drop-peer"):
		_ = m.musicControl(strings.TrimSuffix(strings.TrimPrefix(request.URL.Path, "/bots/"), "/drop-peer"), "drop-peer")
	case strings.HasSuffix(request.URL.Path, "/test-tone"):
		_ = m.musicControl(strings.TrimSuffix(strings.TrimPrefix(request.URL.Path, "/bots/"), "/test-tone"), "enqueue-test-tone")
	default:
		http.NotFound(response, request)
		return
	}
	if request.Header.Get("HX-Request") == "true" {
		response.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = page.ExecuteTemplate(response, "bots", map[string]any{"CSRF": m.csrf, "Bots": m.views()})
		return
	}
	http.Redirect(response, request, "/", http.StatusSeeOther)
}

func main() {
	listen := flag.String("listen", "127.0.0.1:8090", "local GUI listen address")
	repo := flag.String("repo", ".", "AllChat repository root")
	flag.Parse()
	manager, err := newManager(*repo)
	if err != nil {
		log.Fatal(err)
	}
	defer manager.close()
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(manager.serve), ReadHeaderTimeout: 5 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("AllChat bot GUI: http://%s", listener.Addr())
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

var page = template.Must(template.New("page").Parse(`{{define "bots"}}{{range .Bots}}<article class="bot"><header><strong>{{.Username}}</strong><span>{{.Capabilities}}</span><span class="status {{.Status}}">{{.Status}}</span><small>started {{.Started}}</small></header>{{if .Exit}}<p>{{.Exit}}</p>{{end}}{{if .MusicStatus}}<p>{{.MusicStatus}}</p>{{end}}<pre>{{.Logs}}</pre><div class="actions">{{if eq .Status "Running"}}{{if .Voice}}<form method="post" action="/bots/{{.ID}}/melody" hx-post="/bots/{{.ID}}/melody" hx-target="#bot-list" hx-swap="innerHTML"><input type="hidden" name="csrf" value="{{$.CSRF}}"><button>Play melody</button></form>{{if .Screen}}<form method="post" action="/bots/{{.ID}}/image" hx-post="/bots/{{.ID}}/image" hx-target="#bot-list" hx-swap="innerHTML"><input type="hidden" name="csrf" value="{{$.CSRF}}"><button>New screen image</button></form>{{end}}{{end}}{{if .Music}}<form method="post" action="/bots/{{.ID}}/test-tone" hx-post="/bots/{{.ID}}/test-tone" hx-target="#bot-list" hx-swap="innerHTML"><input type="hidden" name="csrf" value="{{$.CSRF}}"><button>Test tone</button></form><form method="post" action="/bots/{{.ID}}/drop-signaling" hx-post="/bots/{{.ID}}/drop-signaling" hx-target="#bot-list" hx-swap="innerHTML"><input type="hidden" name="csrf" value="{{$.CSRF}}"><button>Drop signaling</button></form><form method="post" action="/bots/{{.ID}}/drop-peer" hx-post="/bots/{{.ID}}/drop-peer" hx-target="#bot-list" hx-swap="innerHTML"><input type="hidden" name="csrf" value="{{$.CSRF}}"><button>Drop peer</button></form>{{end}}<form method="post" action="/bots/{{.ID}}/stop" hx-post="/bots/{{.ID}}/stop" hx-target="#bot-list" hx-swap="innerHTML"><input type="hidden" name="csrf" value="{{$.CSRF}}"><button class="secondary">Stop</button></form>{{end}}<form method="post" action="/bots/{{.ID}}/remove" hx-post="/bots/{{.ID}}/remove" hx-target="#bot-list" hx-swap="innerHTML"><input type="hidden" name="csrf" value="{{$.CSRF}}"><button class="danger">Remove</button></form></div></article>{{else}}<section class="panel">No bots are running yet.</section>{{end}}{{end}}<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AllChat Bot Lab</title><script src="/assets/htmx.min.js" defer></script><style>
:root{color-scheme:dark;font:15px/1.4 system-ui;background:#1e1f22;color:#f2f3f5}*{box-sizing:border-box}body{margin:0;padding:24px}main{max-width:1100px;margin:auto}h1{margin-top:0}.panel,.bot{background:#2b2d31;border:1px solid #444;border-radius:10px;padding:16px;margin-bottom:16px}form{display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:10px}label{display:grid;gap:4px;color:#b5bac1;font-size:.8rem}input,select,button{font:inherit;border:0;border-radius:5px;padding:9px;background:#1e1f22;color:#fff}button{background:#5865f2;font-weight:700;cursor:pointer}.danger{background:#da373c}.secondary{background:#4e5058}.wide{grid-column:span 2}.actions{display:flex;gap:8px}.actions form{display:block}.bot header{display:flex;align-items:center;gap:10px}.bot header strong{font-size:1.1rem}.status{padding:2px 8px;border-radius:999px;background:#4e5058}.status.Running{background:#248046}.bot pre{max-height:220px;overflow:auto;white-space:pre-wrap;background:#111214;padding:10px;border-radius:6px;color:#dbdee1}@media(max-width:760px){body{padding:10px}form{grid-template-columns:1fr}.wide{grid-column:auto}}
</style></head><body><main><h1>AllChat Bot Lab</h1><p>Spawn synthetic traffic bots or a local music bot with media recovery controls.</p><section class="panel"><form method="post" action="/bots" hx-post="/bots" hx-target="#bot-list" hx-swap="innerHTML"><input type="hidden" name="csrf" value="{{.CSRF}}"><label>Count<input name="count" type="number" value="1" min="1" max="20" required></label><label>Action interval<input name="interval" value="10s" required></label><label>Scheduled public message %<input name="public_message_chance" type="number" value="10" min="0" max="100" required></label><label>Reply to channel message %<input name="channel_reply_chance" type="number" value="3" min="0" max="100" required></label><label>Reply to DM %<input name="dm_reply_chance" type="number" value="35" min="0" max="100" required></label><label>Follow public voice request %<input name="voice_request_chance" type="number" value="2" min="0" max="100" required></label><label>Generate audio %<input name="generate_audio_chance" type="number" value="10" min="0" max="100" required></label><label>Reply to audio with audio %<input name="reply_audio_chance" type="number" value="20" min="0" max="100" required></label><label class="wide">Instance URL<input name="url" value="http://127.0.0.1:8080" type="url" required></label><label><span><input name="chat" type="checkbox" checked> Text, DMs, images and files</span></label><label><span><input name="voice" type="checkbox" checked> Voice</span></label><label><span><input name="music" type="checkbox"> Music bot and resilience harness</span></label><label><span><input name="screen" type="checkbox" checked> Screen sharing</span></label><label><span><input name="echo" type="checkbox"> Echo room audio</span></label><label><span><input name="roleplay" type="checkbox"> Autonomous roleplay</span></label><label><span><input name="auto_password" type="checkbox" checked> Auto development password</span><input name="password" type="password" placeholder="Optional manual password"></label><label>Invitation token<input name="invite" autocomplete="off"></label><button type="submit">Spawn bots</button></form></section><section id="bot-list" hx-get="/bots/fragment" hx-trigger="every 1s" hx-swap="innerHTML">{{template "bots" .}}</section></main></body></html>`))
