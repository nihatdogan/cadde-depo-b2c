// supabase/firsat-kulubu.sql dosyasını geçici bir yerel PostgreSQL'de çalıştırır. Canlıya dokunmaz.
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const checks = []; const check = (ad, ok) => checks.push([ad, !!ok]);
function findBin(name) { return (spawnSync('bash', ['-lc', `ls /usr/lib/postgresql/*/bin/${name} 2>/dev/null | head -1`], { encoding: 'utf8' }).stdout || '').trim(); }
const initdb = findBin('initdb'), pgCtl = findBin('pg_ctl'), psql = findBin('psql');
if (!initdb || !pgCtl || !psql) { console.error('FAIL local postgres binaries missing'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'cd-kulup-')); const data = join(dir, 'data'); const sock = join(dir, 'sock'); const PORT = '54331';
function run(bin, args, input) { const r = spawnSync(bin, args, { encoding: 'utf8', input, timeout: 30000 }); if (r.status !== 0) throw new Error(bin + ' failed: ' + (r.stderr || r.stdout || r.error || '').toString().slice(0, 800)); return r.stdout; }
const SQL = readFileSync(new URL('../supabase/firsat-kulubu.sql', import.meta.url), 'utf8');
try {
  run(initdb, ['-D', data, '-U', 'postgres', '--auth=trust', '--no-sync']); mkdirSync(sock);
  run(pgCtl, ['-D', data, '-o', `-k ${sock} -p ${PORT}`, '-w', 'start']);
  const args = ['-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
  const q = (sql) => { const r = spawnSync(psql, [...args, '-c', sql], { encoding: 'utf8', timeout: 20000 }); return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; };
  const as = (rol, sql) => q(`set role ${rol}; ${sql}`);
  q('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  run(psql, [...args, '-f', '-'], SQL); run(psql, [...args, '-f', '-'], SQL);
  check('dosya iki kez hatasız çalışır', true);
  const K = (n) => String(n).padStart(64, 'a');
  const kayit = (email, kat = "array['elektronik']", anahtar = K(1), rol = 'service_role') => as(rol, `select public.firsat_kulubu_on_kayit('${email}', ${kat}, 'firsat-kulubu-2026-11-12-v2', '${anahtar}')`);
  const say = () => Number(q('select count(*) from public.club_signup_requests').out);

  // Yetki
  for (const rol of ['anon', 'authenticated']) {
    check(rol + ' fonksiyonu çağıramaz', kayit('x@example.com', undefined, K(9), rol).code !== 0);
    check(rol + ' talepleri okuyamaz', as(rol, 'select count(*) from public.club_signup_requests').code !== 0);
    check(rol + ' doğrudan yazamaz', as(rol, "insert into public.club_signup_requests(email,categories,marketing_consent,consent_version,privacy_notice_version) values('y@example.com',array['telefon'],true,'v','v')").code !== 0);
    check(rol + ' hız tablosunu okuyamaz', as(rol, 'select count(*) from public.club_signup_limits').code !== 0);
  }
  check('hiç RLS politikası yok', q("select count(*) from pg_policies where tablename like 'club_signup_%'").out === '0');
  check('iki tabloda RLS açık', q("select count(*) from pg_class where relname like 'club_signup_%' and relkind='r' and relrowsecurity").out === '2');
  check('fonksiyon SECURITY DEFINER değil', q("select prosecdef from pg_proc where proname='firsat_kulubu_on_kayit'").out === 'f');

  // Kayıt ve tekrar
  let r = kayit('ornek@example.com', "array['elektronik','mobilya']");
  check('yeni kayıt ok', r.out === 'ok' && say() === 1);
  const ilk = q("select status||'|'||marketing_consent||'|'||email_verified||'|'||iys_checked||'|'||(consented_at between now()-interval '1 minute' and now())||'|'||consent_version from public.club_signup_requests").out;
  check('beklemede, doğrulanmamış, onay zamanı sunucudan', ilk === 'pending_review|true|false|false|true|firsat-kulubu-2026-11-12-v2');
  r = kayit('ornek@example.com', "array['telefon']", K(2));
  check('aynı e-posta: sonuç yine ok, kayıt artmaz', r.out === 'ok' && say() === 1);
  check('aynı e-posta: mevcut tercihler değişmez', q("select array_to_string(categories,',') from public.club_signup_requests").out === 'elektronik,mobilya');
  check('büyük harfli e-posta küçültülür ve aynı kayıt sayılır', kayit('  ORNEK@Example.com ', undefined, K(3)).out === 'ok' && say() === 1);

  // Geçersiz veri tabloya da giremez
  for (const [ad, email, kat] of [['çift @', 'a@b@c.com'], ['etiket', '<b>@x.co'], ['çift nokta', 'a..b@x.co'], ['boş kategori', 'k1@example.com', "array[]::text[]"], ['dört kategori', 'k2@example.com', "array['telefon','mobilya','elektronik','bilgisayar']"], ['bilinmeyen kategori', 'k3@example.com', "array['silah']"], ['yinelenen kategori', 'k4@example.com', "array['telefon','telefon']"]]) {
    check('reddedilir: ' + ad, kayit(email, kat || "array['telefon']", K(4)).code !== 0);
  }
  check('reddedilenler kayıt bırakmadı', say() === 1);
  check('boş sürüm reddedilir', as('service_role', `select public.firsat_kulubu_on_kayit('z@example.com', array['telefon'], ' ', '${K(5)}')`).code !== 0);
  check('geçersiz hız anahtarı reddedilir', kayit('z@example.com', undefined, 'kisa').code !== 0);

  // Otomatik etkinleştirme engeli
  check('doğrulama olmadan active yapılamaz', q("update public.club_signup_requests set status='active'").code !== 0);
  check('onaysız kayıt tabloya giremez', q("insert into public.club_signup_requests(email,categories,marketing_consent,consent_version,privacy_notice_version) values('n@example.com',array['telefon'],false,'v','v')").code !== 0);
  check('doğrulama ve İYS kaydıyla active olur', q("update public.club_signup_requests set email_verified=true, iys_checked=true, email_verified_at=now(), iys_checked_at=now(), status='active'").code === 0);

  // Hız sınırı: aynı anahtar 5 geçer, 6. durur; reddedilen kayıt yazılmaz
  const sonuc = []; for (let i = 0; i < 7; i++) sonuc.push(kayit(`hiz${i}@example.com`, undefined, K(7)).out);
  check('aynı anahtar: 5 ok, sonra sinir', sonuc.join() === 'ok,ok,ok,ok,ok,sinir,sinir' && say() === 6);
  check('başka anahtar etkilenmez', kayit('baska@example.com', undefined, K(8)).out === 'ok');

  // Eşzamanlı: aynı e-posta 12 kez, tek kayıt
  await Promise.all(Array.from({ length: 12 }, (_, i) => new Promise((res) => { const c = spawn(psql, [...args, '-c', `set role service_role; select public.firsat_kulubu_on_kayit('esz@example.com', array['telefon'], 'firsat-kulubu-2026-11-12-v2', '${K(20 + i)}')`]); c.on('close', res); })));
  check('12 eşzamanlı aynı e-posta: tek kayıt', q("select count(*) from public.club_signup_requests where email='esz@example.com'").out === '1');

  // Temizlik ve günlük tavan
  q("update public.club_signup_limits set created_at = now() - interval '3 days'");
  kayit('temizlik@example.com', undefined, K(40));
  check('iki günden eski hız kayıtları silinir', q("select count(*) from public.club_signup_limits where created_at < now() - interval '2 days'").out === '0');
  q("insert into public.club_signup_requests(email,categories,marketing_consent,consent_version,privacy_notice_version) select 'dolgu'||g||'@example.com', array['telefon'], true, 'v', 'v' from generate_series(1,500) g");
  const once = say();
  check('24 saatte 500 kayıttan sonra durur', kayit('tavan@example.com', undefined, K(41)).out === 'sinir' && say() === once);
} finally {
  spawnSync(pgCtl, ['-D', data, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
}
const kalan = checks.filter(([, ok]) => !ok);
if (kalan.length) { console.error(kalan.map(([ad]) => 'FAIL ' + ad).join('\n')); process.exit(1); }
console.log('ALL CHECKS PASSED'); console.log(checks.length + ' kontrol');
