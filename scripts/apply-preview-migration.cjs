// Explicit manual operation, never a Vercel build/deploy hook. Requires local psql.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {previewTarget,PRODUCTION_REF}=require('../lib/supabase-environment.cjs');
function plan(env){
  if(env.VERCEL_ENV==='production') throw new Error('Production migration blocked');
  const target=previewTarget(env);
  let db;try{db=new URL(env.PREVIEW_DATABASE_URL);}catch{throw new Error('PREVIEW_DATABASE_URL required');}
  // Only direct Supabase DB hosts are accepted. No pooler, proxy or fallback.
  if(!['postgres:','postgresql:'].includes(db.protocol) || db.hostname!==`db.${target.projectRef}.supabase.co` || db.hostname.includes(PRODUCTION_REF)
    || db.username!=='postgres' || !db.password || db.pathname!=='/postgres' || (db.port && db.port!=='5432')
    || [...db.searchParams.keys()].some(k=>k!=='sslmode') || (db.searchParams.has('sslmode') && db.searchParams.get('sslmode')!=='verify-full')){
    throw new Error('Only the matching isolated direct test database with verified TLS is allowed');
  }
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/order-on-demand.sql'),'utf8');
  return {ref:target.projectRef,host:db.hostname,password:decodeURIComponent(db.password),sql:
    `set cadde_depo.migration_environment='preview';\nset cadde_depo.preview_project_ref='${target.projectRef}';\n`+sql};
}
function main(args=process.argv.slice(2),env=process.env){
  if(args.length!==1 || !['--check','--apply'].includes(args[0])) throw new Error('Use --check or --apply explicitly');
  const p=plan(env);
  if(args[0]==='--check'){console.log('Preview target and migration validated; no database connection made.');return;}
  const result=spawnSync('psql',['--no-psqlrc','--host',p.host,'--port','5432','--username','postgres','--dbname','postgres','--set','ON_ERROR_STOP=1'],{
    input:p.sql,encoding:'utf8',env:{...env,PGPASSWORD:p.password,PGSSLMODE:'verify-full',PGCONNECT_TIMEOUT:'15',PGOPTIONS:'',PGHOSTADDR:'',PGSERVICE:'',PGSERVICEFILE:'',PGPASSFILE:''}
  });
  // Do not echo psql output: connection failures can contain sensitive details.
  if(result.error || result.status!==0) throw new Error('Isolated migration failed; verify test prerequisites and local psql (details suppressed).');
  console.log('Migration applied to the validated isolated test database.');
}
if(require.main===module){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={plan,main};
