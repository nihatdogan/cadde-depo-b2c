'use strict';
// CADDE DEPO production candidate route contract. No network or DB writes.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const route=require('../../../api/cadde-order-v3.js');
const originalFetch=global.fetch;
const names=['VERCEL','VERCEL_ENV','CADDE_DEPLOY_STAGE','CADDE_ORDER_API_ENABLED','CADDE_EXPECTED_SUPABASE_REF','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TURNSTILE_SECRET_KEY','TURNSTILE_SITE_KEY','CADDE_RATE_SALT'];
const previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
const configure=()=>Object.assign(process.env,{
 VERCEL:'1',VERCEL_ENV:'production',CADDE_DEPLOY_STAGE:'production',
 CADDE_ORDER_API_ENABLED:'on',CADDE_EXPECTED_SUPABASE_REF:'svyqmmivhpfiuhxnmhny',
 SUPABASE_URL:'https://svyqmmivhpfiuhxnmhny.supabase.co',
 SUPABASE_SERVICE_ROLE_KEY:'ci-mock-secret-not-real-12345678',
 TURNSTILE_SECRET_KEY:'ci-mock-turnstile-not-real-12345678',
 TURNSTILE_SITE_KEY:'ci-public-only',CADDE_RATE_SALT:'ci-mock-salt-longer-than-32-characters'
});
const body=()=>({productIds:[5],expectedTotal:33000,visitorId:randomUUID(),idempotencyKey:randomUUID(),turnstileToken:'ci-token'});
function request(method='POST',host='caddedepo.com'){
 const encoded=JSON.stringify(body());
 return {method,headers:{host,origin:'https://'+host,'content-type':'application/json',
  'content-length':String(Buffer.byteLength(encoded)),'x-vercel-forwarded-for':'203.0.113.17'},body:encoded};
}
function response(){return {statusCode:null,result:null,writeHead(code){this.statusCode=code;return this;},end(data){this.result=JSON.parse(data);return this;}}}
async function invoke(req){const res=response();await route(req,res);return res;}
let outbound=0;
global.fetch=async()=>{outbound++;throw Error('CI refuses external network');};
async function test(name,fn){await fn();console.log('PASS '+name);}
(async()=>{
 for(const k of names)delete process.env[k];
 await test('default closed without configured secrets',async()=>{
  const res=await invoke(request());assert.equal(res.statusCode,503);
  assert.equal(res.result.error,'ORDER_API_DISABLED');assert.equal(outbound,0);
 });
 configure();process.env.CADDE_ORDER_API_ENABLED='off';
 await test('explicit off prevents network calls',async()=>{
  assert.equal((await invoke(request())).statusCode,503);assert.equal(outbound,0);
 });
 configure();process.env.VERCEL_ENV='preview';
 await test('preview refuses production handler even if feature flag on',async()=>{
  assert.equal((await invoke(request())).statusCode,503);assert.equal(outbound,0);
 });
 configure();process.env.CADDE_EXPECTED_SUPABASE_REF='emnacsavgsjkrocpngcj';
 await test('wrong database project refuses requests',async()=>{
  assert.equal((await invoke(request())).statusCode,503);assert.equal(outbound,0);
 });
 configure();process.env.SUPABASE_URL='https://emnacsavgsjkrocpngcj.supabase.co';
 await test('wrong database URL refuses requests',async()=>{
  assert.equal((await invoke(request())).statusCode,503);assert.equal(outbound,0);
 });
 configure();
 await test('untrusted host refused before outgoing fetch',async()=>{
  assert.equal((await invoke(request('POST','other.example'))).statusCode,403);assert.equal(outbound,0);
 });
 await test('GET only exposes public site key under full production configuration',async()=>{
  const res=await invoke(request('GET'));assert.equal(res.statusCode,200);
  assert.equal(res.result.siteKey,'ci-public-only');assert.equal(outbound,0);
  assert.ok(!JSON.stringify(res.result).includes('ci-mock-secret'));
 });
 console.log('PRODUCTION_ROUTE_FAIL_CLOSED_CONTRACT_PASSED');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
 global.fetch=originalFetch;
 for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
