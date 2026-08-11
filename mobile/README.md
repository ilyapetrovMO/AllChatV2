# AllChat Mobile

The Android-first AllChat Member client is a standalone bare React Native project inside the main repository. It uses the same release version as the Instance while keeping its own npm and Gradle configuration; no monorepo framework is required.

## Requirements

- Node.js 22.11 or newer
- JDK 17 or newer
- Android SDK 36
- An API 26 or newer emulator or device

Install dependencies from the repository root:

```sh
npm --prefix mobile ci
```

Start Metro in one terminal and the Android application in another:

```sh
npm --prefix mobile start
make android
```

Android emulators can reach a development Instance running on the host at `http://10.0.2.2:8080`. Cleartext HTTP is accepted only for loopback development addresses in development builds. Added production Instances must use HTTPS with a certificate trusted by Android.

Run the TypeScript tests and linter with:

```sh
make test-mobile
make lint-mobile
```

Build a Metro-dependent debug APK with `make build-mobile`. Build a self-contained, development-signed APK for direct sideloading with `make build-mobile-standalone`; its output is `mobile/android/app/build/outputs/apk/standalone/app-standalone.apk`. This local build contains only ARM64 native libraries, which substantially reduces transfer and Android package-install work on modern physical phones. With USB debugging enabled, `make install-mobile-standalone` builds and upgrades the installed app directly.

Use `make build-mobile-standalone-universal` only when you need one sideload APK that also supports ARM32 and x86/x86_64 emulators. The GitHub release workflow remains responsible for its own release artifacts. Release signing is intentionally not configured with the template debug key; CI will supply the release keystore through secrets.

## Current milestone

The initial foundation provides Instance URL validation, native Session login, encrypted Android Keystore persistence, multiple-Instance switching, and a typed HTTP client. Synchronization, the encrypted conversation cache, messaging, push, and media are tracked as subsequent tasks under `.scratch/android-mobile/`.
