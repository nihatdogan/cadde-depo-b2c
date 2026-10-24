-- PREVIEW ONLY: additive v3 canary. NEVER apply to production.
-- Run ONLY against Supabase project emnacsavgsjkrocpngcj.
-- Existing v2 RPC, audit records, quota records and orders are untouched.
DO $preflight$
BEGIN
 IF to_regprocedure('public.create_whatsapp_request_protected_v2(jsonb,numeric,text,text,uuid)') IS NULL
 OR to_regclass('cadde_internal.whatsapp_request_dedup') IS NULL
 OR to_regclass('cadde_internal.admin_order_status_audit') IS NULL
 THEN RAISE EXCEPTION 'PREVIEW_V2_BASELINE_REQUIRED'; END IF;
 IF to_regclass('cadde_internal.trusted_checkout_orders') IS NOT NULL
 OR to_regprocedure('public.create_whatsapp_request_protected_v3(jsonb,numeric,text,text,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'V3_ALREADY_INSTALLED'; END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS cadde_internal.trusted_checkout_orders (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source = 'protected_checkout_v3'),
  attested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS trusted_checkout_orders_attested_at_idx
  ON cadde_internal.trusted_checkout_orders (attested_at);
ALTER TABLE cadde_internal.trusted_checkout_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cadde_internal.trusted_checkout_orders
  FROM PUBLIC,anon,authenticated,service_role;
-- There are intentionally NO anon/authenticated RLS policies.
-- Keep cadde_internal outside exposed API schemas.
COMMENT ON TABLE cadde_internal.trusted_checkout_orders IS
  'Trusted internal order origin: inserted transactionally ONLY by privileged protected checkout. Not a client-controlled order flag.';

CREATE OR REPLACE FUNCTION public.create_whatsapp_request_protected_v3(p_product_ids jsonb, p_expected_total numeric, p_visitor_hash text, p_rate_hash text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sig jsonb; prior record; r jsonb;
  inserted_count integer; w integer; cap integer; n integer; boundary timestamptz;
BEGIN
  IF p_visitor_hash IS NULL OR p_rate_hash IS NULL
     OR p_visitor_hash !~ '^[0-9a-f]{64}$'
     OR p_rate_hash !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_IDENTITY' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_product_ids) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_product_ids) NOT BETWEEN 1 AND 12
    OR p_expected_total IS NULL OR p_expected_total<=0 OR p_expected_total>1000000000
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_product_ids) x(val)
      WHERE jsonb_typeof(x.val) IS DISTINCT FROM 'number'
      OR x.val::text !~ '^[1-9][0-9]{0,15}$') THEN
    RAISE EXCEPTION 'INVALID_CART' USING ERRCODE='22023';
  END IF;
  SELECT jsonb_build_object('items',jsonb_agg(jsonb_build_array(id,qty) ORDER BY id),
    'total',p_expected_total) INTO sig
  FROM (SELECT (x.val::text)::bigint id,count(*)::integer qty
        FROM jsonb_array_elements(p_product_ids) x(val)
        GROUP BY (x.val::text)::bigint) grouped;

  INSERT INTO cadde_internal.whatsapp_request_dedup
    (visitor_hash,idempotency_key,request_signature)
  VALUES(p_visitor_hash,p_idempotency_key,sig) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  IF inserted_count=0 THEN
    SELECT d.* INTO prior FROM cadde_internal.whatsapp_request_dedup d
      WHERE d.visitor_hash=p_visitor_hash AND d.idempotency_key=p_idempotency_key FOR UPDATE;
    IF NOT FOUND OR prior.request_signature IS DISTINCT FROM sig
      THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
    IF prior.created_at<now()-interval '15 minutes'
      THEN RAISE EXCEPTION 'IDEMPOTENCY_EXPIRED' USING ERRCODE='P0001'; END IF;
    IF prior.response IS NULL OR NOT EXISTS
      (SELECT 1 FROM public.orders o WHERE o.id=prior.request_id
       AND o.durum='whatsapp_bekliyor' AND o.stok_rezerve IS FALSE)
      THEN RAISE EXCEPTION 'REQUEST_ALREADY_HANDLED' USING ERRCODE='P0001'; END IF;
    IF NOT EXISTS (SELECT 1 FROM cadde_internal.trusted_checkout_orders t
      WHERE t.order_id=prior.request_id AND t.source='protected_checkout_v3') THEN
      RAISE EXCEPTION 'UNTRUSTED_ORDER_SOURCE' USING ERRCODE='23514';
    END IF;
    RETURN prior.response||jsonb_build_object('reused',true);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_visitor_hash||':'||sig::text,4216));
  SELECT d.* INTO prior FROM cadde_internal.whatsapp_request_dedup d
    JOIN public.orders o ON o.id=d.request_id
    WHERE d.visitor_hash=p_visitor_hash AND d.request_signature=sig
      AND d.idempotency_key<>p_idempotency_key
      AND d.response IS NOT NULL AND o.created_at>=now()-interval '15 minutes'
    ORDER BY o.created_at ASC LIMIT 1;
  IF FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.id=prior.request_id
      AND o.durum='whatsapp_bekliyor' AND o.stok_rezerve IS FALSE)
      THEN RAISE EXCEPTION 'REQUEST_ALREADY_HANDLED' USING ERRCODE='P0001'; END IF;
    IF NOT EXISTS (SELECT 1 FROM cadde_internal.trusted_checkout_orders t
      WHERE t.order_id=prior.request_id AND t.source='protected_checkout_v3') THEN
      RAISE EXCEPTION 'UNTRUSTED_ORDER_SOURCE' USING ERRCODE='23514';
    END IF;
    UPDATE cadde_internal.whatsapp_request_dedup
      SET request_id=prior.request_id,response=prior.response
      WHERE visitor_hash=p_visitor_hash AND idempotency_key=p_idempotency_key;
    RETURN prior.response||jsonb_build_object('reused',true);
  END IF;
  FOR w,cap IN SELECT * FROM (VALUES(900,5),(86400,20)) limits(seconds,ceiling)
    ORDER BY seconds LOOP
    boundary:=to_timestamp(floor(extract(epoch FROM now())/w)*w);
    INSERT INTO cadde_internal.whatsapp_request_quota
      (visitor_hash,window_seconds,window_start,requests)
    VALUES(p_rate_hash,w,boundary,1)
    ON CONFLICT(visitor_hash,window_seconds,window_start)
    DO UPDATE SET requests=cadde_internal.whatsapp_request_quota.requests+1
    RETURNING requests INTO n;
    IF n>cap THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='P0001'; END IF;
  END LOOP;
  r:=public.create_whatsapp_request(p_product_ids,p_expected_total);
  IF r IS NULL OR r->>'request_id' IS NULL THEN
    RAISE EXCEPTION 'INVALID_CORE_RESPONSE' USING ERRCODE='23514';
  END IF;
  -- Order + items + attestation + dedup commit or roll back atomically.
  INSERT INTO cadde_internal.trusted_checkout_orders(order_id,source)
    VALUES ((r->>'request_id')::uuid,'protected_checkout_v3');
  UPDATE cadde_internal.whatsapp_request_dedup
    SET request_id=(r->>'request_id')::uuid,response=r
    WHERE visitor_hash=p_visitor_hash AND idempotency_key=p_idempotency_key;
  RETURN r||jsonb_build_object('reused',false);
