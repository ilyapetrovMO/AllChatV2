# Native Voice Rooms and Direct Calls

Type: task
Status: claimed
Blocked by: 02, 04

Implement the fail-closed Media Session controller, WebRTC signaling, media recovery, foreground call service, Android Core-Telecom Direct Calls, soundboard, and MediaProjection screen viewing and broadcast.

## Comments

- Added a native WebRTC Media Session controller using the existing versioned signaling and TURN endpoints, resume/takeover recovery, fail-closed track cleanup, Voice Rooms, camera video, MediaProjection screen sharing, and Direct Call controls with split media/chat layout.
- Android compilation passes with `react-native-webrtc` across all configured ABIs. Added native soundboard playback and an Android foreground media notification with microphone/camera/MediaProjection service types. Core-Telecom integration and device endurance testing remain open.
