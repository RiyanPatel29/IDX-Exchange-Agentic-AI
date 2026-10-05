#!/usr/bin/env bash
# Week 0: import both MLS dumps into MySQL (run inside WSL Ubuntu).
# Usage:  bash scripts/import_db.sh /path/to/rets_property.sql /path/to/california_sold.sql
set -euo pipefail

RETS=${1:-data/rets_property.sql}
SOLD=${2:-data/california_sold.sql}
DB=${MYSQL_DATABASE:-idx_exchange}

echo "Creating database + user (enter MySQL root password)..."
sudo mysql < sql/create_user.sql

echo "Importing rets_property (FULLTEXT index on L_Remarks can take a while)..."
sudo mysql "$DB" < "$RETS"

echo "Importing california_sold..."
sudo mysql "$DB" < "$SOLD"

echo "Row counts:"
sudo mysql "$DB" -e "SELECT
  (SELECT COUNT(*) FROM rets_property)   AS active_listings,
  (SELECT COUNT(*) FROM california_sold) AS sold_comps;"
