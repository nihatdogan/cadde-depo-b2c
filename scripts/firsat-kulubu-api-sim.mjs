// Fırsat Kulübü API'sini sahte depo ile çalıştırır. Ağa ve canlıya dokunmaz.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const api = require('../api/firsat-kulubu.js');
const SURUM = api._test.METIN_SURUM;
const checks = []; const check = (ad, ok) => checks.push([ad, !!ok]);
const HOST = 'www.caddedepo.com';
const istek = (body, h = {}, method = 'POST') => ({ method, headers: { host: HOST, origin: 'https://' + HOST, 'content-type': 'application/json', 'x-real-ip': '203.0.113.10', ...h }, body });
const yanit = () => ({ statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(s) { this.raw = s; this.json = JSON.parse(s); } });
const gecerli = (o = {}) => ({ email: 'ornek@example.com', categories: ['elektronik'], privacy_ack: true, email_marketing_consent: true, text_version: SURUM, hp: '', ...o });
async function cagir(req) { const r = yanit(); await api(req, r); return r; }
const ENV = ['VERCEL_ENV', 'VERCEL_URL', 'VERCEL_BRANCH_URL', 'CLUB_REGISTRATION_ENABLED', 'CLUB_LEGAL_VERSION', 'CLUB_PROD_SUPABASE_URL', 'CLUB_PROD_SERVICE_ROLE_KEY', 'CLUB_PROD_RATE_SECRET', 'CLUB_PREVIEW_SUPABASE_URL', 'CLUB_PREVIEW_SERVICE_ROLE_KEY', 'CLUB_PREVIEW_RATE_SECRET'];
function ortam(o) { for (const k of ENV) delete process.env[k]; Object.assign(process.env, o); }
const URETIM = { VERCEL_ENV: 'production', CLUB_REGISTRATION_ENABLED: 'true', CLUB_LEGAL_VERSION: SURUM, CLUB_PROD_SUPABASE_URL: 'https://svyqmmivhpfiuhxnmhny.supabase.co', CLUB_PROD_SERVICE_ROLE_KEY: 'test-anahtar', CLUB_PROD_RATE_SECRET: 'x'.repeat(32) };

// Sahte depo: gerçek SQL fonksiyonunun sözleşmesini taklit eder.
let cagri = []; let depo = { emails: new Set(), sayac: new Map(), hata: false };
globalThis.fetch = async (url, o) => {
  const b = JSON.parse(o.body); cagri.push({ url, b, h: o.headers });
  if (depo.hata) return { ok: false, status: 500, json: async () => ({}) };
  const n = (depo.sayac.get(b.p_hiz_anahtar) || 0) + 1; depo.sayac.set(b.p_hiz_anahtar, n);
  if (n > 5) return { ok: true, status: 200, json: async () => 'sinir' };
  depo.emails.add(b.p_email); return { ok: true, status: 200, json: async () => 'ok' };
};

