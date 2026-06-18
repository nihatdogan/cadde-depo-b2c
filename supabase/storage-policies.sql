-- =====================================================================
-- CADDE DEPO — Storage politikaları ('urunler' bucket)
-- Model: Görsel YAZMA yalnız server-side service_role ile yapılır
--        (/api/admin/upload-product-image). service_role RLS'i bypass eder,
--        bu yüzden frontend'e (anon/authenticated) YAZMA izni AÇILMAZ.
-- Yalnız PUBLIC READ açılır (görseller storefront'ta görünsün).
-- Supabase SQL Editor'de bir kez çalıştır.
-- =====================================================================

-- Frontend'den storage yazımı yapılmadığı için eski authenticated write
-- politikalarını kaldır (artık gereksiz; least-privilege).
drop policy if exists "urunler_auth_insert" on storage.objects;
drop policy if exists "urunler_auth_update" on storage.objects;
drop policy if exists "urunler_auth_delete" on storage.objects;

-- Public read — herkes 'urunler' içindeki nesneleri OKUYABİLİR (yalnız select).
-- (Public URL'lerin çalışması için bucket'ın da Public olması gerekir:
--  Storage → urunler → Settings → Public bucket = ON.)
drop policy if exists "urunler_public_read" on storage.objects;
create policy "urunler_public_read" on storage.objects
  for select to public using (bucket_id = 'urunler');

-- ANON/AUTHENTICATED için insert/update/delete politikası YOK (bilinçli).
-- Yazma 100% sunucuda service_role ile. RLS açık kalır, bucket public-write OLMAZ.

-- Doğrulama:
-- select policyname, cmd, roles from pg_policies
-- where schemaname='storage' and tablename='objects';
-- (yalnız urunler_public_read / SELECT / {public} görünmeli — write yok)
