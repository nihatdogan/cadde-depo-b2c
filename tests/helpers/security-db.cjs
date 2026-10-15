const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(p,'utf8');
const adminId='00000000-0000-4000-8000-000000000001';
async function bootstrap(existingDb){
 const db=existingDb||new PGlite();await db.exec(`do $roles$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$roles$;create schema auth;create schema storage;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 create table auth.users(id uuid primary key,raw_app_meta_data jsonb,deleted_at timestamptz,banned_until timestamptz);
 insert into auth.users(id,raw_app_meta_data) values('${adminId}','{"role":"admin"}'),('00000000-0000-4000-8000-000000000002','{}');
 create table storage.buckets(id text primary key,public boolean);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema auth,storage to anon,authenticated,service_role;
 grant all on storage.objects to anon,authenticated;
 create policy old_broad_storage on storage.objects for all to anon,authenticated using(true) with check(true);
 insert into storage.buckets values('urunler',true),('other-app',true);
 insert into storage.objects(bucket_id,name) values('urunler','existing.png'),('other-app','other.png');`);
 await db.exec(read('supabase-schema.sql'));await db.exec(read('supabase-admin.sql').split('-- 4) Storage:')[0]);await db.exec(read('supabase/products-detail.sql'));await db.exec(read('supabase/products-slug.sql'));
 await db.exec('grant all on products,orders,order_items to anon,authenticated;grant usage,select on all sequences in schema public to anon,authenticated;');
 await db.exec("update products set stok=2,max_stok=10,outlet_fiyat=100,perakende_fiyat=200 where id=1;update products set aktif=false where id=2;");
 return db;
}
const owner=db=>db.exec("reset role;select set_config('request.jwt.claims','{}',false)");
const admin=db=>db.exec(`set role authenticated;select set_config('request.jwt.claims','{"sub":"${adminId}","role":"authenticated","app_metadata":{"role":"admin"}}',false)`);
const user=db=>db.exec(`set role authenticated;select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","user_metadata":{"role":"admin"}}',false)`);
const anon=db=>db.exec(`set role anon;select set_config('request.jwt.claims','{"role":"anon"}',false)`);
const service=db=>db.exec(`set role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',false)`);
async function evidence(db,overrides={}){
 await owner(db);const results=await db.exec(read('supabase/production-readonly-audit.sql'));
 const fingerprint=results.find(x=>x.rows?.[0]?.schema_audit).rows[0].schema_audit.fingerprint;
 const flags={target_project_ref:'svyqmmivhpfiuhxnmhny',security_approval_ref:'LOCAL',production_approval_ref:'LOCAL',verified_backup_ref:'LOCAL',restore_verification_ref:'LOCAL',stock_trigger_review_ref:'LOCAL',expected_security_fingerprint:fingerprint,expected_schema_fingerprint:fingerprint,
 admin_role_verification_ref:'LOCAL',secure_frontend_ref:'LOCAL',secure_endpoint_verification_ref:'LOCAL',legacy_pending_reconciliation_ref:'LOCAL',verified_admin_ids:adminId,...overrides};
 for(const[k,v]of Object.entries(flags))await db.query("select set_config('cadde_depo.'||$1,$2,false)",[k,v]);
}
module.exports={read,adminId,bootstrap,owner,admin,user,anon,service,evidence};
