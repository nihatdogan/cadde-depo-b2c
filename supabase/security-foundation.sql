-- PHASE A / PREPARED ONLY. Existing policies/grants remain intact until Phase B.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
do $$ declare actual text; required text; verified uuid; verified_ids uuid[]; begin
 if current_setting('cadde_depo.target_project_ref',true) is distinct from 'svyqmmivhpfiuhxnmhny' then raise exception 'WRONG_TARGET';end if;
 foreach required in array array['security_approval_ref','verified_backup_ref','restore_verification_ref','stock_trigger_review_ref','admin_role_verification_ref'] loop
  if nullif(trim(current_setting('cadde_depo.'||required,true)),'') is null then raise exception 'SECURITY_APPROVAL_REQUIRED: %',required;end if;
 end loop;
 verified_ids=string_to_array(nullif(current_setting('cadde_depo.verified_admin_ids',true),''),',')::uuid[];
 if coalesce(cardinality(verified_ids),0)=0 then raise exception 'VERIFIED_ADMINS_REQUIRED';end if;
 foreach verified in array verified_ids loop
  if not exists(select 1 from auth.users u where u.id=verified and u.raw_app_meta_data->>'role'='admin'
   and to_jsonb(u)->>'deleted_at' is null and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=now())) then raise exception 'ADMIN_ROLE_MISMATCH';end if;
 end loop;
 if pg_catalog.pg_has_role('anon','service_role','MEMBER') or pg_catalog.pg_has_role('authenticated','service_role','MEMBER') then raise exception 'INHERITED_SERVER_ROLE';end if;
 select schema_audit->>'fingerprint' into actual from (
with target_tables as (
 select c.oid,n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where (n.nspname='auth' and c.relname='users') or (n.nspname='storage' and c.relname in ('objects','buckets')) or (n.nspname='public' and c.relname in
 ('products','orders','order_items','supply_requests','supply_costs','supply_release_control','checkout_requests','security_rollout'))
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
 select 'policy',p.schemaname||'.'||p.tablename||'.'||p.policyname,jsonb_build_object('command',p.cmd,'roles',p.roles,'permissive',p.permissive,'using',p.qual,'check',p.with_check)
 from pg_catalog.pg_policies p where (p.schemaname,p.tablename) in(select nspname,relname from target_tables)
 union all
 select 'trigger',t.relname||'.'||g.tgname,jsonb_build_object('enabled',g.tgenabled,'definition',pg_catalog.pg_get_triggerdef(g.oid),'function',pg_catalog.pg_get_functiondef(g.tgfoid))
 from target_tables t join pg_catalog.pg_trigger g on g.tgrelid=t.oid and not g.tgisinternal
 union all
 select 'function',n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),'owner',pg_catalog.pg_get_userbyid(p.proowner),'acl',p.proacl,'security_definer',p.prosecdef,'config',p.proconfig)
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where p.prokind='f' and (n.nspname='public' or (n.nspname='auth' and p.proname in('jwt','uid')))
 union all
 select 'grant',g.table_schema||'.'||g.table_name||'.'||g.grantee||'.'||g.privilege_type,to_jsonb(g.is_grantable) from information_schema.table_privileges g where (g.table_schema,g.table_name) in(select nspname,relname from target_tables)
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
 select 'column_grant',g.table_schema||'.'||g.table_name||'.'||g.column_name||'.'||g.grantee||'.'||g.privilege_type,to_jsonb(g.is_grantable) from information_schema.column_privileges g where (g.table_schema,g.table_name) in(select nspname,relname from target_tables)
 union all
 select 'default_acl',pg_catalog.pg_get_userbyid(d.defaclrole)||'.'||coalesce(n.nspname,'*')||'.'||d.defaclobjtype::text,to_jsonb(d.defaclacl) from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
 union all
 select 'role',r.rolname,jsonb_build_object('login',r.rolcanlogin,'bypass_rls',r.rolbypassrls,'superuser',r.rolsuper)
 from pg_catalog.pg_roles r where r.rolname in('anon','authenticated','authenticator','service_role','postgres','supabase_admin')
)
select jsonb_build_object('fingerprint',md5(coalesce(jsonb_agg(jsonb_build_object('kind',kind,'name',name,'definition',definition) order by kind,name)::text,'[]')),
 'objects',coalesce(jsonb_agg(jsonb_build_object('kind',kind,'name',name,'definition',definition) order by kind,name),'[]'::jsonb)) as schema_audit from objects
 ) audited;
 if actual is distinct from current_setting('cadde_depo.expected_security_fingerprint',true) then raise exception 'SECURITY_SCHEMA_DRIFT';end if;
 if exists(select 1 from pg_catalog.pg_class c where c.oid in('public.products'::regclass,'public.orders'::regclass,'public.order_items'::regclass) and not c.relrowsecurity) then raise exception 'RLS_REQUIRED';end if;
