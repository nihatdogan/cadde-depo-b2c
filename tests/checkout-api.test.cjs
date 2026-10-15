const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const handler=require('../api/checkout.js');const upload=require('../api/admin/upload-product-image.js');const configHandler=require('../api/public-config.js');
const url='https://svyqmmivhpfiuhxnmhny.supabase.co';
const env={VERCEL:'1',VERCEL_ENV:'production',SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:'sb_secret_LOCAL_ONLY',CHECKOUT_ENABLED:'true',CHECKOUT_TURNSTILE_SITE_KEY:'LOCAL_SITE_KEY',CHECKOUT_TURNSTILE_SECRET_KEY:'LOCAL_CHALLENGE_SECRET',CHECKOUT_ACTOR_HASH_SECRET:'LOCAL_HMAC_SECRET_32_BYTES_LONG_ONLY_TEST'};
const request=()=>({method:'POST',headers:{origin:'https://www.caddedepo.com','content-type':'application/json','x-forwarded-for':'192.0.2.1'},body:{kind:'stock',items:[{id:1,quantity:1}],idempotencyKey:'00000000-0000-4000-8000-000000000010',challengeToken:'LOCAL_CHALLENGE'}});
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}});
async function scoped(fn,vars=env){const originalEnv=process.env,originalFetch=global.fetch;process.env={...vars};try{await fn();}finally{process.env=originalEnv;global.fetch=originalFetch;}}
const receipt={id:'00000000-0000-4000-8000-000000000011',kind:'stock',items:[{id:1,name:'LOCAL SERVER PRODUCT',unitPrice:100,quantity:1}],total:100,status:'request',expiresAt:'2099-01-01T00:00:00Z'};
test('endpoint passes only ids/quantities to DB, trusts server receipt and never leaks secrets/hash',()=>scoped(async()=>{
 const calls=[];global.fetch=async(u,o)=>{calls.push([u,o]);return calls.length===1?Response.json({success:true,hostname:'www.caddedepo.com',action:'cadde-checkout'}):Response.json({...receipt,costs:999,actor_hash:'PRIVATE'});};
 const res=response();await handler(request(),res);assert.equal(res.code,200);assert.equal(res.body.total,100);assert.equal(calls.length,2);
 const body=JSON.parse(calls[1][1].body);assert.match(body.p_actor_hash,/^[a-f0-9]{64}$/);assert.deepEqual(body.p_items,[{id:1,quantity:1}]);assert.doesNotMatch(calls[1][1].body,/price|fiyat|192\.0\.2/);
 assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE|SECRET|costs|actor_hash/);assert.match(res.headers['Cache-Control'],/no-store/);
}));
test('disabled/missing server config makes no provider/database call',()=>scoped(async()=>{
 let calls=0;global.fetch=async()=>{calls++;};const res=response();await handler(request(),res);assert.equal(res.code,503);assert.equal(calls,0);
},{...env,CHECKOUT_ENABLED:'false'}));
test('preview without separate test config cannot reach production',()=>scoped(async()=>{
 let calls=0;global.fetch=async()=>{calls++;};const res=response();await handler(request(),res);assert.equal(res.code,503);assert.equal(calls,0);
},{...env,VERCEL_ENV:'preview'}));
test('method, origin, non-Vercel ingress and forged/multiple IP headers are rejected',async()=>{
 for(const change of [q=>q.method='GET',q=>q.headers.origin='https://evil.example',q=>q.headers['x-forwarded-for']='192.0.2.1,192.0.2.2'])await scoped(async()=>{
  let calls=0;global.fetch=async()=>{calls++;};const q=request();change(q);const res=response();await handler(q,res);assert.ok(res.code>=400);assert.equal(calls,0);
 });
 await scoped(async()=>{const res=response();await handler(request(),res);assert.equal(res.code,503);},{...env,VERCEL:'0'});
});
test('price injection, extra item fields, bad UUID, negative/fractional quantity rejected before captcha',async()=>{
 for(const change of [q=>q.body.total=1,q=>q.body.items[0].price=1,q=>q.body.items[0].quantity=-1,q=>q.body.items[0].quantity=1.2,q=>q.body.idempotencyKey='bad'])await scoped(async()=>{
 let calls=0;global.fetch=async()=>{calls++;};const q=request();change(q);const res=response();await handler(q,res);assert.equal(res.code,400);assert.equal(calls,0);
 });
});
test('captcha success, action and hostname all required before database call',async()=>{
 for(const result of [{success:false},{success:true,hostname:'evil.example',action:'cadde-checkout'},{success:true,hostname:'www.caddedepo.com',action:'other'}])await scoped(async()=>{
  let calls=0;global.fetch=async()=>{calls++;return Response.json(result);};const res=response();await handler(request(),res);assert.equal(res.code,403);assert.equal(calls,1);
 });
});
test('DB quota maps to 429; internal SQL details are never returned',async()=>{
 for(const message of ['RATE_LIMITED private SQL details','sensitive internal connection info'])await scoped(async()=>{
 let calls=0;global.fetch=async()=>++calls===1?Response.json({success:true,hostname:'www.caddedepo.com',action:'cadde-checkout'}):Response.json({message},{status:400});
 const res=response();await handler(request(),res);assert.equal(res.code,message.startsWith('RATE')?429:503);assert.doesNotMatch(JSON.stringify(res.body),/private|sensitive/);
 });
});
test('public config may reveal site key, never challenge/HMAC/service secrets',()=>scoped(()=>{
 const res=response();configHandler({method:'GET'},res);assert.match(res.body,/LOCAL_SITE_KEY/);assert.doesNotMatch(res.body,/LOCAL_CHALLENGE_SECRET|LOCAL_HMAC_SECRET|sb_secret_LOCAL_ONLY/);
}));
test('production upload no longer accepts merely authenticated user or allowlist-only authorization',()=>scoped(async()=>{
 let calls=0;global.fetch=async()=>{calls++;return Response.json({id:'LOCAL',email:'listed@example.invalid',app_metadata:{},user_metadata:{role:'admin'}});};
 const res=response();await upload({method:'POST',headers:{authorization:'Bearer LOCAL'}},res);assert.equal(res.code,403);assert.equal(calls,1);
},{...env,ADMIN_EMAILS:'listed@example.invalid'}));
test('admin UI access requires both fresh Auth user and database role gate',async()=>{
 const w={};vm.runInNewContext(fs.readFileSync('admin-access.js','utf8'),{window:w});
 const sb={auth:{getUser:async()=>({data:{user:{app_metadata:{role:'admin'}}}})},rpc:async()=>({data:false})};
 assert.equal(await w.CDAdmin.allowed(sb,{}),false);sb.rpc=async()=>({data:true});assert.equal(await w.CDAdmin.allowed(sb,{}),true);
 sb.auth.getUser=async()=>({data:{user:{user_metadata:{role:'admin'}}}});assert.equal(await w.CDAdmin.allowed(sb,{}),false);
});
test('frontend has no direct order writes or unsafe fallback and all new scripts compile',()=>{
 const index=fs.readFileSync('index.html','utf8');assert.doesNotMatch(index,/from\('orders'\)\.insert|from\('order_items'\)\.insert/);assert.match(index,/CDCheckout.create\('stock'/);
 assert.match(fs.readFileSync('on-demand.js','utf8'),/CDCheckout.create\('supply'/);
 for(const f of ['checkout-client.js','admin-access.js','api/checkout.js'])new vm.Script(fs.readFileSync(f,'utf8'),{filename:f});
 for(const f of ['admin.html','admin-gorsel.html']){const s=fs.readFileSync(f,'utf8');assert.match(s,/CDAdmin.allowed/);for(const m of s.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1],{filename:f});}
});

test('failed admin status changes reload persisted data instead of leaving an unconfirmed selection',async()=>{
 const html=fs.readFileSync('admin.html','utf8');const source=html.slice(html.indexOf('async function setStatus(id, durum){'),html.indexOf('\nboot();'));
 let reloads=0,summaries=0;const c={prompt:()=> 'LOCAL ACCEPTANCE',toast(){},loadOrders:async()=>{reloads++;},loadSummary:()=>{summaries++;},DURUM_TR:{onaylandi:'Onaylandı'},sb:{rpc:async()=>({error:{message:'STOCK_OR_PRICE_CHANGED'}})}};
 vm.createContext(c);vm.runInContext(source+';this.statusChange=setStatus;',c);await c.statusChange('LOCAL','onaylandi');assert.equal(reloads,1);assert.equal(summaries,0);
 c.sb.rpc=async()=>{throw new Error('offline');};await c.statusChange('LOCAL','onaylandi');assert.equal(reloads,2);assert.equal(summaries,0);
});
