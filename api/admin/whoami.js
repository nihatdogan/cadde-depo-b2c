'use strict';
const { requireAdmin } = require('../_lib/admin-auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Yalniz GET' });
  const result = await requireAdmin(req);
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  return res.status(200).json({ admin: true, user: result.user });
};
