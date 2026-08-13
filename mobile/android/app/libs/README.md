# AllChat WebRTC with RNNoise

`allchat-webrtc-m124-rnnoise.aar` replaces the dynamic
`org.jitsi:webrtc:124.+` dependency used by `react-native-webrtc` on Android.
It is checked in so normal application builds do not depend on a separate
repository or artifact registry.

Pinned inputs:

- WebRTC branch-heads/6167: `6713461a2fb331c43d42b781fbe29da3f5d504a6`
- RNNoise 0.2: `904a876dce1f9ab8860c0a5000ed151f9f6eef58`
- RNNoise model version: `0b50c45`
- RNNoise model archive SHA-256: `4ac81c5c0884ec4bd5907026aaae16209b7b76cd9d7f71af582094a2f98f4b43`
- RNNoise generated model data SHA-256: `522b6a64fded05bf85e58c06206eafe57ce7d94f3af58c725b17628b481d7890`
- AAR SHA-256: `307a4f0c4e5a72f5d29c9b10c10709ea2605ebfa066c95b73f3bc1f76a1e0e47`

The processor is installed as WebRTC capture post-processing, after AEC and
before encoding. Enhanced mode enables it atomically on the native audio
thread; Standard and Off bypass it. No PCM crosses the React Native bridge or
JNI per frame. When Enhanced is selected, the wrapper disables WebRTC's
standard noise suppressor to avoid stacking two suppressors; echo cancellation
remains independently controlled by the existing setting.

WebRTC capture formats that are not 48 kHz are resampled on the native audio
thread into RNNoise's required 480-sample/48-kHz frames and back. Resampler
state and scratch buffers are allocated during initialization, never per frame.

The AAR contains `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64` libraries.
RNNoise is BSD-3-Clause licensed; its notice and the other bundled notices are
in `allchat-webrtc-m124-rnnoise.LICENSE.md` next to the artifact.
