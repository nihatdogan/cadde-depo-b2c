\set ON_ERROR_STOP on
-- CADDE DEPO / STEP 34 / ISOLATED POSTGRESQL 16 ONLY / SYNTHETIC DATA.
-- Runs on disposable GitHub Actions DB. Never execute on Preview or Production.
-- All inserted rows and classification events in this test ROLLBACK.
-- JWTs below are unsigned synthetic CI claims, NOT real Supabase MFA sessions.
BEGIN;

INSERT INTO public.products(id,ad,aktif,stok,max_stok,outlet_fiyat)
VALUES (29,'CI SYNTHETIC CORNER SOFA',true,5,5,35000);
INSERT INTO public.orders(id,toplam,durum,kanal,stok_rezerve,created_at)
VALUES
 ('00000000-0000-4000-8000-00000000b001',35000,'whatsapp_bekliyor','whatsapp',NULL,'2026-10-07 20:22+00'),
 ('00000000-0000-4000-8000-00000000b002',35000,'whatsapp_bekliyor','whatsapp',NULL,'2026-10-07 20:24+00'),
 ('00000000-0000-4000-8000-00000000b003',35000,'whatsapp_bekliyor','whatsapp',NULL,'2026-10-07 20:24+00'),
 ('00000000-0000-4000-8000-00000000b004',35000,'teslim','whatsapp',NULL,'2026-10-07 20:25+00');
INSERT INTO public.order_items(order_id,product_id,ad,fiyat,adet)
SELECT id,29,'CI SYNTHETIC CORNER SOFA',35000,1
FROM public.orders
WHERE id IN (
 '00000000-0000-4000-8000-00000000b001',
 '00000000-0000-4000-8000-00000000b002',
 '00000000-0000-4000-8000-00000000b003',
 '00000000-0000-4000-8000-00000000b004');

-- Table is in private schema with no direct table/sequence grants.
DO $grants$
BEGIN
 IF has_schema_privilege('anon','cadde_internal','USAGE')
    OR has_schema_privilege('authenticated','cadde_internal','USAGE')
    OR has_table_privilege('anon','cadde_internal.order_classification_events','SELECT')
    OR has_table_privilege('authenticated','cadde_internal.order_classification_events','SELECT')
    OR has_table_privilege('authenticated','cadde_internal.order_classification_events','INSERT')
    OR has_table_privilege('service_role','cadde_internal.order_classification_events','INSERT')
    OR has_function_privilege('anon','public.admin_classify_order_v1(uuid,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.admin_order_classification_summary_v1()','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.admin_classify_order_v1(uuid,text,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.admin_order_classification_summary_v1()','EXECUTE')
 THEN RAISE EXCEPTION 'CI_CLASSIFICATION_PRIVILEGE_LEAK'; END IF;
 IF (SELECT relrowsecurity FROM pg_class
     WHERE oid='cadde_internal.order_classification_events'::regclass) IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'CI_CLASSIFICATION_RLS_MISSING';
 END IF;
END $grants$;

-- Authenticated role without MFA (AAL1), including self-supplied user_metadata,
-- MUST NOT classify or view the reporting summary.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1","app_metadata":{"role":"admin"}}',true);
DO $aal1$
DECLARE err text; denied int:=0;
BEGIN
 BEGIN
   PERFORM public.admin_classify_order_v1(
     '00000000-0000-4000-8000-00000000b001','test',
     'CI operator verified that no sale occurred');
 EXCEPTION WHEN insufficient_privilege THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err='MFA_REQUIRED' THEN denied:=denied+1; END IF;
 END;
 BEGIN
   PERFORM public.admin_order_classification_summary_v1();
 EXCEPTION WHEN insufficient_privilege THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err='MFA_REQUIRED' THEN denied:=denied+1; END IF;
 END;
 IF denied<>2 THEN RAISE EXCEPTION 'CI_AAL1_NOT_REJECTED: %',denied; END IF;
END $aal1$;

-- AAL2 without server-authoritative app_metadata admin role is insufficient.
SELECT set_config('request.jwt.claims',
 '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2","app_metadata":{"role":"buyer"},"user_metadata":{"role":"admin"}}',true);
