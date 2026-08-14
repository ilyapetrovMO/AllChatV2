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
protection. TLS is mandatory. A dynamic, unlimited zero-config instance trust
model is also incompatible with abuse prevention: trusted instance keys must be
provisioned or certified by an authority. Never distribute a shared private key
in public server builds.

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
opaque but usable by that provider. TLS and request signing protect it in
transit; merely base64-encoding a token is not encryption. End-to-end token
encryption would require an additional relay decryption-key protocol.

The relay returns `202` after enqueueing, not after provider delivery. A full
queue returns `503` immediately so instances can retry with jitter. Malformed,
oversized, or unsigned requests never enter the queue. Delivery logs include
only platform, notification kind, and a normalized provider error category.
