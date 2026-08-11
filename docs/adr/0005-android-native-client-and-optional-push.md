# Use React Native for Android and keep push optional

AllChat will keep its Android Member client in this repository as a standalone bare React Native project, using TypeScript for shared application behavior and Kotlin adapters where Android lifecycle or platform integration is authoritative. This keeps the client and its versioned Instance contracts together without introducing a monorepo framework, while retaining direct access to Android Telecom, foreground media, secure storage, notifications, and screen capture.

Native clients will use revocable bearer-backed Sessions. Cookie-authenticated web requests retain CSRF protection; bearer-authenticated requests do not use CSRF because their credentials are supplied explicitly in the authorization header. The same authorization seam will authenticate HTTP, realtime WebSocket, and media WebSocket requests.

Background push will use an optional capability-based relay operated by the project or another compatible operator. An Instance encrypts notification content for each registered device before delivery, so a relay observes routing metadata but not Member or Message content. Foreground realtime operation and every core Instance feature continue to work without the relay, preserving the self-contained Instance decision in ADR-0001.

The mobile Media Session controller owns local microphone lifetime and fails closed. Backend participation may be reconciled after reconnect, but backend state alone can never activate or retain local capture.
