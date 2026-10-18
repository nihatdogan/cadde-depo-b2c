// Read-only verification: all four frontend entrypoints must target the same isolated Preview project.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(process.argv[2] || '.');
const expected = String(process.env.CADDE_EXPECTED_SUPABASE_REF || '').trim();
const prod = 'svyqmmivhpfiuhxnmhny';
if (!/^[a-z0-9]{15,35}$/.test(expected) || expected === prod) throw Error('Preview project ref eksik veya Production ref.');
for (const name of ['index.html','urun.html','admin.html','admin-gorsel.html']) {
  const body = fs.readFileSync(path.join(repo,name),'utf8');
  if (body.includes(prod)) throw Error(`${name}: production referansi bulundu — DAĞITMAYIN.`);
  if (!body.includes(`const SUPABASE_URL = "https://${expected}.supabase.co";`)) {
    throw Error(`${name}: beklenen preview URL yok — DAĞITMAYIN.`);
  }
  if (!/const SUPABASE_ANON_KEY = "sb_publishable_[A-Za-z0-9_-]{10,}";/.test(body)) {
    throw Error(`${name}: preview publishable key yok — DAĞITMAYIN.`);
  }
  console.log('OK:',name);
}
console.log('PREVIEW_PUBLIC_CONFIG_VERIFIED:', expected);
