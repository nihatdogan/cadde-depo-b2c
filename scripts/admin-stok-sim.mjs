// Local admin stock simulation. Example orders only. Does not call Supabase.
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
if(/siparis_durum_degistir|siparis_stok_esle|stok_rezerve/.test(html)){
  throw new Error('index.html mentions the stock RPCs');
}
const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const scriptMatch = admin.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch) throw new Error('admin script missing');
const original = scriptMatch[1];
if(/from\('orders'\)\.update/.test(original)) throw new Error('direct order update still present');
fs.writeFileSync('/tmp/admin-check.js', original);
const syntax = spawnSync(process.execPath, ['--check', '/tmp/admin-check.js'], { encoding: 'utf8' });
if(syntax.status !== 0){
  console.error(syntax.stderr);
  process.exit(syntax.status || 1);
}
console.log('node --check admin.html script: ok');

const runnable = original
  .replace('const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);', 'const sb = globalThis.__sb;')
  .replace(/\nboot\(\);\s*$/, '\n');

const OLD = 'aaaaaaaa-1111-4111-8111-111111111111';
const NEW = 'bbbbbbbb-2222-4222-8222-222222222222';
const orders = [
  { id: OLD, created_at: '2026-10-01T09:00:00Z', durum: 'whatsapp_bekliyor', toplam: 100, stok_rezerve: null, order_items: [{ ad: 'Eski örnek', adet: 1, fiyat: 100 }] },
  { id: NEW, created_at: '2026-11-01T09:00:00Z', durum: 'onaylandi', toplam: 200, stok_rezerve: true, order_items: [{ ad: 'Yeni örnek', adet: 2, fiyat: 50 }] }
];
const logs = [
  { siparis_id: NEW, islem: 'durum', eski_durum: 'whatsapp_bekliyor', yeni_durum: 'onaylandi', created_at: '2026-11-01T10:00:00Z' }
];
const calls = [];
let rpcMode = 'ok';

function resultFor(table, cols, opts){
  if(table === 'orders' && String(cols).includes('stok_rezerve')) return { data: orders, error: null };
  if(table === 'orders') return { data: [{ toplam: 200 }], count: 1, error: null };
  if(table === 'siparis_durum_log') return { data: logs, error: null };
  if(table === 'products' && opts && opts.head) return { count: 3, data: null, error: null };
  if(table === 'products' && String(cols).includes('outlet_fiyat') && String(cols) !== '*'){
    return { data: [{ ad: 'Örnek ürün', ana_kategori: 'EV', alt_kategori: 'A', stok: 1, outlet_fiyat: 10 }], error: null };
  }
  if(table === 'products'){
    return { data: [{ id: 7, ad: 'Örnek ürün', ana_kategori: 'EV', alt_kategori: 'A', stok: 4, max_stok: 10, aktif: true, outlet_fiyat: 10, perakende_fiyat: 20, kondisyon: 'Sıfır', gorsel_url: null, drop_aktif: false }], error: null };
  }
  return { data: [], error: null };
}
function builder(table, cols, opts){
  const done = Promise.resolve(resultFor(table, cols, opts));
  const b = {
    select(next, nextOpts){ return builder(table, next, nextOpts); },
    eq(){ return b; }, lte(){ return b; }, order(){ return b; },
    update(payload){ calls.push({ op: 'update', table, payload }); return b; },
    insert(){ calls.push({ op: 'insert', table }); return b; },
    delete(){ calls.push({ op: 'delete', table }); return b; },
    then(ok, fail){ return done.then(ok, fail); }
  };
  return b;
}
const sb = {
  auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange(){},
    signOut(){},
    signInWithPassword: async () => ({ error: null })
  },
  from(table){
    calls.push({ op: 'from', table });
    return { select: (cols, opts) => { calls.push({ op: 'select', table, cols }); return builder(table, cols, opts); } };
  },
  rpc: async (name, args) => {
    calls.push({ op: 'rpc', name, args });
    if(rpcMode === 'stock') return { data: null, error: { message: 'Yetersiz stok: Örnek ürün (mevcut 0, gereken 1). Sipariş onaylanmadı, stok değişmedi.' } };
    if(rpcMode === 'marked') return { data: null, error: { message: 'Bu siparişin stok durumu zaten belli; yeniden işaretlenemez.' } };
    return { data: { id: args.p_siparis_id, durum: args.p_yeni_durum || orders.find(o => o.id === args.p_siparis_id).durum }, error: null };
  }
};

