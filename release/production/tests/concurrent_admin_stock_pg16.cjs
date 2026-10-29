'use strict';
// CADDE DEPO T3 — disposable PostgreSQL 16 CI ONLY.
// Two independent AAL2 admin connections race to approve two trusted orders
// against one synthetic unit. Never run on managed Supabase or Production.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn,spawnSync}=require('node:child_process');

const required={
  GITHUB_ACTIONS:'true',CADDE_CI_ISOLATED:'1',
  PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
  PGDATABASE:'cadde_ci',PGPASSWORD:'local-ci-only-not-production'
};
for(const [name,value] of Object.entries(required)){
  if(process.env[name]!==value)throw Error('REFUSE_NON_ISOLATED_CI: '+name);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const adminClaims='{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}';
const adminPrefix="SET ROLE authenticated;\nSET request.jwt.claims = '"+adminClaims+"';\n";

function execSql(sql){
  const r=spawnSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{
    input:sql,encoding:'utf8',env:process.env,timeout:15000
  });
  if(r.error||r.status!==0)throw Error('ISOLATED_PSQL_ERROR: '+String(r.error||r.stderr).slice(-1200));
  return r.stdout.trim();
}
function jsonSql(sql){
  const lines=execSql(sql).split(/\r?\n/).map(x=>x.trim()).filter(x=>x.startsWith('{'));
  assert.equal(lines.length,1,'Expected one JSON result');
  return JSON.parse(lines[0]);
}
function openSession(app){
  const child=spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{
    env:{...process.env,PGAPPNAME:app},stdio:['pipe','pipe','pipe']
  });
  let stderr='',buffer='',ended=false,rows=[],waiting=[];
  const deadline=setTimeout(()=>child.kill('SIGKILL'),20000);
  child.stderr.on('data',d=>stderr+=d.toString('utf8'));
  child.stdout.on('data',chunk=>{
    buffer+=chunk.toString('utf8');
    let at;
    while((at=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);
      if(!line.startsWith('{'))continue;
      try{
        const row=JSON.parse(line);
        if(waiting.length)waiting.shift().resolve(row);else rows.push(row);
      }catch(e){if(waiting.length)waiting.shift().reject(e);}
    }
  });
  child.on('error',e=>{stderr+='\n'+e.message;});
  const done=new Promise(resolve=>child.once('close',code=>{
    ended=true;clearTimeout(deadline);
    for(const w of waiting)w.reject(Error('PSQL_CLOSED '+code+' '+stderr.slice(-700)));
    waiting=[];resolve(code);
  }));
  return {
    send(sql){if(ended)throw Error('SESSION_CLOSED '+stderr);child.stdin.write(sql);},
    row(){if(rows.length)return Promise.resolve(rows.shift());
      if(ended)return Promise.reject(Error('NO_ROW '+stderr));
      return new Promise((resolve,reject)=>waiting.push({resolve,reject}));},
    async close(){if(!ended)child.stdin.end();
      const code=await done;assert.equal(code,0,'SESSION_FAILED '+app+' '+stderr.slice(-1000));},
    kill(){if(!ended)child.kill('SIGKILL');}
  };
}
function approveSQL(id){
  return "SELECT public.admin_set_order_status_audited_v3('"+id+"'::uuid,'onaylandi')::text;\n";
}
function order(visitor,key){
  return jsonSql("SET ROLE service_role;\n"+
    "SELECT public.create_whatsapp_request_protected_v3('[5]'::jsonb,33000,"+
    "repeat('"+visitor+"',64),repeat('"+visitor+"',64),'"+key+"'::uuid)::text;\n").request_id;
}
function snapshot(first,second){
  return jsonSql("SELECT json_build_object("+
    "'stock',(SELECT stok FROM public.products WHERE id=5),"+
    "'approved',(SELECT count(*) FROM public.orders WHERE id IN ('"+first+"'::uuid,'"+second+"'::uuid) AND durum='onaylandi'),"+
    "'pending',(SELECT count(*) FROM public.orders WHERE id IN ('"+first+"'::uuid,'"+second+"'::uuid) AND durum='whatsapp_bekliyor'),"+
    "'reserved',(SELECT count(*) FROM public.orders WHERE id IN ('"+first+"'::uuid,'"+second+"'::uuid) AND stok_rezerve IS TRUE),"+
    "'accepted',(SELECT count(*) FROM cadde_internal.admin_order_status_audit WHERE order_id IN ('"+first+"'::uuid,'"+second+"'::uuid) AND outcome='accepted'),"+
    "'rejected',(SELECT count(*) FROM cadde_internal.admin_order_status_audit WHERE order_id IN ('"+first+"'::uuid,'"+second+"'::uuid) AND outcome='rejected'),"+
    "'unchanged',(SELECT count(*) FROM cadde_internal.admin_order_status_audit WHERE order_id IN ('"+first+"'::uuid,'"+second+"'::uuid) AND outcome='unchanged')"+
    ")::text;\n");
}
async function main(){
  // Reuse the unmodified Preview v3 admin RPC definitions, not the full
  // Preview-only migration or managed database. CI fixture already installs
  // the candidate checkout RPC and provenance tables before this step.
  const migration=fs.readFileSync('release/preview/preview_v3_canary_additive_20261024.sql','utf8');
  const start=migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_set_order_status_v3(');
  assert.ok(start>0,'Preview v3 admin RPC definition missing');
  execSql(migration.slice(start));
  assert.equal(Number(execSql('SELECT stok FROM public.products WHERE id=5;')),1,
    'Synthetic fixture must start with exactly one unit');
  const first=order('4','00000000-0000-4000-8000-00000000e301');
  const second=order('5','00000000-0000-4000-8000-00000000e302');
  assert.notEqual(first,second,'Independent visitors must have independent orders');
  const before=snapshot(first,second);
  assert.deepEqual([before.stock,before.pending,before.reserved,before.accepted],[1,2,0,0]);

  const winner=openSession('cadde-ci-t3-first');
  let contender;
  let committed=false;
  try{
    winner.send('BEGIN;\n'+adminPrefix+approveSQL(first));
    const winningResponse=await winner.row();
    assert.equal(winningResponse.ok,true,'First approval failed');
    assert.equal(winningResponse.reserved,true);
    assert.equal(winningResponse.status,'onaylandi');
    // The first transaction deliberately holds its row lock until COMMIT.
    contender=openSession('cadde-ci-t3-contender');
    contender.send(adminPrefix+approveSQL(second)+'\\q\n');
    const losingPromise=contender.row();
    let contenderCompleted=false;
    losingPromise.then(()=>{contenderCompleted=true;},()=>{contenderCompleted=true;});
    let observedLock=false;
    for(let i=0;i<25;i++){
      await sleep(100);
      const observation=jsonSql(
        "SELECT json_build_object('waiting',EXISTS ("+
        "SELECT 1 FROM pg_stat_activity WHERE application_name='cadde-ci-t3-contender'"+
        " AND state='active' AND wait_event_type='Lock'))::text;");
      if(observation.waiting){observedLock=true;break;}
      if(contenderCompleted)break;
    }
    assert.equal(observedLock,true,'Contender did not actually wait for PostgreSQL lock');
    assert.equal(contenderCompleted,false,'Contender completed before first COMMIT');
    winner.send('COMMIT;\n\\q\n');
    await winner.close();
    committed=true;
    const losingResponse=await losingPromise;
    await contender.close();
    assert.equal(losingResponse.ok,false,'Second approval incorrectly succeeded');
    assert.equal(losingResponse.error_code,'INSUFFICIENT_ACTIVE_STOCK');
    const after=snapshot(first,second);
    assert.deepEqual([after.stock,after.approved,after.pending,after.reserved,
      after.accepted,after.rejected],[0,1,1,1,1,1],
      'Race must reserve only one unit, with a persisted rejection audit');
    console.log('PASS T3: contender blocked on actual lock; 1 approved, 1 rejected, stock 0, audit 1+1');

    const replay=jsonSql(adminPrefix+approveSQL(first));
    assert.equal(replay.ok,true);
    assert.equal(replay.unchanged,true);
    assert.equal(snapshot(first,second).stock,0,'Repeated approval decremented stock');
    console.log('PASS T3: repeated approval remains idempotent without another deduction');

    const cancel=jsonSql(adminPrefix+
      "SELECT public.admin_set_order_status_audited_v3('"+first+"'::uuid,'iptal')::text;\n");
    assert.equal(cancel.ok,true);
    assert.equal(cancel.reserved,false);
    const restored=snapshot(first,second);
    assert.equal(restored.stock,1,'Cancel did not return the single unit');
    assert.equal(restored.reserved,0,'Reservation flag not cleared on cancel');
    assert.equal(restored.unchanged,1,'Repeated approval was not audited');
    console.log('PASS T3: cancellation restored stock to 1, audit and flags agree');
    console.log('T3_CONCURRENT_STOCK_CI_PASS');
  }finally{
    if(!committed){
      try{winner.send('ROLLBACK;\n\\q\n');await winner.close();}catch(_){winner.kill();}
      if(contender)contender.kill();
    }
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
