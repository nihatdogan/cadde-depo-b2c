-- CADDE DEPO / PREVIEW ONLY — duplicate WhatsApp request protection.
-- NOT a production migration. Deploy in cadde-depo-preview only.
BEGIN;

CREATE TABLE IF NOT EXISTS cadde_internal.whatsapp_request_dedup (
  visitor_hash text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_signature jsonb NOT NULL,
  request_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(visitor_hash,idempotency_key)
);
REVOKE ALL ON cadde_internal.whatsapp_request_dedup FROM PUBLIC, anon, authenticated;
ALTER TABLE cadde_internal.whatsapp_request_dedup ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE cadde_internal.whatsapp_request_dedup IS
  'PREVIEW: only one WhatsApp request per visitor/key; order deletion cascades the dedup record.';

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
AS $func$
DECLARE
  v_signature jsonb;
  v_inserted integer;
  v_prior cadde_internal.whatsapp_request_dedup%ROWTYPE;
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
  IF jsonb_typeof(p_product_ids) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_CART' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_product_ids) NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'INVALID_CART_SIZE' USING ERRCODE = '22023';
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

  -- Item order does not matter; quantity and expected price both form the intent.
  SELECT jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_array(product_id,qty) ORDER BY product_id),'[]'::jsonb),
    'total',p_expected_total
  )
  INTO v_signature
  FROM (
    SELECT (x.val::text)::bigint product_id, count(*)::integer qty
    FROM jsonb_array_elements(p_product_ids) AS x(val)
    GROUP BY (x.val::text)::bigint
  ) canonical;

  -- Primary-key conflict serializes simultaneous calls for the same key.
  INSERT INTO cadde_internal.whatsapp_request_dedup
    (visitor_hash,idempotency_key,request_signature)
  VALUES (p_visitor_hash,p_idempotency_key,v_signature)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT * INTO v_prior
    FROM cadde_internal.whatsapp_request_dedup
    WHERE visitor_hash = p_visitor_hash AND idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RETRY_REQUEST' USING ERRCODE = '40001';
    END IF;
    IF v_prior.request_signature <> v_signature THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    IF v_prior.created_at < now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_EXPIRED' USING ERRCODE = 'P0001';
    END IF;
    IF v_prior.response IS NULL OR v_prior.request_id IS NULL THEN
      RAISE EXCEPTION 'RETRY_REQUEST' USING ERRCODE = '40001';
    END IF;
    -- An already accepted, cancelled or processed order must not become a fresh request.
    IF NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = v_prior.request_id AND durum = 'whatsapp_bekliyor'
        AND stok_rezerve IS FALSE
    ) THEN
      RAISE EXCEPTION 'REQUEST_ALREADY_HANDLED' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_prior.response || jsonb_build_object('reused',true);
  END IF;

  -- Rate limits only charge *new* unique requests, in the same SQL transaction.
  FOR window_len,cap IN
    SELECT * FROM (VALUES (900,5),(86400,20)) AS limits(seconds,max_requests)
    ORDER BY seconds
  LOOP
    boundary := to_timestamp(floor(extract(epoch FROM now()) / window_len)*window_len);
    INSERT INTO cadde_internal.whatsapp_request_quota
      (visitor_hash,window_seconds,window_start,requests)
    VALUES (p_visitor_hash,window_len,boundary,1)
    ON CONFLICT (visitor_hash,window_seconds,window_start)
    DO UPDATE SET requests = cadde_internal.whatsapp_request_quota.requests + 1
    RETURNING requests INTO current_count;
    IF current_count > cap THEN
      RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='P0001';
    END IF;
  END LOOP;

  -- Existing core function validates current product visibility, stock and price.
  v_response := public.create_whatsapp_request(p_product_ids,p_expected_total);
  UPDATE cadde_internal.whatsapp_request_dedup
     SET request_id = (v_response ->> 'request_id')::uuid,
         response = v_response
   WHERE visitor_hash = p_visitor_hash AND idempotency_key = p_idempotency_key;
  RETURN v_response || jsonb_build_object('reused',false);
END
$func$;

REVOKE ALL ON FUNCTION public.create_whatsapp_request_protected(jsonb,numeric,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_request_protected(jsonb,numeric,text,uuid)
  TO service_role;
COMMIT;