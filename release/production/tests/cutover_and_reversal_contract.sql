\set ON_ERROR_STOP on
-- CADDE DEPO — SECURITY CUTOVER + REVERSAL CONTRACT (SYNTHETIC CI ONLY)
-- Only for disposable GitHub Actions postgres:16/cadde_ci. DO NOT RUN on
-- Preview or Production. Simulates role access; no live customer data.
-- Important: restoring legacy grants is an UNSAFE EMERGENCY option and not
-- the preferred rollback. The rollback of this CI test is SQL ROLLBACK.
BEGIN;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.orders TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.order_items TO anon,authenticated;
GRANT USAGE ON SEQUENCE public.order_items_id_seq TO anon,authenticated;

-- Baseline: mimic Production open direct write policy.
CREATE POLICY ci_legacy_order_insert ON public.orders FOR INSERT TO anon,authenticated WITH CHECK(true);
CREATE POLICY ci_legacy_item_insert ON public.order_items FOR INSERT TO anon,authenticated WITH CHECK(true);
CREATE POLICY ci_admin_order_read ON public.orders FOR SELECT TO authenticated
 USING ((auth.jwt()->'app_metadata'->>'role')='admin');
CREATE POLICY ci_admin_order_update ON public.orders FOR UPDATE TO authenticated
 USING ((auth.jwt()->'app_metadata'->>'role')='admin')
 WITH CHECK ((auth.jwt()->'app_metadata'->>'role')='admin');

SET LOCAL ROLE anon;
INSERT INTO public.orders(id,toplam,durum,kanal)
 VALUES('00000000-0000-4000-8000-00000000e001',33000,'whatsapp_bekliyor','whatsapp');
INSERT INTO public.order_items(order_id,product_id,ad,fiyat,adet)
 VALUES('00000000-0000-4000-8000-00000000e001',5,'LEGACY DIRECT INSERT',33000,1);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
UPDATE public.orders SET durum='onaylandi'
 WHERE id='00000000-0000-4000-8000-00000000e001';
RESET ROLE;

DO $baseline$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id='00000000-0000-4000-8000-00000000e001' AND durum='onaylandi')
 THEN RAISE EXCEPTION 'CI_BASELINE_DIRECT_STATUS_UPDATE_FAILED'; END IF;
 IF EXISTS(SELECT 1 FROM cadde_internal.trusted_checkout_orders WHERE order_id='00000000-0000-4000-8000-00000000e001')
 THEN RAISE EXCEPTION 'CI_LEGACY_WAS_ATTESTED'; END IF;
END $baseline$;

-- Cutover candidate: remove both grants and the exact legacy policies.
DROP POLICY ci_legacy_order_insert ON public.orders;
DROP POLICY ci_legacy_item_insert ON public.order_items;
DROP POLICY ci_admin_order_update ON public.orders;
REVOKE INSERT,UPDATE,DELETE ON public.orders,public.order_items FROM anon,authenticated;
DO $grants$
BEGIN
 IF has_table_privilege('anon','public.orders','INSERT')
  OR has_table_privilege('anon','public.order_items','INSERT')
  OR has_table_privilege('authenticated','public.orders','UPDATE')
  OR has_table_privilege('authenticated','public.order_items','UPDATE')
 THEN RAISE EXCEPTION 'CI_DIRECT_WRITE_GRANTS_STILL_OPEN'; END IF;
END $grants$;

SET LOCAL ROLE anon;
DO $blocked_anon$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  INSERT INTO public.orders(id,toplam,durum,kanal)
    VALUES('00000000-0000-4000-8000-00000000e002',33000,'whatsapp_bekliyor','whatsapp');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'CI_ANON_INSERT_NOT_BLOCKED'; END IF;
END $blocked_anon$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $blocked_admin$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  UPDATE public.orders SET durum='iptal'
    WHERE id='00000000-0000-4000-8000-00000000e001';
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'CI_ADMIN_DIRECT_UPDATE_NOT_BLOCKED'; END IF;
END $blocked_admin$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('cd.ci_new_order',
  (public.create_whatsapp_request_protected_v3(
   '[5]'::jsonb,33000,repeat('e',64),repeat('f',64),
   '00000000-0000-4000-8000-00000000e101'::uuid)->>'request_id'),true);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
DO $audited$
DECLARE r jsonb;
BEGIN
 r:=public.admin_set_order_status_audited('00000000-0000-4000-8000-00000000e001','iptal');
 IF r->>'error_code'<>'UNTRUSTED_ORDER_SOURCE'
 THEN RAISE EXCEPTION 'CI_LEGACY_ORDER_PROVENANCE_BYPASS %',r; END IF;
 r:=public.admin_set_order_status_audited(current_setting('cd.ci_new_order')::uuid,'onaylandi');
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'CI_PROTECTED_ADMIN_APPROVAL_FAILED %',r; END IF;
 r:=public.admin_set_order_status_audited(current_setting('cd.ci_new_order')::uuid,'iptal');
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'CI_PROTECTED_ADMIN_CANCEL_FAILED %',r; END IF;
END $audited$;
RESET ROLE;
DO $integrity$
BEGIN
 IF (SELECT stok FROM public.products WHERE id=5)<>1
 THEN RAISE EXCEPTION 'CI_STOCK_NOT_RESTORED'; END IF;
 IF (SELECT count(*) FROM cadde_internal.admin_order_status_audit
     WHERE order_id IN ('00000000-0000-4000-8000-00000000e001',current_setting('cd.ci_new_order')::uuid))<>3
 THEN RAISE EXCEPTION 'CI_AUDIT_NOT_RECORDED'; END IF;
END $integrity$;
SELECT 'SAFE_CUTOVER_GATE_PASSED' AS result;

-- Demonstrate unsafe emergency re-opening. This is a WARNING, NOT a rollout.
-- A proper rollback should keep checkout fail-closed, preserve audit and
-- reconcile old orders, rather than silently return to unprotected writes.
GRANT INSERT ON public.orders,public.order_items TO anon,authenticated;
GRANT UPDATE ON public.orders TO authenticated;
CREATE POLICY ci_unsafe_reopen_order_insert ON public.orders FOR INSERT TO anon,authenticated WITH CHECK(true);
CREATE POLICY ci_unsafe_reopen_item_insert ON public.order_items FOR INSERT TO anon,authenticated WITH CHECK(true);
CREATE POLICY ci_unsafe_reopen_admin_update ON public.orders FOR UPDATE TO authenticated
 USING ((auth.jwt()->'app_metadata'->>'role')='admin')
 WITH CHECK ((auth.jwt()->'app_metadata'->>'role')='admin');
SET LOCAL ROLE anon;
INSERT INTO public.orders(id,toplam,durum,kanal)
 VALUES('00000000-0000-4000-8000-00000000e003',33000,'whatsapp_bekliyor','whatsapp');
RESET ROLE;
DO $rollback_warning$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id='00000000-0000-4000-8000-00000000e003')
 THEN RAISE EXCEPTION 'CI_UNSAFE_GRANT_REOPEN_NOT_DEMONSTRATED'; END IF;
 IF EXISTS(SELECT 1 FROM cadde_internal.trusted_checkout_orders
  WHERE order_id='00000000-0000-4000-8000-00000000e003')
 THEN RAISE EXCEPTION 'CI_UNSAFE_LEGACY_ORDER_WRONGLY_TRUSTED'; END IF;
END $rollback_warning$;
SELECT 'UNSAFE_EMERGENCY_REOPEN_DEMONSTRATED_DO_NOT_USE_AS_DEFAULT_ROLLBACK' AS warning;
ROLLBACK;
