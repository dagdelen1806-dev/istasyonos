#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  printf '%s\n' 'Configuration is missing. Run the separate installation and reviewed migration procedure first.' >&2
  exit 1
fi
bash scripts/cloud-db-start.sh
exec ./node_modules/.bin/pnpm dev
