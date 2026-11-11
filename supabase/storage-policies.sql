-- =====================================================================
-- CADDE DEPO — Storage politikaları ('urunler' bucket)
-- Canlı kuralla aynı: herkes okur; yazma yalnız app_metadata.role = 'admin'.
-- Supabase SQL Editor'de tekrar çalıştırılabilir. Eski urunler_auth_* deliklerini kapatır.
-- =====================================================================

drop policy if exists "urunler_public_read" on storage.objects;
drop policy if exists "urunler_auth_insert" on storage.objects;
drop policy if exists "urunler_auth_update" on storage.objects;
drop policy if exists "urunler_auth_delete" on storage.objects;
drop policy if exists "urunler_admin_insert" on storage.objects;
drop policy if exists "urunler_admin_update" on storage.objects;
drop policy if exists "urunler_admin_delete" on storage.objects;

create policy "urunler_public_read" on storage.objects
  for select to public
  using (bucket_id = 'urunler');

create policy "urunler_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'urunler'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy "urunler_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'urunler'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    bucket_id = 'urunler'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy "urunler_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'urunler'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ---------------------------------------------------------------------
-- DOĞRULAMA:
-- select policyname, cmd, roles from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and policyname like 'urunler%';
--   → public_read (SELECT), admin_insert, admin_update, admin_delete
-- urunler_auth_* olmamalı.
-- ---------------------------------------------------------------------
