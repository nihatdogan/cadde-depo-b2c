'use strict';
const { previewEnvironmentReady } = require('./_lib/preview-only');

// Public WhatsApp *request* endpoint. No stock is reserved and no payment is taken.
// Never accept prices, total, status or product name from the browser.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function checkItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) return false;
  let sum = 0;
  for (const p of items) {
    if (!p || !Number.isSafeInteger(p.product_id) || p.product_id <= 0 ||
        !Number.isSafeInteger(p.adet) || p.adet < 1 || p.adet > 10) return false;
    sum += p.adet;
  }
  return sum <= 20;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Yalniz POST' });
  if (!previewEnvironmentReady(process.env)) return res.status(503).json({ error: 'Preview ortami dogrulanamadi' });
  const origin = process.env.CADDE_ALLOWED_ORIGIN;
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key) {
    return res.status(503).json({ error: 'Sunucu hazir degil' });
  }
  let expected;
  try { expected = new URL(origin).origin; } catch { return res.status(503).json({ error: 'Origin ayari gecersiz' }); }
  if (!/^https:\/\//.test(expected)) return res.status(503).json({ error: 'HTTPS gerekir' });
  if (req.headers.origin !== expected) return res.status(403).json({ error: 'Kaynak reddedildi' });
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
    return res.status(415).json({ error: 'JSON gerekli' });
  }
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Gecersiz JSON' }); }
  if (!body || JSON.stringify(body).length > 4096 || !UUID_RE.test(String(body.request_id || '')) || !checkItems(body.items)) {
    return res.status(400).json({ error: 'Gecersiz siparis talebi' });
  }

  let response;
  try {
    response = await fetch(`${base}/rest/v1/rpc/create_checkout_request`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_request_id: body.request_id, p_lines: body.items }),
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return res.status(503).json({ error: 'Siparis servisine su anda ulasilamadi' });
  }
  if (!response.ok) {
    // Do not leak DB error details or table definitions. Client retries with same request_id.
    const status = response.status === 409 ? 409 : (response.status === 400 ? 400 : 502);
    return res.status(status).json({ error: 'Siparis talebi kaydedilemedi' });
  }
  let data;
  try { data = await response.json(); } catch { return res.status(502).json({ error: 'Sunucu yaniti okunamadi' }); }
  if (!data?.order_id || !Number.isFinite(Number(data.product_subtotal))) {
    return res.status(502).json({ error: 'Eksik sunucu yaniti' });
  }
  return res.status(201).json({
    order_id: data.order_id,
    product_subtotal: Number(data.product_subtotal),
    status: 'whatsapp_bekliyor',
    stock_reserved: false,
    shipping_separate: true
  });
}
module.exports = handler;
module.exports.checkItems = checkItems;
