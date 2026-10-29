'use strict';
const assert=require('node:assert/strict');
const client=require('../../../assets/cadde-checkout-v3.js');
let calls=0;
const fake={fetch:async()=>{calls++;return {status:200,json:async()=>({enabled:true,siteKey:'ci-public'})};}};
global.fetch=fake.fetch;
(async()=>{
 const preview=client.createClient({isProduction:false});
 assert.equal((await preview.check()).enabled,false);
 assert.equal(calls,0);
 const production=client.createClient({isProduction:true});
 assert.equal((await production.check()).enabled,true);
 assert.equal(calls,1);
 assert.equal(production.receipt(201,{request_id:'15a035e4-02bc-4623-bf8e-33b888d448e7',reused:false,total:33000},33000),true);
 assert.equal(production.receipt(200,{request_id:'15a035e4-02bc-4623-bf8e-33b888d448e7',reused:true,total:33000},33000),true);
 assert.equal(production.receipt(201,{request_id:'15a035e4-02bc-4623-bf8e-33b888d448e7',reused:false,total:33001},33000),false);
 console.log('CHECKOUT_UI_GATE_CONTRACT_PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
