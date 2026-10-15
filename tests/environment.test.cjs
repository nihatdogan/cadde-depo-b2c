const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const {getPublicConfig,getUploadConfig,PRODUCTION_REF,PRODUCTION_URL}=require('../lib/supabase-environment.cjs');
const configHandler=require('../api/public-config.js');
const upload=require('../api/admin/upload-product-image.js');
const {plan,main}=require('../scripts/apply-preview-migration.cjs');
const ref='abcdefghijklmnopqrst';
const url=`https://${ref}.supabase.co`;
const preview={VERCEL_ENV:'preview',PREVIEW_SUPABASE_PROJECT_REF:ref,PREVIEW_SUPABASE_URL:url,PREVIEW_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_only'};
const jwt=payload=>Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.test';
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},send(s){this.body=s;return this;},json(s){this.body=s;return this;}};}
async function withEnv(env,fn){const original=process.env;process.env={...env};try{return await fn();}finally{process.env=original;}}
function browser(config){
 const calls=[],banners=[];
 const window={CD_PUBLIC_CONFIG:config,atob:s=>Buffer.from(s,'base64').toString('binary'),supabase:{createClient(...args){calls.push(args);return {testClient:true};}}};
 const document={body:{prepend:b=>banners.push(b)},createElement:()=>({style:{},setAttribute(){}})};
 vm.runInNewContext(fs.readFileSync('supabase-client.js','utf8'),{window,document});
 return {window,calls,banners,connect:()=>window.CDDatabase.createClient()};
}
test('production public connection and default auth options remain unchanged',()=>{
 const c=getPublicConfig({VERCEL_ENV:'production',...{PREVIEW_SUPABASE_URL:url}});
 assert.equal(c.url,PRODUCTION_URL);assert.equal(c.publishableKey,'sb_publishable_Qdwrd6dyEx_rjTHonVNw6w_zjGKtw2B');
 const b=browser(c);b.connect();assert.equal(b.calls[0].length,2);
});
test('preview uses only its independent test target and isolated auth storage',()=>{
 const c=getPublicConfig({...preview,SUPABASE_URL:PRODUCTION_URL,SUPABASE_SERVICE_ROLE_KEY:'production-secret'});
 assert.equal(c.url,url);assert.equal(c.projectRef,ref);
 const b=browser(c);b.connect();assert.equal(b.calls[0][0],url);
 assert.equal(b.calls[0][2].auth.storageKey,`cd-preview-${ref}-auth`);
 assert.equal(b.calls[0][2].auth.detectSessionInUrl,false);
});
test('missing test settings never fall back to production variables',()=>{
 for(const key of ['PREVIEW_SUPABASE_URL','PREVIEW_SUPABASE_PROJECT_REF','PREVIEW_SUPABASE_PUBLISHABLE_KEY']){
  const env={...preview,SUPABASE_URL:PRODUCTION_URL,SUPABASE_ANON_KEY:'production-public'};delete env[key];
  assert.throws(()=>getPublicConfig(env),/BLOCKED/);
 }
 for(const VERCEL_ENV of [undefined,'','staging','Production'])assert.throws(()=>getPublicConfig({...preview,VERCEL_ENV}),/BLOCKED/);
});
test('production project, mismatched URL, insecure URL and URL tricks are blocked',()=>{
 for(const PREVIEW_SUPABASE_URL of [PRODUCTION_URL,url+'/',url+'/rest/v1','http://'+ref+'.supabase.co',url+'.evil.example',`https://user@${ref}.supabase.co`]){
  assert.throws(()=>getPublicConfig({...preview,PREVIEW_SUPABASE_URL}),/BLOCKED/);
 }
 assert.throws(()=>getPublicConfig({...preview,PREVIEW_SUPABASE_PROJECT_REF:PRODUCTION_REF,PREVIEW_SUPABASE_URL:PRODUCTION_URL}),/BLOCKED/);
});
test('only publishable or matching legacy anon keys can reach the browser',()=>{
 const key=jwt({role:'anon',ref});assert.equal(getPublicConfig({...preview,PREVIEW_SUPABASE_PUBLISHABLE_KEY:key}).publishableKey,key);
 for(const k of ['sb_secret_test_secret',jwt({role:'service_role',ref}),jwt({role:'anon',ref:PRODUCTION_REF}),'garbage']){
  assert.throws(()=>getPublicConfig({...preview,PREVIEW_SUPABASE_PUBLISHABLE_KEY:k}),/BLOCKED/);
 }
});
test('runtime Function returns an allowlist with no secrets and no cache',async()=>{
 await withEnv({...preview,SUPABASE_SERVICE_ROLE_KEY:'DO-NOT-EXPOSE-PROD',PREVIEW_SUPABASE_SERVICE_ROLE_KEY:'DO-NOT-EXPOSE-TEST',PREVIEW_DATABASE_URL:'DO-NOT-EXPOSE-DB'},()=>{
  const res=response();configHandler({method:'GET',headers:{host:'arbitrary.example'}},res);
  assert.equal(res.statusCode,200);assert.match(res.headers['Cache-Control'],/no-store/);assert.equal(res.headers['Vercel-CDN-Cache-Control'],'no-store');
  assert.doesNotMatch(res.body,/DO-NOT-EXPOSE|service_role|sb_secret|PREVIEW_DATABASE_URL/);
  const w={};vm.runInNewContext(res.body,{window:w});assert.equal(w.CD_PUBLIC_CONFIG.url,url);
  assert.deepEqual(Object.keys(w.CD_PUBLIC_CONFIG).sort(),['environment','projectRef','publishableKey','url']);
 });
});
test('runtime endpoint cannot be switched by request headers/query and fails closed',async()=>{
 await withEnv({VERCEL_ENV:'preview',SUPABASE_URL:PRODUCTION_URL},()=>{
  const res=response();configHandler({method:'GET',query:{environment:'production'},headers:{'x-vercel-env':'production'}},res);
  assert.equal(res.statusCode,503);assert.equal(res.body,'window.CD_PUBLIC_CONFIG=null;');
  assert.doesNotMatch(res.body,/supabase.co|publishable/);
 });
 await withEnv(preview,()=>{const res=response();configHandler({method:'POST'},res);assert.equal(res.statusCode,405);assert.equal(res.headers.Allow,'GET');});
});
test('browser missing/invalid configuration makes zero SDK/auth/database calls',()=>{
 for(const config of [undefined,null,{}, {...getPublicConfig(preview),url:PRODUCTION_URL}, {...getPublicConfig(preview),projectRef:PRODUCTION_REF,url:PRODUCTION_URL}, {...getPublicConfig(preview),publishableKey:'sb_secret_private'}, {...getPublicConfig(preview),publishableKey:jwt({role:'service_role',ref})}]){
  const b=browser(config);assert.throws(b.connect,/BLOCKED/);assert.equal(b.calls.length,0);assert.ok(b.banners.length>=1);
 }
});
test('all four HTML pages load runtime scripts before any client; no static target',()=>{
 for(const f of ['index.html','urun.html','admin.html','admin-gorsel.html']){
  const s=fs.readFileSync(f,'utf8');assert.doesNotMatch(s,/svyqmmivhpfiuhxnmhny|sb_publishable_|SUPABASE_ANON_KEY|supabase\.createClient/);
  assert.ok(s.indexOf('src="/api/public-config"')<s.indexOf('src="/supabase-client.js"'));
  assert.ok(s.indexOf('src="/supabase-client.js"')<s.indexOf('CDDatabase.createClient()'));
  for(const m of s.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1],{filename:f});
 }
});
test('upload production uses the same existing server configuration',()=>{
 const c=getUploadConfig({VERCEL_ENV:'production',SUPABASE_URL:PRODUCTION_URL,SUPABASE_SERVICE_ROLE_KEY:'existing-production-secret',ADMIN_EMAILS:'admin@example.test'});
 assert.equal(c.url,PRODUCTION_URL);assert.equal(c.serviceRoleKey,'existing-production-secret');assert.equal(c.adminEmails,'admin@example.test');
});
test('preview upload requires a separate test secret; production secret is ignored',()=>{
 assert.throws(()=>getUploadConfig({...preview,SUPABASE_SERVICE_ROLE_KEY:'production-secret'}),/BLOCKED/);
 const c=getUploadConfig({...preview,PREVIEW_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test_only'});
 assert.equal(c.url,url);assert.equal(c.requireAdminRole,true);
 assert.throws(()=>getUploadConfig({...preview,PREVIEW_SUPABASE_SERVICE_ROLE_KEY:jwt({role:'service_role',ref:PRODUCTION_REF})}),/BLOCKED/);
});
test('blocked upload never makes an auth or storage network request',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('network forbidden');};
 try{await withEnv({VERCEL_ENV:'preview',SUPABASE_URL:PRODUCTION_URL,SUPABASE_SERVICE_ROLE_KEY:'production-secret'},async()=>{
  const res=response();await upload({method:'POST',headers:{authorization:'Bearer test'}},res);assert.equal(res.statusCode,503);assert.equal(calls,0);
 });}finally{global.fetch=original;}
});
test('preview upload rejects a non-admin authenticated user before storage',async()=>{
 const original=global.fetch;const calls=[];global.fetch=async(u)=>{calls.push(u);return Response.json({id:'test-user',app_metadata:{},user_metadata:{role:'admin'}});};
 try{await withEnv({...preview,PREVIEW_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test_only'},async()=>{
  const res=response();await upload({method:'POST',headers:{authorization:'Bearer test-token'}},res);assert.equal(res.statusCode,403);assert.deepEqual(calls,[url+'/auth/v1/user']);
 });}finally{global.fetch=original;}
});
test('authorized preview upload reaches only test auth and test storage',async()=>{
 const original=global.fetch;const calls=[];global.fetch=async(u)=>{calls.push(u);return u.endsWith('/auth/v1/user')?Response.json({id:'test-admin',app_metadata:{role:'admin'}}):new Response('',{status:200});};
 try{await withEnv({...preview,PREVIEW_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test_only'},async()=>{
  const form=new FormData();form.set('file',new Blob(['test-image'],{type:'image/png'}),'test.png');
  const req=new Request('https://local.test',{method:'POST',body:form});
  const res=response();await upload({method:'POST',headers:{authorization:'Bearer test-token','content-type':req.headers.get('content-type')},body:Buffer.from(await req.arrayBuffer())},res);
  assert.equal(res.statusCode,200);assert.equal(calls.length,2);assert.ok(calls.every(u=>u.startsWith(url+'/')));assert.ok(res.body.url.startsWith(url+'/storage/'));
 });}finally{global.fetch=original;}
});
test('migration runner validates direct target and never chooses production or pooler',()=>{
 const env={...preview,PREVIEW_DATABASE_URL:`postgresql://postgres:fake-password@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`};
 const p=plan(env);assert.equal(p.host,`db.${ref}.supabase.co`);assert.match(p.sql,/migration_environment='preview'/);
 for(const PREVIEW_DATABASE_URL of [env.PREVIEW_DATABASE_URL.replace(ref,PRODUCTION_REF),env.PREVIEW_DATABASE_URL.replace('db.'+ref+'.supabase.co','pooler.supabase.com'),env.PREVIEW_DATABASE_URL.replace('verify-full','disable'),env.PREVIEW_DATABASE_URL+'&options=bad']){
  assert.throws(()=>plan({...env,PREVIEW_DATABASE_URL}));
 }
 assert.throws(()=>plan({...env,VERCEL_ENV:'production'}),/blocked/);
 assert.throws(()=>main([],env),/explicitly/);
 main(['--check'],env); // No psql invocation and no database connection.
});
test('migration SQL aborts before DDL without isolated marker or with production ref',async()=>{
 const sql=fs.readFileSync('supabase/order-on-demand.sql','utf8');
 for(const marker of [null,PRODUCTION_REF]){
  const db=new PGlite();try{
   if(marker)await db.query("select set_config('cadde_depo.migration_environment','preview',false),set_config('cadde_depo.preview_project_ref',$1,false)",[marker]);
   await assert.rejects(db.exec(sql),/PREVIEW_DATABASE_ONLY/);await db.exec('rollback');
   assert.equal((await db.query("select to_regclass('public.supply_requests') t")).rows[0].t,null);
  }finally{await db.close();}
 }
});

test('all runtime, server and migration runner JavaScript compiles',()=>{
 for(const file of ['supabase-client.js','lib/supabase-environment.cjs','api/public-config.js','api/admin/upload-product-image.js','scripts/apply-preview-migration.cjs']){
  new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
 }
});
