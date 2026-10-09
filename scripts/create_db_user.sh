#!/usr/bin/env bash
# Create (or update) the idx_exchange database + idx_user using the password in .env.
# Keeps the real password out of git. Usage:  bash scripts/create_db_user.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No .env found. Run: cp .env.example .env"; exit 1; }
set -a; source .env; set +a
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD missing in .env}"
DB=${MYSQL_DATABASE:-idx_exchange}
USER_=${MYSQL_USER:-idx_user}
sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$USER_'@'localhost' IDENTIFIED BY '$MYSQL_PASSWORD';
ALTER USER '$USER_'@'localhost' IDENTIFIED BY '$MYSQL_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB\`.* TO '$USER_'@'localhost';
FLUSH PRIVILEGES;
SQL
echo "Database '$DB' and user '$USER_' ready (password taken from .env)."
