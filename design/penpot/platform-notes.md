# Platform coverage and capture constraints

## Web

Fourteen authenticated routes have fresh default/empty-state screenshots and DOM control records. These do not cover all menus, permissions, rich conversation content, authentication branches, responsive states or activity runtime. Most web page templates are Go string literals under `internal/instance/*_http.go`; discovery must include them.

## Desktop

Captures use a freshly built Linux Electron package, a temporary user-data directory and disposable local instance. They include the native application title bar and current renderer; they are not browser approximations. Windows/macOS shell differences and OS dialogs remain unverified. The earlier parity harness's onboarding selectors are stale: the current UI asks for `Community address`, not `Instance name` and `Instance address`.

`xvfb-run -a node design/penpot/capture.mjs --desktop` captures onboarding, sign-in, community home, text channel, and member settings. Build first with `npm --prefix desktop run build`. Scroll-state captures preserve the actual panel layout rather than stretching it into a tall viewport.

## Mobile

Android SDK platform-tools are available. `adb devices` succeeded with no connected devices. No emulator executable exists at the installed SDK's `emulator/emulator` path. No native mobile screenshot evidence has been produced; responsive web screenshots must not be mislabeled mobile-client captures.

Source review confirms separate account loading, add-instance/sign-in, account management, and update-prompt branches in `mobile/App.tsx`; `CommunityScreen.tsx` controls reply/edit drafts, pending attachments, search/pins panels, member list/profile, moderation, global/channel notification panels, media rooms and calls. Both light/dark palettes are implemented in App.tsx. These branches still need native runtime captures and detailed component/state review.

## Penpot

Current file remains at revision 5 in repeated live reads despite newer plugin-visible edits. Native board export fails for a minimal test shape, and version save timed out. This is evidence of a live/persisted-state discrepancy, not a confirmed root cause. Preserve the open browser tab until its save state is understood; do not discard unsaved edits or assume an export is current.

### Windows emulator follow-up

A subsequent cross-platform check found the Windows emulator at `C:\Users\bigboss\AppData\Local\Android\Sdk\emulator\emulator.exe`. `-accel-check` reports WHPX installed and usable. No AVD or system image existed. Installation of `system-images;android-35;google_apis;x86_64` has started in that existing SDK using its already-accepted license. Native capture is still pending completion, AVD creation, app build/install and fixture setup.

### Mobile capture build

The current x86_64 debug APK built successfully. The default build failed at `react-native-webrtc:bundleDebugAar` because AGP rejects a library's direct local-AAR dependency. `android-capture.gradle` exposes the same checked-in AAR through a flat-directory module repository for this capture build only; production build files remain unchanged. From `mobile/android`, reproduce with `./gradlew assembleDebug -PreactNativeArchitectures=x86_64 --init-script ../../design/penpot/android-capture.gradle`. `mobile-build.json` records the APK hash and source commit. Rendering is not yet verified.

### Native mobile capture available

The dedicated `AllChatDesignCatalog` Pixel 7 / Android 35 emulator now boots under Windows WHPX. It uses port 5556 and a separate Windows ADB server on 5038 to avoid the WSL ADB conflict. Every capture command explicitly targets `emulator-5556`; no personal device is selected. The current APK is installed and served by Metro on 8081. A disposable populated instance on 4187 supplies fixture data through ADB reverse forwarding.

`capture-mobile.py` verifies the AVD name, captures PNG and accessibility XML, and redacts password-node text. Native onboarding and signed-in home captures now exist in `mobile-reference/`. Runtime processes must be checked before reuse; do not infer liveness from this document.
