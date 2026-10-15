-- PREPARATION ONLY. No authority to run this file is implied.
-- Requires authorised live audit + verified backup/restore proof + explicit manager approval.
-- Set the target, schema fingerprint and three evidence settings only AFTER those gates are satisfied.
-- No real customer test records. Seed is INACTIVE. Never run as a deployment/build hook.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
do $$
declare observed text; expected text; required text; owner_name text;
begin
 if current_setting('cadde_depo.target_project_ref',true) is distinct from 'svyqmmivhpfiuhxnmhny' then
  raise exception 'PRODUCTION_APPROVAL_REQUIRED: wrong or missing target'; end if;
 foreach required in array array['production_approval_ref','verified_backup_ref','restore_verification_ref'] loop
  if nullif(trim(current_setting('cadde_depo.'||required,true)),'') is null then
   raise exception 'PRODUCTION_APPROVAL_REQUIRED: missing %',required; end if;
 end loop;
 expected=current_setting('cadde_depo.expected_schema_fingerprint',true);
 if expected is null or expected !~ '^[a-f0-9]{32}$' then raise exception 'VERIFIED_LIVE_SCHEMA_REQUIRED'; end if;
 select schema_audit->>'fingerprint' into observed from (
with target_tables as (
 select c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in
 ('products','orders','order_items','supply_requests','supply_costs','supply_release_control')
), objects as (
 select 'table' as kind,t.relname as name,jsonb_build_object('rls',t.relrowsecurity,'force_rls',t.relforcerowsecurity,'owner',pg_catalog.pg_get_userbyid(t.relowner)) as definition from target_tables t
 union all
 select 'column',t.relname||'.'||a.attname,jsonb_build_object('type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity)
 from target_tables t join pg_catalog.pg_attribute a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
 left join pg_catalog.pg_attrdef d on d.adrelid=t.oid and d.adnum=a.attnum
 union all
 select 'constraint',t.relname||'.'||c.conname,to_jsonb(pg_catalog.pg_get_constraintdef(c.oid,true)) from target_tables t join pg_catalog.pg_constraint c on c.conrelid=t.oid
 union all
 select 'index',t.relname||'.'||ci.relname,to_jsonb(pg_catalog.pg_get_indexdef(i.indexrelid)) from target_tables t join pg_catalog.pg_index i on i.indrelid=t.oid join pg_catalog.pg_class ci on ci.oid=i.indexrelid
 union all
 select 'policy',p.tablename||'.'||p.policyname,jsonb_build_object('command',p.cmd,'roles',p.roles,'permissive',p.permissive,'using',p.qual,'check',p.with_check)
 from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename in(select relname from target_tables)
 union all
 select 'trigger',t.relname||'.'||g.tgname,jsonb_build_object('enabled',g.tgenabled,'definition',pg_catalog.pg_get_triggerdef(g.oid),'function',pg_catalog.pg_get_functiondef(g.tgfoid))
 from target_tables t join pg_catalog.pg_trigger g on g.tgrelid=t.oid and not g.tgisinternal
 union all
 select 'function',n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),'owner',pg_catalog.pg_get_userbyid(p.proowner),'acl',p.proacl,'security_definer',p.prosecdef,'config',p.proconfig)
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where p.prokind='f' and (n.nspname='public' or (n.nspname='auth' and p.proname in('jwt','uid')))
 union all
 select 'grant',g.table_name||'.'||g.grantee||'.'||g.privilege_type,to_jsonb(g.is_grantable) from information_schema.table_privileges g where g.table_schema='public' and g.table_name in(select relname from target_tables)
 union all
 select 'dependent_view',n.nspname||'.'||v.relname,to_jsonb(pg_catalog.pg_get_viewdef(v.oid,true))
 from pg_catalog.pg_class v join pg_catalog.pg_namespace n on n.oid=v.relnamespace
 where v.relkind in ('v','m') and exists(select 1 from pg_catalog.pg_rewrite r join pg_catalog.pg_depend d on d.objid=r.oid and d.classid='pg_rewrite'::regclass
 where r.ev_class=v.oid and d.refobjid in(select oid from target_tables))
 union all
 select 'referencing_fk',n.nspname||'.'||t.relname||'.'||c.conname,to_jsonb(pg_catalog.pg_get_constraintdef(c.oid,true))
 from pg_catalog.pg_constraint c join pg_catalog.pg_class t on t.oid=c.conrelid join pg_catalog.pg_namespace n on n.oid=t.relnamespace
 where c.contype='f' and c.confrelid in(select oid from target_tables)
 union all
 select 'membership',m.rolname||'->'||r.rolname,to_jsonb(a.admin_option)
 from pg_catalog.pg_auth_members a join pg_catalog.pg_roles m on m.oid=a.member join pg_catalog.pg_roles r on r.oid=a.roleid
 where m.rolname in('anon','authenticated','authenticator','service_role','postgres','supabase_admin') or r.rolname in('anon','authenticated','service_role')
 union all
 select 'sequence_usage',g.object_name||'.'||g.grantee,to_jsonb(g.is_grantable)
 from information_schema.usage_privileges g where g.object_schema='public' and g.object_type='SEQUENCE'
 union all
 select 'role',r.rolname,jsonb_build_object('login',r.rolcanlogin,'bypass_rls',r.rolbypassrls,'superuser',r.rolsuper)
 from pg_catalog.pg_roles r where r.rolname in('anon','authenticated','authenticator','service_role','postgres','supabase_admin')
)
select jsonb_build_object('fingerprint',md5(coalesce(jsonb_agg(jsonb_build_object('kind',kind,'name',name,'definition',definition) order by kind,name)::text,'[]')),
 'objects',coalesce(jsonb_agg(jsonb_build_object('kind',kind,'name',name,'definition',definition) order by kind,name),'[]'::jsonb)) as schema_audit from objects
 ) audited;
 if observed<>expected then raise exception 'LIVE_SCHEMA_DRIFT: review a fresh read-only audit'; end if;
 foreach required in array array['products','orders','order_items'] loop
  if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname=required and c.relrowsecurity) then
   raise exception 'RLS_REQUIRED: %',required; end if;
  select pg_catalog.pg_get_userbyid(c.relowner) into owner_name from pg_catalog.pg_class c where c.oid=to_regclass('public.'||required);
  if not pg_catalog.pg_has_role(current_user,owner_name,'MEMBER') then raise exception 'Schema owner required'; end if;
 end loop;
 -- Do not overwrite unknown objects or a Preview migration deployed to the wrong place.
 if to_regclass('public.supply_release_control') is null and (
   to_regclass('public.supply_requests') is not null or to_regclass('public.supply_costs') is not null
   or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname like '%supply%' or p.proname like '%brabantia%'))
   or exists(select 1 from public.orders where kanal='whatsapp_supply')) then
  raise exception 'EXISTING_SUPPLY_OBJECTS_REQUIRE_MANUAL_RECONCILIATION'; end if;
 -- Require the known frontend contract; no guessed live column mappings.
 if exists(select 1 from (values
 ('products','id','int8'),('products','ad','text'),('products','ana_kategori','text'),('products','alt_kategori','text'),
 ('products','perakende_fiyat','numeric'),('products','outlet_fiyat','numeric'),('products','stok','int4'),('products','max_stok','int4'),
 ('products','aktif','bool'),('products','images','jsonb'),('products','emoji','text'),('products','kondisyon','text'),('products','drop_aktif','bool'),('products','slug','text'),('products','aciklama','text'),('products','gorsel_url','text'),
 ('orders','id','uuid'),('orders','durum','text'),('orders','toplam','numeric'),('orders','kanal','text'),
 ('order_items','id','int8'),('order_items','order_id','uuid'),('order_items','product_id','int8'),('order_items','fiyat','numeric'),('order_items','adet','int4')
 ) needed(t,c,typ) where not exists(select 1 from information_schema.columns x where x.table_schema='public' and x.table_name=needed.t and x.column_name=needed.c and x.udt_name=needed.typ)) then
  raise exception 'FRONTEND_SCHEMA_CONTRACT_MISMATCH'; end if;
