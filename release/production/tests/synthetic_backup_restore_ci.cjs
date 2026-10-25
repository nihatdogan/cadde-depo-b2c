'use strict';
// Synthetic backup/restore exercise for CI only. NEVER run against managed Supabase.
// This demonstrates local PostgreSQL dump/restore, NOT Production backup readiness.
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
assert.equal(process.env.CADDE_CI_ISOLATED,'1','CI isolation flag required');
assert.equal(process.env.PGHOST,'127.0.0.1','Network must be loopback');
assert.equal(process.env.PGPORT,'5432','Synthetic PostgreSQL port only');
assert.equal(process.env.PGDATABASE,'cadde_ci','Synthetic DB only');
assert.equal(process.env.PGUSER,'postgres','Synthetic admin only');
const target='cadde_restore_ci';
const dump=path.join(os.tmpdir(),'cadde-synthetic-'+randomUUID()+'.dump');
const run=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',timeout:60000,
  env:process.env,stdio:['ignore','pipe','pipe']});
let created=false;
try{
  run('pg_dump',['--format=custom','--file',dump,'--dbname','cadde_ci']);
  run('psql',['-X','-v','ON_ERROR_STOP=1','-d','postgres','-c','CREATE DATABASE '+target]);
  created=true;
  run('pg_restore',['--no-owner','--dbname',target,dump]);
  const q="SELECT json_build_object("+
    "'products',(SELECT count(*) FROM public.products),"+
    "'orders',(SELECT count(*) FROM public.orders),"+
    "'items',(SELECT count(*) FROM public.order_items),"+
    "'trusted_table',to_regclass('cadde_internal.trusted_checkout_orders') IS NOT NULL,"+
    "'rls_products',(SELECT relrowsecurity FROM pg_class WHERE oid='public.products'::regclass),"+
    "'rpc_v3',(SELECT count(*) FROM pg_proc WHERE proname='create_whatsapp_request_protected_v3'"+
      " AND pronamespace='public'::regnamespace),"+
    "'admin_rpc',(SELECT count(*) FROM pg_proc WHERE proname='admin_set_order_status_audited'"+
      " AND pronamespace='public'::regnamespace))::text;";
  const data=JSON.parse(run('psql',['-X','-At','-v','ON_ERROR_STOP=1','-d',target,'-c',q]).trim());
  assert.equal(data.products,1);
  assert.equal(data.orders,2);
  assert.equal(data.items,2);
  assert.equal(data.trusted_table,true);
  assert.equal(data.rls_products,true);
  assert.equal(data.rpc_v3,1);
  assert.equal(data.admin_rpc,1);
  console.log('SYNTHETIC_PG16_DUMP_RESTORE_PASS: objects, rows, RLS, RPC; Production restore NOT tested');
}finally{
  if(created){
    try{run('psql',['-X','-v','ON_ERROR_STOP=1','-d','postgres','-c','DROP DATABASE IF EXISTS '+target]);}
    catch(err){console.error('Synthetic restore DB cleanup failed:',err.message);process.exitCode=1;}
  }
  try{fs.unlinkSync(dump);}catch{}
}
