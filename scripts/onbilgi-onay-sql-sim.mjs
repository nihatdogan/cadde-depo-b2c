// Ön bilgilendirme sürümü: SQL metni, cayma formu ve yerel Postgres.
// Üretim veritabanına bağlanmaz ve migration uygulamaz.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const checks = [];
function check(name, ok) {
  checks.push([name, !!ok]);
  if (!ok) console.error('FAIL', name);
}

const migration = readFileSync(new URL('../supabase/siparis-onbilgi-surum-kontrol.sql', import.meta.url), 'utf8');
check('migration header says applied on 2026-11-12', migration.includes('UYGULANDI. Canlıya 2026-11-12 tarihinde uygulandı (migration: siparis_onbilgi_surum_kontrol, version 20261111211652).') && !migration.includes('UYGULANMADI'));
check('accepted versions include live and new text', migration.includes("NOT IN ('2026-11-11b', '2026-11-12')"));
check('timestamp is server now()', migration.includes('v_onbilgi_zaman := now()'));
check('client timestamp is not stored', !migration.includes("v_onbilgi->>'onbilgi_zamani'"));
check('signature stays three jsonb args', migration.includes('siparis_olustur(items jsonb, musteri jsonb DEFAULT NULL, p_onbilgi jsonb DEFAULT NULL)'));
check('security definer and search_path', migration.includes('SECURITY DEFINER') && migration.includes('SET search_path = pg_catalog, public'));
check('public execute revoked', migration.includes('REVOKE ALL ON FUNCTION public.siparis_olustur(jsonb, jsonb, jsonb) FROM PUBLIC'));
check('existing roles keep execute', migration.includes('GRANT EXECUTE ON FUNCTION public.siparis_olustur(jsonb, jsonb, jsonb) TO postgres, anon, authenticated, service_role'));
check('postgrest reload kept', migration.includes("NOTIFY pgrst, 'reload schema'"));

const appliedHeaders = ['siparis-kargo-tutari.sql', 'siparis-onbilgi-onay.sql'];
for (const name of appliedHeaders) {
  const text = readFileSync(new URL('../supabase/' + name, import.meta.url), 'utf8');
  check(name + ' header says applied on 2026-11-11', text.includes('UYGULANDI. Canlıya 2026-11-11 tarihinde uygulandı.') && !text.includes('UYGULANMADI'));
}

const returnSentence = 'Cayma halinde İstanbul’daki adresten ürün, satıcının kendi aracıyla teslim alınır. Diğer illerde iade, anlaşmalı kargo ile yapılır. Her iki durumda da iade masrafı satıcıya aittir; alıcıdan ücret alınmaz.';
for (const name of ['iade-politikasi.html', 'mesafeli-satis-sozlesmesi.html', 'on-bilgilendirme.html']) {
  const html = readFileSync(new URL('../' + name, import.meta.url), 'utf8');
  check(name + ' return text', html.includes(returnSentence));
  check(name + ' version label', html.includes('Metin sürümü: 2026-11-14'));
  check(name + ' hides placeholder rows', !html.includes('resmi kayıt tamamlanınca eklenecek'));
  check(name + ' no nationwide own-vehicle claim', !html.includes('kendi araçlarıyla alıcının adresinden'));
}
const kvkk = readFileSync(new URL('../kvkk.html', import.meta.url), 'utf8');
check('kvkk names Istanbul own vehicle and other provinces cargo', kvkk.includes('İstanbul’daki adresten ürün satıcının kendi aracıyla alınır') && kvkk.includes('Diğer illerde iade anlaşmalı kargo ile yapıldığından'));
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
check('client version constant', index.includes("const ONBILGI_SURUM = '2026-11-14'"));
const shipSql = readFileSync(new URL('../supabase/siparis-istanbul-kargo.sql', import.meta.url), 'utf8');
check('istanbul shipping sql header says applied on 2026-11-14', shipSql.includes('UYGULANDI. Canlıya 2026-11-14 tarihinde uygulandı (migration: siparis_istanbul_kargo, proje: svyqmmivhpfiuhxnmhny). Yetkiler değişmedi.') && !shipSql.includes('UYGULANMADI'));
check('istanbul shipping sql keeps both older consent versions', shipSql.includes("NOT IN ('2026-11-11b', '2026-11-12', '2026-11-14')"));
check('zero fee is not treated as free outside Istanbul', shipSql.includes('r.kargo_ucreti IS NULL OR r.kargo_ucreti <= 0'));

