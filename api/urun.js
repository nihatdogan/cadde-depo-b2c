// /urun/:slug — statik urun.html içine ürün metnini ve SEO etiketlerini basar.
// Tarayıcıdaki mevcut script aynı düğümleri Supabase'den tekrar doldurabilir.
const seo = require('./_seo');

function notFoundHtml() {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-4B0J8210EJ"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-4B0J8210EJ');
</script>
<meta name="robots" content="noindex">
<title>Ürün bulunamadı | Cadde Depo</title>
</head>
<body>
<h1>Ürün bulunamadı</h1>
<p><a href="${seo.ORIGIN}/">Cadde Depo</a></p>
</body>
</html>`;
}

function headTags(p, plain) {
  const url = seo.productUrl(p.slug);
  const title = p.ad + ' | Cadde Depo';
  const desc = seo.metaDescription(p, plain);
  const image = seo.productImages(p)[0] || '';
  const tags = [
    '<title>' + seo.esc(title) + '</title>',
    '<meta name="description" content="' + seo.esc(desc) + '">',
    '<link rel="canonical" href="' + seo.esc(url) + '">',
    '<meta property="og:type" content="product">',
    '<meta property="og:site_name" content="Cadde Depo">',
    '<meta property="og:title" content="' + seo.esc(title) + '">',
    '<meta property="og:description" content="' + seo.esc(desc) + '">',
    '<meta property="og:url" content="' + seo.esc(url) + '">',
  ];
  const price = Number(p.outlet_fiyat);
  if (Number.isFinite(price) && price >= 0) {
    tags.push('<meta property="product:price:amount" content="' + price.toFixed(2) + '">');
    tags.push('<meta property="product:price:currency" content="TRY">');
  }
  tags.push(
    '<meta name="twitter:card" content="' + (image ? 'summary_large_image' : 'summary') + '">',
    '<meta name="twitter:title" content="' + seo.esc(title) + '">',
    '<meta name="twitter:description" content="' + seo.esc(desc) + '">',
  );
  if (image) {
    tags.push('<meta property="og:image" content="' + seo.esc(image) + '">');
    tags.push('<meta name="twitter:image" content="' + seo.esc(image) + '">');
  }
  tags.push('<script type="application/ld+json">' + seo.jsonLd(seo.productJsonLd(p, plain)) + '</script>');
  return tags.join('\n');
}

function priceHtml(p) {
  const outlet = Number(p.outlet_fiyat);
  let html = '<div class="pd-now">KDV DAHİL: ' + seo.esc(seo.fmtTl(outlet)) + '</div>';
  if (seo.retailAbove(p.perakende_fiyat, p.outlet_fiyat)) {
    const pct = Math.round((1 - outlet / Number(p.perakende_fiyat)) * 100);
    html += '<div class="pd-compare"><s>' + seo.esc(seo.fmtTl(p.perakende_fiyat)) + '</s><span class="disc">-%' + pct + '</span></div>';
  }
  return html;
}

function descHtml(parts) {
  if (!parts.paras.length && !parts.bullets.length) {
    return '<p>Bu ürün Cadde Depo canlı stok ürünüdür.</p>';
  }
  return parts.paras.map((t) => '<p>' + seo.esc(t) + '</p>').join('') +
    (parts.bullets.length
      ? '<ul class="pd-feat">' + parts.bullets.map((t) => '<li>' + seo.esc(t) + '</li>').join('') + '</ul>'
      : '');
}

function fillTemplate(html, p) {
  const parts = seo.descriptionParts(p.aciklama);
  const images = seo.productImages(p);
  const main = images[0]
    ? '<img src="' + seo.esc(images[0]) + '" alt="' + seo.esc(p.ad) + '">'
    : '<div class="ph">GÖRSEL YOK</div>';
  const stock = seo.stockText(p);
  let out = html
    .replace('<title>Ürün — Cadde Depo</title>', '')
    .replace('<meta name="description" content="Cadde Depo canlı stok ürünü.">', '')
    .replace('</head>', headTags(p, parts.plain) + '\n</head>')
    .replace('<div id="detail" hidden>', '<div id="detail">')
    .replace('<div class="pd-stage" id="pdMain"></div>', '<div class="pd-stage" id="pdMain">' + main + '</div>')
    .replace('<div class="pd-cat" id="pdCat"></div>', '<div class="pd-cat" id="pdCat">' + seo.esc(seo.crumb(p)) + '</div>')
    .replace('<h1 class="pd-title" id="pdTitle"></h1>', '<h1 class="pd-title" id="pdTitle">' + seo.esc(p.ad) + '</h1>')
    .replace('<div class="pd-price" id="pdPrice"></div>', '<div class="pd-price" id="pdPrice">' + priceHtml(p) + '</div>')
    .replace('<p class="pd-ship" id="pdShipLine"></p>', '<p class="pd-ship" id="pdShipLine">' + seo.esc(seo.shippingLine(p)) + '</p>')
    .replace('<p class="pd-meta" id="pdMeta"></p>', '<p class="pd-meta" id="pdMeta">' + seo.esc(stock) + '</p>')
    .replace('<div id="pdDesc"></div>', '<div id="pdDesc">' + descHtml(parts) + '</div>')
    .replace('<p id="pdCond"></p>', '<p id="pdCond">' + seo.esc(seo.COND_TEXT[p.kondisyon] || 'Ürün durumu etikette belirtilmiştir.') + '</p>');
  if (seo.explicitShipping(p) != null) {
    out = out.replace(
      '<p id="pdShip">Kargo ücreti siparişte bildirilir. Kesin tutar, teslimat adresine göre ödeme öncesinde iletilir.</p>',
      '<p id="pdShip">' + seo.esc(seo.shippingLine(p)) + '</p>'
    );
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method not allowed');
    return;
  }
  const rawSlug = Array.isArray(req.query && req.query.slug) ? req.query.slug[0] : (req.query && req.query.slug);
  const slug = decodeURIComponent(String(rawSlug || '')).trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    res.setHeader('X-Robots-Tag', 'noindex');
    seo.sendHtml(res, 404, notFoundHtml(), 'public, max-age=0, s-maxage=60');
    return;
  }
  let template;
  try {
    template = seo.readProjectFile('urun.html');
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Ürün sayfası okunamadı');
    return;
  }
  let rows;
  try {
    rows = await seo.supabaseGet('products?slug=eq.' + encodeURIComponent(slug) + '&select=*');
  } catch (err) {
    console.error('Ürün SEO sorgusu başarısız:', err.message);
    res.setHeader('X-Robots-Tag', 'noindex');
    seo.sendHtml(res, 200, template.replace('</head>', '<meta name="robots" content="noindex">\n</head>'), 'no-store');
    return;
  }
  const product = (rows || []).find((row) => row && row.slug === slug && row.aktif !== false);
  if (!product) {
    res.setHeader('X-Robots-Tag', 'noindex');
    seo.sendHtml(res, 404, notFoundHtml(), 'public, max-age=0, s-maxage=60');
    return;
  }
  seo.sendHtml(res, 200, fillTemplate(template, product), seo.HTML_CACHE);
};
