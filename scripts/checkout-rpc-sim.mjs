// Local checkout simulation. Example catalog only. Does not call Supabase or open a real order.
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const shipStart = html.indexOf('function itemShipping');
const shipEnd = html.indexOf('const CART_SHIP_NOTE_DEFAULT');
const rpcStart = html.indexOf('function cartRpcItems');
const rpcEnd = html.indexOf("document.getElementById('checkoutWa').onclick = placeOrder;");
if(shipStart < 0 || shipEnd < 0 || rpcStart < 0 || rpcEnd < 0) throw new Error('checkout functions not found in index.html');
const checkoutSrc = html.slice(shipStart, shipEnd) + '\n' + html.slice(rpcStart, rpcEnd);

const fmt = n => Number(n).toLocaleString('tr-TR') + '₺';
const opened = [];
const alerts = [];
const logs = [];
const rpcCalls = [];
let fromCalls = 0;

const sandbox = {
  fmt,
  cart: [],
  Date,
  console: { error: (...a) => logs.push(a.map(String).join(' ')) },
  alert: msg => alerts.push(String(msg)),
  window: { open: url => opened.push(url) },
  waHref: msg => 'https://wa.me/905409077070?text=' + encodeURIComponent(msg),
  sb: {
    from(){ fromCalls += 1; throw new Error('direct table write'); },
    rpc: async (name, args) => sandbox.__rpc(name, args)
  }
};
// Sepet formu (örnek kişi, gerçek müşteri değil).
const formEls = {
  custAd: { value: 'Örnek Müşteri', setAttribute(){}, focus(){ formEls.focused = 'custAd'; } },
  custTel: { value: '0532 000 00 00', setAttribute(){}, focus(){ formEls.focused = 'custTel'; } },
  custErr: { textContent: '', hidden: true },
  onbilgiOk: { checked: true, setAttribute(){}, focus(){ formEls.focused = 'onbilgiOk'; } },
  onbilgiErr: { textContent: '', hidden: true },
  checkoutWa: { disabled: false }
};
sandbox.document = { getElementById: id => formEls[id] || null };
vm.createContext(sandbox);
vm.runInContext(checkoutSrc, sandbox, { filename: 'index-checkout.js' });

// Example data, not the live catalog. Server prices differ from the client cart on purpose.
const EXAMPLE = {
  kiwi: { id: 101, ad: 'Kiwi örnek', fiyat: 2490, kargo_ucreti: 0, aktif: true, stok: 8 },
  koltuk: { id: 202, ad: 'Köşe koltuk örnek', fiyat: 18500, kargo_ucreti: null, aktif: true, stok: 2 },
  sinbo: { id: 303, ad: 'Sinbo SFH-3399 örnek', fiyat: 850, kargo_ucreti: null, aktif: true, stok: 4 }
};

function serverQuote(lines){
  let goods = 0, known = 0, anyUnknown = false;
  const kalemler = lines.map(line => {
    const p = EXAMPLE[line.key];
    if(!p.aktif) {
      const err = new Error('Ürün satışta değil');
      err.code = '22023';
      throw err;
    }
    if(line.adet > p.stok) {
      const err = new Error('Yetersiz stok');
      err.code = '22023';
      throw err;
    }
    goods += p.fiyat * line.adet;
    if(p.kargo_ucreti == null) anyUnknown = true;
    else known += p.kargo_ucreti * line.adet;
    return { product_id: p.id, ad: p.ad, fiyat: p.fiyat, adet: line.adet, kargo_ucreti: p.kargo_ucreti };
  });
  let kargo_durumu, toplam;
  if(anyUnknown){ kargo_durumu = 'sipariste_bildirilir'; toplam = goods; }
  else if(known === 0){ kargo_durumu = 'ucretsiz'; toplam = goods; }
  else { kargo_durumu = 'dahil'; toplam = goods + known; }
  return { order_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', toplam, urun_toplam: goods, kargo_tutari: known, kargo_durumu, kalemler };
}

function assertPayload(args){
  const mk = args && args.musteri ? Object.keys(args.musteri) : [];
  if(mk.join() !== 'istek_id,ad,telefon,aydinlatma,onbilgi_surum,onbilgi_zamani' || !/^905\d{9}$/.test(args.musteri.telefon) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args.musteri.istek_id) || args.musteri.onbilgi_surum !== '2026-11-12') throw new Error('musteri fields: ' + mk.join());
  if(!Array.isArray(args.items) || !args.items.length) throw new Error('items missing');
  for(const item of args.items){
    const keys = Object.keys(item).sort().join(',');
    if(keys !== 'adet,product_id') throw new Error('unexpected item keys: ' + keys);
    if(typeof item.product_id !== 'number' || typeof item.adet !== 'number') throw new Error('item types');
  }
}

