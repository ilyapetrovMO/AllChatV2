# Discord desktop application stack

Research date: 2026-08-18

## Executive summary

Discord's desktop client is a web client packaged in **Electron**, with a **React 19** renderer and native components where browser APIs are insufficient. The latest version Discord has publicly identified is **Electron 37** (December 2025). Its media path uses **WebRTC**, augmented by Discord-owned native C/C++ capture, encoding, and media code. Discord also uses Electron native modules and is migrating selected shared client stores and APIs from JavaScript to **Rust**.

This supports an AllChat direction of Electron + the existing web UI, with a deliberately small main/preload boundary and native capabilities added only where the browser implementation falls short. It does **not** support claiming that Discord uses Electron Forge, Electron Builder, Squirrel, a particular JavaScript bundler today, or any specific Electron sandbox configuration: Discord's current primary sources do not establish those details.

## What is verifiably current

| Area | Finding | Confidence and source |
|---|---|---|
| Desktop shell/runtime | Electron. Discord described Electron as its desktop wrapper in December 2024 and upgraded the desktop app to Electron 37 in December 2025. | Current and direct: [64-bit migration](https://discord.com/blog/how-discord-seamlessly-upgraded-millions-of-users-to-64-bit-architecture), [December 2025 patch notes](https://discord.com/blog/discord-patch-notes-december-8-2025) |
| UI | React; React 19 was rolled out across all clients in 2025. Discord explicitly distinguishes React on desktop from React Native on mobile. | Current and direct: [mobile performance post](https://discord.com/blog/supercharging-discord-mobile-our-journey-to-a-faster-app), [June 2025 patch notes](https://discord.com/blog/discord-patch-notes-june-3-2025) |
| Application languages | The wider Discord monorepo actively uses TypeScript, Rust, C/C++, Python, and Elixir. This is organization-wide context, not proof that every language is part of the desktop binary. | Current but broad: [cloud development environments](https://discord.com/blog/how-discord-moved-engineering-to-cloud-development-environments) |
| Native modules | Discord uses Electron native modules. A documented macOS WebAuthn module is written in Objective-C++, invokes `ASAuthorizationController`, and is called from renderer to main via IPC. Native modules can be downloaded on first use rather than bundled. | Direct, feature-specific: [WebAuthn architecture](https://discord.com/blog/how-discord-modernized-mfa-with-webauthn) |
| Shared native core | Discord reported migrating core stores and API interfaces shared across its apps from JavaScript to Rust; at least one store had shipped by June 2025. | Current, rollout in progress: [June 2025 patch notes](https://discord.com/blog/discord-patch-notes-june-3-2025) |
| Voice/video transport | WebRTC. Discord describes WebRTC as part of the desktop stack, and current Go Live material still describes WebRTC-driven transport and bandwidth estimation. | Current: [64-bit migration](https://discord.com/blog/how-discord-seamlessly-upgraded-millions-of-users-to-64-bit-architecture), [Go Live architecture](https://discord.com/blog/how-it-all-goes-live-an-overview-of-discords-streaming-technology) |
| Screen capture/encoding | Discord has custom capture and encoding code integrated with OS APIs and video drivers. Capture selects an OS-appropriate method with fallbacks; some Windows methods may use DLL injection. It uses OS-specific audio capture, hardware codecs when possible, and WebRTC for transport. | Current and direct: [Go Live architecture](https://discord.com/blog/how-it-all-goes-live-an-overview-of-discords-streaming-technology), [AMD encoding post](https://discord.com/blog/from-blocky-to-brilliant-improving-video-quality-on-discord-go-live-on-amd-gpus) |
| Packaging/distribution | Official builds exist for Windows and macOS, plus Linux `.deb`, `.tar.gz`, `.rpm`, and `.pkg.tar.zst` downloads. Windows offers x64 and ARM64. Discord operates Stable, PTB/Beta, and Canary/Alpha channels. | Current and direct: [download page](https://discord.com/download), [testing clients](https://support.discord.com/hc/en-us/articles/360035675191-Discord-Testing-Clients) |
| Updating | Discord has an in-app updater with monotonically "new" version behavior. Its 32-to-64-bit migration used parallel versioned builds, manifest targeting, and automatic rollback to 32-bit for failed launches. | Direct behavior, implementation library undisclosed: [64-bit migration](https://discord.com/blog/how-discord-seamlessly-upgraded-millions-of-users-to-64-bit-architecture) |

## Process and security architecture

The publicly documented WebAuthn path shows the conventional Electron split:

1. Renderer UI initiates the operation.
2. Renderer sends IPC to the Electron main process.
3. Main, which has the application window, invokes an Objective-C++ native module and macOS system APIs.
4. The result returns to the renderer over IPC.

Discord says its renderer cannot directly access the relevant window capability, which is good evidence for a privilege boundary. It is **not** evidence for the values of `sandbox`, `contextIsolation`, `nodeIntegration`, a Content Security Policy, IPC allowlists, or navigation/window-open restrictions. Discord has not documented those current settings in the primary sources reviewed here. AllChat should follow current [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security) independently rather than infer Discord's private configuration.

## Current versus historical evidence

These older posts describe important lineage, but should not be copied as a statement of Discord's exact 2026 implementation:

- A 2018 post says Discord used webpack route-based code splitting and Flow. The current renderer is still React, but these exact build and type-system choices are historical: [How Discord Maintains Performance While Adding Features](https://discord.com/blog/how-discord-maintains-performance-while-adding-features).
- A 2018 voice post says desktop/mobile shared a custom C++ engine built on native WebRTC and documents custom signaling, transport, encryption, and system-wide push-to-talk behavior. Current sources still confirm WebRTC and native voice modules, but do not prove every 2018 low-level choice remains unchanged: [voice architecture](https://discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc).
- The 2024 DAVE announcement says desktop and mobile already supported Discord's new audio/video E2EE and describes WebRTC encoded transforms for web compatibility. It establishes continuing WebRTC investment, not the exact desktop module layout: [Meet DAVE](https://discord.com/blog/meet-dave-e2ee-for-audio-video).

## Unknown from primary sources

The following should remain product decisions for AllChat rather than be presented as "the Discord stack":

- Electron Forge vs Electron Builder vs a proprietary packaging pipeline.
- Squirrel, NSIS, Sparkle, electron-updater, or another updater implementation.
- The renderer bundler used today.
- State management and styling libraries.
- Exact Electron sandbox, context-isolation, Node-integration, permission, and CSP configuration.
- Whether every voice call still traverses the same custom native engine described in 2018.
- Code-signing, notarization, and release-promotion implementation details.

## Implication for AllChat

The faithful architectural analogue is:

- Electron shell on Windows first, designed to package for macOS and Linux.
- Render the existing AllChat web application so desktop remains a visual and functional carbon copy.
- Reuse the same frontend code and server APIs; keep desktop-only behavior behind a narrow, typed preload API.
- Use Electron/Chromium WebRTC initially. Add native media modules only after measured feature or quality gaps justify their security and maintenance cost.
- Treat tray, notifications, deep links, launch-on-login, window lifecycle, global shortcuts, screen-source selection, updates, and credential storage as shell responsibilities.
- Design multiple Instance sessions as isolated partitions for cookies/storage, notifications, windows, and deep-link routing.
- Build an explicit update and signing design; Discord's public material confirms the product behavior but does not reveal a reusable implementation stack.
