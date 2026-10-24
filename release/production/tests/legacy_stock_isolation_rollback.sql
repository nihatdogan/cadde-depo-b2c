-- CADDE DEPO / ISOLATED LEGACY-STOCK TEST
-- Run on PREVIEW Supabase only. Never run on Production.
-- All objects are temporary, all changes rolled back.
-- This is a CONTRACT TEST, not a complete production admin RPC or permission test.
BEGIN;

CREATE TEMP TABLE cd_legacy_probe_orders(
  id uuid PRIMARY KEY,
  durum text NOT NULL,
  kanal text NOT NULL DEFAULT 'whatsapp',
  toplam numeric NOT NULL DEFAULT 33000
) ON COMMIT DROP;
CREATE TEMP TABLE cd_legacy_probe_products(
  id bigint PRIMARY KEY,
  stok integer NOT NULL CHECK(stok>=0),
  max_stok integer NOT NULL CHECK(max_stok>0 AND stok<=max_stok)
) ON COMMIT DROP;

INSERT INTO pg_temp.cd_legacy_probe_orders(id,durum) VALUES
 ('cadd0000-0000-4000-8000-000000000001'::uuid,'whatsapp_bekliyor'),
 ('cadd0000-0000-4000-8000-000000000002'::uuid,'whatsapp_bekliyor'),
 ('cadd0000-0000-4000-8000-000000000003'::uuid,'whatsapp_bekliyor'),
 ('cadd0000-0000-4000-8000-000000000004'::uuid,'teslim');
INSERT INTO pg_temp.cd_legacy_probe_products VALUES (5,1,1);

-- EXACT same migration strategy as production review-only expand draft:
ALTER TABLE pg_temp.cd_legacy_probe_orders ADD COLUMN stok_rezerve boolean;
ALTER TABLE pg_temp.cd_legacy_probe_orders ALTER COLUMN stok_rezerve SET DEFAULT false;

DO $assert_legacy$
BEGIN
  IF (SELECT count(*) FROM pg_temp.cd_legacy_probe_orders
      WHERE stok_rezerve IS NULL)<>4
    THEN RAISE EXCEPTION 'FAILED: legacy history not preserved as NULL'; END IF;
END $assert_legacy$;

INSERT INTO pg_temp.cd_legacy_probe_orders(id,durum) VALUES
 ('cadd0000-0000-4000-8000-000000000005'::uuid,'whatsapp_bekliyor'),
 ('cadd0000-0000-4000-8000-000000000006'::uuid,'whatsapp_bekliyor');

DO $assert_new$
BEGIN
  IF (SELECT count(*) FROM pg_temp.cd_legacy_probe_orders
      WHERE id IN ('cadd0000-0000-4000-8000-000000000005'::uuid,
                   'cadd0000-0000-4000-8000-000000000006'::uuid)
        AND stok_rezerve IS FALSE)<>2
    THEN RAISE EXCEPTION 'FAILED: new orders did not default false'; END IF;
END $assert_new$;

-- Simulates the required stock transition contract against temporary tables.
-- Production implementation must also enforce admin identity, item totals, price,
-- row locking for all SKU rows, audit entries, and tenant/environment constraints.
CREATE FUNCTION pg_temp.cd_legacy_probe_transition(p_order_id uuid,p_status text)
RETURNS text LANGUAGE plpgsql SET search_path='' AS $fn$
DECLARE
  old_order record;
  current_stock integer;
  max_stock integer;
