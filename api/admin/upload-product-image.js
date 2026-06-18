// =====================================================================
// CADDE DEPO — Vercel Node.js Serverless Function (Edge DEĞİL)
// POST /api/admin/upload-product-image   (multipart/form-data, field: "file")
// Görsel upload'u SUNUCUDA service_role ile yapar (RLS bypass).
// Frontend storage'a YAZMAZ. service_role yalnız burada (server env).
// Env (Vercel → Settings → Environment Variables → Production):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (ops) ADMIN_EMAILS
// =====================================================================
const { randomUUID } = require('crypto');

const BUCKET = 'urunler';
const MAX_BYTES = 4 * 1024 * 1024; // 4MB (Vercel ~4.5MB gövde sınırı altında)
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Ham gövdeyi al: Vercel multipart'ı parse etmez (Buffer ya da stream).
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  console.log('upload endpoint called', req.method);
  console.log('env check', {
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
  });

  if (req.method !== 'POST') { res.status(405).json({ error: 'Yalnız POST' }); return; }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) { res.status(500).json({ error: 'Sunucu yapılandırması eksik' }); return; }

  try {
    // --- Admin doğrulama (kullanıcının access token'ı) ---
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) { res.status(401).json({ error: 'Yetkisiz: oturum yok' }); return; }
    const uResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${token}` }
    });
    if (!uResp.ok) { res.status(401).json({ error: 'Oturum geçersiz' }); return; }
    const user = await uResp.json();
    if (!user || !user.id) { res.status(401).json({ error: 'Oturum geçersiz' }); return; }
    const allow = (process.env.ADMIN_EMAILS || '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allow.length && !allow.includes(String(user.email || '').toLowerCase())) {
      res.status(403).json({ error: 'Bu hesap görsel yükleme yetkisine sahip değil' }); return;
    }

    // --- multipart/form-data parse (undici Request.formData) ---
    const contentType = req.headers['content-type'] || '';
    const raw = await readRawBody(req);
    const webReq = new Request('http://upload.local', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: raw
    });
    const form = await webReq.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') { res.status(400).json({ error: 'Dosya bulunamadı (file)' }); return; }
    console.log('file received', file.name, file.type, file.size);

    if (!EXT[file.type]) { res.status(400).json({ error: 'Geçersiz dosya türü — yalnız jpg, png, webp' }); return; }
    if (file.size > MAX_BYTES) { res.status(413).json({ error: 'Dosya çok büyük (maks 4MB)' }); return; }

    console.log('bucket name', BUCKET);

    // --- service_role ile upload (RLS bypass) ---
    const path = `${randomUUID()}.${EXT[file.type]}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const upResp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': file.type,
        'x-upsert': 'true',
        'cache-control': 'public, max-age=3600'
      },
      body: bytes
    });
    if (!upResp.ok) {
      const t = await upResp.text().catch(() => '');
      console.error('upload error', upResp.status, t);
      res.status(502).json({ error: 'Storage yükleme hatası' }); return;
    }

    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    console.log('upload success', url);
    res.status(200).json({ url, path });
  } catch (err) {
    console.error('upload error', (err && err.message) || String(err));
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};
