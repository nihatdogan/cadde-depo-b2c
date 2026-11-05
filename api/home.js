// Ana sayfa — meta, Organization/WebSite JSON-LD ve ham HTML'de /urun/ linkleri.
const seo = require('./_seo');

const HOME_DESC = 'Cadde Depo — DEPODAN DİREKT. Fazla stok, teşhir ve açık kutu ürünler. Fiyatlar KDV dahildir; kargo ücreti siparişte bildirilir.';

function headTags() {
  const url = seo.ORIGIN + '/';
  const image = seo.ORIGIN + '/brand/logo-horizontal-960x240.png';
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'Cadde Depo',
        url: url,
        slogan: 'DEPODAN DİREKT',
        logo: seo.ORIGIN + '/brand/logo-icon-512.png',
      },
      {
        '@type': 'WebSite',
        name: 'Cadde Depo',
        url: url,
        description: HOME_DESC,
      },
    ],
  };
  return [
    '<meta name="description" content="' + seo.esc(HOME_DESC) + '">',
    '<link rel="canonical" href="' + url + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Cadde Depo">',
    '<meta property="og:title" content="CADDE DEPO — Canlı Boşaltma. Depodan direkt.">',
    '<meta property="og:description" content="' + seo.esc(HOME_DESC) + '">',
    '<meta property="og:url" content="' + url + '">',
    '<meta property="og:image" content="' + image + '">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="CADDE DEPO — Canlı Boşaltma. Depodan direkt.">',
    '<meta name="twitter:description" content="' + seo.esc(HOME_DESC) + '">',
    '<meta name="twitter:image" content="' + image + '">',
    '<script type="application/ld+json">' + seo.jsonLd(graph) + '</script>',
  ].join('\n');
}

function productList(rows) {
  const items = (rows || []).filter((p) => p && p.slug && p.ad).map((p) =>
    '<li><a href="' + seo.esc(seo.productPath(p.slug)) + '">' + seo.esc(p.ad) + '</a></li>'
  ).join('');
  if (!items) return '<div class="grid" id="grid"></div>';
  return '<div class="grid" id="grid"><ul class="seo-products">' + items + '</ul></div>';
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method not allowed');
    return;
  }
  let html;
  try {
    html = seo.readProjectFile('index.html');
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Ana sayfa okunamadı');
    return;
  }
  let list = '<div class="grid" id="grid"></div>';
  try {
    const rows = await seo.supabaseGet('products?aktif=eq.true&select=ad,slug&order=created_at.desc');
    list = productList(rows);
  } catch (err) {
    console.error('Ana sayfa ürün listesi alınamadı:', err.message);
  }
  html = html
    .replace('</head>', headTags() + '\n</head>')
    .replace('<div class="grid" id="grid"></div>', list);
  seo.sendHtml(res, 200, html, seo.HTML_CACHE);
};
