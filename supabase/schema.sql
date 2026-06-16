-- =====================================================================
-- CADDE DEPO — Supabase / PostgreSQL şema + seed
-- İlk prod dosyası. Karar A: React + Supabase. Karar B: şema gerçeğe
-- hazır, lansman görsel (likidite trigger'ı KAPALI, fiyat manuel).
-- Karar (Züccaciye): ayrı ana kategori — kategori-agaci.json ile hizalı.
-- WhatsApp no: env'de tutulur (DB'de değil). Placeholder: 905XXXXXXXXX.
-- Çalıştırma: psql / Supabase SQL editor. İdempotent değil — temiz DB'de kur.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Enumlar
-- ---------------------------------------------------------------------
create type kondisyon as enum ('Sıfır', 'Seri Sonu', 'Açık Kutu', 'Teşhir');
create type parti_durum as enum ('acik', 'kapali');
create type talep_durum as enum ('yeni', 'iletildi', 'kapandi');

-- ---------------------------------------------------------------------
-- 1. Kategori ağacı (tek doğruluk kaynağı: kategori-agaci.json'dan seed)
--    ana › alt — ürün her zaman bu çiftle etiketlenir.
-- ---------------------------------------------------------------------
create table kategori (
  id            bigint generated always as identity primary key,
  slug          text not null unique,
  ad            text not null,           -- ANA (büyük harf, ağaçtaki gibi)
  emoji         text,
  sira          int  not null default 0,
  -- Lansman kapsamı (Karar 3): true = dolu vitrin, false = lead modu.
  lansman_dolu  boolean not null default false,
  created_at    timestamptz not null default now()
);

create table alt_kategori (
  id           bigint generated always as identity primary key,
  kategori_id  bigint not null references kategori(id) on delete cascade,
  ad           text not null,            -- ALT
  sira         int  not null default 0,
  unique (kategori_id, ad)
);

-- ---------------------------------------------------------------------
-- 2. Parti (STOKBANK kaynaklı tekil boşaltma partisi)
--    drop_bitis = geri sayım kaynağı (Karar E ileride parti endpoint'i).
-- ---------------------------------------------------------------------
create table parti (
  id            bigint generated always as identity primary key,
  kod           text not null unique,        -- ör. ELK-204 (vitrin etiketi)
  stokbank_ref  text,                         -- STOKBANK parti referansı
  baslik        text not null,
  kategori_id   bigint references kategori(id),
  durum         parti_durum not null default 'acik',
  drop          boolean not null default false,  -- "canlı drop" rozeti
  drop_bitis    timestamptz,                  -- null => sabit gün sonu fallback
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Ürün
--    Fiyat çıpası: perakende (üstü çizili) > outlet_baslangic > outlet_guncel.
--    Likidite protokolü outlet_guncel'i hareket ettirir; outlet_taban = zemin.
-- ---------------------------------------------------------------------
create table urun (
  id               bigint generated always as identity primary key,
  parti_id         bigint references parti(id) on delete set null,
  kategori_id      bigint not null references kategori(id),
  alt_kategori_id  bigint references alt_kategori(id),
  ad               text not null,
  emoji            text,
  gorsel_url       text,
  perakende        numeric(12,2) not null check (perakende > 0),  -- çıpa (was)
  outlet_baslangic numeric(12,2) not null check (outlet_baslangic > 0), -- ilan
  outlet_guncel    numeric(12,2) not null check (outlet_guncel > 0),    -- canlı (now)
  outlet_taban     numeric(12,2),                                  -- fiyat zemini
  stok             int not null check (stok >= 0),
  stok_baslangic   int not null check (stok_baslangic > 0),        -- max
  kondisyon        kondisyon not null,
  drop             boolean not null default false,
  aktif            boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (stok <= stok_baslangic),
  check (outlet_guncel <= perakende),
  check (outlet_taban is null or outlet_taban <= outlet_baslangic)
);

create index urun_kategori_idx on urun (kategori_id, alt_kategori_id) where aktif;
create index urun_parti_idx    on urun (parti_id);
create index parti_durum_idx   on parti (durum);

-- updated_at otomatik
create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger urun_updated_at before update on urun
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Talep / lead (boş kategori → talep yakala → arzı tetikle)
--    Prototipte WA'ya akıp kayboluyordu; burada kayıt altına alınır.
-- ---------------------------------------------------------------------
create table talep (
  id               bigint generated always as identity primary key,
  kategori_id      bigint references kategori(id),
  alt_kategori_id  bigint references alt_kategori(id),
  kategori_metin   text,                 -- serbest metin (kategori seçilmezse)
  wa_no            text,
  mesaj            text,
  durum            talep_durum not null default 'yeni',
  created_at       timestamptz not null default now()
);

create index talep_durum_idx on talep (durum, created_at desc);

-- ---------------------------------------------------------------------
-- 5. Stok Likidite Protokolü — fiyat-stok bağı entegrasyon noktası
--    Karar B: lansman GÖRSEL. Kurallar + fonksiyon hazır, TRIGGER KAPALI.
--    Protokol parametreleri (eşik→indirim eğrisi) gelince trigger açılır;
--    o ana kadar outlet_guncel manuel/sabit kalır.
-- ---------------------------------------------------------------------
create table likidite_kurali (
  id               bigint generated always as identity primary key,
  kategori_id      bigint references kategori(id),  -- null = global
  stok_yuzde_esik  int not null check (stok_yuzde_esik between 0 and 100),
  ek_indirim_yuzde numeric(5,2) not null check (ek_indirim_yuzde >= 0),
  created_at       timestamptz not null default now()
);

-- Stok eridikçe outlet_guncel'i eşik eğrisine göre düşürür, taban'ın altına inmez.
-- Eşik eğrisi tanımlı değilse outlet_guncel = outlet_baslangic kalır (no-op).
create function uygula_likidite() returns trigger language plpgsql as $$
declare
  stok_yuzde   int;
  indirim      numeric(5,2);
  hedef        numeric(12,2);
begin
  if new.stok_baslangic > 0 then
    stok_yuzde := floor(new.stok::numeric / new.stok_baslangic * 100);
  else
    stok_yuzde := 100;
  end if;

  select coalesce(max(ek_indirim_yuzde), 0) into indirim
  from likidite_kurali
  where (kategori_id = new.kategori_id or kategori_id is null)
    and stok_yuzde <= stok_yuzde_esik;

  hedef := round(new.outlet_baslangic * (1 - indirim / 100), 2);
  if new.outlet_taban is not null then
    hedef := greatest(hedef, new.outlet_taban);
  end if;
  new.outlet_guncel := least(new.outlet_guncel, hedef);  -- yalnız aşağı yönlü
  return new;
end $$;

-- !!! KARAR B — lansman görsel olduğu için trigger KAPALI. Protokol
-- parametreleri likidite_kurali'ya yüklenince aşağıdaki satırı aç:
-- create trigger urun_likidite before update of stok on urun
--   for each row execute function uygula_likidite();

-- ---------------------------------------------------------------------
-- 6. Vitrin view — frontend tek sorguda okur (indirim/stok yüzdesi hesaplı)
-- ---------------------------------------------------------------------
create view vitrin_urun
with (security_invoker = on) as
select
  u.id, u.ad, u.emoji, u.gorsel_url,
  k.ad   as ana, k.slug as ana_slug, k.emoji as ana_emoji,
  ak.ad  as alt,
  u.perakende, u.outlet_guncel as fiyat,
  round((1 - u.outlet_guncel / u.perakende) * 100)::int as indirim_yuzde,
  u.stok, u.stok_baslangic,
  round(u.stok::numeric / u.stok_baslangic * 100)::int  as stok_yuzde,
  u.kondisyon, u.drop,
  p.kod as parti_kod, p.drop_bitis
from urun u
join kategori k on k.id = u.kategori_id
left join alt_kategori ak on ak.id = u.alt_kategori_id
left join parti p on p.id = u.parti_id
where u.aktif
  and (p.id is null or p.durum = 'acik');

-- ---------------------------------------------------------------------
-- 7. RLS — anon yalnız vitrin okur + talep bırakır. Yazma = service_role.
-- ---------------------------------------------------------------------
alter table kategori        enable row level security;
alter table alt_kategori    enable row level security;
alter table parti           enable row level security;
alter table urun            enable row level security;
alter table talep           enable row level security;
alter table likidite_kurali enable row level security;

create policy anon_read_kategori     on kategori     for select to anon, authenticated using (true);
create policy anon_read_alt          on alt_kategori for select to anon, authenticated using (true);
create policy anon_read_parti_acik   on parti        for select to anon, authenticated using (durum = 'acik');
create policy anon_read_urun_aktif   on urun         for select to anon, authenticated using (aktif);
create policy anon_insert_talep      on talep        for insert to anon, authenticated with check (true);
-- likidite_kurali: anon policy yok => okunamaz/yazılamaz (yalnız service_role).

-- ---------------------------------------------------------------------
-- 8. SEED — kategori ağacı (kategori-agaci.json ile birebir, 10 ana)
--    lansman_dolu: EV/YAŞAM, KÜÇÜK EV ALETLERİ, MOBİLYA, ZÜCCACİYE.
-- ---------------------------------------------------------------------
insert into kategori (slug, ad, emoji, sira, lansman_dolu) values
  ('telefon',              'TELEFON',                 '📱', 1,  false),
  ('bilgisayar',           'BİLGİSAYAR',              '💻', 2,  false),
  ('elektronik',           'ELEKTRONİK',              '📺', 3,  false),
  ('beyaz-esya',           'BEYAZ EŞYALAR',           '❄️', 4,  false),
  ('kucuk-ev-aletleri',    'KÜÇÜK EV ALETLERİ',       '🔌', 5,  true),
  ('mobilya',              'MOBİLYA',                 '🛋️', 6,  true),
  ('ev-yasam',             'EV / YAŞAM',              '🏠', 7,  true),
  ('zuccaciye',            'ZÜCCACİYE',               '🍽️', 8,  true),
  ('motor-bisiklet-spor',  'MOTOR / BİSİKLET / SPOR', '🚲', 9,  false),
  ('kozmetik-aksesuar',    'KOZMETİK / AKSESUAR',     '💄', 10, false);

insert into alt_kategori (kategori_id, ad, sira)
select k.id, x.ad, x.sira
from kategori k
join (values
  ('telefon','Cep Telefonları',1),('telefon','Kulaklıklar',2),('telefon','Şarj Aletleri / Kablolar',3),('telefon','Giyilebilir Teknoloji',4),('telefon','Taşınabilir Bluetoothlu Hoparlörler',5),('telefon','Kılıflar / Ekran Koruyucular',6),
  ('bilgisayar','Dizüstü Bilgisayar',1),('bilgisayar','Monitörler',2),('bilgisayar','Aksesuarlar',3),('bilgisayar','Oyunculara Özel / Gaming',4),('bilgisayar','Masaüstü Bilgisayarlar',5),('bilgisayar','Tabletler',6),('bilgisayar','Yazıcılar',7),('bilgisayar','OEM Ürünleri',8),
  ('elektronik','Televizyon',1),('elektronik','Kamera / Fotoğraf',2),('elektronik','Oto Ses / Görüntü Sistemleri',3),('elektronik','Oyun Konsolları ve Eğlence',4),('elektronik','Ses Sistemleri',5),('elektronik','Güvenlik Sistemleri',6),
  ('beyaz-esya','Buzdolabı',1),('beyaz-esya','Bulaşık Makineleri',2),('beyaz-esya','Fırın',3),('beyaz-esya','Aspiratörler',4),('beyaz-esya','Çamaşır / Kurutma Makineleri',5),('beyaz-esya','Derin Dondurucu',6),('beyaz-esya','Ocaklar',7),('beyaz-esya','Klima ve İklimlendirme',8),
  ('kucuk-ev-aletleri','Süpürgeler',1),('kucuk-ev-aletleri','Çay / Kahve Makineleri',2),('kucuk-ev-aletleri','Hava Temizleme / Nemlendiriciler',3),('kucuk-ev-aletleri','Kişisel Bakım',4),('kucuk-ev-aletleri','Çeyiz Setleri',5),('kucuk-ev-aletleri','Ütüler',6),('kucuk-ev-aletleri','Gıda Hazırlama',7),('kucuk-ev-aletleri','Buharlı Temizleyiciler',8),('kucuk-ev-aletleri','Evcil Hayvan Ürünleri',9),
  ('mobilya','Koltuk / Oturma Grubu',1),('mobilya','Yemek Odası',2),('mobilya','Mutfak / Masa Sandalyeler',3),('mobilya','TV Ünitesi / Sehpa',4),('mobilya','Aksesuar ve Dekorasyon',5),('mobilya','Uyku Dünyası',6),('mobilya','Yatak Odası',7),('mobilya','Çocuk / Genç / Bebek Odası',8),('mobilya','Dolaplar / Antre Ürünleri',9),('mobilya','Sehpalar',10),('mobilya','Çalışma / Ofis Sandalyeleri',11),('mobilya','Bahçe / Balkon Mobilyaları',12),
  ('ev-yasam','Ev Tekstili',1),('ev-yasam','Halı / Kilim',2),('ev-yasam','Anne-Bebek / Oyuncak',3),('ev-yasam','Sofra ve Mutfak',4),('ev-yasam','Ev Gereçleri',5),('ev-yasam','Yapı Gereçleri / Outdoor',6),
  ('zuccaciye','Bardak / Cam Ürünleri',1),('zuccaciye','Tabak / Servis Takımları',2),('zuccaciye','Çatal-Bıçak / Sofra',3),('zuccaciye','Tencere / Pişirme',4),('zuccaciye','Saklama Kapları',5),('zuccaciye','Dekoratif Cam / Porselen',6),
  ('motor-bisiklet-spor','Motorsiklet ve Elektrikli Araçlar',1),('motor-bisiklet-spor','Spor Aletleri',2),('motor-bisiklet-spor','Motor Aksesuarları',3),('motor-bisiklet-spor','Bisikletler',4),('motor-bisiklet-spor','Lastikler',5),
  ('kozmetik-aksesuar','Parfümler',1),('kozmetik-aksesuar','Cilt Bakım Ürünleri',2),('kozmetik-aksesuar','Makyaj',3),('kozmetik-aksesuar','Saatler',4)
) as x(slug, ad, sira) on k.slug = x.slug;

commit;

-- =====================================================================
-- SONRAKİ ADIMLAR (bu dosyanın kapsamı dışı):
--   • Lansman ürün/parti seed'i (dolu 4 kategori) — ayrı seed dosyası.
--   • Iyzico + KVKK/Mesafeli Satış tabloları.
--   • Protokol parametreleri → likidite_kurali insert + trigger aç (Karar B).
--   • STOKBANK parti akışı → parti.stokbank_ref / drop_bitis besleme (Karar E).
-- =====================================================================
