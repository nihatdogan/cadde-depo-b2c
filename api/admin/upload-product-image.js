'use strict';
// Preview replacement of original API: admin role is mandatory, not merely an open session.
// This file must NOT be deployed before preview tests and env isolation.
const { randomUUID } = require('node:crypto');
const { requireAdmin } = require('../_lib/admin-auth');

const BUCKET = 'urunler';
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_BODY = MAX_BYTES + 128 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body));
  return new Promise((resolve, reject) => {
    const parts = [];
    let length = 0;
    req.on('data', chunk => {
      length += chunk.length;
      if (length > MAX_BODY) {
        reject(new Error('Payload too large'));
        req.destroy();
      } else parts.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

function isExpectedImage(bytes, type) {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (type === 'image/webp') return bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Yalniz POST' });
  const auth = await requireAdmin(req);
  if (auth.status !== 200) return res.status(auth.status).json({ error: auth.error });

  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return res.status(503).json({ error: 'Sunucu yapilandirmasi eksik' });
  try {
    const contentType = String(req.headers['content-type'] || '');
    if (!/^multipart\/form-data\s*;/i.test(contentType)) {
      return res.status(415).json({ error: 'multipart/form-data gerekli' });
    }
    const body = await readRawBody(req);
    if (body.length > MAX_BODY) return res.status(413).json({ error: 'Dosya cok buyuk' });
    const webReq = new Request('http://upload.local', {
      method: 'POST', headers: { 'content-type': contentType }, body
    });
    const form = await webReq.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return res.status(400).json({ error: 'Dosya gerekli' });
    if (!EXT[file.type] || file.size <= 0 || file.size > MAX_BYTES) {
      return res.status(400).json({ error: 'Gecersiz dosya turu veya boyutu' });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!isExpectedImage(bytes, file.type)) return res.status(400).json({ error: 'Dosya icerigi gecersiz' });
    const path = `${randomUUID()}.${EXT[file.type]}`;
    const up = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': file.type,
        'x-upsert': 'false',
        'cache-control': 'public, max-age=3600'
      },
      body: bytes,
      signal: AbortSignal.timeout(10000)
    });
    if (!up.ok) return res.status(502).json({ error: 'Gorsel yuklenemedi' });
    return res.status(200).json({
      url: `${base}/storage/v1/object/public/${BUCKET}/${path}`, path
    });
  } catch (err) {
    return res.status(err?.message === 'Payload too large' ? 413 : 500)
      .json({ error: 'Gorsel yukleme islemi tamamlanamadi' });
  }
};