BEGIN
  SELECT * INTO old_order FROM pg_temp.cd_legacy_probe_orders
   WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'ORDER_NOT_FOUND'; END IF;

  -- Critical fail-closed check BEFORE same-status and all transitions:
  IF old_order.stok_rezerve IS NULL THEN RETURN 'LEGACY_ORDER_RECONCILIATION_REQUIRED'; END IF;
  IF old_order.durum=p_status THEN RETURN 'UNCHANGED'; END IF;

  IF p_status='onaylandi' AND old_order.durum='whatsapp_bekliyor' THEN
    SELECT stok,max_stok INTO current_stock,max_stock
    FROM pg_temp.cd_legacy_probe_products WHERE id=5 FOR UPDATE;
    IF current_stock < 1 THEN RETURN 'INSUFFICIENT_ACTIVE_STOCK'; END IF;
    UPDATE pg_temp.cd_legacy_probe_products SET stok=stok-1 WHERE id=5;
    UPDATE pg_temp.cd_legacy_probe_orders
      SET durum='onaylandi',stok_rezerve=true WHERE id=p_order_id;
    RETURN 'ACCEPTED';
  END IF;

  IF p_status='iptal' AND old_order.durum='onaylandi' THEN
    SELECT stok,max_stok INTO current_stock,max_stock
    FROM pg_temp.cd_legacy_probe_products WHERE id=5 FOR UPDATE;
    IF NOT old_order.stok_rezerve THEN RETURN 'NOT_RESERVED'; END IF;
    IF current_stock+1>max_stock THEN RETURN 'RESTOCK_EXCEEDS_CAPACITY'; END IF;
    UPDATE pg_temp.cd_legacy_probe_products SET stok=stok+1 WHERE id=5;
    UPDATE pg_temp.cd_legacy_probe_orders
      SET durum='iptal',stok_rezerve=false WHERE id=p_order_id;
    RETURN 'ACCEPTED';
  END IF;
  RETURN 'INVALID_TRANSITION';
END $fn$;

DO $assert$
DECLARE result text;
BEGIN
  result:=pg_temp.cd_legacy_probe_transition('cadd0000-0000-4000-8000-000000000001','onaylandi');
  IF result<>'LEGACY_ORDER_RECONCILIATION_REQUIRED' THEN RAISE EXCEPTION 'FAILED: legacy pending approved: %',result; END IF;
  result:=pg_temp.cd_legacy_probe_transition('cadd0000-0000-4000-8000-000000000004','iptal');
  IF result<>'LEGACY_ORDER_RECONCILIATION_REQUIRED' THEN RAISE EXCEPTION 'FAILED: legacy delivered altered: %',result; END IF;
  result:=pg_temp.cd_legacy_probe_transition('cadd0000-0000-4000-8000-000000000004','teslim');
  IF result<>'LEGACY_ORDER_RECONCILIATION_REQUIRED' THEN RAISE EXCEPTION 'FAILED: legacy idempotent status allowed: %',result; END IF;

  result:=pg_temp.cd_legacy_probe_transition('cadd0000-0000-4000-8000-000000000005','onaylandi');
  IF result<>'ACCEPTED' OR (SELECT stok FROM pg_temp.cd_legacy_probe_products WHERE id=5)<>0 THEN RAISE EXCEPTION 'FAILED: new order not reserved: %',result; END IF;
  result:=pg_temp.cd_legacy_probe_transition('cadd0000-0000-4000-8000-000000000005','onaylandi');
  IF result<>'UNCHANGED' OR (SELECT stok FROM pg_temp.cd_legacy_probe_products WHERE id=5)<>0 THEN RAISE EXCEPTION 'FAILED: repeated approval: %',result; END IF;
  result:=pg_temp.cd_legacy_probe_transition('cadd0000-0000-4000-8000-000000000006','onaylandi');
  IF result<>'INSUFFICIENT_ACTIVE_STOCK' OR (SELECT durum FROM pg_temp.cd_legacy_probe_orders WHERE id='cadd0000-0000-4000-8000-000000000006')<>'whatsapp_bekliyor'
    THEN RAISE EXCEPTION 'FAILED: oversell prevention: %',result; END IF;
  result:=pg_temp.cd_legacy_probe_transition('cadd0000-0000-4000-8000-000000000005','iptal');
  IF result<>'ACCEPTED' OR (SELECT stok FROM pg_temp.cd_legacy_probe_products WHERE id=5)<>1 THEN RAISE EXCEPTION 'FAILED: restock: %',result; END IF;
  IF (SELECT count(*) FROM pg_temp.cd_legacy_probe_orders WHERE stok_rezerve IS NULL)<>4
    THEN RAISE EXCEPTION 'FAILED: historical orders were changed'; END IF;
END $assert$;

SELECT
 (SELECT count(*) FROM pg_temp.cd_legacy_probe_orders WHERE stok_rezerve IS NULL) AS untouched_legacy_orders,
 (SELECT count(*) FROM pg_temp.cd_legacy_probe_orders WHERE stok_rezerve IS FALSE) AS new_unreserved_orders,
 (SELECT stok FROM pg_temp.cd_legacy_probe_products WHERE id=5) AS restored_test_stock,
 'ALL_ASSERTIONS_PASSED' AS result;
ROLLBACK;