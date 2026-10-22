'use strict';
const { requireAdmin } = require('../_lib/admin-auth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['whatsapp_bekliyor', 'onaylandi', 'kargolandi', 'teslim', 'iptal']);

// Server-only order status mutation. The database RPC owns BOTH the order status
// transition and the stock movement, in the same Postgres transaction.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Yalniz POST' });

  const admin = await requireAdmin(req);
  if (admin.status !== 200) return res.status(admin.status).json({ error: admin.error });

  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key) {
    return res.status(503).json({ error: 'Sunucu yapilandirmasi eksik' });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
    return res.status(415).json({ error: 'JSON gerekli' });
  }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Gecersiz JSON' }); }
  if (!body || JSON.stringify(body).length > 512 ||
      !UUID_RE.test(String(body.order_id || '')) || !STATUSES.has(body.status)) {
    return res.status(400).json({ error: 'Gecersiz siparis durumu talebi' });
  }

  let response;
  try {
    response = await fetch(`${base}/rest/v1/rpc/admin_change_order_status`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_order_id: body.order_id, p_next_status: body.status }),
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return res.status(503).json({ error: 'Siparis servisine ulasilamadi' });
  }

  if (!response.ok) {
    // Fixed client messages: never return internal DB errors.
    let errorCode = '';
    try { errorCode = (await response.json())?.code || ''; } catch {}
    if (errorCode === '23514') return res.status(409).json({ error: 'Yetersiz stok veya stok geri alim siniri' });
    if (errorCode === '22023') return res.status(409).json({ error: 'Gecersiz siparis gecisi veya siparis kalemleri' });
    if (errorCode === 'P0002') return res.status(404).json({ error: 'Siparis bulunamadi' });
    return res.status(502).json({ error: 'Siparis durumu guncellenemedi' });
  }

  let data;
  try { data = await response.json(); } catch {
    return res.status(502).json({ error: 'Sunucu yaniti okunamadi' });
  }
  if (data?.order_id !== body.order_id || data?.status !== body.status) {
    return res.status(502).json({ error: 'Beklenmeyen sunucu yaniti' });
  }
  return res.status(200).json({
    order_id: data.order_id,
    status: data.status,
    stock_reserved: Boolean(data.stock_reserved)
  });
};
