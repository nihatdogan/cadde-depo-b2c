'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireAdmin } = require('../api/_lib/admin-auth');
const checkout = require('../api/checkout-request');
const whoami = require('../api/admin/whoami');
const upload = require('../api/admin/upload-product-image');

const base = {SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'SERVER_ONLY_KEY', CADDE_DEPLOY_STAGE:'preview', CADDE_EXPECTED_SUPABASE_REF:'aaaaaaaaaaaaaaaaaaaa'};
function req(headers={}, body={}, method='POST') {return {method, headers, body};}
function response(){return {code:0,body:null,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(data){this.body=data;return this}}}
const login = {id:'user-uuid',email:'admin@example.com',app_metadata:{role:'admin'}};

// req user string comes from server returned Auth record, not caller's payload.
test('admin guard fails closed without JWT', async()=>{
  let r=await requireAdmin(req(),base);assert.equal(r.status,401);
});
test('server Auth refuses ordinary authenticated users',async()=>{
  const fetcher=async()=>({ok:true,json:async()=>({...login,app_metadata:{role:'customer'},user_metadata:{role:'admin'}})});
  let r=await requireAdmin(req({authorization:'Bearer access-token'}),base,fetcher);
  assert.equal(r.status,403);
});
test('server Auth accepts app_metadata.admin and respects optional second allowlist',async()=>{
  const fetcher=async()=>({ok:true,json:async()=>login});
  let r=await requireAdmin(req({authorization:'Bearer access-token'}),base,fetcher);
  assert.equal(r.status,200);
  r=await requireAdmin(req({authorization:'Bearer access-token'}),{...base,ADMIN_EMAILS:'someone@example.com'},fetcher);
  assert.equal(r.status,403);
  r=await requireAdmin(req({authorization:'Bearer access-token'}),{...base,ADMIN_EMAILS:'admin@example.com'},fetcher);
  assert.equal(r.status,200);
});
test('admin guard rejects invalid remote token',async()=>{
  let r=await requireAdmin(req({authorization:'Bearer bad-token'}),base,async()=>({ok:false}));
  assert.equal(r.status,401);
});

test('checkout rejects untrusted prices and invalid item data',async()=>{
  assert.equal(checkout.checkItems([{product_id:29,adet:1}]),true);
  assert.equal(checkout.checkItems([{product_id:29,adet:1,price:0}]),true); // ignored on server
  assert.equal(checkout.checkItems([{product_id:29,adet:-1}]),false);
  assert.equal(checkout.checkItems([{product_id:29,adet:50}]),false);
  assert.equal(checkout.checkItems([{product_id:'29',adet:1}]),false);
});

test('checkout status: correct origin success, wrong origin denied, missing env refused',async()=>{
  const envVars=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CADDE_ALLOWED_ORIGIN','CADDE_DEPLOY_STAGE','CADDE_EXPECTED_SUPABASE_REF'];
  const before=Object.fromEntries(envVars.map(k=>[k,process.env[k]]));
  Object.assign(process.env,base,{CADDE_ALLOWED_ORIGIN:'https://preview.example.com'});
  const prev=global.fetch;
  let rpcBody;
  global.fetch=async(_,opts)=>{rpcBody=JSON.parse(opts.body);return {ok:true,json:async()=>({order_id:'a7571bd7-e9cf-454a-a077-a84145099192',product_subtotal:23990})}};
  const request={request_id:'a7571bd7-e9cf-454a-a077-a84145099192',items:[{product_id:29,adet:1}],total:1,price:0};
  try{
    let r=response();await checkout(req({origin:'https://evil.com','content-type':'application/json'},request),r);
    assert.equal(r.code,403);
    r=response();await checkout(req({origin:'https://preview.example.com','content-type':'application/json'},request),r);
    assert.equal(r.code,201);assert.equal(r.body.product_subtotal,23990);assert.equal(r.body.stock_reserved,false);
    assert.deepEqual(rpcBody,{p_request_id:request.request_id,p_lines:request.items});
    delete process.env.CADDE_ALLOWED_ORIGIN;
    r=response();await checkout(req({origin:'https://preview.example.com','content-type':'application/json'},request),r);
    assert.equal(r.code,503);
  }finally{global.fetch=prev;for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v}}
});

test('admin endpoints fail closed without preview config or auth',async()=>{
  let r=response();await whoami(req({},null,'GET'),r);assert.equal(r.code,503);
  r=response();await upload(req({},null,'POST'),r);assert.equal(r.code,503);
});

test('SQL RPC is atomic-in-one-function, role-scoped, and does not decrement stock',()=>{
  const p=path.join(__dirname,'../supabase/migrations/20261016_preview_checkout_rpc.sql');
  const sql=fs.readFileSync(p,'utf8');
  assert.match(sql,/REVOKE ALL ON FUNCTION.*PUBLIC, anon, authenticated/i);
  assert.match(sql,/GRANT EXECUTE.*service_role/i);
  assert.match(sql,/INSERT INTO public.orders/);
  assert.match(sql,/INSERT INTO public.order_items/);
  assert.doesNotMatch(sql,/UPDATE\s+public\.products\s+SET\s+stok/i);
});

test('preview blocks known production Supabase ref',()=>{
 const {previewEnvironmentReady}=require('../api/_lib/preview-only');
 assert.equal(previewEnvironmentReady({...base, SUPABASE_URL:'https://svyqmmivhpfiuhxnmhny.supabase.co',CADDE_EXPECTED_SUPABASE_REF:'svyqmmivhpfiuhxnmhny'}), false);
 assert.equal(previewEnvironmentReady(base),true);
});
