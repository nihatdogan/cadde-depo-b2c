-- =====================================================================
-- CADDE DEPO — marka ve GTIN (nullable)
-- Supabase SQL Editor'de BİR KEZ çalıştır. Düz tırnak.
-- JSON-LD bu kolonlar doluysa brand ve gtin13 basar; boşsa alanı yazmaz.
-- =====================================================================
alter table products add column if not exists marka text;
alter table products add column if not exists gtin text;

-- CD-025 Sinbo SFH-3399. Yalnız boş kolonları doldurur.
update products
set marka = 'Sinbo',
    gtin = '8693807238305'
where slug = 'sinbo-sfh-3399-1000-w-quartz-isitici-2-kademeli-siyah'
  and coalesce(marka, '') = ''
  and coalesce(gtin, '') = '';