let mode = 'ok';
sandbox.__rpc = async (name, args) => {
  rpcCalls.push({ name, args });
  if(name !== 'siparis_olustur') throw new Error('unexpected rpc ' + name);
  assertPayload(args);
  if(mode === 'network') throw new TypeError('Failed to fetch');
  if(mode === 'breaker') return { data: null, error: { message: 'Sipariş kaydı geçici olarak sınırlandı', code: '54000' } };
  try {
    const lines = args.items.map(item => {
      const key = Object.keys(EXAMPLE).find(k => EXAMPLE[k].id === item.product_id);
      if(!key) throw Object.assign(new Error('Ürün satışta değil'), { code: '22023' });
      return { key, adet: item.adet };
    });
    return { data: serverQuote(lines), error: null };
  } catch(err){
    return { data: null, error: { message: err.message, code: err.code || '22023' } };
  }
};

function cartOf(...keys){
  return keys.map(key => ({ id: EXAMPLE[key].id, nm: 'istemci adı ' + key, now: 1, kargo: null }));
}

function messageFromOpen(){
  const url = opened.at(-1);
  const q = new URL(url);
  return decodeURIComponent(q.searchParams.get('text'));
}

async function run(title, keys, nextMode){
  mode = nextMode;
  opened.length = 0;
  alerts.length = 0;
  logs.length = 0;
  rpcCalls.length = 0;
  sandbox.cart = cartOf(...keys);
  await sandbox.placeOrder();
  console.log('\n=== ' + title + ' ===');
  console.log('ÖRNEK VERİ, canlı katalog değil');
  console.log('rpc:', JSON.stringify(rpcCalls.map(c => c.args)));
  console.log('alert:', alerts.join(' | ') || '(yok)');
  console.log('whatsapp:', opened.length ? messageFromOpen() : '(açılmadı)');
  console.log('log:', logs.join(' | ') || '(yok)');
  return { title, opened: opened.length, alerts: [...alerts], logs: [...logs], args: rpcCalls[0] && rpcCalls[0].args, text: opened.length ? messageFromOpen() : '' };
}

const kiwi = await run('Kiwi only (free)', ['kiwi'], 'ok');
const mixed = await run('Kiwi + koltuk (mixed: 0 + NULL)', ['kiwi', 'koltuk'], 'ok');
const sinbo = await run('Sinbo only (unknown)', ['sinbo'], 'ok');
const qty2 = await run('Kiwi adet 2', ['kiwi', 'kiwi'], 'ok');

EXAMPLE.inactive = { id: 404, ad: 'Satışta olmayan örnek', fiyat: 1000, kargo_ucreti: 0, aktif: false, stok: 3 };
mode = 'ok';
opened.length = 0;
alerts.length = 0;
logs.length = 0;
rpcCalls.length = 0;
sandbox.cart = [{ id: 404, nm: 'Satışta olmayan örnek', now: 1, kargo: 0 }];
await sandbox.placeOrder();
const inactive = { opened: opened.length, alerts: [...alerts], args: rpcCalls[0] && rpcCalls[0].args };
console.log('\n=== Inactive product ===');
console.log('ÖRNEK VERİ, canlı katalog değil');
console.log('rpc:', JSON.stringify(rpcCalls.map(c => c.args)));
console.log('alert:', alerts.join(' | ') || '(yok)');
console.log('whatsapp:', opened.length ? messageFromOpen() : '(açılmadı)');

const storeEarly = new Map();
sandbox.sessionStorage = { getItem: k => storeEarly.has(k) ? storeEarly.get(k) : null, setItem: (k, v) => { storeEarly.set(k, String(v)); } };
const network = await run('Network error', ['sinbo'], 'network');
const networkId = network.args.musteri.istek_id;
const cartAfterNetwork = sandbox.cart.map(p => p.id).join(',');
const formAfterNetwork = formEls.custAd.value + '|' + formEls.custTel.value;
await sandbox.placeOrder();
const networkRetryId = rpcCalls.at(-1).args.musteri.istek_id;
const openedAfterNetworkRetry = opened.length;

const breaker = await run('Circuit breaker', ['kiwi'], 'breaker');
const breakerId = breaker.args.musteri.istek_id;
await sandbox.placeOrder();
const breakerRetryId = rpcCalls.at(-1).args.musteri.istek_id;

const checks = [];
function check(name, ok){ checks.push([name, ok]); if(!ok) console.error('FAIL', name); }

