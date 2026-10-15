const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const h=require('./helpers/security-db.cjs');
let db,legacy,legacyConfirmed,firstReceipt;let actor=0;
const make=async(items=[{id:1,quantity:1}],key=randomUUID(),hash=(++actor).toString(16).padStart(64,'0'),kind='stock')=>{
 await h.service(db);return (await db.query('select create_checkout_request($1,$2,$3,$4) result',[JSON.stringify(items),key,hash,kind])).rows[0].result;
};
const status=(id,s='onaylandi',ref='LOCAL WRITTEN ACCEPTANCE')=>db.query('select admin_set_checkout_status($1,$2,$3)',[id,s,ref]);
const counts=async()=>{await h.owner(db);return (await db.query('select (select count(*) from orders) orders,(select count(*) from order_items) items,(select count(*) from checkout_requests) requests')).rows[0];};
before(async()=>{db=await h.bootstrap();});after(async()=>db?.close());
test('phase A blocks missing approval and preserves old direct-write checkout',async()=>{
 await assert.rejects(db.exec(h.read('supabase/security-foundation.sql')),/WRONG_TARGET/);await db.exec('rollback');
 await h.owner(db);await db.exec('grant service_role to authenticated');await h.evidence(db);await assert.rejects(db.exec(h.read('supabase/security-foundation.sql')),/INHERITED_SERVER_ROLE/);await db.exec('rollback');await db.exec('revoke service_role from authenticated');
 await h.evidence(db);await db.exec(h.read('supabase/security-foundation.sql'));
 await h.anon(db);legacy=randomUUID();await db.query("insert into orders(id,toplam) values($1,1)",[legacy]);await db.query("insert into order_items(order_id,product_id,ad,fiyat) values($1,1,'OLD FRONTEND',1)",[legacy]);
 // Deliberately demonstrate the reported existing vulnerability before cutover.
 await h.owner(db);legacyConfirmed=randomUUID();await db.query("insert into orders(id,toplam,durum) values($1,100,'onaylandi')",[legacyConfirmed]);
 await h.user(db);await db.query("update products set kondisyon='Açık Kutu' where id=1");
});
test('secure quote uses DB prices, groups duplicates, is atomic and does not reserve stock',async()=>{
 const before=await counts();const receipt=await make([{id:1,quantity:1},{id:1,quantity:1}]);firstReceipt=receipt;
 assert.equal(Number(receipt.total),200);assert.equal(Number(receipt.items[0].unitPrice),100);assert.equal(receipt.items[0].quantity,2);
 await h.owner(db);assert.equal((await db.query('select stok from products where id=1')).rows[0].stok,2);
 const now=await counts();assert.equal(now.orders,before.orders+1);assert.equal(now.items,before.items+1);assert.equal(now.requests,before.requests+1);
 const snapshot=await counts();await assert.rejects(make([{id:1,quantity:1},{id:2,quantity:1}]),/PRODUCT_UNAVAILABLE/);assert.deepEqual(await counts(),snapshot);
});
test('browser-supplied prices, inactive products, invalid quantities and direct RPC calls are rejected',async()=>{
 await assert.rejects(make([{id:1,quantity:1,price:1}]),/INVALID_CART/);await assert.rejects(make([{id:1,quantity:11}]),/INVALID_CART/);
 await assert.rejects(make([{id:1,quantity:3}]),/STOCK_UNAVAILABLE/);
 await h.anon(db);await assert.rejects(db.query("select create_checkout_request('[{\"id\":1,\"quantity\":1}]',$1,$2,'stock')",[randomUUID(),'a'.repeat(64)]),/permission denied/);
});
test('same key/actor/payload replays once; altered payload or actor cannot reuse a receipt',async()=>{
 const key=randomUUID(),hash='b'.repeat(64);const a=await make(undefined,key,hash),b=await make(undefined,key,hash);assert.equal(a.id,b.id);
 await assert.rejects(make([{id:1,quantity:2}],key,hash),/IDEMPOTENCY_CONFLICT/);await assert.rejects(make(undefined,key,'c'.repeat(64)),/IDEMPOTENCY_CONFLICT/);
});
test('database quota is atomic and requests cannot exhaust physical inventory',async()=>{
 const hash='d'.repeat(64);for(let i=0;i<5;i++)await make(undefined,randomUUID(),hash);
 const before=await counts();await assert.rejects(make(undefined,randomUUID(),hash),/RATE_LIMITED/);assert.deepEqual(await counts(),before);
 await h.owner(db);assert.equal((await db.query('select stok from products where id=1')).rows[0].stok,2);
});
test('a failure during item insertion rolls back the new header and idempotency record',async()=>{
 await h.owner(db);await db.exec("create function public.LOCAL_fail_item() returns trigger language plpgsql as $$begin raise exception 'LOCAL_ITEM_FAIL';end$$;create trigger zz_LOCAL_fail before insert on order_items for each row execute function public.LOCAL_fail_item();");
 const before=await counts();await assert.rejects(make(),/LOCAL_ITEM_FAIL/);assert.deepEqual(await counts(),before);
 await db.exec('drop trigger zz_LOCAL_fail on order_items;drop function public.LOCAL_fail_item()');
});
test('phase B refuses absent admin verification and mismatched live metadata',async()=>{
 await h.evidence(db,{admin_role_verification_ref:''});await assert.rejects(db.exec(h.read('supabase/security-cutover.sql')),/(?:CUTOVER_EVIDENCE_REQUIRED|SECURITY_APPROVAL_REQUIRED)/);await db.exec('rollback');
 await h.evidence(db,{verified_admin_ids:'00000000-0000-4000-8000-000000000002'});await assert.rejects(db.exec(h.read('supabase/security-cutover.sql')),/ADMIN_ROLE_MISMATCH/);await db.exec('rollback');
 await h.owner(db);await db.exec('create function public.LOCAL_unreviewed() returns int language sql security definer as $$select 1$$');await h.evidence(db);await assert.rejects(db.exec(h.read('supabase/security-cutover.sql')),/UNREVIEWED_EXPOSED_RPC/);await db.exec('rollback');await db.exec('drop function public.LOCAL_unreviewed()');
 await h.evidence(db);await db.exec(h.read('supabase/security-cutover.sql'));
});
test('published reads remain anonymous; only verified admins can mutate products/read orders and items',async()=>{
 await h.anon(db);assert.equal((await db.query('select id from products where id=2')).rows.length,0);assert.ok((await db.query('select id from products where id=1')).rows.length);
 for(const t of ['orders','order_items'])await assert.rejects(db.query('select * from '+t),/permission denied/);
 await h.user(db);assert.equal((await db.query('select * from orders')).rows.length,0);assert.equal((await db.query('select * from order_items')).rows.length,0);
 const u=await db.query('update products set outlet_fiyat=1 where id=1 returning id');assert.equal(u.rows.length,0);
 await assert.rejects(db.query("insert into products(ana_kategori,ad,perakende_fiyat,outlet_fiyat,stok,max_stok,kondisyon) values('A','evil',1,1,0,1,'A')"),/row-level security/);
 await h.admin(db);assert.ok((await db.query('select * from orders')).rows.length);assert.ok((await db.query('select id from products where id=2')).rows.length);
 await db.query("update products set kondisyon='Sıfır' where id=1");
});
test('direct API writes, fake order items and TRUNCATE privileges are absent after cutover',async()=>{
 for(const role of [h.anon,h.user,h.admin]){
  await role(db);await assert.rejects(db.query("insert into orders(toplam) values(1)"),/permission denied/);await assert.rejects(db.query("insert into order_items(order_id,ad,fiyat) values($1,'forged',1)",[legacy]),/permission denied/);
 }
 await h.owner(db);for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_table_privilege($1,'orders','TRUNCATE') b",[role])).rows[0].b,false);
});
test('Storage image CRUD/listing is admin-only in urunler; other buckets are unaffected',async()=>{
 for(const who of [h.anon,h.user]){await who(db);assert.equal((await db.query("select * from storage.objects where bucket_id='urunler'")).rows.length,0);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('urunler','attack.png')"),/row-level security/);
  assert.equal((await db.query("delete from storage.objects where bucket_id='urunler' returning id")).rows.length,0);
  assert.equal((await db.query("update storage.objects set name='attack' where bucket_id='urunler' returning id")).rows.length,0);
  assert.ok((await db.query("select * from storage.objects where bucket_id='other-app'")).rows.length);
 }
 await h.owner(db);assert.equal((await db.query("select has_table_privilege('authenticated','storage.objects','TRUNCATE') b")).rows[0].b,false);
 await h.admin(db);const image=(await db.query("insert into storage.objects(bucket_id,name) values('urunler','LOCAL.png') returning id")).rows[0].id;
 await db.query('delete from storage.objects where id=$1',[image]);
});
test('revoked admin metadata immediately defeats stale JWT and user_metadata spoofing',async()=>{
 await h.owner(db);await db.query("update auth.users set raw_app_meta_data='{}' where id=$1",[h.adminId]);await h.admin(db);
 assert.equal((await db.query('select is_cadde_admin() b')).rows[0].b,false);assert.equal((await db.query('select * from orders')).rows.length,0);await assert.rejects(status(firstReceipt.id),/ADMIN_REQUIRED/);
 await h.owner(db);await db.query("update auth.users set raw_app_meta_data='{\"role\":\"admin\"}' where id=$1",[h.adminId]);
});
test('expired quotes and changed catalog prices cannot be silently confirmed',async()=>{
 const expired=await make(),changed=await make();await h.owner(db);await db.query("update checkout_requests set expires_at=now()-interval '1 second' where order_id=$1",[expired.id]);
 await h.admin(db);await assert.rejects(status(expired.id),/FRESH_QUOTE/);await h.owner(db);await db.exec('update products set outlet_fiyat=101 where id=1');await h.admin(db);await assert.rejects(status(changed.id),/STOCK_OR_PRICE_CHANGED/);
 await h.owner(db);await db.exec('update products set outlet_fiyat=100 where id=1');
});
test('admin confirmation needs fresh written acceptance and deducts stock once under locks',async()=>{
 await h.admin(db);await assert.rejects(status(firstReceipt.id,'onaylandi',''),/WRITTEN_ACCEPTANCE/);await status(firstReceipt.id);await status(firstReceipt.id);
 await h.owner(db);assert.equal((await db.query('select stok from products where id=1')).rows[0].stok,0);
 await h.admin(db);await status(firstReceipt.id,'iptal');await h.owner(db);assert.equal((await db.query('select stok from products where id=1')).rows[0].stok,0);
});
test('competing pending quotes cannot both confirm the last unit (single-session engine)',async()=>{
 await h.owner(db);await db.exec('update products set stok=1 where id=1');const a=await make(),b=await make();await h.admin(db);
 const outcomes=await Promise.allSettled([status(a.id),status(b.id)]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.match(outcomes.find(o=>o.status==='rejected').reason.message,/STOCK_OR_PRICE_CHANGED/);
 await h.owner(db);assert.equal((await db.query('select stok from products where id=1')).rows[0].stok,0);
});
test('direct/admin/legacy-definer bypass cannot alter frozen totals or create unlinked rows',async()=>{
 await h.admin(db);await assert.rejects(db.query('update orders set toplam=1 where id=$1',[firstReceipt.id]),/CHECKOUT_RPC_REQUIRED/);
 await h.owner(db);await db.exec("create function public.LOCAL_unsafe_rpc() returns void language plpgsql security definer as $$begin insert into orders(toplam) values(1);end$$;grant execute on function public.LOCAL_unsafe_rpc() to anon;");
 await h.anon(db);await assert.rejects(db.query('select public.LOCAL_unsafe_rpc()'),/CHECKOUT_RPC_REQUIRED/);
 await h.owner(db);await assert.rejects(db.query('delete from orders where id=$1',[firstReceipt.id]),/ORDER_RECORD_RETAINED/);await db.exec('drop function public.LOCAL_unsafe_rpc()');
});
test('old pending requests are retained and require reconciliation; already-confirmed legacy shipping still works',async()=>{
 await h.admin(db);await assert.rejects(status(legacy),/LEGACY_RECONCILIATION_REQUIRED/);await status(legacy,'iptal');await status(legacyConfirmed,'kargolandi');await status(legacyConfirmed,'teslim');
 await h.owner(db);assert.ok((await db.query('select id from orders where id=$1',[legacy])).rows.length);
});
test('cutover reruns without duplication and does not restore permissive grants',async()=>{
 const before=await counts();await h.evidence(db);await db.exec(h.read('supabase/security-cutover.sql'));assert.deepEqual(await counts(),before);
 await h.anon(db);await assert.rejects(db.query("insert into orders(toplam) values(1)"),/permission denied/);
});
test('Brabantia production migration remains inactive and supply uses protected server request after cutover',async()=>{
 await h.evidence(db);await db.exec(h.read('supabase/order-on-demand.production.sql'));
 const p=(await db.query("select * from products where sku='BRABANTIA-385728'")).rows[0];assert.equal(p.aktif,false);assert.equal(Number(p.outlet_fiyat),3619);assert.equal(p.stok,0);
 await h.anon(db);await assert.rejects(db.query('select create_supply_request($1)',[p.id]),/permission denied/);
 // Local synthetic licence/publication proof only. No real activation or customer data.
 await h.owner(db);await db.query("update products set gorsel_url='https://licensed.example.invalid/LOCAL.png' where id=$1",[p.id]);
 await db.exec("select set_config('cadde_depo.publication_approval_ref','LOCAL',false),set_config('cadde_depo.image_permission_ref','LOCAL',false)");await db.exec(h.read('supabase/production-activate-brabantia.sql'));
 const receipt=await make([{id:Number(p.id),quantity:1}],undefined,undefined,'supply');assert.equal(Number(receipt.total),3619);
 await h.owner(db);assert.equal((await db.query('select stok from products where id=$1',[p.id])).rows[0].stok,0);
});
