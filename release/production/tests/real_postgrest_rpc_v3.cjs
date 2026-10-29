'use strict';
// Test real PostgREST HTTP -> actual candidate RPC v3 on disposable CI Postgres.
// External Supabase URLs and credentials are intentionally forbidden.
const assert=require('node:assert/strict');
if(process.env.CADDE_CI_ISOLATED!=='1'||
   process.env.PGDATABASE!=='cadde_ci'||process.env.PGHOST!=='127.0.0.1')
  throw Error('REFUSE: isolated ephemeral CI required');
const allow='http://127.0.0.1:3001';
const deny='http://127.0.0.1:3002';
const target='/rpc/create_whatsapp_request_protected_v3';
const ids=[
 '00000000-0000-4000-8000-00000000f701',
 '00000000-0000-4000-8000-00000000f702',
 '00000000-0000-4000-8000-00000000f703',
 '00000000-0000-4000-8000-00000000f704',
 '00000000-0000-4000-8000-00000000f705'
];
async function post(url,params){
  const response=await fetch(url+target,{method:'POST',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify(params),signal:AbortSignal.timeout(12000)});
  const data=await response.json().catch(()=>({}));
  return {status:response.status,data};
}
const req=(visitor,key,total=33000)=>({
 p_product_ids:[5],p_expected_total:total,
 p_visitor_hash:visitor.repeat(64),p_rate_hash:'9'.repeat(64),
 p_idempotency_key:key
});
(async()=>{
 const untrusted=await post(allow,req('a','00000000-0000-4000-8000-00000000a011'));
 assert.ok(untrusted.status>=400,JSON.stringify(untrusted));
 assert.match(JSON.stringify(untrusted.data),/UNTRUSTED_ORDER_SOURCE/);
 console.log('PASS old v2 untrusted checkout denied via real PostgREST HTTP');
 const [a,b]=await Promise.all([post(allow,req('7',ids[0])),post(allow,req('7',ids[0]))]);
 assert.deepEqual([a.status,b.status].sort(),[200,200],JSON.stringify([a,b]));
 assert.equal(a.data.request_id,b.data.request_id);
 assert.equal([a.data.reused,b.data.reused].filter(x=>x===false).length,1);
 console.log('PASS same-key concurrent HTTP requests idempotent');
 const c=await post(allow,req('7',ids[1]));
 assert.equal(c.status,200,JSON.stringify(c));
 assert.equal(c.data.request_id,a.data.request_id);
 assert.equal(c.data.reused,true);
 console.log('PASS distinct key same-visitor/cart reuses request');
 const d=await post(allow,req('8',ids[2]));
 assert.equal(d.status,200,JSON.stringify(d));
 assert.notEqual(d.data.request_id,a.data.request_id);
 assert.equal(d.data.reused,false);
 console.log('PASS distinct visitor on shared IP gets independent order');
 const wrong=await post(allow,req('6',ids[3],32999));
 assert.ok(wrong.status>=400,JSON.stringify(wrong));
 assert.match(JSON.stringify(wrong.data),/PRICE_CHANGED|TOTAL_MISMATCH/);
 console.log('PASS mismatch total rejected by actual REST RPC');
 const publicCall=await post(deny,req('5',ids[4]));
 assert.ok(publicCall.status>=400,JSON.stringify(publicCall));
 console.log('PASS unauthorized anon PostgREST role cannot call v3');
 const anonWrite=await fetch(deny+'/orders',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({toplam:33000,durum:'whatsapp_bekliyor',kanal:'whatsapp'}),
  signal:AbortSignal.timeout(12000)});
 assert.ok(anonWrite.status>=400,'anon table write unexpectedly allowed');
 console.log('PASS anon direct orders write blocked by real PostgREST');
 console.log('REAL_POSTGREST_RPC_V3_HTTP_CONTRACTS_PASSED');
})().catch(e=>{console.error(e);process.exitCode=1;});
