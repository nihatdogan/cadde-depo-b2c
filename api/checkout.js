// Same-origin anonymous checkout. No client prices, direct table writes or payment capture.
const {createHmac}=require('node:crypto');
const {isIP}=require('node:net');
const {getCheckoutConfig}=require('../lib/supabase-environment.cjs');
const fail=(res,status,code)=>res.status(status).json({error:code});
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return fail(res,405,'METHOD_NOT_ALLOWED');}
 let config;try{config=getCheckoutConfig();}catch{return fail(res,503,'CHECKOUT_NOT_READY');}
 if(!config.origins.includes(req.headers.origin))return fail(res,403,'ORIGIN_REJECTED');
 if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return fail(res,415,'JSON_REQUIRED');
 // Vercel overwrites x-forwarded-for. Never accept an actor hash or IP from JSON/client headers.
 if(process.env.VERCEL!=='1')return fail(res,503,'TRUSTED_INGRESS_REQUIRED');
 const ip=String(req.headers['x-forwarded-for']||'').trim();
 if(!isIP(ip))return fail(res,503,'TRUSTED_INGRESS_REQUIRED');
 let body;try{
  const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
  if(!raw || Buffer.byteLength(raw)>8192)return fail(res,413,'CART_TOO_LARGE');
  body=JSON.parse(raw);
 }catch{return fail(res,400,'INVALID_CART');}
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 if(!body || Object.keys(body).some(k=>!['items','kind','idempotencyKey','challengeToken'].includes(k))
  || !['stock','supply'].includes(body.kind) || !uuid.test(body.idempotencyKey||'') || !Array.isArray(body.items) || body.items.length<1 || body.items.length>20
  || body.items.some(i=>!i || Object.keys(i).some(k=>!['id','quantity'].includes(k)) || !Number.isSafeInteger(i.id) || i.id<1 || i.id>999999999999999 || !Number.isInteger(i.quantity) || i.quantity<1 || i.quantity>10)
  || typeof body.challengeToken!=='string' || body.challengeToken.length<1 || body.challengeToken.length>2048)return fail(res,400,'INVALID_CART');
 try{
  const check=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
   method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({secret:config.challengeSecret,response:body.challengeToken}),signal:AbortSignal.timeout(8000)
  });
  const verified=check.ok?await check.json():{};
  if(verified.success!==true || verified.hostname!==new URL(req.headers.origin).hostname || verified.action!=='cadde-checkout')return fail(res,403,'CHALLENGE_REJECTED');
  const actorHash=createHmac('sha256',config.actorSecret).update('checkout-v1:'+ip).digest('hex');
  const response=await fetch(config.url+'/rest/v1/rpc/create_checkout_request',{
   method:'POST',headers:{apikey:config.serviceRoleKey,Authorization:'Bearer '+config.serviceRoleKey,'Content-Type':'application/json'},
   body:JSON.stringify({p_items:body.items,p_request_key:body.idempotencyKey,p_actor_hash:actorHash,p_kind:body.kind}),signal:AbortSignal.timeout(10000)
  });
  const data=await response.json();
  if(!response.ok){
   const known=['RATE_LIMITED','IDEMPOTENCY_CONFLICT','QUOTE_EXPIRED','PRODUCT_UNAVAILABLE','STOCK_UNAVAILABLE','INVALID_CART','INVALID_SUPPLY_CART','SUPPLY_NOT_READY'];
   const code=known.find(k=>String(data.message||'').includes(k))||'CHECKOUT_FAILED';
   return fail(res,code==='RATE_LIMITED'?429:code==='CHECKOUT_FAILED'?503:409,code);
  }
  if(!data || !data.id || !Array.isArray(data.items))return fail(res,503,'CHECKOUT_FAILED');
  // Explicit public receipt allowlist; no actor identifier, secret, cost or internal errors.
  return res.status(200).json({id:data.id,kind:data.kind,items:data.items.map(i=>({id:i.id,name:i.name,unitPrice:i.unitPrice,quantity:i.quantity})),total:data.total,expiresAt:data.expiresAt,status:'request'});
 }catch{return fail(res,503,'CHECKOUT_FAILED');}
};