END
$function$
;

REVOKE ALL ON FUNCTION public.create_whatsapp_request_protected_v3(jsonb,numeric,text,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_request_protected_v3(jsonb,numeric,text,text,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_order_status_v3(p_order_id uuid, p_new_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  old_order public.orders%ROWTYPE;
  item record;
  product_row record;
  updated_rows integer;
  summed_total numeric := 0;
  item_count integer := 0;
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR coalesce((SELECT auth.jwt()) -> 'app_metadata' ->> 'role','') <> 'admin' THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_order_id IS NULL OR p_new_status IS NULL OR p_new_status NOT IN
    ('whatsapp_bekliyor','onaylandi','kargolandi','teslim','iptal') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='22023';
  END IF;
  SELECT * INTO old_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  -- Fail closed for historical orders whose stock accounting is not reconciled.
  -- Must be BEFORE unchanged/status transitions to prevent hiding unverified history.
  -- Reject any legacy/direct-INSERT order lacking trusted server provenance.
  IF NOT EXISTS (
    SELECT 1 FROM cadde_internal.trusted_checkout_orders t
    WHERE t.order_id=p_order_id AND t.source='protected_checkout_v3'
  ) THEN
    RAISE EXCEPTION 'UNTRUSTED_ORDER_SOURCE' USING ERRCODE='23514';
  END IF;
  IF old_order.stok_rezerve IS NULL THEN
    RAISE EXCEPTION 'LEGACY_ORDER_RECONCILIATION_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF old_order.durum=p_new_status THEN
    RETURN jsonb_build_object('id',old_order.id,'status',old_order.durum,
        'reserved',old_order.stok_rezerve,'unchanged',true);
  END IF;
  IF NOT (
    (old_order.durum='whatsapp_bekliyor' AND p_new_status IN ('onaylandi','iptal'))
    OR (old_order.durum='onaylandi' AND p_new_status IN ('kargolandi','iptal'))
    OR (old_order.durum='kargolandi' AND p_new_status='teslim')
  ) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='22023';
  END IF;

  IF p_new_status='onaylandi' OR (old_order.durum='onaylandi' AND p_new_status='iptal') THEN
    SELECT count(*),coalesce(sum(fiyat*adet),0) INTO item_count,summed_total
    FROM public.order_items WHERE order_id=p_order_id;
    IF item_count=0 OR EXISTS (
      SELECT 1 FROM public.order_items WHERE order_id=p_order_id
      AND (product_id IS NULL OR adet<=0 OR fiyat<=0)
    ) THEN RAISE EXCEPTION 'INVALID_ORDER_ITEMS' USING ERRCODE='23514'; END IF;
    IF summed_total<>old_order.toplam THEN
      RAISE EXCEPTION 'ORDER_TOTAL_MISMATCH' USING ERRCODE='23514';
    END IF;
    IF p_new_status='onaylandi' AND old_order.stok_rezerve THEN
      RAISE EXCEPTION 'ALREADY_RESERVED' USING ERRCODE='23514';
    END IF;
    IF p_new_status='iptal' AND NOT old_order.stok_rezerve THEN
      RAISE EXCEPTION 'LEGACY_ORDER_RECONCILIATION_REQUIRED' USING ERRCODE='23514';
    END IF;

    FOR item IN
      SELECT product_id, sum(adet)::integer AS requested,
             min(fiyat) AS min_price, max(fiyat) AS max_price
      FROM public.order_items WHERE order_id=p_order_id
      GROUP BY product_id ORDER BY product_id
    LOOP
      SELECT p.id,p.ad,p.aktif,p.stok,p.max_stok,p.outlet_fiyat
        INTO product_row FROM public.products p
        WHERE p.id=item.product_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %',item.product_id USING ERRCODE='P0002';
      END IF;
      IF p_new_status='onaylandi' THEN
        IF product_row.aktif IS DISTINCT FROM true OR product_row.stok<item.requested THEN
          RAISE EXCEPTION 'INSUFFICIENT_ACTIVE_STOCK: %',item.product_id USING ERRCODE='P0001';
        END IF;
        IF item.min_price<>item.max_price OR item.min_price<>product_row.outlet_fiyat THEN
          RAISE EXCEPTION 'PRICE_RECONFIRMATION_REQUIRED: %',item.product_id USING ERRCODE='P0001';
        END IF;
        UPDATE public.products SET stok=stok-item.requested
        WHERE id=item.product_id AND aktif=true AND stok>=item.requested;
      ELSE
        IF product_row.stok+item.requested>product_row.max_stok THEN
          RAISE EXCEPTION 'RESTOCK_EXCEEDS_CAPACITY: %',item.product_id USING ERRCODE='23514';
        END IF;
        UPDATE public.products SET stok=stok+item.requested
        WHERE id=item.product_id AND stok+item.requested<=max_stok;
      END IF;
      GET DIAGNOSTICS updated_rows=ROW_COUNT;
      IF updated_rows<>1 THEN RAISE EXCEPTION 'CONCURRENT_STOCK_UPDATE' USING ERRCODE='40001'; END IF;
    END LOOP;
  END IF;

  UPDATE public.orders SET durum=p_new_status,
    stok_rezerve=CASE WHEN p_new_status='onaylandi' THEN true
                       WHEN p_new_status='iptal' THEN false
                       ELSE stok_rezerve END
  WHERE id=p_order_id;

  RETURN jsonb_build_object('id',p_order_id,'status',p_new_status,
    'reserved',CASE WHEN p_new_status='onaylandi' THEN true
                    WHEN p_new_status='iptal' THEN false ELSE old_order.stok_rezerve END,
    'unchanged',false);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_set_order_status_audited_v3(
  p_order_id uuid,
  p_new_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  previous_order public.orders%ROWTYPE;
  current_order public.orders%ROWTYPE;
  result jsonb;
  error_message text;
  error_state text;
  safe_error text;
  actor uuid;
BEGIN
  actor := (SELECT auth.uid());
  IF actor IS NULL
     OR coalesce((SELECT auth.jwt())->'app_metadata'->>'role','')<>'admin' THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
  -- A signed Supabase Auth JWT must attest second-factor assurance.
  -- An admin flag alone does not authorize inventory mutations.
  IF coalesce((SELECT auth.jwt())->>'aal','') <> 'aal2' THEN
    RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE='42501';
  END IF;

  IF p_order_id IS NULL OR p_new_status IS NULL OR p_new_status NOT IN
     ('whatsapp_bekliyor','onaylandi','kargolandi','teslim','iptal') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='22023';
  END IF;

  -- The order lock serializes status changes and stabilizes the audit's before state.
  SELECT * INTO previous_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO cadde_internal.admin_order_status_audit
      (order_id,actor_uid,requested_status,outcome,error_code,error_sqlstate)
    VALUES (p_order_id,actor,p_new_status,'rejected','ORDER_NOT_FOUND','P0002');
    RETURN jsonb_build_object('ok',false,'id',p_order_id,'error_code','ORDER_NOT_FOUND');
  END IF;

  -- Exception block is an internal savepoint: undo an attempted status change,
  -- but persist its rejection in the enclosing transaction.
  BEGIN
    result:=public.admin_set_order_status_v3(p_order_id,p_new_status);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT,error_state=RETURNED_SQLSTATE;
    safe_error:=CASE
      WHEN error_message LIKE 'UNTRUSTED_ORDER_SOURCE%' THEN 'UNTRUSTED_ORDER_SOURCE'
      WHEN error_message LIKE 'INSUFFICIENT_ACTIVE_STOCK%' THEN 'INSUFFICIENT_ACTIVE_STOCK'
      WHEN error_message LIKE 'PRICE_RECONFIRMATION_REQUIRED%' THEN 'PRICE_RECONFIRMATION_REQUIRED'
      WHEN error_message LIKE 'INVALID_TRANSITION%' THEN 'INVALID_TRANSITION'
      WHEN error_message LIKE 'INVALID_ORDER_ITEMS%' THEN 'INVALID_ORDER_ITEMS'
      WHEN error_message LIKE 'ORDER_TOTAL_MISMATCH%' THEN 'ORDER_TOTAL_MISMATCH'
      WHEN error_message LIKE 'ALREADY_RESERVED%' THEN 'ALREADY_RESERVED'
      WHEN error_message LIKE 'LEGACY_ORDER_RECONCILIATION_REQUIRED%' THEN 'LEGACY_ORDER_RECONCILIATION_REQUIRED'
      WHEN error_message LIKE 'RESTOCK_EXCEEDS_CAPACITY%' THEN 'RESTOCK_EXCEEDS_CAPACITY'
      WHEN error_message LIKE 'PRODUCT_NOT_FOUND%' THEN 'PRODUCT_NOT_FOUND'
      WHEN error_message LIKE 'CONCURRENT_STOCK_UPDATE%' THEN 'CONCURRENT_STOCK_UPDATE'
      ELSE 'STATUS_CHANGE_FAILED'
    END;
    INSERT INTO cadde_internal.admin_order_status_audit
      (order_id,actor_uid,requested_status,previous_status,resulting_status,
       outcome,error_code,error_sqlstate,reserved_before,reserved_after)
    VALUES (p_order_id,actor,p_new_status,previous_order.durum,previous_order.durum,
      'rejected',safe_error,error_state,previous_order.stok_rezerve,previous_order.stok_rezerve);
    RETURN jsonb_build_object('ok',false,'id',p_order_id,'status',previous_order.durum,
      'reserved',previous_order.stok_rezerve,'error_code',safe_error);
  END;

  SELECT * INTO current_order FROM public.orders WHERE id=p_order_id;
  INSERT INTO cadde_internal.admin_order_status_audit
    (order_id,actor_uid,requested_status,previous_status,resulting_status,
     outcome,reserved_before,reserved_after)
  VALUES (p_order_id,actor,p_new_status,previous_order.durum,current_order.durum,
    CASE WHEN result->>'unchanged'='true' THEN 'unchanged' ELSE 'accepted' END,
    previous_order.stok_rezerve,current_order.stok_rezerve);
  RETURN result||jsonb_build_object('ok',true);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_set_order_status_audited_v3(uuid,text)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_order_status_audited_v3(uuid,text)
  TO authenticated;

-- Do not grant public access to core. Only audited RPC may be invoked by auth users.
REVOKE ALL ON FUNCTION public.admin_set_order_status_v3(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
-- Candidate does not migrate older data or make production checkout work.
