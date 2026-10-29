'use strict';
// CADDE DEPO — ISOLATED PREVIEW RPC v3 checkout CANARY, not a customer checkout.
// This endpoint stays disabled until branch-scoped, real Preview-only credentials
// and CADDE_PREVIEW_E2E_ENABLED=on are configured by the project owner.
// Never call Production, never accept a Production hostname, never use test keys
// as evidence of real Turnstile verification.
const {createHmac}=require('node:crypto');
const {isIP}=require('node:net');
const BRANCH='prep/production-order-security-20261024';
const REF='emnacsavgsjkrocpngcj';
const API='https://'+REF+'.supabase.co';
const BRANCH_HOST='caddedepo-b2c-git-prep-production-order-secu-07ed4d-nihat-proje.vercel.app';
const ACTION='cadde_preview_checkout';
const MAX_BODY=8192;

function send(res,status,payload){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.status(status).json(payload);
}
function configuration(e){
  if(e.VERCEL!=='1'||e.VERCEL_ENV!=='preview'||e.VERCEL_GIT_COMMIT_REF!==BRANCH)
    return false;
  if(e.CADDE_PREVIEW_E2E_ENABLED!=='on'||
     e.CADDE_PREVIEW_SUPABASE_REF!==REF||e.CADDE_PREVIEW_SUPABASE_URL!==API)
    return false;
  if(typeof e.CADDE_PREVIEW_SUPABASE_SERVICE_ROLE_KEY!=='string'||
     e.CADDE_PREVIEW_SUPABASE_SERVICE_ROLE_KEY.length<20||
     typeof e.CADDE_PREVIEW_RATE_SALT!=='string'||
     e.CADDE_PREVIEW_RATE_SALT.length<32)
    return false;
  if(typeof e.CADDE_PREVIEW_TURNSTILE_SITE_KEY!=='string'||
     e.CADDE_PREVIEW_TURNSTILE_SITE_KEY.length<8||
     typeof e.CADDE_PREVIEW_TURNSTILE_SECRET_KEY!=='string'||
     e.CADDE_PREVIEW_TURNSTILE_SECRET_KEY.length<20)
    return false;
  // Official dummy keys belong only in isolated CI, not the real browser canary.
  if(/^[123]x0{8,}/.test(e.CADDE_PREVIEW_TURNSTILE_SITE_KEY)||
     /^[123]x0{8,}/.test(e.CADDE_PREVIEW_TURNSTILE_SECRET_KEY))return false;
  return true;
}
function acceptedHost(req,e){
  const host=String(req.headers.host||'').toLowerCase();
  const allowed=[BRANCH_HOST,e.VERCEL_URL,e.VERCEL_BRANCH_URL]
    .filter(x=>typeof x==='string'&&x.endsWith('.vercel.app'))
    .map(x=>x.toLowerCase());
  return host.endsWith('.vercel.app') && allowed.includes(host) ? host : null;
}
function ipAddress(req){
  const raw=req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for'];
  const str=String(Array.isArray(raw)?raw[0]:raw||'').split(',')[0].trim();
  return isIP(str)?str:null;
}
async function parseBody(req){
  if(req.body!==undefined){
    const buf=Buffer.isBuffer(req.body)?req.body:Buffer.from(
      typeof req.body==='string'?req.body:JSON.stringify(req.body));
    if(buf.length>MAX_BODY)throw Object.assign(new Error('size'),{http:413});
    return JSON.parse(buf.toString('utf8'));
  }
  const parts=[];let size=0;
  for await(const part of req){
    size+=part.length;
    if(size>MAX_BODY)throw Object.assign(new Error('size'),{http:413});
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
function uuid4(str){
  return typeof str==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(str);
}
function validRequest(body){
  return body&&typeof body==='object'&&!Array.isArray(body)&&
    Array.isArray(body.productIds)&&body.productIds.length===1&&body.productIds[0]===5&&
    (body.expectedTotal===33000||body.expectedTotal===33001)&&
    uuid4(body.visitorId)&&uuid4(body.idempotencyKey)&&
    typeof body.turnstileToken==='string'&&body.turnstileToken.length>=16&&
    body.turnstileToken.length<=2048&&body.turnstileToken!=='XXXX.DUMMY.TOKEN.XXXX';
}
module.exports=async function previewCheckout(req,res){
  if(req.method!=='GET'&&req.method!=='POST')
    return send(res,405,{error:'METHOD_NOT_ALLOWED'});
  const e=process.env;
  if(!configuration(e))return send(res,503,{enabled:false,error:'PREVIEW_CANARY_DISABLED'});
  const host=acceptedHost(req,e);
  if(!host)return send(res,403,{error:'PREVIEW_HOST_REJECTED'});
  if(req.method==='GET')
    return send(res,200,{enabled:true,environment:'preview',siteKey:e.CADDE_PREVIEW_TURNSTILE_SITE_KEY,
      action:ACTION,testProductId:5,testPrice:33000});
  if(req.headers.origin!=='https://'+host)
    return send(res,403,{error:'ORIGIN_REJECTED'});
  const ip=ipAddress(req);
  if(!ip)return send(res,403,{error:'CLIENT_IP_UNAVAILABLE'});
  if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))
    return send(res,415,{error:'JSON_REQUIRED'});
  if(Number(req.headers['content-length']||0)>MAX_BODY)
    return send(res,413,{error:'REQUEST_TOO_LARGE'});
  let body;
  try{body=await parseBody(req);}
  catch(err){return send(res,err.http===413?413:400,{error:err.http===413?'REQUEST_TOO_LARGE':'INVALID_JSON'});}
  if(!validRequest(body))return send(res,400,{error:'INVALID_PREVIEW_CART_OR_TOKEN'});

  // Server-to-server trust boundary: Cloudflare challenge MUST verify before RPC.
  let checked;
  try{
    const cf=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({secret:e.CADDE_PREVIEW_TURNSTILE_SECRET_KEY,
        response:body.turnstileToken,remoteip:ip}),
      signal:AbortSignal.timeout(7500)
    });
    if(!cf.ok)return send(res,503,{error:'TURNSTILE_UNAVAILABLE'});
    checked=await cf.json();
  }catch{return send(res,503,{error:'TURNSTILE_UNAVAILABLE'});}
  if(checked?.success!==true||checked.hostname!==host||checked.action!==ACTION)
    return send(res,403,{error:'TURNSTILE_REJECTED'});

  const visitorHash=createHmac('sha256',e.CADDE_PREVIEW_RATE_SALT)
    .update('visitor:'+body.visitorId).digest('hex');
  const rateHash=createHmac('sha256',e.CADDE_PREVIEW_RATE_SALT)
    .update('ip:'+ip).digest('hex');
  try{
    const rpc=await fetch(API+'/rest/v1/rpc/create_whatsapp_request_protected_v3',{
      method:'POST',
      headers:{apikey:e.CADDE_PREVIEW_SUPABASE_SERVICE_ROLE_KEY,
        Authorization:'Bearer '+e.CADDE_PREVIEW_SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type':'application/json'},
      body:JSON.stringify({p_product_ids:body.productIds,p_expected_total:body.expectedTotal,
        p_visitor_hash:visitorHash,p_rate_hash:rateHash,
        p_idempotency_key:body.idempotencyKey}),
      signal:AbortSignal.timeout(10000)
    });
    const data=await rpc.json().catch(()=>({}));
    if(!rpc.ok){
      const code=String(data.message||'');
      if(code.includes('RATE_LIMITED'))return send(res,429,{error:'RATE_LIMITED'});
      if(/IDEMPOTENCY_CONFLICT|IDEMPOTENCY_EXPIRED|REQUEST_ALREADY_HANDLED|UNTRUSTED_ORDER_SOURCE/.test(code))
        return send(res,409,{error:'REPLAY_REJECTED'});
      if(/PRICE_CHANGED|PRODUCT_UNAVAILABLE|INSUFFICIENT_ACTIVE_STOCK/.test(code))
        return send(res,409,{error:'PRICE_OR_STOCK_REJECTED'});
      // No raw PostgREST error, token, cookie, IP or secret returned.
      return send(res,503,{error:'PREVIEW_RPC_REJECTED'});
    }
    if(typeof data.request_id!=='string'||
       !/^[a-f0-9-]{36}$/i.test(data.request_id)||
       data.total!==33000||!Array.isArray(data.items)||data.items.length!==1)
      return send(res,503,{error:'PREVIEW_RPC_BAD_RESPONSE'});
    return send(res,data.reused===true?200:201,{environment:'preview',
      testOrderId:data.request_id,reused:data.reused===true,
      status:'whatsapp_bekliyor',testProductId:5});
  }catch{
    // A timeout might follow a COMMITTED order: retry only with SAME idempotency key
    // and fresh Turnstile challenge, never generate a second key automatically.
    return send(res,503,{error:'PREVIEW_RPC_UNAVAILABLE',retryWithSameIdempotencyKey:true});
  }
};
