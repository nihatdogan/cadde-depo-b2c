-- PR #3 / PREVIEW ONLY: manually review and apply to cadde-depo-preview.
-- NEVER auto-run on Production. No writes to existing products/orders.
begin;

create table if not exists public.upcoming_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^CD-[0-9]{3}$'),
  ad text not null check (length(btrim(ad)) > 2),
  ana_kategori text not null,
  alt_kategori text,
  details text,
  gorsel_url text,
  status text not null default 'draft' check (status in ('draft','upcoming','published')),
  outlet_fiyat numeric(12,2) check (outlet_fiyat > 0),
  perakende_fiyat numeric(12,2) check (perakende_fiyat > 0),
  stok integer check (stok >= 0),
  max_stok integer check (max_stok > 0),
  kondisyon text,
  aciklama text,
  supplier_verified boolean not null default false,
  cost_verified boolean not null default false,
  price_verified boolean not null default false,
  stock_verified boolean not null default false,
  condition_verified boolean not null default false,
  compliance_verified boolean not null default false,
  shipping_verified boolean not null default false,
  warranty_verified boolean not null default false,
  verification_ref text,
  published_product_id bigint unique references public.products(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (perakende_fiyat is null or outlet_fiyat is null or outlet_fiyat <= perakende_fiyat),
  check (max_stok is null or stok is null or stok <= max_stok),
  check (status <> 'published' or (published_product_id is not null and published_at is not null))
);


-- Release gate is off by default. Admins cannot turn it on from the web panel.
create schema if not exists cd_pr3_internal;
revoke all on schema cd_pr3_internal from public, anon, authenticated;
create table if not exists cd_pr3_internal.release_gate (
  name text primary key,
  enabled boolean not null default false,
  reviewed_at timestamptz
);
revoke all on cd_pr3_internal.release_gate from public, anon, authenticated;
insert into cd_pr3_internal.release_gate(name,enabled) values ('sales_publish', false)
on conflict(name) do nothing;

alter table public.upcoming_products enable row level security;
revoke all on public.upcoming_products from public, anon, authenticated;
grant select, insert, update, delete on public.upcoming_products to authenticated;

create policy "cd_pr3_admin_read" on public.upcoming_products
for select to authenticated
using ((auth.jwt()->'app_metadata'->>'role') = 'admin');
create policy "cd_pr3_admin_insert" on public.upcoming_products
for insert to authenticated
with check ((auth.jwt()->'app_metadata'->>'role') = 'admin'
  and status in ('draft','upcoming') and published_product_id is null and published_at is null);
create policy "cd_pr3_admin_edit" on public.upcoming_products
for update to authenticated
using ((auth.jwt()->'app_metadata'->>'role') = 'admin' and status in ('draft','upcoming'))
with check ((auth.jwt()->'app_metadata'->>'role') = 'admin'
  and status in ('draft','upcoming') and published_product_id is null and published_at is null);
create policy "cd_pr3_admin_remove" on public.upcoming_products
for delete to authenticated
using ((auth.jwt()->'app_metadata'->>'role') = 'admin' and status in ('draft','upcoming'));

-- Public API exposes ONLY advertising fields. Drafts, prices and verification notes are not exposed.
create or replace function public.cd_list_upcoming_products()
returns table(code text, ad text, ana_kategori text, details text, gorsel_url text)
language sql stable security definer
set search_path = ''
as $$
  select p.code, p.ad, p.ana_kategori, p.details, p.gorsel_url
  from public.upcoming_products p
  where p.status = 'upcoming'
  order by p.created_at, p.code;
$$;
revoke all on function public.cd_list_upcoming_products() from public, anon, authenticated;
grant execute on function public.cd_list_upcoming_products() to anon, authenticated;

create table if not exists public.upcoming_publish_audit (
  id bigint generated always as identity primary key,
  upcoming_id uuid not null references public.upcoming_products(id),
  product_id bigint not null references public.products(id),
  actor_id uuid not null,
  happened_at timestamptz not null default now(),
  action text not null check (action = 'PUBLISHED'),
  evidence_ref text not null
);
alter table public.upcoming_publish_audit enable row level security;
revoke all on public.upcoming_publish_audit from public, anon, authenticated;
grant select on public.upcoming_publish_audit to authenticated;
create policy "cd_pr3_audit_admin_read" on public.upcoming_publish_audit
for select to authenticated
using ((auth.jwt()->'app_metadata'->>'role') = 'admin');

-- Single transaction + row lock; rejected calls cannot create partial live products.
create or replace function public.cd_publish_upcoming_product(p_id uuid)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare
  p public.upcoming_products%rowtype;
  v_product_id bigint;
