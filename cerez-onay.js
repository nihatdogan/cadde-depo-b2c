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
    var h = 0;
    if (bar && !bar.hidden && typeof bar.getBoundingClientRect === 'function') {
      var rect = bar.getBoundingClientRect();
      h = (window.innerHeight) ? Math.max(0, Math.ceil(window.innerHeight - rect.top)) : Math.ceil(rect.height);
    }
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
      text.textContent = 'Cadde Depo olarak, müşterilerimize güvenilir ve kişiselleştirilmiş bir alışveriş deneyimi sunmak amacıyla çerez kullanıyoruz. Çerezler, size daha iyi ve özel bir deneyim sunmak için kullanılır. Reddet seçeneğine tıklamanız durumunda, tercih alanlarınıza yönelik kişiselleştirilmiş deneyimler sunamayacağımızı belirtmek isteriz.';
      var more = document.createElement('a');
      more.className = 'cerez-more';
      more.href = '/gizlilik';
      more.textContent = 'Gizlilik ve çerez';
      copy.appendChild(kicker);
      copy.appendChild(title);
      copy.appendChild(text);
      copy.appendChild(more);
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
        '#cerezBar{position:fixed;left:0;right:0;bottom:0;z-index:500;box-sizing:border-box;padding:10px 12px;background:transparent;font-family:Archivo,system-ui,sans-serif;color:#17150F;display:flex;justify-content:flex-start;pointer-events:none}',
        '#cerezBar[hidden]{display:none}',
        '.drawer{bottom:var(--cerez-h,0px)}',
        '.cerez-card{pointer-events:auto;width:min(620px,100%);background:#fff;border:1px solid rgba(23,21,15,.14);border-radius:12px;box-shadow:0 8px 24px rgba(23,21,15,.16);padding:10px 12px;display:flex;flex-direction:column;align-items:stretch;gap:8px}',
        '.cerez-copy{min-width:0}',
        '.cerez-kicker{margin:0;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}',
        '.cerez-copy h2{margin:0 0 4px;font-size:14px;line-height:1.2;font-weight:800}',
        '.cerez-copy p{margin:0;font-size:13px;line-height:1.35}',
        '.cerez-more{display:inline-block;margin-top:4px;font-size:12px;font-weight:700;color:#17150F;text-decoration:underline}',
        '.cerez-actions{display:flex;gap:6px}',
        '.cerez-actions button{flex:1 1 0;min-height:44px;min-width:0;padding:6px 8px;border-radius:10px;box-sizing:border-box;font:700 12px Archivo,system-ui,sans-serif;cursor:pointer;color:#17150F;background:#fff;border:1.5px solid #17150F}',
        '.cerez-actions .cerez-primary{background:#17150F;color:#fff}',
        '#cerezYonet{position:fixed;inset:0;z-index:520;background:rgba(23,21,15,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px;pointer-events:auto}',
        '#cerezYonet[hidden]{display:none}',
        '.cerez-modal{width:min(420px,100%);background:#fff;color:#17150F;border-radius:12px;padding:12px 12px 10px;box-shadow:0 16px 40px rgba(23,21,15,.2)}',
        '.cerez-modal h2{margin:0 0 6px;font-size:15px}',
        '.cerez-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid rgba(23,21,15,.12)}',
        '.cerez-row b{display:block;font-size:13px;margin-bottom:2px}',
        '.cerez-row span{display:block;font-size:12px;line-height:1.35;color:#3a352b}',
        '.cerez-switch{width:48px;height:28px;border-radius:999px;border:1.5px solid #17150F;background:#fff;position:relative;flex:0 0 auto;padding:0;cursor:pointer}',
        '.cerez-switch::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#17150F}',
        '.cerez-switch[aria-checked="true"]{background:#17150F}',
        '.cerez-switch[aria-checked="true"]::after{left:22px;background:#fff}',
        '.cerez-switch:disabled{cursor:not-allowed}',
        '.cerez-save{display:flex;justify-content:flex-end;padding-top:6px}',
        '.cerez-save button{min-height:44px;padding:8px 14px;border-radius:10px;border:1.5px solid #17150F;background:#17150F;color:#fff;font:700 13px Archivo,system-ui,sans-serif;cursor:pointer}',
        '.cerez-tercih{background:none;border:0;padding:10px 4px;min-height:44px;margin-left:8px;color:inherit;font:inherit;text-decoration:underline;cursor:pointer}',
        '@media(max-width:720px){#cerezBar{bottom:68px;padding:6px} .cerez-card{padding:8px;gap:6px} .cerez-copy h2{font-size:13px} .cerez-copy p,.cerez-more{font-size:12px;line-height:1.3} .cerez-actions button{font-size:12px;padding:6px 4px;line-height:1.15} .cerez-modal{margin-bottom:68px}}'
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
