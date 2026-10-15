// Server-only selection; never spread process.env into a public response.
const PRODUCTION_REF='svyqmmivhpfiuhxnmhny';
const PRODUCTION_URL=`https://${PRODUCTION_REF}.supabase.co`;
const PRODUCTION_PUBLIC_KEY='sb_publishable_Qdwrd6dyEx_rjTHonVNw6w_zjGKtw2B';
function fail(){throw new Error('DATABASE_ENVIRONMENT_BLOCKED');}
function previewTarget(env){
  const ref=env.PREVIEW_SUPABASE_PROJECT_REF;
  if(!/^[a-z0-9]{20}$/.test(ref||'') || ref===PRODUCTION_REF) fail();
  if(env.PREVIEW_SUPABASE_URL!==`https://${ref}.supabase.co`) fail();
  return {projectRef:ref,url:env.PREVIEW_SUPABASE_URL};
}
function jwtPayload(key){
  try {return JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));}catch {fail();}
}
function publicKey(key,ref){
  if(typeof key!=='string') fail();
  if(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return key;
  const payload=jwtPayload(key);
  if(key.split('.').length!==3 || payload.role!=='anon' || payload.ref!==ref) fail();
  return key;
}
function getPublicConfig(env=process.env){
  if(env.VERCEL_ENV==='production') return {environment:'production',projectRef:PRODUCTION_REF,url:PRODUCTION_URL,publishableKey:PRODUCTION_PUBLIC_KEY};
  if(!['preview','development'].includes(env.VERCEL_ENV)) fail();
  const target=previewTarget(env);
  return {environment:env.VERCEL_ENV,...target,publishableKey:publicKey(env.PREVIEW_SUPABASE_PUBLISHABLE_KEY,target.projectRef)};
}
function getUploadConfig(env=process.env){
  if(env.VERCEL_ENV==='production'){
    if(env.SUPABASE_URL!==PRODUCTION_URL || !env.SUPABASE_SERVICE_ROLE_KEY) fail();
    return {url:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY,adminEmails:env.ADMIN_EMAILS||'',requireAdminRole:true};
  }
  // Also require the same public preview setup. Never use production env names here.
  const config=getPublicConfig(env);
  const key=env.PREVIEW_SUPABASE_SERVICE_ROLE_KEY;
  if(typeof key!=='string') fail();
  if(!/^sb_secret_[A-Za-z0-9_-]+$/.test(key)){
    const payload=jwtPayload(key);
    if(key.split('.').length!==3 || payload.role!=='service_role' || payload.ref!==config.projectRef) fail();
  }
  return {url:config.url,serviceRoleKey:key,adminEmails:env.PREVIEW_ADMIN_EMAILS||'',requireAdminRole:true};
}
function getCheckoutConfig(env=process.env){
  const c=getPublicConfig(env),db=getUploadConfig(env);
  if(db.url!==c.url || env.CHECKOUT_ENABLED!=='true' || !/^[A-Za-z0-9_-]{8,200}$/.test(env.CHECKOUT_TURNSTILE_SITE_KEY||'')
    || !env.CHECKOUT_TURNSTILE_SECRET_KEY || (env.CHECKOUT_ACTOR_HASH_SECRET||'').length<32) fail();
  const origins=c.environment==='production'?['https://www.caddedepo.com','https://caddedepo.com']:
    (/^[a-z0-9.-]+\.vercel\.app$/.test(env.VERCEL_URL||'')?[`https://${env.VERCEL_URL}`]:[]);
  if(!origins.length) fail();
  return {...db,origins,siteKey:env.CHECKOUT_TURNSTILE_SITE_KEY,challengeSecret:env.CHECKOUT_TURNSTILE_SECRET_KEY,actorSecret:env.CHECKOUT_ACTOR_HASH_SECRET};
}
module.exports={getCheckoutConfig,PRODUCTION_REF,PRODUCTION_URL,getPublicConfig,getUploadConfig,previewTarget};
