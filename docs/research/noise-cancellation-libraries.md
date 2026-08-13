# Free real-time noise cancellation for web and Android

Research date: 2026-08-13

## Recommendation

Use a layered design, not a single replacement for the whole voice pipeline:

1. Keep the browser/native WebRTC Audio Processing Module (APM) responsible for acoustic echo cancellation (AEC), high-pass filtering and gain control. A denoising model cannot replace AEC because it has no reliable reference signal for audio being played through the device speaker.
2. Benchmark **RNNoise 0.2** as AllChat's first optional "enhanced noise suppression" engine. It is the best fit for a shared web/Android implementation: small C API, permissive BSD-3-Clause license, 48 kHz streaming frames, maintained upstream, and no inference runtime dependency.
3. Prototype **GTCRN through sherpa-onnx** behind the same PCM processor interface as a possible higher-quality successor. Its official implementation reports better DNSMOS than RNNoise at similar compute, and sherpa-onnx exposes GTCRN to Android and WebAssembly. The 16 kHz speech bandwidth, generic runtime footprint, model provenance and device performance still need qualification before shipping.
4. Treat **DeepFilterNet** as a desktop-quality experiment, not the initial mobile/web choice. It is genuinely real-time and permissively licensed, but it is materially larger and has no upstream browser/Android integration.
5. Do not add SpeexDSP solely for denoising. It is useful on constrained/native systems, but its classical preprocessor is an older, weaker alternative to both WebRTC NS and neural suppression.

This recommendation is subject to an acoustic bake-off on representative phones and browsers. Published model metrics are not interchangeable and do not predict echo, double-talk, keyboard transients, or speech damage on AllChat devices.

## Comparison

