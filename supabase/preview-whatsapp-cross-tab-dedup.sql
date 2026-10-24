-- CADDE DEPO — PREVIEW ONLY / cross-tab WhatsApp request deduplication.
-- Scope: Supabase cadde-depo-preview (emnacsavgsjkrocpngcj), NEVER production.
-- Identical visitor + canonical cart + price reuses the original pending request for 15 minutes
-- even if each tab generated a different idempotency key.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_whatsapp_request_protected(
  p_product_ids jsonb,
  p_expected_total numeric,
  p_visitor_hash text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_signature jsonb;
  v_inserted integer;
  v_prior cadde_internal.whatsapp_request_dedup%ROWTYPE;
  v_existing cadde_internal.whatsapp_request_dedup%ROWTYPE;
  v_existing_status text;
  v_existing_reserved boolean;
  v_response jsonb;
  window_len integer;
  boundary timestamptz;
  current_count integer;
  cap integer;
BEGIN
  IF p_visitor_hash IS NULL OR p_visitor_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_VISITOR' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_product_ids) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_product_ids) NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'INVALID_CART' USING ERRCODE = '22023';
  END IF;
  IF p_expected_total IS NULL OR p_expected_total <= 0 OR p_expected_total > 1000000000 THEN
    RAISE EXCEPTION 'INVALID_TOTAL' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_product_ids) AS x(val)
    WHERE jsonb_typeof(x.val) IS DISTINCT FROM 'number'
      OR x.val::text !~ '^[1-9][0-9]{0,15}$'
  ) THEN
    RAISE EXCEPTION 'INVALID_ID' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_array(product_id,qty) ORDER BY product_id),'[]'::jsonb),
    'total',p_expected_total
  ) INTO v_signature
  FROM (
    SELECT (x.val::text)::bigint product_id,count(*)::integer qty
    FROM jsonb_array_elements(p_product_ids) AS x(val)
    GROUP BY (x.val::text)::bigint
  ) canonical;

  -- Request-key lock: only one row for the same visitor and exact idempotency key.
  INSERT INTO cadde_internal.whatsapp_request_dedup
    (visitor_hash,idempotency_key,request_signature)
  VALUES (p_visitor_hash,p_idempotency_key,v_signature)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;

  IF v_inserted=0 THEN
    SELECT * INTO v_prior
    FROM cadde_internal.whatsapp_request_dedup
    WHERE visitor_hash=p_visitor_hash AND idempotency_key=p_idempotency_key
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'RETRY_REQUEST' USING ERRCODE='40001'; END IF;
    IF v_prior.request_signature<>v_signature THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';
    END IF;
    IF v_prior.created_at < now()-interval '15 minutes' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_EXPIRED' USING ERRCODE='P0001';
    END IF;
    IF v_prior.response IS NULL OR v_prior.request_id IS NULL THEN
      RAISE EXCEPTION 'RETRY_REQUEST' USING ERRCODE='40001';
    END IF;
    SELECT durum,stok_rezerve INTO v_existing_status,v_existing_reserved
      FROM public.orders WHERE id=v_prior.request_id;
    IF v_existing_status IS DISTINCT FROM 'whatsapp_bekliyor'
       OR v_existing_reserved IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'REQUEST_ALREADY_HANDLED' USING ERRCODE='P0001';
    END IF;
    RETURN v_prior.response||jsonb_build_object('reused',true);
  END IF;

  -- Serialize new keys representing the SAME visitor, item quantities and total.
  -- Transaction-level advisory lock frees automatically on COMMIT or ROLLBACK.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_visitor_hash||':'||v_signature::text,4216)
  );

  SELECT d.* INTO v_existing
    FROM cadde_internal.whatsapp_request_dedup AS d
    JOIN public.orders AS o ON o.id=d.request_id
    WHERE d.visitor_hash=p_visitor_hash
      AND d.request_signature=v_signature
      AND d.idempotency_key<>p_idempotency_key
      AND d.response IS NOT NULL
      AND o.created_at>=now()-interval '15 minutes'
    ORDER BY o.created_at ASC
    LIMIT 1;

  IF FOUND THEN
    SELECT durum,stok_rezerve INTO v_existing_status,v_existing_reserved
      FROM public.orders WHERE id=v_existing.request_id FOR SHARE;
    IF v_existing_status IS DISTINCT FROM 'whatsapp_bekliyor'
       OR v_existing_reserved IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'REQUEST_ALREADY_HANDLED' USING ERRCODE='P0001';
    END IF;
    UPDATE cadde_internal.whatsapp_request_dedup
      SET request_id=v_existing.request_id, response=v_existing.response
      WHERE visitor_hash=p_visitor_hash AND idempotency_key=p_idempotency_key;
    -- Replayed cross-tab requests must not burn rate-limiting quota.
    RETURN v_existing.response||jsonb_build_object('reused',true);
  END IF;

  FOR window_len,cap IN
    SELECT * FROM (VALUES(900,5),(86400,20)) AS limits(seconds,max_requests)
    ORDER BY seconds
  LOOP
    boundary:=to_timestamp(floor(extract(epoch FROM now())/window_len)*window_len);
    INSERT INTO cadde_internal.whatsapp_request_quota
      (visitor_hash,window_seconds,window_start,requests)
    VALUES (p_visitor_hash,window_len,boundary,1)
    ON CONFLICT(visitor_hash,window_seconds,window_start)
    DO UPDATE SET requests=cadde_internal.whatsapp_request_quota.requests+1
    RETURNING requests INTO current_count;
    IF current_count>cap THEN
      RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='P0001';
    END IF;
  END LOOP;

  -- Core RPC still checks product active flag, inventory and authoritative price.
  v_response:=public.create_whatsapp_request(p_product_ids,p_expected_total);
  UPDATE cadde_internal.whatsapp_request_dedup
    SET request_id=(v_response->>'request_id')::uuid,response=v_response
    WHERE visitor_hash=p_visitor_hash AND idempotency_key=p_idempotency_key;
  RETURN v_response||jsonb_build_object('reused',false);
END
$function$;

REVOKE ALL ON FUNCTION public.create_whatsapp_request_protected(jsonb,numeric,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_request_protected(jsonb,numeric,text,uuid)
  TO service_role;

-- Disable the old service-role RPC without the fourth (idempotency-key) argument.
REVOKE ALL ON FUNCTION public.create_whatsapp_request_protected(jsonb,numeric,text)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;