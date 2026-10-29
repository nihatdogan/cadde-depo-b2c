'use strict';
// CADDE DEPO: local HTTP -> gateway -> real PostgreSQL v3 integration.
// Disposable GitHub Actions PostgreSQL 16 only. Cloudflare and Supabase HTTP
// upstreams are simulated; the actual protected v3 SQL function is executed.
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const gateway=require('../candidate-api/whatsapp-request.cjs');

if(process.env.CADDE_CI_ISOLATED!=='1' ||
   process.env.PGHOST!=='127.0.0.1' ||
   process.env.PGDATABASE!=='cadde_ci' ||
   process.env.PGUSER!=='postgres') {
  throw Error('REFUSE: requires explicitly isolated local GitHub Actions DB');
}
Object.assign(process.env,{
  VERCEL:'1',VERCEL_ENV:'production',CADDE_DEPLOY_STAGE:'production',
  CADDE_ORDER_API_ENABLED:'on',CADDE_EXPECTED_SUPABASE_REF:'svyqmmivhpfiuhxnmhny',
  SUPABASE_URL:'https://svyqmmivhpfiuhxnmhny.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'ci-fake-server-secret-1234567890',
  TURNSTILE_SECRET_KEY:'ci-fake-turnstile-secret-1234567890',
  TURNSTILE_SITE_KEY:'ci-public-sitekey',
  CADDE_RATE_SALT:'ci-isolated-hmac-salt-at-least-32-characters'
});
const usedChallenge=new Set();
const originalFetch=global.fetch;
let forceDropKey=null,dropDone=false;
let dbCalls=0,turnstileCalls=0;
function runSQL(sql) {
  return new Promise((resolve,reject)=>{
    const child=spawn('psql',['-X','-A','-t','-q','-v','ON_ERROR_STOP=1'],{
      env:{...process.env,PGAPPNAME:'cadde-local-http-ci'},stdio:['pipe','pipe','pipe']
    });
    let out='',err='';
    child.stdout.on('data',b=>out+=b.toString('utf8'));
    child.stderr.on('data',b=>err+=b.toString('utf8'));
    child.once('error',reject);
    child.once('close',code=>{
      if(code!==0)return reject(Error('PSQL_ERROR '+err.slice(-1100)));
      resolve(out.trim());
    });
    child.stdin.end(sql);
  });
}
function rpcSQL(p) {
  // These are already validated by candidate HTTP gateway and HMAC-generated;
  // this adapter must never be used outside disposable synthetic CI.
  assert.ok(Array.isArray(p.p_product_ids) && p.p_product_ids.every(Number.isSafeInteger));
  assert.match(p.p_visitor_hash,/^[a-f0-9]{64}$/);
  assert.match(p.p_rate_hash,/^[a-f0-9]{64}$/);
  assert.match(p.p_idempotency_key,/^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(p.p_expected_total));
  const ids=JSON.stringify(p.p_product_ids);
  return 'SET ROLE service_role; SELECT public.create_whatsapp_request_protected_v3('+
    "'"+ids+"'::jsonb,"+p.p_expected_total+","+
    "'"+p.p_visitor_hash+"','"+p.p_rate_hash+"',"+
    "'"+p.p_idempotency_key+"'::uuid)::text;\n";
}
global.fetch=async function fakeUpstream(url,opts){
  if(url==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){
    turnstileCalls++;
    const body=JSON.parse(opts.body);
    if(!body.response || !body.response.startsWith('ci-pass-') ||
       usedChallenge.has(body.response)) {
      return {ok:true,json:async()=>({success:false})};
    }
    usedChallenge.add(body.response);
    return {ok:true,json:async()=>({
      success:true,hostname:'caddedepo.com',action:'checkout'
    })};
  }
  if(url!=='https://svyqmmivhpfiuhxnmhny.supabase.co/rest/v1/rpc/create_whatsapp_request_protected_v3'){
    throw Error('Unexpected fake upstream '+url);
  }
  dbCalls++;
  const p=JSON.parse(opts.body);
  try{
    const output=await runSQL(rpcSQL(p));
    const result=JSON.parse(output);
    if(forceDropKey===p.p_idempotency_key && !dropDone){
      dropDone=true;
      const e=Error('simulated client-facing upstream response loss AFTER COMMIT');
      e.name='TimeoutError';throw e;
    }
    return {ok:true,json:async()=>result};
  }catch(e){
    if(e.name==='TimeoutError')throw e;
    return {ok:false,status:409,json:async()=>({message:e.message,code:'CI_DB_FAILURE'})};
  }
};

