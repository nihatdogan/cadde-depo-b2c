-- Approval required. Run only against the live products/orders schema after review.
-- Prerequisites: supabase-schema.sql, supabase-admin.sql, products-detail.sql,
-- products-slug.sql. The unrelated supabase/schema.sql uses different tables.
begin;
alter table public.products add column if not exists fulfillment_mode text not null default 'IN_STOCK'
  check (fulfillment_mode in ('IN_STOCK','ORDER_ON_DEMAND'));
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists image_rights_status text;
alter table public.products alter column perakende_fiyat drop not null;
create unique index if not exists products_sku_key on public.products(sku);

-- Server-managed app_metadata, never user_metadata. Existing auth policies are unchanged.
create or replace function public.supply_is_admin() returns boolean
language sql stable set search_path='' as $$
 select coalesce(auth.jwt()->'app_metadata'->>'role','')='admin'
$$;

create table if not exists public.supply_requests (
 id uuid primary key default gen_random_uuid(),
 product_id bigint not null references public.products(id),
 quantity int not null default 1 check(quantity=1),
 unit_price numeric(12,2) not null check(unit_price>0),
 status text not null default 'pending' check(status in ('pending','unavailable','confirmed')),
 shipping_quote numeric(12,2) check(shipping_quote>=0),
 delivery_terms text,
 supplier_checked_at timestamptz,
 supplier_evidence text,
 customer_accepted_at timestamptz,
 customer_evidence text,
 stop_evidence text,
 confirmed_order_id uuid unique references public.orders(id),
 confirmed_snapshot jsonb,
 created_at timestamptz not null default now()
);
create table if not exists public.supply_costs (
 request_id uuid primary key references public.supply_requests(id),
 vat_rate numeric check(vat_rate between 0 and 1),
 purchase_net numeric check(purchase_net>=0),
 inbound numeric check(inbound>=0),
 fees numeric check(fees>=0),
 packing numeric check(packing>=0),
 outbound_net numeric check(outbound_net>=0),
 ads numeric check(ads>=0),
 risk numeric check(risk>=0),
 minimum_contribution numeric check(minimum_contribution>=0),
 supplier_ref text,
 updated_at timestamptz not null default now()
);
alter table public.supply_requests enable row level security;
alter table public.supply_costs enable row level security;
revoke all on public.supply_requests, public.supply_costs from public,anon,authenticated;
grant select on public.supply_requests, public.supply_costs to authenticated;
drop policy if exists supply_admin_read on public.supply_requests;
create policy supply_admin_read on public.supply_requests for select to authenticated using(public.supply_is_admin());
drop policy if exists supply_cost_admin_read on public.supply_costs;
create policy supply_cost_admin_read on public.supply_costs for select to authenticated using(public.supply_is_admin());

