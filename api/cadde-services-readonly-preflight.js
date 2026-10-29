'use strict';
// CADDE DEPO — Preview-only no-order real service integration check.
// Cloudflare TEST Siteverify + read-only isolated Preview Supabase GET.
// This route never invokes a checkout RPC, stores no order and exposes no secrets.
module.exports=async function handler(req,res){
  const reply=(status,data)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.status(status).json(data);
  };
  if(req.method!=='GET')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(process.env.VERCEL!=='1' ||
     process.env.VERCEL_ENV!=='preview' ||
     process.env.VERCEL_GIT_COMMIT_REF!=='prep/production-order-security-20261024'){
    return reply(404,{error:'NOT_FOUND'});
  }
  const previewUrl='https://emnacsavgsjkrocpngcj.supabase.co';
  if(process.env.SUPABASE_URL!==previewUrl){
    return reply(503,{error:'PREVIEW_SUPABASE_REF_MISMATCH',orderWrites:0});
  }
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(typeof key!=='string'||key.length<18)
    return reply(503,{error:'PREVIEW_SUPABASE_KEY_UNAVAILABLE',orderWrites:0});
  // Cloudflare officially published always-pass test secret; do NOT use production secret.
  const cloudflareTestSecret='1x0000000000000000000000000000000AA';
  const checks={turnstile:'not_checked',supabase:'not_checked'};
  try{
    const cf=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({secret:cloudflareTestSecret,response:'XXXX.DUMMY.TOKEN.XXXX'}),
      signal:AbortSignal.timeout(8000)
    });
    const cfResult=cf.ok?await cf.json():null;
    checks.turnstile=cfResult?.success===true?'passed':'failed';
  }catch{checks.turnstile='unavailable';}
  try{
    const db=await fetch(previewUrl+'/rest/v1/products?select=id&id=eq.5&limit=1',{
      method:'GET',
      headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'},
      signal:AbortSignal.timeout(8000)
    });
    const body=db.ok?await db.json():null;
    checks.supabase=db.ok&&Array.isArray(body)&&body.some(p=>p.id===5)?'passed':'failed';
  }catch{checks.supabase='unavailable';}
  const ok=checks.turnstile==='passed'&&checks.supabase==='passed';
  // Only test state is returned; product, token, IP and secrets are never returned.
  return reply(ok?200:503,{
    verified:ok,environment:'preview',tests:checks,
    orderWrites:0,
    note:'read-only isolated Supabase and Cloudflare official dummy challenge; not a checkout test'
  });
};
