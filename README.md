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

AllChat retains at least 256 MiB of free filesystem space before accepting new Attachment or soundboard uploads. `ALLCHAT_STORAGE_RESERVE_BYTES` may increase this margin up to 10 GiB but cannot reduce or disable the built-in reserve.

### Development traffic bot

With the development Instance running, a second terminal can start a synthetic Member with a generated avatar that posts random Messages, occasionally attaches a generated PNG, cycles between Online and Do Not Disturb, and periodically changes its Display Name:

```sh
ALLCHAT_BOT_PASSWORD='a development-only password' \
ALLCHAT_BOT_INVITE='an unused Invitation token' \
make dev-bot
```

The Invitation is only needed the first time; afterward the bot signs into the existing `allchat-bot` Member with the configured password. At least one visible Text Channel must exist. Never point this development tool at an Instance unless synthetic activity is intended.

Configuration is available through `ALLCHAT_BOT_URL` (default `http://127.0.0.1:8080`), `ALLCHAT_BOT_USERNAME` (default `allchat-bot`), `ALLCHAT_BOT_PASSWORD`, `ALLCHAT_BOT_INVITE`, and `ALLCHAT_BOT_INTERVAL` (default `10s`). Each interval has a 10% scheduled public-message chance by default; new channel Messages receive a 3% reply chance, DMs a 35% reply chance, and public “go into voice” requests a 2% join chance. Configure these with `ALLCHAT_BOT_PUBLIC_MESSAGE_CHANCE`, `ALLCHAT_BOT_CHANNEL_REPLY_CHANCE`, `ALLCHAT_BOT_DM_REPLY_CHANCE`, and `ALLCHAT_BOT_VOICE_REQUEST_CHANCE`, or their corresponding command flags. Values range from `0` to `100`. Stop the bot with Ctrl-C.

To test voice locally, start a development echo Member in the first visible Voice Channel:

```sh
ALLCHAT_VOICE_BOT_PASSWORD='a development-only password' \
ALLCHAT_VOICE_BOT_INVITE='an unused Invitation token' \
make dev-voice-bot
```

After its first registration, the Invitation is no longer required. Speak in that Voice Channel to hear the bot return the active speaker's Opus audio. The echo bot also shares its embedded SMPTE test image by default. Configuration uses `ALLCHAT_VOICE_BOT_URL` (falling back to `ALLCHAT_BOT_URL`), `ALLCHAT_VOICE_BOT_USERNAME` (default `allchat-echo-bot`), `ALLCHAT_VOICE_BOT_PASSWORD`, and `ALLCHAT_VOICE_BOT_INVITE`. The generic bot password and Invitation variables are accepted as fallbacks. Set `ALLCHAT_VOICE_BOT_SCREEN=0` for an audio-only bot.

`make dev-echo-bot` is the explicit alias for the same echo-and-screen behavior. The image is encoded into the bot binary; FFmpeg or an external media file is not required at runtime.

If the Owner credentials are lost, stop the Instance and pipe a replacement password to the offline recovery command:

```sh
printf '%s\n' 'a new long password' | go run ./cmd/allchat recover-owner --data-dir .dev/data --username owner
```

Only one AllChat process may own a data directory at a time. Stop the process with `SIGINT` or `SIGTERM` to close HTTP and SQLite cleanly.

### Backup, restore, and upgrades

Create a coherent backup while the Instance is running:

```sh
allchat backup --data-dir /var/lib/allchat --output /srv/backups/allchat-$(date +%F).tar.gz
```

The archive contains a point-in-time SQLite snapshot and every Attachment and soundboard file referenced by that snapshot. Messages or uploads committed after the database snapshot are intentionally left for the next backup. If a referenced file is missing, backup fails instead of producing an incomplete archive.

Restore into a new or empty directory while the destination Instance is stopped:

```sh
allchat restore --input /srv/backups/allchat-2026-08-10.tar.gz --data-dir /var/lib/allchat-restored
```

Restore validates archive paths, checksums, SQLite integrity, and the schema version before installing any files. It never overwrites a nonempty directory. Start the restored directory normally after validation.

Schema migrations are forward-only and transactional. Before startup applies a pending migration, it writes a dated archive under `DATA_DIR/backups/`; startup stops if either that backup or the migration fails. To downgrade the binary, do not attempt to reverse the database schema: stop AllChat and restore the matching pre-upgrade archive into a new directory with the older binary.

Members can download a portable JSON export from `GET /api/v1/account/export`. It contains their profile, authored Messages in currently visible Channels, their complete Direct Message conversations, and metadata plus authenticated download URLs for retained Attachments. It does not expose hidden Channels or unrelated Member profiles.

`POST /api/v1/account/delete` requires the current password, CSRF protection, and the exact confirmation `DELETE MY ACCOUNT`. Deletion revokes every Session and irreversibly replaces credentials and profile identity while preserving shared Message and Direct Message continuity. The Community Owner must transfer ownership before deleting their Account.

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

The Community Owner can inspect content-free operational health at `GET /api/v1/admin/diagnostics`. It reports SQLite and migration state, free storage, listener/TLS mode, configured SFU and Relay bounds, and pre-migration backup recency without exposing Member, Message, Session, or credential values. Pass `--metrics` to opt into the unauthenticated `/metrics` Prometheus endpoint; it is disabled by default and emits only Instance-level unlabeled gauges.

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

The embedded client targets the current and previous major desktop releases of Chromium and Firefox plus current Safari. Mobile text messaging is supported responsively; microphone calls depend on browser media permissions, and mobile screen sharing is best-effort because browsers may not expose `getDisplayMedia`. The UI honors reduced-motion preferences, provides visible keyboard focus, and renders stored UTC instants through the browser's local timezone. English strings are routed through a client text catalog seam for later localization.

## License

AllChat is licensed under the [GNU Affero General Public License, version 3 or later](LICENSE).
