\set ON_ERROR_STOP on
-- Synthetic-only CI checks. Run as postgres in throwaway PostgreSQL 16.
BEGIN;
DO $test$
DECLARE a uuid; b uuid; rr jsonb; msg text; blocked boolean;
BEGIN
  -- Legacy v2 same-key replay must fail
  blocked:=false;
  BEGIN
    PERFORM public.create_whatsapp_request_protected_v3('[5]'::jsonb,33000,repeat('a',64),repeat('f',64),'00000000-0000-4000-8000-00000000a011');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    blocked:=(msg='UNTRUSTED_ORDER_SOURCE');
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL legacy same-key replay'; END IF;
  -- Legacy v2 different key / same visitor and cart must fail
  blocked:=false;
  BEGIN
    PERFORM public.create_whatsapp_request_protected_v3('[5]'::jsonb,33000,repeat('a',64),repeat('f',64),'00000000-0000-4000-8000-00000000a012');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    blocked:=(msg='UNTRUSTED_ORDER_SOURCE');
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL legacy cross-key replay'; END IF;
END $test$;
SET LOCAL ROLE service_role;
SELECT set_config('cd.ci_order_a',(public.create_whatsapp_request_protected_v3('[5]'::jsonb,33000,repeat('b',64),repeat('f',64),'00000000-0000-4000-8000-00000000b001')->>'request_id'),true);
SELECT set_config('cd.ci_order_b',(public.create_whatsapp_request_protected_v3('[5]'::jsonb,33000,repeat('c',64),repeat('f',64),'00000000-0000-4000-8000-00000000c001')->>'request_id'),true);
RESET ROLE;
DO $check$
BEGIN
  IF (SELECT COUNT(*) FROM cadde_internal.trusted_checkout_orders WHERE order_id IN (current_setting('cd.ci_order_a')::uuid,current_setting('cd.ci_order_b')::uuid))<>2 THEN RAISE EXCEPTION 'FAIL trusted'; END IF;
  IF (SELECT COUNT(*) FROM public.order_items WHERE order_id IN (current_setting('cd.ci_order_a')::uuid,current_setting('cd.ci_order_b')::uuid))<>2 THEN RAISE EXCEPTION 'FAIL items'; END IF;
END $check$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","app_metadata":{"role":"admin"}}',true);
DO $admin$
DECLARE r jsonb;
BEGIN
  r:=public.admin_set_order_status_audited('00000000-0000-4000-8000-00000000a001','onaylandi');
  IF r->>'error_code'<>'UNTRUSTED_ORDER_SOURCE' THEN RAISE EXCEPTION 'FAIL legacy admin %',r; END IF;
  r:=public.admin_set_order_status_audited(current_setting('cd.ci_order_a')::uuid,'onaylandi');
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'FAIL approval %',r; END IF;
  r:=public.admin_set_order_status_audited(current_setting('cd.ci_order_a')::uuid,'onaylandi');
  IF r->>'unchanged'<>'true' THEN RAISE EXCEPTION 'FAIL repeat %',r; END IF;
  r:=public.admin_set_order_status_audited(current_setting('cd.ci_order_b')::uuid,'onaylandi');
  IF r->>'error_code'<>'INSUFFICIENT_ACTIVE_STOCK' THEN RAISE EXCEPTION 'FAIL oversell %',r; END IF;
  r:=public.admin_set_order_status_audited(current_setting('cd.ci_order_a')::uuid,'iptal');
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'FAIL cancel %',r; END IF;
END $admin$;
RESET ROLE;
DO $assert$
BEGIN
 IF (SELECT stok FROM public.products WHERE id=5)<>1 THEN RAISE EXCEPTION 'FAIL stock'; END IF;
 IF (SELECT COUNT(*) FROM cadde_internal.admin_order_status_audit WHERE order_id IN (current_setting('cd.ci_order_a')::uuid,current_setting('cd.ci_order_b')::uuid,'00000000-0000-4000-8000-00000000a001'))<>5 THEN RAISE EXCEPTION 'FAIL audit'; END IF;
END $assert$;
SELECT 'ALL_INTEGRATION_ASSERTIONS_PASSED' AS outcome;
ROLLBACK;
