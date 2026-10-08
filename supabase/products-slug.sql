-- =====================================================================
-- CADDE DEPO — ürün slug (kalıcı, benzersiz) migration'ı
-- Supabase SQL Editor'de BİR KEZ çalıştır. Idempotent (tekrar çalıştırılabilir).
-- Mevcut RLS/policy'lere DOKUNMAZ; yalnızca kolon + backfill + unique index.
-- =====================================================================

-- 1) Kolon
alter table products add column if not exists slug text;

-- 2) Backfill: slug'ı boş olan her satıra ürün adından benzersiz slug (id sırasıyla; ilk gelen ana slug'ı alır)
--    Türkçe karakter -> ASCII, küçük harf, ardışık/baş/son tire yok. Çakışmada -2, -3 ...
do $$
declare
  r record;
  base text;
  cand text;
  n int;
begin
  for r in select id, ad from products where slug is null or slug = '' order by id loop
    base := left(
      trim(both '-' from regexp_replace(
        lower(translate(r.ad, 'ÇçĞğİıÖöŞşÜü', 'CcGgIiOoSsUu')),
        '[^a-z0-9]+', '-', 'g')),
      80);
    base := trim(both '-' from base);
    if base = '' then base := 'urun'; end if;
    cand := base;
    n := 2;
    while exists (select 1 from products where slug = cand and id <> r.id) loop
      cand := base || '-' || n;
      n := n + 1;
    end loop;
    update products set slug = cand where id = r.id;
  end loop;
end $$;

-- 3) Benzersizlik (DB seviyesinde). NULL'lar çakışmaz; backfill sonrası hepsi dolu olmalı.
create unique index if not exists products_slug_key on products (slug);

-- 4) DOĞRULAMA
-- select id, ad, slug from products order by id;
--   → ID 29 için slug = yagmur-sandikli-kose-koltuk olmalı
-- select count(*) from products where slug is null;   -- beklenen: 0