| Candidate | License and model | Web browser | Android/native | Real-time/size evidence | Project status and main limitation | Fit |
|---|---|---|---|---|---|---|
| **WebRTC APM** | WebRTC source is BSD-3-Clause; its conventional NS is code, not a separately downloaded model. | Already available through `echoCancellation`, `noiseSuppression`, and `autoGainControl` capture constraints. The standard exposes booleans, not algorithm or aggressiveness selection. | Already inside the native WebRTC dependency used by `react-native-webrtc`; APM can also be built standalone. Native configuration requires changes below the React Native JS API. | Designed for VoIP and processes capture/render audio; upstream describes AEC, NS and AGC as its core effects. No stable upstream binary-size/CPU promise. | Actively developed as part of WebRTC. Browser behavior is intentionally user-agent/platform dependent, so identical settings do not guarantee identical output. | **Keep as baseline and AEC layer.** Lowest integration risk, but not "Krisp-like" isolation. |
| **RNNoise 0.2** | BSD-3-Clause C library. The repository distributes/downloads its default model and says current distributed models use public datasets; the repository license covers the shipped source/model artifacts, but downstream notices still need to be retained. | Xiph supplies no web package. Jitsi maintains an Apache-2.0 Emscripten/WASM wrapper specifically including a synchronous build for AudioWorklet use; its README warns that one prebuilt variant still uses old RNNoise 0.1, so rebuild/pin 0.2 rather than consuming `dist` blindly. Buffer worklet quanta into 480-sample, 48 kHz mono frames. | Straightforward NDK/JNI or direct C++ linkage in a forked native WebRTC audio path. Must be placed after capture/AEC and before encoding, without crossing the React Native JS bridge. | Full-band, real-time neural suppressor; API/demo consumes 48 kHz mono frames. Upstream recommends SSE4.1/AVX2 on x86 and ships a more sparse "little" model. The official GTCRN comparison lists RNNoise at about 0.06M parameters and 0.04 GMAC/s. | v0.2 includes improved training and SIMD/runtime CPU detection; upstream activity and data/model updates continued in 2024–2025. Single-channel suppressor, not AEC; frame adaptation and WASM/native glue are ours to maintain. | **Best first enhanced engine.** Portable, mature, small integration surface. |
| **GTCRN + sherpa-onnx** | GTCRN repository and checkpoints are MIT; sherpa-onnx is Apache-2.0. The GTCRN README says checkpoints were trained on DNS3 and VCTK-DEMAND; independently verify model/dataset redistribution obligations and preserve the upstream model notice. | sherpa-onnx officially supports WebAssembly/JavaScript and documents GTCRN speech enhancement. AllChat still needs an `AudioWorklet`, a minimal WASM build and streaming buffers. | sherpa-onnx officially supports Android, Kotlin/Java and C/C++, and documents GTCRN APIs. Integration still needs a native WebRTC PCM hook, resampling/STFT state and a minimal runtime build. | Official GTCRN figures: 48.2K parameters, 33.0 MMAC/s, and streaming RTF 0.07 on one i5-12400 CPU. Its comparison reports higher DNSMOS background/overall scores than RNNoise. It operates at 16 kHz, unlike RNNoise/DeepFilterNet's full-band 48 kHz paths. | Active projects with 2025–2026 GTCRN deployment additions. Phone/browser performance is undocumented; sherpa's generic Android AAR contains many unrelated features and is much larger than the model, so a custom minimal build is important. | **Most promising follow-up prototype.** Strong compute/quality claim and real platform path, but higher footprint, bandwidth and provenance risk. |
| **DeepFilterNet 2/3** | Repository code is dual MIT or Apache-2.0 and includes pretrained models. The README makes that statement for all repository code; record exact model files and notices in a dependency audit. | No official WASM/browser build. Rust can target WASM in principle, but the upstream real-time demo is Linux-only and no AudioWorklet integration is supplied. | Rust `libDF` and a real-time command/plugin exist, so native embedding is feasible. No official Android AAR/JNI integration or mobile benchmark is supplied. | Full-band 48 kHz. DeepFilterNet2 paper reports RTF 0.04 on a notebook Core-i5; tooling exposes compensation for STFT/model lookahead. Upstream does not document Android/browser CPU, memory, package size or thermal behavior. | Maintained open-source research framework with Linux/macOS/Windows support. Heavier Rust/model integration, added latency, and unsupported mobile/web targets make it risky for the first cross-platform engine. | **Quality experiment, not first ship target.** |
| **SpeexDSP preprocessor** | BSD-3-Clause, no model. | C can be compiled to WASM, but upstream supplies no maintained browser package or AudioWorklet integration. | Small native C library; easy NDK/JNI integration. It also has an echo canceller, but replacing WebRTC AEC would discard a better-integrated render-reference pipeline. | Streaming classical DSP. Its preprocessor provides denoise, AGC and VAD; upstream does not publish a current cross-device quality/CPU benchmark. | Mature but comparatively quiet/legacy codebase. It attenuates stationary background noise; it is not a modern learned voice-isolation model. | **Fallback only.** Not a meaningful upgrade over the existing WebRTC baseline without measurements proving otherwise. |

## Integration consequences for AllChat

### Web

The standards-defined path is:

`getUserMedia` (AEC on, browser NS off for enhanced mode) → `MediaStreamAudioSourceNode` → `AudioWorklet` + WASM suppressor → `MediaStreamAudioDestinationNode` → WebRTC sender.

The browser capture specification defines `echoCancellation`, `noiseSuppression`, and `autoGainControl`, but does not standardize which implementation is used or expose a suppression strength. Therefore the existing settings page should distinguish:

- **Standard**: browser `noiseSuppression: true`.
- **Enhanced**: browser AEC retained, browser NS disabled, one AllChat WASM suppressor applied.
- **Off**: browser NS disabled; AEC remains independently selectable.

Never stack browser NS and RNNoise/GTCRN by default: double suppression increases speech damage and makes behavior impossible to tune consistently. Verify applied capture settings with `MediaStreamTrack.getSettings()`, while treating them as requested/applied flags rather than a quality guarantee.

An `AudioWorklet` callback normally receives smaller blocks than RNNoise's 480-sample frame, so the processor needs allocation-free input/output ring buffers. WASM/model initialization must happen before swapping the live sender track, and overload must fail open to the APM-only track rather than break a call.