create or replace function public.create_supply_request(p_product_id bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.products; r uuid;
begin
 select * into p from public.products where id=p_product_id and aktif and fulfillment_mode='ORDER_ON_DEMAND' for share;
 if not found then raise exception 'Aktif tedarik urunu bulunamadi'; end if;
 insert into public.supply_requests(product_id,unit_price) values(p.id,p.outlet_fiyat) returning id into r;
 return r;
end $$;

create or replace function public.save_supply_costs(p_request_id uuid,p_cost jsonb,p_shipping numeric,p_delivery text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.supply_is_admin() then raise exception 'Yetkili yonetici gerekli'; end if;
 perform 1 from public.supply_requests where id=p_request_id and status='pending' for update;
 if not found then raise exception 'Bekleyen talep bulunamadi'; end if;
 if p_shipping is null or p_shipping<0 or nullif(trim(p_delivery),'') is null then raise exception 'Kargo ve teslimat kosullari gerekli'; end if;
 insert into public.supply_costs(request_id,vat_rate,purchase_net,inbound,fees,packing,outbound_net,ads,risk,minimum_contribution,supplier_ref)
 values(p_request_id,(p_cost->>'vat_rate')::numeric,(p_cost->>'purchase_net')::numeric,(p_cost->>'inbound')::numeric,
 (p_cost->>'fees')::numeric,(p_cost->>'packing')::numeric,(p_cost->>'outbound_net')::numeric,(p_cost->>'ads')::numeric,
 (p_cost->>'risk')::numeric,(p_cost->>'minimum_contribution')::numeric,p_cost->>'supplier_ref')
 on conflict(request_id) do update set vat_rate=excluded.vat_rate,purchase_net=excluded.purchase_net,inbound=excluded.inbound,
 fees=excluded.fees,packing=excluded.packing,outbound_net=excluded.outbound_net,ads=excluded.ads,risk=excluded.risk,
 minimum_contribution=excluded.minimum_contribution,supplier_ref=excluded.supplier_ref,updated_at=now();
 -- Editing any cost/quote invalidates both confirmations.
 update public.supply_requests set shipping_quote=p_shipping,delivery_terms=p_delivery,
 supplier_checked_at=null,supplier_evidence=null,customer_accepted_at=null,customer_evidence=null where id=p_request_id;
end $$;

create or replace function public.record_supply_check(p_request_id uuid,p_action text,p_evidence text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.supply_requests;
begin
 if not public.supply_is_admin() then raise exception 'Yetkili yonetici gerekli'; end if;
 if nullif(trim(p_evidence),'') is null then raise exception 'Yazisma / teyit referansi gerekli'; end if;
 select * into r from public.supply_requests where id=p_request_id and status='pending' for update;
 if not found then raise exception 'Bekleyen talep bulunamadi'; end if;
 if p_action='verify' then
   update public.supply_requests set supplier_checked_at=now(),supplier_evidence=p_evidence,
   customer_accepted_at=null,customer_evidence=null where id=p_request_id;
 elsif p_action='accept' then
   if r.supplier_checked_at is null or r.shipping_quote is null or nullif(trim(r.delivery_terms),'') is null then
     raise exception 'Once stok, montaj, kargo ve teslimati teyit edin'; end if;
   update public.supply_requests set customer_accepted_at=now(),customer_evidence=p_evidence where id=p_request_id;
 elsif p_action='stop' then
   update public.supply_requests set status='unavailable',stop_evidence=p_evidence where id=p_request_id;
 else raise exception 'Gecersiz islem'; end if;
end $$;

create or replace function public.finalize_supply_request(p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.supply_requests; c public.supply_costs; p public.products; contribution numeric; oid uuid;
begin
 if not public.supply_is_admin() then raise exception 'Yetkili yonetici gerekli'; end if;
 select * into r from public.supply_requests where id=p_request_id for update;
 if not found then raise exception 'Talep bulunamadi'; end if;
 if r.status='confirmed' then return r.confirmed_order_id; end if;
 if r.status<>'pending' then raise exception 'Islem durdurulmus'; end if;
 select * into p from public.products where id=r.product_id for share;
 if not p.aktif or p.fulfillment_mode<>'ORDER_ON_DEMAND' or p.outlet_fiyat<>r.unit_price then raise exception 'Urun / fiyat degisti, yeni kosullar bildirilmeli'; end if;
 select * into c from public.supply_costs where request_id=r.id for share;
 if not found or c.vat_rate is null or c.purchase_net is null or c.inbound is null or c.fees is null or c.packing is null
 or c.outbound_net is null or c.ads is null or c.risk is null or c.minimum_contribution is null or nullif(trim(c.supplier_ref),'') is null then
   raise exception 'Maliyet dogrulanmadi'; end if;
 contribution=r.unit_price/(1+c.vat_rate)-c.purchase_net-c.inbound-c.fees-c.packing-c.outbound_net-c.ads-c.risk;
 if contribution<=0 or contribution<c.minimum_contribution then raise exception 'Negatif / yetersiz katki: islem durduruldu'; end if;
 if r.supplier_checked_at is null or r.supplier_checked_at<now()-interval '24 hours'
 or r.customer_accepted_at is null or r.customer_accepted_at<r.supplier_checked_at
 or r.shipping_quote is null or nullif(trim(r.delivery_terms),'') is null then
   raise exception 'Guncel stok / montaj / teslimat / musteri kabul teyidi eksik'; end if;
 insert into public.orders(toplam,durum,kanal) values(r.unit_price+r.shipping_quote,'onaylandi','whatsapp_supply') returning id into oid;
 perform set_config('cadde.supply_finalize',r.id::text,true);
 insert into public.order_items(order_id,product_id,ad,fiyat,adet) values(oid,p.id,p.ad,r.unit_price,1);
 update public.supply_requests set status='confirmed',confirmed_order_id=oid,
 confirmed_snapshot=jsonb_build_object('costs',to_jsonb(c),'contribution',contribution,'product_price',r.unit_price,
 'shipping_quote',r.shipping_quote,'delivery_terms',r.delivery_terms,'supplier_evidence',r.supplier_evidence,
 'customer_evidence',r.customer_evidence,'confirmed_at',now(),'confirmed_by',auth.uid()) where id=r.id;
 return oid;
end $$;

-- An old cart or direct PostgREST call cannot insert a demand product into a normal order.
create or replace function public.guard_supply_order_item() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.products where id=new.product_id and fulfillment_mode='ORDER_ON_DEMAND') then
   if not public.supply_is_admin() or not exists(select 1 from public.supply_requests r
      where r.id::text=current_setting('cadde.supply_finalize',true) and r.product_id=new.product_id and r.status='pending') then
     raise exception 'Siparis uzerine urun yalniz teyitli talep akisiyla kesinlesebilir'; end if;
 end if;
 return new;
end $$;
drop trigger if exists guard_supply_order_item on public.order_items;
create trigger guard_supply_order_item before insert or update on public.order_items for each row execute function public.guard_supply_order_item();

-- Protect the approved product price and supply identity from generic admin edits.
create or replace function public.guard_brabantia_product() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.sku='BRABANTIA-385728' then
   if new.sku is distinct from old.sku or new.outlet_fiyat<>3619 or new.fulfillment_mode<>'ORDER_ON_DEMAND'
     or new.perakende_fiyat is not null or new.stok<>0 then raise exception 'Onayli fiyat / tedarik modeli korunmali'; end if;
 end if;
 return new;
end $$;
drop trigger if exists guard_brabantia_product on public.products;
create trigger guard_brabantia_product before update on public.products for each row execute function public.guard_brabantia_product();

insert into public.products(sku,slug,ana_kategori,alt_kategori,ad,emoji,perakende_fiyat,outlet_fiyat,stok,max_stok,kondisyon,drop_aktif,aktif,fulfillment_mode,image_rights_status,aciklama)
values('BRABANTIA-385728','brabantia-385728-22-metre-cekilebilir-camasir-kurutma-ipi','EV / YAŞAM','Ev Gereçleri',
'Brabantia 22 Metre Çekilebilir Çamaşır Kurutma İpi','',null,3619,0,1,'Sıfır',false,true,'ORDER_ON_DEMAND','PENDING_PERMISSION',
'22 metre kurutma alanı sunan, kullanılmadığında geri çekilebilen duvar tipi çamaşır kurutma sistemi.
Beyaz. Model: 385728. İç mekân kullanımı. Uygun iki duvar arasına monte edilir; duvar aralığı en fazla 4,4 metredir.
KDV dahil ürün fiyatı 3.619₺. Kargo ayrıca ücretlendirilir. Montaj fiyata dahil değildir.
Sipariş üzerine temin edilir. Ödeme öncesinde stok, teslimat ve montaj uygunluğu teyit edilir.')
on conflict(sku) do nothing;

revoke all on function public.create_supply_request(bigint) from public;
grant execute on function public.create_supply_request(bigint) to anon,authenticated;
revoke all on function public.save_supply_costs(uuid,jsonb,numeric,text) from public,anon;
revoke all on function public.record_supply_check(uuid,text,text) from public,anon;
revoke all on function public.finalize_supply_request(uuid) from public,anon;
grant execute on function public.save_supply_costs(uuid,jsonb,numeric,text),public.record_supply_check(uuid,text,text),public.finalize_supply_request(uuid) to authenticated;
commit;
