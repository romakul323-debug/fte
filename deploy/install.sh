#!/usr/bin/env bash
# Установка «Волны» на свой сервер: мессенджер + HTTPS + сервер-посредник для звонков (TURN).
# Ubuntu 22.04/24.04 или Debian 12. Запуск от root одной командой:
#   curl -fsSL https://raw.githubusercontent.com/romakul323-debug/fte/volna/deploy/install.sh | bash
# Повторный запуск безопасен: обновит код и настройки, данные останутся.
set -euo pipefail

REPO=https://github.com/romakul323-debug/fte.git
BRANCH=volna
DIR=/opt/volna
PORT=3000

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "запусти от root (команда sudo -i, потом снова эту строку)"
export DEBIAN_FRONTEND=noninteractive

say "Определяю адрес сервера"
IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me || hostname -I | awk '{print $1}')
[ -n "$IP" ] || die "не удалось узнать внешний IP"
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"
echo "IP: $IP   адрес: https://$DOMAIN"

say "Ставлю системные пакеты"
apt-get update -y -q
apt-get install -y -q curl git ca-certificates coturn xz-utils openssl

say "Node.js"
need_node=1
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then need_node=0; fi
if [ "$need_node" = 1 ]; then
  case "$(uname -m)" in x86_64) NA=x64 ;; aarch64) NA=arm64 ;; *) die "неизвестная архитектура $(uname -m)" ;; esac
  NV=$(curl -fsS https://nodejs.org/dist/index.json | grep -o '"version":"v22[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$NV" ] || die "не удалось узнать версию Node.js"
  curl -fsSL "https://nodejs.org/dist/$NV/node-$NV-linux-$NA.tar.xz" | tar -xJ -C /usr/local --strip-components=1
fi
node -v

say "Caddy (бесплатный HTTPS-сертификат)"
if ! command -v caddy >/dev/null 2>&1; then
  case "$(uname -m)" in x86_64) CA=amd64 ;; aarch64) CA=arm64 ;; esac
  CV=$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest | grep -o '"tag_name": *"v[^"]*"' | grep -o 'v[0-9.]*' | head -1)
  [ -n "$CV" ] || die "не удалось узнать версию Caddy"
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/$CV/caddy_${CV#v}_linux_$CA.tar.gz" | tar -xz -C /usr/local/bin caddy
  chmod +x /usr/local/bin/caddy
fi
caddy version | head -1

say "Код Волны"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q --depth 1 origin "$BRANCH"
  git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"
npm install --omit=dev --no-audit --no-fund --loglevel=error

say "Настройки"
id volna >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /var/lib/volna volna
mkdir -p /etc/volna /var/lib/volna
chown volna:volna /var/lib/volna
if [ ! -f /etc/volna/env ]; then
  cat > /etc/volna/env <<EOF
PORT=$PORT
PUBLIC_URL=https://$DOMAIN
TURN_HOST=$IP
TURN_SECRET=$(openssl rand -hex 24)
DATA_DIR=/var/lib/volna
KEEP_AWAKE=0
EOF
  chmod 600 /etc/volna/env
fi
# shellcheck disable=SC1091
. /etc/volna/env

say "Сервер-посредник для звонков (coturn)"
cat > /etc/turnserver.conf <<EOF
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=$TURN_SECRET
realm=$DOMAIN
external-ip=$IP
min-port=49160
max-port=49250
no-cli
no-tls
no-dtls
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
syslog
EOF
[ -f /etc/default/coturn ] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable -q coturn
systemctl restart coturn

say "Службы"
mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF

cat > /etc/systemd/system/volna.service <<EOF
[Unit]
Description=Volna messenger
After=network-online.target
Wants=network-online.target

[Service]
User=volna
WorkingDirectory=$DIR
EnvironmentFile=/etc/volna/env
ExecStart=/usr/local/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy (HTTPS)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile
Restart=always
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

# автообновление: каждые 3 минуты подтягивает свежий код из GitHub
cat > /usr/local/bin/volna-update <<EOF
#!/bin/bash
cd $DIR || exit 0
git fetch -q --depth 1 origin $BRANCH || exit 0
[ "\$(git rev-parse HEAD)" = "\$(git rev-parse origin/$BRANCH)" ] && exit 0
git reset -q --hard origin/$BRANCH
npm install --omit=dev --no-audit --no-fund --loglevel=error
systemctl restart volna
EOF
chmod +x /usr/local/bin/volna-update
cat > /etc/systemd/system/volna-update.service <<'EOF'
[Unit]
Description=Volna auto-update
[Service]
Type=oneshot
ExecStart=/usr/local/bin/volna-update
EOF
cat > /etc/systemd/system/volna-update.timer <<'EOF'
[Unit]
Description=Volna auto-update every 3 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=3min
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable -q --now volna caddy volna-update.timer
systemctl restart volna caddy

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  say "Открываю порты в файрволе"
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw allow 3478 >/dev/null; ufw allow 49160:49250/udp >/dev/null
fi

say "Жду HTTPS-сертификат (до 2 минут)"
ok=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/config" >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done

if [ "$ok" = 1 ]; then
  printf '\n\033[1;32m✅ Волна работает: https://%s\033[0m\n' "$DOMAIN"
  echo "Скинь этот адрес в чат — его вошьют в приложения."
else
  echo
  echo "Сервер запущен, но HTTPS пока не ответил. Проверь, что открыты порты 80 и 443, и посмотри журнал:"
  echo "  journalctl -u caddy -n 30 --no-pager"
  echo "  journalctl -u volna -n 30 --no-pager"
  echo "Адрес будет: https://$DOMAIN"
fi
