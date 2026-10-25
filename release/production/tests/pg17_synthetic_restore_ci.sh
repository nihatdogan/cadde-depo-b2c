#!/usr/bin/env bash
# CI-only PostgreSQL 17 source/restore rehearsal; SYNTHETIC DATA ONLY.
set -euo pipefail
[[ "$CADDE_CI_ISOLATED" == "1" ]] || { echo "Refusing non-isolated execution"; exit 1; }
[[ "$PGHOST" == "127.0.0.1" && "$PGPORT" == "5432" &&
   "$PGDATABASE" == "cadde_ci" && "$PGUSER" == "postgres" ]] ||
  { echo "Refusing unknown PostgreSQL target"; exit 1; }
major="$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT current_setting('server_version_num')::int / 10000")"
[[ "$major" == 17 ]] || { echo "Expected PostgreSQL 17; got $major"; exit 1; }
archive="$(mktemp /tmp/cadde-pg17-synthetic-XXXXXX.dump)"
restore_db="cadde_restore_pg17_ci"
created=0
cleanup() {
  if [[ "$created" == 1 ]]; then
    psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $restore_db" >/dev/null || true
  fi
  rm -f "$archive"
}
trap cleanup EXIT
# The PostgreSQL 17 Docker image supplies matching pg_dump/pg_restore tools.
docker run --rm --network host -e PGPASSWORD="$PGPASSWORD" postgres:17 \
  pg_dump -h 127.0.0.1 -p 5432 -U postgres -d cadde_ci --format=custom > "$archive"
[[ -s "$archive" ]] || { echo "Empty synthetic backup"; exit 1; }
psql -X -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $restore_db" >/dev/null
created=1
docker run --rm -i --network host -e PGPASSWORD="$PGPASSWORD" postgres:17 \
  pg_restore -h 127.0.0.1 -p 5432 -U postgres -d "$restore_db" --no-owner < "$archive"
query="SELECT jsonb_build_object(
  'products',(SELECT count(*) FROM public.products),
  'orders',(SELECT count(*) FROM public.orders),
  'items',(SELECT count(*) FROM public.order_items),
  'trusted_table',to_regclass('cadde_internal.trusted_checkout_orders') IS NOT NULL,
  'trusted_rows',(SELECT count(*) FROM cadde_internal.trusted_checkout_orders),
  'products_rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.products'::regclass),
  'core_rpc',(SELECT count(*) FROM pg_proc WHERE proname='create_whatsapp_request_protected_v3'
    AND pronamespace='public'::regnamespace),
  'admin_rpc',(SELECT count(*) FROM pg_proc WHERE proname='admin_set_order_status_audited'
    AND pronamespace='public'::regnamespace),
  'internal_rls',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='cadde_internal' AND c.relkind='r' AND c.relrowsecurity),
  'internal_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='cadde_internal' AND c.relkind='r')
)::text;"
src="$(psql -X -At -v ON_ERROR_STOP=1 -d cadde_ci -c "$query")"
dst="$(psql -X -At -v ON_ERROR_STOP=1 -d "$restore_db" -c "$query")"
python3 - "$src" "$dst" <<'PY'
import json, sys
source, restored = map(json.loads, sys.argv[1:3])
assert source["orders"] >= 2 and source["products"] >= 1
assert source["core_rpc"] == 1 and source["admin_rpc"] == 1
assert source["internal_rls"] == source["internal_tables"]
assert source == restored, "Source/restore mismatch (non-identifying manifest only)"
print("SYNTHETIC_PG17_DUMP_RESTORE_PASS: rows, RLS, RPC and internal objects match; NO production data")
PY
