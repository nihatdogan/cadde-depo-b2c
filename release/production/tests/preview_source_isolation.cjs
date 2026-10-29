'use strict';
// Regression guard: ensure Preview storefront never selects Production Supabase
// and legacy browser checkout cannot INSERT from non-production hostnames.
// This is a static/runtime config test; NOT a real HTTP checkout proof.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const productionUrl = 'https://svyqmmivhpfiuhxnmhny.supabase.co';
const previewUrl = 'https://emnacsavgsjkrocpngcj.supabase.co';
const sources = ['index.html', 'urun.html'];
const hosts = [
  ['caddedepo.com', productionUrl, true],
  ['www.caddedepo.com', productionUrl, true],
  ['caddedepo-b2c-git-prep-production-order-secu-07ed4d-nihat-proje.vercel.app', previewUrl, false],
  ['caddedepo-b2c.vercel.app', previewUrl, false],
  ['localhost', previewUrl, false],
];

for (const filename of sources) {
  const html = fs.readFileSync(filename, 'utf8');
  const match = html.match(/const IS_PRODUCTION_DOMAIN = [\s\S]*?const sb = supabase\.createClient\(SUPABASE_URL, SUPABASE_ANON_KEY\);/);
  assert.ok(match, filename + ': environment-selecting client config missing');
  for (const [hostname, expectedUrl, expectedProd] of hosts) {
    const context = {
      window: { location: { hostname } },
      supabase: { createClient: (url, key) => ({ url, key }) }
    };
    const result = vm.runInNewContext(
      match[0] + '\n({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY, isProd: IS_PRODUCTION_DOMAIN, client: sb })',
      context, { timeout: 1000 }
    );
    assert.equal(result.url, expectedUrl, filename + ': wrong database for ' + hostname);
    assert.equal(result.isProd, expectedProd, filename + ': wrong host classification');
    assert.equal(result.client.url, expectedUrl);
    assert.ok(result.key.startsWith('sb_publishable_'), filename + ': non-publishable key');
    assert.equal(result.client.key, result.key);
  }
}

const index = fs.readFileSync('index.html', 'utf8');
assert.doesNotMatch(index, /sb\.from\(['"]orders['"]\)\.insert/);
assert.doesNotMatch(index, /sb\.from\(['"]order_items['"]\)\.insert/);
assert.match(index, /isProduction:IS_PRODUCTION_DOMAIN/);
assert.match(index, /CaddeCheckoutV3\.createClient/);
const source = fs.readFileSync('assets/cadde-checkout-v3.js','utf8');
assert.match(source, /if\(!options\.isProduction\)return \{enabled:false,reason:'PREVIEW_DISABLED'\}/);
assert.match(source, /if\(!options\.isProduction\)\{/);
assert.match(source, /\/api\/cadde-order-v3/);
console.log('PREVIEW_SOURCE_ISOLATION_STATIC_PASS — no Preview writes or legacy browser INSERT');