end $$;

alter table public.products add column if not exists fulfillment_mode text not null default 'IN_STOCK'
  check (fulfillment_mode in ('IN_STOCK','ORDER_ON_DEMAND'));
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists image_rights_status text;
alter table public.products alter column perakende_fiyat drop not null;
create unique index if not exists products_sku_key on public.products(sku);
-- Preserve the previous NOT NULL contract for stocked products; only demand products may lack an old price.
do $$ begin
 if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.products'::regclass and conname='products_stock_reference_required') then
  alter table public.products add constraint products_stock_reference_required check(fulfillment_mode='ORDER_ON_DEMAND' or perakende_fiyat is not null);
 end if;
 if exists(select 1 from public.products where sku is distinct from 'BRABANTIA-385728' and
  (slug='brabantia-385728-22-metre-cekilebilir-camasir-kurutma-ipi'
   or (ad ilike '%Brabantia%' and (ad ilike '%22%' or aciklama like '%385728%')))) then
  raise exception 'PRODUCT_IDENTITY_RECONCILIATION_REQUIRED'; end if;
end $$;

-- Server-managed app_metadata, never user_metadata. Existing auth policies are unchanged.
create or replace function public.supply_is_admin() returns boolean
language sql stable set search_path='' as $$
 select auth.uid() is not null and coalesce(auth.jwt()->'app_metadata'->>'role','')='admin'
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



