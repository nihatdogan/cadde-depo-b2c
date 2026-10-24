'use strict';
// Cadde Depo CI: real Cloudflare Siteverify requests with OFFICIAL TEST KEYS.
// This is NEVER a production credential nor a production endpoint.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const assert=require('node:assert/strict');
if(process.env.CADDE_CI_ISOLATED!=='1'||process.env.CADDE_REAL_TURNSTILE_TEST!=='1')
  throw Error('Refuse to run outside isolated CI');
if(process.env.VERCEL_ENV==='production'||process.env.CADDE_DEPLOY_STAGE==='production')
  throw Error('Refuse production execution');
const endpoint='https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DUMMY='XXXX.DUMMY.TOKEN.XXXX';
async function verify(secret){
 const response=await fetch(endpoint,{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({secret,response:DUMMY}),
  signal:AbortSignal.timeout(12000)});
 assert.equal(response.status,200,'Cloudflare Siteverify response status');
 const data=await response.json();
 assert.equal(typeof data.success,'boolean');
 return data;
}
(async()=>{
 const pass=await verify('1x0000000000000000000000000000000AA');
 assert.equal(pass.success,true,'Dummy valid key should pass');
 console.log('PASS real Siteverify request using official always-pass dummy secret');
 const fail=await verify('2x0000000000000000000000000000000AA');
 assert.equal(fail.success,false,'Official always-fail key should fail');
 console.log('PASS real Siteverify rejects test token using always-fail dummy secret');
 const alreadyUsed=await verify('3x0000000000000000000000000000000AA');
 assert.equal(alreadyUsed.success,false,'Official duplicate token key should fail');
 assert.ok(Array.isArray(alreadyUsed['error-codes']));
 console.log('PASS real Siteverify rejects already-spent dummy token');
 console.log('CLOUDFLARE_REAL_SITEVERIFY_DUMMY_TESTS_PASSED');
})().catch(e=>{console.error(e);process.exitCode=1;});
