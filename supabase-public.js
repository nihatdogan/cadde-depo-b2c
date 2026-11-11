// Public Supabase routing. The publishable key is safe to ship; the service role is not.
// Production is chosen only for the live hostnames. Every other host, including
// *.vercel.app, is preview and must not fall back to the production project.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CaddeDb = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var PROD_URL = 'https://svyqmmivhpfiuhxnmhny.supabase.co';
  var PROD_KEY = 'sb_publishable_Qdwrd6dyEx_rjTHonVNw6w_zjGKtw2B';
  var PREVIEW_URL = 'https://emnacsavgsjkrocpngcj.supabase.co';
  // PREVIEW_PUBLISHABLE_KEY: sb_publishable_... from project emnacsavgsjkrocpngcj.
  // Leave empty until that key is supplied. Never copy PROD_KEY here.
  var PREVIEW_PUBLISHABLE_KEY = '';
  var BLOCKED = 'ön izleme veritabanı ayarlı değil';

  function hostnameOf(input) {
    var h = String(input || '').trim().toLowerCase();
    if (h.indexOf('://') !== -1) {
      try { h = new URL(h).hostname; } catch (e) { h = ''; }
    }
    return h.split(':')[0];
  }

  function previewReady() {
    return PREVIEW_PUBLISHABLE_KEY.indexOf('sb_publishable_') === 0 && PREVIEW_PUBLISHABLE_KEY !== PROD_KEY;
  }

  function resolveSupabase(hostname) {
    var h = hostnameOf(hostname);
    if (h === 'caddedepo.com' || h === 'www.caddedepo.com') {
      return { ok: true, name: 'production', url: PROD_URL, key: PROD_KEY, message: '' };
    }
    if (h.endsWith('.vercel.app') && previewReady()) {
      return { ok: true, name: 'preview', url: PREVIEW_URL, key: PREVIEW_PUBLISHABLE_KEY, message: '' };
    }
    return { ok: false, name: h.endsWith('.vercel.app') ? 'preview' : 'unknown', url: '', key: '', message: BLOCKED };
  }

  function requestHost(req) {
    var headers = req && req.headers || {};
    var raw = headers['x-forwarded-host'] || headers.host || '';
    return hostnameOf(String(raw).split(',')[0]);
  }

  function blockedClient(message) {
    var err = { message: message || BLOCKED };
    function query() {
      var b = {
        select: function () { return b; },
        insert: function () { return b; },
        update: function () { return b; },
        delete: function () { return b; },
        eq: function () { return b; },
        in: function () { return b; },
        lte: function () { return b; },
        neq: function () { return b; },
        order: function () { return b; },
        limit: function () { return b; },
        then: function (ok, fail) {
          return Promise.resolve({ data: null, error: err, count: null }).then(ok, fail);
        }
      };
      return b;
    }
    return {
      blocked: true,
      from: function () { return query(); },
      rpc: function () { return Promise.resolve({ data: null, error: err }); },
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signInWithPassword: function () { return Promise.resolve({ data: null, error: err }); },
        signOut: function () { return Promise.resolve({ error: null }); }
      }
    };
  }

  function showBlockedBanner(message) {
    if (typeof document === 'undefined' || document.getElementById('dbBanner')) return;
    var bar = document.createElement('div');
    bar.id = 'dbBanner';
    bar.setAttribute('role', 'alert');
    bar.textContent = message || BLOCKED;
    bar.style.cssText = 'position:sticky;top:0;z-index:400;background:#C42B1C;color:#fff;text-align:center;font:700 14px/1.4 Archivo,system-ui,sans-serif;padding:10px 16px';
    var parent = document.body || document.documentElement;
    parent.insertBefore(bar, parent.firstChild);
  }

  return {
    PROD_URL: PROD_URL,
    PREVIEW_URL: PREVIEW_URL,
    BLOCKED: BLOCKED,
    resolveSupabase: resolveSupabase,
    requestHost: requestHost,
    blockedClient: blockedClient,
    showBlockedBanner: showBlockedBanner
  };
});
