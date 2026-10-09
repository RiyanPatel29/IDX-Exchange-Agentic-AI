#!/usr/bin/env bash
# Week 0: import the MLS dumps into MySQL (run inside WSL Ubuntu, from the repo folder).
# Usage:  bash scripts/import_db.sh            (imports every data/*.sql it finds)
#
# Uses "fast mode": MySQL normally flushes to disk after every row, which is very
# slow on WSL (~120 KiB/s). Batching the commit makes it ~50x faster (~6 MiB/s).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && source .env; set +a
DB=${MYSQL_DATABASE:-idx_exchange}

command -v pv >/dev/null || sudo apt install -y pv

# Order matters only for readability; tables are independent.
FILES=()
for f in california_sold rets_property rets_openhouse; do
  [ -f "data/$f.sql" ] && FILES+=("data/$f.sql")
done
[ ${#FILES[@]} -gt 0 ] || { echo "No dumps found in data/. Copy the .sql files there first."; exit 1; }

# Warn if a dump forces its own database name
if grep -m1 -qiE "CREATE DATABASE|^USE " "${FILES[@]}"; then
  echo "Heads up: a dump contains CREATE DATABASE/USE, tables may land outside '$DB':"
  grep -m3 -iE "CREATE DATABASE|^USE " "${FILES[@]}"
fi

echo "Fast mode ON"
sudo mysql -e "SET GLOBAL innodb_flush_log_at_trx_commit=2;"
trap 'sudo mysql -e "SET GLOBAL innodb_flush_log_at_trx_commit=1;"; echo "Fast mode OFF"' EXIT

for f in "${FILES[@]}"; do
  echo "Importing $f ..."
  ( echo "SET autocommit=0; SET unique_checks=0; SET foreign_key_checks=0;"
    pv "$f"
    echo "COMMIT;" ) | sudo mysql "$DB"
  echo "  done (if it paused at 100%, that was index building)"
done

echo
sudo mysql "$DB" -e "SELECT table_name, table_rows AS approx_rows FROM information_schema.tables WHERE table_schema = DATABASE();"
echo "Now run: python scripts/verify_db.py"
