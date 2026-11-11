-- =====================================================================
-- CADDE DEPO — AŞAMA 2 admin: ek kolonlar + authenticated RLS + storage RLS
-- Supabase SQL Editor'de BİR KEZ çalıştır. supabase-schema.sql sonrası.
-- Idempotent (tekrar çalıştırılabilir).
-- =====================================================================

-- 1) Admin form alanları için eksik kolonlar (idempotent)
alter table products add column if not exists drop_bitis timestamptz;
alter table products add column if not exists gorsel_url text;

-- 2) products: yazma ve tam erişim yalnız app_metadata.role = 'admin'.
--    anon ve admin olmayan authenticated kullanıcı anon_read_products ile yalnız aktif ürünü okur.
drop policy if exists auth_all_products on products;
create policy auth_all_products on products
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- 3) orders: durum güncelleme yalnız admin. Okuma auth_read_orders'ta kalır.
drop policy if exists auth_update_orders on orders;
create policy auth_update_orders on orders
  for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- 4) Storage yazma politikaları burada AÇILMAZ.
--    Eski urunler_auth_* (her authenticated yazabiliyordu) varsa kapatılır.
--    Doğru politikalar: supabase/storage-policies.sql
drop policy if exists "urunler_auth_insert" on storage.objects;
drop policy if exists "urunler_auth_update" on storage.objects;
drop policy if exists "urunler_auth_delete" on storage.objects;

-- =====================================================================
-- NOT: Admin kullanıcısı oluştur → Authentication > Users > Add user
--      (e-posta + şifre; dashboard'dan eklenen kullanıcı auto-confirmed).
-- =====================================================================
