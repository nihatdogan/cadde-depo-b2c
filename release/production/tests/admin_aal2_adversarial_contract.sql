\set ON_ERROR_STOP on
-- CADDE DEPO / P0 / ISOLATED CI TEST ONLY / 2026-10-28
-- Disposable PostgreSQL 16 fixture. DO NOT execute on Preview or Production.
-- Deliberately uses synthetic JWT claims in local PostgreSQL CI. This does NOT
-- demonstrate that real Supabase Auth has verified a session JWT or its MFA.
-- All test writes are transactionally rolled back.
BEGIN;

-- A valid server-attested synthetic order is the target for authorization probes.
SET LOCAL ROLE service_role;
SELECT set_config('cd.ci_admin_aal2_order',
  (public.create_whatsapp_request_protected_v3(
    '[5]'::jsonb,33000,repeat('6',64),repeat('7',64),
    '00000000-0000-4000-8000-00000000d001'::uuid)->>'request_id'),true);
RESET ROLE;

-- Failure before the audited RPC body must leave orders, stock and audit unchanged.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1","app_metadata":{"role":"admin"}}',true);
DO $aal1$
DECLARE blocked boolean:=false; reason text;
BEGIN
  BEGIN
    PERFORM public.admin_set_order_status_audited(
      current_setting('cd.ci_admin_aal2_order')::uuid,'onaylandi');
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
    blocked:=(reason='MFA_REQUIRED');
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'CI_AAL1_ADMIN_NOT_BLOCKED'; END IF;
END $aal1$;

-- Even with AAL2, a non-admin role cannot update inventory or order status.
SELECT set_config('request.jwt.claims',
 '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2","app_metadata":{"role":"customer"}}',true);
DO $non_admin$
DECLARE blocked boolean:=false; reason text;
BEGIN
  BEGIN
    PERFORM public.admin_set_order_status_audited(
      current_setting('cd.ci_admin_aal2_order')::uuid,'onaylandi');
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
    blocked:=(reason='ADMIN_REQUIRED');
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'CI_AAL2_NONADMIN_NOT_BLOCKED'; END IF;
END $non_admin$;

-- Admin without an explicit AAL claim must also fail closed.
SELECT set_config('request.jwt.claims',
 '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","app_metadata":{"role":"admin"}}',true);
DO $missing_aal$
DECLARE blocked boolean:=false; reason text;
BEGIN
  BEGIN
    PERFORM public.admin_set_order_status_audited(
      current_setting('cd.ci_admin_aal2_order')::uuid,'onaylandi');
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
    blocked:=(reason='MFA_REQUIRED');
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'CI_MISSING_AAL_NOT_BLOCKED'; END IF;
END $missing_aal$;