### Android / React Native WebRTC

Do not move PCM through the React Native bridge. The upstream `react-native-webrtc` maintainers explicitly closed raw-track access as unsupported, and base64/data-channel work is not an audio capture replacement. Enhanced suppression therefore belongs in the pinned native WebRTC fork:

`Android AudioDeviceModule capture → WebRTC AEC/APM → RNNoise/GTCRN native processor → Opus encoder`.

The exact callback order must be proven in the fork with an impulse/render-reference test; adding a generic PCM callback at the wrong point can denoise before AEC and degrade echo cancellation. Preserve 10 ms pacing and avoid heap allocation, locks, JNI calls, or React events on the audio thread. UI level events should be aggregated and throttled off-thread.

Ship ARM64 first in the prototype, then test armeabi-v7a and emulator ABIs only if they remain supported release targets. Device gates should cover real-time deadline misses, thermal throttling, Bluetooth SCO bandwidth, speakerphone double-talk, and route changes.

## Suggested evaluation

Build one processor contract shared by native and WASM test vectors, then compare:

- WebRTC NS alone.
- AEC plus RNNoise 0.2 full model.
- AEC plus RNNoise "little" model.
- AEC plus GTCRN if its redistribution audit passes.
- DeepFilterNet3 on desktop and one upper-midrange Android phone as a ceiling reference.

Measure end-to-end added latency, audio-thread deadline misses, CPU, memory, download/APK size, battery/thermal behavior, echo return loss, double-talk speech damage, and objective plus listening scores. Include stationary fan/road noise, keyboard impulses, competing speech, music, quiet speech, speakerphone echo, wired headsets and Bluetooth. A library should not ship based only on the model author's DNSMOS/PESQ numbers.

## Primary sources

- WebRTC: [Audio Processing Module overview](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/g3doc/audio_processing_module.md), [APM configuration/API](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/include/audio_processing.h), [BSD license](https://webrtc.googlesource.com/src/+/refs/heads/main/LICENSE), [Media Capture constraints specification](https://www.w3.org/TR/mediacapture-streams/).
- React Native WebRTC: [official repository and bundled WebRTC revision](https://github.com/react-native-webrtc/react-native-webrtc), [raw audio access closed as unsupported](https://github.com/react-native-webrtc/react-native-webrtc/issues/1552).
- RNNoise: [official repository, build/model/training documentation](https://github.com/xiph/rnnoise), [BSD-3-Clause license](https://github.com/xiph/rnnoise/blob/main/COPYING), [v0.2 release](https://github.com/xiph/rnnoise/releases/tag/v0.2), [algorithm paper](https://arxiv.org/abs/1709.08243).
- GTCRN: [official implementation, checkpoints, streaming figures and deployment links](https://github.com/Xiaobin-Rong/gtcrn), [MIT license](https://github.com/Xiaobin-Rong/gtcrn/blob/main/LICENSE), [paper](https://arxiv.org/abs/2310.13629).
- Deployment wrappers: [Jitsi RNNoise WASM](https://github.com/jitsi/rnnoise-wasm), [sherpa-onnx platform matrix and GTCRN support](https://github.com/k2-fsa/sherpa-onnx), [sherpa-onnx Apache-2.0 license](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE), [speech-enhancement model release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speech-enhancement-models).
- DeepFilterNet: [official framework, platforms, models and real-time interfaces](https://github.com/Rikorose/DeepFilterNet), [MIT/Apache licensing statement](https://github.com/Rikorose/DeepFilterNet#license), [DeepFilterNet2 real-time paper](https://arxiv.org/abs/2205.05474).
- SpeexDSP: [official repository](https://github.com/xiph/speexdsp), [BSD-3-Clause license](https://github.com/xiph/speexdsp/blob/master/COPYING), [preprocessor manual](https://github.com/xiph/speexdsp/blob/master/doc/manual.lyx), [echo API](https://github.com/xiph/speexdsp/blob/master/include/speex/speex_echo.h).
