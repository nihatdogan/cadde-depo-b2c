// Markdown 404: başlık, durum ve mevcut yolların önde kalması. Ağa dokunmaz.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const checks = [];
function check(name, ok) {
  checks.push([name, !!ok]);
  if (!ok) console.error('FAIL', name);
}

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const rules = config.rewrites;
check('rewrites stay a list', Array.isArray(rules));
const sources = (rules || []).map((rule) => rule.source);
const kept = ['/firsat-kulubu', '/firsat-kulubu-aydinlatma', '/sitemap.xml', '/urun/:slug', '/kvkk'];
for (const source of kept) {
  check('route stays ahead of the markdown fallback: ' + source, sources.indexOf(source) >= 0 && sources.indexOf(source) < sources.length - 1);
}
const last = rules && rules[rules.length - 1];
check('last rewrite is the markdown 404', last && last.destination === '/api/markdown-404' && last.source === '/:path*');
const has = last && (last.has || []).find((item) => String(item.key || '').toLowerCase() === 'accept');
check('markdown rewrite requires Accept text/markdown', !!has && String(has.value || '').includes('text/markdown'));

const handler = require('../api/markdown-404.js');
function call(method) {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (key, value) => { res.headers[String(key).toLowerCase()] = value; };
  res.end = (body) => { res.body = body == null ? '' : String(body); };
  handler({ method }, res);
  return res;
}
const get = call('GET');
check('status stays 404', get.statusCode === 404);
check('content type is markdown utf-8', get.headers['content-type'] === 'text/markdown; charset=utf-8');
const tr = (get.body.match(/İstenen adres[\s\S]+?\./) || [''])[0];
check('turkish explanation is at least 20 characters', [...tr].length >= 20);
check('body links the sitemap', get.body.includes('https://www.caddedepo.com/sitemap.xml'));
check('body is markdown', get.body.startsWith('# ') && get.body.includes('](https://www.caddedepo.com/sitemap.xml)'));
const head = call('HEAD');
check('head keeps status and type without a body', head.statusCode === 404 && head.headers['content-type'] === 'text/markdown; charset=utf-8' && head.body === '');

const kalan = checks.filter(([, ok]) => !ok);
if (kalan.length) {
  console.error(kalan.map(([name]) => 'FAIL ' + name).join('\n'));
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
console.log(checks.length + ' kontrol');
