'use strict';
// Guard against Vercel Preview inheriting real Production Supabase secrets.
// This package is intentionally unusable in production until a separate cutover review.
const PRODUCTION_REF = 'svyqmmivhpfiuhxnmhny';
function previewEnvironmentReady(env = process.env) {
  if (env.CADDE_DEPLOY_STAGE !== 'preview') return false;
  const expected = String(env.CADDE_EXPECTED_SUPABASE_REF || '').trim();
  if (!/^[a-z0-9]{15,35}$/.test(expected) || expected === PRODUCTION_REF) return false;
  try {
    const url = new URL(env.SUPABASE_URL || '');
    return url.protocol === 'https:' && url.hostname === `${expected}.supabase.co`;
  } catch { return false; }
}
module.exports = { previewEnvironmentReady };
