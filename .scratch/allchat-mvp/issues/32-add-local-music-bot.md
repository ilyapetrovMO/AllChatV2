# Add a local music bot and WebRTC resilience harness

Type: task
Status: resolved

## Goal

Add a separately packaged music bot with Discord-style playback and queue commands, a dedicated music code/data area, shared resilient WebRTC behavior, and local GUI fault controls.

## Decisions

- Music is a separate `allchat-music-bot` process launched independently or by the existing bot GUI.
- Commands use a configurable `!` prefix in Community Text Channels; playback control requires membership in the active Voice Room.
- Sources include URL/search through yt-dlp, direct/local files through FFmpeg, and a deterministic test tone.
- Queue state is intentionally in memory.
- Signaling and peer failures are injected only through local GUI/control files.

## Comments

- Preserve the existing echo bot as a deterministic receive/echo peer while sharing the media recovery implementation where its track model permits.
- Added a resumable media session with heartbeat and peer-state recovery, stable Opus sink, recovery metrics, and local fault injection.
- Added queue/playback policy tests, source confinement tests, and the separate CLI/GUI launch paths. Full `go test ./...` passes.
- Added bounded JSONL Media Session diagnostics under the music data directory so brief successful recoveries retain their signaling error, peer transitions, attempt count, outage duration, and dropped-frame evidence.
- Extended diagnostics across FFmpeg production, local RTP, remote RTCP reports, and browser inbound/playback state, with stage-specific stall detection and UTC-correlated bounded histories.
