package bootstrap

import (
	"context"
	"fmt"
	"io"
	"strings"
)

const remoteStage = "/tmp/allchat-bootstrap.binary"
const remoteRelayStage = "/tmp/allchat-bootstrap.relay"
const remoteFirebaseStage = "/tmp/allchat-bootstrap.firebase.json"

type Remote interface {
	Run(ctx context.Context, command string, input io.Reader) (string, error)
	Upload(ctx context.Context, destination string, source io.Reader, mode uint32) error
}

type Progress func(string)

type Installer struct{ Log Progress }

func InspectPlatform(ctx context.Context, remote Remote) (Platform, error) {
	info, err := remote.Run(ctx, "cat /etc/os-release; printf '\\n---ALLCHAT-ARCH---\\n'; uname -m", nil)
	if err != nil {
		return Platform{}, fmt.Errorf("inspect remote host: %w", err)
	}
	parts := strings.SplitN(info, "---ALLCHAT-ARCH---", 2)
	if len(parts) != 2 {
		return Platform{}, fmt.Errorf("remote host returned incomplete platform information")
	}
	return ParsePlatform(parts[0], parts[1])
}

func (i Installer) Install(ctx context.Context, remote Remote, binary io.Reader, cfg Config) (string, error) {
	return i.InstallBundle(ctx, remote, binary, nil, cfg)
}

func (i Installer) InstallBundle(ctx context.Context, remote Remote, binary, relayBinary io.Reader, cfg Config) (string, error) {
	if err := cfg.Validate(); err != nil {
		return "", err
	}
	log := i.Log
	if log == nil {
		log = func(string) {}
	}
	log("Inspecting remote host")
	platform, err := InspectPlatform(ctx, remote)
	if err != nil {
		return "", err
	}
	if !cfg.DeployRelay {
		managed, _ := remote.Run(ctx, "if [ -f /etc/allchat/caddy-bootstrap-managed ]; then printf managed; fi", nil)
		if strings.TrimSpace(managed) == "managed" {
			cfg.PreserveRelay = true
			cfg.PushRelayURL = cfg.BaseURL()
			log("Preserving the existing bootstrap-managed private push relay")
		}
	}
	log("Uploading verified " + platform.Architecture + " Instance binary")
	if err = remote.Upload(ctx, remoteStage, binary, 0700); err != nil {
		return "", fmt.Errorf("upload Instance binary: %w", err)
	}
	if cfg.DeployRelay {
		if relayBinary == nil {
			return "", fmt.Errorf("private relay binary is required")
		}
		log("Uploading verified push relay binary and Firebase credentials")
		if err = remote.Upload(ctx, remoteRelayStage, relayBinary, 0700); err != nil {
			return "", fmt.Errorf("upload push relay binary: %w", err)
		}
		if err = remote.Upload(ctx, remoteFirebaseStage, strings.NewReader(string(cfg.FirebaseJSON)), 0600); err != nil {
			return "", fmt.Errorf("upload Firebase credentials: %w", err)
		}
	}
	log("Installing or upgrading AllChat")
	if _, err = runPrivileged(ctx, remote, cfg, "/bin/sh -s", installScript(cfg)); err != nil {
		return "", fmt.Errorf("provision Instance: %w", err)
	}
	log("Waiting for public HTTPS health")
	healthCommand := "attempt=0; while [ $attempt -lt 36 ]; do curl -fsS " + shellQuote(cfg.BaseURL()+"/api/v1/health") + " >/dev/null && exit 0; attempt=$((attempt+1)); sleep 5; done; exit 1"
	if _, err = remote.Run(ctx, healthCommand, nil); err != nil {
		log("Health check failed; rolling back the upgrade if a previous version exists")
		_, rollbackErr := runPrivileged(ctx, remote, cfg, "/bin/sh -s", rollbackScript)
		if rollbackErr != nil {
			return "", fmt.Errorf("Instance did not become healthy at %s: %w; rollback also failed: %v", cfg.BaseURL(), err, rollbackErr)
		}
		return "", fmt.Errorf("Instance did not become healthy at %s: %w", cfg.BaseURL(), err)
	}
	_, _ = runPrivileged(ctx, remote, cfg, "rm -f /etc/allchat/bootstrap-rollback", "")
	log("Reading Community Owner setup link")
	setupCommand := "sudo -n"
	setupInput := io.Reader(nil)
	if cfg.SSHUser != "root" && cfg.SudoPassword != "" {
		setupCommand = "sudo -S -p ''"
		setupInput = strings.NewReader(cfg.SudoPassword + "\n")
	}
	output, err := remote.Run(ctx, setupCommand+" -u allchat /usr/local/bin/allchat setup-link --data-dir /var/lib/allchat --base-url "+shellQuote(cfg.BaseURL()), setupInput)
	if err != nil {
		return "", fmt.Errorf("read setup link: %w", err)
	}
	return strings.TrimSpace(output), nil
}

