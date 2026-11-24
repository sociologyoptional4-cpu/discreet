#!/usr/bin/env bash
# Builds a scratch database with the local shim + migrations, then runs the access matrix.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh   (any local Postgres 14+, no Docker)
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists nc_test" -c "create database nc_test"
for f in tests/shim.sql migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d nc_test -f "$f"; done
psql -d nc_test -f tests/access_matrix.sql | grep -E "FAIL|passed|^ +[0-9]+ +\|"
