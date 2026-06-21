-- =====================================================================
-- CADDE DEPO — Storage politikaları ('urunler' bucket)
-- MODEL: client-side upload. Giriş yapmış (authenticated) admin YAZAR,
--        herkes (public) OKUR. Anon YAZAMAZ.
-- Supabase SQL Editor'de BİR KEZ çalıştır. Idempotent (tekrar çalışabilir).
-- =====================================================================

-- Temiz başlangıç (varsa eskiyi kaldır)
drop policy if exists "urunler_public_read" on storage.objects;
drop policy if exists "urunler_auth_insert" on storage.objects;
drop policy if exists "urunler_auth_update" on storage.objects;
drop policy if exists "urunler_auth_delete" on storage.objects;

-- Public read (görseller storefront'ta görünsün; bucket da Public olmalı)
create policy "urunler_public_read" on storage.objects
  for select to public using (bucket_id = 'urunler');

-- Authenticated admin: yükle / güncelle (upsert) / sil
create policy "urunler_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'urunler');
create policy "urunler_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'urunler');
create policy "urunler_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'urunler');

-- Anon (giriş yapmamış) için YAZMA politikası YOK — bilinçli.

-- ---------------------------------------------------------------------
-- DOĞRULAMA (çalıştırdıktan sonra):
-- select policyname, cmd, roles from pg_policies
--   where schemaname='storage' and tablename='objects' and policyname like 'urunler%';
--   → 4 satır: public_read(SELECT), auth_insert(INSERT), auth_update(UPDATE), auth_delete(DELETE)
-- select id, name, public from storage.buckets where id='urunler';  -- public = true olmalı
-- ---------------------------------------------------------------------