func runPrivileged(ctx context.Context, remote Remote, cfg Config, command, input string) (string, error) {
	prefix := "sudo -n "
	reader := input
	if cfg.SSHUser == "root" {
		prefix = ""
	} else if cfg.SudoPassword != "" {
		prefix = "sudo -S -p '' "
		reader = cfg.SudoPassword + "\n" + input
	}
	var source io.Reader
	if reader != "" {
		source = strings.NewReader(reader)
	}
	return remote.Run(ctx, prefix+command, source)
}

const rollbackScript = `set -eu
state=/etc/allchat/bootstrap-rollback
[ -f "$state" ] || exit 0
backup=$(cat "$state")
stamp_failed=$(date -u +%Y%m%dT%H%M%SZ)
systemctl stop allchat.service || true
if [ ! -f /etc/allchat/bootstrap-rollback-was-caddy ]; then
  systemctl stop allchat-push-relay.service allchat-caddy-certificate.timer caddy.service 2>/dev/null || true
  systemctl disable allchat-push-relay.service allchat-caddy-certificate.timer caddy.service 2>/dev/null || true
fi
mv /var/lib/allchat "/var/lib/allchat.failed-$stamp_failed"
install -d -o allchat -g allchat -m 0700 /var/lib/allchat
cp -p /usr/local/bin/allchat.previous /usr/local/bin/allchat
if [ -f /etc/allchat/pre-caddy/allchat.service ]; then
  cp -p /etc/allchat/pre-caddy/allchat.service /etc/systemd/system/allchat.service
  systemctl daemon-reload
fi
sudo -u allchat /usr/local/bin/allchat restore --data-dir /var/lib/allchat --input "$backup"
chown -R allchat:allchat /var/lib/allchat
systemctl restart allchat.service
rm -f "$state" /etc/allchat/bootstrap-rollback-was-caddy
`

