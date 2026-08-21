# Call-grid focus, ended screen shares, and adaptive screen-share quality

Date: 2026-08-21

## Implementation status

The first implementation slice now covers all four planned phases:

- **Phase 1 — correctness and focus:** viewer-local participant focus is available, and `video-stopped` immediately clears remote presentation state and detached video sources.
- **Phase 2 — bounded sender quality:** desktop, web, and mobile expose semantic screen-share modes; desktop and web publish bounded `q`/`h`/`f` simulcast layers.
- **Phase 3 — automatic adaptation:** desktop Auto mode samples sender statistics with downgrade/upgrade hysteresis and records bounded diagnostics.
- **Phase 4 — receiver-specific delivery:** the SFU tracks screen layers and quality subscriptions per viewer and signals the publisher with the highest currently requested tier.

The architecture is complete enough for end-to-end profiling. Follow-up tuning should use real calls to calibrate thresholds, bitrate ceilings, mobile capture scaling, and codec/device interoperability rather than changing the control model.

## Executive recommendation

Treat these as one product/transport feature rather than three unrelated fixes:

1. Add a viewer-local **Focus** state for any participant or shared screen, with a large stage, a thumbnail strip, an explicit exit control, and optional browser/Electron fullscreen. Focus must also become a subscription-quality signal.
2. Make the signaling `video-stopped` event authoritative for presentation state and clear the receiver immediately; retain `mute`/`ended` only as fallbacks. On stop, detach or replace the `<video>` source as well as removing it from layout so the compositor cannot retain the last decoded frame.
3. Ship sender presets first (`Text`, `Balanced`, `Motion`, plus `Auto`) with bounded capture resolution/frame rate, `contentHint`, and `RTCRtpSender` limits. Then upgrade the SFU to forward a layer selected **per receiver** using tile size, visibility, bandwidth, and decode-health feedback. The current global high/low switch cannot downgrade only one struggling receiver.

This gives a useful incremental path: the UI and deterministic cleanup are small changes; sender presets mitigate skipped frames without an SFU rewrite; receiver-specific layer selection is the durable architecture.

## What major products expose

These are documented user-facing behaviors. Their proprietary codec, congestion-control, and server algorithms are unknown unless explicitly stated.

