-- =====================================================================
-- CADDE DEPO — ürün detay: çoklu görsel + açıklama kolonları
-- Supabase SQL Editor'de BİR KEZ çalıştır. Düz tırnak.
-- =====================================================================
alter table products add column if not exists images jsonb default '[]'::jsonb;
alter table products add column if not exists aciklama text;
