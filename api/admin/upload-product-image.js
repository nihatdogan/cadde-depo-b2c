// =====================================================================
// CADDE DEPO — Vercel Edge Function
// POST /api/admin/upload-product-image   (multipart/form-data, field: "file")
// Görsel upload'u SUNUCUDA service_role ile yapar (RLS bypass).
// Frontend storage'a YAZMAZ. service_role yalnız burada (server env).
// Env (Vercel → Settings → Environment Variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (ops) ADMIN_EMAILS
// =====================================================================
export const config = { runtime: 'edge' };

const BUCKET = 'urunler';
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  console.log('upload endpoint called', req.method);
  if (req.method !== 'POST') return json({ error: 'Yalnız POST' }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error('upload error: ENV eksik (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    return json({ error: 'Sunucu yapılandırması eksik' }, 500);
  }

  try {
    // --- Admin doğrulama (kullanıcının access token'ı) ---
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Yetkisiz: oturum yok' }, 401);
    const uResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${token}` }
    });
    if (!uResp.ok) return json({ error: 'Oturum geçersiz' }, 401);
    const user = await uResp.json();
    if (!user || !user.id) return json({ error: 'Oturum geçersiz' }, 401);
    const allow = (process.env.ADMIN_EMAILS || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allow.length && !allow.includes(String(user.email || '').toLowerCase())) {
      return json({ error: 'Bu hesap görsel yükleme yetkisine sahip değil' }, 403);
    }

    // --- FormData: field "file" ---
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return json({ error: 'Dosya bulunamadı (file)' }, 400);
    console.log('file received', file.name, file.type, file.size);

    if (!EXT[file.type]) return json({ error: 'Geçersiz dosya türü — yalnız jpg, png, webp' }, 400);
    if (file.size > MAX_BYTES) return json({ error: 'Dosya çok büyük (maks 5MB)' }, 413);

    console.log('bucket name', BUCKET);

    // --- service_role ile upload (RLS bypass) ---
    const path = `${crypto.randomUUID()}.${EXT[file.type]}`;
    const bytes = await file.arrayBuffer();
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
      return json({ error: 'Storage yükleme hatası' }, 502);
    }

    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    console.log('upload success', url);
    return json({ url, path }, 200);
  } catch (err) {
    console.error('upload error', (err && err.message) || String(err));
    return json({ error: 'Sunucu hatası' }, 500);
  }
}