-- A signed-in role without a subject cannot masquerade as an admin.
SELECT set_config('request.jwt.claims',
 '{"role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
DO $missing_identity$
DECLARE blocked boolean:=false; reason text;
BEGIN
  BEGIN
    PERFORM public.admin_set_order_status_audited(
      current_setting('cd.ci_admin_aal2_order')::uuid,'onaylandi');
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
    blocked:=(reason='ADMIN_REQUIRED');
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'CI_MISSING_SUBJECT_NOT_BLOCKED'; END IF;
END $missing_identity$;

-- The inner stock-update function must not be directly callable by the
-- authenticated role, even if claims say "admin / aal2".
SELECT set_config('request.jwt.claims',
 '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
DO $inner_rpc$
DECLARE blocked boolean:=false;
BEGIN
  BEGIN
    PERFORM public.admin_set_order_status(
      current_setting('cd.ci_admin_aal2_order')::uuid,'onaylandi');
  EXCEPTION WHEN insufficient_privilege THEN
    blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'CI_INNER_RPC_EXECUTABLE_BY_AUTHENTICATED'; END IF;
END $inner_rpc$;
RESET ROLE;

-- Explicitly check anon EXECUTE grants rather than trusting UI visibility.
DO $grants$
BEGIN
  IF has_function_privilege('anon',
    'public.admin_set_order_status_audited(uuid,text)'::regprocedure,'EXECUTE')
    OR has_function_privilege('anon',
    'public.admin_set_order_status(uuid,text)'::regprocedure,'EXECUTE')
    OR has_function_privilege('authenticated',
    'public.admin_set_order_status(uuid,text)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'CI_ADMIN_RPC_GRANTS_TOO_BROAD';
  END IF;
  IF NOT has_function_privilege('authenticated',
    'public.admin_set_order_status_audited(uuid,text)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'CI_AUDITED_RPC_NOT_AVAILABLE_TO_AUTHENTICATED';
  END IF;
  IF (SELECT stok FROM public.products WHERE id=5)<>1 THEN
    RAISE EXCEPTION 'CI_UNAUTHORIZED_STOCK_MUTATION';
  END IF;
  IF (SELECT durum FROM public.orders
      WHERE id=current_setting('cd.ci_admin_aal2_order')::uuid)<>'whatsapp_bekliyor' THEN
    RAISE EXCEPTION 'CI_UNAUTHORIZED_ORDER_MUTATION';
  END IF;
  IF EXISTS(SELECT 1 FROM cadde_internal.admin_order_status_audit
    WHERE order_id=current_setting('cd.ci_admin_aal2_order')::uuid) THEN
    RAISE EXCEPTION 'CI_UNAUTHORIZED_REQUEST_WROTE_AUDIT';
  END IF;
END $grants$;

-- Synthetic adversarial provenance: even a forged trusted marker must NOT
-- override historical NULL stock accounting.
INSERT INTO cadde_internal.trusted_checkout_orders(order_id,source)
VALUES ('00000000-0000-4000-8000-00000000a002','protected_checkout_v3');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
DO $authorized$
DECLARE r jsonb;
BEGIN
  r:=public.admin_set_order_status_audited(
    '00000000-0000-4000-8000-00000000a001','onaylandi');
  IF r->>'error_code'<>'UNTRUSTED_ORDER_SOURCE' THEN
    RAISE EXCEPTION 'CI_UNTRUSTED_LEGACY_ORDER_CHANGED %',r;
  END IF;
  r:=public.admin_set_order_status_audited(
    '00000000-0000-4000-8000-00000000a002','onaylandi');
  IF r->>'error_code'<>'LEGACY_ORDER_RECONCILIATION_REQUIRED' THEN
    RAISE EXCEPTION 'CI_NULL_LEGACY_ORDER_CHANGED %',r;
  END IF;
  r:=public.admin_set_order_status_audited(
    current_setting('cd.ci_admin_aal2_order')::uuid,'onaylandi');
  IF r->>'ok'<>'true' OR r->>'reserved'<>'true' THEN
    RAISE EXCEPTION 'CI_VERIFIED_ADMIN_COULD_NOT_CONFIRM %',r;
  END IF;
  r:=public.admin_set_order_status_audited(
    current_setting('cd.ci_admin_aal2_order')::uuid,'iptal');
  IF r->>'ok'<>'true' OR r->>'reserved'<>'false' THEN
    RAISE EXCEPTION 'CI_VERIFIED_ADMIN_COULD_NOT_CANCEL %',r;
  END IF;
END $authorized$;
RESET ROLE;

DO $final$
BEGIN
  IF (SELECT stok FROM public.products WHERE id=5)<>1 THEN
    RAISE EXCEPTION 'CI_ADMIN_AAL2_FINAL_STOCK_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM cadde_internal.admin_order_status_audit
      WHERE order_id IN (
        '00000000-0000-4000-8000-00000000a001',
        '00000000-0000-4000-8000-00000000a002',
        current_setting('cd.ci_admin_aal2_order')::uuid))<>4 THEN
    RAISE EXCEPTION 'CI_ADMIN_AAL2_AUDIT_COUNT_MISMATCH';
  END IF;
  IF (SELECT durum FROM public.orders
      WHERE id=current_setting('cd.ci_admin_aal2_order')::uuid)<>'iptal' THEN
    RAISE EXCEPTION 'CI_ADMIN_AAL2_FINAL_STATUS_MISMATCH';
  END IF;
END $final$;

SELECT 'ADMIN_AAL2_ADVERSARIAL_ROLLBACK_PASS' AS ci_result;
ROLLBACK;
