#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/cloud-db-start.sh
node scripts/cloud-config.mjs
exec ./node_modules/.bin/pnpm dev
