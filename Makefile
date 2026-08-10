DEV_DATA_DIR ?= .dev/data
DEV_LISTEN ?= 127.0.0.1:8080
GOFLAGS ?= -buildvcs=false

.PHONY: dev dev-bot dev-voice-bot dev-echo-bot dev-music-bot dev-bot-gui drop-db test test-ui test-ui-update vet build clean

dev:
	go run $(GOFLAGS) ./cmd/allchat --data-dir "$(DEV_DATA_DIR)" --listen "$(DEV_LISTEN)"

dev-bot:
	go run $(GOFLAGS) ./cmd/allchat-bot

dev-voice-bot:
	go run $(GOFLAGS) ./cmd/allchat-voice-bot

dev-echo-bot:
	ALLCHAT_VOICE_BOT_SCREEN=1 go run $(GOFLAGS) ./cmd/allchat-voice-bot

dev-music-bot:
	go run $(GOFLAGS) ./cmd/allchat-music-bot

dev-bot-gui:
	go run $(GOFLAGS) ./cmd/allchat-bot-gui

drop-db:
	$(RM) -- "$(DEV_DATA_DIR)/allchat.db" "$(DEV_DATA_DIR)/allchat.db-wal" "$(DEV_DATA_DIR)/allchat.db-shm"

test:
	go test $(GOFLAGS) ./...

test-ui:
	npm run test:ui

test-ui-update:
	npm run test:ui:update

vet:
	go vet $(GOFLAGS) ./...

build:
	go build $(GOFLAGS) -o allchat ./cmd/allchat

clean:
	go clean
	$(RM) allchat
