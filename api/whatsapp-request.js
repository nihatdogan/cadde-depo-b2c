// CADDE DEPO — Preview-only WhatsApp request gateway.
// Never send the service role key or Turnstile secret to the browser.
// Production intentionally fails closed until separately reviewed and deployed.
const { createHmac } = require('node:crypto');
const { isIP } = require('node:net');

const PREVIEW_REF = 'emnacsavgsjkrocpngcj';
const PREVIEW_URL = 'https://' + PREVIEW_REF + '.supabase.co';
const NO_STORE = { 'Cache-Control':'no-store', 'Content-Type':'application/json; charset=utf-8' };
const reply = (res, status, data) => res.writeHead(status, NO_STORE).end(JSON.stringify(data));

function configured() {
  return process.env.VERCEL === '1' &&
    process.env.VERCEL_ENV === 'preview' &&
    process.env.VERCEL_GIT_COMMIT_REF === 'fix/whatsapp-stok-guard-20261022' &&
    process.env.CADDE_DEPLOY_STAGE === 'preview' &&
    process.env.CADDE_EXPECTED_SUPABASE_REF === PREVIEW_REF &&
    process.env.SUPABASE_URL === PREVIEW_URL &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    Boolean(process.env.TURNSTILE_SITE_KEY) &&
    Boolean(process.env.TURNSTILE_SECRET_KEY) &&
    Boolean(process.env.CADDE_RATE_SALT);
}

function clientIp(req) {
  // On Vercel, the platform overwrites X-Forwarded-For to prevent spoofing.
  // NEVER use an untrusted request header when running off-platform.
  const raw = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'];
  const first = String(Array.isArray(raw) ? raw[0] : raw || '').split(',')[0].trim();
  return isIP(first) ? first : null;
}

module.exports = async (req,res) => {
  if (!['GET','POST'].includes(req.method)) return reply(res,405,{error:'METHOD_NOT_ALLOWED'});
  if (!configured()) return reply(res,503,{error:'PREVIEW_SECURITY_NOT_CONFIGURED'});
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  const expectedHost='caddedepo-b2c-git-fix-whatsapp-stok-guard-20261022-nihat-proje.vercel.app';
  if (host!==expectedHost) return reply(res,403,{error:'PREVIEW_ONLY'});
  if (req.method==='GET') return reply(res,200,{enabled:true,siteKey:process.env.TURNSTILE_SITE_KEY});

  const origin = String(req.headers.origin || '');
  if (origin !== 'https://' + host) return reply(res,403,{error:'ORIGIN_MISMATCH'});
  // Reject missing/oversized body prior to challenge verification.
  if (req.method==='POST' && !req.headers.origin) return reply(res,403,{error:'ORIGIN_REQUIRED'});
  const ip = clientIp(req);
  if (!ip) return reply(res,403,{error:'IP_UNAVAILABLE'});
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.startsWith('application/json')) return reply(res,415,{error:'JSON_REQUIRED'});
  if (Number(req.headers['content-length'] || 0)>8192) return reply(res,413,{error:'REQUEST_TOO_LARGE'});

  let body;
  try {
    body = typeof req.body==='string' ? JSON.parse(req.body)
      : Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;
  } catch {return reply(res,400,{error:'INVALID_JSON'});}
  if (!body || typeof body!=='object' || Array.isArray(body) ||
      !Array.isArray(body.productIds) || body.productIds.length<1 || body.productIds.length>12 ||
      body.productIds.some(id=>!Number.isSafeInteger(id)||id<=0) ||
      typeof body.expectedTotal!=='number' || !Number.isFinite(body.expectedTotal) ||
      body.expectedTotal<=0 || body.expectedTotal>1000000000 ||
      typeof body.turnstileToken!=='string' ||
      body.turnstileToken.length<1 || body.turnstileToken.length>2048 ||
      typeof body.visitorId!=='string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.visitorId) ||
      typeof body.idempotencyKey!=='string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey)) {
    return reply(res,400,{error:'INVALID_CART_OR_CHALLENGE'});
  }
  try {
    const challenge = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({secret:process.env.TURNSTILE_SECRET_KEY,
        response:body.turnstileToken,remoteip:ip}),
      signal:AbortSignal.timeout(7500)
    });
    if (!challenge.ok) return reply(res,503,{error:'BOT_VERIFICATION_UNAVAILABLE'});
    const verified = await challenge.json();
    if (verified.success!==true ||
        verified.hostname!==host ||
        verified.action!=='checkout') {
      return reply(res,403,{error:'BOT_VERIFICATION_FAILED'});
    }

    const visitorHash=createHmac('sha256',process.env.CADDE_RATE_SALT).update('visitor:'+body.visitorId).digest('hex');
    const rateHash=createHmac('sha256',process.env.CADDE_RATE_SALT).update('ip:'+ip).digest('hex');
    const db = await fetch(PREVIEW_URL+'/rest/v1/rpc/create_whatsapp_request_protected_v2',{
      method:'POST',headers:{
        apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({p_product_ids:body.productIds,
        p_expected_total:body.expectedTotal,p_visitor_hash:visitorHash,
        p_rate_hash:rateHash,p_idempotency_key:body.idempotencyKey}),
      signal:AbortSignal.timeout(10000)
    });
    const result = await db.json().catch(()=>({}));
    if (!db.ok) {
      const message=String(result.message||'');
      if (message.includes('RATE_LIMITED')) return reply(res,429,{error:'RATE_LIMITED'});
      if (message.includes('IDEMPOTENCY_CONFLICT') || message.includes('IDEMPOTENCY_EXPIRED') || message.includes('REQUEST_ALREADY_HANDLED')) return reply(res,409,{error:'REQUEST_REPLAY_REJECTED'});
      if (message.includes('PRODUCT_UNAVAILABLE') || message.includes('PRICE_CHANGED'))
        return reply(res,409,{error:'STOCK_OR_PRICE_CHANGED'});
      console.error('WhatsApp request DB rejected:',db.status,result.code||'unknown');
      return reply(res,503,{error:'REQUEST_COULD_NOT_BE_SAVED'});
    }
    if (!result || !Array.isArray(result.items) || typeof result.request_id!=='string')
      return reply(res,503,{error:'INVALID_DB_RESPONSE'});
    return reply(res,result.reused===true?200:201,result);
  } catch (error) {
    console.error('WhatsApp gateway failure:',error?.name || 'unknown');
    return reply(res,503,{error:'REQUEST_UNAVAILABLE'});
  }
};
