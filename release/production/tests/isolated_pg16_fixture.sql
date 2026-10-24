-- CADDE DEPO / ISOLATED CI POSTGRESQL 16 / SYNTHETIC DATA ONLY
-- CI-only fixture. Never execute on Cadde Depo Preview or Production.
-- This schema reproduces the RPC-required columns and selected role boundaries.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS cadde_internal;
REVOKE ALL ON SCHEMA cadde_internal FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
SET search_path='' AS $auth$SELECT NULLIF(current_setting('request.jwt.claims',true),'')::jsonb$auth$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
SET search_path='' AS $auth$SELECT NULLIF(auth.jwt()->>'sub','')::uuid$auth$;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO authenticated;

CREATE TABLE public.products(
 id bigint PRIMARY KEY, ad text NOT NULL, aktif boolean NOT NULL,
 stok integer NOT NULL, max_stok integer NOT NULL,
 outlet_fiyat numeric NOT NULL
);
CREATE TABLE public.orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 toplam numeric NOT NULL,
 durum text NOT NULL DEFAULT 'whatsapp_bekliyor',
 kanal text NOT NULL DEFAULT 'whatsapp',
 created_at timestamptz NOT NULL DEFAULT now(),
 stok_rezerve boolean
);
ALTER TABLE public.orders ALTER COLUMN stok_rezerve SET DEFAULT false;
CREATE TABLE public.order_items(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 product_id bigint REFERENCES public.products(id),
 ad text NOT NULL,
 fiyat numeric NOT NULL,
 adet integer NOT NULL DEFAULT 1
);
CREATE TABLE cadde_internal.whatsapp_request_dedup(
 visitor_hash text NOT NULL,
 idempotency_key uuid NOT NULL,
 request_signature jsonb NOT NULL,
 request_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
 response jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(visitor_hash,idempotency_key)
);
CREATE TABLE cadde_internal.whatsapp_request_quota(
 visitor_hash text NOT NULL,
 window_seconds integer NOT NULL,
 window_start timestamptz NOT NULL,
 requests integer NOT NULL DEFAULT 0,
 PRIMARY KEY(visitor_hash,window_seconds,window_start)
);
CREATE TABLE cadde_internal.admin_order_status_audit(
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 order_id uuid NOT NULL,
 actor_uid uuid NOT NULL,
 requested_status text NOT NULL,
 previous_status text,
 resulting_status text,
 outcome text NOT NULL CHECK(outcome IN('accepted','unchanged','rejected')),
 error_code text,
 error_sqlstate text,
 reserved_before boolean,
 reserved_after boolean
);
ALTER TABLE cadde_internal.whatsapp_request_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadde_internal.whatsapp_request_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadde_internal.admin_order_status_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA cadde_internal FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA cadde_internal FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO public.products(id,ad,aktif,stok,max_stok,outlet_fiyat)
 VALUES(5,'SYNTHETIC TEST ITEM',true,1,1,33000);

-- Match historical v2 state without deploying the v2 function.
INSERT INTO public.orders(id,toplam,durum,kanal,stok_rezerve)
 VALUES('00000000-0000-4000-8000-00000000a001',33000,'whatsapp_bekliyor','whatsapp',false),
       ('00000000-0000-4000-8000-00000000a002',33000,'teslim','whatsapp',NULL);
INSERT INTO public.order_items(order_id,product_id,ad,fiyat,adet)
 VALUES('00000000-0000-4000-8000-00000000a001',5,'SYNTHETIC TEST ITEM',33000,1),
       ('00000000-0000-4000-8000-00000000a002',5,'SYNTHETIC TEST ITEM',33000,1);
INSERT INTO cadde_internal.whatsapp_request_dedup(visitor_hash,idempotency_key,request_signature,request_id,response)
 VALUES(repeat('a',64),'00000000-0000-4000-8000-00000000a011',
        '{"items":[[5,1]],"total":33000}'::jsonb,
        '00000000-0000-4000-8000-00000000a001',
        jsonb_build_object('request_id','00000000-0000-4000-8000-00000000a001','total',33000));

-- The real Preview core RPC definition, read-only copied on 2026-10-24.
-- This fixture is not an independently verified replica of future Production code.

CREATE OR REPLACE FUNCTION public.create_whatsapp_request(p_product_ids jsonb, p_expected_total numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 item record; p record; req_id uuid:=gen_random_uuid();
 lines jsonb:='[]'::jsonb; total numeric(14,2):=0;
BEGIN
 IF jsonb_typeof(p_product_ids) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_product_ids) NOT BETWEEN 1 AND 12 THEN
   RAISE EXCEPTION 'INVALID_CART' USING ERRCODE='22023';
 END IF;
 IF p_expected_total IS NULL OR p_expected_total<=0 OR p_expected_total>1000000000 THEN
   RAISE EXCEPTION 'INVALID_TOTAL' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_product_ids) AS x(val)
   WHERE jsonb_typeof(x.val) IS DISTINCT FROM 'number'
      OR x.val::text !~ '^[1-9][0-9]{0,15}$') THEN
   RAISE EXCEPTION 'INVALID_ID' USING ERRCODE='22023';
 END IF;
 FOR item IN
   SELECT (x.val::text)::bigint id,count(*)::int qty
   FROM jsonb_array_elements(p_product_ids) AS x(val)
   GROUP BY (x.val::text)::bigint ORDER BY id
 LOOP
   SELECT id,ad,stok,outlet_fiyat,aktif INTO p FROM public.products
   WHERE id=item.id FOR SHARE;
   IF NOT FOUND OR p.aktif IS DISTINCT FROM true OR p.stok<item.qty THEN
     RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE='P0001';
   END IF;
   total:=total+p.outlet_fiyat*item.qty;
   lines:=lines||jsonb_build_object('id',p.id,'name',p.ad,
      'quantity',item.qty,'price',p.outlet_fiyat);
 END LOOP;
 IF total<>p_expected_total THEN
   RAISE EXCEPTION 'PRICE_CHANGED' USING ERRCODE='P0001';
 END IF;
 INSERT INTO public.orders(id,toplam,durum,kanal)
 VALUES(req_id,total,'whatsapp_bekliyor','whatsapp');
 INSERT INTO public.order_items(order_id,product_id,ad,fiyat,adet)
 SELECT req_id,(x.val->>'id')::bigint,x.val->>'name',
   (x.val->>'price')::numeric,(x.val->>'quantity')::integer
 FROM jsonb_array_elements(lines) AS x(val);
 RETURN jsonb_build_object('request_id',req_id,'total',total,'items',lines);
END $function$


REVOKE ALL ON FUNCTION public.create_whatsapp_request(jsonb,numeric) FROM PUBLIC,anon,authenticated,service_role;
