// Optional TRUE two-session PostgreSQL test; never accepts a hosted/production database.
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const h=require('./helpers/security-db.cjs');
const connection=process.env.LOCAL_SECURITY_TEST_URL;
test('two real PostgreSQL sessions: identical submissions and last-unit confirmations', {skip:!connection?'Dedicated local PostgreSQL not configured; PGlite is single-session.':false,timeout:60000},async()=>{
 const u=new URL(connection);
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(u.hostname),'Only loopback PostgreSQL allowed');
 assert.match(u.pathname,/^\/cadde_security_test_[a-z0-9_]+$/);assert.equal(process.env.LOCAL_SECURITY_TEST_ISOLATED,'yes','An empty dedicated local test instance must be acknowledged');
 const {Client}=require('pg');const first=new Client({connectionString:connection,connectionTimeoutMillis:5000});await first.connect();
 const wrap=c=>({exec:async sql=>{const x=await c.query(sql);return Array.isArray(x)?x:[x];},query:(...args)=>c.query(...args)});
 let second;
 try{
  assert.equal(Number((await first.query("select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage') and c.relkind in('r','v','m')")).rows[0].n),0,'Refusing any database containing existing application data');
  const a=wrap(first);await h.bootstrap(a);await h.evidence(a);await a.exec(h.read('supabase/security-foundation.sql'));await h.evidence(a);await a.exec(h.read('supabase/security-cutover.sql'));await a.exec('update products set stok=1 where id=1');
  second=new Client({connectionString:connection,connectionTimeoutMillis:5000});await second.connect();const b=wrap(second);
  await first.query("set statement_timeout='5s'");await second.query("set statement_timeout='5s'");await h.service(a);await h.service(b);
  const key=randomUUID();const args=[JSON.stringify([{id:1,quantity:1}]),key,'a'.repeat(64),'stock'];
  const same=await Promise.all([a.query('select create_checkout_request($1,$2,$3,$4) r',args),b.query('select create_checkout_request($1,$2,$3,$4) r',args)]);
  assert.equal(same[0].rows[0].r.id,same[1].rows[0].r.id);
  const other=(await a.query('select create_checkout_request($1,$2,$3,$4) r',[args[0],randomUUID(),'b'.repeat(64),'stock'])).rows[0].r;
  await h.admin(a);await h.admin(b);
  const results=await Promise.allSettled([a.query("select admin_set_checkout_status($1,'onaylandi','LOCAL concurrency acceptance')",[same[0].rows[0].r.id]),b.query("select admin_set_checkout_status($1,'onaylandi','LOCAL concurrency acceptance')",[other.id])]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(results.find(x=>x.status==='rejected').reason.message,/STOCK_OR_PRICE_CHANGED/);
  await h.owner(a);assert.equal(Number((await a.query('select stok from products where id=1')).rows[0].stok),0);
 }finally{if(second)await second.end();await first.end();}
 // Deliberately no DROP/TRUNCATE cleanup. Only synthetic records exist in this dedicated local DB.
});
