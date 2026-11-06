#!/usr/bin/env bash
# Runs the migrations and the SQL tests in a throwaway Postgres 17 container.
#   bash frontend/supabase/tests/run.sh            all migrations, then every *_test.sql
#   bash frontend/supabase/tests/run.sh 006        migrations up to 006 only (to see a bug before its fix)
# Needs Docker Desktop running. Nothing here touches the real Supabase project.
set -euo pipefail

UPTO="${1:-999}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"   # frontend/supabase
NAME="selale-sqltest"

MOUNT="$ROOT"
if command -v cygpath >/dev/null 2>&1; then MOUNT="$(cygpath -w "$ROOT")"; fi
export MSYS_NO_PATHCONV=1

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test -e TZ=Europe/Istanbul -e PGTZ=Europe/Istanbul \
  -v "$MOUNT:/sb" postgres:17 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2

psql_file() { docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f "$1"; }

psql_file /sb/tests/00_supabase_stub.sql
for f in "$ROOT"/migrations/*.sql; do
  base="$(basename "$f")"
  [ "${base:0:3}" -le "$UPTO" ] || continue
  echo "== migration $base"
  psql_file "/sb/migrations/$base"
done

status=0
for t in "$ROOT"/tests/*_test.sql; do
  base="$(basename "$t")"
  echo "== test $base"
  docker exec "$NAME" psql -U postgres -q -f "/sb/tests/$base" || status=1
done
exit $status