end $$;

do $$ begin
 if to_regclass('public.security_rollout') is null and (to_regclass('public.checkout_requests') is not null or to_regprocedure('public.is_cadde_admin()') is not null or to_regprocedure('public.create_checkout_request(jsonb,uuid,text,text)') is not null) then raise exception 'UNREVIEWED_SECURITY_OBJECTS';end if;
 if exists(select 1 from pg_catalog.pg_trigger where tgrelid in('public.products'::regclass,'public.orders'::regclass,'public.order_items'::regclass) and not tgisinternal
 and tgname not in('guard_supply_order','guard_supply_order_item','guard_brabantia_product','guard_checkout_order','guard_checkout_item')) then raise exception 'UNKNOWN_STOCK_TRIGGER_REQUIRES_REVIEW';end if;
end $$;
create or replace function public.is_cadde_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(auth.jwt()->'app_metadata'->>'role','')='admin'
 and exists(select 1 from auth.users u where u.id=auth.uid() and u.raw_app_meta_data->>'role'='admin' and to_jsonb(u)->>'deleted_at' is null and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=now()))
$$;
revoke all on function public.is_cadde_admin() from public;
grant execute on function public.is_cadde_admin() to anon,authenticated,service_role;
create table if not exists public.security_rollout (
 singleton boolean primary key default true check(singleton),phase text not null check(phase in('foundation','enforced')),
 approval_ref text not null,backup_ref text not null,restore_ref text not null,verified_admin_ids uuid[],frontend_ref text,created_at timestamptz not null default now()
);
alter table public.security_rollout enable row level security;
revoke all on public.security_rollout from public,anon,authenticated,service_role;
insert into public.security_rollout(singleton,phase,approval_ref,backup_ref,restore_ref) values(true,'foundation',current_setting('cadde_depo.security_approval_ref'),current_setting('cadde_depo.verified_backup_ref'),current_setting('cadde_depo.restore_verification_ref')) on conflict(singleton) do nothing;
alter table public.products add column if not exists fulfillment_mode text not null default 'IN_STOCK' check(fulfillment_mode in('IN_STOCK','ORDER_ON_DEMAND'));
create table if not exists public.checkout_requests (
 id uuid primary key,actor_hash text not null check(actor_hash ~ '^[a-f0-9]{64}$'),payload jsonb not null,kind text not null check(kind in('stock','supply')),
 order_id uuid unique references public.orders(id),supply_request_id uuid,receipt jsonb,created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '15 minutes',stock_committed boolean not null default false,acceptance_ref text
);
create index if not exists checkout_actor_time on public.checkout_requests(actor_hash,created_at);
create index if not exists checkout_time on public.checkout_requests(created_at);
alter table public.checkout_requests enable row level security;
revoke all on public.checkout_requests from public,anon,authenticated,service_role;
grant select on public.checkout_requests to authenticated;
drop policy if exists checkout_admin_read on public.checkout_requests;
create policy checkout_admin_read on public.checkout_requests for select to authenticated using(public.is_cadde_admin());
alter table public.orders add column if not exists checkout_request_id uuid;
do $$ begin if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.orders'::regclass and conname='orders_checkout_request_fk') then alter table public.orders add constraint orders_checkout_request_fk foreign key(checkout_request_id) references public.checkout_requests(id);end if;end $$;
create unique index if not exists orders_checkout_request_key on public.orders(checkout_request_id);