begin
  if auth.uid() is null
     or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin'
     or coalesce(auth.jwt()->>'aal','') <> 'aal2'
  then
    raise exception 'FORBIDDEN: admin AAL2 session required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from cd_pr3_internal.release_gate
    where name = 'sales_publish' and enabled is true
  ) then
    raise exception 'PR3_PUBLISH_DISABLED_UNTIL_APPROVAL';
  end if;
  select * into p from public.upcoming_products where id = p_id for update;
  if not found then raise exception 'UPCOMING_NOT_FOUND'; end if;
  if p.status = 'published' then
    raise exception 'ALREADY_PUBLISHED'; -- deterministic idempotency: no second live record
  end if;
  if p.status <> 'upcoming'
     or not (p.supplier_verified and p.cost_verified and p.price_verified
              and p.stock_verified and p.condition_verified and p.compliance_verified
              and p.shipping_verified and p.warranty_verified)
     or nullif(btrim(p.verification_ref),'') is null
     or p.outlet_fiyat is null or p.outlet_fiyat <= 0
     or p.perakende_fiyat is null or p.perakende_fiyat < p.outlet_fiyat
     or p.stok is null or p.stok <= 0
     or p.max_stok is null or p.max_stok < p.stok
     or p.kondisyon is null or p.kondisyon not in ('Sıfır','Seri Sonu','Açık Kutu')
     or nullif(btrim(p.ana_kategori),'') is null
     or nullif(btrim(p.ad),'') is null
     or p.gorsel_url is null or p.gorsel_url !~ '^https://'
  then
    raise exception 'PUBLISH_CHECK_FAILED: missing verified product, economics, inventory or delivery evidence';
  end if;
  insert into public.products (
    ana_kategori, alt_kategori, ad, emoji, perakende_fiyat, outlet_fiyat,
    stok, max_stok, kondisyon, drop_aktif, gorsel_url, images, aciklama, slug, aktif
  ) values (
    p.ana_kategori, p.alt_kategori, p.ad, '📦', p.perakende_fiyat, p.outlet_fiyat,
    p.stok, p.max_stok, p.kondisyon, false, p.gorsel_url,
    pg_catalog.jsonb_build_array(p.gorsel_url), p.aciklama, pg_catalog.lower(p.code), true
  ) returning id into v_product_id;
  update public.upcoming_products set
    status = 'published', published_product_id = v_product_id,
    published_at = now(), updated_at = now()
  where id = p.id;
  insert into public.upcoming_publish_audit(upcoming_id, product_id, actor_id, action, evidence_ref)
  values(p.id, v_product_id, auth.uid(), 'PUBLISHED', p.verification_ref);
  return v_product_id;
end;
$$;
revoke all on function public.cd_publish_upcoming_product(uuid) from public, anon, authenticated;
grant execute on function public.cd_publish_upcoming_product(uuid) to authenticated;

-- Five source-backed introductory cards; no sales data, invented prices or stock.
insert into public.upcoming_products(code,ad,ana_kategori,alt_kategori,details,gorsel_url,status) values
('CD-003','Parex Tornado Otomatik Temizlik Seti','EV / YAŞAM','Ev Gereçleri','360° dönen mop başlığı · 15 L kova · Teleskopik sap · Mikrofiber mop','https://www.parex.com.tr/wp-content/uploads/2025/08/tornado-urun-ve-kutu.png.webp','upcoming'),
('CD-012','Arzum AR5036 Superstar Saç Düzleştirici Fırça','KÜÇÜK EV ALETLERİ','Kişisel Bakım','140–220°C ısı ayarı · Seramik tarak dişleri · LED ekran · Otomatik kapanma','https://witcdn.arzum.com.tr/ar5036-superstar-sac-duzlestirici-firca-siyah-sac-duzlestirici-firca-arzum-ar5036-0100-1251-16-B.jpg','upcoming'),
('CD-005','Kiwi KAH-6643 Ultrasonik Hava Nemlendirici','KÜÇÜK EV ALETLERİ','Hava Temizleme / Nemlendiriciler','Ultrasonik hava nemlendirme · Kiwi KAH-6643 model','https://cdn03.ciceksepeti.com/cicek/kcm79034069-1/L/kiwi-kah-6643-ultrasonik-hava-nemlendirici-kcm79034069-1-b292dbff461e49c5bc708d38639f0129.jpg','upcoming'),
('CD-010','Fakir Kaave Mono Türk Kahvesi Makinesi','KÜÇÜK EV ALETLERİ','Çay / Kahve Makineleri','535 W güç · 4 fincan kapasite · Taşma önleme · Sesli ve ışıklı uyarı','https://fakir.witcdn.net/kaave-mono-turk-kahvesi-makinesi-beyaz-fakir-8692-32-B.jpg','upcoming'),
('CD-002','Perilla Triplex 3 Katlı Çamaşır Kurutmalık','EV / YAŞAM','Ev Gereçleri','3 kat · 6 kanat · Katlanabilir tasarım · 16 m asma alanı','https://cdn.perilla.com.tr/urunler/camasir-kurutmalik/perilla-triblex-camasir-kurutmalik-01.png','upcoming')
on conflict(code) do nothing;
commit;
