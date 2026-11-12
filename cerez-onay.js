/* Cadde Depo çerez tercihi. GA4 yalnız analiz onayı (cd_cerez=kabul) sonrası yüklenir. */
(function () {
  var KEY = 'cd_cerez';
  var GA_ID = 'G-4B0J8210EJ';
  var loaded = false;
  var analizBtn = null;
  var panel = null;

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
  function setBarVar(h) {
    var root = document.documentElement;
    if (root && root.style && typeof root.style.setProperty === 'function') root.style.setProperty('--cerez-h', (h || 0) + 'px');
    if (document.body && document.body.style) document.body.style.paddingBottom = h ? (h + 'px') : '';
  }
  function syncBarHeight() {
    var bar = document.getElementById('cerezBar');
    var h = bar && !bar.hidden && typeof bar.getBoundingClientRect === 'function' ? Math.ceil(bar.getBoundingClientRect().height) : 0;
    setBarVar(h);
  }
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', syncBarHeight);
  function closeManage() {
    if (panel) panel.hidden = true;
  }
  function hideBar() {
    var bar = document.getElementById('cerezBar');
    if (bar) bar.hidden = true;
    closeManage();
    setBarVar(0);
  }
  function choose(value) {
    write(value);
    hideBar();
    if (value === 'kabul') loadGa();
    else {
      loaded = false;
      window.__cdGaQueue = [];
      dropGaCookies();
    }
  }
  function setAnaliz(on) {
    if (!analizBtn) return;
    analizBtn.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  function openManage() {
    if (!panel) return;
    setAnaliz(read() === 'kabul');
    panel.hidden = false;
  }
  function button(label, action, className) {
    var el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.className = className || '';
    el.setAttribute('data-cerez', action);
    return el;
  }
  function showBar() {
    var bar = document.getElementById('cerezBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'cerezBar';
      bar.setAttribute('role', 'dialog');
      bar.setAttribute('aria-label', 'Çerez tercihleriniz');
      var card = document.createElement('div');
      card.className = 'cerez-card';
      var copy = document.createElement('div');
      copy.className = 'cerez-copy';
      var kicker = document.createElement('p');
      kicker.className = 'cerez-kicker';
      kicker.textContent = 'cadde depo';
      var title = document.createElement('h2');
      title.textContent = 'Çerez tercihleriniz';
      var text = document.createElement('p');
      text.innerHTML = 'Sepet bilgisi tarayıcınızda saklanır; reklam çerezi kullanmıyoruz. Ziyaretleri ölçmek için Google Analytics çerezleri yalnızca siz kabul ederseniz yüklenir. Ayrıntı: <a href="/gizlilik">Gizlilik ve çerez</a>.';
      copy.appendChild(kicker);
      copy.appendChild(title);
      copy.appendChild(text);
      var actions = document.createElement('div');
      actions.className = 'cerez-actions';
      var red = button('Reddet', 'red', 'cerez-ghost cerez-red');
      var manage = button('Çerezleri yönet', 'yonet', 'cerez-ghost');
      var accept = button('Tümünü kabul et', 'kabul', 'cerez-primary');
      red.addEventListener('click', function () { choose('red'); });
      manage.addEventListener('click', openManage);
      accept.addEventListener('click', function () { choose('kabul'); });
      actions.appendChild(red);
      actions.appendChild(manage);
      actions.appendChild(accept);
      card.appendChild(copy);
      card.appendChild(actions);

      panel = document.createElement('div');
      panel.id = 'cerezYonet';
      panel.hidden = true;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Çerezleri yönet');
      var modal = document.createElement('div');
      modal.className = 'cerez-modal';
      var mh = document.createElement('h2');
      mh.textContent = 'Çerezleri yönet';
      modal.appendChild(mh);
      modal.appendChild(row(
        'Zorunlu çerezler',
        'Sepet ve site tercihleri tarayıcıda tutulur. Reklam içermez ve kapatılamaz.',
        true,
        true
      ));
      analizBtn = makeSwitch(false, false);
      analizBtn.setAttribute('data-cerez', 'analiz');
      modal.appendChild(row(
        'Analiz çerezleri (Google Analytics)',
        'Yalnızca ziyaret ölçümü içindir (G-4B0J8210EJ). Kapalıyken yüklenmez.',
        false,
        false,
        analizBtn
      ));
      var save = button('Seçimi kaydet', 'kaydet', 'cerez-primary');
      save.addEventListener('click', function () {
        choose(analizBtn.getAttribute('aria-checked') === 'true' ? 'kabul' : 'red');
      });
      var saveRow = document.createElement('div');
      saveRow.className = 'cerez-save';
      saveRow.appendChild(save);
      modal.appendChild(saveRow);
      panel.appendChild(modal);
      panel.addEventListener('click', function (e) { if (e.target === panel) closeManage(); });

      bar.appendChild(card);
      bar.appendChild(panel);
      document.body.appendChild(bar);
    }
    bar.hidden = false;
    syncBarHeight();
  }
  function makeSwitch(on, disabled) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'cerez-switch';
    el.setAttribute('role', 'switch');
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    if (disabled) {
      el.disabled = true;
      el.setAttribute('data-cerez', 'zorunlu');
    }
    else el.addEventListener('click', function () {
      el.setAttribute('aria-checked', el.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    });
    return el;
  }
  function row(name, detail, on, disabled, existing) {
    var wrap = document.createElement('div');
    wrap.className = 'cerez-row';
    var info = document.createElement('div');
    var strong = document.createElement('b');
    strong.textContent = name;
    var span = document.createElement('span');
    span.textContent = detail;
    info.appendChild(strong);
    info.appendChild(span);
    wrap.appendChild(info);
    wrap.appendChild(existing || makeSwitch(on, disabled));
    return wrap;
  }
  function prefButton() {
    if (document.getElementById('cerezTercih')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'cerezTercih';
    btn.className = 'cerez-tercih';
    btn.textContent = 'Çerez ayarları';
    btn.addEventListener('click', function () { showBar(); });
    var giz = document.querySelector('footer a[href="/gizlilik"]');
    var slot = (giz && giz.parentElement) ? giz.parentElement : document.querySelector('footer .flinks, footer .foot-bottom span:last-child, footer');
    if (slot && slot.appendChild) slot.appendChild(btn);
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
        '#cerezBar{position:fixed;left:0;right:0;bottom:0;z-index:500;box-sizing:border-box;padding:12px 16px;background:transparent;font-family:Archivo,system-ui,sans-serif;color:#17150F}',
        '#cerezBar[hidden]{display:none}',
        '.drawer{bottom:var(--cerez-h,0px)}',
        '.cerez-card{max-width:1240px;margin:0 auto;background:#fff;border:1px solid rgba(23,21,15,.14);border-radius:16px;box-shadow:0 10px 32px rgba(23,21,15,.16);padding:16px 18px;display:flex;align-items:center;gap:22px}',
        '.cerez-copy{flex:1;min-width:0}',
        '.cerez-kicker{margin:0 0 2px;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}',
        '.cerez-copy h2{margin:0 0 6px;font-size:18px;line-height:1.2;font-weight:800}',
        '.cerez-copy p{margin:0;font-size:14.5px;line-height:1.45}',
        '.cerez-copy a{color:#17150F;font-weight:700;text-decoration:underline}',
        '.cerez-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;flex:0 0 auto}',
        '.cerez-actions button{min-height:44px;min-width:160px;padding:8px 14px;border-radius:12px;box-sizing:border-box;font:700 14px Archivo,system-ui,sans-serif;cursor:pointer;color:#17150F;background:#fff;border:1.5px solid #17150F}',
        '.cerez-actions .cerez-primary{background:#17150F;color:#fff}',
        '#cerezYonet{position:fixed;inset:0;z-index:520;background:rgba(23,21,15,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px}',
        '#cerezYonet[hidden]{display:none}',
        '.cerez-modal{width:min(480px,100%);background:#fff;color:#17150F;border-radius:16px;padding:18px 18px 14px;box-shadow:0 16px 40px rgba(23,21,15,.2);margin-bottom:8px}',
        '.cerez-modal h2{margin:0 0 8px;font-size:18px}',
        '.cerez-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 0;border-top:1px solid rgba(23,21,15,.12)}',
        '.cerez-row b{display:block;font-size:14.5px;margin-bottom:2px}',
        '.cerez-row span{display:block;font-size:13.5px;line-height:1.4;color:#3a352b}',
        '.cerez-switch{width:52px;height:32px;border-radius:999px;border:1.5px solid #17150F;background:#fff;position:relative;flex:0 0 auto;padding:0;cursor:pointer}',
        '.cerez-switch::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#17150F}',
        '.cerez-switch[aria-checked="true"]{background:#17150F}',
        '.cerez-switch[aria-checked="true"]::after{left:23px;background:#fff}',
        '.cerez-switch:disabled{cursor:not-allowed}',
        '.cerez-save{display:flex;justify-content:flex-end;padding-top:8px}',
        '.cerez-save button{min-height:44px;padding:8px 16px;border-radius:12px;border:1.5px solid #17150F;background:#17150F;color:#fff;font:700 14px Archivo,system-ui,sans-serif;cursor:pointer}',
        '.cerez-tercih{background:none;border:0;padding:10px 4px;min-height:44px;margin-left:8px;color:inherit;font:inherit;text-decoration:underline;cursor:pointer}',
        '@media(min-width:900px){#cerezBar{padding-right:200px}}',
        '@media(max-width:720px){#cerezBar{padding:8px} .cerez-card{flex-direction:column;align-items:stretch;gap:10px;padding:12px} .cerez-copy h2{font-size:16px} .cerez-copy p{font-size:13.5px;line-height:1.35} .cerez-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));justify-content:stretch} .cerez-actions button{min-width:0;width:100%;padding:8px 4px;font-size:13px;line-height:1.15} .cerez-modal{margin-bottom:0}}'
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
