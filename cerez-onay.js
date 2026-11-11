/* Cadde Depo çerez tercihi. GA4 yalnız "Kabul et" sonrası yüklenir. */
(function () {
  var KEY = 'cd_cerez';
  var GA_ID = 'G-4B0J8210EJ';
  var loaded = false;

  function read() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function write(value) {
    try { localStorage.setItem(KEY, value); } catch (e) {}
  }
  function dropGaCookies() {
    var parts = String(document.cookie || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      var name = parts[i].split('=')[0].trim();
      if (name.indexOf('_ga') === 0) {
        document.cookie = name + '=; Max-Age=0; path=/';
      }
    }
  }
  function flushQueue() {
    var q = window.__cdGaQueue || [];
    window.__cdGaQueue = [];
    for (var i = 0; i < q.length; i++) {
      window.gtag.apply(null, q[i]);
    }
  }
  function loadGa() {
    if (loaded || read() !== 'kabul') return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    flushQueue();
  }
  function hideBar() {
    var bar = document.getElementById('cerezBar');
    if (bar) bar.hidden = true;
    if (document.body) document.body.style.paddingBottom = '';
    setBarVar(0);
  }
  // Çubuk açıkken sepet çekmecesi çubuğun üstünde biter; sipariş düğmesi örtülmez.
  function syncBarHeight() {
    var bar = document.getElementById('cerezBar');
    var h = bar && !bar.hidden && typeof bar.getBoundingClientRect === 'function' ? Math.ceil(bar.getBoundingClientRect().height) : 0;
    setBarVar(h);
  }
  function setBarVar(h) {
    var root = document.documentElement;
    if (root && root.style && typeof root.style.setProperty === 'function') root.style.setProperty('--cerez-h', h + 'px');
  }
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', syncBarHeight);
  function choose(value) {
    write(value);
    hideBar();
    if (value === 'kabul') loadGa();
    else {
      window.__cdGaQueue = [];
      dropGaCookies();
    }
  }
  function showBar() {
    var bar = document.getElementById('cerezBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'cerezBar';
      bar.setAttribute('role', 'dialog');
      bar.setAttribute('aria-label', 'Çerez tercihi');
      var text = document.createElement('p');
      text.innerHTML = 'Ziyaret ölçümü için çerez kullanabiliriz. Ayrıntı: <a href="/gizlilik">Gizlilik ve çerez</a>.';
      var actions = document.createElement('div');
      actions.className = 'cerez-btns';
      ['red', 'kabul'].forEach(function (action) {
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = action === 'kabul' ? 'Kabul et' : 'Reddet';
        button.setAttribute('data-cerez', action);
        button.addEventListener('click', function () { choose(action); });
        actions.appendChild(button);
      });
      bar.appendChild(text);
      bar.appendChild(actions);
      document.body.appendChild(bar);
    }
    bar.hidden = false;
    document.body.style.paddingBottom = '7.5rem';
    syncBarHeight();
  }
  function prefButton() {
    if (document.getElementById('cerezTercih')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'cerezTercih';
    btn.className = 'cerez-tercih';
    btn.textContent = 'Çerez tercihi';
    btn.addEventListener('click', function () { showBar(); });
    var slot = document.querySelector('footer .flinks, footer .foot-bottom span:last-child, footer');
    if (slot) slot.appendChild(btn);
  }
  window.cdGaEvent = function () {
    var args = Array.prototype.slice.call(arguments);
    if (read() === 'kabul') {
      loadGa();
      if (typeof window.gtag === 'function') window.gtag.apply(null, args);
      return;
    }
    if (read() !== 'red') window.__cdGaQueue = (window.__cdGaQueue || []).concat([args]);
  };
  window.cdCerezTercih = showBar;

  function boot() {
    if (!document.getElementById('cerezStyle')) {
      var style = document.createElement('style');
      style.id = 'cerezStyle';
      style.textContent = [
        '#cerezBar{position:fixed;left:0;right:0;bottom:0;z-index:500;box-sizing:border-box;max-width:100%;background:#F4F0E6;color:#17150F;border-top:1px solid rgba(23,21,15,.16);padding:12px 14px;display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-family:Archivo,system-ui,sans-serif}',
        '#cerezBar[hidden]{display:none}',
        '.drawer{bottom:var(--cerez-h,0px)}',
        '#cerezBar p{flex:1 1 16rem;margin:0;font-size:13.5px;line-height:1.4;min-width:0}',
        '#cerezBar a{color:inherit}',
        '.cerez-btns{display:flex;flex-wrap:wrap;gap:8px;flex:1 1 100%;max-width:100%}',
        '.cerez-btns button{flex:1 1 8rem;min-height:44px;box-sizing:border-box;border:1.5px solid #17150F;background:#fff;color:#17150F;border-radius:6px;font:700 14px Archivo,system-ui,sans-serif;cursor:pointer}',
        '.cerez-tercih{background:none;border:0;padding:0;margin-left:8px;color:inherit;font:inherit;text-decoration:underline;cursor:pointer}'
      ].join('');
      document.head.appendChild(style);
    }
    prefButton();
    if (read() === 'kabul') loadGa();
    else if (read() !== 'red') showBar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
