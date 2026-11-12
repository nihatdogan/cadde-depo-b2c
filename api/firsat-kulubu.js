// CADDE DEPO — Ücretsiz Fırsat Kulübü ön kayıt uç noktası (v2).
// Üyeliği etkinleştirmez, e-posta göndermez, stok ayırmaz.
// Kapalı başlar: aşağıdaki ortam değişkenlerinin HEPSİ doğru değilse kayıt almaz.
'use strict';
const crypto = require('node:crypto');

const KATEGORILER = new Set(['telefon', 'bilgisayar', 'elektronik', 'beyaz-esya', 'kucuk-ev-aletleri',
  'mobilya', 'ev-yasam', 'motor-bisiklet-spor', 'kozmetik-aksesuar']);
// Sayfadaki aydınlatma ve ileti onayı metninin sürümü. Metin değişirse burada ve HTML'de birlikte değişir.
const METIN_SURUM = 'firsat-kulubu-2026-11-12-v2';
const URETIM_HOSTLARI = new Set(['caddedepo.com', 'www.caddedepo.com']);
const URETIM_PROJE = 'svyqmmivhpfiuhxnmhny';
const EPOSTA = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const GOVDE_SINIRI = 2000;

function yanit(res, durum, govde) {
  res.statusCode = durum;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(govde));
}
function ortam() { return process.env.VERCEL_ENV === 'production' ? 'uretim' : 'onizleme'; }
function hostOf(raw) { return String(raw || '').split(',')[0].trim().split(':')[0].toLowerCase(); }

// Kayıt ancak şu koşulların hepsi sağlanırsa açıktır:
//  - CLUB_REGISTRATION_ENABLED = "true"
//  - CLUB_LEGAL_VERSION, koddaki METIN_SURUM ile aynı (hukuken onaylanan metnin sürümü elle girilir)
//  - veritabanı adresi, anahtar ve en az 32 karakterlik hız sırrı tanımlı
//  - üretim yalnız üretim projesine, önizleme yalnız BAŞKA bir projeye bağlı
function ayarlar() {
  const on = ortam() === 'uretim' ? 'CLUB_PROD_' : 'CLUB_PREVIEW_';
  const url = String(process.env[on + 'SUPABASE_URL'] || '').replace(/\/+$/, '');
  const anahtar = process.env[on + 'SERVICE_ROLE_KEY'] || '';
  const sir = process.env[on + 'RATE_SECRET'] || '';
  const uretimProjesi = url.indexOf(URETIM_PROJE) !== -1;
  const acik = process.env.CLUB_REGISTRATION_ENABLED === 'true'
    && process.env.CLUB_LEGAL_VERSION === METIN_SURUM
    && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)
    && anahtar.length > 0 && sir.length >= 32
    && (ortam() === 'uretim' ? uretimProjesi : !uretimProjesi);
  return { acik, url, anahtar, sir };
}

// İstek, sayfanın kendi adresinden gelmelidir.
function kaynakGecerli(req) {
  const host = hostOf(req.headers.host);
  let hostTamam;
  if (ortam() === 'uretim') {
    hostTamam = URETIM_HOSTLARI.has(host);
  } else {
    const izinli = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].filter(Boolean).map(hostOf);
    hostTamam = izinli.indexOf(host) !== -1;
  }
  if (!hostTamam) return false;
  try {
    const u = new URL(String(req.headers.origin || ''));
    return u.protocol === 'https:' && u.hostname === host;
  } catch (e) { return false; }
}

function govdeOku(req) {
  let ham;
  try { ham = req.body; } catch (e) { return null; }   // bozuk JSON
  if (typeof ham === 'string') { try { ham = JSON.parse(ham); } catch (e) { return null; } }
  if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return null;
  let boyut;
  try { boyut = JSON.stringify(ham).length; } catch (e) { return null; }
  return boyut > GOVDE_SINIRI ? undefined : ham;
}

function girdiDogrula(ham) {
  if (typeof ham.email !== 'string' || !Array.isArray(ham.categories)) return null;
  const email = ham.email.trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EPOSTA.test(email) || email.indexOf('..') !== -1) return null;
  const kategoriler = ham.categories;
  if (kategoriler.length < 1 || kategoriler.length > 3) return null;
  if (!kategoriler.every((k) => typeof k === 'string' && KATEGORILER.has(k))) return null;
  if (new Set(kategoriler).size !== kategoriler.length) return null;
  // Aydınlatma okundu bilgisi ve e-posta ileti onayı ayrı ayrı ve açıkça verilmiş olmalı.
  if (ham.privacy_ack !== true || ham.email_marketing_consent !== true) return null;
  if (ham.text_version !== METIN_SURUM) return null;
  return { email, kategoriler };
}

function istemciAnahtari(req, sir) {
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'bilinmiyor';
  return crypto.createHmac('sha256', sir).update(ip).digest('hex');
}

async function kaydet(conf, girdi, hizAnahtari) {
  const r = await fetch(conf.url + '/rest/v1/rpc/firsat_kulubu_on_kayit', {
    method: 'POST',
    headers: { apikey: conf.anahtar, Authorization: 'Bearer ' + conf.anahtar, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_email: girdi.email, p_kategoriler: girdi.kategoriler, p_metin_surum: METIN_SURUM, p_hiz_anahtar: hizAnahtari }),
    signal: AbortSignal.timeout(7000)
  });
  if (!r.ok) throw new Error('depo_' + r.status);
  return r.json();
}

module.exports = async function handler(req, res) {
  const conf = ayarlar();
  if (req.method === 'GET') return yanit(res, 200, { registration_open: conf.acik, text_version: METIN_SURUM });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return yanit(res, 405, { error: 'method_not_allowed' }); }
  if (!kaynakGecerli(req)) return yanit(res, 403, { error: 'invalid_origin' });
  if (!conf.acik) return yanit(res, 503, { error: 'registration_unavailable' });
  const tur = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (tur !== 'application/json') return yanit(res, 415, { error: 'unsupported_media_type' });
  const ham = govdeOku(req);
  if (ham === undefined) return yanit(res, 413, { error: 'too_large' });
  if (ham === null) return yanit(res, 400, { error: 'invalid_body' });
  // Tuzak alan doluysa hiçbir şey kaydedilmez; yanıt gerçek kayıtla aynıdır.
  if (ham.hp) return yanit(res, 202, { status: 'received' });
  const girdi = girdiDogrula(ham);
  if (!girdi) return yanit(res, 400, { error: 'invalid_input' });
  try {
    const sonuc = await kaydet(conf, girdi, istemciAnahtari(req, conf.sir));
    if (sonuc === 'sinir') return yanit(res, 429, { error: 'rate_limited' });
    if (sonuc !== 'ok') throw new Error('beklenmeyen_sonuc');
    // Yeni kayıt ile zaten kayıtlı e-posta aynı yanıtı alır.
    return yanit(res, 202, { status: 'received' });
  } catch (err) {
    console.error('firsat-kulubu kayit hatasi:', err && err.message);
    return yanit(res, 503, { error: 'registration_unavailable' });
  }
};
module.exports._test = { METIN_SURUM, KATEGORILER, girdiDogrula, kaynakGecerli, ayarlar, hostOf };
