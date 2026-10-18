-- CADDE DEPO / PREVIEW ONLY / AŞAMA C
-- SADECE storefront yeni endpoint'e geçmiş ve testler başarılı ise.
-- Mevcut client-side iki aşamalı INSERT'i kaldırmadan BUNU ÇALIŞTIRMAYIN.
BEGIN;
DROP POLICY IF EXISTS anon_insert_orders ON public.orders;
DROP POLICY IF EXISTS anon_insert_items ON public.order_items;
REVOKE INSERT ON public.orders, public.order_items FROM anon, authenticated;
COMMIT;
