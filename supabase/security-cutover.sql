-- PHASE B / PREPARED ONLY. Requires new frontend/backend and verified administrators.
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

do $$ declare required text;admins uuid[];verified_id uuid;p record;begin
 foreach required in array array['admin_role_verification_ref','secure_frontend_ref','secure_endpoint_verification_ref','legacy_pending_reconciliation_ref'] loop
  if nullif(trim(current_setting('cadde_depo.'||required,true)),'') is null then raise exception 'CUTOVER_EVIDENCE_REQUIRED: %',required;end if;
 end loop;
 admins=string_to_array(nullif(current_setting('cadde_depo.verified_admin_ids',true),''),',')::uuid[];
 if coalesce(cardinality(admins),0)=0 then raise exception 'VERIFIED_ADMINS_REQUIRED';end if;
 foreach verified_id in array admins loop if not exists(select 1 from auth.users u where u.id=verified_id and u.raw_app_meta_data->>'role'='admin') then raise exception 'ADMIN_ROLE_MISMATCH';end if;end loop;
 if to_regprocedure('public.create_checkout_request(jsonb,uuid,text,text)') is null or to_regprocedure('public.admin_set_checkout_status(uuid,text,text)') is null then raise exception 'SECURE_RPC_REQUIRED';end if;
 if to_regclass('storage.objects') is null or not exists(select 1 from pg_catalog.pg_class where oid='storage.objects'::regclass and relrowsecurity) then raise exception 'STORAGE_RLS_AUDIT_REQUIRED';end if;
 if exists(select 1 from pg_catalog.pg_proc f join pg_catalog.pg_namespace n on n.oid=f.pronamespace
 where n.nspname='public' and f.prorettype<>'trigger'::regtype
 and not exists(select 1 from pg_catalog.pg_depend d join pg_catalog.pg_extension e on e.oid=d.refobjid where d.classid='pg_proc'::regclass and d.objid=f.oid and d.deptype='e' and e.extname in('pgcrypto','uuid-ossp'))
 and f.proname not in('is_cadde_admin','create_checkout_request','admin_set_checkout_status','create_supply_request','supply_is_admin','supply_publication_allowed','save_supply_costs','record_supply_check','finalize_supply_request')
 and (has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE'))) then raise exception 'UNREVIEWED_EXPOSED_RPC';end if;
 for p in select schemaname,tablename,policyname from pg_catalog.pg_policies where schemaname='public' and tablename in('products','orders','order_items') loop execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);end loop;
 update public.security_rollout set phase='enforced',approval_ref=current_setting('cadde_depo.security_approval_ref'),verified_admin_ids=admins,frontend_ref=current_setting('cadde_depo.secure_frontend_ref') where singleton;
 if not found then raise exception 'FOUNDATION_REQUIRED';end if;
end $$;
-- Table REVOKE alone does not remove existing column privileges.
do $$ declare t text;cols text;priv text;begin
 foreach t in array array['products','orders','order_items'] loop
  select string_agg(quote_ident(attname),',') into cols from pg_catalog.pg_attribute where attrelid=('public.'||t)::regclass and attnum>0 and not attisdropped;
  foreach priv in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop execute format('revoke %s (%s) on public.%I from public,anon,authenticated',priv,cols,t);end loop;
 end loop;
 if exists(select 1 from pg_catalog.pg_roles where rolname in('anon','authenticated') and (rolsuper or rolbypassrls)) then raise exception 'UNSAFE_APPLICATION_ROLE';end if;
 if has_table_privilege('anon','auth.users','UPDATE') or has_table_privilege('authenticated','auth.users','UPDATE') or has_table_privilege('anon','auth.users','INSERT') or has_table_privilege('authenticated','auth.users','INSERT') or has_table_privilege('anon','auth.users','DELETE') or has_table_privilege('authenticated','auth.users','DELETE') or has_table_privilege('anon','auth.users','TRUNCATE') or has_table_privilege('authenticated','auth.users','TRUNCATE')
 or has_column_privilege('anon','auth.users','raw_app_meta_data','UPDATE') or has_column_privilege('authenticated','auth.users','raw_app_meta_data','UPDATE') then raise exception 'AUTH_METADATA_PERMISSION_AUDIT_REQUIRED';end if;
end $$;
revoke all on public.products,public.orders,public.order_items from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['products','orders','order_items'] loop
  if has_table_privilege('anon','public.'||t,'TRUNCATE') or has_table_privilege('authenticated','public.'||t,'TRUNCATE')
   or pg_catalog.pg_has_role('anon',(select relowner from pg_catalog.pg_class where oid=('public.'||t)::regclass),'MEMBER')
   or pg_catalog.pg_has_role('authenticated',(select relowner from pg_catalog.pg_class where oid=('public.'||t)::regclass),'MEMBER') then raise exception 'INHERITED_UNSAFE_PRIVILEGES';end if;
 end loop;
end $$;
grant select on public.products to anon,authenticated;
grant insert,update,delete on public.products to authenticated;
grant select,update on public.orders to authenticated;
grant select on public.order_items to authenticated;
create policy cadde_published_products on public.products for select to anon,authenticated using(aktif);
create policy cadde_admin_products on public.products for all to authenticated using(public.is_cadde_admin()) with check(public.is_cadde_admin());
create policy cadde_admin_orders_read on public.orders for select to authenticated using(public.is_cadde_admin());
create policy cadde_admin_orders_status on public.orders for update to authenticated using(public.is_cadde_admin()) with check(public.is_cadde_admin());
create policy cadde_admin_items_read on public.order_items for select to authenticated using(public.is_cadde_admin());
revoke truncate,trigger,references on storage.objects from public,anon,authenticated;
do $$begin if has_table_privilege('anon','storage.objects','TRUNCATE') or has_table_privilege('authenticated','storage.objects','TRUNCATE') then raise exception 'INHERITED_STORAGE_PRIVILEGES';end if;end $$;
-- Bucket-scoped restrictive policies retain unrelated applications' bucket policies.
drop policy if exists cadde_urunler_guard on storage.objects;
create policy cadde_urunler_guard on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'urunler' or public.is_cadde_admin()) with check(bucket_id<>'urunler' or public.is_cadde_admin());
drop policy if exists cadde_urunler_admin on storage.objects;
create policy cadde_urunler_admin on storage.objects for all to authenticated using(bucket_id='urunler' and public.is_cadde_admin()) with check(bucket_id='urunler' and public.is_cadde_admin());
do $$ declare seq text;begin
 seq=pg_catalog.pg_get_serial_sequence('public.products','id');if seq is not null then execute format('revoke all on sequence %s from public,anon,authenticated',seq);execute format('grant usage on sequence %s to authenticated',seq);end if;
 seq=pg_catalog.pg_get_serial_sequence('public.order_items','id');if seq is not null then execute format('revoke all on sequence %s from public,anon,authenticated',seq);end if;
 if to_regprocedure('public.create_supply_request(bigint)') is not null then revoke all on function public.create_supply_request(bigint) from public,anon,authenticated;end if;
 if to_regprocedure('public.supply_is_admin()') is not null then execute 'create or replace function public.supply_is_admin() returns boolean language sql stable set search_path='''' as $body$ select public.is_cadde_admin() $body$';end if;
end $$;
commit;
