// Var olmayan yollar. Bu işleve yalnız Accept: text/markdown düşünce gelinir.
// Durum 404 kalır. Tarayıcının HTML 404 sayfasına dokunulmaz.
'use strict';

const SITEMAP = 'https://www.caddedepo.com/sitemap.xml';

const BODY = [
  '# Sayfa bulunamadı',
  '',
  'İstenen adres bu sitede yok. Yazımı kontrol edin veya site haritasından devam edin.',
  '',
  'The requested page does not exist.',
  '',
  '- [Site haritası](' + SITEMAP + ')',
  '',
].join('\n');

module.exports = function markdown404(req, res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(BODY);
};
