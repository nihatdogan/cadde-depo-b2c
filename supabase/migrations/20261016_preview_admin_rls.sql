-- CADDE DEPO / PREVIEW ONLY / AŞAMA B
-- SADECE checkout API ve her iki admin ekranı preview testini geçince uygulanır.
-- Mevcut anon INSERT izinleri bu aşamada kasıtlı olarak korunur (kesintisiz geçiş).
-- auth.jwt() Supabase ortamında vardır; çıplak PostgreSQL'de uygulanmaz.
BEGIN;

DROP POLICY IF EXISTS auth_read_orders ON public.orders;
CREATE POLICY auth_read_orders ON public.orders
  FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS auth_read_items ON public.order_items;
CREATE POLICY auth_read_items ON public.order_items
  FOR SELECT TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS auth_update_orders ON public.orders;
CREATE POLICY auth_update_orders ON public.orders
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS auth_all_products ON public.products;
CREATE POLICY auth_all_products ON public.products
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS urunler_auth_insert ON storage.objects;
CREATE POLICY urunler_auth_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'urunler' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
DROP POLICY IF EXISTS urunler_auth_update ON storage.objects;
CREATE POLICY urunler_auth_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'urunler' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (bucket_id = 'urunler' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
DROP POLICY IF EXISTS urunler_auth_delete ON storage.objects;
CREATE POLICY urunler_auth_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'urunler' AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

COMMIT;

-- Not: Diğer politika/grant/trigger fonksiyonları da denetlenmeden Production'a uygulanmaz.