create or replace function public.create_checkout_request(p_items jsonb,p_request_key uuid,p_actor_hash text,p_kind text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare canonical jsonb; existing public.checkout_requests; item record; p public.products; total numeric:=0; lines jsonb:='[]'; oid uuid;sid uuid;result_receipt jsonb;expires timestamptz;
begin
 if p_request_key is null or p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' or p_kind not in('stock','supply') then raise exception 'INVALID_CART';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'INVALID_CART';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item.value) is distinct from 'object' or (item.value-'id'-'quantity')<>'{}'::jsonb or coalesce(item.value->>'id','') !~ '^[1-9][0-9]{0,14}$'
  or coalesce(item.value->>'quantity','') !~ '^[1-9][0-9]?$' or (item.value->>'quantity')::int>10 then raise exception 'INVALID_CART';end if;
 end loop;
 select jsonb_agg(jsonb_build_object('id',id,'quantity',quantity) order by id) into canonical from (select (value->>'id')::bigint id,sum((value->>'quantity')::int)::int quantity from jsonb_array_elements(p_items) group by 1)c;
 if exists(select 1 from jsonb_array_elements(canonical) where (value->>'quantity')::int>10) or (select sum((value->>'quantity')::int) from jsonb_array_elements(canonical))>50 then raise exception 'INVALID_CART';end if;
 perform pg_catalog.pg_advisory_xact_lock(194385728);
 select * into existing from public.checkout_requests where id=p_request_key for update;
 if found then
  if existing.actor_hash<>p_actor_hash or existing.kind<>p_kind or existing.payload<>canonical then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  if existing.expires_at<=now() then raise exception 'QUOTE_EXPIRED';end if;
  return existing.receipt;
 end if;
 if (select count(*) from public.checkout_requests where actor_hash=p_actor_hash and created_at>now()-interval '10 minutes')>=5 or (select count(*) from public.checkout_requests where created_at>now()-interval '1 minute')>=120 then raise exception 'RATE_LIMITED';end if;
 insert into public.checkout_requests(id,actor_hash,payload,kind) values(p_request_key,p_actor_hash,canonical,p_kind) returning expires_at into expires;
 perform 1 from public.products where id in(select (value->>'id')::bigint from jsonb_array_elements(canonical)) order by id for update;
 for item in select (value->>'id')::bigint id,(value->>'quantity')::int quantity from jsonb_array_elements(canonical) loop
  select * into p from public.products where id=item.id;
  if not found or not p.aktif or p.outlet_fiyat is null or p.outlet_fiyat::text in('NaN','Infinity','-Infinity') or p.outlet_fiyat<=0 then raise exception 'PRODUCT_UNAVAILABLE';end if;
  if p_kind='stock' and (p.fulfillment_mode<>'IN_STOCK' or p.stok<item.quantity) then raise exception 'STOCK_UNAVAILABLE';end if;
  if p_kind='supply' and (p.fulfillment_mode<>'ORDER_ON_DEMAND' or jsonb_array_length(canonical)<>1 or item.quantity<>1) then raise exception 'INVALID_SUPPLY_CART';end if;
  total=total+p.outlet_fiyat*item.quantity;
  lines=lines||jsonb_build_array(jsonb_build_object('id',p.id,'name',p.ad,'unitPrice',p.outlet_fiyat,'quantity',item.quantity));
 end loop;
 if p_kind='supply' then
  if to_regprocedure('public.create_supply_request(bigint)') is null then raise exception 'SUPPLY_NOT_READY';end if;
  execute 'select public.create_supply_request($1)' into sid using (canonical->0->>'id')::bigint;
 else
  oid=gen_random_uuid();perform set_config('cadde.order_write',oid::text,true);
  insert into public.orders(id,toplam,durum,kanal,checkout_request_id) values(oid,total,'whatsapp_bekliyor','whatsapp_secure',p_request_key);
  insert into public.order_items(order_id,product_id,ad,fiyat,adet) select oid,(value->>'id')::bigint,value->>'name',(value->>'unitPrice')::numeric,(value->>'quantity')::int from jsonb_array_elements(lines);
  perform set_config('cadde.order_write','',true);
 end if;
 result_receipt=jsonb_build_object('id',coalesce(oid,sid),'kind',p_kind,'items',lines,'total',total,'expiresAt',expires,'status','request');
 update public.checkout_requests set order_id=oid,supply_request_id=sid,receipt=result_receipt where id=p_request_key;
 return result_receipt;
end $$;
revoke all on function public.create_checkout_request(jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_checkout_request(jsonb,uuid,text,text) to service_role;

create or replace function public.admin_set_checkout_status(p_order_id uuid,p_status text,p_acceptance_ref text default null) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders;r public.checkout_requests;item record;p public.products;
begin
 if not public.is_cadde_admin() then raise exception 'ADMIN_REQUIRED';end if;
 perform pg_catalog.pg_advisory_xact_lock(194385728);
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'ORDER_NOT_FOUND';end if;
 if o.durum=p_status then return;end if;
 if not ((o.durum='whatsapp_bekliyor' and p_status in('onaylandi','iptal')) or (o.durum='onaylandi' and p_status in('kargolandi','iptal')) or (o.durum='kargolandi' and p_status in('teslim','iptal'))) then raise exception 'INVALID_TRANSITION';end if;
 if p_status='onaylandi' then
  if o.checkout_request_id is null then raise exception 'LEGACY_RECONCILIATION_REQUIRED';end if;
  select * into r from public.checkout_requests where id=o.checkout_request_id for update;
  if r.expires_at<=now() or nullif(trim(p_acceptance_ref),'') is null then raise exception 'FRESH_QUOTE_AND_WRITTEN_ACCEPTANCE_REQUIRED';end if;
  perform 1 from public.products where id in(select product_id from public.order_items where order_id=o.id) order by id for update;
  for item in select * from public.order_items where order_id=o.id order by product_id loop
   select * into p from public.products where id=item.product_id;
   if not p.aktif or p.fulfillment_mode<>'IN_STOCK' or p.stok<item.adet or p.outlet_fiyat<>item.fiyat then raise exception 'STOCK_OR_PRICE_CHANGED';end if;
  end loop;
  update public.products inventory set stok=inventory.stok-it.adet from public.order_items it where it.order_id=o.id and inventory.id=it.product_id;
  update public.checkout_requests set stock_committed=true,acceptance_ref=p_acceptance_ref where id=r.id;
 end if;
 perform set_config('cadde.order_write',o.id::text,true);update public.orders set durum=p_status where id=o.id;perform set_config('cadde.order_write','',true);
end $$;
revoke all on function public.admin_set_checkout_status(uuid,text,text) from public,anon;
grant execute on function public.admin_set_checkout_status(uuid,text,text) to authenticated;

create or replace function public.guard_checkout_order() returns trigger language plpgsql security definer set search_path='' as $$
declare linked uuid;enforced boolean;row_id uuid;context_ok boolean;
begin
 select phase='enforced' into enforced from public.security_rollout where singleton;
 if TG_OP='INSERT' then linked=new.checkout_request_id;row_id=new.id;else linked=old.checkout_request_id;row_id=old.id;end if;
 context_ok=coalesce(current_setting('cadde.order_write',true),'')=row_id::text;
 if linked is not null then
  if TG_OP='DELETE' then raise exception 'ORDER_RECORD_RETAINED';end if;
  if not context_ok then raise exception 'CHECKOUT_RPC_REQUIRED';end if;
  if TG_OP='UPDATE' and (new.toplam is distinct from old.toplam or new.id<>old.id or new.checkout_request_id is distinct from old.checkout_request_id or new.kanal is distinct from old.kanal) then raise exception 'ORDER_IMMUTABLE';end if;
 elsif enforced and coalesce(current_setting('request.jwt.claims',true),'') not in('','{}') then
  if TG_OP='INSERT' and coalesce(current_setting('cadde.supply_finalize',true),'')<>'' and new.kanal='whatsapp_supply' and to_regprocedure('public.guard_supply_order()') is not null and public.is_cadde_admin() then return new;end if;
  if TG_OP<>'UPDATE' or not context_ok or not public.is_cadde_admin() then raise exception 'CHECKOUT_RPC_REQUIRED';end if;
  if new.toplam is distinct from old.toplam or new.id<>old.id or new.kanal is distinct from old.kanal or new.checkout_request_id is distinct from old.checkout_request_id then raise exception 'ORDER_IMMUTABLE';end if;
 end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end $$;
drop trigger if exists guard_checkout_order on public.orders;
create trigger guard_checkout_order before insert or update or delete on public.orders for each row execute function public.guard_checkout_order();
create or replace function public.guard_checkout_item() returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid;r public.checkout_requests;
begin
 if TG_OP='INSERT' then oid=new.order_id;else oid=old.order_id;end if;
 select c.* into r from public.checkout_requests c join public.orders o on o.checkout_request_id=c.id where o.id=oid;
 if found then
  if TG_OP<>'INSERT' or r.receipt is not null or coalesce(current_setting('cadde.order_write',true),'')<>oid::text then raise exception 'ORDER_ITEM_IMMUTABLE';end if;
 elsif exists(select 1 from public.security_rollout where singleton and phase='enforced') and coalesce(current_setting('request.jwt.claims',true),'') not in('','{}') then
  if TG_OP='INSERT' and coalesce(current_setting('cadde.supply_finalize',true),'')<>'' and to_regprocedure('public.guard_supply_order_item()') is not null and public.is_cadde_admin() then return new;end if;
  raise exception 'CHECKOUT_RPC_REQUIRED';
 end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end $$;
drop trigger if exists guard_checkout_item on public.order_items;
create trigger guard_checkout_item before insert or update or delete on public.order_items for each row execute function public.guard_checkout_item();
revoke all on function public.guard_checkout_order(),public.guard_checkout_item() from public,anon,authenticated,service_role;
commit;
