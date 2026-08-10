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

The following example installs one Instance on a Linux VPS. Commands assume a checkout containing the desired release and a host with systemd. Replace every `example.com`, email address, and documentation IP with values belonging to the deployment.

### Build and install

Build a static application binary, create a dedicated unprivileged account, and prepare persistent storage:

```sh
go build -trimpath -ldflags='-s -w' -o allchat ./cmd/allchat
sudo install -o root -g root -m 0755 allchat /usr/local/bin/allchat
sudo useradd --system --home-dir /var/lib/allchat --create-home --shell /usr/sbin/nologin allchat
sudo install -d -o allchat -g allchat -m 0700 /var/lib/allchat
sudo install -d -o allchat -g allchat -m 0700 /srv/backups/allchat
```

The systemd unit below grants only the capability needed to bind ports 80 and 443, so the Instance itself remains unprivileged. For a different service manager, grant the equivalent bind capability or place AllChat behind a trusted reverse proxy.

### Automatic HTTPS

For a DNS name, create an A or AAAA record pointing at the VPS, then start AllChat with the name:

```sh
allchat --data-dir /var/lib/allchat \
  --acme chat.example.com --acme-email admin@example.com
```

For a VPS reached directly by a stable public IP, pass that IP instead:

```sh
allchat --data-dir /var/lib/allchat --acme 192.0.2.10
```

`--acme` defaults the application listener to `:443`. It obtains and renews certificates automatically, stores private ACME state under `DATA_DIR/acme-cache`, and uses Let's Encrypt's mandatory short-lived certificate profile for IP identifiers. TCP 80 must also reach the Instance for HTTP-01 validation. Browse to the same DNS name or IP supplied to `--acme`.

To use an existing certificate instead, omit `--acme` and provide the certificate and key:

```sh
allchat --data-dir /var/lib/allchat --listen :443 \
  --tls-cert /etc/allchat/fullchain.pem --tls-key /etc/allchat/privkey.pem
```

Plain HTTP is intended only for local development or behind a trusted reverse proxy that terminates HTTPS. When HTTPS is active, browser sessions use Secure cookies. The older `--acme-host` option remains supported for compatibility.

### Firewall and live media

For automatic HTTPS, the default SFU range, and the embedded Relay, configure UFW as follows:

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp comment 'AllChat ACME'
sudo ufw allow 443/tcp comment 'AllChat HTTPS'
sudo ufw allow 3478/tcp comment 'AllChat Relay TCP'
sudo ufw allow 3478/udp comment 'AllChat Relay UDP'
sudo ufw allow 5349/tcp comment 'AllChat Relay TLS'
sudo ufw allow 49160:49259/udp comment 'AllChat Relay allocation range'
sudo ufw allow 50000:50100/udp comment 'AllChat SFU media range'
sudo ufw enable
sudo ufw status numbered
```

Open port 80 only when AllChat manages ACME certificates. Port 5349 is used by the embedded Relay only when Instance TLS is active. If the VPS provider has a separate network firewall, apply the same rules there.

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

### systemd service

Create `/etc/systemd/system/allchat.service`. For a DNS deployment, use:

```ini
[Unit]
Description=AllChat Instance
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=allchat
Group=allchat
WorkingDirectory=/var/lib/allchat
ExecStart=/usr/local/bin/allchat --data-dir /var/lib/allchat --acme chat.example.com --acme-email admin@example.com --turn-public-ip 192.0.2.10
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/allchat
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

Replace the ACME identifier and Relay public IP. If using an external Relay, replace `--turn-public-ip` with the external TURN flags and supply `ALLCHAT_EXTERNAL_TURN_SECRET` through a root-readable systemd environment file. Avoid placing secrets directly in the unit.

Enable and inspect the Instance:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now allchat
sudo systemctl status allchat
sudo journalctl -u allchat -f
```

On first start, the journal contains a one-time setup URL. Open it promptly to create the Community Owner. Treat the bootstrap token in that URL as a secret.

Check the public health endpoint after setup:

```sh
curl --fail --show-error https://chat.example.com/api/v1/health
```

### Backups and upgrades

Schedule `allchat backup` to storage outside `/var/lib/allchat`, monitor backup failures, and periodically test restoration. Before upgrading, create an explicit backup, install the new binary, and restart:

```sh
sudo -u allchat /usr/local/bin/allchat backup \
  --data-dir /var/lib/allchat \
  --output /srv/backups/allchat/allchat-before-upgrade.tar.gz
sudo install -o root -g root -m 0755 allchat /usr/local/bin/allchat
sudo systemctl restart allchat
curl --fail --show-error https://chat.example.com/api/v1/health
```

Retain the previous binary and its matching pre-upgrade backup until the new Instance has been verified. Schema migrations are forward-only; rollback means restoring the matching backup into a new or empty data directory.

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
