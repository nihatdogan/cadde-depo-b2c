-- =====================================================================
-- CADDE DEPO — Ücretsiz Fırsat Kulübü ön kayıt (v2, denetim revizyonu)
-- UYGULANMADI. Önce önizleme veritabanında, sonra ayrı onayla üretimde çalıştırılır.
--
-- Ön kayıt; aktif üyelik, ileti gönderimi, rezervasyon veya indirim DEĞİLDİR.
-- Bu dosya hiçbir ileti göndermez.
--
-- Erişim: iki tabloda da RLS açık ve politika yok. anon / authenticated hiçbir
-- şey yapamaz. Tek giriş kapısı public.firsat_kulubu_on_kayit fonksiyonudur ve
-- onu yalnız service_role (sunucu API'si) çalıştırabilir.
--
-- Kurallar:
--  * Aynı e-posta ikinci kez gelirse kayıt DEĞİŞMEZ ve sonuç yine 'ok' döner
--    (kayıtlı mı değil mi dışarıdan anlaşılamaz; üçüncü kişi izni değiştiremez).
--  * Hız sınırı: aynı anahtar için 15 dakikada 5, toplamda 24 saatte 500 yeni kayıt.
--  * Onay zamanı sunucu saatidir (now()).
--  * 'active' durumu ancak e-posta doğrulaması ve İYS kontrolü kayıtlıysa mümkündür.
-- Tek transaction içinde çalıştırılır. Tekrar çalıştırılabilir.
-- =====================================================================
begin;

create table if not exists public.club_signup_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null unique
    check (char_length(email) between 6 and 254
       and email = lower(email)
       and email ~ '^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$'
       and email !~ '\.\.'),
  categories text[] not null
    -- cardinality: boş dizide array_length NULL döner ve CHECK'i geçirirdi.
    check (cardinality(categories) between 1 and 3
       and categories <@ array['telefon','bilgisayar','elektronik','beyaz-esya','kucuk-ev-aletleri',
                               'mobilya','ev-yasam','motor-bisiklet-spor','kozmetik-aksesuar']::text[]),
  channel text not null default 'email' check (channel = 'email'),
  marketing_consent boolean not null,
  consent_version text not null,
  consented_at timestamptz not null default now(),
  privacy_notice_version text not null,
  status text not null default 'pending_review'
    check (status in ('pending_review','rejected','active','unsubscribed')),
  email_verified boolean not null default false,
  iys_checked boolean not null default false,
  email_verified_at timestamptz,
  iys_checked_at timestamptz,
  unsubscribed_at timestamptz,
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_consent_required check (marketing_consent),
  constraint club_never_auto_activate check (
    status <> 'active'
    or (marketing_consent and email_verified and iys_checked
        and email_verified_at is not null and iys_checked_at is not null))
);
create index if not exists club_signup_status_idx on public.club_signup_requests (status, created_at desc);

create table if not exists public.club_signup_limits (
  rate_key text not null check (rate_key ~ '^[0-9a-f]{64}$'),
  window_key bigint not null,
  adet int not null default 1 check (adet > 0),
  created_at timestamptz not null default now(),
  primary key (rate_key, window_key)
);

alter table public.club_signup_requests enable row level security;
alter table public.club_signup_limits enable row level security;
revoke all on table public.club_signup_requests from public, anon, authenticated;
revoke all on table public.club_signup_limits from public, anon, authenticated;
grant select, insert, update, delete on public.club_signup_requests to service_role;
grant select, insert, update, delete on public.club_signup_limits to service_role;

create or replace function public.firsat_kulubu_on_kayit(
  p_email text,
  p_kategoriler text[],
  p_metin_surum text,
  p_hiz_anahtar text
) returns text
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_pencere bigint := floor(extract(epoch from now()) / 900);
  v_adet int;
  c_kisi_siniri constant int := 5;
  c_gunluk_sinir constant int := 500;
begin
  if p_email is null or p_kategoriler is null or p_metin_surum is null
     or btrim(p_metin_surum) = '' or p_hiz_anahtar is null then
    raise exception 'Eksik alan' using errcode = '22023';
  end if;

  if cardinality(p_kategoriler) <> (select count(distinct k) from unnest(p_kategoriler) k) then
    raise exception 'Yinelenen kategori' using errcode = '22023';
  end if;

  -- Eski hız kayıtları her çağrıda temizlenir; ayrı zamanlanmış iş gerekmez.
  delete from public.club_signup_limits where created_at < now() - interval '2 days';

  insert into public.club_signup_limits as l (rate_key, window_key)
  values (p_hiz_anahtar, v_pencere)
  on conflict (rate_key, window_key) do update set adet = l.adet + 1
  returning l.adet into v_adet;
  if v_adet > c_kisi_siniri then
    return 'sinir';
  end if;

  if (select count(*) from public.club_signup_requests r
      where r.created_at > now() - interval '24 hours') >= c_gunluk_sinir then
    return 'sinir';
  end if;

  insert into public.club_signup_requests
    (email, categories, marketing_consent, consent_version, privacy_notice_version)
  values
    (lower(btrim(p_email)), p_kategoriler, true, left(btrim(p_metin_surum), 60), left(btrim(p_metin_surum), 60))
  on conflict (email) do nothing;

  return 'ok';
end;
$$;

revoke all on function public.firsat_kulubu_on_kayit(text, text[], text, text) from public, anon, authenticated;
grant execute on function public.firsat_kulubu_on_kayit(text, text[], text, text) to service_role;
comment on function public.firsat_kulubu_on_kayit(text, text[], text, text) is
  'Fırsat Kulübü ön kayıt. Yalnız service_role. Tekrarlanan e-posta kaydı değiştirmez; ileti göndermez.';

-- Talep özeti (kişisel veri döndürmez):
--   select unnest(categories) as kategori, count(*) from public.club_signup_requests group by 1 order by 2 desc;
-- Saklama süresi ve silme prosedürü hukuk onayıyla belirlenecek.
commit;
