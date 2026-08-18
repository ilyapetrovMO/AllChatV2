# Push relay

`allchat-push-relay` is the stateless gateway from AllChat instances to FCM and
APNs. It holds no device registry, message history, or replay cache. Accepted
jobs exist only in its bounded memory queue and are lost if the process exits.

## Provider credentials

Create one Firebase service account with permission to send Firebase Cloud
Messaging messages and configure:

```text
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-service-account.json
ALLCHAT_FIREBASE_PROJECT_ID=allchat-mobile
```

APNs is optional. To enable iOS notifications, create an APNs token
authentication key and configure all of these values together:

```text
ALLCHAT_APNS_KEY_FILE=/run/secrets/AuthKey_ABC123.p8
ALLCHAT_APNS_KEY_ID=ABC123
ALLCHAT_APNS_TEAM_ID=DEF456
ALLCHAT_APNS_TOPIC=org.allchat.mobile
ALLCHAT_APNS_VOIP_TOPIC=org.allchat.mobile.voip
ALLCHAT_APNS_PRODUCTION=true
```

The configured provider clients are each created once at startup. All delivery
workers share those clients and their long-lived HTTP/2 connection pools. With
APNs disabled, Android delivery continues normally and any iOS jobs are logged
as failed without exposing their token or payload.

## Authorize instances

Each trusted AllChat instance has an Ed25519 private key. The relay receives the
corresponding public keys as comma-separated, unpadded base64url values:

```text
ALLCHAT_RELAY_PUBLIC_KEYS=community-a=<base64url-raw-32-byte-public-key>
```

The value must encode the raw 32-byte public key, not a PEM document. Key IDs
must be unique. Removing a key and restarting the relay revokes that instance.

The signature covers this exact byte sequence:

```text
HTTP_METHOD\n
URL_PATH\n
UNIX_TIMESTAMP_SECONDS\n
LOWERCASE_HEX_SHA256_OF_EXACT_BODY
```

Requests carry `X-AllChat-Key-ID`, `X-AllChat-Timestamp`, and
`X-AllChat-Signature`. The signature is unpadded base64url. Timestamps outside a
five-minute window are rejected.

This time window limits stale requests, but a completely stateless service
cannot remember nonces and therefore cannot guarantee one-time replay
protection. TLS is mandatory. Private mode deliberately requires provisioned
Instance keys. Never distribute a shared private key in public server builds.

### Public shared mode

To operate a zero-configuration shared relay for every Instance using the same official mobile application/Firebase project, enable public mode:

```text
ALLCHAT_RELAY_PUBLIC=true
```

or pass `--public`. Public mode does not require `ALLCHAT_RELAY_PUBLIC_KEYS` and accepts unsigned Instance requests, like the Matrix Push Gateway API. Device provider tokens act as unguessable capabilities. The relay applies bounded in-memory token buckets globally, per source IP, and per SHA-256-hashed device token; raw tokens and payloads are never used as rate-limit keys in logs. Defaults are 500 requests/second globally with a burst of 1,000, 20 requests/second with a burst of 100 per source IP, and 1 request/second with a burst of 20 per device. Override them with the corresponding `--public-global-*`, `--public-ip-*`, and `--public-token-*` flags.

Public mode is intended for the project-operated shared relay. Bootstrap-deployed private relays remain in signed allowlist mode by default.

## Run

```sh
./allchat-push-relay -listen :8090 -workers 100 -queue-capacity 10000
```

The bootstrapper can automate an Android-only deployment for hostname and DuckDNS Communities. It binds the relay to `127.0.0.1:8090`, routes only `POST /api/v1/push` through Caddy, derives the Firebase project ID from the selected service-account JSON, and authorizes the local Instance automatically. The remaining Community routes are proxied to AllChat on `127.0.0.1:8080` under the same hostname and certificate.

Terminate with SIGINT or SIGTERM. The server first stops HTTP intake, waits for
active handlers, closes the job queue, and drains every accepted job before
exiting. Put the relay behind a TLS reverse proxy. `GET /healthz` reports queue
depth and aggregate counters without exposing tokens or payloads.

## Push API

`POST /api/v1/push` accepts:

```json
{
  "platform": "android",
  "kind": "message",
  "token": "provider-device-token",
  "payload": "opaque-encrypted-envelope",
  "collapse_id": "conversation-id"
}
```

`kind` defaults to `message`; `call` selects short-lived high-priority APNs
VoIP delivery. The encrypted payload is opaque to the relay. APNs and FCM must
ultimately receive their provider-issued routing token, so the `token` field is
opaque but usable by that provider. TLS protects it in transit, while private
mode additionally authenticates the Instance request; merely base64-encoding a token is not encryption. End-to-end token
encryption would require an additional relay decryption-key protocol.

The relay returns `202` after enqueueing, not after provider delivery. A full
queue returns `503` immediately so instances can retry with jitter. Malformed
and oversized requests never enter the queue; unsigned requests are accepted
only in explicitly enabled public mode. Delivery logs include
only a correlation ID, platform, notification kind, duration, a truncated
SHA-256 fingerprint of the high-entropy provider token, and a normalized
provider result. Instance logs use the same correlation ID and fingerprint, so
an accepted request can be followed through asynchronous provider delivery
without recording raw tokens, notification payloads, Messages, encryption
material, authentication headers, or Firebase credentials.
