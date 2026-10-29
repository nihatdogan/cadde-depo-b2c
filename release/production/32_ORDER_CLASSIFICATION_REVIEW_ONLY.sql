-- CADDE DEPO / Step 33 / 2026-10-28 / REVIEW ONLY: NOT APPLIED.
-- Explicit release approval, restore drill and CI gate required before Production.
-- No automatic backfill and no edits to orders, order_items or products.
-- Dependency: cadde_internal private schema from reviewed expansion.
-- Business fact: operator attested 4 historical orders were tests; physical
-- saleable SKU #29 = 5 and production recorded stock = 5. These assertions
-- have NOT been independently validated as payment/dispatch ledger records.
-- ATTENTION: order.total or status "teslim" must NEVER be labeled realized
-- revenue or cash; collections, returns, taxes and shipping need separate data.
BEGIN;

CREATE TABLE IF NOT EXISTS cadde_internal.order_classification_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
 classification text NOT NULL CHECK (classification IN ('test','business')),
 actor_uid uuid NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
 order_status_snapshot text NOT NULL,
 classified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS order_classification_events_order_latest_idx
 ON cadde_internal.order_classification_events(order_id,event_id DESC);
ALTER TABLE cadde_internal.order_classification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cadde_internal.order_classification_events FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE cadde_internal.order_classification_events_event_id_seq
 FROM PUBLIC,anon,authenticated,service_role;

-- Append-only evidence. Privileged releases can add a correcting event,
-- never rewrite/remove an earlier classification. Reversal needs its own reason.
CREATE OR REPLACE FUNCTION cadde_internal.order_classification_immutable_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $trigger$
BEGIN
 RAISE EXCEPTION 'CLASSIFICATION_AUDIT_IMMUTABLE' USING ERRCODE='42501';
END
$trigger$;
DROP TRIGGER IF EXISTS order_classification_immutable_v1
 ON cadde_internal.order_classification_events;
CREATE TRIGGER order_classification_immutable_v1
 BEFORE UPDATE OR DELETE ON cadde_internal.order_classification_events
 FOR EACH ROW EXECUTE FUNCTION cadde_internal.order_classification_immutable_v1();
REVOKE ALL ON FUNCTION cadde_internal.order_classification_immutable_v1()
 FROM PUBLIC,anon,authenticated,service_role;

-- This is the ONLY client-callable write route. The private table has no
-- direct grants. The signed Auth JWT must attest admin app_metadata + AAL2.
-- This function is proposed for review and isolated CI only, not live use.
CREATE OR REPLACE FUNCTION public.admin_classify_order_v1(
 p_order_id uuid,p_classification text,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
 v_actor uuid;
 v_order_status text;
 v_prior text;
 v_event_id bigint;
BEGIN
 v_actor:=(SELECT auth.uid());
 IF v_actor IS NULL OR
   COALESCE((SELECT auth.jwt())->'app_metadata'->>'role','')<>'admin' THEN
   RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF COALESCE((SELECT auth.jwt())->>'aal','')<>'aal2' THEN
   RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_order_id IS NULL OR p_classification IS NULL
     OR p_classification NOT IN ('test','business')
     OR p_reason IS NULL
     OR length(btrim(p_reason)) NOT BETWEEN 20 AND 500 THEN
   RAISE EXCEPTION 'INVALID_CLASSIFICATION_INPUT' USING ERRCODE='22023';
 END IF;
 -- Serialize classification against the order's state transitions.
 SELECT o.durum INTO v_order_status FROM public.orders o
 WHERE o.id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT e.classification INTO v_prior
 FROM cadde_internal.order_classification_events e
 WHERE e.order_id=p_order_id ORDER BY e.event_id DESC LIMIT 1;
 IF v_prior IS NOT DISTINCT FROM p_classification THEN
   RETURN jsonb_build_object('ok',true,'order_id',p_order_id,
       'classification',p_classification,'unchanged',true);
 END IF;
 INSERT INTO cadde_internal.order_classification_events
 (order_id,classification,actor_uid,reason,order_status_snapshot)
 VALUES (p_order_id,p_classification,v_actor,btrim(p_reason),v_order_status)
 RETURNING event_id INTO v_event_id;
 RETURN jsonb_build_object('ok',true,'order_id',p_order_id,
     'classification',p_classification,'event_id',v_event_id,'unchanged',false);
END
$function$;
REVOKE ALL ON FUNCTION public.admin_classify_order_v1(uuid,text,text)
 FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_classify_order_v1(uuid,text,text)
 TO authenticated;

-- AAL2-only operational breakdown. "Business" does NOT prove payment.
-- Unclassified orders are reported separately and NEVER silently counted as real.
CREATE OR REPLACE FUNCTION public.admin_order_classification_summary_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
 v_actor uuid;
 v_result jsonb;
BEGIN
 v_actor:=(SELECT auth.uid());
 IF v_actor IS NULL OR
   COALESCE((SELECT auth.jwt())->'app_metadata'->>'role','')<>'admin' THEN
   RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF COALESCE((SELECT auth.jwt())->>'aal','')<>'aal2' THEN
   RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE='42501';
 END IF;
 WITH order_flags AS (
   SELECT o.id,o.durum,o.toplam,
     COALESCE(
       (SELECT e.classification
        FROM cadde_internal.order_classification_events e
        WHERE e.order_id=o.id ORDER BY e.event_id DESC LIMIT 1),
       'unclassified') AS classification
   FROM public.orders o
 )
 SELECT jsonb_build_object(
   'total_order_rows',count(*),
   'test_order_rows',count(*) FILTER (WHERE classification='test'),
   'business_order_rows',count(*) FILTER (WHERE classification='business'),
   'unclassified_order_rows',count(*) FILTER (WHERE classification='unclassified'),
   'test_pending_excluded',count(*) FILTER
      (WHERE classification='test' AND durum='whatsapp_bekliyor'),
   'business_pending',count(*) FILTER
      (WHERE classification='business' AND durum='whatsapp_bekliyor'),
   'unclassified_pending',count(*) FILTER
      (WHERE classification='unclassified' AND durum='whatsapp_bekliyor'),
   'test_delivered_record_amount_excluded',
      COALESCE(sum(toplam) FILTER
        (WHERE classification='test' AND durum='teslim'),0),
   'business_delivered_record_amount_NOT_REVENUE',
      COALESCE(sum(toplam) FILTER
        (WHERE classification='business' AND durum='teslim'),0),
   'unclassified_delivered_record_amount_NOT_REVENUE',
      COALESCE(sum(toplam) FILTER
        (WHERE classification='unclassified' AND durum='teslim'),0)
 ) INTO v_result FROM order_flags;
 RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION public.admin_order_classification_summary_v1()
 FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_order_classification_summary_v1()
 TO authenticated;

COMMIT;
-- STOP. Never automatically classify the 4 historical orders on deployment.
-- Four verified UUIDs in 31_LEGACY_TEST_ORDER_RECONCILIATION_READ_ONLY...
-- require AAL2 authorized human action & individual classification reason.
-- UI change to replace existing misleading "Ciro" KPI is a separate gate.
-- Do not execute this REVIEW-ONLY file on Production or Preview.