func installScript(cfg Config) string {
	if cfg.DeployRelay || cfg.PreserveRelay {
		return installPrivateRelayScript(cfg)
	}
	identifier := cfg.ACMEIdentifier()
	sshRule := fmt.Sprintf("%d/tcp", cfg.SSHPort)
	acmeEmailOption := ""
	if cfg.ACMEEmail != "" {
		acmeEmailOption = " --acme-email " + cfg.ACMEEmail
	}
	pushRelayOption := ""
	if cfg.PushRelayURL != "" {
		pushRelayOption = " --push-relay " + cfg.PushRelayURL
	}
	duck := ""
	if cfg.TLSMode == TLSDuckDNS {
		duck = fmt.Sprintf(`install -d -m 0700 /etc/allchat
cat > /etc/allchat/duckdns.env <<'EOF'
DUCKDNS_SUBDOMAIN=%s
DUCKDNS_TOKEN=%s
EOF
chmod 0600 /etc/allchat/duckdns.env
cat > /usr/local/sbin/allchat-duckdns-update <<'EOF'
#!/bin/sh
set -eu
. /etc/allchat/duckdns.env
public_ip=$(curl -fsS https://api.ipify.org)
result=$(curl -fsS --get --data-urlencode "domains=$DUCKDNS_SUBDOMAIN" --data-urlencode "token=$DUCKDNS_TOKEN" --data-urlencode "ip=$public_ip" https://www.duckdns.org/update)
[ "$result" = "OK" ]
old_ip=$(cat /var/lib/allchat/public-ip 2>/dev/null || true)
if [ "$old_ip" != "$public_ip" ]; then
  printf 'ALLCHAT_PUBLIC_IP=%%s\n' "$public_ip" > /etc/allchat/public-ip.env
  printf '%%s\n' "$public_ip" > /var/lib/allchat/public-ip
  chown allchat:allchat /var/lib/allchat/public-ip
  systemctl try-restart allchat.service || true
fi
EOF
chmod 0700 /usr/local/sbin/allchat-duckdns-update
cat > /etc/systemd/system/allchat-duckdns.service <<'EOF'
[Unit]
Description=Update AllChat DuckDNS address
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/allchat-duckdns-update
EOF
cat > /etc/systemd/system/allchat-duckdns.timer <<'EOF'
[Unit]
Description=Periodically update AllChat DuckDNS address
[Timer]
OnBootSec=30s
OnUnitActiveSec=5min
RandomizedDelaySec=30s
[Install]
WantedBy=timers.target
EOF
`, cfg.DuckSubdomain, cfg.DuckToken)
	}
	return fmt.Sprintf(`set -eu
stage=%s
marker=/etc/allchat/bootstrap-managed
install -d -m 0755 /etc/allchat
if [ -e /usr/local/bin/allchat ] && [ ! -f "$marker" ]; then
  echo "existing Instance is not bootstrap-managed" >&2
  exit 20
fi
getent passwd allchat >/dev/null || useradd --system --home-dir /var/lib/allchat --create-home --shell /usr/sbin/nologin allchat
install -d -o allchat -g allchat -m 0700 /var/lib/allchat /srv/backups/allchat
printf 'ALLCHAT_PUBLIC_IP=%s\n' > /etc/allchat/public-ip.env
chmod 0600 /etc/allchat/public-ip.env
had_old=0
if [ -x /usr/local/bin/allchat ]; then
  had_old=1
  required_kb=$(( $(du -sk /var/lib/allchat | awk '{print $1}') * 2 + 262144 ))
  available_kb=$(df -Pk /var/lib/allchat | awk 'NR==2 {print $4}')
  if [ "$available_kb" -lt "$required_kb" ]; then
    echo "insufficient disk space for an upgrade backup and rollback copy" >&2
    exit 19
  fi
  stamp=$(date -u +%%Y%%m%%dT%%H%%M%%SZ)
  old=/usr/local/bin/allchat.previous
  cp -p /usr/local/bin/allchat "$old"
  systemctl stop allchat.service
  if ! sudo -u allchat "$old" backup --data-dir /var/lib/allchat --output "/srv/backups/allchat/pre-upgrade-$stamp.tar.gz"; then
    systemctl start allchat.service || true
    exit 18
  fi
  backup="/srv/backups/allchat/pre-upgrade-$stamp.tar.gz"
  printf '%%s\n' "$backup" > /etc/allchat/bootstrap-rollback
fi
install -o root -g root -m 0755 "$stage" /usr/local/bin/allchat
rm -f "$stage"
touch "$marker"
%s
chown -R allchat:allchat /var/lib/allchat
cat > /etc/systemd/system/allchat.service <<'EOF'
[Unit]
Description=AllChat Instance
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=allchat
Group=allchat
WorkingDirectory=/var/lib/allchat
EnvironmentFile=-/etc/allchat/public-ip.env
ExecStart=/usr/local/bin/allchat --data-dir /var/lib/allchat --acme %s%s --turn-public-ip ${ALLCHAT_PUBLIC_IP}%s
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/allchat /srv/backups/allchat
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
[Install]
WantedBy=multi-user.target
EOF
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ufw curl ca-certificates
%s
ufw allow %s comment 'SSH'
ufw allow 80/tcp comment 'AllChat ACME'
ufw allow 443/tcp comment 'AllChat HTTPS'
ufw allow 3478/tcp comment 'AllChat Relay TCP'
ufw allow 3478/udp comment 'AllChat Relay UDP'
ufw allow 5349/tcp comment 'AllChat Relay TLS'
ufw allow 49160:49259/udp comment 'AllChat Relay'
ufw allow 50000:50100/udp comment 'AllChat media'
ufw --force enable
systemctl daemon-reload
systemctl enable allchat.service
if ! systemctl restart allchat.service; then
  if [ "$had_old" = 1 ]; then
    stamp_failed=$(date -u +%%Y%%m%%dT%%H%%M%%SZ)
    mv /var/lib/allchat "/var/lib/allchat.failed-$stamp_failed"
    install -d -o allchat -g allchat -m 0700 /var/lib/allchat
    cp -p /usr/local/bin/allchat.previous /usr/local/bin/allchat
    sudo -u allchat /usr/local/bin/allchat restore --data-dir /var/lib/allchat --input "$backup"
    chown -R allchat:allchat /var/lib/allchat
    rm -f /etc/allchat/bootstrap-rollback
  fi
  systemctl restart allchat.service || true
  exit 21
fi
%s
`, shellQuote(remoteStage), cfg.PublicIP, duck, identifier, acmeEmailOption, pushRelayOption, func() string {
		if cfg.TLSMode == TLSDuckDNS {
			return "/usr/local/sbin/allchat-duckdns-update"
		}
		return ""
	}(), sshRule, func() string {
		if cfg.TLSMode == TLSDuckDNS {
			return "systemctl enable --now allchat-duckdns.timer"
		}
		return ""
	}())
}

