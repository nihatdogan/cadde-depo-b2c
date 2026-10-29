'use strict';
// CADDE DEPO — V3 NEGATIVE CANARY, READ/REJECT ONLY, PREVIEW BRANCH ONLY.
// This route never sends a valid checkout payload, never returns credentials,
// and never modifies order/stock/audit data. Production and main are out of scope.
module.exports = async function(req,res){
  const reply=(status,body)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.status(status).json(body);
  };
  if(req.method!=='GET')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  const e=process.env;
  if(e.VERCEL!=='1'||e.VERCEL_ENV!=='preview'||
     e.VERCEL_GIT_COMMIT_REF!=='prep/production-order-security-20261024')
    return reply(404,{error:'NOT_FOUND'});
  const api='https://emnacsavgsjkrocpngcj.supabase.co';
  if(e.SUPABASE_URL!==api)
    return reply(503,{error:'WRONG_PREVIEW_DATABASE'});
  const key=e.SUPABASE_SERVICE_ROLE_KEY;
  if(typeof key!=='string'||key.length<18)
    return reply(503,{error:'PREVIEW_SERVER_KEY_UNAVAILABLE'});
  const results={cloudflare_siteverify:'unavailable',managed_supabase_v3_rejection:'unavailable'};
  try{
    const cf=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({secret:'1x0000000000000000000000000000000AA',
                           response:'XXXX.DUMMY.TOKEN.XXXX'}),
      signal:AbortSignal.timeout(8000)
    });
    const answer=cf.ok?await cf.json():null;
    results.cloudflare_siteverify=answer?.success===true?'passed':'failed';
  }catch{results.cloudflare_siteverify='unavailable';}
  try{
    // The following payload is intentionally INVALID:
    // both hashes invalid, zero items, nonpositive total and null UUID.
    // The database v3 function validates these before any INSERT, UPDATE
    // or quota operation. Never accept payload from caller on this endpoint.
    const rpc=await fetch(api+'/rest/v1/rpc/create_whatsapp_request_protected_v3',{
      method:'POST',
      headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({
        p_product_ids:[],p_expected_total:0,
        p_visitor_hash:'not-a-valid-hash',p_rate_hash:'not-a-valid-hash',
        p_idempotency_key:null
      }),
      signal:AbortSignal.timeout(8000)
    });
    const body=await rpc.json().catch(()=>({}));
    // PostgREST error code returned by our SQL RAISE EXCEPTION ERRCODE 22023.
    results.managed_supabase_v3_rejection=
      rpc.status>=400 && body.code==='22023' &&
      String(body.message||'').startsWith('INVALID_IDENTITY')?'passed':'failed';
  }catch{results.managed_supabase_v3_rejection='unavailable';}
  const ok=Object.values(results).every(v=>v==='passed');
  return reply(ok?200:503,{verified:ok,environment:'preview',checks:results,
    checkout_created:false,
    note:'Negative request rejected before any database writes; not a real checkout test'});
};
