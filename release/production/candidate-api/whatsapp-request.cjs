'use strict';
// CADDE DEPO — PRODUCTION CANDIDATE ONLY.
// This file is deliberately outside /api and is NOT a Vercel route.
// NO-GO: requires reviewed production migrations, secret setup and release approval.
const {createHmac}=require('node:crypto');
const {isIP}=require('node:net');

const PROJECT_REF='svyqmmivhpfiuhxnmhny';
const PROJECT_URL='https://'+PROJECT_REF+'.supabase.co';
const HOSTS=new Set(['caddedepo.com','www.caddedepo.com']);
const LIMIT=8192;
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function send(res,status,payload){
  res.writeHead(status,HEADERS);
  res.end(JSON.stringify(payload));
}
function ready(){
  const e=process.env;
  return e.VERCEL==='1' && e.VERCEL_ENV==='production' &&
    e.CADDE_DEPLOY_STAGE==='production' && e.CADDE_ORDER_API_ENABLED==='on' &&
    e.CADDE_EXPECTED_SUPABASE_REF===PROJECT_REF && e.SUPABASE_URL===PROJECT_URL &&
    typeof e.SUPABASE_SERVICE_ROLE_KEY==='string' && e.SUPABASE_SERVICE_ROLE_KEY.length>16 &&
    typeof e.TURNSTILE_SECRET_KEY==='string' && e.TURNSTILE_SECRET_KEY.length>16 &&
    typeof e.TURNSTILE_SITE_KEY==='string' && e.TURNSTILE_SITE_KEY.length>0 &&
    typeof e.CADDE_RATE_SALT==='string' && e.CADDE_RATE_SALT.length>=32;
}
function requestIp(req){
  // Trust only after ready() confirms the Vercel production runtime.
  // Vercel documents it replaces forwarded-for to prevent client IP spoofing.
  const raw=req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for'];
  const first=String(Array.isArray(raw)?raw[0]:raw||'').split(',')[0].trim();
  return isIP(first)?first:null;
}
async function payload(req){
  if(req.body!==undefined){
    const buf=Buffer.isBuffer(req.body)?req.body:
      Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));
    if(buf.length>LIMIT)throw Object.assign(new Error('oversize'),{httpStatus:413});
    return JSON.parse(buf.toString('utf8'));
  }
  const buffers=[]; let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>LIMIT)throw Object.assign(new Error('oversize'),{httpStatus:413});
    buffers.push(chunk);
  }
  return JSON.parse(Buffer.concat(buffers).toString('utf8'));
}
function validUuid(s,version){
  const pat=version===4?
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i:
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return typeof s==='string' && pat.test(s);
}
function validCart(body){
  return body && typeof body==='object' && !Array.isArray(body) &&
    Array.isArray(body.productIds) && body.productIds.length>=1 &&
    body.productIds.length<=12 &&
    body.productIds.every(x=>Number.isSafeInteger(x)&&x>0) &&
    typeof body.expectedTotal==='number' && Number.isFinite(body.expectedTotal) &&
    body.expectedTotal>0 && body.expectedTotal<=1000000000 &&
    typeof body.turnstileToken==='string' && body.turnstileToken.length>=1 &&
    body.turnstileToken.length<=2048 &&
    validUuid(body.visitorId,4) && validUuid(body.idempotencyKey);
}
module.exports=async function candidateGateway(req,res){
  if(!['GET','POST'].includes(req.method))return send(res,405,{error:'METHOD_NOT_ALLOWED'});
  if(!ready())return send(res,503,{error:'ORDER_API_DISABLED'});
  const host=String(req.headers.host||'').toLowerCase();
  if(!HOSTS.has(host))return send(res,403,{error:'HOST_REJECTED'});
  if(req.method==='GET')return send(res,200,{enabled:true,siteKey:process.env.TURNSTILE_SITE_KEY});
  if(req.headers.origin!=='https://'+host)return send(res,403,{error:'ORIGIN_MISMATCH'});
  const ip=requestIp(req);
  if(!ip)return send(res,403,{error:'IP_UNAVAILABLE'});
  if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))
    return send(res,415,{error:'JSON_REQUIRED'});
  const length=Number(req.headers['content-length']||0);
  if(!Number.isFinite(length)||length<0)return send(res,400,{error:'INVALID_CONTENT_LENGTH'});
  if(length>LIMIT)return send(res,413,{error:'REQUEST_TOO_LARGE'});
  let body;
  try{body=await payload(req);}catch(e){
    return send(res,e.httpStatus===413?413:400,{error:e.httpStatus===413?'REQUEST_TOO_LARGE':'INVALID_JSON'});
  }
  if(!validCart(body))return send(res,400,{error:'INVALID_CART_OR_CHALLENGE'});

  try{
    const challenge=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({secret:process.env.TURNSTILE_SECRET_KEY,response:body.turnstileToken,remoteip:ip}),
      signal:AbortSignal.timeout(7500)
    });
    if(!challenge.ok)return send(res,503,{error:'BOT_VERIFICATION_UNAVAILABLE'});
    const check=await challenge.json();
    if(check.success!==true||check.hostname!==host||check.action!=='checkout')
      return send(res,403,{error:'BOT_VERIFICATION_FAILED'});

    const salt=process.env.CADDE_RATE_SALT;
    const visitorHash=createHmac('sha256',salt).update('visitor:'+body.visitorId).digest('hex');
    const rateHash=createHmac('sha256',salt).update('ip:'+ip).digest('hex');
    const result=await fetch(PROJECT_URL+'/rest/v1/rpc/create_whatsapp_request_protected_v3',{
      method:'POST',
      headers:{
        apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        p_product_ids:body.productIds,p_expected_total:body.expectedTotal,
        p_visitor_hash:visitorHash,p_rate_hash:rateHash,
        p_idempotency_key:body.idempotencyKey
      }),
      signal:AbortSignal.timeout(10000)
    });
    const data=await result.json().catch(()=>({}));
    if(!result.ok){
      const message=String(data.message||'');
      if(message.includes('RATE_LIMITED'))return send(res,429,{error:'RATE_LIMITED'});
      if(/IDEMPOTENCY_CONFLICT|IDEMPOTENCY_EXPIRED|REQUEST_ALREADY_HANDLED|UNTRUSTED_ORDER_SOURCE/.test(message))
        return send(res,409,{error:'REQUEST_REPLAY_REJECTED'});
      if(/PRICE_CHANGED|PRODUCT_UNAVAILABLE/.test(message))
        return send(res,409,{error:'STOCK_OR_PRICE_CHANGED'});
      console.error('Cadde checkout rejected:',result.status,String(data.code||'unknown'));
      return send(res,503,{error:'REQUEST_COULD_NOT_BE_SAVED'});
    }
    if(typeof data.request_id!=='string'||!Array.isArray(data.items)||
       typeof data.total!=='number'||!Number.isFinite(data.total))
      return send(res,503,{error:'INVALID_DB_RESPONSE'});
    return send(res,data.reused===true?200:201,data);
  }catch(e){
    console.error('Cadde checkout service unavailable:',String(e?.name||'unknown'));
    return send(res,503,{error:'REQUEST_UNAVAILABLE'});
  }
};