alter table public.orders add column if not exists supply_request_id uuid;
do $$ begin
 if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.orders'::regclass and conname='orders_supply_request_fk') then
  alter table public.orders add constraint orders_supply_request_fk foreign key(supply_request_id) references public.supply_requests(id);
 end if;
end $$;
create unique index if not exists orders_supply_request_key on public.orders(supply_request_id);

create table if not exists public.supply_release_control (
 release_key text primary key check(release_key='brabantia-385728-production-v1'),
 enabled boolean not null default false,
 migration_approval_ref text not null,
 verified_backup_ref text not null,
 restore_verification_ref text not null,
 schema_fingerprint text not null,
 publication_approval_ref text,
 image_permission_ref text,
 created_at timestamptz not null default now()
);
alter table public.supply_release_control enable row level security;
revoke all on public.supply_release_control from public,anon,authenticated;
insert into public.supply_release_control(release_key,migration_approval_ref,verified_backup_ref,restore_verification_ref,schema_fingerprint)
values('brabantia-385728-production-v1',current_setting('cadde_depo.production_approval_ref'),current_setting('cadde_depo.verified_backup_ref'),
current_setting('cadde_depo.restore_verification_ref'),current_setting('cadde_depo.expected_schema_fingerprint')) on conflict(release_key) do nothing;

create or replace function public.supply_publication_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.supply_release_control where release_key='brabantia-385728-production-v1' and enabled
 and nullif(trim(image_permission_ref),'') is not null and nullif(trim(publication_approval_ref),'') is not null
 and publication_approval_ref=current_setting('cadde_depo.publication_approval_ref',true))
