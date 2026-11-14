// Ana sayfadaki Fırsat Kulübü bandı: yapı, metin sınırları ve açık/kapalı davranışı. Ağa dokunmaz.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const checks = []; const check = (ad, ok) => checks.push([ad, !!ok]);
const m = html.match(/<section class="club"[\s\S]*?<\/section>/);
check('bant var', !!m);
const band = m ? m[0] : '';
check('bant ürünlerden sonra, güven şeridinden önce', html.indexOf('id="urunler"') < html.indexOf('class="club"') && html.indexOf('class="club"') < html.indexOf('<section class="trust">'));
check('tek bağlantı ve hedefi /firsat-kulubu', (band.match(/<a /g) || []).length === 1 && /id="clubCta" href="\/firsat-kulubu"/.test(band));
check('başlık h2 ve bölüm etiketli', /aria-labelledby="clubTitle"/.test(band) && /<h2 id="clubTitle">/.test(band));
check('sınır cümlesi var', band.includes('ürün ayırma, indirim veya stok garantisi değildir'));
check('abartılı vaat yok', !/garantili|en ucuz|%\s?\d+|erken erişim|özel fiyat|özel indirim|sınırlı süre/i.test(band));
check('bantta form veya e-posta alanı yok', !/<form|<input/.test(band));
check('varsayılan metin kayıt vaat etmez', /Fırsat Kulübü'nü incele/.test(band) && !/ön kayıt bırak/i.test(band));
check('alt bilgide bağlantı', /<a href="\/firsat-kulubu">Fırsat Kulübü<\/a>/.test(html.slice(html.indexOf('<footer>'))));
check('sayfada tek h1', (html.match(/<h1[ >]/g) || []).length === 1);
const sm = html.match(/<script>\n\/\/ Fırsat Kulübü bandı[\s\S]*?<\/script>/);
check('bant betiği var', !!sm);
async function calistir(yanit) {
  const cta = { firstChild: { nodeValue: "Fırsat Kulübü'nü incele " } }, state = { textContent: '' }; let url = null;
  const sandbox = { document: { getElementById: (id) => id === 'clubCta' ? cta : id === 'clubState' ? state : null }, window: {}, setTimeout: (fn) => fn(),
    fetch: async (u) => { url = u; if (yanit === 'hata') throw new Error('ag'); return { ok: yanit !== 'bozuk', json: async () => yanit }; } };
  vm.createContext(sandbox); vm.runInContext(sm[0].replace(/<\/?script>/g, ''), sandbox);
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  return { cta: cta.firstChild.nodeValue, state: state.textContent, url };
}
if (sm) {
  let r = await calistir({ registration_open: true });
  check('açıkken: kayıt çağrısı', r.cta.startsWith('Ücretsiz ön kayıt bırak') && r.state === 'Ön kayıt açık.' && r.url === '/api/firsat-kulubu');
  r = await calistir({ registration_open: false });
  check('kapalıyken: kayıt vaadi yok', r.cta.startsWith("Fırsat Kulübü'nü incele") && r.state === 'Ön kayıt yakında açılıyor.');
  r = await calistir({ registration_open: 'true' });
  check('metin "true" açık sayılmaz', r.cta.startsWith("Fırsat Kulübü'nü incele"));
  r = await calistir('bozuk');
  check('sunucu hatasında kayıt vaadi yok', r.cta.startsWith("Fırsat Kulübü'nü incele") && r.state === 'Ön kayıt yakında açılıyor.');
  r = await calistir('hata');
  check('ağ hatasında bant bozulmaz', r.cta.startsWith("Fırsat Kulübü'nü incele") && r.state === '');
}
const kalan = checks.filter(([, ok]) => !ok);
if (kalan.length) { console.error(kalan.map(([ad]) => 'FAIL ' + ad).join('\n')); process.exit(1); }
console.log('ALL CHECKS PASSED'); console.log(checks.length + ' kontrol');
