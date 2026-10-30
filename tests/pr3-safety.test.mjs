import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import test from 'node:test';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = ['index.html','admin.html','urun.html','admin-gorsel.html'];
const js = ['yakinda-gelecek.js','admin-upcoming.js','api/admin/upload-product-image.js'];

test('PR #3: standalone JS source parses', () => {
  for (const p of js) new Script(read(p), {filename:p});
});

test('PR #3: inline scripts parse (no code execution)', () => {
  for (const p of html) {
    const source=read(p);
    const blocks=[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    for(let i=0;i<blocks.length;i++) {
      if(blocks[i][1].trim()) new Script(blocks[i][1], {filename:p+'#script'+i});
    }
  }
});

test('PR #3: every storefront/admin page isolates Preview from Production',()=>{
  for(const p of html) {
    const content=read(p);
    assert.match(content,/CD_PRODUCTION_HOST/,'Missing host isolation: '+p);
    assert.match(content,/location\.hostname/,'Missing host match: '+p);
    assert.match(content,/emnacsavgsjkrocpngcj\.supabase\.co/,'Missing preview project: '+p);
    assert.match(content,/svyqmmivhpfiuhxnmhny\.supabase\.co/,'Missing production project: '+p);
    assert.match(content,/sb_publishable_/,'Missing public key: '+p);
    assert.doesNotMatch(content,/sb_secret_|SUPABASE_SERVICE_ROLE_KEY/,'Secret in browser: '+p);
  }
});

test('PR #3: server-side image upload fails closed on env mismatch',()=>{
 const content=read('api/admin/upload-product-image.js');
 assert.match(content,/VERCEL_ENV/);
 assert.match(content,/expectedTarget/);
 assert.match(content,/SUPABASE_URL !== expectedTarget/);
 assert.match(content,/user\.app_metadata\?\.role !== 'admin'/);
});

test('PR #3: five fallback marketing cards are always non-purchasable',()=>{
 const src=read('yakinda-gelecek.js');
 const codes=['CD-003','CD-012','CD-005','CD-010','CD-002'];
 for(const code of codes)assert.match(src,new RegExp(code));
 assert.match(src,/fallbackUpcoming/);
 assert.match(src,/PGRST202/);
 assert.match(src,/cd_list_upcoming_products/);
 assert.doesNotMatch(src,/sepete ekle|addToCart|checkout\(/i);
});

test('PR #3: admin can only publish through server RPC',()=>{
 const src=read('admin-upcoming.js');
 assert.match(src,/cd_publish_upcoming_product/);
 assert.match(src,/upcoming_products/);
 assert.doesNotMatch(src,/from\(['"]products['"]\)\.insert/);
});

test('PR #3: SQL has deny-by-default release gate, RLS, audit and AAL2',()=>{
 const src=read('supabase/pr3-upcoming-catalog-preview.sql');
 for(const required of [
  'cd_pr3_internal.release_gate',
  'PR3_PUBLISH_DISABLED_UNTIL_APPROVAL',
  'alter table public.upcoming_products enable row level security',
  'alter table public.upcoming_publish_audit enable row level security',
  "auth.jwt()->>'aal'",
  'cd_publish_upcoming_product',
  'cd_list_upcoming_products',
  'for update',
  'upcoming_publish_audit',
  'on conflict(code) do nothing'
 ]) assert.ok(src.includes(required), 'Missing SQL gate: '+required);
 assert.match(src,/status = 'upcoming'/);
 assert.match(src,/revoke all on function public\.cd_publish_upcoming_product/);
 assert.match(src,/grant execute on function public\.cd_publish_upcoming_product\(uuid\) to authenticated/);
});
