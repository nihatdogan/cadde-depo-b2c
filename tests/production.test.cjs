// Isolated synthetic fixtures only. No network, live credentials or customer records.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(p,'utf8');
const migration=read('supabase/order-on-demand.production.sql');
const auditSql=read('supabase/production-readonly-audit.sql');
let db,product,baseline,confirmedOrder,confirmedRequest;
const owner=async()=>db.exec("reset role; select set_config('request.jwt.claims','{}',false);");
const admin=async()=>db.exec("set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-4000-8000-000000000001\",\"app_metadata\":{\"role\":\"admin\"}}',false);");
const user=async()=>db.exec("set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-4000-8000-000000000002\",\"user_metadata\":{\"role\":\"admin\"}}',false);");
async function audit(){await owner();const results=await db.exec(auditSql);return results.find(x=>x.rows?.[0]?.schema_audit)?.rows[0].schema_audit;}
async function prepare(overrides={}){
 const fingerprint=(await audit()).fingerprint;
 const flags={target_project_ref:'svyqmmivhpfiuhxnmhny',production_approval_ref:'LOCAL-SYNTHETIC-APPROVAL',verified_backup_ref:'LOCAL-SYNTHETIC-BACKUP',restore_verification_ref:'LOCAL-SYNTHETIC-RESTORE',expected_schema_fingerprint:fingerprint,...overrides};
 for(const [k,v]of Object.entries(flags))await db.query("select set_config('cadde_depo.'||$1,$2,false)",[k,v]);
}
async function rejectMigration(pattern){await assert.rejects(db.exec(migration),pattern);await db.exec('rollback');}
async function request(){await db.exec('set role anon');return (await db.query('select create_supply_request($1) id',[product])).rows[0].id;}
async function cost(id,overrides={},shipping=100){await admin();await db.query('select save_supply_costs($1,$2,$3,\'Test delivery terms\')',[id,JSON.stringify({vat_rate:0.2,purchase_net:2000,inbound:20,fees:70,packing:20,outbound_net:0,ads:50,risk:50,minimum_contribution:100,supplier_ref:'LOCAL-TEST-QUOTE',...overrides}),shipping]);}
const verify=id=>db.query("select record_supply_check($1,'verify','LOCAL written supplier and installation evidence')",[id]);
const accept=id=>db.query("select record_supply_check($1,'accept','LOCAL written 3619 + shipping, delivery and no installation acceptance')",[id]);
const finalize=id=>db.query('select finalize_supply_request($1) id',[id]);
async function counts(){await owner();return (await db.query('select (select count(*) from orders) orders,(select count(*) from order_items) items,(select count(*) from supply_requests) requests,(select count(*) from supply_costs) costs')).rows[0];}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
 create table auth.users(id uuid primary key,raw_app_meta_data jsonb); insert into auth.users values('00000000-0000-4000-8000-000000000001','{"role":"admin"}');
 grant usage on schema auth to anon,authenticated;`);
 await db.exec(read('supabase-schema.sql'));await db.exec(read('supabase-admin.sql').split('-- 4) Storage:')[0]);
 await db.exec(read('supabase/products-detail.sql'));await db.exec(read('supabase/products-slug.sql'));
 await db.exec('grant insert,update,delete on products,orders,order_items to authenticated; grant usage,select on all sequences in schema public to anon,authenticated;');
 await db.exec("insert into orders(id,toplam,durum) values('00000000-0000-4000-8000-000000000010',100,'teslim'); insert into order_items(order_id,product_id,ad,fiyat) values('00000000-0000-4000-8000-000000000010',1,'LOCAL EXISTING ORDER',100);");
 const firstAudit=(await db.exec(auditSql)).find(x=>x.rows?.[0]?.schema_audit).rows[0].schema_audit;
 for(const [k,v]of Object.entries({target_project_ref:'svyqmmivhpfiuhxnmhny',security_approval_ref:'LOCAL',verified_backup_ref:'LOCAL',restore_verification_ref:'LOCAL',stock_trigger_review_ref:'LOCAL',admin_role_verification_ref:'LOCAL',verified_admin_ids:'00000000-0000-4000-8000-000000000001',expected_security_fingerprint:firstAudit.fingerprint}))await db.query("select set_config('cadde_depo.'||$1,$2,false)",[k,v]);
 await db.exec(read('supabase/security-foundation.sql'));
 baseline={products:(await db.query('select * from products order by id')).rows,orders:(await db.query('select * from orders order by id')).rows,items:(await db.query('select * from order_items order by id')).rows,
 policies:(await db.query("select policyname,qual,with_check from pg_policies where schemaname='public' and tablename in('category_main','products','orders','order_items') order by tablename,policyname")).rows};
});
after(async()=>db?.close());
test('production migration blocks absent approval/backup/restore evidence before DDL',async()=>{
 await owner();await rejectMigration(/PRODUCTION_APPROVAL_REQUIRED/);
 for(const k of ['production_approval_ref','verified_backup_ref','restore_verification_ref']){await prepare({[k]:''});await rejectMigration(/PRODUCTION_APPROVAL_REQUIRED/);}
 assert.equal((await db.query("select to_regclass('public.supply_requests') t")).rows[0].t,null);
});
test('read-only audit exports metadata and aggregates only; schema drift is blocked',async()=>{
 const a=await audit();assert.match(a.fingerprint,/^[a-f0-9]{32}$/);assert.ok(a.objects.some(o=>o.kind==='policy'));
 assert.ok(a.objects.some(o=>o.kind==='function'&&o.name.startsWith('auth.uid')));
 assert.doesNotMatch(JSON.stringify(a),/LOCAL EXISTING ORDER/);
 await prepare();await db.exec('alter table products add column local_drift_probe text');await rejectMigration(/LIVE_SCHEMA_DRIFT/);
 await db.exec('alter table products drop column local_drift_probe');
});
test('existing RLS cannot be disabled or unknown supply RPC overwritten',async()=>{
 await owner();await db.exec('alter table orders disable row level security');await prepare();await rejectMigration(/RLS_REQUIRED/);await db.exec('alter table orders enable row level security');
 await db.exec('create function public.unknown_supply() returns int language sql as $$ select 1 $$');await prepare();await rejectMigration(/MANUAL_RECONCILIATION/);await db.exec('drop function public.unknown_supply()');
});
test('unidentified existing Brabantia listing blocks duplicate product creation',async()=>{
 await owner();const id=(await db.query("insert into products(ana_kategori,ad,perakende_fiyat,outlet_fiyat,stok,max_stok,kondisyon) values('EV / YAŞAM','Brabantia 22 LOCAL EXISTING LISTING',3619,3619,0,1,'Sıfır') returning id")).rows[0].id;
 await prepare();await rejectMigration(/PRODUCT_IDENTITY_RECONCILIATION_REQUIRED/);await db.query('delete from products where id=$1',[id]);
});
test('production seed is inactive and all pre-existing products/orders/stocks/policies survive',async()=>{
 await prepare();await db.exec(migration);
 product=(await db.query("select id from products where sku='BRABANTIA-385728'")).rows[0].id;
 const p=(await db.query('select * from products where id=$1',[product])).rows[0];
 assert.equal(p.aktif,false);assert.equal(Number(p.outlet_fiyat),3619);assert.equal(p.perakende_fiyat,null);assert.equal(p.stok,0);
 assert.equal(p.fulfillment_mode,'ORDER_ON_DEMAND');assert.equal(p.ana_kategori,'EV / YAŞAM');assert.equal(p.alt_kategori,'Ev Gereçleri');assert.equal(p.image_rights_status,'PENDING_PERMISSION');
 for(const original of baseline.products){const actual=(await db.query('select * from products where id=$1',[original.id])).rows[0];for(const [k,v]of Object.entries(original))assert.deepEqual(actual[k],v);}
 for(const original of baseline.orders){const actual=(await db.query('select * from orders where id=$1',[original.id])).rows[0];for(const [k,v]of Object.entries(original))assert.deepEqual(actual[k],v);}
 assert.deepEqual((await db.query('select * from order_items order by id')).rows,baseline.items);
 const policies=(await db.query("select policyname,qual,with_check from pg_policies where schemaname='public' and tablename in('category_main','products','orders','order_items') order by tablename,policyname")).rows;assert.deepEqual(policies,baseline.policies);
});
test('rerun requires fresh audited fingerprint but never duplicates data or activates product',async()=>{
 const before=await counts();await prepare();await db.exec(migration);assert.deepEqual(await counts(),before);
 assert.equal((await db.query("select count(*) n from products where sku='BRABANTIA-385728'")).rows[0].n,1);
 assert.equal((await db.query('select aktif from products where id=$1',[product])).rows[0].aktif,false);
});
test('inactive product is absent to anonymous catalog and cannot accept a request',async()=>{
 await db.exec('set role anon');assert.equal((await db.query('select id from products where id=$1',[product])).rows.length,0);await assert.rejects(request(),/Aktif tedarik/);
});
test('activation needs separate approval, real image URL and licence evidence',async()=>{
 await owner();await assert.rejects(db.query('update products set aktif=true where id=$1',[product]),/publication approval/);
 await assert.rejects(db.exec(read('supabase/production-activate-brabantia.sql')),/evidence required/);await db.exec('rollback');
 await db.exec("select set_config('cadde_depo.publication_approval_ref','LOCAL-PUBLICATION',false),set_config('cadde_depo.image_permission_ref','LOCAL-LICENCE',false)");
 await assert.rejects(db.exec(read('supabase/production-activate-brabantia.sql')),/real image URL/);await db.exec('rollback');
 await db.query("update products set gorsel_url='https://licensed.example.invalid/local-test.png' where id=$1",[product]);
 await db.exec(read('supabase/production-activate-brabantia.sql'));assert.equal((await db.query('select aktif from products where id=$1',[product])).rows[0].aktif,true);
 await db.exec("select set_config('cadde_depo.publication_approval_ref','',false)");
});
test('anonymous and ordinary authenticated users cannot read costs or change draft/price/stock/category',async()=>{
 for(const table of ['supply_requests','supply_costs','supply_release_control']){
  await db.exec('set role anon');await assert.rejects(db.query('select * from '+table),/permission denied/);
 }
 await user();assert.equal((await db.query('select * from supply_costs')).rows.length,0);
 for(const expr of ['outlet_fiyat=1','stok=5',"ana_kategori='TELEFON'",'aktif=false'])await assert.rejects(db.query('update products set '+expr+' where id=$1',[product]),/Authorised/);
 await assert.rejects(db.query("update supply_requests set unit_price=1"),/permission denied/);
 await assert.rejects(db.query('select * from supply_release_control'),/permission denied/);
});
test('request price comes only from server and cannot be submitted by customer',async()=>{
 const id=await request();await owner();const r=(await db.query('select * from supply_requests where id=$1',[id])).rows[0];assert.equal(Number(r.unit_price),3619);assert.equal(r.quantity,1);
 await db.exec('set role anon');await assert.rejects(db.query('select create_supply_request($1,1)',[product]),/does not exist/);
 await assert.rejects(db.query('insert into supply_requests(product_id,unit_price) values($1,1)',[product]),/permission denied/);
});
test('role spoofing cannot save costs, record stock/customer evidence or finalize',async()=>{
 const id=await request();await user();await assert.rejects(finalize(id),/Yetkili/);await assert.rejects(verify(id),/Yetkili/);
 await assert.rejects(db.query("select save_supply_costs($1,'{}',0,'fake')",[id]),/Yetkili/);
});
test('missing, negative and unacceptable contribution cannot finalize',async()=>{
 const id=await request();await cost(id,{risk:null});await verify(id);await accept(id);await assert.rejects(finalize(id),/Maliyet dogrulanmadi/);
 await cost(id,{purchase_net:4000});await verify(id);await accept(id);await assert.rejects(finalize(id),/yetersiz katki/);
 await cost(id,{minimum_contribution:2000});await verify(id);await accept(id);await assert.rejects(finalize(id),/yetersiz katki/);
});
test('non-finite costs and shipping are rejected, not counted as profitable',async()=>{
 const id=await request();await assert.rejects(cost(id,{purchase_net:'NaN'}),/Finite/);await assert.rejects(cost(id,{},'NaN'),/Kargo/);
});
test('supplier/installation/delivery and written customer acceptance are mandatory and invalidated on change',async()=>{
 const id=await request();await cost(id);await assert.rejects(finalize(id),/teyidi eksik/);await verify(id);await assert.rejects(finalize(id),/teyidi eksik/);
 await accept(id);await cost(id);await assert.rejects(finalize(id),/teyidi eksik/);
 await verify(id);await owner();await db.query("update supply_requests set supplier_checked_at=now()-interval '25 hours' where id=$1",[id]);await admin();await assert.rejects(accept(id),/Once stok/);await assert.rejects(finalize(id),/teyidi eksik/);
});
test('verified positive request finalizes once, preserves stock and separates shipping/immutable evidence',async()=>{
 const id=await request();await cost(id);await verify(id);await accept(id);const oid=(await finalize(id)).rows[0].id;
 assert.equal((await finalize(id)).rows[0].id,oid);confirmedRequest=id;confirmedOrder=oid;
 const r=(await db.query('select * from supply_requests where id=$1',[id])).rows[0];assert.equal(r.status,'confirmed');assert.ok(Number(r.confirmed_snapshot.contribution)>0);assert.equal(r.confirmed_snapshot.confirmed_by,'00000000-0000-4000-8000-000000000001');
 const o=(await db.query('select * from orders where id=$1',[oid])).rows[0];assert.equal(o.supply_request_id,id);assert.equal(Number(o.toplam),3719);
 assert.equal(Number((await db.query('select fiyat from order_items where order_id=$1',[oid])).rows[0].fiyat),3619);
 await owner();assert.equal((await db.query('select stok from products where id=$1',[product])).rows[0].stok,0);
});
test('legacy endpoints cannot forge supply headers/items or mutate finalized price and lines',async()=>{
 await db.exec('set role anon');await assert.rejects(db.query("insert into orders(toplam,durum,kanal,supply_request_id) values(1,'onaylandi','whatsapp_supply',$1)",[confirmedRequest]),/Verified supply/);
 await user();await assert.rejects(db.query("update orders set durum='teslim' where id=$1",[confirmedOrder]),/unauthorised/);
 await admin();await assert.rejects(db.query('update orders set toplam=1 where id=$1',[confirmedOrder]),/immutable/);
 await owner(); // Bypass RLS only in this local fixture to verify the trigger defence itself.
 await assert.rejects(db.query('update order_items set product_id=1 where order_id=$1',[confirmedOrder]),/immutable/);
 await assert.rejects(db.query('delete from orders where id=$1',[confirmedOrder]),/retained/);
 await assert.rejects(db.query('delete from order_items where order_id=$1',[confirmedOrder]),/retained/);
 await assert.rejects(db.query("insert into order_items(order_id,product_id,ad,fiyat) values($1,1,'smuggled',1)",[confirmedOrder]),/Verified supply/);
 await admin();await db.query("update orders set durum='kargolandi' where id=$1",[confirmedOrder]);
});
test('administrator also cannot silently change approved supply price or image licence',async()=>{
 await admin();await assert.rejects(db.query('update products set outlet_fiyat=4000 where id=$1',[product]),/Approved price/);
 await assert.rejects(db.query("update products set gorsel_url='https://unapproved.example.invalid/img.png' where id=$1",[product]),/image publication approval/);
});
test('normal stocked cart/order insert still works and physical stock counters remain unchanged',async()=>{
 await owner();const stock=(await db.query('select stok from products where id=1')).rows[0].stok;
 const oid='00000000-0000-4000-8000-000000000020';await db.exec('set role anon');
 await db.query("insert into orders(id,toplam,durum,kanal) values($1,100,'whatsapp_bekliyor','whatsapp')",[oid]);
 await db.query("insert into order_items(order_id,product_id,ad,fiyat,adet) values($1,1,'LOCAL NORMAL CART',100,1)",[oid]);
 await admin();await db.query("update orders set durum='onaylandi' where id=$1",[oid]);
 await owner();assert.equal((await db.query('select stok from products where id=1')).rows[0].stok,stock);
});
test('stocked products retain their non-null reference-price invariant',async()=>{
 await owner();await assert.rejects(db.query('update products set perakende_fiyat=null where id=1'),/products_stock_reference_required/);
});
test('supplier unavailable stops finalization after written customer notification reference',async()=>{
 const id=await request();await cost(id);await db.query("select record_supply_check($1,'stop','LOCAL supplier unavailable notice to customer')",[id]);await assert.rejects(finalize(id),/durdurulmus/);
});
test('rollback pauses new supply without deleting real-order-shaped fixtures or evidence; rerun stays inactive',async()=>{
 const before=await counts();await assert.rejects(db.exec(read('supabase/production-pause-brabantia.sql')),/rollback approval/);await db.exec('rollback');
 await db.exec("select set_config('cadde_depo.rollback_approval_ref','LOCAL-ROLLBACK',false)");await db.exec(read('supabase/production-pause-brabantia.sql'));
 assert.deepEqual(await counts(),before);assert.equal((await db.query('select id from orders where id=$1',[confirmedOrder])).rows[0].id,confirmedOrder);
 assert.equal((await db.query('select confirmed_snapshot from supply_requests where id=$1',[confirmedRequest])).rows[0].confirmed_snapshot.product_price,3619);
 await assert.rejects(request(),/Aktif tedarik/);await prepare();await db.exec(migration);
 assert.equal((await db.query('select aktif from products where id=$1',[product])).rows[0].aktif,false);
});
test('preview SQL guard and production runtime isolation remain unchanged',()=>{
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync('supabase/order-on-demand.sql')).digest('hex'),'134e3cf23a736c9868dc8dc409293ddd72478de080a23f86c7e2b2f1c8e11786');
 for(const file of ['supabase/order-on-demand.production.sql','supabase/production-activate-brabantia.sql','supabase/production-pause-brabantia.sql'])assert.doesNotMatch(read(file).replace(/--[^\n]*/g,''),/\b(truncate|delete from|drop table)\b/i);
 assert.ok(!read('package.json').includes('order-on-demand.production.sql'));
});