DO $nonadmin$
DECLARE err text; denied int:=0;
BEGIN
 BEGIN
   PERFORM public.admin_classify_order_v1(
     '00000000-0000-4000-8000-00000000b001','test',
     'CI operator verified that no sale occurred');
 EXCEPTION WHEN insufficient_privilege THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err='ADMIN_REQUIRED' THEN denied:=denied+1; END IF;
 END;
 BEGIN
   PERFORM public.admin_order_classification_summary_v1();
 EXCEPTION WHEN insufficient_privilege THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err='ADMIN_REQUIRED' THEN denied:=denied+1; END IF;
 END;
 IF denied<>2 THEN RAISE EXCEPTION 'CI_NONADMIN_NOT_REJECTED: %',denied; END IF;
END $nonadmin$;

-- Missing identity cannot operate, even with AAL2/admin claim.
SELECT set_config('request.jwt.claims',
 '{"role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
DO $noid$
DECLARE err text;
BEGIN
 BEGIN
   PERFORM public.admin_classify_order_v1(
     '00000000-0000-4000-8000-00000000b001','test',
     'CI operator verified that no sale occurred');
   RAISE EXCEPTION 'CI_MISSING_ID_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err<>'ADMIN_REQUIRED' THEN RAISE EXCEPTION 'CI_MISSING_ID_WRONG_ERROR: %',err; END IF;
 END;
END $noid$;

-- Authenticated AAL2 admin may classify; invalid requests must be rejected.
SELECT set_config('request.jwt.claims',
 '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
DO $classify$
DECLARE
 i int; r jsonb; summary jsonb; rejected int:=0;
BEGIN
 BEGIN
   PERFORM public.admin_classify_order_v1(
     '00000000-0000-4000-8000-00000000b001','test','too short');
 EXCEPTION WHEN invalid_parameter_value THEN rejected:=rejected+1; END;
 BEGIN
   PERFORM public.admin_classify_order_v1(
     '00000000-0000-4000-8000-00000000b001','unknown',
     'CI operator verified that no sale occurred');
 EXCEPTION WHEN invalid_parameter_value THEN rejected:=rejected+1; END;
 BEGIN
   PERFORM public.admin_classify_order_v1(
     '00000000-0000-4000-8000-00000000b099','test',
     'CI operator verified that no sale occurred');
 EXCEPTION WHEN no_data_found THEN rejected:=rejected+1; END;
 IF rejected<>3 THEN RAISE EXCEPTION 'CI_INVALID_INPUT_ACCEPTED %',rejected; END IF;

 FOR i IN 1..4 LOOP
   r:=public.admin_classify_order_v1(
    ('00000000-0000-4000-8000-00000000b00'||i::text)::uuid,
    'test','CI operator attested no customer sale or dispatch');
   IF r->>'ok'<>'true' OR r->>'unchanged'<>'false' THEN
     RAISE EXCEPTION 'CI_CLASSIFICATION_FAILED: %',r;
   END IF;
 END LOOP;
 summary:=public.admin_order_classification_summary_v1();
 IF (summary->>'total_order_rows')::int<>6
    OR (summary->>'test_order_rows')::int<>4
    OR (summary->>'business_order_rows')::int<>0
    OR (summary->>'unclassified_order_rows')::int<>2
    OR (summary->>'test_pending_excluded')::int<>3
    OR (summary->>'test_delivered_record_amount_excluded')::numeric<>35000
    OR (summary->>'business_delivered_record_amount_NOT_REVENUE')::numeric<>0
    OR (summary->>'unclassified_delivered_record_amount_NOT_REVENUE')::numeric<>33000
 THEN RAISE EXCEPTION 'CI_CLASSIFICATION_REPORT_MISMATCH %',summary; END IF;

 r:=public.admin_classify_order_v1(
   '00000000-0000-4000-8000-00000000b001','test',
   'CI repeated classification must not add an event');
 IF r->>'unchanged'<>'true' THEN RAISE EXCEPTION 'CI_REPEAT_NOT_IDEMPOTENT'; END IF;
END $classify$;
RESET ROLE;

-- Direct writes from API roles remain blocked; no personal data is exposed.
SET LOCAL ROLE authenticated;
DO $direct$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
   INSERT INTO cadde_internal.order_classification_events
   (order_id,classification,actor_uid,reason,order_status_snapshot)
   VALUES ('00000000-0000-4000-8000-00000000b001','business',
     '11111111-1111-4111-8111-111111111111',
     'Untrusted direct write without audit route','teslim');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'CI_DIRECT_INSERT_WAS_PERMITTED'; END IF;
END $direct$;
RESET ROLE;

-- Owner-level UPDATE and DELETE must trigger immutable audit protection.
DO $immutable$
DECLARE rejected int:=0; err text;
BEGIN
 BEGIN
   UPDATE cadde_internal.order_classification_events SET classification='business'
   WHERE order_id='00000000-0000-4000-8000-00000000b001';
 EXCEPTION WHEN insufficient_privilege THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err='CLASSIFICATION_AUDIT_IMMUTABLE' THEN rejected:=rejected+1; END IF;
 END;
 BEGIN
   DELETE FROM cadde_internal.order_classification_events
   WHERE order_id='00000000-0000-4000-8000-00000000b001';
 EXCEPTION WHEN insufficient_privilege THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err='CLASSIFICATION_AUDIT_IMMUTABLE' THEN rejected:=rejected+1; END IF;
 END;
 IF rejected<>2 THEN RAISE EXCEPTION 'CI_AUDIT_WAS_MUTABLE %',rejected; END IF;
END $immutable$;

-- A correction creates new history, never replaces earlier evidence.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
DO $correction$
DECLARE r jsonb; summary jsonb;
BEGIN
 r:=public.admin_classify_order_v1(
   '00000000-0000-4000-8000-00000000b001','business',
   'CI deliberately tests audited reclassification correction');
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'CI_CORRECTION_FAILED'; END IF;
 summary:=public.admin_order_classification_summary_v1();
 IF (summary->>'business_order_rows')::int<>1
 OR (summary->>'test_order_rows')::int<>3
 OR (summary->>'business_pending')::int<>1
 THEN RAISE EXCEPTION 'CI_CORRECTION_NOT_VISIBLE %',summary; END IF;
 r:=public.admin_classify_order_v1(
   '00000000-0000-4000-8000-00000000b001','test',
   'CI correction reversal restores the operator attestation');
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'CI_CORRECTION_REVERSAL_FAILED'; END IF;
END $correction$;
RESET ROLE;

DO $final$
DECLARE events_count int;
BEGIN
 SELECT count(*) INTO events_count FROM cadde_internal.order_classification_events;
 IF events_count<>6 THEN RAISE EXCEPTION 'CI_APPEND_ONLY_HISTORY_WRONG %',events_count; END IF;
 IF EXISTS (
   SELECT 1 FROM cadde_internal.order_classification_events
   WHERE actor_uid<>'11111111-1111-4111-8111-111111111111'::uuid
 ) THEN RAISE EXCEPTION 'CI_AUDIT_ACTOR_INCORRECT'; END IF;
 IF (SELECT stok FROM public.products WHERE id=29)<>5 OR
    (SELECT max_stok FROM public.products WHERE id=29)<>5 THEN
   RAISE EXCEPTION 'CI_STOCK_MUTATED_BY_CLASSIFICATION';
 END IF;
 IF (SELECT count(*) FROM public.orders WHERE id IN (
    '00000000-0000-4000-8000-00000000b001',
    '00000000-0000-4000-8000-00000000b002',
    '00000000-0000-4000-8000-00000000b003') AND durum='whatsapp_bekliyor')<>3 OR
    (SELECT durum FROM public.orders WHERE id='00000000-0000-4000-8000-00000000b004')<>'teslim' THEN
   RAISE EXCEPTION 'CI_ORIGINAL_ORDER_STATUSES_MUTATED';
 END IF;
 IF (SELECT count(*) FROM cadde_internal.order_classification_events e
   WHERE e.order_id='00000000-0000-4000-8000-00000000b001')<>3 THEN
   RAISE EXCEPTION 'CI_CLASSIFICATION_CORRECTION_HISTORY_LOST';
 END IF;
END $final$;
SELECT 'ORDER_CLASSIFICATION_AAL2_APPEND_ONLY_REPORT_ROLLBACK_PASS' AS ci_result;
ROLLBACK;
