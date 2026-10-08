// CADDE DEPO — ürün slug / URL yardımcıları (tek kaynak: admin, ana sayfa, ürün sayfası)
// Slug products.slug kolonunda KALICI saklanır; sayfa yüklenirken ürün adından yeniden hesaplanmaz
// (yalnızca slug kolonu henüz yokken ürün sayfasında geçici geri dönüş olarak kullanılır).
(function (root) {
  var ORIGIN = 'https://www.caddedepo.com';
  var TR = { 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u' };

  // "Üçlü Zigon Sehpa – 2026" -> "uclu-zigon-sehpa-2026"
  function cdSlugify(name) {
    var s = String(name == null ? '' : name)
      .replace(/[çÇğĞıİöÖşŞüÜ]/g, function (c) { return TR[c]; })
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '');
    return s || 'urun';
  }

  // Benzersiz slug: base, base-2, base-3 ... (ID yalnızca çakışma çözümü gerekiyorsa değil, sayaçla çözülür)
  async function cdUniqueSlug(sb, name, excludeId) {
    var base = cdSlugify(name);
    var q = sb.from('products').select('id,slug').ilike('slug', base + '%');
    var res = await q;
    if (res.error) throw res.error;
    var taken = {};
    (res.data || []).forEach(function (r) { if (r.slug && String(r.id) !== String(excludeId)) taken[r.slug] = true; });
    if (!taken[base]) return base;
    var n = 2;
    while (taken[base + '-' + n]) n++;
    return base + '-' + n;
  }

  function cdProductPath(p) { return p && p.slug ? '/urun/' + encodeURIComponent(p.slug) : '/urun.html?id=' + (p && p.id); }
  function cdProductUrl(p) { return ORIGIN + cdProductPath(p); }

  root.cdSlugify = cdSlugify;
  root.cdUniqueSlug = cdUniqueSlug;
  root.cdProductPath = cdProductPath;
  root.cdProductUrl = cdProductUrl;
  root.CD_ORIGIN = ORIGIN;
})(window);
