// /sitemap.xml — ana sayfa ve aktif ürünler.
const seo = require('./_seo');

function lastmod(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function urlNode(loc, mod) {
  return '<url><loc>' + seo.xml(loc) + '</loc>' +
    (mod ? '<lastmod>' + mod + '</lastmod>' : '') +
    '</url>';
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method not allowed');
    return;
  }
  let rows = [];
  try {
    rows = await seo.supabaseGet('products?aktif=eq.true&select=slug,created_at&order=created_at.desc');
  } catch (err) {
    console.error('Sitemap sorgusu başarısız:', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Sitemap üretilemedi');
    return;
  }
  const dates = rows.map((p) => lastmod(p.created_at)).filter(Boolean).sort();
  const homeMod = dates.length ? dates[dates.length - 1] : '';
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlNode(seo.ORIGIN + '/', homeMod),
    urlNode(seo.ORIGIN + '/iade-politikasi', ''),
    urlNode(seo.ORIGIN + '/mesafeli-satis-sozlesmesi', ''),
    urlNode(seo.ORIGIN + '/on-bilgilendirme', ''),
    urlNode(seo.ORIGIN + '/kvkk', ''),
    urlNode(seo.ORIGIN + '/gizlilik', ''),
    urlNode(seo.ORIGIN + '/iletisim', ''),
  ];
  for (const row of rows) {
    if (!row || !row.slug) continue;
    body.push(urlNode(seo.productUrl(row.slug), lastmod(row.created_at)));
  }
  body.push('</urlset>');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', seo.HTML_CACHE);
  res.end(body.join('\n'));
};
