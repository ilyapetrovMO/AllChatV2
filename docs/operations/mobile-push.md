# Mobile push notifications

AllChat instances send encrypted notification envelopes through a stateless push relay. New bootstrap installations default to `https://push.elitedarklord.com`; owners can change or disable the relay under **Community Settings → General → Mobile push relay**.

The relay never receives message text in plaintext. Each Android installation creates a non-exportable RSA key in Android Keystore. The instance encrypts every notification with a fresh AES-256-GCM key and wraps that key for the device with RSA-OAEP-SHA256. Subscriptions are bound to active login sessions and are ignored after logout, expiry, or revocation.

## Official Android release configuration

The release workflow reads these GitHub Actions secrets:

- `ALLCHAT_FIREBASE_API_KEY`
- `ALLCHAT_FIREBASE_APP_ID`
- `ALLCHAT_FIREBASE_PROJECT_ID`
- `ALLCHAT_FIREBASE_SENDER_ID`

The APK still builds when they are absent, but Firebase background push registration is disabled. The relay operator separately configures the matching Firebase service account through `ALLCHAT_FCM_CREDENTIALS_FILE`.

## Authorizing an instance

Each instance creates its own Ed25519 signing identity. Its key ID and public key are shown under **Community Settings → General → Relay authorization identity**. The relay operator adds that pair to `ALLCHAT_RELAY_PUBLIC_KEYS` as `key-id=base64-public-key` and reloads the relay.

This allowlist prevents arbitrary servers from using the hosted relay for spam. Changing the relay URL does not transmit the private signing key; that key remains in the instance data directory as `mobile-push-signing.json` with owner-only permissions.