func installPrivateRelayScript(cfg Config) string {
	identifier := cfg.ACMEIdentifier()
	sshRule := fmt.Sprintf("%d/tcp", cfg.SSHPort)
	duck := duckProvisionScript(cfg)
	duckEnable := ""
	if cfg.TLSMode == TLSDuckDNS {
		duckEnable = "systemctl enable --now allchat-duckdns.timer"
	}
	caddyEmail := ""
	if cfg.ACMEEmail != "" {
		caddyEmail = fmt.Sprintf("{\n  email %s\n}\n", cfg.ACMEEmail)
	}
	relayInstall := ""
	relayUnit := ""
	if cfg.DeployRelay {
		relayInstall = fmt.Sprintf("install -o root -g root -m 0755 %s /usr/local/bin/allchat-push-relay\ninstall -o allchat-push -g allchat-push -m 0400 %s /etc/allchat-push-relay/firebase-service-account.json\nrm -f %s %s", shellQuote(remoteRelayStage), shellQuote(remoteFirebaseStage), shellQuote(remoteRelayStage), shellQuote(remoteFirebaseStage))
		relayUnit = fmt.Sprintf(`cat > /etc/systemd/system/allchat-push-relay.service <<'EOF'
[Unit]
Description=AllChat Push Relay
After=network-online.target allchat.service
Wants=network-online.target
[Service]
Type=simple
User=allchat-push
Group=allchat-push
Environment=GOOGLE_APPLICATION_CREDENTIALS=/etc/allchat-push-relay/firebase-service-account.json
Environment=ALLCHAT_FIREBASE_PROJECT_ID=%s
EnvironmentFile=/etc/allchat-push-relay/instances.env
ExecStart=/usr/local/bin/allchat-push-relay -listen 127.0.0.1:8090 -workers 100 -queue-capacity 10000
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/etc/allchat-push-relay
[Install]
WantedBy=multi-user.target
EOF`, cfg.FirebaseProjectID)
	}
	return fmt.Sprintf(`set -eu
stage=%s
relay_stage=%s
firebase_stage=%s
trap 'rm -f "$relay_stage" "$firebase_stage"' EXIT
marker=/etc/allchat/bootstrap-managed
caddy_marker=/etc/allchat/caddy-bootstrap-managed
had_caddy=0
[ -f "$caddy_marker" ] && had_caddy=1
if command -v caddy >/dev/null 2>&1 && [ ! -f "$caddy_marker" ]; then
  echo "existing Caddy installation is not bootstrap-managed" >&2
  exit 22
fi
install -d -m 0755 /etc/allchat /etc/allchat/tls
if [ -e /usr/local/bin/allchat ] && [ ! -f "$marker" ]; then
  echo "existing Instance is not bootstrap-managed" >&2
  exit 20
fi
getent passwd allchat >/dev/null || useradd --system --home-dir /var/lib/allchat --create-home --shell /usr/sbin/nologin allchat
getent passwd allchat-push >/dev/null || useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin allchat-push
install -d -o allchat -g allchat -m 0700 /var/lib/allchat /srv/backups/allchat
install -d -o allchat-push -g allchat-push -m 0700 /etc/allchat-push-relay
printf 'ALLCHAT_PUBLIC_IP=%s\n' > /etc/allchat/public-ip.env
chmod 0600 /etc/allchat/public-ip.env
had_old=0
if [ -x /usr/local/bin/allchat ]; then
  had_old=1
  stamp=$(date -u +%%Y%%m%%dT%%H%%M%%SZ)
  cp -p /usr/local/bin/allchat /usr/local/bin/allchat.previous
  systemctl stop allchat.service || true
  sudo -u allchat /usr/local/bin/allchat.previous backup --data-dir /var/lib/allchat --output "/srv/backups/allchat/pre-upgrade-$stamp.tar.gz"
  printf '%%s\n' "/srv/backups/allchat/pre-upgrade-$stamp.tar.gz" > /etc/allchat/bootstrap-rollback
  [ "$had_caddy" = 1 ] && touch /etc/allchat/bootstrap-rollback-was-caddy
  install -d -m 0700 /etc/allchat/pre-caddy
  cp -a /etc/systemd/system/allchat.service /etc/allchat/pre-caddy/allchat.service 2>/dev/null || true
fi
install -o root -g root -m 0755 "$stage" /usr/local/bin/allchat
rm -f "$stage"
%s
touch "$marker" "$caddy_marker"
%s
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ufw curl ca-certificates caddy
cat > /etc/caddy/Caddyfile <<'EOF'
%s%s {
  @push {
    method POST
    path /api/v1/push
  }
  handle @push {
    reverse_proxy 127.0.0.1:8090
  }
  handle {
    reverse_proxy 127.0.0.1:8080
  }
}
EOF
cat > /etc/systemd/system/allchat.service <<'EOF'
[Unit]
Description=AllChat Instance
After=network-online.target caddy.service
Wants=network-online.target
Requires=caddy.service
[Service]
Type=simple
User=allchat
Group=allchat
WorkingDirectory=/var/lib/allchat
EnvironmentFile=-/etc/allchat/public-ip.env
ExecStart=/usr/local/bin/allchat --data-dir /var/lib/allchat --listen 127.0.0.1:8080 --external-url %s --tls-cert /etc/allchat/tls/certificate.pem --tls-key /etc/allchat/tls/certificate.key --turn-public-ip ${ALLCHAT_PUBLIC_IP} --push-relay %s
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/allchat /srv/backups/allchat
[Install]
WantedBy=multi-user.target
EOF
cat > /usr/local/sbin/allchat-sync-caddy-certificate <<'EOF'
#!/bin/sh
set +e
/usr/local/bin/allchat sync-caddy-certificate --identifier %s --cert /etc/allchat/tls/certificate.pem --key /etc/allchat/tls/certificate.key
status=$?
set -e
if [ "$status" = 10 ]; then
  chown root:allchat /etc/allchat/tls/certificate.pem /etc/allchat/tls/certificate.key
  chmod 0640 /etc/allchat/tls/certificate.pem /etc/allchat/tls/certificate.key
  systemctl try-restart allchat.service || true
  exit 0
fi
[ "$status" = 0 ]
EOF
chmod 0755 /usr/local/sbin/allchat-sync-caddy-certificate
cat > /etc/systemd/system/allchat-caddy-certificate.service <<'EOF'
[Unit]
Description=Synchronize Caddy certificate for AllChat TURN/TLS
After=caddy.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/allchat-sync-caddy-certificate
EOF
cat > /etc/systemd/system/allchat-caddy-certificate.timer <<'EOF'
[Unit]
Description=Refresh AllChat TURN/TLS certificate
[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
RandomizedDelaySec=5min
[Install]
WantedBy=timers.target
EOF
%s
ufw allow %s comment 'SSH'
ufw allow 80/tcp comment 'AllChat HTTPS redirect'
ufw allow 443/tcp comment 'AllChat HTTPS'
ufw allow 3478/tcp comment 'AllChat Relay TCP'
ufw allow 3478/udp comment 'AllChat Relay UDP'
ufw allow 5349/tcp comment 'AllChat Relay TLS'
ufw allow 49160:49259/udp comment 'AllChat Relay'
ufw allow 50000:50100/udp comment 'AllChat media'
ufw --force enable
systemctl daemon-reload
systemctl enable caddy.service allchat.service allchat-push-relay.service allchat-caddy-certificate.timer
systemctl restart caddy.service
attempt=0
while [ $attempt -lt 24 ]; do
  curl -ksS -o /dev/null %s || true
  set +e
  /usr/local/bin/allchat sync-caddy-certificate --identifier %s --cert /etc/allchat/tls/certificate.pem --key /etc/allchat/tls/certificate.key
  code=$?
  set -e
  if [ "$code" = 0 ] || [ "$code" = 10 ]; then break; fi
  attempt=$((attempt+1)); sleep 5
done
[ -s /etc/allchat/tls/certificate.pem ] && [ -s /etc/allchat/tls/certificate.key ]
chown root:allchat /etc/allchat/tls/certificate.pem /etc/allchat/tls/certificate.key
chmod 0640 /etc/allchat/tls/certificate.pem /etc/allchat/tls/certificate.key
systemctl restart allchat.service
identity=""
attempt=0
while [ $attempt -lt 20 ]; do
  identity=$(sudo -u allchat /usr/local/bin/allchat push-relay-identity --data-dir /var/lib/allchat 2>/dev/null || true)
  [ -n "$identity" ] && break
  attempt=$((attempt+1)); sleep 1
done
[ -n "$identity" ]
printf 'ALLCHAT_RELAY_PUBLIC_KEYS=%%s\n' "$identity" > /etc/allchat-push-relay/instances.env
chown allchat-push:allchat-push /etc/allchat-push-relay/instances.env
chmod 0400 /etc/allchat-push-relay/instances.env
systemctl restart allchat-push-relay.service
systemctl start allchat-caddy-certificate.timer
%s
rm -f /etc/allchat/bootstrap-rollback /etc/allchat/bootstrap-rollback-was-caddy
`, shellQuote(remoteStage), shellQuote(remoteRelayStage), shellQuote(remoteFirebaseStage), cfg.PublicIP,
		relayInstall, duck, caddyEmail, identifier, shellQuote(cfg.BaseURL()), shellQuote(cfg.BaseURL()), shellQuote(identifier), relayUnit, sshRule, shellQuote(cfg.BaseURL()), shellQuote(identifier), duckEnable)
}

