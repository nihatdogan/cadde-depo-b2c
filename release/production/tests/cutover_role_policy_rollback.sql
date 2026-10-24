-- CADDE DEPO — CI-ONLY simulated production grants + RLS transition
-- Run ONLY on disposable postgres:16 cadde_ci with synthetic fixtures.
-- Demonstrates why GRANT and RLS policy revocations must be considered together.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.orders,public.order_items TO anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.order_items_id_seq TO anon,authenticated;
CREATE POLICY anon_insert_orders ON public.orders FOR INSERT TO anon,authenticated WITH CHECK (true);
CREATE POLICY anon_insert_items ON public.order_items FOR INSERT TO anon,authenticated WITH CHECK (true);

SET LOCAL ROLE anon;
INSERT INTO public.orders(id,toplam,durum,kanal,stok_rezerve)
 VALUES('00000000-0000-4000-8000-00000000f001',33000,'whatsapp_bekliyor','whatsapp',false);
INSERT INTO public.order_items(order_id,product_id,ad,fiyat,adet)
 VALUES('00000000-0000-4000-8000-00000000f001',5,'SYNTHETIC LEGACY WRITE',33000,1);
RESET ROLE;

-- Cutover candidate: only after reviewed gateway and RPC v3 are verified.
DROP POLICY anon_insert_orders ON public.orders;
DROP POLICY anon_insert_items ON public.order_items;
REVOKE INSERT ON public.orders,public.order_items FROM anon,authenticated;
REVOKE UPDATE ON public.orders,public.order_items FROM anon,authenticated;

DO $verify$
BEGIN
 IF has_table_privilege('anon','public.orders','INSERT') OR
    has_table_privilege('anon','public.order_items','INSERT') OR
    has_table_privilege('authenticated','public.orders','UPDATE') THEN
   RAISE EXCEPTION 'LEGACY_TABLE_PRIVILEGE_REMAINS';
 END IF;
END $verify$;
SET LOCAL ROLE anon;
DO $assert_anon$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  INSERT INTO public.orders(id,toplam,durum,kanal,stok_rezerve)
   VALUES('00000000-0000-4000-8000-00000000f002',33000,'whatsapp_bekliyor','whatsapp',false);
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'ANON_DIRECT_ORDER_INSERT_ALLOWED'; END IF;
END $assert_anon$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $assert_auth$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  INSERT INTO public.order_items(order_id,product_id,ad,fiyat,adet)
   VALUES('00000000-0000-4000-8000-00000000f001',5,'UNAUTHORIZED',33000,1);
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'AUTH_DIRECT_ITEM_INSERT_ALLOWED'; END IF;
END $assert_auth$;
RESET ROLE;

-- Verify privileged new protected v3 still works despite direct write revoke.
SET LOCAL ROLE service_role;
SELECT public.create_whatsapp_request_protected_v3(
 '[5]'::jsonb,33000,repeat('f',64),repeat('e',64),
 '00000000-0000-4000-8000-00000000f101'::uuid) AS protected_request;
RESET ROLE;
SELECT 'CUTOVER_ROLE_POLICY_ASSERTIONS_PASSED' AS result;
ROLLBACK;
