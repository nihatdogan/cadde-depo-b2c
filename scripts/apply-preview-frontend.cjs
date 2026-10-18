'use strict';
/**
 * Usage: node scripts/apply-preview-frontend.cjs <path-to-PREVIEW-working-copy>
 * Required ENV (all PUBLIC preview values):
 *   CADDE_PREVIEW_SUPABASE_URL, CADDE_PREVIEW_SUPABASE_PUBLISHABLE_KEY,
 *   CADDE_EXPECTED_SUPABASE_REF
 * Operates ONLY on local working copy, checks original Git blob SHA, and creates
 * backups outside the repository (user home directory). NEVER pushes/deploys.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(process.argv[2] || '.');
const PRODUCTION_REF = 'svyqmmivhpfiuhxnmhny';
const previewUrl = String(process.env.CADDE_PREVIEW_SUPABASE_URL || '').trim().replace(/\/$/, '');
const previewKey = String(process.env.CADDE_PREVIEW_SUPABASE_PUBLISHABLE_KEY || '').trim();
const previewRef = String(process.env.CADDE_EXPECTED_SUPABASE_REF || '').trim();
if (!/^[a-z0-9]{15,35}$/.test(previewRef) || previewRef === PRODUCTION_REF ||
    previewUrl !== `https://${previewRef}.supabase.co` ||
    !/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(previewKey)) {
  throw new Error('ISLEM DURDU: Ayrı test Supabase URL/ref/publishable key bilgileri eksik veya hatalı. Production kullanılamaz.');
}
let branch;
try { branch = execFileSync('git', ['-C',repo,'branch','--show-current'], {encoding:'utf8'}).trim(); }
catch { throw new Error('ISLEM DURDU: Hedef, Git çalışma kopyası olmalı.'); }
if (!/^security\/preview-[a-z0-9._-]+$/i.test(branch)) {
  throw new Error(`ISLEM DURDU: Hedef dal '${branch}'. Yalnız security/preview-* dalında çalışır.`);
}


const known = {
  'index.html': '129995984c347584db5ae153954267ce0b85cbe5',
  'admin.html': '62c9e97624289eb086208e1a7cad313c5476a90a',
  'admin-gorsel.html': '70a678f42c03db336b911586ccfde09f89af624e',
  'urun.html': 'fbaf057e83daaacde8f1a6ac999de9aa1e46c434'
};
function blobSha(content) {
  const buf = Buffer.from(content.replace(/\r\n/g, "\n"));
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}
function replaceOne(input, re, replacement, name) {
  const matches = [...input.matchAll(new RegExp(re.source, 'g'))];
  if (matches.length !== 1) throw new Error(`${name}: expected exactly one match; got ${matches.length}`);
  return input.replace(re, replacement);
}

const adminGate = `// ===== AUTH GEÇİDİ — SERVER-VERIFIED =====
let authRenderSeq = 0;
async function boot(){
  const { data:{ session } } = await sb.auth.getSession();
  await paint(session);
}
sb.auth.onAuthStateChange((_event, session) => { void paint(session); });
async function paint(session){
  const seq = ++authRenderSeq;
  $('#bootView').hidden = false;
  $('#panelView').hidden = true;
  $('#loginView').hidden = true;
  if (!session){
    $('#bootView').hidden = true;
    $('#loginView').hidden = false;
    return;
  }
  try {
    const response = await fetch('/api/admin/whoami', {
      method:'GET',
      headers:{ Authorization:'Bearer ' + session.access_token },
      cache:'no-store'
    });
    if (seq !== authRenderSeq) return;
    if (!response.ok){
      $('#bootView').hidden = true;
      $('#loginView').hidden = false;
      $('#loginErr').textContent = 'Yönetici erişimi reddedildi (' + response.status + ').';
      return;
    }
    const result = await response.json();
    if (seq !== authRenderSeq) return;
    if (result.admin !== true) throw Error('Not admin');
    $('#bootView').hidden = true;
    $('#loginView').hidden = true;
    $('#panelView').hidden = false;
    $('#whoami').textContent = result.user.email || '';
    loadSummary();
  } catch(error) {
    if (seq !== authRenderSeq) return;
    $('#bootView').hidden = true;
    $('#loginView').hidden = false;
    $('#loginErr').textContent = 'Yönetici doğrulanamadı; işlem yapılmadı.';
  }
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  $('#loginBtn').disabled = true;
  const email = $('#email').value.trim(), password = $('#password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $('#loginBtn').disabled = false;
  if(error){ $('#loginErr').textContent = 'Giriş başarısız: ' + error.message; }
};
$('#logoutBtn').onclick = ()=> sb.auth.signOut();

// ===== SEKMELER =====`;

const adminGorselGate = `// ===== AUTH — SERVER-VERIFIED =====
let authRenderSeq = 0;
async function boot(){ const { data:{ session } } = await sb.auth.getSession(); await paint(session); }
sb.auth.onAuthStateChange((_event, session) => { void paint(session); });
async function paint(session){
  const seq = ++authRenderSeq;
  $('#bootView').hidden = false;
  $('#toolView').hidden = true;
  $('#loginView').hidden = true;
  if(!session){
    $('#bootView').hidden = true; $('#loginView').hidden = false; return;
  }
  try{
    const resp = await fetch('/api/admin/whoami', {
      headers:{Authorization:'Bearer ' + session.access_token},cache:'no-store'
    });
    if(seq !== authRenderSeq) return;
    if(!resp.ok){
      $('#bootView').hidden = true; $('#loginView').hidden = false;
      $('#loginErr').textContent = 'Yönetici erişimi reddedildi (' + resp.status + ').'; return;
    }
    const result = await resp.json();
    if(seq !== authRenderSeq) return;
    if(result.admin !== true) throw Error('Not admin');
    $('#bootView').hidden = true; $('#loginView').hidden = true;
    $('#toolView').hidden = false; $('#whoami').textContent = result.user.email || '';
  } catch(error){
    if(seq !== authRenderSeq) return;
    $('#bootView').hidden = true; $('#loginView').hidden = false;
    $('#loginErr').textContent = 'Yönetici doğrulanamadı; işlem yapılmadı.';
  }
}
$('#loginForm').onsubmit = async e=>{
  e.preventDefault(); $('#loginErr').textContent=''; $('#loginBtn').disabled=true;
  const { error } = await sb.auth.signInWithPassword({ email:$('#email').value.trim(), password:$('#password').value });
  $('#loginBtn').disabled=false;
  if(error){ $('#loginErr').textContent='Giriş başarısız: '+error.message; }
};
$('#logoutBtn').onclick = ()=> sb.auth.signOut();

// ===== STATE =====`;

const checkout = `let checkoutBusy = false;
document.getElementById('checkoutWa').onclick = async () => {
  if (!cart.length || checkoutBusy) return;
  checkoutBusy = true;
  // Open during direct user action: prevents browser popup blocking after await.
  const pop = window.open('about:blank', '_blank');
  if (pop) pop.opener = null;
  let message;
  const lines = cart.map(p => '• ' + p.nm + ' — ' + fmt(p.now)).join('\\n');
  try {
    const response = await fetch('/api/checkout-request', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        items: cart.map(p => ({product_id:Number(p.id), adet:1}))
      }),
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Talep kaydedilemedi');
    const record = await response.json();
    // Not a final payable amount: shipping depends on delivery address.
    message = 'Merhaba Cadde Depo, sipariş talebi oluşturdum.\\n\\n' + lines +
      '\\n\\nÜRÜNLER ARA TOPLAMI: ' + fmt(record.product_subtotal) +
      '\\nKargo ayrıca hesaplanır. Kesin toplamı ödeme öncesinde bildirir misiniz?' +
      '\\nTalep referansı: ' + record.order_id;
  } catch (e) {
    // Keep WhatsApp working, without falsely claiming successful DB write.
    message = 'Merhaba Cadde Depo, aşağıdaki ürünler için talep oluşturmak istiyorum.\\n\\n' +
      lines + '\\n\\nSipariş sistem kaydı doğrulanamadı. Stok, güncel fiyat ve kargo ücretini teyit eder misiniz?';
  } finally {
    checkoutBusy = false;
  }
  const url = waHref(message);
  if (pop && !pop.closed) pop.location.replace(url);
  else window.location.assign(url);
};

// ----- WhatsApp CTA bağlama -----`;

const input = {};
for (const [name, expected] of Object.entries(known)) {
  const location = path.join(repo, name);
  const contents = fs.readFileSync(location, 'utf8');
  if (blobSha(contents) !== expected) {
    throw new Error(`${name}: kaynak GitHub sürümünden farklı; güncel dosyayı tekrar incele. Değişiklik yapılmadı.`);
  }
  input[name] = contents.replace(/\r\n/g, "\n");
}
function routeToPreview(file, contents) {
  const urlPattern = /const SUPABASE_URL = ["']https:\/\/svyqmmivhpfiuhxnmhny\.supabase\.co["'];/;
  const keyPattern = /const SUPABASE_ANON_KEY = ["'][^"']+["'];/;
  const urlReplaced = replaceOne(contents, urlPattern,
    `const SUPABASE_URL = ${JSON.stringify(previewUrl)};`, `${file}: URL`);
  const output = replaceOne(urlReplaced, keyPattern,
    `const SUPABASE_ANON_KEY = ${JSON.stringify(previewKey)};`, `${file}: key`);
  if (output.includes(PRODUCTION_REF)) throw new Error(`${file}: Production ref kalmış; işlem durdu.`);
  return output;
}
const output = {
  'admin.html': replaceOne(input['admin.html'], /\/\/ ===== AUTH GEÇİDİ =====[\s\S]*?\/\/ ===== SEKMELER =====/, adminGate, 'admin.html'),
  'admin-gorsel.html': replaceOne(input['admin-gorsel.html'], /\/\/ ===== AUTH =====[\s\S]*?\/\/ ===== STATE =====/, adminGorselGate, 'admin-gorsel.html'),
  'index.html': replaceOne(input['index.html'], /document\.getElementById\('checkoutWa'\)\.onclick=async \(\)=>\{[\s\S]*?\n\};\n\s*\/\/ ----- WhatsApp CTA bağlama -----/, checkout, 'index.html'),
  'urun.html': input['urun.html']
};
for (const [name, contents] of Object.entries(output)) output[name] = routeToPreview(name, contents);

const backup = path.join(os.homedir(), 'CaddeDepo-security-local-backup', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(backup, { recursive:true });
for (const name of Object.keys(known)) fs.copyFileSync(path.join(repo, name), path.join(backup, name));
for (const [name, contents] of Object.entries(output)) fs.writeFileSync(path.join(repo, name), contents, 'utf8');
console.log('LOCAL_PATCH_APPLIED — dört HTML yalnız PREVIEW SUPABASE ile güncellendi; Production ve GitHub değişmedi.');
console.log('PREVIEW_REF:', previewRef, 'BRANCH:', branch);
console.log('BACKUP:', backup);