const server=http.createServer(gateway);
let address=null;
function body(visitor,key,token,extra){
  return Object.assign({productIds:[5],expectedTotal:33000,
    visitorId:visitor,idempotencyKey:key,turnstileToken:token},extra||{});
}
function request(obj,options){
  const json=JSON.stringify(obj);
  const headers=Object.assign({
    'Host':'caddedepo.com','Origin':'https://caddedepo.com',
    'Content-Type':'application/json',
    'Content-Length':String(Buffer.byteLength(json)),
    'x-vercel-forwarded-for':'203.0.113.42'
  },options?.headers||{});
  return new Promise((resolve,reject)=>{
    const req=http.request({
      hostname:'127.0.0.1',port:address.port,method:'POST',
      path:'/api/whatsapp-request',headers
    },res=>{
      let out='';
      res.on('data',v=>out+=v);
      res.on('end',()=>{
        try{resolve({status:res.statusCode,body:JSON.parse(out)});}
        catch(e){reject(e);}
      });
    });
    req.on('error',reject);req.end(json);
  });
}
const tok=()=>('ci-pass-'+randomUUID());
let initialTrusted=0, initialOrderCount=0;
async function assertCount(expected){
  const sql='SELECT count(*)::text FROM cadde_internal.trusted_checkout_orders;';
  const n=Number(await runSQL(sql));
  assert.equal(n,initialTrusted+expected,'Unexpected trusted order count');
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  address=server.address();
  initialTrusted=Number(await runSQL('SELECT count(*)::text FROM cadde_internal.trusted_checkout_orders;'));
  initialOrderCount=Number(await runSQL('SELECT count(*)::text FROM public.orders;'));
  await assertCount(0);

  const firstVisitor=randomUUID(),firstKey=randomUUID();
  const [a,b]=await Promise.all([
    request(body(firstVisitor,firstKey,tok())),
    request(body(firstVisitor,firstKey,tok()))
  ]);
  assert.deepEqual([a.status,b.status].sort(),[200,201]);
  assert.equal(a.body.request_id,b.body.request_id);
  await assertCount(1);
  console.log('PASS concurrent HTTP same visitor / same key => one DB order');

  const crossVisitor=randomUUID();
  const [c,d]=await Promise.all([
    request(body(crossVisitor,randomUUID(),tok())),
    request(body(crossVisitor,randomUUID(),tok()))
  ]);
  assert.deepEqual([c.status,d.status].sort(),[200,201]);
  assert.equal(c.body.request_id,d.body.request_id);
  await assertCount(2);
  console.log('PASS concurrent HTTP same visitor / different keys => one DB order');

  const [e,f]=await Promise.all([
    request(body(randomUUID(),randomUUID(),tok())),
    request(body(randomUUID(),randomUUID(),tok()))
  ]);
  assert.equal(e.status,201);assert.equal(f.status,201);
  assert.notEqual(e.body.request_id,f.body.request_id);
  await assertCount(4);
  console.log('PASS concurrent HTTP separate visitors / same IP => two DB orders');

  const retryVisitor=randomUUID(),retryKey=randomUUID();
  // This key is visible only to synthetic adapter, simulating response loss
  // AFTER successful commit and BEFORE gateway receives the reply.
  forceDropKey=retryKey;
  const failed=await request(body(retryVisitor,retryKey,tok()));
  assert.equal(failed.status,503);
  assert.ok(dropDone);
  await assertCount(5);
  const retried=await request(body(retryVisitor,retryKey,tok()));
  assert.equal(retried.status,200);
  assert.equal(retried.body.reused,true);
  await assertCount(5);
  console.log('PASS HTTP response loss after DB commit + fresh challenge retry => no duplicate order');
  forceDropKey=null;

  const before=turnstileCalls;
  const badToken='ci-pass-replay-check';
  const rejected=await request(body(randomUUID(),randomUUID(),'ci-fail-bad'));
  assert.equal(rejected.status,403);
  assert.equal(turnstileCalls,before+1);
  const throttled=await request(body(randomUUID(),randomUUID(),badToken,{expectedTotal:32999}));
  assert.equal(throttled.status,429);
  console.log('PASS shared IP rate limiter rejects request six');
  const invalid=await request(body(randomUUID(),randomUUID(),tok(),{expectedTotal:32999}),{headers:{'x-vercel-forwarded-for':'203.0.113.43'}});
  assert.equal(invalid.status,409);
  await assertCount(5);
  const oversized=await request(body(randomUUID(),randomUUID(),tok(),{productIds:[5,5]}),{headers:{'x-vercel-forwarded-for':'203.0.113.44'}});
  assert.equal(oversized.status,409);
  await assertCount(5);
  console.log('PASS challenge failure, stale price and insufficient stock => no DB orders');

  const count=Number(await runSQL('SELECT count(*)::text FROM public.orders;'));
  assert.equal(count,initialOrderCount+5,'Expected exactly five new orders from HTTP test');
  console.log('LOCAL_HTTP_REAL_POSTGRES_ASSERTIONS_PASSED orders=5 dbCalls='+dbCalls+' challenges='+turnstileCalls);
})().catch(error=>{console.error(error);process.exitCode=1;})
  .finally(()=>{global.fetch=originalFetch;server.close();});
