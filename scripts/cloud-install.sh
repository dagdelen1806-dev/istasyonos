#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
db_root=/workspace/local-mysql
mkdir -p "$db_root/packages" "$db_root/apt/lists/partial" "$db_root/apt/cache/archives/partial"
if [[ ! -x "$db_root/root/usr/sbin/mariadbd" ]]; then
  # Debian archive signatures and package checksums remain enabled.
  printf '%s\n' 'deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main' > "$db_root/apt/sources.list"
  apt_opts=(-o "Dir::Etc::sourcelist=$db_root/apt/sources.list" -o Dir::Etc::sourceparts=- -o "Dir::State::lists=$db_root/apt/lists" -o "Dir::Cache=$db_root/apt/cache" -o Debug::NoLocking=1)
  apt-get "${apt_opts[@]}" update
  (cd "$db_root/packages" && apt-get "${apt_opts[@]}" download mariadb-server-core mariadb-client-core liburing2 libaio1t64)
  for archive in "$db_root"/packages/*.deb; do dpkg-deb -x "$archive" "$db_root/root"; done
fi
export LD_LIBRARY_PATH="$db_root/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [[ ! -d "$db_root/data/mysql" ]]; then
  "$db_root/root/usr/bin/mariadb-install-db" --no-defaults --basedir="$db_root/root/usr" --datadir="$db_root/data" --auth-root-authentication-method=normal --skip-test-db
fi
bash scripts/cloud-db-start.sh
npm --cache /tmp/istasyonos-npm-cache exec --yes --package=pnpm@10.18.0 -- pnpm install --frozen-lockfile --store-dir /workspace/.pnpm-store
node scripts/cloud-config.mjs
./node_modules/.bin/pnpm db:migrate
./node_modules/.bin/pnpm tsx server/stationos/migrate.ts
./node_modules/.bin/pnpm check
./node_modules/.bin/pnpm test
./node_modules/.bin/pnpm build