function sellerPage(seller) {
  const html = readFileSync(new URL('../iade-politikasi.html', import.meta.url), 'utf8');
  const form = html.match(/<pre id="caymaForm"[\s\S]*?<\/pre>/)[0].replace(/<[^>]+>/g, '');
  const box = { children: [], appendChild(child) { this.children.push(child); } };
  const pre = { textContent: form };
  const document = {
    querySelectorAll() { return []; },
    getElementById(id) {
      if (id === 'caymaForm') return pre;
      if (id === 'satici-kimlik') return box;
      return null;
    },
    createElement() {
      return { textContent: '', appendChild(child) { this.children = this.children || []; this.children.push(child); } };
    }
  };
  const sandbox = { window: { CD_SELLER: seller }, document };
  sandbox.window.document = document;
  // legal.js expects a browser window global via the IIFE's free identifiers: document, window.
  const src = readFileSync(new URL('../legal.js', import.meta.url), 'utf8');
  const fn = new Function('window', 'document', src);
  fn(sandbox.window, document);
  const labels = (box.children[0]?.children || []).filter((_, i) => i % 2 === 0).map(n => n.textContent);
  return { form: pre.textContent, labels };
}
const hidden = sellerPage({
  unvan: 'CADDE DEPO - Nihat Doğan', marka: 'Cadde Depo', email: 'caddedepo.com@gmail.com',
  whatsapp: '905409077070', siteLabel: 'caddedepo.com', instagram: '@caddedepocom',
  mersis: '', vergiDairesi: '', vergiNo: '', adres: '', telefon: '[TELEFON]', kep: '[KEP ADRESİ]'
});
check('empty seller fields stay off the form', !/Adres:|Vergi|MERSİS/.test(hidden.form) && hidden.form.includes('CADDE DEPO - Nihat Doğan') && hidden.form.includes('caddedepo.com@gmail.com'));
check('name and contact stay on the card', hidden.labels.includes('Unvan') && hidden.labels.includes('E-posta') && hidden.labels.includes('WhatsApp') && !hidden.labels.includes('Adres') && !hidden.labels.includes('MERSİS no'));
const shown = sellerPage({
  unvan: 'CADDE DEPO - Nihat Doğan', marka: 'Cadde Depo', email: 'a@b.c', whatsapp: '905409077070',
  siteLabel: 'caddedepo.com', instagram: '@x',
  mersis: '0123456789000016', vergiDairesi: 'Bahçelievler', vergiNo: '1234567890', adres: 'Örnek Mah. No 1',
  telefon: '', kep: 'resmi kayıt tamamlanınca eklenecek'
});
check('real values reappear', shown.form.includes('Adres: Örnek Mah. No 1') && shown.form.includes('MERSİS no: 0123456789000016') && shown.labels.includes('Vergi no') && !shown.labels.includes('KEP'));

function findBin(name) {
  const found = spawnSync('bash', ['-lc', `ls /usr/lib/postgresql/*/bin/${name} 2>/dev/null | head -1`], { encoding: 'utf8' });
  const path = (found.stdout || '').trim();
  return path || '';
}

const initdb = findBin('initdb');
const pgCtl = findBin('pg_ctl');
const psql = findBin('psql');
if (!initdb || !pgCtl || !psql) {
  console.error('FAIL local postgres binaries missing');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'cd-onbilgi-'));