| Product | Focus/maximize pattern | Quality pattern | What AllChat can borrow |
|---|---|---|---|
| Discord | Calls start in Grid View. Focus View makes one stream largest, leaves other streams as smaller tiles, and can hide the member strip entirely. | Desktop users can change resolution and frame rate while live; the browser client does not expose this control. Discord documents 720p/30 for all users and higher tiers up to 4K/60, but does not document its adaptation algorithm. | One-click focus plus optional distraction-free mode; independent resolution/FPS controls. [Discord Help](https://support.discord.com/hc/en-us/articles/360040816151-Go-Live-and-Screen-Share) |
| Google Meet | Auto layout considers browser size, participant count, and an active presentation; Spotlight fills the window; Sidebar preserves thumbnails. Meet supports local pinning of up to six tiles/presentations, and a presentation can be enlarged, fullscreen, zoomed, or popped out. | Meet warns that more tiles can cause freezing and recommends reducing tile count. This supports linking layout to receiver resource use, but Google does not disclose its transport algorithm on these pages. | Local focus state, full-window and pop-out presentation, and a tile-count/resource relationship. [Layouts](https://support.google.com/meet/answer/9292748), [pinning](https://support.google.com/meet/answer/7501121), [screen-share viewing](https://support.google.com/meet/answer/16581830) |
| Microsoft Teams | A participant can pin a video for their own view; “Focus on content” removes distractions while content is presented; organizers can spotlight for everyone. Shared content supports receiver-side pinch/drag zoom. | Teams exposes call-health resolution, frame rate, packet loss and processing metrics. It documents 1–30 fps and 160×90–1920×1080 as typical adaptive screen-share ranges, and says it may limit peak bandwidth due to network/service conditions or a participant choosing lower quality. “Optimize video” reduces choppiness, and Teams says static content favors picture quality while motion favors frame rate. The precise algorithm is proprietary. | Separate private focus from moderated spotlight; expose diagnostics; provide text/detail versus motion modes and an automatic mode. [Video views](https://support.microsoft.com/en-us/teams/meetings/use-video-in-microsoft-teams), [call health](https://support.microsoft.com/en-us/teams/meetings/monitor-call-and-meeting-quality-in-microsoft-teams), [present content](https://support.microsoft.com/en-US/teams/meetings/present-content-in-microsoft-teams-meetings), [content processing](https://support.microsoft.com/en-us/teams/troubleshooting/how-microsoft-teams-uses-ai-to-enhance-audio-and-video-in-meetings) |

Discord also documents semantic presets: “Smoother Video” trades resolution for frame rate, while “Better Text Readability” preserves resolution and lowers frame rate. This is especially relevant to AllChat because it gives users intent-based choices without asking them to understand codecs. [Discord product article](https://discord.com/blog/how-to-stream-to-discord-from-desktop-or-mobile)

Google Meet exposes independent maximum send and receive resolution settings (1080p, 720p, 360p, and receive audio-only), with lower receive settings reducing or disabling video to save data. Google's page describes general meeting video and does **not** establish that presentation tracks use those exact settings, so it is evidence for separate endpoint controls, not evidence of Meet's proprietary screen-share transport. [Google Meet video settings](https://support.google.com/meet/answer/9302964?co=GENIE.Platform%3DDesktop&hl=en)

## WebRTC mechanisms and their limits

### Capture envelope

`getDisplayMedia()` constraints are applied **after** the user selects a surface; they cannot remove choices from the picker. Width, height, and frame-rate constraints permit browser downscaling and frame decimation. `max` values are suitable for a hard envelope, and `applyConstraints()` can change a live track later. The screen-capture specification says the browser should preserve aspect ratio, must not crop or upscale, and should consider downscaled dimensions and decimated frame rates. A permanently inaccessible source ends its track, while a temporarily inaccessible/minimized source is muted. [W3C Screen Capture](https://w3c.github.io/mediacapture-screen-share/#constrainable-properties-for-captured-display-surfaces)

Practical sender envelopes:

| Mode | Capture ceiling | Hint | Intended compromise |
|---|---:|---|---|
| Text | 1920×1080 at 5–15 fps | `text` | Preserve readable edges; sacrifice motion. |
| Balanced | 1920×1080 at 15–24 fps | `detail` | General desktop/application sharing. |
| Motion | 1280×720 at 30 fps | `motion` | Reduce pixels per frame to preserve cadence. |
| Data saver | 960×540 or 1280×720 at 10–15 fps | `detail` or `motion` | Explicit sender-side CPU/network reduction. |

Those numeric presets are a proposed starting point, not a standard or a claim about competitors. Measure them on AllChat's supported devices.

### Encoder controls

`RTCRtpSender.setParameters()` can alter each negotiated encoding's `active`, `maxBitrate`, `maxFramerate`, and `scaleResolutionDownBy`. Simulcast encodings and immutable RIDs must be established when the transceiver is created; `setParameters()` is for changing the negotiated encoding parameters, not adding arbitrary new layers later. The WebRTC specification uses 4:2:1 as its three-layer example and requires a scaling factor of at least 1. [W3C WebRTC](https://w3c.github.io/webrtc-pc/#dom-rtcrtpencodingparameters-scaleresolutiondownby)

`MediaStreamTrack.contentHint` supports `motion`, `detail`, and `text`. The specification maps `motion` to preserving frame rate, while `detail` and `text` preserve resolution; it explicitly describes text becoming unreadable when treated like ordinary motion video and high-motion shares dropping frames when treated like text. Hints express intent, not a quality guarantee, so support and observed behavior must be tested in the Electron Chromium version and each mobile WebRTC build. [W3C Content Hints](https://w3c.github.io/mst-content-hint/#video-content-hints)

`degradationPreference` is specified as an explicit sender preference in the content-hints model, but interoperability has historically varied. Prefer `contentHint` plus capture/encoding bounds; feature-detect and verify `degradationPreference` before depending on it.

### Measurement and automatic adaptation

Sample `getStats()` deltas rather than cumulative values. Sender signals include actual encoded/sent resolution and FPS, bitrate from `bytesSent`, `framesEncoded`, `totalEncodeTime`, `qualityLimitationReason` (`cpu`, `bandwidth`, etc.), and resolution-change counts. Receiver signals include actual resolution/FPS, bitrate, packet loss, `framesDecoded`, `framesRendered`, `framesDropped`, `totalDecodeTime`, jitter-buffer delay, NACK/PLI/FIR counts, and freeze metrics where implemented. The stats specification defines `framesDropped` as frames dropped before decode or because they missed their display deadline. [W3C WebRTC Stats](https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats-framesdropped)

A safe automatic controller needs hysteresis, for example:

- evaluate every 2 seconds over rolling 6–10 second windows;
- downgrade promptly after sustained CPU/bandwidth limitation, rising drop ratio, missed render cadence, or severe loss;
- upgrade one step only after a longer healthy interval;
- apply a cooldown after each change to avoid oscillation;
- never infer receiver decode trouble from sender stats alone.

Thresholds require profiling and are intentionally not prescribed here.

### Receiver-side quality requires server cooperation

A `<video>` element cannot ask an ordinary single-layer inbound RTP stream to become lower resolution. CSS resizing only changes rendering size after the same bytes have arrived and generally after the same frames have been decoded. A true receiver downgrade therefore needs one of:

1. an SFU selecting among publisher simulcast layers per subscriber;
2. an SFU selecting a spatial/temporal SVC layer per subscriber;
3. an SFU transcoding a lower rendition (expensive); or
4. receiver feedback that makes the publisher lower quality for everyone (simple but globally coupled).

LiveKit is a useful documented SFU precedent: its adaptive stream observes the attached element's size and visibility, asks the server for the matching simulcast layer, and pauses delivery when hidden; it also exposes explicit subscriber quality selection. This is a first-party description of LiveKit, not evidence that Discord/Meet/Teams use the same implementation. [LiveKit subscriptions](https://docs.livekit.io/transport/media/subscribe/#adaptive-stream)

Mediasoup exposes the same architectural seam explicitly through `consumer.setPreferredLayers({ spatialLayer, temporalLayer })` for simulcast/SVC consumers. This is further first-party evidence for per-consumer SFU selection, not a claim about the major proprietary products. [Mediasoup Consumer API](https://mediasoup.org/documentation/v3/mediasoup/api/#consumer-setPreferredLayers)

## Current AllChat architecture and gaps

### Focus/maximize

- The server-rendered voice stage already toggles `.expanded` **only when the tile is sharing a screen** (`internal/instance/web/assets/voice-sidebar.js`); CSS makes that tile fixed and nearly viewport-sized (`internal/instance/web/assets/channel.css`). Ordinary participant tiles have no focus action.
- The native desktop React grids render participant tiles without focus state or interaction (`desktop/src/renderer/app.tsx`). Remote screens are imperatively portaled into the matching participant tile.
- Direct-call web tiles render screens but do not implement the voice-stage expanded behavior (`internal/instance/web/assets/call.js`).

Therefore the first issue is primarily missing shared UI state, not a media limitation. Implement `focusedMediaMemberId` plus a presentation/fullscreen variant across desktop, web, and mobile. Keep it viewer-local; a later moderator “spotlight for everyone” is a different signaling feature.

### Lingering final frame

- AllChat correctly has an explicit `video-stopped` signaling message and the SFU calls `ReplaceTrack(nil)` because browsers may still emit padding/frozen frames after unpublishing (`internal/media/sfu.go`).
- Native desktop `bindRemoteScreenTrack()` removes state on `mute` and `ended`, but the native connection callback passes media frames into `createMediaFrameQueue()`, whose handler has no `video-stopped` case. Consequently desktop does **not** consume the authoritative stop message and can retain a live/muted remote stream until a browser track event happens (`desktop/src/renderer/app.tsx`, `desktop/src/renderer/media-signaling.ts`). The web direct-call receiver already handles `video-stopped` by removing its video element (`internal/instance/web/assets/call.js`). This is the strongest code-level explanation for the reported desktop-to-desktop lingering frame.
- Removing a React portal or DOM node should be accompanied by clearing `video.srcObject`, pausing the element, and deleting the owner entry. This is defensive compositor cleanup; the authoritative correctness boundary remains the explicit application signal because RTP track end/mute timing is not guaranteed to represent a sender calling `replaceTrack(null)`.

Recommended stop transaction:

1. Sender stops publication and sends `video-stopped` with owner/source identity and a monotonically increasing publication ID.
2. SFU immediately gates forwarding (`ReplaceTrack(nil)`) and broadcasts the stopped state.
3. Receiver validates the publication ID, deletes screen state, pauses the element, assigns `srcObject = null`, removes it, and rerenders the avatar.
4. `mute`, `ended`, participant departure, peer close, and a short no-frame watchdog remain idempotent fallback cleanup paths.
5. A later `video-started` creates a new publication ID so delayed events from the old track cannot resurrect or remove the new share.

The publication ID is an AllChat design recommendation; it is not required by WebRTC.

### High-resolution adaptation

- Server-rendered web paths create `q/h/f` at 4×/2×/1× with 250 kbps/750 kbps/configured maximum (`internal/instance/web/assets/voice-sidebar.js`, `internal/instance/web/assets/call.js`).
- The native desktop React path currently creates a single send-only transceiver without `sendEncodings`, capture bounds, `contentHint`, or sender parameters (`desktop/src/renderer/app.tsx`). This means desktop-to-desktop—the reported failing path—does not obtain the web path's simulcast behavior.
- The SFU drains `q` and `h` and republishes only `f`. Its `screen-high`/`screen-low` message enables or disables sender layers globally based on whether **any** other room member reports the page visible. Thus `screen-low` saves publisher work only when nobody is visible; it does not send a low layer to a weak receiver, and one visible viewer requests full quality for all (`internal/media/sfu.go`).
- Visibility is document-level, not tile visibility or dimensions. There is no stats-driven sender or receiver controller.

## Implementation options

### Option A — Fast mitigation: sender presets and deterministic cleanup

Add focus UI, stop-state cleanup, capture envelopes, hints, single-encoding `maxBitrate`/`maxFramerate`, and a quality selector to every client. Add `Auto` that uses sender stats to step among preset ceilings. No SFU routing redesign.

**Benefits:** smallest scope; immediately fixes desktop single-layer overload; explicit user escape hatch similar to Discord/Teams; compatible with direct calls and rooms.  
**Costs:** a receiver cannot independently downgrade; sender changes affect every viewer; changing capture constraints may visibly resize the encoded stream; mobile API parity must be checked.  
**Use:** recommended first release.

### Option B — Per-receiver simulcast selection in the current SFU

Publish `q/h/f` from all capable clients. Replace the single `screenTracks[room][owner]` with publication/layer state. Each receiver reports focused tile dimensions, visibility, device/data-saver preference, and decode-health tier. The SFU forwards the chosen RID to that receiver and propagates RTCP feedback to the correct upstream SSRC. Pause hidden subscriptions.

**Benefits:** independently protects weak receivers; focus automatically earns a higher layer; thumbnails and hidden tiles consume less bandwidth/decoder work; closely follows the documented adaptive-stream pattern.  
**Costs:** material Pion/SFU work; layer switching requires keyframe coordination, RTP sequence/timestamp continuity, and correct RTCP routing; publisher CPU/uplink rises when multiple layers are active.  
**Use:** recommended durable target.

### Option C — SVC-first routing

Negotiate VP9 or AV1 scalability modes where the full client matrix supports them, then let the SFU select spatial/temporal layers per subscriber. Retain simulcast/fallback codecs for unsupported clients.

**Benefits:** potentially better inter-layer efficiency and one encoded dependency structure.  
**Costs:** the hardest compatibility and implementation path across Electron, browsers, React Native WebRTC, hardware encoders, and Pion; requires careful dependency-descriptor/codec work; not appropriate as the first fix.  
**Use:** later experiment after Option B instrumentation exists.

### Option D — Server transcoding renditions

Decode the incoming high layer and encode receiver-specific lower renditions.

**Benefits:** works even when publishers cannot simulcast/SVC; server controls exact output.  
**Costs:** high CPU/GPU cost, added latency, operational complexity, and another quality loss; changes the SFU into a media processor.  
**Use:** only for legacy-client bridging or recording, not the default interactive path.

## Proposed staged plan

1. **Correctness/UI:** shared focus model; explicit Focus/Exit controls and keyboard handling; fullscreen/pop-out where platform permits; authoritative publication IDs; hard receiver cleanup on stop.
2. **Desktop parity:** give Electron the same initial `sendEncodings` as web, set a content hint, and apply a bounded capture preset. Verify the actual negotiated encodings with `sender.getParameters()` and outbound stats rather than assuming Chromium honored the request.
3. **Diagnostics:** record 2-second sender/receiver deltas and display a developer call-health panel. Add reproducible 4K/5K text-scroll and 1080p60-motion scenarios to existing media profiling.
4. **Preset/Auto controller:** expose Text/Balanced/Motion/Data saver; implement hysteresis from measured CPU, bandwidth, encode, and decode signals.
5. **SFU layer routing:** per-subscription desired tier from element dimensions/visibility and receiver health; pause hidden video; request keyframes on layer transitions; preserve continuity; fall back safely to the only available layer.
6. **SVC trial:** run only after the simulcast implementation supplies measurements and a fallback control plane.

## Decisions to make

- Should focus be one item or multi-pin? Recommendation: one focused item for v1, because AllChat currently has one active screen share and a simple stage.
- Should users select resolution and FPS independently or choose semantic modes? Recommendation: semantic modes with an Advanced submenu; users understand “Text” and “Motion” better, while advanced controls retain Discord-like agency.
- Does “receiver downgrade” mean save decoder CPU, network, or both? Recommendation: both; CSS/downscaled rendering alone accomplishes neither reliably, while SFU layer selection saves network and usually decoder work.
- Should one unhealthy viewer reduce everyone? Recommendation: only in Option A as an acknowledged temporary limitation; Option B removes the coupling.

## Validation criteria

- Focusing any participant or screen share is accessible by pointer and keyboard, survives participant-list rerenders, exits with Escape, and does not change other users' layouts.
- A stopped share disappears before the next compositor frame where practical; stale `mute`/`ended`/signaling events cannot affect a newer publication.
- A 4K sender does not silently remain single-layer on Electron; stats prove negotiated resolution, FPS, bitrate, and active layer.
- A receiver constrained by CPU or bandwidth steps down without changing a healthy focused receiver once per-receiver SFU selection ships.
- Layer changes do not cause long black/frozen periods; PLI and continuity behavior are covered by tests.
- Hidden/offscreen shares stop consuming forwarded video bytes after a short grace period.
