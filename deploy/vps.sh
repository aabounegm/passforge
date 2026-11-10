#!/bin/sh
# Deploy to a host that already runs Caddy: update server in Docker (127.0.0.1:$SERVER_PORT), web app as static files.
# usage: deploy/vps.sh <ssh-host>     needs .env on the host in ~/passforge (see .env.example) and the web build vars
#        VITE_OIDC_ISSUER, VITE_OIDC_CLIENT_ID, VITE_SERVER_URL in the environment (or apps/web/.env.production).
set -eu
host=$1
cd "$(dirname "$0")/.."
git archive HEAD | ssh "$host" 'mkdir -p ~/passforge && tar -x -C ~/passforge'
ssh "$host" 'cd ~/passforge && docker compose up -d --build server && docker image prune -f >/dev/null'
BASE_PATH=/ pnpm --filter @passforge/web build
ssh "$host" 'sudo mkdir -p /srv/passforge-web && sudo chown "$USER" /srv/passforge-web'
rsync -a --delete apps/web/dist/ "$host:/srv/passforge-web/"
