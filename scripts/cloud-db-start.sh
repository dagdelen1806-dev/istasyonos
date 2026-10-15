#!/usr/bin/env bash
set -euo pipefail
db_root=/workspace/local-mysql
export LD_LIBRARY_PATH="$db_root/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
ready() {
  if [[ -f "$db_root/admin.cnf" ]]; then
    "$db_root/root/usr/bin/mariadb" --defaults-file="$db_root/admin.cnf" --connect-timeout=1 -e 'SELECT 1' >/dev/null 2>&1
  else
    "$db_root/root/usr/bin/mariadb" --no-defaults --socket="$db_root/mysql.sock" --user=root --connect-timeout=1 -e 'SELECT 1' >/dev/null 2>&1
  fi
}
running() {
  [[ -f "$db_root/mysql.pid" ]] || return 1
  local pid status
  pid=$(cat "$db_root/mysql.pid")
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  status=$(ps -p "$pid" -o stat= 2>/dev/null) || return 1
  [[ -n "$status" && "$status" != *Z* ]]
}
launched=0
for attempt in {1..30}; do
  if ready; then
    exit 0
  fi
  # A graceful shutdown may still be finishing when this script is called.
  # Recheck until the old process exits before starting its replacement.
  if ! running && [[ "$launched" == 0 ]]; then
    nohup "$db_root/root/usr/sbin/mariadbd" --no-defaults --basedir="$db_root/root/usr" --datadir="$db_root/data" --socket="$db_root/mysql.sock" --pid-file="$db_root/mysql.pid" --skip-networking --log-error="$db_root/mysql.log" > "$db_root/launcher.log" 2>&1 &
    launched=1
  fi
  sleep 1
done
echo 'Local database failed to start; inspect /workspace/local-mysql/mysql.log' >&2
exit 1
