'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const handler=require('../../../api/cadde-preview-checkout-v3.js');
const originalEnv={...process.env};
const originalFetch=global.fetch;
const host='caddedepo-b2c-git-prep-production-order-secu-07ed4d-nihat-proje.vercel.app';
const env=()=>{
  Object.assign(process.env,{
    VERCEL:'1',VERCEL_ENV:'preview',
    VERCEL_GIT_COMMIT_REF:'prep/production-order-security-20261024',
    VERCEL_URL:host,
    CADDE_PREVIEW_E2E_ENABLED:'on',
    CADDE_PREVIEW_SUPABASE_REF:'emnacsavgsjkrocpngcj',
    CADDE_PREVIEW_SUPABASE_URL:'https://emnacsavgsjkrocpngcj.supabase.co',
    CADDE_PREVIEW_SUPABASE_SERVICE_ROLE_KEY:'fake-ci-only-service-role-placeholder',
    CADDE_PREVIEW_RATE_SALT:'ci-synthetic-rate-salt-over-32-character-long',
    CADDE_PREVIEW_TURNSTILE_SITE_KEY:'real-like-ci-sitekey-not-a-key',
    CADDE_PREVIEW_TURNSTILE_SECRET_KEY:'real-like-ci-secret-not-a-key'
  });
};
const cart=()=>({productIds:[5],expectedTotal:33000,visitorId:randomUUID(),
  idempotencyKey:randomUUID(),turnstileToken:'fake-ci-challenge-token-123456'});
function request(method='POST',data=cart(),headers={}){
  const body=JSON.stringify(data);
  return {method,body,headers:{host,origin:'https://'+host,
    'content-type':'application/json','content-length':String(Buffer.byteLength(body)),
    'x-forwarded-for':'203.0.113.27',...headers}};
}
function response(){
  return {status:null,body:null,setHeader(){return this;},
    status(n){this.status=n;return this;},json(x){this.body=x;return this;}};
}
async function run(req){let statusCode,body;const res={setHeader(){},status(x){statusCode=x;return this;},json(x){body=x;return this;}};
  await handler(req,res);return {status:statusCode,body};}
(async()=>{
  env(); process.env.CADDE_PREVIEW_E2E_ENABLED='off';
  assert.equal((await run(request())).status,503);
  env();
  assert.equal((await run(request('GET'))).status,200);
  assert.equal((await run(request('POST',cart(),{host:'caddedepo.com',origin:'https://caddedepo.com'}))).status,403);
  assert.equal((await run(request('POST',cart(),{origin:'https://other.example'}))).status,403);
  assert.equal((await run(request('POST',{...cart(),productIds:[29]}))).status,400);
  assert.equal((await run(request('POST',{...cart(),expectedTotal:0}))).status,400);
  const urls=[];
  global.fetch=async(url)=>{
    urls.push(String(url));
    if(String(url).includes('cloudflare'))return {ok:true,json:async()=>({success:false})};
    throw Error('RPC must not be called');
  };
  assert.equal((await run(request())).status,403);
  assert.equal(urls.length,1);
  urls.length=0;
  global.fetch=async url=>{
    urls.push(String(url));
    if(String(url).includes('cloudflare'))return {ok:true,json:async()=>({
      success:true,hostname:host,action:'wrong_action'})};
    throw Error('RPC must not be called');
  };
  assert.equal((await run(request())).status,403);
  assert.equal(urls.length,1);
  urls.length=0;
  global.fetch=async url=>{
    urls.push(String(url));
    if(String(url).includes('cloudflare'))return {ok:true,json:async()=>({
      success:true,hostname:host,action:'cadde_preview_checkout'})};
    assert.equal(new URL(url).hostname,'emnacsavgsjkrocpngcj.supabase.co');
    return {ok:true,json:async()=>({request_id:randomUUID(),total:33000,items:[{id:5}],reused:false})};
  };
  const ok=await run(request());
  assert.equal(ok.status,201);
  assert.equal(urls.length,2);
  assert.match(urls[1],/create_whatsapp_request_protected_v3$/);
  assert.ok(!JSON.stringify(ok.body).includes('fake-ci-only-service-role'));
  urls.length=0;
  process.env.VERCEL_ENV='production';
  assert.equal((await run(request())).status,503);
  assert.equal(urls.length,0);
  console.log('PREVIEW_GATEWAY_CONTRACT_MOCK_PASS; real browser/Turnstile/managed-v3 HTTP NOT tested');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  process.env=originalEnv;global.fetch=originalFetch;
});