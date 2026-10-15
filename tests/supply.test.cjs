const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
let db,product;
const read=p=>fs.readFileSync(p,'utf8');
const admin="set role authenticated; select set_config('request.jwt.claims','{\"app_metadata\":{\"role\":\"admin\"}}',false);";
const regular="set role authenticated; select set_config('request.jwt.claims','{\"app_metadata\":{}}',false);";
async function request(){await db.exec('set role anon;');return (await db.query('select public.create_supply_request($1) id',[product])).rows[0].id;}
async function costs(id,overrides={}){await db.exec(admin);const c={vat_rate:0.2,purchase_net:2000,inbound:20,fees:70,packing:20,outbound_net:0,ads:50,risk:50,minimum_contribution:100,supplier_ref:'TEST-QUOTE',...overrides};await db.query('select public.save_supply_costs($1,$2,100,\'Teyitli teslimat\')',[id,JSON.stringify(c)]);}
async function verify(id){await db.query("select public.record_supply_check($1,'verify','stok ve iki duvar uygunlugu teyit')",[id]);}
async function accept(id){await db.query("select public.record_supply_check($1,'accept','3619 + 100 kargo, montaj haric, teslimat kabul')",[id]);}
const finalize=id=>db.query('select public.finalize_supply_request($1) id',[id]);
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
 grant usage on schema auth to anon,authenticated;`);
 await db.exec(read('supabase-schema.sql'));
 await db.exec(read('supabase-admin.sql').split('-- 4) Storage:')[0]);
 // Supabase provides table DML grants by default; standalone PostgreSQL does not.
 await db.exec('grant update,insert,delete on products to authenticated; grant update on orders to authenticated;');
 await db.exec(read('supabase/products-detail.sql'));
 await db.exec(read('supabase/products-slug.sql'));
 await db.exec("select set_config('cadde_depo.migration_environment','preview',false),set_config('cadde_depo.preview_project_ref','abcdefghijklmnopqrst',false);");
 await db.exec(read('supabase/order-on-demand.sql'));
 await db.exec(read('supabase/order-on-demand.sql')); // idempotence
 product=(await db.query("select id from products where sku='BRABANTIA-385728'")).rows[0].id;
});
after(async()=>db?.close());
test('approved product, category, zero physical stock and no old price',async()=>{
 await db.exec('reset role');const p=(await db.query('select * from products where id=$1',[product])).rows[0];
 assert.equal(Number(p.outlet_fiyat),3619);assert.equal(p.perakende_fiyat,null);assert.equal(p.stok,0);
 assert.equal(p.ana_kategori,'EV / YAŞAM');assert.equal(p.alt_kategori,'Ev Gereçleri');assert.equal(p.aktif,true);
 assert.equal(p.fulfillment_mode,'ORDER_ON_DEMAND');assert.equal(p.image_rights_status,'PENDING_PERMISSION');
});
test('anonymous request creates no order; costs cannot be read or written',async()=>{
 await db.exec('reset role');const before=(await db.query('select count(*) n from orders')).rows[0].n;
 const id=await request();assert.ok(id);await assert.rejects(db.query('select * from supply_costs'),/permission denied/);
 await assert.rejects(db.query('insert into supply_costs(request_id) values($1)',[id]),/permission denied/);
 await assert.rejects(finalize(id),/permission denied/);
 await db.exec('reset role');assert.equal((await db.query('select count(*) n from orders')).rows[0].n,before);
});
test('ordinary authenticated user cannot read costs or finalize',async()=>{
 const id=await request();await costs(id);await db.exec(regular);
 assert.equal((await db.query('select * from supply_costs')).rows.length,0);
 await assert.rejects(finalize(id),/Yetkili yonetici/);
});
test('missing cost and negative contribution block finalization',async()=>{
 const id=await request();await costs(id,{risk:null});await verify(id);await accept(id);
 await assert.rejects(finalize(id),/Maliyet dogrulanmadi/);
 await costs(id,{purchase_net:4000});await verify(id);await accept(id);
 await assert.rejects(finalize(id),/yetersiz katki/);
});
test('supplier, acceptance, updated quotes, stale stock all fail closed',async()=>{
 const id=await request();await costs(id);await assert.rejects(finalize(id),/teyidi eksik/);
 await verify(id);await assert.rejects(finalize(id),/teyidi eksik/);
 await accept(id);await costs(id);await assert.rejects(finalize(id),/teyidi eksik/);
 await verify(id);await accept(id);await db.exec('reset role');await db.query("update supply_requests set supplier_checked_at=now()-interval '25 hours' where id=$1",[id]);await db.exec(admin);
 await assert.rejects(finalize(id),/teyidi eksik/);
});
test('positive, verified request finalizes once with separate shipping and audit',async()=>{
 const id=await request();await costs(id);await verify(id);await accept(id);
 const oid=(await finalize(id)).rows[0].id;assert.equal((await finalize(id)).rows[0].id,oid);
 const r=(await db.query('select * from supply_requests where id=$1',[id])).rows[0];
 assert.equal(r.status,'confirmed');assert.ok(r.confirmed_snapshot.costs);assert.ok(Number(r.confirmed_snapshot.contribution)>0);
 assert.equal(Number((await db.query('select toplam from orders where id=$1',[oid])).rows[0].toplam),3719);
 assert.equal(Number((await db.query('select fiyat from order_items where order_id=$1',[oid])).rows[0].fiyat),3619);
 assert.equal((await db.query('select stok from products where id=$1',[product])).rows[0].stok,0);
});
test('unavailable supplier stops safely and cannot finalize',async()=>{
 const id=await request();await costs(id);await db.query("select record_supply_check($1,'stop','Musteri bilgilendirildi')",[id]);
 await assert.rejects(finalize(id),/durdurulmus/);
});
test('old cart cannot bypass checks; normal inventory orders still work',async()=>{
 await db.exec('set role anon');const oid=(await db.query("insert into orders(toplam) values(3619) returning id").catch(()=>({rows:[]}))).rows[0]?.id;
 // Anonymous INSERT RETURNING is intentionally denied by existing orders RLS.
 await db.exec('reset role');const order=(await db.query('insert into orders(toplam) values(3619) returning id')).rows[0].id;
 await db.exec('set role anon');await assert.rejects(db.query("insert into order_items(order_id,product_id,ad,fiyat) values($1,$2,'tampered',3619)",[order,product]),/yalniz teyitli/);
 await db.query("insert into order_items(order_id,product_id,ad,fiyat) values($1,1,'existing stock',100)",[order]);
});
test('approved price cannot be silently increased or reference price invented',async()=>{
 await db.exec(admin);await assert.rejects(db.query('update products set outlet_fiyat=4000 where id=$1',[product]),/korunmali/);
 await assert.rejects(db.query('update products set perakende_fiyat=5000 where id=$1',[product]),/korunmali/);
});
test('all changed JS and inline scripts compile',()=>{
 for(const f of ['on-demand.js','supply-admin.js']) new vm.Script(read(f),{filename:f});
 for(const f of ['index.html','urun.html','admin.html']) for(const m of read(f).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(m[1],{filename:f});
});
test('public request opens WhatsApp only after persisted request and closes on error',async()=>{
 let popup,alerts=0;
 const w={open(){return popup={location:{},close(){this.closed=true}}},alert(){alerts++}};
 vm.runInNewContext(read('on-demand.js'),{window:w});
 const p={id:product,nm:'Brabantia',now:3619,fulfillment_mode:'ORDER_ON_DEMAND'};
 await w.CDDemand.request({rpc:async()=>({data:'test-id'})},p,'905409077070');
 const msg=decodeURIComponent(popup.location.href);assert.match(msg,/3.619/);assert.match(msg,/Montaj dahil/);assert.match(msg,/test-id/);
 await assert.rejects(w.CDDemand.request({rpc:async()=>({error:new Error('offline')})},p,'905409077070'));
 assert.equal(popup.closed,true);assert.equal(alerts,1);
});

test('catalog filters and demand / stocked / sold-out cards render correctly',()=>{
 const html=read('index.html');const code=html.slice(html.indexOf('function render(){'),html.indexOf('function waLink(p){'));
 const grid={innerHTML:''},count={};const c={window:{},grid,document:{getElementById:()=>count},
 mainFilter:'EV / YAŞAM',subFilter:'Ev Gereçleri',products:[],fmt:n=>Number(n).toLocaleString('tr-TR')+'₺',
 disc:p=>Math.round((1-p.now/p.was)*100),condClass:()=>'',cdProductPath:p=>'/urun/'+p.id,waLink:()=>'',waHref:()=>''};
 vm.createContext(c);vm.runInContext(read('on-demand.js'),c);c.CDDemand=c.window.CDDemand;
 c.products=[{id:1,cat:'EV / YAŞAM',sub:'Ev Gereçleri',nm:'Brabantia',now:3619,was:null,stock:0,fulfillment_mode:'ORDER_ON_DEMAND',description:'22 metre',cond:'Sıfır'},
 {id:2,cat:'TELEFON',sub:'Telefon',nm:'Other category',now:100,was:200,stock:5}];
 vm.runInContext(code+';render();',c);
 assert.match(grid.innerHTML,/3.619₺/);assert.match(grid.innerHTML,/Sipariş Talebi Oluştur/);assert.match(grid.innerHTML,/Sipariş üzerine temin edilir/);
 assert.match(grid.innerHTML,/Montaj dahil değildir/);assert.match(grid.innerHTML,/Kargo ayrı/);
 assert.doesNotMatch(grid.innerHTML,/Tükendi|Stok bitti|price-was|disc-stamp|Other category|data-add=/);
 c.mainFilter='all';c.subFilter='all';c.products=[{id:2,cat:'TELEFON',sub:'Telefon',nm:'Stocked',now:100,was:200,stock:5}];
 vm.runInContext('render()',c);assert.match(grid.innerHTML,/Sepete ekle/);assert.match(grid.innerHTML,/disc-stamp/);
 c.products[0].stock=0;vm.runInContext('render()',c);assert.match(grid.innerHTML,/Tükendi/);assert.match(grid.innerHTML,/disabled/);
});
test('demand detail overrides generic free shipping and stock perks',()=>{
 const html=read('urun.html');const code=html.slice(html.indexOf('function render(p){'),html.indexOf('async function loadSimilar(p){'));
 const elements={};const $=key=>elements[key]??=( {innerHTML:'',textContent:'',hidden:true,style:{},querySelectorAll:()=>[]} );
 const c={window:{},$,document:{},WA_NUMBER:'905409077070',esc:String,condClass:()=>'',disc:()=>0,
 fmt:n=>Number(n).toLocaleString('tr-TR')+'₺',condDesc:{},setMetaDesc(){},applyCanonical(){},loadSimilar(){},cdProductUrl:()=>'/product',sb:{}};
 vm.createContext(c);vm.runInContext(read('on-demand.js'),c);c.CDDemand=c.window.CDDemand;
 vm.runInContext(code+';this.renderDetail=render;',c);
 c.renderDetail({id:1,ad:'Brabantia',outlet_fiyat:3619,stok:0,max_stok:1,fulfillment_mode:'ORDER_ON_DEMAND',aciklama:'22 metre',ana_kategori:'EV / YAŞAM',alt_kategori:'Ev Gereçleri'});
 assert.equal($('#addBtn').textContent,'Sipariş Talebi Oluştur');assert.equal($('#addBtn').disabled,false);
 assert.match($('#pdStock').innerHTML,/Sipariş üzerine/);assert.doesNotMatch($('#pdStock').innerHTML,/Stok bitti/);
 assert.doesNotMatch($('#pdPerks').innerHTML,/bedava|Ücretsiz|2–4/);assert.match($('#pdPerks').innerHTML,/Montaj/);
 assert.match($('#pdMain').innerHTML,/kullanım izni/);assert.doesNotMatch($('#pdPrice').innerHTML,/pd-was/);
});

test('RLS blocks direct request/cost mutation and user_metadata cannot grant admin',async()=>{
 const id=await request();await costs(id);
 await db.exec("set role authenticated; select set_config('request.jwt.claims','{\"user_metadata\":{\"role\":\"admin\"}}',false);");
 assert.equal((await db.query('select * from supply_requests')).rows.length,0);
 await assert.rejects(db.query("update supply_requests set status='confirmed' where id=$1",[id]),/permission denied/);
 await assert.rejects(db.query('delete from supply_costs where request_id=$1',[id]),/permission denied/);
 await assert.rejects(db.query("select record_supply_check($1,'accept','forged')",[id]),/Yetkili yonetici/);
 await assert.rejects(costsAsCurrentUser(id),/Yetkili yonetici/);
 function costsAsCurrentUser(id){return db.query("select save_supply_costs($1,'{}'::jsonb,0,'forged')",[id]);}
});