check('kiwi free wording', kiwi.text.includes('KARGO: Kargo ücretsiz') && kiwi.text.includes('2.490₺') && kiwi.text.includes('Sipariş no: a1b2c3d4') && !kiwi.text.includes('istemci'));
check('kiwi payload', JSON.stringify(kiwi.args.items) === JSON.stringify([{product_id:101, adet:1}]) && Object.keys(kiwi.args).join() === 'items,musteri');
check('mixed not free', mixed.text.includes('Kargo ücreti sonradan bildirilecek') && mixed.text.includes('20.990₺') && !mixed.text.includes('KARGO: Kargo ücretsiz') && !mixed.text.includes('\nTOPLAM:'));
check('sinbo null shipping is not a final total', sinbo.text.includes('Kargo ücreti sonradan bildirilecek') && sinbo.text.includes('850₺') && !sinbo.text.includes('\nTOPLAM:'));
check('zero shipping stays free and final', kiwi.text.includes('KARGO: Kargo ücretsiz') && kiwi.text.includes('\nTOPLAM:') && sandbox.cartQuote([{ now: 100, kargo: 0 }]).mode === 'free');
check('null shipping quote names the later fee', sandbox.cartQuote([{ now: 100, kargo: null }]).note === 'Kargo ücreti sonradan bildirilecek' && sandbox.cartQuote([{ now: 100, kargo: null }]).total === 100);
check('qty 2', qty2.text.includes('×2') && qty2.text.includes('4.980₺') && qty2.args.items[0].adet === 2 && qty2.args.items.length === 1);
check('inactive alert, no wa', inactive.alerts[0] === 'Ürün satışta değil' && inactive.opened === 0);
check('network error does not open WhatsApp, shows error, retry reuses istek_id', network.opened === 0 && openedAfterNetworkRetry === 0 && network.alerts[0] === 'Siparişiniz kaydedilemedi, lütfen birkaç dakika sonra tekrar deneyin.' && network.logs.length === 1 && networkRetryId === networkId && cartAfterNetwork === '303' && formAfterNetwork === 'Örnek Müşteri|0532 000 00 00' && formEls.checkoutWa.disabled === false);
check('breaker does not open WhatsApp and shows the server reason', breaker.opened === 0 && breaker.alerts[0] === 'Sipariş kaydı geçici olarak sınırlandı' && breakerRetryId === breakerId && formEls.checkoutWa.disabled === false && sandbox.cart.length === 1);
check('no direct inserts', fromCalls === 0);

// Tekrar koruması (denetim bulgusu #3): çift tıklama tek RPC, aynı sepet aynı kimlik, sepet değişince yeni kimlik.
const store = new Map();
sandbox.sessionStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { store.set(k, String(v)); } };
sandbox.crypto = globalThis.crypto;
mode = 'ok';
rpcCalls.length = 0; opened.length = 0;
sandbox.cart = cartOf('kiwi');
await Promise.all([sandbox.placeOrder(), sandbox.placeOrder(), sandbox.placeOrder()]);
check('double click sends one rpc', rpcCalls.length === 1 && opened.length === 1);
const firstId = rpcCalls[0].args.musteri.istek_id;
await sandbox.placeOrder();
check('same cart reuses istek_id', rpcCalls.length === 2 && rpcCalls[1].args.musteri.istek_id === firstId);
mode = 'network';
await sandbox.placeOrder();
mode = 'ok';
await sandbox.placeOrder();
check('retry after network error keeps istek_id', rpcCalls.at(-1).args.musteri.istek_id === firstId);
sandbox.cart = cartOf('kiwi', 'sinbo');
await sandbox.placeOrder();
check('changed cart gets new istek_id', rpcCalls.at(-1).args.musteri.istek_id !== firstId);
check('musteri keeps consent with the order fields', rpcCalls.every(c => Object.keys(c.args.musteri).join() === 'istek_id,ad,telefon,aydinlatma,onbilgi_surum,onbilgi_zamani'));
check('phone normalized', rpcCalls.at(-1).args.musteri.telefon === '905320000000');
check('wa message carries name, not phone', messageFromOpen().includes('Ad soyad: Örnek Müşteri') && !messageFromOpen().includes('905320000000'));
check('no personal data in session store', ![...store.values()].some(v => v.includes('Örnek') || v.includes('532')));
const beforeFix = rpcCalls.at(-1).args.musteri.istek_id;
formEls.custTel.value = '0533 000 00 00';
await sandbox.placeOrder();
check('corrected phone gets new istek_id', rpcCalls.at(-1).args.musteri.istek_id !== beforeFix);
for(const [ad, tel, focus] of [['', '05320000000', 'custAd'], ['Örnek Müşteri', '0212 000 00 00', 'custTel'], ['Örnek Müşteri', '', 'custTel']]){
  formEls.custAd.value = ad; formEls.custTel.value = tel; formEls.focused = null;
  const n = rpcCalls.length, w = opened.length;
  await sandbox.placeOrder();
  check('invalid form blocks rpc and whatsapp: ' + (ad ? tel || 'boş telefon' : 'boş ad'), rpcCalls.length === n && opened.length === w && formEls.focused === focus && formEls.custErr.hidden === false);
}
formEls.custAd.value = 'Örnek Müşteri';
formEls.custTel.value = '0532 000 00 00';
formEls.onbilgiOk.checked = false;
formEls.focused = null;
{
  const n = rpcCalls.length, w = opened.length;
  await sandbox.placeOrder();
  check('unchecked onbilgi blocks order and whatsapp', rpcCalls.length === n && opened.length === w && formEls.focused === 'onbilgiOk' && formEls.onbilgiErr.hidden === false);
}
formEls.onbilgiOk.checked = true;

if(checks.some(([, ok]) => !ok)) {
  console.error(checks);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
