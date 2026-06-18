// =====================================================================
// CADDE DEPO — Vercel Serverless Function
// POST /api/admin/upload-product-image
// Görsel upload'u SUNUCUDA service_role ile yapar (RLS bypass).
// Frontend'e storage yazma izni AÇILMAZ. service_role yalnız burada (server env).
// Gereken env (Vercel → Project Settings → Environment Variables):
//   SUPABASE_URL                = https://<proje>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   = (Supabase → Settings → API → service_role secret)
//   ADMIN_EMAILS (ops)          = virgülle ayrılmış yetkili admin e-postaları
// Bağımlılık yok: Node 18+ global fetch + Buffer + crypto kullanılır.
// =====================================================================

const BUCKET = 'urunler';
const MAX_BYTES = 3 * 1024 * 1024; // 3MB (base64 + Vercel 4.5MB gövde sınırı için güvenli)
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Yalnız POST' }); return; }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error('ENV eksik: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    res.status(500).json({ error: 'Sunucu yapılandırması eksik' }); return;
  }

  try {
    // --- 1) Admin doğrulama: kullanıcının Supabase access token'ı ---
    const authH = req.headers.authorization || '';
    const token = authH.startsWith('Bearer ') ? authH.slice(7) : '';
    if (!token) { res.status(401).json({ error: 'Yetkisiz: oturum bulunamadı' }); return; }

    const uResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${token}` }
    });
    if (!uResp.ok) { res.status(401).json({ error: 'Oturum geçersiz veya süresi dolmuş' }); return; }
    const user = await uResp.json();
    if (!user || !user.id) { res.status(401).json({ error: 'Oturum geçersiz' }); return; }

    const allow = (process.env.ADMIN_EMAILS || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allow.length && !allow.includes(String(user.email || '').toLowerCase())) {
      res.status(403).json({ error: 'Bu hesap görsel yükleme yetkisine sahip değil' }); return;
    }

    // --- 2) Gövde + doğrulama: { contentType, dataBase64 } ---
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { contentType, dataBase64 } = body;
    if (!dataBase64 || !EXT[contentType]) {
      res.status(400).json({ error: 'Geçersiz dosya türü — yalnız jpg, jpeg, png, webp' }); return;
    }
    const buf = Buffer.from(dataBase64, 'base64');
    if (!buf.length) { res.status(400).json({ error: 'Boş dosya' }); return; }
    if (buf.length > MAX_BYTES) { res.status(413).json({ error: 'Dosya çok büyük (maks 3MB)' }); return; }

    // --- 3) Benzersiz yol + service_role ile upload (RLS bypass) ---
    const uuid = (globalThis.crypto && globalThis.crypto.randomUUID)
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `${uuid}.${EXT[contentType]}`;

    const upResp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
        'cache-control': 'public, max-age=3600'
      },
      body: buf
    });
    if (!upResp.ok) {
      const t = await upResp.text().catch(() => '');
      console.error('STORAGE UPLOAD FAIL', upResp.status, t);
      res.status(502).json({ error: 'Storage yükleme hatası (bucket/yapılandırma)' }); return;
    }

    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    res.status(200).json({ url, path });
  } catch (err) {
    console.error('UPLOAD ROUTE ERROR', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};
