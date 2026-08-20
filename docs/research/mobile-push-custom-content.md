# Rich mobile push notifications

Research date: 2026-08-20

## Recommendation

Yes: AllChat can show the caller or sender's name and avatar in native notifications, including when the app is backgrounded or its UI process has been terminated. The reliable implementation belongs in the native notification receiver, not React Native.

For Android:

- Render incoming calls with `NotificationCompat.CallStyle.forIncomingCall`. Give its `Person` the caller name, stable Member ID, and a cached avatar through `IconCompat`; the style supplies the system Answer and Decline affordances. Android 12 introduced the native call template, while AndroidX provides compatibility behavior for older releases. `CallStyle` deliberately ignores a notification's generic `largeIcon`, so the avatar must be the calling `Person`'s icon. [Android call-notification guide](https://developer.android.com/develop/ui/compose/notifications/call-style), [platform `CallStyle` reference](https://developer.android.com/reference/android/app/Notification.CallStyle), [AndroidX `Person.Builder`](https://developer.android.com/reference/androidx/core/app/Person.Builder)
- Render messages with `NotificationCompat.MessagingStyle`, with a `Person` for the sender. This is the platform mechanism for optimal sender-name and avatar rendering. Associate it with a long-lived conversation shortcut to enter Android's Conversations section and retain per-conversation controls; the platform recommends high-quality 104 dp avatars. [Android `MessagingStyle` reference](https://developer.android.com/reference/android/app/Notification.MessagingStyle), [People and conversations](https://developer.android.com/develop/ui/views/notifications/conversations)
- Use the ordinary small AllChat monochrome icon as the app identity. A generic `setLargeIcon` can show a bitmap on ordinary notifications, but `Person` is the correct identity model for messages and calls. [AndroidX `NotificationCompat.Builder`](https://developer.android.com/reference/androidx/core/app/NotificationCompat.Builder.html), [AndroidX `Person.Builder`](https://developer.android.com/reference/androidx/core/app/Person.Builder)

Do not put avatar bytes in FCM. Add identity metadata to AllChat's existing encrypted envelope, use a native disk cache first, and update the posted notification after a bounded authenticated fetch only when the image is missing or stale. FCM data and notification messages are limited to 4096 bytes, and AllChat's encrypted envelope plus RSA/AES metadata already consumes part of that budget. [FCM message types](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type)

## What AllChat does today

The current path is well suited to rich private notifications:

1. The Instance builds title/body data in `internal/instance/mobile_push.go`, encrypts it separately for each device, and sends only the encrypted envelope through the relay.
2. The relay sends Android a high-priority **data** message containing that opaque envelope (`internal/pushrelay/providers.go`).
3. `AllChatFirebaseMessagingService` decrypts it with the device's Android Keystore key and posts a native notification. This service can run without the React Native renderer and currently handles foreground, background, and terminated-process delivery through the same code path.
4. Notifications currently use title/text/category only. There is no sender ID/avatar version in the encrypted payload, no native avatar cache, no `Person`, `MessagingStyle`, `CallStyle`, Answer/Decline `PendingIntent`, or direct reply action.

This should remain a data-message pipeline. FCM notification messages are displayed automatically while an Android app is backgrounded, bypassing `onMessageReceived`; data messages are delivered to that callback instead. A data-only design is therefore what lets AllChat decrypt and render the same custom notification in all app states. [Receive messages in Android apps](https://firebase.google.com/docs/cloud-messaging/android/receive-messages), [FCM message types](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type)

## Proposed encrypted payload

Version the decrypted payload rather than adding cleartext provider metadata:

```json
{
  "version": 2,
  "kind": "call",
  "instance_url": "https://chat.example",
  "conversation_id": "…",
  "call_id": "…",
  "author_id": "…",
  "author": "Alice",
  "avatar_version": "sha256-or-updated-at",
  "title": "Incoming call",
  "body": "Alice is calling",
  "sound": true
}
```

The device should derive the avatar endpoint from the validated Instance URL and Member ID rather than accept an arbitrary download URL. `avatar_version` makes invalidation deterministic without exposing image contents. Calls and Direct Messages already have the necessary author/Member ID in server state; `author_id` is presently available to the Instance but omitted from the encrypted map.

Keep a fallback that uses the sender's initial and brand color. A notification must be posted promptly even if the avatar is uncached, the Instance is offline, authentication expired, or decoding fails.

## Avatar retrieval and caching

The strongest design is:

1. Maintain a small native cache keyed by `(normalized Instance URL, Member ID, avatar version)`. Populate it while the app is open and reuse it from `FirebaseMessagingService` after process death.
2. On push, synchronously decode only a size-limited cached bitmap. Build the `Person` and post immediately.
3. If it is absent, post with an initial, then enqueue an expedited `WorkManager` job for this user-visible, high-priority event. Fetch the authenticated `/api/v1/members/{id}/avatar`, enforce HTTPS and image/content/decoded-dimension limits, atomically cache it, and repost the same notification ID with the avatar.
4. Purge an Instance's avatar cache and any native credential needed for fetch on logout/account removal. Use an LRU byte limit and expire obsolete avatar versions.

Firebase says `onMessageReceived` has only several seconds of valid processing time, advises posting immediately, and directs image/network work to `WorkManager` (expedited after high-priority FCM) or a foreground service. Network fetches directly inside the callback can produce delayed or missing notifications. [FCM Android priority and processing](https://firebase.google.com/docs/cloud-messaging/android-message-priority), [Receive messages in Android apps](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)

AllChat's avatar endpoint is authenticated. Consequently, a cold-cache fetch needs a native, hardware-backed account credential accessible without starting React Native, or a narrowly scoped avatar-fetch capability. Making avatar URLs public or embedding a bearer session token in the push payload would weaken the existing privacy model and should not be done. Prewarming the native cache during normal synchronization gives useful avatars without making notification delivery depend on background authentication.

## Android presentation and actions

### Incoming calls

Build a `Person` from `author`, `author_id`, and the cached icon, then use `NotificationCompat.CallStyle.forIncomingCall(person, declineIntent, answerIntent)`. Answer and Decline should be immutable, explicit `PendingIntent`s targeting an unexported receiver/service. The receiver must make the Instance call action idempotently, update/cancel the notification, and open the call UI only when appropriate. `PendingIntent` actions remain usable when the originating app process is not running. [Android call-notification guide](https://developer.android.com/develop/ui/compose/notifications/call-style)

Keep the high-importance calls channel and ringtone. For maximum ranking on Android 11 and earlier, Android documents associating compat call notifications with a foreground service; current Android also recommends coupling ongoing incoming-call notifications to a foreground service. Longer term, integration with Android Telecom (`ConnectionService`, `MANAGE_OWN_CALLS`, registered phone account) offers the most native system-call behavior, but it is materially more work than adopting `CallStyle`. [Android call-notification guide](https://developer.android.com/develop/ui/compose/notifications/call-style), [time-sensitive notifications](https://developer.android.com/develop/ui/views/notifications/time-sensitive)

Full-screen intents are tightly scoped to alarms and calls; while the device is in use Android may show a heads-up notification instead. Calls should continue to work from the shade rather than rely on forced full-screen presentation. [Create a notification](https://developer.android.com/develop/ui/views/notifications/create-notification), [time-sensitive notifications](https://developer.android.com/develop/ui/views/notifications/time-sensitive)

### Messages

Use one stable notification ID and shortcut ID per conversation. A `MessagingStyle` notification can accumulate recent sender/message entries and can represent group conversations. A `Person` icon supplies the sender avatar; a conversation shortcut gives Android the conversation identity, opens the exact AllChat conversation, and enables the Conversations section and its user controls. [Android `MessagingStyle` reference](https://developer.android.com/reference/android/app/Notification.MessagingStyle), [People and conversations](https://developer.android.com/develop/ui/views/notifications/conversations)

Optional message actions:

- **Reply** uses `RemoteInput` delivered to an explicit receiver. It requires a native authenticated send queue that can safely retry and reconcile with the app; do not add a cosmetic action before that lifecycle exists.
- **Mark read** can call a narrow idempotent endpoint from a receiver/job.
- Android supports up to three notification action buttons and recommends that they not duplicate the notification tap. [Create a notification](https://developer.android.com/develop/ui/views/notifications/create-notification)

## State matrix

| State | Android behavior with the proposed design |
|---|---|
| Foreground | The native FCM service still receives the data message. Calls should always post `CallStyle`; message display may follow the existing foreground-suppression policy if the exact conversation is visible. |
| Background | Native service decrypts and posts immediately; cached avatars work synchronously, and an expedited job may enrich a cache miss. |
| UI process terminated | FCM may start the declared service for a data message. Keystore decryption and the native disk cache remain available; no React Native runtime is required. |
| Force-stopped by user | Android does not provide an app guarantee here; a force-stopped package cannot be treated as ordinary process termination. |
| Notifications denied/channel muted | App code cannot override user choice. Android 13+ requires `POST_NOTIFICATIONS` for ordinary notifications, and channel sound/importance remain user controlled. [Notification runtime permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission) |

FCM high priority is appropriate because calls and chat alerts are time-sensitive and user-visible. Google warns that high-priority messages which repeatedly fail to produce visible notifications can be deprioritized or delegated, so suppressed/non-user-visible maintenance pushes should not use the same priority. [FCM Android priority](https://firebase.google.com/docs/cloud-messaging/android-message-priority)

## iOS direction

Messages and calls require different Apple mechanisms.

### Messages

Use an alert push with `mutable-content: 1` and a Notification Service Extension. In the extension, decrypt AllChat's envelope, create/donate an `INSendMessageIntent`, and supply an `INPerson` for the sender. Apple Communication Notifications use the `INPerson.image` as the sender avatar; group conversations can attach an image to the speakable group name. This requires enabling the Communication Notifications capability and declaring the `INSendMessageIntent` interaction. [Apple: Implementing communication notifications](https://developer.apple.com/documentation/usernotifications/implementing-communication-notifications), [Apple communication-notification sample](https://developer.apple.com/documentation/usernotifications/handling-communication-notifications-and-focus-status-updates)

For a generic rich-image fallback, the service extension can download a size-limited image, write it to its temporary container, and add a `UNNotificationAttachment`. Apple gives the extension a limited execution window and delivers the original notification if the extension fails to finish; FCM's supported image path similarly requires `mutable-content` and an image URL with a valid file extension. A sender avatar should prefer the communication `INPerson` path because an attachment is presentation media, not semantic sender identity. [Apple: Modifying delivered notification content](https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications), [Apple `UNNotificationAttachment`](https://developer.apple.com/documentation/usernotifications/unnotificationattachment), [FCM notification image options](https://firebase.google.com/docs/cloud-messaging/customize-messages/cross-platform#notification-message-with-a-custom-image)

When AllChat is foregrounded, implement `UNUserNotificationCenterDelegate.willPresent` and explicitly request banner/list/sound presentation when desired; otherwise foreground notification presentation differs from background system delivery. [Receive FCM messages on Apple platforms](https://firebase.google.com/docs/cloud-messaging/ios/receive-messages)

### Incoming calls

Use the relay's existing APNs VoIP path with PushKit and report each incoming VoIP push promptly to CallKit through `CXProvider.reportNewIncomingCall`. PushKit can wake or launch the app for a VoIP call. Apple requires iOS 13+ apps to report incoming VoIP pushes to CallKit; repeated failures can cause the system to stop launching the app for them. [Apple: Responding to VoIP notifications](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit), [Apple `PKPushType.voIP`](https://developer.apple.com/documentation/pushkit/pkpushtype/voip), [Apple: Making and receiving VoIP calls](https://developer.apple.com/documentation/callkit/making-and-receiving-voip-calls)

CallKit accepts an app-provided caller name, handle, and video flag through `CXCallUpdate`, but exposes no arbitrary per-caller avatar property. `CXProviderConfiguration.iconTemplateImageData` is AllChat's provider/app icon, not the caller's image. The system may associate a Contacts image with a recognized handle, but AllChat cannot rely on that for Community avatars. Therefore the native incoming-call UI can reliably show the caller name, while AllChat should show the Community avatar in its own call screen after answer. [Apple `CXCallUpdate`](https://developer.apple.com/documentation/callkit/cxcallupdate), [Apple provider icon configuration](https://developer.apple.com/documentation/callkit/cxproviderconfiguration/icontemplateimagedata)

When the remote party ends a call, signal over the call's established network connection and report the CallKit transaction as remotely ended; Apple's PushKit guidance says not to send another push merely to terminate the displayed call. [Apple: Responding to VoIP notifications](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit)

### Apple actions and reliability

Register message categories and `UNNotificationAction`s for Reply (`UNTextInputNotificationAction`) and Mark Read; iOS can launch the app in the background to handle a selected action, and banners display at most the first two actions. Let CallKit own Answer/Decline for calls instead of duplicating them as ordinary notification actions. [Apple: Declaring actionable notification types](https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types), [Receive FCM messages on Apple platforms](https://firebase.google.com/docs/cloud-messaging/ios/receive-messages)

Do not use silent/background pushes as the primary alert mechanism for messages or calls. Apple describes background update notifications as low priority, throttled, and not guaranteed; ordinary messages need an alert payload/NSE, and calls need PushKit/CallKit. [Apple: Pushing background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)

APNs permits 4 KB for ordinary remote-notification payloads and 5 KB for VoIP payloads. Apple advises against putting sensitive data directly in the payload, which matches AllChat's encrypted-envelope design. Decrypt inside the app/service extension, keep avatar access authenticated and short-lived, and use category hidden-preview configuration for locked devices. [Apple: Generating a remote notification](https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification), [Apple hidden-preview placeholder](https://developer.apple.com/documentation/usernotifications/unnotificationcategory/hiddenpreviewsbodyplaceholder)

## Privacy and security requirements

- Keep name, message preview, Member ID, call ID, avatar version, and any avatar locator inside the existing per-device encrypted envelope. The relay should continue to learn only delivery metadata and the currently clear `kind`.
- Default to private lock-screen visibility and provide a redacted public version such as “New AllChat message” / “Incoming AllChat call.” Android lets the user ultimately control lock-screen and channel visibility. [Create a notification](https://developer.android.com/develop/ui/views/notifications/create-notification)
- Treat avatar bytes as private Community data: authenticated download only, TLS validation, no third-party URL, strict MIME/byte/dimension limits, safe bitmap decoding, and per-account cache deletion.
- Keep `PendingIntent`s explicit, immutable unless mutability is strictly required by `RemoteInput`, scoped to unique call/conversation IDs, and handled by non-exported components. A notification action grants the holder authority to perform the represented operation even if the app is not running. [Android call-notification guide](https://developer.android.com/develop/ui/compose/notifications/call-style)
- Never log decrypted titles, message previews, avatar URLs, session tokens, FCM tokens, or image bytes. Continue logging only opaque request IDs and fingerprints.

## Suggested delivery order

1. Extend encrypted payload v2 with `author_id` and `avatar_version`; retain v1 parsing.
2. Add a bounded native avatar cache and prewarm it from authenticated mobile synchronization.
3. Switch calls to `Person` + `CallStyle`, with native Answer and Decline receivers and tests across foreground/background/terminated states.
4. Switch messages to `Person` + `MessagingStyle`; add long-lived conversation shortcuts and notification history grouping.
5. Add authenticated WorkManager enrichment for cold cache misses.
6. Add direct Reply/Mark read only after a native credential/send-queue design is in place.
7. Implement the corresponding iOS presentation path when iOS push support becomes an active release target.