const data = join(dir, 'data');
const sock = join(dir, 'sock');
function run(bin, args, input) {
  const res = spawnSync(bin, args, { encoding: 'utf8', input, timeout: 20000 });
  if (res.status !== 0) {
    throw new Error(bin + ' failed: ' + (res.stderr || res.stdout || res.error || '').toString().slice(0, 800));
  }
  return res.stdout;
}
try {
  run(initdb, ['-D', data, '-U', 'postgres', '--auth=trust', '--no-sync']);
  mkdirSync(sock);
  run(pgCtl, ['-D', data, '-o', `-k ${sock} -p 54329`, '-w', 'start']);
  const psqlArgs = ['-h', sock, '-p', '54329', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  const setup = `
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE TABLE public.products (
      id bigint PRIMARY KEY,
      ad text NOT NULL,
      outlet_fiyat numeric(12,2) NOT NULL,
      kargo_ucreti numeric,
      aktif boolean NOT NULL DEFAULT true,
      stok int NOT NULL
    );
    CREATE TABLE public.orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      toplam numeric(12,2) NOT NULL,
      durum text NOT NULL DEFAULT 'whatsapp_bekliyor',
      kanal text NOT NULL DEFAULT 'whatsapp',
      created_at timestamptz NOT NULL DEFAULT now(),
      istek_id uuid,
      istek_yanit jsonb
    );
    CREATE UNIQUE INDEX orders_istek_id_key ON public.orders (istek_id) WHERE istek_id IS NOT NULL;
    CREATE TABLE public.order_items (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
      product_id bigint,
      ad text NOT NULL,
      fiyat numeric(12,2) NOT NULL,
      adet int NOT NULL
    );
    CREATE TABLE public.siparis_musteri (
      order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
      ad text NOT NULL,
      telefon text NOT NULL,
      aydinlatma_surum text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.siparis_ayar (
      anahtar text PRIMARY KEY,
      deger jsonb NOT NULL
    );
    INSERT INTO public.siparis_ayar VALUES ('musteri_zorunlu', 'false'::jsonb);
    INSERT INTO public.products (id, ad, outlet_fiyat, kargo_ucreti, aktif, stok)
    VALUES (101, 'Kiwi örnek', 2490, 0, true, 8);
  `;
  writeFileSync(join(dir, 'setup.sql'), setup);
  run(psql, [...psqlArgs, '-f', join(dir, 'setup.sql')]);
  run(psql, [...psqlArgs, '-f', new URL('../supabase/siparis-onbilgi-surum-kontrol.sql', import.meta.url).pathname]);
  run(psql, [...psqlArgs, '-f', new URL('../supabase/siparis-istanbul-kargo.sql', import.meta.url).pathname]);

  function call(sql) {
    const res = spawnSync(psql, [...psqlArgs, '-c', sql], { encoding: 'utf8', timeout: 20000 });
    return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
  }
  const missing = call(`SELECT public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"11111111-1111-4111-8111-111111111111","ad":"Örnek Müşteri","telefon":"905320000000"}'::jsonb);`);
  check('missing consent rejected', missing.code !== 0 && missing.out.includes('Ön bilgilendirme onayı gerekli'));
  const bad = call(`SELECT public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"22222222-2222-4222-8222-222222222222","ad":"Örnek Müşteri","telefon":"905320000000","onbilgi_surum":"1999-01-01","onbilgi_zamani":"2000-01-01T00:00:00Z"}'::jsonb);`);
  check('unknown version rejected', bad.code !== 0 && bad.out.includes('Ön bilgilendirme onayı gerekli'));
  const oldClient = call(`SELECT (public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"33333333-3333-4333-8333-333333333333","ad":"Örnek Müşteri","telefon":"05320000000","onbilgi_surum":"2026-11-11b","onbilgi_zamani":"2000-01-01T00:00:00Z"}'::jsonb)->>'order_id');`);
  check('live client version accepted', oldClient.code === 0 && /[0-9a-f-]{36}/.test(oldClient.out));
  const stamp = call(`SELECT onbilgi_onay_surum || '|' || (onbilgi_onay_zamani > now() - interval '2 minutes' AND onbilgi_onay_zamani > timestamptz '2020-01-01')::text FROM public.orders WHERE istek_id = '33333333-3333-4333-8333-333333333333';`);
  check('stored version kept and time is server now', stamp.code === 0 && stamp.out.includes('2026-11-11b|true'));
  const again = call(`SELECT (public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"33333333-3333-4333-8333-333333333333","ad":"Örnek Müşteri","telefon":"905320000000"}'::jsonb)->>'tekrar');`);
  check('idempotent retry without consent returns the first order', again.code === 0 && again.out.includes('true'));
  const count = call(`SELECT count(*) FROM public.orders WHERE istek_id = '33333333-3333-4333-8333-333333333333';`);
  check('idempotent retry does not insert', count.out.includes('1'));
  const fresh = call(`SELECT (public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"44444444-4444-4444-8444-444444444444","ad":"Örnek Müşteri","telefon":"905320000000"}'::jsonb, '{"onbilgi_surum":"2026-11-12"}'::jsonb)->>'order_id');`);
  check('new version via p_onbilgi accepted', fresh.code === 0 && /[0-9a-f-]{36}/.test(fresh.out));
  const freshStamp = call(`SELECT onbilgi_onay_surum FROM public.orders WHERE istek_id = '44444444-4444-4444-8444-444444444444';`);
  check('new version string stored', freshStamp.out.includes('2026-11-12'));
  const zero = call(`SELECT (istek_yanit->>'kargo_durumu') || '|' || coalesce(istek_yanit->>'kargo_tutari','null') || '|' || (istek_yanit->>'toplam') FROM public.orders WHERE istek_id = '33333333-3333-4333-8333-333333333333';`);
  check('stored zero fee without city is not free shipping', /sipariste_bildirilir\|null\|2490(\.00)?/.test(zero.out));
  const ist = call(`SELECT (public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"77777777-7777-4777-8777-777777777777","ad":"Örnek Müşteri","telefon":"905320000000","onbilgi_surum":"2026-11-14","teslimat_ili":"İstanbul"}'::jsonb)->>'kargo_durumu') || '|' || (public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"77777777-7777-4777-8777-777777777777","ad":"Örnek Müşteri","telefon":"905320000000","onbilgi_surum":"2026-11-14","teslimat_ili":"İstanbul"}'::jsonb)->>'kargo_tutari') || '|' || (public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"77777777-7777-4777-8777-777777777777","ad":"Örnek Müşteri","telefon":"905320000000","onbilgi_surum":"2026-11-14","teslimat_ili":"İstanbul"}'::jsonb)->>'toplam');`);
  check('Istanbul delivery is free even when product fee is zero', ist.out.includes('istanbul_ici|0|2490') || ist.out.includes('istanbul_ici|0.00|2490'));
  call(`UPDATE public.products SET kargo_ucreti = 150 WHERE id = 101;`);
  const dis = call(`SELECT (public.siparis_olustur('[{"product_id":101,"adet":2}]'::jsonb, '{"istek_id":"88888888-8888-4888-8888-888888888888","ad":"Örnek Müşteri","telefon":"905320000000","onbilgi_surum":"2026-11-14","teslimat_ili":"İstanbul dışı"}'::jsonb)->>'kargo_durumu') || '|' || (public.siparis_olustur('[{"product_id":101,"adet":2}]'::jsonb, '{"istek_id":"88888888-8888-4888-8888-888888888888"}'::jsonb)->>'kargo_tutari') || '|' || (public.siparis_olustur('[{"product_id":101,"adet":2}]'::jsonb, '{"istek_id":"88888888-8888-4888-8888-888888888888"}'::jsonb)->>'toplam');`);
  check('outside Istanbul sums the product fee and ignores the client', dis.out.includes('dahil|300|5280') || dis.out.includes('dahil|300.00|5280'));
  const istPaid = call(`SELECT (public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"99999999-9999-4999-8999-999999999999","ad":"Örnek Müşteri","telefon":"905320000000","onbilgi_surum":"2026-11-14","teslimat_ili":"İstanbul"}'::jsonb)->>'kargo_durumu') || '|' || (public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"99999999-9999-4999-8999-999999999999"}'::jsonb)->>'toplam');`);
  check('Istanbul stays free after a product fee is entered', istPaid.out.includes('istanbul_ici|2490'));
  const override = call(`SELECT public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"55555555-5555-4555-8555-555555555555","ad":"Örnek Müşteri","telefon":"905320000000","onbilgi_surum":"2026-11-11b"}'::jsonb, '{"onbilgi_surum":"nope"}'::jsonb);`);
  check('p_onbilgi version wins and a bad one is rejected', override.code !== 0 && override.out.includes('Ön bilgilendirme onayı gerekli'));
  call(`INSERT INTO public.orders (toplam, durum, kanal, created_at) SELECT 1, 'whatsapp_bekliyor', 'whatsapp', now() FROM generate_series(1, 20);`);
  const blocked = call(`SELECT public.siparis_olustur('[{"product_id":101,"adet":1}]'::jsonb, '{"istek_id":"66666666-6666-4666-8666-666666666666","ad":"Örnek Müşteri","telefon":"905320000000","onbilgi_surum":"2026-11-12"}'::jsonb);`);
  check('circuit breaker unchanged', blocked.code !== 0 && blocked.out.includes('Sipariş kaydı geçici olarak sınırlandı'));
} finally {
  if (pgCtl) spawnSync(pgCtl, ['-D', data, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
}

if (checks.some(([, ok]) => !ok)) {
  console.error(checks.filter(([, ok]) => !ok).map(([name]) => name).join('\n'));
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
console.log(checks.map(([name]) => 'ok  ' + name).join('\n'));
