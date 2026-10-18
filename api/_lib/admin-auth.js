'use strict';
const { previewEnvironmentReady } = require('./preview-only');

/**
 * Cadde Depo admin guard. A browser-supplied session/user/role is NOT trusted.
 * Call Supabase Auth /user with the user's access token and inspect server-returned
 * app_metadata. user_metadata and email alone are insufficient.
 */
async function requireAdmin(req, env = process.env, fetcher = fetch) {
  if (!previewEnvironmentReady(env)) return { status: 503, error: 'Preview ortami dogrulanamadi' };
  const authorization = String(req.headers.authorization || '');
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match) return { status: 401, error: 'Gecerli bir oturum gerekli' };

  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const apiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !apiKey) {
    return { status: 503, error: 'Sunucu yapilandirmasi eksik' };
  }

  let response;
  try {
    response = await fetcher(`${url}/auth/v1/user`, {
      method: 'GET',
      headers: { apikey: apiKey, Authorization: `Bearer ${match[1]}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000)
    });
  } catch {
    return { status: 503, error: 'Kimlik servisine ulasilamadi' };
  }
  if (!response.ok) return { status: 401, error: 'Oturum dogrulanamadi' };

  let user;
  try { user = await response.json(); } catch { return { status: 401, error: 'Gecersiz oturum' }; }
  if (!user?.id || user.app_metadata?.role !== 'admin') {
    return { status: 403, error: 'Yonetici yetkisi gerekli' };
  }

  // Optional secondary restriction: only if configured, an allowlist is enforced.
  const allowlist = String(env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowlist.length && !allowlist.includes(String(user.email || '').toLowerCase())) {
    return { status: 403, error: 'Yonetici e-posta listesinde degil' };
  }
  return { status: 200, user: { id: user.id, email: user.email || '', role: 'admin' } };
}

module.exports = { requireAdmin };
