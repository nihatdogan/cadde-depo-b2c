// Ortak SEO yardımcıları. Alt çizgili dosya Vercel'de rota olmaz.
const { readFileSync } = require('fs');
const { join } = require('path');

const ORIGIN = 'https://www.caddedepo.com';
const SUPABASE_URL = 'https://svyqmmivhpfiuhxnmhny.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Qdwrd6dyEx_rjTHonVNw6w_zjGKtw2B';
const HTML_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600';

const SHIPPING_PROMO = /(?:ücretsiz\s+(?:kargo|teslimat)|(?:kargo|teslimat)\s+(?:bedava|ücretsiz)|\d+\s*(?:₺|TL)\s*üzeri\s+kargo\s+bedava)/i;

// Kondisyon alanı ne diyorsa o. Teşhir ve açık kutu "yenilenmiş" diye yazılmaz.
const CONDITION_URL = {
  'Sıfır': 'https://schema.org/NewCondition',
  'Seri Sonu': 'https://schema.org/NewCondition',
  'Açık Kutu': 'https://schema.org/UsedCondition',
  'Teşhir': 'https://schema.org/UsedCondition',
};

const COND_TEXT = {
  'Açık Kutu': 'Ambalajı açılmış olabilir; ürün satışa uygundur.',
  'Sıfır': 'Sıfır ürün olarak listelenmiştir.',
  'Teşhir': 'Teşhir ürünü olarak listelenmiştir.',
  'Seri Sonu': 'Seri sonu olarak listelenmiştir.',
};

function readProjectFile(name) {
  const candidates = [join(__dirname, '..', name), join(process.cwd(), name)];
  let last;
  for (const file of candidates) {
    try { return readFileSync(file, 'utf8'); }
    catch (err) { last = err; }
  }
  throw last || new Error('Dosya okunamadı: ' + name);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function xml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

function fmtTl(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const hasFrac = Math.abs(v - Math.trunc(v)) > 0.001;
  const txt = v.toLocaleString('tr-TR', hasFrac
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 });
  return txt + ' TL';
}

function jsonLd(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function retailAbove(was, now) {
  const w = Number(was);
  const n = Number(now);
  return Number.isFinite(w) && Number.isFinite(n) && w > n;
}

async function supabaseGet(query) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + query, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Supabase ' + res.status + ': ' + text.slice(0, 180));
  }
  return res.json();
}

function descriptionParts(aciklama) {
  const paras = [];
  const bullets = [];
  String(aciklama || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .filter((l) => !SHIPPING_PROMO.test(l))
    .forEach((l) => {
      if (/^[-•]\s+/.test(l)) bullets.push(l.replace(/^[-•]\s+/, ''));
      else paras.push(l);
    });
  return { paras, bullets, plain: paras.concat(bullets).join(' ').replace(/\s+/g, ' ').trim() };
}

function productImages(p) {
  const list = Array.isArray(p.images) && p.images.length ? p.images : [p.gorsel_url];
  return list.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
}

function productPath(slug) {
  return '/urun/' + encodeURIComponent(slug);
}

function productUrl(slug) {
  return ORIGIN + productPath(slug);
}

function availability(p) {
  const stock = Number(p.stok);
  if (!Number.isFinite(stock)) return '';
  return stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
}

function brandName(p) {
  for (const key of ['marka', 'brand', 'marka_adi']) {
    if (p[key] != null && String(p[key]).trim()) return String(p[key]).trim();
  }
  return '';
}

function metaDescription(p, plain) {
  const bits = [p.ad, p.kondisyon, fmtTl(p.outlet_fiyat) + ', KDV dahil'].filter(Boolean);
  let desc = bits.join('. ');
  if (plain) {
    const extra = plain.slice(0, 180);
    desc = desc + '. ' + extra;
  }
  desc = desc.replace(/\s+/g, ' ').trim();
  if (desc.length > 160) desc = desc.slice(0, 157).trim() + '…';
  return desc;
}

function productJsonLd(p, plain) {
  const slug = p.slug;
  const url = productUrl(slug);
  const images = productImages(p);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.ad,
    sku: String(p.id),
    url,
  };
  if (plain) data.description = plain.slice(0, 500);
  else data.description = metaDescription(p, '');
  if (images.length) data.image = images;
  const brand = brandName(p);
  if (brand) data.brand = { '@type': 'Brand', name: brand };
  const price = Number(p.outlet_fiyat);
  if (Number.isFinite(price) && price >= 0) {
    const offer = {
      '@type': 'Offer',
      url,
      price: price.toFixed(2),
      priceCurrency: 'TRY',
      seller: { '@type': 'Organization', name: 'Cadde Depo' },
    };
    const avail = availability(p);
    if (avail) offer.availability = avail;
    const cond = CONDITION_URL[p.kondisyon];
    if (cond) offer.itemCondition = cond;
    data.offers = offer;
  }
  return data;
}

function crumb(p) {
  return [p.ana_kategori, p.kondisyon].filter(Boolean)
    .map((s) => String(s).toLocaleUpperCase('tr-TR')).join(' / ');
}

function stockText(p) {
  const stock = Number(p.stok);
  if (!Number.isFinite(stock)) return '';
  return stock > 0 ? stock + ' adet stokta' : 'Stokta yok';
}

function sendHtml(res, status, html, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(html);
}

module.exports = {
  ORIGIN,
  HTML_CACHE,
  COND_TEXT,
  CONDITION_URL,
  readProjectFile,
  esc,
  xml,
  fmtTl,
  jsonLd,
  retailAbove,
  supabaseGet,
  descriptionParts,
  productImages,
  productPath,
  productUrl,
  availability,
  metaDescription,
  productJsonLd,
  crumb,
  stockText,
  sendHtml,
};
