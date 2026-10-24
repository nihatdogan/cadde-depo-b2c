-- CADDE DEPO — PRODUCTION RPC v3 CANDIDATE / REVIEW ONLY / NO-GO
-- NOT DEPLOYED. Dependency: trusted_checkout_orders table and protected
-- v2-style dedup/quota/core tables/RPC installed on an isolated clone.
-- This is a service-role-only SQL entrypoint; no client may invoke it.
-- Preserve legacy pending orders: replays of untrusted prior requests are rejected.
-- IMPORTANT: v2 service-role privilege must be revoked only after verified cutover.
-- SECURITY REVIEW REQUIRED: SECURITY DEFINER, role grants, search_path,
-- privileged caller access, full concurrency and actual HTTP checkout.
BEGIN;
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
  IF p_visitor_hash !~ '^[0-9a-f]{64}$' OR p_rate_hash !~ '^[0-9a-f]{64}$'
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
COMMIT;
