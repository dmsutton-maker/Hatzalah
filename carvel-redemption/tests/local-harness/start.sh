#!/usr/bin/env bash
# Stands up a throwaway Postgres + PostgREST that looks enough like Supabase to run
# the acceptance tests without touching the real project.
#
#   ./tests/local-harness/start.sh
#   npm run dev   # with the env vars it prints
#   node tests/staff-flow.mjs
#
# Everything lives in /var/tmp and is disposable. This is a test rig, not a
# deployment path — the real thing is a Supabase project (README §1).

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
PGDATA=/var/tmp/carvel-pgdata
SOCK=/var/tmp
PORT=5433
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="$HERE/../../supabase"

# initdb refuses to run as root, so fall back to a throwaway user when needed.
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  id pgtest >/dev/null 2>&1 || useradd -m pgtest
  RUNAS="pgtest"
fi
run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi }

if [ ! -d "$PGDATA" ]; then
  mkdir -p "$PGDATA"
  [ -n "$RUNAS" ] && chown -R "$RUNAS" "$PGDATA"
  chmod 700 "$PGDATA"
  run "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
fi

run "$PGBIN/pg_ctl -D $PGDATA -o '-p $PORT -k $SOCK' -l $PGDATA/log start" || true
sleep 2

export PGHOST=$SOCK PGPORT=$PORT PGUSER=postgres

psql -tAc "select 1 from pg_database where datname='carvel'" | grep -q 1 || {
  psql -q -c "create database carvel"
  psql -d carvel -q -c "create role anon nologin; create role authenticated nologin;
                        grant usage on schema public to anon, authenticated;"
}

for f in 01_schema 02_seed 03_functions 04_rls 05_override 06_admin_grants 07_geo; do
  psql -d carvel -q -v ON_ERROR_STOP=1 -f "$SQL/$f.sql" >/dev/null
done
echo "schema loaded (01 -> 07)"

# PostgREST stands in for Supabase's REST layer.
if ! curl -sf -o /dev/null http://127.0.0.1:3001/; then
  cat > /var/tmp/carvel-pgrst.conf <<EOF
db-uri = "postgres://postgres@/carvel?host=$SOCK&port=$PORT"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "super-secret-jwt-token-with-at-least-32-characters-long"
server-port = 3001
EOF
  if ! command -v postgrest >/dev/null && [ ! -x /var/tmp/postgrest ]; then
    echo "fetching postgrest..."
    curl -sL -o /var/tmp/pgrst.tar.xz \
      "https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz"
    tar xf /var/tmp/pgrst.tar.xz -C /var/tmp
  fi
  nohup "$(command -v postgrest || echo /var/tmp/postgrest)" /var/tmp/carvel-pgrst.conf \
    > /var/tmp/carvel-pgrst.log 2>&1 &
  sleep 3
fi

# The shim maps /rest/v1/* onto PostgREST so supabase-js is happy.
curl -sf -o /dev/null http://127.0.0.1:3002/rest/v1/ || {
  nohup node "$HERE/supabase-shim.mjs" > /var/tmp/carvel-shim.log 2>&1 &
  sleep 2
}

KEY=$(node "$HERE/supabase-shim.mjs" --print-key)
cat <<EOF

Harness up. Run the app against it with:

  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3002 \\
  NEXT_PUBLIC_SUPABASE_ANON_KEY=$KEY \\
  npm run dev

Then: node tests/staff-flow.mjs && node tests/location.mjs

Note: admin screens need Supabase Auth, which this harness does not provide.
Signed-out redirects work; signing in does not. Test admin against a real project.
EOF