// 1. Kapalı başlar
ortam({ VERCEL_ENV: 'production' });
let r = await cagir(istek(null, {}, 'GET')); check('varsayılan kapalı (GET)', r.json.registration_open === false && r.headers['cache-control'] === 'no-store');
r = await cagir(istek(gecerli())); check('varsayılan kapalı (POST 503)', r.statusCode === 503 && cagri.length === 0);
for (const [ad, eksik] of [['etkin bayrağı yok', { CLUB_REGISTRATION_ENABLED: 'false' }], ['hukuk sürümü yok', { CLUB_LEGAL_VERSION: '' }], ['hukuk sürümü eski', { CLUB_LEGAL_VERSION: 'firsat-kulubu-2026-11-12-v1' }], ['hız sırrı kısa', { CLUB_PROD_RATE_SECRET: 'kisa' }], ['anahtar yok', { CLUB_PROD_SERVICE_ROLE_KEY: '' }], ['üretim başka projeye bağlı', { CLUB_PROD_SUPABASE_URL: 'https://baskaproje.supabase.co' }], ['adres http', { CLUB_PROD_SUPABASE_URL: 'http://svyqmmivhpfiuhxnmhny.supabase.co' }]]) {
  ortam({ ...URETIM, ...eksik }); r = await cagir(istek(gecerli())); check('kapalı kalır: ' + ad, r.statusCode === 503 && cagri.length === 0);
}
// 2. Açık: kaynak denetimi
ortam(URETIM);
r = await cagir(istek(null, {}, 'GET')); check('tüm koşullar tamamsa açık', r.json.registration_open === true && r.json.text_version === SURUM);
for (const [ad, h] of [['yabancı origin', { origin: 'https://kotu.example' }], ['origin yok', { origin: '' }], ['http origin', { origin: 'http://' + HOST }], ['vercel.app hostu üretimde', { host: 'caddedepo-b2c.vercel.app', origin: 'https://caddedepo-b2c.vercel.app' }], ['alt alan adı taklidi', { host: 'www.caddedepo.com.kotu.example', origin: 'https://www.caddedepo.com.kotu.example' }]]) {
  r = await cagir(istek(gecerli(), h)); check('reddedilir: ' + ad, r.statusCode === 403 && cagri.length === 0);
}
r = await cagir(istek(gecerli(), {}, 'PUT')); check('yöntem reddi', r.statusCode === 405);
r = await cagir(istek(gecerli(), { 'content-type': 'text/plain' })); check('içerik türü reddi', r.statusCode === 415);
// 3. Girdi
const kotu = { 'çift @': { email: 'a@b@c.com' }, 'etiket': { email: '<script>@x.co' }, 'boşluk': { email: 'a b@x.co' }, 'çift nokta': { email: 'a..b@x.co' }, 'alan adı yok': { email: 'a@b' }, 'uzun': { email: 'a'.repeat(250) + '@x.co' }, 'e-posta nesne': { email: { a: 1 } }, 'kategori yok': { categories: [] }, 'dört kategori': { categories: ['telefon', 'mobilya', 'elektronik', 'bilgisayar'] }, 'yinelenen kategori': { categories: ['telefon', 'telefon'] }, 'bilinmeyen kategori': { categories: ['silah'] }, 'kategori dizi değil': { categories: 'telefon' }, 'aydınlatma işaretsiz': { privacy_ack: false }, 'ileti onayı işaretsiz': { email_marketing_consent: false }, 'onay metin değeri "true"': { email_marketing_consent: 'true' }, 'eski metin sürümü': { text_version: 'firsat-kulubu-2026-11-12-v1' } };
for (const [ad, o] of Object.entries(kotu)) { r = await cagir(istek(gecerli(o))); check('geçersiz girdi: ' + ad, r.statusCode === 400 && cagri.length === 0); }
r = await cagir({ method: 'POST', headers: istek().headers, get body() { throw new Error('Invalid JSON'); } }); check('bozuk JSON 400 döner, çökmez', r.statusCode === 400);
r = await cagir(istek([1, 2])); check('dizi gövde reddi', r.statusCode === 400);
r = await cagir(istek(gecerli({ dolgu: 'x'.repeat(3000) }))); check('büyük gövde reddi', r.statusCode === 413 && cagri.length === 0);
r = await cagir(istek(JSON.stringify(gecerli({ email: 'metin@example.com' })), { 'x-real-ip': '203.0.113.77' })); check('metin gövde de çözülür', r.statusCode === 202);
// 4. Kayıt
cagri = []; depo = { emails: new Set(), sayac: new Map(), hata: false };
const yeni = await cagir(istek(gecerli({ email: '  Ornek@Example.COM ' })));
check('yeni kayıt 202', yeni.statusCode === 202 && yeni.raw === '{"status":"received"}');
check('tek depo çağrısı, yalnız RPC', cagri.length === 1 && cagri[0].url === 'https://svyqmmivhpfiuhxnmhny.supabase.co/rest/v1/rpc/firsat_kulubu_on_kayit');
check('e-posta küçük harf ve kırpılmış', cagri[0].b.p_email === 'ornek@example.com');
check('depoya yalnız dört alan gider', Object.keys(cagri[0].b).sort().join() === 'p_email,p_hiz_anahtar,p_kategoriler,p_metin_surum' && cagri[0].b.p_metin_surum === SURUM);
check('IP düz gitmez, özet gider', /^[0-9a-f]{64}$/.test(cagri[0].b.p_hiz_anahtar) && !JSON.stringify(cagri[0].b).includes('203.0.113'));
check('yanıtta e-posta yok', !yeni.raw.includes('example'));
const tekrar = await cagir(istek(gecerli(), { 'x-real-ip': '203.0.113.99' }));
check('kayıtlı e-posta aynı yanıtı alır', tekrar.statusCode === yeni.statusCode && tekrar.raw === yeni.raw);
cagri = []; const tuzak = await cagir(istek(gecerli({ hp: 'http://spam' })));
check('tuzak alan: kayıt yok, yanıt aynı', tuzak.raw === yeni.raw && tuzak.statusCode === 202 && cagri.length === 0);
// 5. Hız sınırı: aynı adresten 5 kişi geçer, 6. durur; başka adres etkilenmez
depo = { emails: new Set(), sayac: new Map(), hata: false }; const kodlar = [];
for (let i = 0; i < 6; i++) kodlar.push((await cagir(istek(gecerli({ email: `kisi${i}@example.com` }), { 'x-real-ip': '198.51.100.7' }))).statusCode);
check('aynı adresten 5 kayıt geçer, 6. 429', kodlar.join() === '202,202,202,202,202,429');
r = await cagir(istek(gecerli({ email: 'baska@example.com' }), { 'x-real-ip': '198.51.100.8' })); check('başka adres etkilenmez', r.statusCode === 202);
cagri = []; await cagir(istek(gecerli({ email: 'k@example.com' }), { 'x-real-ip': '', 'x-forwarded-for': '198.51.100.9, 10.0.0.1' })); const a1 = cagri[0].b.p_hiz_anahtar;
await cagir(istek(gecerli({ email: 'l@example.com' }), { 'x-real-ip': '', 'x-forwarded-for': '198.51.100.9, 10.9.9.9' })); check('x-forwarded-for ilk adres kullanılır', cagri[1].b.p_hiz_anahtar === a1);
// 6. Depo hatası
depo.hata = true; const eskiHata = console.error; let log = ''; console.error = (...a) => { log += a.join(' '); };
r = await cagir(istek(gecerli({ email: 'hata@example.com' }))); console.error = eskiHata;
check('depo hatası 503, sahte başarı yok', r.statusCode === 503 && r.json.error === 'registration_unavailable');
check('hata günlüğünde e-posta yok', !log.includes('hata@example.com'));
depo.hata = false;
// 7. Önizleme
const ONIZ = { VERCEL_ENV: 'preview', VERCEL_URL: 'cadde-abc123.vercel.app', CLUB_REGISTRATION_ENABLED: 'true', CLUB_LEGAL_VERSION: SURUM, CLUB_PREVIEW_SUPABASE_URL: 'https://emnacsavgsjkrocpngcj.supabase.co', CLUB_PREVIEW_SERVICE_ROLE_KEY: 'k', CLUB_PREVIEW_RATE_SECRET: 'y'.repeat(32) };
ortam(ONIZ); cagri = [];
r = await cagir(istek(gecerli(), { host: 'cadde-abc123.vercel.app', origin: 'https://cadde-abc123.vercel.app' })); check('önizleme kendi adresinden çalışır', r.statusCode === 202 && cagri[0].url.includes('emnacsavgsjkrocpngcj'));
r = await cagir(istek(gecerli(), { host: 'baska.vercel.app', origin: 'https://baska.vercel.app' })); check('önizleme: başka vercel.app hostu reddedilir', r.statusCode === 403);
r = await cagir(istek(gecerli(), { host: HOST, origin: 'https://' + HOST })); check('önizleme: üretim hostu reddedilir', r.statusCode === 403);
ortam({ ...ONIZ, CLUB_PREVIEW_SUPABASE_URL: 'https://svyqmmivhpfiuhxnmhny.supabase.co' }); cagri = [];
r = await cagir(istek(gecerli(), { host: 'cadde-abc123.vercel.app', origin: 'https://cadde-abc123.vercel.app' })); check('önizleme üretim veritabanına YAZAMAZ', r.statusCode === 503 && cagri.length === 0);
ortam(URETIM); r = await cagir(istek(gecerli())); check('üretim anahtarları önizleme adlarından okunmaz', cagri.at(-1).h.apikey === 'test-anahtar');

const kalan = checks.filter(([, ok]) => !ok);
if (kalan.length) { console.error(kalan.map(([ad]) => 'FAIL ' + ad).join('\n')); process.exit(1); }
console.log('ALL CHECKS PASSED'); console.log(checks.length + ' kontrol');
