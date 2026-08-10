# AllChat

AllChat is a self-hosted communication system for one online Community. The project is under active development; the current binary includes local accounts, Roles, Invitations, profiles, Categories, Text Channels, Voice Rooms, persistent rich Messages and Attachments, authorized full-text search, synchronized conversation state, and resumable realtime updates.

## Run the Instance

Go 1.25 or newer is required to build from source.

```sh
make dev
```

Open `http://127.0.0.1:8080/`. The versioned health endpoint is available at `http://127.0.0.1:8080/api/v1/health`.

On first launch, the console prints a one-time setup URL for creating the Community Owner. After setup, use **Manage channels** to create a Category and Text Channel, then select that Channel from the home page to start chatting. Invitations, Roles, and profile settings are also linked from the embedded web client.

Development data is stored under `.dev/data` by default. Override either setting when needed:

```sh
make dev DEV_DATA_DIR=/path/to/data DEV_LISTEN=0.0.0.0:8080
```

Attachment uploads default to 10 MiB per file and 1 GiB total. Operators may lower or raise these within the built-in hard ceilings using `ALLCHAT_MAX_ATTACHMENT_BYTES` and `ALLCHAT_MAX_ATTACHMENT_STORAGE_BYTES`.

### Development traffic bot

With the development Instance running, a second terminal can start a synthetic Member with a generated avatar that posts random Messages, occasionally attaches a generated PNG, cycles between Online and Do Not Disturb, and periodically changes its Display Name:

```sh
ALLCHAT_BOT_PASSWORD='a development-only password' \
ALLCHAT_BOT_INVITE='an unused Invitation token' \
make dev-bot
```

The Invitation is only needed the first time; afterward the bot signs into the existing `allchat-bot` Member with the configured password. At least one visible Text Channel must exist. Never point this development tool at an Instance unless synthetic activity is intended.

Configuration is available through `ALLCHAT_BOT_URL` (default `http://127.0.0.1:8080`), `ALLCHAT_BOT_USERNAME` (default `allchat-bot`), `ALLCHAT_BOT_PASSWORD`, `ALLCHAT_BOT_INVITE`, and `ALLCHAT_BOT_INTERVAL` (default `3s`). Stop it with Ctrl-C.

To test voice locally, start a development echo Member in the first visible Voice Channel:

```sh
ALLCHAT_VOICE_BOT_PASSWORD='a development-only password' \
ALLCHAT_VOICE_BOT_INVITE='an unused Invitation token' \
make dev-voice-bot
```

After its first registration, the Invitation is no longer required. Speak in that Voice Channel to hear the bot return the active speaker's Opus audio. Configuration uses `ALLCHAT_VOICE_BOT_URL` (falling back to `ALLCHAT_BOT_URL`), `ALLCHAT_VOICE_BOT_USERNAME` (default `allchat-echo-bot`), `ALLCHAT_VOICE_BOT_PASSWORD`, and `ALLCHAT_VOICE_BOT_INVITE`. The generic bot password and Invitation variables are accepted as fallbacks.

If the Owner credentials are lost, stop the Instance and pipe a replacement password to the offline recovery command:

```sh
printf '%s\n' 'a new long password' | go run ./cmd/allchat recover-owner --data-dir .dev/data --username owner
```

Only one AllChat process may own a data directory at a time. Stop the process with `SIGINT` or `SIGTERM` to close HTTP and SQLite cleanly.

## Public deployment and live media

Plain HTTP is intended only for local development or behind a trusted reverse proxy that terminates HTTPS. For direct HTTPS, provide an existing certificate and key:

```sh
allchat --data-dir /var/lib/allchat --listen :443 \
  --tls-cert /etc/allchat/fullchain.pem --tls-key /etc/allchat/privkey.pem
```

Alternatively, `--acme-host chat.example.com --acme-email admin@example.com` enables automatic ACME certificates. The hostname must resolve publicly to the Instance and TCP 443 must reach it for TLS-ALPN validation. Certificates are persisted under `DATA_DIR/acme-cache` and reused across restarts. When HTTPS is active, browser sessions use Secure cookies.

The SFU uses UDP `50000-50100` by default. Configure its bounded range, room capacity, and sender ceilings with `--media-min-port`, `--media-max-port`, `--media-max-participants`, `--media-audio-bitrate`, and `--media-screen-bitrate`, then allow that UDP range through the VPS firewall.

The embedded TURN relay requires the VPS public address because automatic address discovery would be unreliable behind cloud 1:1 NAT:

```sh
allchat --data-dir /var/lib/allchat --listen :443 \
  --tls-cert /etc/allchat/fullchain.pem --tls-key /etc/allchat/privkey.pem \
  --turn-public-ip 203.0.113.10 --turn-listen :3478 \
  --turn-relay-min-port 49160 --turn-relay-max-port 49259
```

Allow UDP and TCP 3478 plus the configured UDP relay range. With Instance TLS enabled, TURN/TLS also listens on TCP 5349. On a VPS behind 1:1 NAT, `--turn-public-ip` is the advertised public address while `--turn-listen` binds the local interface; the relay range must be forwarded without port translation. AllChat issues authenticated Members short-lived per-Member TURN REST credentials, limits concurrent allocations, and denies internal/special relay destinations.

To use an external TURN REST service instead of the embedded listener, omit `--turn-public-ip`, set `--external-turn-urls` to comma-separated `turn:`/`turns:` URLs, and provide its shared REST secret through `ALLCHAT_EXTERNAL_TURN_SECRET`. The secret must be at least 32 characters and is never returned to browsers.

## Test

```sh
make test
```

The acceptance suite builds and launches the real binary and requires permission to open temporary loopback ports.

The embedded interface also has development-only Chromium checks for desktop and mobile layouts:

```sh
npm install
npx playwright install chromium
make test-ui
```

Node and Playwright are test dependencies only; the AllChat binary continues to embed every runtime frontend asset.

## License

AllChat is licensed under the [GNU Affero General Public License, version 3 or later](LICENSE).
