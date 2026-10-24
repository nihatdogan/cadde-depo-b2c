'use strict';
const assert=require('node:assert/strict');
const gateway=require('../candidate-api/whatsapp-request.cjs');
const {randomUUID}=require('node:crypto');
const original={...process.env};
function env(on=true){Object.assign(process.env,{VERCEL:'1',VERCEL_ENV:'production',CADDE_DEPLOY_STAGE:'production',CADDE_ORDER_API_ENABLED:on?'on':'off',CADDE_EXPECTED_SUPABASE_REF:'svyqmmivhpfiuhxnmhny',SUPABASE_URL:'https://svyqmmivhpfiuhxnmhny.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'ci-fake-key-only-1234567890',TURNSTILE_SECRET_KEY:'ci-fake-turnstile-secret',TURNSTILE_SITE_KEY:'ci-public-sitekey',CADDE_RATE_SALT:'ci-fake-salt-at-least-32-characters'});}
const cart=()=>({productIds:[5],expectedTotal:33000,visitorId:randomUUID(),idempotencyKey:randomUUID(),turnstileToken:'ci-token'});
function makeReq(data=cart(),overrides={}){const body=JSON.stringify(data);return {method:'POST',headers:{host:'caddedepo.com',origin:'https://caddedepo.com','content-type':'application/json','x-vercel-forwarded-for':'203.0.113.12','content-length':String(Buffer.byteLength(body)),...(overrides.headers||{})},body:overrides.body===undefined?body:overrides.body,...(overrides.method?{method:overrides.method}:{})};}
function res(){return {status:null,data:null,writeHead(code){this.status=code;return this;},end(body){this.data=JSON.parse(body);return this;}};}
async function invoke(req){const output=res();await gateway(req,output);return output;}
const scenarios=[];
const test=async(n,fn)=>{await fn();scenarios.push(n);console.log('PASS '+n);};
(async()=>{
env(false);
await test('feature flag default closed',async()=>assert.equal((await invoke(makeReq())).status,503));
env();
await test('reject invalid host',async()=>assert.equal((await invoke(makeReq(cart(),{headers:{host:'evil.test'}}))).status,403));
await test('reject bad origin',async()=>assert.equal((await invoke(makeReq(cart(),{headers:{origin:'https://evil.test'}}))).status,403));
await test('reject oversized content-length',async()=>assert.equal((await invoke(makeReq(cart(),{headers:{'content-length':'8193'}}))).status,413));
await test('reject malformed json',async()=>assert.equal((await invoke(makeReq(cart(),{body:'{broken'}))).status,400));
await test('reject missing identity',async()=>assert.equal((await invoke(makeReq({...cart(),visitorId:null}))).status,400));
await test('reject malformed content type',async()=>assert.equal((await invoke(makeReq(cart(),{headers:{'content-type':'text/plain'}}))).status,415));
await test('GET exposes only public site key',async()=>{const r=await invoke({method:'GET',headers:{host:'caddedepo.com'}});assert.equal(r.status,200);assert.equal(r.data.siteKey,'ci-public-sitekey');assert.equal(JSON.stringify(r.data).includes('secret'),false);});
let calls=[];
global.fetch=async(url,opts)=>{calls.push({url,opts});if(String(url).includes('cloudflare'))return {ok:true,json:async()=>({success:true,hostname:'caddedepo.com',action:'checkout'})};return {ok:true,json:async()=>({request_id:randomUUID(),items:[{name:'SYNTHETIC',quantity:1,price:33000}],total:33000,reused:false})};};
await test('success checks Turnstile before RPC v3',async()=>{calls=[];const r=await invoke(makeReq());assert.equal(r.status,201);assert.equal(calls.length,2);assert.match(calls[1].url,/create_whatsapp_request_protected_v3$/);assert.ok(!JSON.stringify(r.data).includes('ci-fake-key'));});
await test('parallel requests reach v3 without client credential exposure',async()=>{calls=[];const [a,b]=await Promise.all([invoke(makeReq()),invoke(makeReq())]);assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(calls.filter(x=>String(x.url).includes('/rpc/')).length,2);});
global.fetch=async()=>({ok:true,json:async()=>({success:false,hostname:'caddedepo.com',action:'checkout'})});
await test('reject failed challenge',async()=>assert.equal((await invoke(makeReq())).status,403));
global.fetch=async()=>({ok:true,json:async()=>({success:true,hostname:'other.example',action:'checkout'})});
await test('reject mismatched challenge hostname',async()=>assert.equal((await invoke(makeReq())).status,403));
global.fetch=async()=>({ok:false,status:500});
await test('reject verifier outage',async()=>assert.equal((await invoke(makeReq())).status,503));
global.fetch=async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'});};
await test('fail closed on timeout',async()=>assert.equal((await invoke(makeReq())).status,503));
console.log('HTTP MOCK CONTRACTS PASSED '+scenarios.length+'/'+scenarios.length);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{process.env=original;});
