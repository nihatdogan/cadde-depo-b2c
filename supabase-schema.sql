-- =====================================================================
-- CADDE DEPO — AŞAMA 1 Supabase şeması (storefront veri katmanı)
-- loadProducts sözleşmesine birebir uyumlu denormalize 'products' tablosu.
-- Tablolar: category_main(9), products(23), orders, order_items.
-- Sipariş yazımı: anon EKLER (id client'tan UUID), OKUYAMAZ; okuma yalnız authenticated.
-- ANON_KEY frontend'de görünür — RLS korur (anon yalnız aktif ürün okur, sipariş yazar).
-- Çalıştırma: Supabase SQL Editor'de tek seferde. Temiz/yeni şemada kur.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Kategori (storefront ağacı ile hizalı, 9 ana)
-- ---------------------------------------------------------------------
create table if not exists category_main (
  id           bigint generated always as identity primary key,
  slug         text not null unique,
  ad           text not null,            -- products.ana_kategori ile aynı metin
  emoji        text,
  sira         int not null default 0,
  lansman_dolu boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Ürün (denormalize — kategori metin olarak tutulur)
-- ---------------------------------------------------------------------
create table if not exists products (
  id              bigint generated always as identity primary key,
  ana_kategori    text not null,
  alt_kategori    text,
  ad              text not null,
  emoji           text,
  perakende_fiyat numeric(12,2) not null check (perakende_fiyat > 0),
  outlet_fiyat    numeric(12,2) not null check (outlet_fiyat > 0),
  stok            int not null default 0 check (stok >= 0),
  max_stok        int not null check (max_stok > 0),
  kondisyon       text not null,
  drop_aktif      boolean not null default false,
  aktif           boolean not null default true,
  created_at      timestamptz not null default now(),
  check (stok <= max_stok),
  check (outlet_fiyat <= perakende_fiyat)
);
create index if not exists products_aktif_idx on products (aktif, created_at desc);

-- ---------------------------------------------------------------------
-- 3. Sipariş başlığı + kalemleri
-- ---------------------------------------------------------------------
create table if not exists orders (
  id         uuid primary key default gen_random_uuid(),  -- client UUID gönderir
  toplam     numeric(12,2) not null check (toplam >= 0),
  durum      text not null default 'whatsapp_bekliyor',
  kanal      text not null default 'whatsapp',
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references orders(id) on delete cascade,
  product_id bigint references products(id),
  ad         text not null,
  fiyat      numeric(12,2) not null,
  adet       int not null default 1 check (adet > 0)
);
create index if not exists order_items_order_idx on order_items (order_id);

-- ---------------------------------------------------------------------
-- 4. RLS + grants
--    Sipariş id'si client'tan UUID gelir (checkout), bu yüzden RPC gerekmez.
-- ---------------------------------------------------------------------
alter table category_main enable row level security;
alter table products      enable row level security;
alter table orders        enable row level security;
alter table order_items   enable row level security;

-- Okuma: anon yalnız kategori + AKTİF ürün
create policy anon_read_category on category_main for select to anon, authenticated using (true);
create policy anon_read_products on products      for select to anon, authenticated using (aktif);

-- Sipariş: anon yalnız EKLER (id client'tan UUID gelir, .select() yok).
-- Okuma yalnız authenticated (admin). Anon orders/order_items OKUYAMAZ; UPDATE/DELETE yok.
create policy anon_insert_orders on orders      for insert to anon, authenticated with check (true);
create policy auth_read_orders   on orders      for select to authenticated using (true);
create policy anon_insert_items  on order_items for insert to anon, authenticated with check (true);
create policy auth_read_items    on order_items for select to authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on category_main, products to anon, authenticated;
grant insert on orders, order_items to anon, authenticated;
grant select on orders, order_items to authenticated;

-- ---------------------------------------------------------------------
-- 6. SEED — category_main (9, storefront ağacı)
-- ---------------------------------------------------------------------
insert into category_main (slug, ad, emoji, sira, lansman_dolu) values
  ('telefon',             'TELEFON',                 '📱', 1, false),
  ('bilgisayar',          'BİLGİSAYAR',              '💻', 2, false),
  ('elektronik',          'ELEKTRONİK',              '📺', 3, false),
  ('beyaz-esya',          'BEYAZ EŞYA',              '❄️', 4, false),
  ('kucuk-ev-aletleri',   'KÜÇÜK EV ALETLERİ',       '🔌', 5, true),
  ('mobilya',             'MOBİLYA',                 '🛋️', 6, true),
  ('ev-yasam',            'EV / YAŞAM',              '🏠', 7, true),
  ('motor-bisiklet-spor', 'MOTOR / BİSİKLET / SPOR', '🚲', 8, false),
  ('kozmetik-aksesuar',   'KOZMETİK / AKSESUAR',     '💄', 9, false);

-- ---------------------------------------------------------------------
-- 7. SEED — products (23, mevcut storefront dizisiyle birebir)
-- ---------------------------------------------------------------------
insert into products
  (ana_kategori, alt_kategori, ad, emoji, perakende_fiyat, outlet_fiyat, stok, max_stok, kondisyon, drop_aktif, aktif) values
  ('TELEFON','Cep Telefonları','Akıllı Telefon 128GB (teşhir)','📱',24900,14900,4,10,'Açık Kutu',true,true),
  ('TELEFON','Kulaklıklar','Kablosuz ANC Kulaklık (kutu hasarlı)','🎧',4200,1690,9,25,'Açık Kutu',false,true),
  ('TELEFON','Şarj Aletleri / Kablolar','65W Hızlı Şarj + Kablo Seti ×5','🔌',1800,590,18,50,'Sıfır',false,true),
  ('BİLGİSAYAR','Dizüstü Bilgisayar','14" Dizüstü i5 / 16GB (seri sonu)','💻',32900,21900,3,8,'Seri Sonu',true,true),
  ('BİLGİSAYAR','Monitörler','27" IPS Monitör (kasa çizik)','🖥️',8900,4290,6,15,'Açık Kutu',false,true),
  ('BİLGİSAYAR','OEM Ürünleri','OEM SSD 1TB Lot (10 adet)','💾',12000,6900,5,12,'Sıfır',false,true),
  ('ELEKTRONİK','Televizyon','55" 4K Smart TV (teşhir)','📺',26900,15900,2,6,'Açık Kutu',true,true),
  ('ELEKTRONİK','Ses Sistemleri','Soundbar 2.1 (kutu yok)','🔊',6400,2490,7,20,'Açık Kutu',false,true),
  ('BEYAZ EŞYA','Buzdolabı','No-Frost Buzdolabı 480L (çizik)','❄️',38900,24900,2,5,'Açık Kutu',false,true),
  ('BEYAZ EŞYA','Çamaşır / Kurutma Makineleri','9kg Çamaşır Makinesi (seri sonu)','🌀',21900,13900,4,9,'Seri Sonu',false,true),
  ('KÜÇÜK EV ALETLERİ','Süpürgeler','Dikey Şarjlı Süpürge (kutu hasarlı)','🧹',7900,3290,6,18,'Açık Kutu',false,true),
  ('KÜÇÜK EV ALETLERİ','Çay / Kahve Makineleri','Türk Kahve Makinesi (kutu hasarlı)','☕',2490,899,7,20,'Açık Kutu',true,true),
  ('KÜÇÜK EV ALETLERİ','Gıda Hazırlama','1200W El Blender Seti','🍲',1990,749,3,22,'Sıfır',true,true),
  ('MOBİLYA','Koltuk / Oturma Grubu','Bohem 3+2 Koltuk Takımı (teşhir)','🛋️',42900,18900,3,6,'Açık Kutu',true,true),
  ('MOBİLYA','Mutfak / Masa Sandalyeler','Metal Ayaklı Yemek Sandalyesi ×4','🪑',8400,3290,6,18,'Sıfır',false,true),
  ('MOBİLYA','Dolaplar / Antre Ürünleri','3 Çekmeceli Komodin (çizik)','🗄️',3900,1190,5,12,'Açık Kutu',false,true),
  ('EV / YAŞAM','Ev Tekstili','Denizli Çift Kişilik Nevresim Seti ×6','🛏️',7200,2490,14,40,'Seri Sonu',false,true),
  ('EV / YAŞAM','Halı / Kilim','Akrilik Halı 160×230 (parti)','🧶',6800,2390,4,15,'Seri Sonu',true,true),
  ('EV / YAŞAM','Sofra ve Mutfak','Granit Tencere Seti 7 Parça','🍽️',5400,1990,9,25,'Sıfır',false,true),
  ('MOTOR / BİSİKLET / SPOR','Bisikletler','28 Jant Şehir Bisikleti (teşhir)','🚲',14900,8900,3,7,'Açık Kutu',false,true),
  ('MOTOR / BİSİKLET / SPOR','Spor Aletleri','Katlanır Koşu Bandı (seri sonu)','🏋️',18900,11900,2,5,'Seri Sonu',false,true),
  ('KOZMETİK / AKSESUAR','Parfümler','İthal Parfüm Karma Lot (6 adet)','🧴',9600,3900,8,20,'Sıfır',false,true),
  ('KOZMETİK / AKSESUAR','Saatler','Akıllı Saat (kutu hasarlı)','⌚',5400,2190,6,18,'Açık Kutu',false,true);

commit;

-- ---------------------------------------------------------------------
-- 8. DOĞRULAMA (çalıştırınca beklenen: 23 ve 9)
-- ---------------------------------------------------------------------
-- select count(*) as products_count from products;        -- 23
-- select count(*) as category_count from category_main;   -- 9
