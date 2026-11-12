// Ön bilgilendirme kutusu ve çerez çubuğu. Ağa çıkmaz, canlı sipariş açmaz.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function findCerez(node, action) {
  if (node.attrs && node.attrs['data-cerez'] === action) return node;
  for (const child of node.children || []) {
    const hit = findCerez(child, action);
    if (hit) return hit;
  }
  return null;
}
function element(tag) {
  const node = {
    tag, id: '', className: '', type: '', textContent: '', innerHTML: '', src: '', async: false,
    hidden: false, style: {}, children: [], attrs: {}, listeners: {},
    setAttribute(name, value){ node.attrs[name] = value; },
    getAttribute(name){ return node.attrs[name]; },
    addEventListener(type, fn){ node.listeners[type] = fn; },
    querySelector(sel){
      const match = String(sel).match(/data-cerez="([^"]+)"/);
      return match ? findCerez(node, match[1]) : null;
    },
    appendChild(child){ node.children.push(child); return child; }
  };
  return node;
}

function bootConsent(pref) {
  const scripts = [];
  const store = new Map();
  if (pref) store.set('cd_cerez', pref);
  const created = [];
  const document = {
    cookie: '',
    readyState: 'complete',
    head: { appendChild(node){ if (node.tag === 'script' && node.src) scripts.push(node.src); if (node.tag === 'style') document.styleNode = node; } },
    body: { style: {}, appendChild(node){ if (node && node.id === 'cerezBar') document.bar = node; }, insertBefore(){} },
    getElementById(id){ return id === 'cerezBar' ? document.bar || null : null; },
    querySelector(){ return { appendChild(){} }; },
    createElement(tag){
      const node = element(tag);
      created.push(node);
      return node;
    },
    addEventListener(){}
  };
  const sandbox = {
    document, localStorage: {
      getItem(k){ return store.has(k) ? store.get(k) : null; },
      setItem(k, v){ store.set(k, String(v)); }
    },
    Date, Array, String
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../cerez-onay.js', import.meta.url), 'utf8'), sandbox, { filename: 'cerez-onay.js' });
  return { scripts, store, document, sandbox };
}

const checks = [];
function check(name, ok){ checks.push([name, !!ok]); if(!ok) console.error('FAIL', name); }

const fresh = bootConsent(null);
check('no choice does not load GA', fresh.scripts.length === 0 && fresh.store.get('cd_cerez') == null);
const kabulBtn = fresh.document.bar && fresh.document.bar.querySelector('[data-cerez="kabul"]');
const redBtn = fresh.document.bar && fresh.document.bar.querySelector('[data-cerez="red"]');
check('banner has equal actions', !!(kabulBtn && redBtn) && kabulBtn.hidden !== true && redBtn.hidden !== true && kabulBtn.textContent && redBtn.textContent);
kabulBtn.listeners.click();
check('accept loads GA', fresh.scripts.some(src => src.includes('googletagmanager.com/gtag/js?id=G-4B0J8210EJ')) && fresh.store.get('cd_cerez') === 'kabul');

const managed = bootConsent(null);
const analiz = managed.document.bar.querySelector('[data-cerez="analiz"]');
const zorunlu = managed.document.bar.querySelector('[data-cerez="zorunlu"]');
check('analytics toggle starts off', analiz && analiz.getAttribute('aria-checked') === 'false');
check('necessary switch stays on and disabled', zorunlu && zorunlu.disabled === true && zorunlu.getAttribute('aria-checked') === 'true');
managed.document.bar.querySelector('[data-cerez="kaydet"]').listeners.click();
check('save without analytics does not load GA', managed.scripts.length === 0 && managed.store.get('cd_cerez') === 'red');
const managedOn = bootConsent(null);
managedOn.document.bar.querySelector('[data-cerez="analiz"]').listeners.click();
check('analytics toggle can be turned on', managedOn.document.bar.querySelector('[data-cerez="analiz"]').getAttribute('aria-checked') === 'true');
managedOn.document.bar.querySelector('[data-cerez="kaydet"]').listeners.click();
check('save with analytics loads GA', managedOn.scripts.some(src => src.includes('googletagmanager.com/gtag/js?id=G-4B0J8210EJ')) && managedOn.store.get('cd_cerez') === 'kabul');

const rejected = bootConsent(null);
rejected.document.bar.querySelector('[data-cerez="red"]').listeners.click();
check('reject does not load GA', rejected.scripts.length === 0 && rejected.store.get('cd_cerez') === 'red');

const remembered = bootConsent('kabul');
check('stored accept loads GA', remembered.scripts.some(src => src.includes('G-4B0J8210EJ')));
const rememberedNo = bootConsent('red');
check('stored reject stays unloaded', rememberedNo.scripts.length === 0);

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
check('order checkbox links both legal pages', html.includes('href="/on-bilgilendirme"') && html.includes('href="/mesafeli-satis-sozlesmesi"') && html.includes("id=\"onbilgiOk\""));
check('pages do not load gtag before consent', !html.includes('googletagmanager.com/gtag/js'));

if (checks.some(([, ok]) => !ok)) {
  console.error(checks);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
console.log(checks.map(([name]) => 'ok  ' + name).join('\n'));
