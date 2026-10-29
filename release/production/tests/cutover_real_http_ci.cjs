'use strict';
// Ephemeral GitHub Actions PostgreSQL16 only. Managed Supabase connections forbidden.
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawnSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const gateway=require('../../../api/cadde-order-v3.js');
if(process.env.CADDE_CI_ISOLATED!=='1'||process.env.GITHUB_ACTIONS!=='true'||
 process.env.PGHOST!=='127.0.0.1'||process.env.PGPORT!=='5432'||
 process.env.PGDATABASE!=='cadde_ci'||process.env.PGUSER!=='postgres')
 throw Error('REFUSE_NONDISPOSABLE_DB');
const prod='https://svyqmmivhpfiuhxnmhny.supabase.co/rest/v1/rpc/create_whatsapp_request_protected_v3';
const cf='https://challenges.cloudflare.com/turnstile/v0/siteverify';
const nativeFetch=global.fetch,seen=new Set();
let calls=0,server,port;
const sql=statement=>{
 const result=spawnSync('psql',['-X','-A','-t','-q','-v','ON_ERROR_STOP=1'],{
  input:statement,encoding:'utf8',env:{...process.env,PGAPPNAME:'cd-synthetic-cutover-ci'}});
 if(result.status!==0)throw Error('ISOLATED_PSQL_FAILED '+String(result.stderr).slice(-500));
 return result.stdout.trim();
};
async function direct(id){
 const response=await nativeFetch('http://127.0.0.1:3002/orders',{
 method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=minimal'},
 body:JSON.stringify({id,toplam:33000,durum:'whatsapp_bekliyor',kanal:'whatsapp'}),
 signal:AbortSignal.timeout(7000)});
 return response.status;
}
const names=['VERCEL','VERCEL_ENV','CADDE_DEPLOY_STAGE','CADDE_ORDER_API_ENABLED',
 'CADDE_EXPECTED_SUPABASE_REF','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY',
 'TURNSTILE_SECRET_KEY','TURNSTILE_SITE_KEY','CADDE_RATE_SALT'];
const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));
global.fetch=async (url,opts)=>{
 calls++;
 if(url===cf){
  const token=JSON.parse(opts.body).response;
  const success=token?.startsWith('ci-token-')&&!seen.has(token);
  if(success)seen.add(token);
  return {ok:true,json:async()=>({success,hostname:'caddedepo.com',action:'checkout'})};
 }
 if(url===prod){
  // Never fetch the production URL. Rewrite ONLY this exact call to localhost.
  return nativeFetch('http://127.0.0.1:3001/rpc/create_whatsapp_request_protected_v3',{
   method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
   body:opts.body,signal:AbortSignal.timeout(9000)});
 }
 throw Error('FORBIDDEN_UPSTREAM_DESTINATION');
};
function request(body){
 const data=JSON.stringify(body);
 return new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:'/api/cadde-order-v3',method:'POST',
   headers:{Host:'caddedepo.com',Origin:'https://caddedepo.com',
    'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),
    'x-vercel-forwarded-for':'203.0.113.71'}},res=>{
    let value='';res.on('data',b=>value+=b);
    res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(value)});}
    catch(e){reject(e);}});
   });
  req.on('error',reject);req.end(data);
 });
}
const body=(v,k,t)=>({productIds:[5],expectedTotal:33000,
 visitorId:v,idempotencyKey:k,turnstileToken:t});
const snapshot=()=>JSON.parse(sql("SELECT json_build_object("+
 "'orders',(SELECT count(*) FROM public.orders),"+
 "'trusted',(SELECT count(*) FROM cadde_internal.trusted_checkout_orders),"+
 "'dedup',(SELECT count(*) FROM cadde_internal.whatsapp_request_dedup),"+
 "'stock',(SELECT stok FROM public.products WHERE id=5))::text;"));
