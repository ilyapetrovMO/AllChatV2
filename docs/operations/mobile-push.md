# Mobile push notifications

AllChat instances send encrypted notification envelopes through a stateless push relay. New bootstrap installations default to `https://ru.elitedarklord.com`; owners can change or disable the relay under **Community Settings → General → Mobile push relay**.

The project-operated relay runs in public shared mode, so independently bootstrapped Instances can use that default without registration or manual key approval. Provider device tokens are unguessable capabilities, and the relay bounds abuse with in-memory limits per source IP and hashed device token. A privately bootstrapped relay remains signature-protected and authorizes only its local Instance.

For hostname and DuckDNS installations, bootstrap can instead deploy a private Android relay on the same VPS. Select **Deploy a private Android push relay on this VPS** and choose the Firebase service-account JSON belonging to the Firebase project compiled into your APK. Bootstrap installs Caddy and exposes the relay at the Community origin's `/api/v1/push` path, so no additional hostname or DNS record is required. Direct-IP installations cannot use this mode because Caddy cannot guarantee a publicly trusted IP certificate.

The relay never receives message text in plaintext. Each Android installation creates a non-exportable RSA key in Android Keystore. The instance encrypts every notification with a fresh AES-256-GCM key and wraps that key for the device with RSA-OAEP-SHA256 using Android Keystore's interoperable empty-label and MGF1-SHA1 parameters. Subscriptions are bound to active login sessions and are ignored after logout, expiry, or revocation.

## Official Android release configuration

The release workflow reads these GitHub Actions secrets:

- `ALLCHAT_FIREBASE_API_KEY`
- `ALLCHAT_FIREBASE_APP_ID`
- `ALLCHAT_FIREBASE_PROJECT_ID`
- `ALLCHAT_FIREBASE_SENDER_ID`

The APK still builds when they are absent, but Firebase background push registration is disabled. The relay operator separately configures the matching Firebase service account through `GOOGLE_APPLICATION_CREDENTIALS`. Apple credentials are optional until iOS push delivery is enabled.

Private-relay deployments keep the Firebase service account readable only by a dedicated `allchat-push` system user. The relay listens on `127.0.0.1:8090`; Caddy is the only public HTTP entry point. AllChat listens on `127.0.0.1:8080`, while its embedded TURN/TLS listener receives an atomically synchronized copy of Caddy's certificate. A systemd timer checks hourly for certificate renewal and restarts AllChat only when the certificate pair changes.

Bootstrap refuses to modify a Caddy installation it did not create. Re-running bootstrap without selecting private relay preserves an existing private-relay deployment rather than silently uninstalling it.

## Authorizing an instance

Each instance creates its own Ed25519 signing identity. Its key ID and public key are shown under **Community Settings → General → Relay authorization identity**. The relay operator adds that pair to `ALLCHAT_RELAY_PUBLIC_KEYS` as `key-id=base64-public-key` and reloads the relay.

This allowlist prevents arbitrary servers from using the hosted relay for spam. Changing the relay URL does not transmit the private signing key; that key remains in the instance data directory as `mobile-push-signing.json` with owner-only permissions.
