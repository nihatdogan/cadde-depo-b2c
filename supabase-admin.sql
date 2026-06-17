-- =====================================================================
-- CADDE DEPO — AŞAMA 2 admin: ek kolonlar + authenticated RLS + storage RLS
-- Supabase SQL Editor'de BİR KEZ çalıştır. supabase-schema.sql sonrası.
-- Idempotent (tekrar çalıştırılabilir).
-- =====================================================================

-- 1) Admin form alanları için eksik kolonlar (idempotent)
alter table products add column if not exists drop_bitis timestamptz;
alter table products add column if not exists gorsel_url text;

-- 2) products: authenticated TAM erişim (inaktif dahil okuma + insert/update/delete)
--    anon hâlâ yalnız aktif ürünleri okur (anon_read_products), yazamaz.
drop policy if exists auth_all_products on products;
create policy auth_all_products on products
  for all to authenticated using (true) with check (true);

-- 3) orders: authenticated GÜNCELLEME (durum değişikliği). Okuma zaten auth_read_orders.
drop policy if exists auth_update_orders on orders;
create policy auth_update_orders on orders
  for update to authenticated using (true) with check (true);

-- 4) Storage: 'urunler' bucket'ına authenticated upload/update/delete.
--    Public okuma bucket public olduğu için zaten açık.
drop policy if exists "urunler_auth_insert" on storage.objects;
drop policy if exists "urunler_auth_update" on storage.objects;
drop policy if exists "urunler_auth_delete" on storage.objects;
create policy "urunler_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'urunler');
create policy "urunler_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'urunler');
create policy "urunler_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'urunler');

-- =====================================================================
-- NOT: Admin kullanıcısı oluştur → Authentication > Users > Add user
--      (e-posta + şifre; dashboard'dan eklenen kullanıcı auto-confirmed).
-- =====================================================================
