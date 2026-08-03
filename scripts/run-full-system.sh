#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Checking prerequisites"
command -v docker >/dev/null 2>&1 || { echo "Docker is required but was not found."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required but was not found."; exit 1; }

if [ ! -d node_modules ]; then
  echo "==> Installing workspace dependencies"
  pnpm install
fi

echo "==> Creating missing env files from examples"
for src in \
  apps/api/.env.example \
  apps/web/.env.local.example \
  services/clip-worker/.env.example \
  services/transcription-worker/.env.example \
  services/render-worker/.env.example \
  services/publish-worker/.env.example
 do
  dst="${src/.example/}"
  if [ ! -f "$dst" ]; then
    cp "$src" "$dst"
    echo "Created $dst"
  fi
done

echo "==> Starting Docker services"
docker compose -f infrastructure/docker/docker-compose.yml up -d

echo "==> Starting API and web apps"
echo "Open http://localhost:3000 for the web app"
echo "Open http://localhost:3001/api/v1 for the API"
pnpm dev