function attrs(raw){
  const out = {};
  for(const m of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
function widget(attr){
  return {
    dataset: { order: attr['data-order'], prev: attr['data-prev'], stokEsle: attr['data-stok-esle'] },
    value: attr['data-prev'] || '',
    disabled: false,
    onclick: null,
    onchange: null
  };
}
function queryAll(node, sel){
  if(!node._controls || node._controls.html !== node.innerHTML){
    const html = node.innerHTML || '';
    node._controls = {
      html,
      selects: [...html.matchAll(/<select([^>]*)>/g)].map(m => widget(attrs(m[1]))),
      buttons: [...html.matchAll(/<button([^>]*data-stok-esle="[01]"[^>]*)>/g)].map(m => widget(attrs(m[1])))
    };
  }
  if(sel === 'select[data-order]') return node._controls.selects;
  if(sel === '[data-stok-esle]') return node._controls.buttons;
  return [];
}
const cache = {};
function element(id){
  if(id && cache[id]) return cache[id];
  const node = {
    id, hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, className: '',
    classList: { toggle(){}, add(){}, remove(){} }, dataset: {}, style: {}, files: [],
    onclick: null, onsubmit: null, onchange: null, click(){},
    querySelector(){ return element(); },
    querySelectorAll(sel){ return queryAll(node, sel); }
  };
  if(id) cache[id] = node;
  return node;
}
const document = {
  querySelector(sel){ return sel.startsWith('#') ? element(sel.slice(1)) : element(); },
  querySelectorAll(){ return []; }
};
const alerts = [];
const confirms = [];
let confirmAnswer = true;
const sandbox = {
  console, Map, Set, Promise, Date, Number, String, Object, Array, JSON, Math, parseInt, isNaN, RegExp, clearTimeout, setTimeout,
  document, alert: msg => alerts.push(String(msg)), confirm: msg => { confirms.push(String(msg)); return confirmAnswer; },
  __sb: sb
};
vm.createContext(sandbox);
vm.runInContext(runnable, sandbox, { filename: 'admin.html' });

const checks = [];
function check(name, ok){ checks.push([name, !!ok]); if(!ok) console.error('FAIL', name); }

await sandbox.loadOrders();
const rendered = cache.ordersBox.innerHTML;
console.log('\n=== ÖRNEK VERİ, canlı sipariş değil ===');
console.log(rendered.includes('Stok durumu bilinmiyor') ? 'NULL siparişte rozet var' : 'rozet yok');
check('orders select lists stok_rezerve', calls.some(c => c.op === 'select' && String(c.cols || '').includes('stok_rezerve')));
check('badge once', (rendered.match(/Stok durumu bilinmiyor/g) || []).length === 1);
check('both mark buttons', rendered.includes('Stok düşülmüştü') && rendered.includes('Stok düşülmedi'));
check('known order has no buttons', !rendered.split(NEW)[1].includes('Stok düşülmüştü'));
check('history line', rendered.includes('WhatsApp bekliyor → Onaylandı'));
check('unknown history empty', rendered.includes('Kayıt yok'));

const selects = queryAll(cache.ordersBox, 'select[data-order]');
const oldSel = selects.find(s => s.dataset.order === OLD);
rpcMode = 'stock';
oldSel.value = 'onaylandi';
await oldSel.onchange();
check('status rpc args', calls.some(c => c.op === 'rpc' && c.name === 'siparis_durum_degistir' && c.args.p_siparis_id === OLD && c.args.p_yeni_durum === 'onaylandi'));
check('error resets dropdown', oldSel.value === 'whatsapp_bekliyor');
check('turkish stock alert', alerts[0] && alerts[0].startsWith('Yetersiz stok:'));
check('no direct update', !calls.some(c => c.op === 'update'));

const beforeRefresh = calls.filter(c => c.op === 'from' && c.table === 'products').length;
rpcMode = 'ok';
oldSel.value = 'onaylandi';
await oldSel.onchange();
check('success refreshes products', calls.filter(c => c.op === 'from' && c.table === 'products').length > beforeRefresh);
check('product stock still rendered', cache.productsBody.innerHTML.includes('4/10') || cache.kritikBody.innerHTML.includes('>1<'));

const box = cache.ordersBox;
const mark = queryAll(box, '[data-stok-esle]').find(b => b.dataset.stokEsle === '1');
confirmAnswer = false;
await mark.onclick();
const rpcAfterCancel = calls.filter(c => c.op === 'rpc' && c.name === 'siparis_stok_esle').length;
check('cancel does not mark', rpcAfterCancel === 0);
confirmAnswer = true;
await mark.onclick();
check('mark true', calls.some(c => c.op === 'rpc' && c.name === 'siparis_stok_esle' && c.args.p_siparis_id === OLD && c.args.p_stok_dusuldu === true));
const markFalse = queryAll(cache.ordersBox, '[data-stok-esle]').find(b => b.dataset.stokEsle === '0');
await markFalse.onclick();
check('mark false', calls.some(c => c.op === 'rpc' && c.name === 'siparis_stok_esle' && c.args.p_stok_dusuldu === false));
rpcMode = 'marked';
await mark.onclick();
check('already marked alert', alerts.at(-1) === 'Bu siparişin stok durumu zaten belli; yeniden işaretlenemez.');

if(checks.some(([, ok]) => !ok)){
  console.error(checks);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
console.log(checks.map(([name]) => 'ok  ' + name).join('\n'));