(async()=>{
 // Simulate legacy policies on the synthetic CI database, then verify a real
 // PostgREST anonymous HTTP insert succeeds before switching permissions.
 sql([
 'ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;',
 'ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;',
 'GRANT USAGE ON SCHEMA public TO anon,authenticated;',
 'GRANT INSERT ON public.orders,public.order_items TO anon,authenticated;',
 'GRANT UPDATE ON public.orders TO authenticated;',
 'CREATE POLICY ci45_legacy_orders ON public.orders FOR INSERT TO anon,authenticated WITH CHECK(true);',
 'CREATE POLICY ci45_legacy_items ON public.order_items FOR INSERT TO anon,authenticated WITH CHECK(true);'
 ].join('\n'));
 const legacyId=randomUUID();
 assert.equal(await direct(legacyId),201);
 assert.equal(sql("SELECT count(*) FROM public.orders WHERE id='"+legacyId+"'"),'1');
 console.log('PASS legacy anonymous HTTP write reproducible on synthetic fixture');
 // Separate committed transaction: PostgREST opens independent DB connections.
 // This cannot run on Production; the entire CI database is disposable.
 sql([
 'DROP POLICY ci45_legacy_orders ON public.orders;',
 'DROP POLICY ci45_legacy_items ON public.order_items;',
 'REVOKE INSERT,UPDATE,DELETE ON public.orders,public.order_items FROM anon,authenticated;'
 ].join('\n'));
 assert.ok((await direct(randomUUID()))>=400,'Direct anon HTTP path still writable');
 assert.equal(sql("SELECT has_table_privilege('authenticated','public.orders','UPDATE')"),'f');
 console.log('PASS committed CI revocation blocks legacy HTTP and direct admin UPDATE');
 const before=snapshot();
 Object.assign(process.env,{VERCEL:'1',VERCEL_ENV:'production',
  CADDE_DEPLOY_STAGE:'production',CADDE_ORDER_API_ENABLED:'off',
  CADDE_EXPECTED_SUPABASE_REF:'svyqmmivhpfiuhxnmhny',
  SUPABASE_URL:'https://svyqmmivhpfiuhxnmhny.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'ci-fake-not-production-secret-123456789',
  TURNSTILE_SECRET_KEY:'ci-fake-not-production-turnstile-123456789',
  TURNSTILE_SITE_KEY:'ci-public-sitekey',
  CADDE_RATE_SALT:'ci-fake-isolated-hmac-salt-32-chars-minimum'});
 server=http.createServer(gateway);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 port=server.address().port;
 const visitor=randomUUID(),key=randomUUID();
 const disabled=await request(body(visitor,key,'ci-token-disabled'));
 assert.equal(disabled.status,503);
 assert.equal(disabled.data.error,'ORDER_API_DISABLED');
 assert.equal(calls,0,'Gate-off generated network I/O');
 console.log('PASS candidate route gate off is 503 with zero upstream calls');
 process.env.CADDE_ORDER_API_ENABLED='on';
 process.env.VERCEL_ENV='preview';
 const preview=await request(body(visitor,key,'ci-token-preview'));
 assert.equal(preview.status,503);
 assert.equal(calls,0,'Preview reached upstream');
 console.log('PASS Preview fails closed under production-shaped credentials');
 process.env.VERCEL_ENV='production';
 const first=await request(body(visitor,key,'ci-token-first'));
 assert.equal(first.status,201,JSON.stringify(first));
 assert.equal(first.data.reused,false);
 const second=await request(body(visitor,key,'ci-token-second'));
 assert.equal(second.status,200,JSON.stringify(second));
 assert.equal(second.data.request_id,first.data.request_id);
 assert.equal(second.data.reused,true);
 assert.deepEqual(Object.keys(second.data).sort(),['request_id','reused','total']);
 const after=snapshot();
 assert.equal(after.orders,before.orders+1);
 assert.equal(after.trusted,before.trusted+1);
 assert.equal(after.dedup,before.dedup+1);
 assert.equal(after.stock,before.stock,'Checkout request reserved stock');
 assert.ok((await direct(randomUUID()))>=400,'Legacy anon write reopened');
 console.log('PASS real HTTP gated gateway -> real local PostgREST v3 after committed revocation');
 console.log('PASS 201/200 idempotency, one attested order, no stock change');
 console.log('CUTOVER_REAL_HTTP_ISOLATED_PASS');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 global.fetch=nativeFetch;
 for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 if(server)await new Promise(resolve=>server.close(resolve));
});
