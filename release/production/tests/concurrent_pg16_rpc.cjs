'use strict';
// Cadde Depo — two independent PostgreSQL 16 connections, synthetic CI ONLY.
// Uses GitHub Actions' disposable postgres service, never Supabase projects.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const statement=(visitor,key,ip='e')=>
  "SELECT public.create_whatsapp_request_protected_v3("+
  "'[5]'::jsonb,33000,repeat('"+visitor+"',64),repeat('"+ip+"',64),"+
  "'"+key+"'::uuid)::text;\n";

function openSession() {
  const child=spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{
    env:{...process.env,PGAPPNAME:'cadde-ci-race-'+process.pid},
    stdio:['pipe','pipe','pipe']
  });
  let stderr='',buffer='',rows=[],waiting=[];
  let ended=false,exitCode=null;
  const deadline=setTimeout(()=>child.kill('SIGKILL'),15000);
  child.stderr.on('data',d=>stderr+=d.toString('utf8'));
  child.stdout.on('data',chunk=>{
    buffer+=chunk.toString('utf8');
    let at;
    while((at=buffer.indexOf('\n'))>=0) {
      const line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);
      if(!line.startsWith('{'))continue;
      try{
        const row=JSON.parse(line);
        if(waiting.length)waiting.shift().resolve(row);else rows.push(row);
      }catch(err){if(waiting.length)waiting.shift().reject(err);}
    }
  });
  const done=new Promise(resolve=>child.once('close',code=>{
    ended=true;exitCode=code;clearTimeout(deadline);
    for(const w of waiting)w.reject(Error('psql exited before row: '+code+' '+stderr.slice(-600)));
    waiting=[];resolve(code);
  }));
  child.on('error',e=>{stderr+='\n'+e.message;});
  return {
    send(q){if(ended)throw Error('Session ended '+stderr);child.stdin.write(q);},
    row(){return rows.length?Promise.resolve(rows.shift()):new Promise((resolve,reject)=>waiting.push({resolve,reject}));},
    async close(){if(!ended)child.stdin.end();const code=await done;assert.equal(code,0,'psql failed: '+stderr.slice(-1300));},
  };
}
async function queryOnce(visitor,key){
  const c=openSession();c.send('SET ROLE service_role;\n'+statement(visitor,key));c.send('\\q\n');
  const result=await c.row();await c.close();return result;
}
async function race({label,visitor,firstKey,secondKey,expectedSame=true,secondVisitor=visitor}){
  const first=openSession();
  first.send('BEGIN;\nSET ROLE service_role;\n'+statement(visitor,firstKey));
  const firstResponse=await first.row();
  assert.match(firstResponse.request_id,/^[0-9a-f-]{36}$/);
  let released=false;
  // Force the first database transaction to remain uncommitted while
  // the independent second psql connection executes the candidate RPC.
  const contender=queryOnce(secondVisitor,secondKey);
  let contenderCompleted=false;
  contender.then(()=>contenderCompleted=true,()=>contenderCompleted=true);
  await sleep(400);
  assert.equal(contenderCompleted,false,'Second connection did not wait for first commit ('+label+')');
  first.send('COMMIT;\n');
  released=true;
  await first.close();
  const secondResponse=await contender;
  assert.equal(firstResponse.request_id===secondResponse.request_id,expectedSame,label+': unexpected request identity');
  assert.equal(firstResponse.reused,false,label+': first request must be new');
  if(expectedSame)assert.equal(secondResponse.reused,true,label+': contender must reuse first request');
  else assert.equal(secondResponse.reused,false,label+': distinct visitor must generate new order');
  console.log('PASS '+label+' first='+firstResponse.request_id+' second='+secondResponse.request_id+
    ' reused='+String(secondResponse.reused)+' released='+String(released));
}
(async()=>{
  await race({
    label:'same idempotency key across concurrent connections',
    visitor:'d',firstKey:'00000000-0000-4000-8000-00000000d001',
    secondKey:'00000000-0000-4000-8000-00000000d001'
  });
  await race({
    label:'different keys same visitor/cart across concurrent connections',
    visitor:'1',firstKey:'00000000-0000-4000-8000-00000000d002',
    secondKey:'00000000-0000-4000-8000-00000000d003'
  });
  // Two independent visitors with identical products/network must not merge;
  // exercise these in parallel but WITHOUT requiring the second to block,
  // because their idempotency and advisory locks should be independent.
  const [a,b]=await Promise.all([
    queryOnce('2','00000000-0000-4000-8000-00000000d004'),
    queryOnce('3','00000000-0000-4000-8000-00000000d005')
  ]);
  assert.notEqual(a.request_id,b.request_id,'Different visitors incorrectly merged');
  assert.equal(a.reused,false);assert.equal(b.reused,false);
  console.log('PASS distinct visitors sharing one IP/cart generated independent orders');
  console.log('POSTGRES_CONCURRENCY_ASSERTIONS_PASSED');
})().catch(e=>{console.error(e);process.exitCode=1;});