func duckProvisionScript(cfg Config) string {
	if cfg.TLSMode != TLSDuckDNS {
		return ""
	}
	return fmt.Sprintf(`install -d -m 0700 /etc/allchat
cat > /etc/allchat/duckdns.env <<'EOF'
DUCKDNS_SUBDOMAIN=%s
DUCKDNS_TOKEN=%s
EOF
chmod 0600 /etc/allchat/duckdns.env
cat > /usr/local/sbin/allchat-duckdns-update <<'EOF'
#!/bin/sh
set -eu
. /etc/allchat/duckdns.env
public_ip=$(curl -fsS https://api.ipify.org)
result=$(curl -fsS --get --data-urlencode "domains=$DUCKDNS_SUBDOMAIN" --data-urlencode "token=$DUCKDNS_TOKEN" --data-urlencode "ip=$public_ip" https://www.duckdns.org/update)
[ "$result" = "OK" ]
old_ip=$(cat /var/lib/allchat/public-ip 2>/dev/null || true)
if [ "$old_ip" != "$public_ip" ]; then
  printf 'ALLCHAT_PUBLIC_IP=%%s\n' "$public_ip" > /etc/allchat/public-ip.env
  printf '%%s\n' "$public_ip" > /var/lib/allchat/public-ip
  chown allchat:allchat /var/lib/allchat/public-ip
  systemctl try-restart allchat.service || true
fi
EOF
chmod 0700 /usr/local/sbin/allchat-duckdns-update
cat > /etc/systemd/system/allchat-duckdns.service <<'EOF'
[Unit]
Description=Update AllChat DuckDNS address
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/allchat-duckdns-update
EOF
cat > /etc/systemd/system/allchat-duckdns.timer <<'EOF'
[Unit]
Description=Periodically update AllChat DuckDNS address
[Timer]
OnBootSec=30s
OnUnitActiveSec=5min
RandomizedDelaySec=30s
[Install]
WantedBy=timers.target
EOF
`, cfg.DuckSubdomain, cfg.DuckToken)
}

func shellQuote(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'" }