$$;
revoke all on function public.supply_publication_allowed() from public,anon;
grant execute on function public.supply_publication_allowed() to authenticated;

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
 if exists(select 1 from jsonb_each_text(p_cost) v where v.key in
 ('vat_rate','purchase_net','inbound','fees','packing','outbound_net','ads','risk','minimum_contribution')
 and v.value is not null and (v.value::numeric::text in ('NaN','Infinity','-Infinity') or v.value::numeric<0)) then
  raise exception 'Finite non-negative verified costs required'; end if;
 perform 1 from public.supply_requests where id=p_request_id and status='pending' for update;
 if not found then raise exception 'Bekleyen talep bulunamadi'; end if;
 if p_shipping is null or p_shipping::text in ('NaN','Infinity','-Infinity') or p_shipping<0 or nullif(trim(p_delivery),'') is null then raise exception 'Kargo ve teslimat kosullari gerekli'; end if;
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
   if r.supplier_checked_at is null or r.supplier_checked_at<now()-interval '24 hours' or nullif(trim(r.supplier_evidence),'') is null
 or r.shipping_quote is null or r.shipping_quote::text in ('NaN','Infinity','-Infinity') or nullif(trim(r.delivery_terms),'') is null then
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
 if exists(select 1 from unnest(array[c.vat_rate,c.purchase_net,c.inbound,c.fees,c.packing,c.outbound_net,c.ads,c.risk,c.minimum_contribution]) n
 where n::text in ('NaN','Infinity','-Infinity') or n<0) then raise exception 'Finite verified costs required'; end if;
 contribution=r.unit_price/(1+c.vat_rate)-c.purchase_net-c.inbound-c.fees-c.packing-c.outbound_net-c.ads-c.risk;
 if contribution<=0 or contribution<c.minimum_contribution then raise exception 'Negatif / yetersiz katki: islem durduruldu'; end if;
 if r.supplier_checked_at is null or r.supplier_checked_at<now()-interval '24 hours'
 or r.customer_accepted_at is null or r.customer_accepted_at<r.supplier_checked_at
 or nullif(trim(r.supplier_evidence),'') is null or nullif(trim(r.customer_evidence),'') is null
 or r.shipping_quote is null or r.shipping_quote::text in ('NaN','Infinity','-Infinity') or nullif(trim(r.delivery_terms),'') is null then
   raise exception 'Guncel stok / montaj / teslimat / musteri kabul teyidi eksik'; end if;
 perform set_config('cadde.supply_finalize',r.id::text,true);
 insert into public.orders(toplam,durum,kanal,supply_request_id) values(r.unit_price+r.shipping_quote,'onaylandi','whatsapp_supply',r.id) returning id into oid;
 insert into public.order_items(order_id,product_id,ad,fiyat,adet) values(oid,p.id,p.ad,r.unit_price,1);
 update public.supply_requests set status='confirmed',confirmed_order_id=oid,
 confirmed_snapshot=jsonb_build_object('costs',to_jsonb(c),'contribution',contribution,'product_price',r.unit_price,
 'shipping_quote',r.shipping_quote,'delivery_terms',r.delivery_terms,'supplier_evidence',r.supplier_evidence,
 'customer_evidence',r.customer_evidence,'confirmed_at',now(),'confirmed_by',auth.uid()) where id=r.id;
 perform set_config('cadde.supply_finalize','',true);
 return oid;
end $$;

-- Linked supply order headers and items cannot be forged/edited through legacy endpoints.
create or replace function public.guard_supply_order() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='DELETE' then
  if old.supply_request_id is not null then raise exception 'Supply orders are retained; cancel instead'; end if;
  return old;
 end if;
 if TG_OP='UPDATE' and old.supply_request_id is not null then
  if not public.supply_is_admin() or new.supply_request_id is distinct from old.supply_request_id
   or new.id is distinct from old.id or new.toplam is distinct from old.toplam or new.kanal is distinct from old.kanal
   or new.created_at is distinct from old.created_at or new.durum not in ('onaylandi','kargolandi','teslim','iptal')
   or (old.durum='iptal' and new.durum<>'iptal') then raise exception 'Supply order immutable or unauthorised'; end if;
  return new;
 end if;
 if new.supply_request_id is not null or new.kanal='whatsapp_supply' then
  if TG_OP<>'INSERT' or not public.supply_is_admin() or not exists(select 1 from public.supply_requests r
   where r.id=new.supply_request_id and r.id::text=current_setting('cadde.supply_finalize',true) and r.status='pending'
   and new.durum='onaylandi' and new.kanal='whatsapp_supply' and new.toplam=r.unit_price+r.shipping_quote) then
    raise exception 'Verified supply RPC required'; end if;
 end if;
 return new;
end $$;
drop trigger if exists guard_supply_order on public.orders;
create trigger guard_supply_order before insert or update or delete on public.orders for each row execute function public.guard_supply_order();

create or replace function public.guard_supply_order_item() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP in ('UPDATE','DELETE') then
  if exists(select 1 from public.orders where id=old.order_id and supply_request_id is not null)
   or exists(select 1 from public.products where id=old.product_id and fulfillment_mode='ORDER_ON_DEMAND') then
    raise exception 'Supply order lines are immutable and retained'; end if;
  if TG_OP='DELETE' then return old; end if;
 end if;
 if exists(select 1 from public.products where id=new.product_id and fulfillment_mode='ORDER_ON_DEMAND')
 or exists(select 1 from public.orders where id=new.order_id and supply_request_id is not null) then
  if TG_OP<>'INSERT' or not public.supply_is_admin() or not exists(select 1 from public.supply_requests r join public.orders o on o.supply_request_id=r.id
   where r.id::text=current_setting('cadde.supply_finalize',true) and r.status='pending' and r.product_id=new.product_id
   and new.order_id=o.id and new.adet=1 and new.fiyat=r.unit_price) then raise exception 'Verified supply request required'; end if;
 end if;
 return new;
