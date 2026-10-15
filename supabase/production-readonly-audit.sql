-- PREPARED ONLY: not executed against the live project.
-- Metadata only. No customer rows, keys, emails or auth tokens are selected.
begin read only;
set local statement_timeout='15s';
set local lock_timeout='2s';
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
 'objects',coalesce(jsonb_agg(jsonb_build_object('kind',kind,'name',name,'definition',definition) order by kind,name),'[]'::jsonb)) as schema_audit from objects;
-- Counts only; compare again after deployment. Never export real customer rows.
select 'products' as relation,count(*) as rows from public.products
union all select 'orders',count(*) from public.orders
union all select 'order_items',count(*) from public.order_items;
-- Authorised operator checks aggregate admin assignments; do not expose user identity.
select count(*) as users_with_server_managed_admin_role from auth.users
where raw_app_meta_data->>'role'='admin';
rollback;
