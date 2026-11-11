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
  console: { error: (...a) => logs.push(a.map(String).join(' ')) },
  alert: msg => alerts.push(String(msg)),
  window: { open: url => opened.push(url) },
  waHref: msg => 'https://wa.me/905409077070?text=' + encodeURIComponent(msg),
  sb: {
    from(){ fromCalls += 1; throw new Error('direct table write'); },
    rpc: async (name, args) => sandbox.__rpc(name, args)
  }
};
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
  if(!args || args.musteri !== null) throw new Error('musteri must be null');
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

const network = await run('Network error', ['sinbo'], 'network');

const checks = [];
function check(name, ok){ checks.push([name, ok]); if(!ok) console.error('FAIL', name); }

check('kiwi free wording', kiwi.text.includes('KARGO: Kargo ücretsiz') && kiwi.text.includes('2.490₺') && kiwi.text.includes('Sipariş no: a1b2c3d4') && !kiwi.text.includes('istemci'));
check('kiwi payload', JSON.stringify(kiwi.args) === JSON.stringify({ items:[{product_id:101, adet:1}], musteri:null }));
check('mixed not free', mixed.text.includes('Kargo ücreti siparişte bildirilir') && mixed.text.includes('20.990₺') && !mixed.text.includes('KARGO: Kargo ücretsiz'));
check('sinbo unknown question', sinbo.text.includes('Teslimat adresime göre kargo ücretini') && sinbo.text.includes('850₺'));
check('qty 2', qty2.text.includes('×2') && qty2.text.includes('4.980₺') && qty2.args.items[0].adet === 2 && qty2.args.items.length === 1);
check('inactive alert, no wa', inactive.alerts[0] === 'Ürün satışta değil' && inactive.opened === 0);
check('network still opens client quote', network.opened === 1 && network.text.includes('istemci adı sinbo') && network.text.includes('1₺') && network.logs.length === 1);
check('no direct inserts', fromCalls === 0);

if(checks.some(([, ok]) => !ok)) {
  console.error(checks);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