end $$;
drop trigger if exists guard_supply_order_item on public.order_items;
create trigger guard_supply_order_item before insert or update or delete on public.order_items for each row execute function public.guard_supply_order_item();

-- SECURITY INVOKER preserves the original caller identity for the owner check.
create or replace function public.guard_brabantia_product() returns trigger
language plpgsql set search_path='' as $$
declare is_supply boolean; owner_role name; operator boolean;
begin
 select pg_catalog.pg_get_userbyid(relowner) into owner_role from pg_catalog.pg_class where oid='public.products'::regclass;
 operator=pg_catalog.pg_has_role(current_user,owner_role,'MEMBER');
 if TG_OP='INSERT' then is_supply=new.fulfillment_mode='ORDER_ON_DEMAND';
 else is_supply=old.fulfillment_mode='ORDER_ON_DEMAND'; end if;
 if TG_OP='UPDATE' then is_supply=is_supply or new.fulfillment_mode='ORDER_ON_DEMAND'; end if;
 if not is_supply then if TG_OP='DELETE' then return old; else return new; end if; end if;
 if not operator and not public.supply_is_admin() then raise exception 'Authorised supply administrator required'; end if;
 if TG_OP='DELETE' then raise exception 'Supply product retained; deactivate instead'; end if;
 if TG_OP='UPDATE' and old.fulfillment_mode='ORDER_ON_DEMAND' and new.fulfillment_mode is distinct from old.fulfillment_mode then raise exception 'Supply identity immutable'; end if;
 if new.sku='BRABANTIA-385728' or (TG_OP='UPDATE' and old.sku='BRABANTIA-385728') then
  if new.sku is distinct from 'BRABANTIA-385728' or new.outlet_fiyat is distinct from 3619::numeric
    or new.fulfillment_mode is distinct from 'ORDER_ON_DEMAND' or new.perakende_fiyat is not null or new.stok<>0
    or new.ana_kategori is distinct from 'EV / YAŞAM' or new.alt_kategori is distinct from 'Ev Gereçleri' or new.drop_aktif then
   raise exception 'Approved price / category / physical stock / identity must be preserved'; end if;
  if TG_OP='UPDATE' and old.aktif and (new.gorsel_url is distinct from old.gorsel_url or new.images is distinct from old.images or new.image_rights_status is distinct from old.image_rights_status)
   and (not operator or not public.supply_publication_allowed()) then raise exception 'Fresh licensed image publication approval required'; end if;
  if new.aktif and (TG_OP='INSERT' or not old.aktif) then
   if not operator or not public.supply_publication_allowed() or new.image_rights_status is distinct from 'LICENSED'
     or nullif(trim(new.gorsel_url),'') is null then raise exception 'Separate publication approval and licensed image required'; end if;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists guard_brabantia_product on public.products;
create trigger guard_brabantia_product before insert or update or delete on public.products for each row execute function public.guard_brabantia_product();

insert into public.products(sku,slug,ana_kategori,alt_kategori,ad,emoji,perakende_fiyat,outlet_fiyat,stok,max_stok,kondisyon,drop_aktif,aktif,fulfillment_mode,image_rights_status,aciklama)
values('BRABANTIA-385728','brabantia-385728-22-metre-cekilebilir-camasir-kurutma-ipi','EV / YAŞAM','Ev Gereçleri',
'Brabantia 22 Metre Çekilebilir Çamaşır Kurutma İpi','',null,3619,0,1,'Sıfır',false,false,'ORDER_ON_DEMAND','PENDING_PERMISSION',
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
-- Do not silently reuse a conflicting pre-existing product identity.
do $$ begin
 if not exists(select 1 from public.products where sku='BRABANTIA-385728' and outlet_fiyat=3619 and stok=0
  and fulfillment_mode='ORDER_ON_DEMAND' and ana_kategori='EV / YAŞAM' and alt_kategori='Ev Gereçleri' and perakende_fiyat is null) then
   raise exception 'PRODUCT_IDENTITY_CONFLICT'; end if;
end $$;
-- No broad existing policies are rewritten. Sensitive new tables have no PUBLIC/anon grants.
revoke all on function public.guard_supply_order(),public.guard_supply_order_item(),public.guard_brabantia_product() from public,anon,authenticated;
commit;
