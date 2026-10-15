# Brabantia 385728 — mevcut üretim sistemine geçiş raporu

Tarih: 15.10.2026. Repository: nihatdogan/cadde-depo-b2c. Dal: codex/brabantia-385728-on-demand. İnceleme başlangıcı: f36af5b.

**Karar: VERİ BEKLE. Bu paket uygulama yetkisi vermez.** Canlı şema doğrulanmadı, yedek/geri yükleme kanıtı yok, görsel izni ve ticari teyitler eksik. Yerel test başarısı canlı uygunluk onayı değildir.

## Canlı şema uygunluğu ve kanıt durumu

| Kontrol | Sonuç | Kanıt / sınır |
| --- | --- | --- |
| Yetkili canlı DB/API/CLI erişimi | Yok | Ortamda ilgili bağlantı değişkeni, Supabase/psql/Vercel CLI veya DB connector yok. Gizli anahtar aranmadı/çıkarılmadı. |
| Supabase Dashboard | Yetkili oturum yok | Mevcut proje sayfası giriş ekranına yönlendi. Giriş veya SQL çalıştırılmadı. |
| products/orders/order_items canlı kolon ve tipleri | Doğrulanamadı | Yalnız repository şema dosyaları incelendi. |
| Canlı roller, JWT yönetici atamaları, RLS/ACL | Doğrulanamadı | Mevcut politikaların kod kopyası canlı kanıt sayılmaz. |
| Canlı trigger/RPC/view/FK ve stok/ödeme bağımlılıkları | Doğrulanamadı | Uygulama öncesi yetkili metadata denetimi gerekli. |
| Doğrulanmış yedek ve geri yükleme denemesi | Yok | Üretimden yedek alınmadı veya restore yapılmadı. |
| Yerel sentetik şema uyumluluğu | Test edildi | PGlite PostgreSQL üzerinde; gerçek müşteri kaydı kullanılmadı. |

Hazırlanan `supabase/production-readonly-audit.sql` READ ONLY transaction içinde kolonları, kısıtları, indeksleri, RLS politikalarını, yetkileri, trigger gövdelerini, tüm public RPC’leri, auth.jwt/uid, ilgili view/FK ve rol üyeliklerini listeler. Ürün/sipariş/kalem sayıları ve yönetici rolü bulunan kullanıcıların yalnız toplam sayısı alınır; e-posta, müşteri satırı, parola veya JWT seçilmez. Fonksiyon gövdelerinde mevcut gömülü sır olasılığı nedeniyle gerçek çıktı özel alanda tutulmalı; Git’e/chat’e ham dump konmamalıdır. Dosya canlıda çalıştırılmadı.

Denetim aynı yetkili DB rolüyle yürütülmeli ve semantik olarak incelenmelidir. Çıktıdaki MD5 metadata parmak izi migration öncesinde tekrar hesaplanır; değişiklik varsa migration durur. Bu yalnız şema değişimi kontrolüdür; izin, yedek veya semantik uygunluğun kriptografik kanıtı değildir.

## Repository’den saptanan mevcut riskler

1. `supabase-admin.sql` içindeki auth_all_products ve auth_update_orders politikaları bütün authenticated rolüne geniş yetki tanımlıyor; auth_read_orders da bütün giriş yapanlara okuma veriyor. Canlıda aynısı varsa müşteri/admin ayrımı ayrıca ele alınmalıdır. Production taslağı mevcut stoklu akışın politikalarını körlemesine değiştirmiyor; yeni tedarik alanlarında ek rol/trigger kontrolleri uyguluyor. Bu eski global yetki tasarımının tamamının güvenli olduğunu doğrulamaz.
2. Stoklu sepet mevcut uygulamada fiyat/adet bilgisini istemciden orders/order_items’a gönderiyor. Yeni tedarik RPC’si fiyatı yalnız sunucudan alır; stoklu akışın eski fiyat doğrulaması bu değişiklikle düzeltilmiş sayılmaz. Canlı sipariş RPC/trigger incelemesinde bu konu kapatılmalıdır.
3. Canlı bir stok düşme trigger’ı her order_items eklemesinde çalışıyorsa yeni tedarik ürünüyle çakışabilir. Yeni koruma stok 0’ın değiştirilmesine izin vermez ve transaction geri döner; yine de satış akışı çalışmayabilir. İlgili trigger görülmeden uyumluluk iddia edilmez ve körlemesine değiştirilmez.
4. ALTER/indeks/kısıt ve trigger kurulumu kilit alabilir. Dosyada 3 saniye lock_timeout ve 45 saniye statement_timeout vardır; süre aşımında transaction tamamlanmaz. Canlı tablo büyüklüğü ve eşzamanlı sipariş trafiği bakım penceresiyle değerlendirilmelidir.
5. Bilinmeyen supply nesneleri veya daha önce yanlış yere uygulanmış Preview şeması varsa production dosyası bunların üstüne yazmak yerine durur. Önce manuel uzlaştırma gerekir.

Bu bulgular canlıda doğrulanıp giderilmeden karar YAYINA HAZIR’a çevrilemez. Canlıda risk teyit edilirse alt karar DÜZELTME GEREKLİ olur.

## Ayrı production migration ve SQL değişiklikleri

`supabase/order-on-demand.production.sql` bağımsız bir dosyadır; Preview migration’ı ve koruması değiştirilmedi.

- Transaction, hedef proje kontrolü, yönetici uygulama onayı, doğrulanmış yedek ve restore referansları, güncel metadata parmak izi ve temel şema/RLS/owner kontrolleri.
- products: fulfillment_mode, sku, image_rights_status; SKU unique index; eski fiyat yalnız tedarik ürününde NULL olabilir, stoklu ürünlerde eski NOT NULL sözleşmesini koşullu kısıt korur. Var olan ürün fiyatı/stok sayacı güncellenmez.
- supply_requests ve supply_costs: ayrı tablolar; RLS açık; PUBLIC/anon erişimi yok; authenticated okuma yalnız server-managed admin rolü ve auth.uid ile. Doğrudan frontend yazma verilmez.
- supply_release_control: yalnız DB sahibinin erişebildiği uygulama/yayın/izin referansları. Frontend’e açılmaz.
- orders: NULL varsayılanlı supply_request_id, FK ve unique index; eski siparişlerde fiyat/durum/kalem değişikliği yapılmaz.
- create_supply_request, save_supply_costs, record_supply_check, finalize_supply_request: public fiyat sunucudan alınır; admin RPC’leri app_metadata + geçerli kullanıcı kimliği ister. Eksik maliyet sıfır olmaz; NaN/sonsuz değerler reddedilir.
- Katkı = KDV hariç ürün geliri − doğrulanmış alış, giriş nakliyesi, komisyon, paketleme/operasyon, net çıkış kargo, reklam, iade/hasar/garanti giderleri. Kargo geliri ürün marjına eklenmez; net kargo gideri negatif olamaz. Eksik/yetersiz katkıda kesinleştirme engellenir.
- Stok/montaj teyidi, ayrı kargo ve teslimat şartları, yazılı müşteri kabul referansı zorunludur. 24 saatten eski stok teyidi kabul edilmez; maliyet/koşul değişince teyitler sıfırlanır.
- Trigger’lar: eski endpoint’ten tedarik siparişi uydurma, kesinleşmiş tedarik fiyatı/kalemi değiştirme veya silme engellenir. Yetkili admin kargo/teslim/iptal durumlarını yönetebilir. Ürün fiyatı/kategorisi/mode/stok kimliği sabittir; ayrı yayın izni olmadan aktif edilemez. Sonradan görsel değiştirmek de yeni izin ister.
- Seed: BRABANTIA-385728; EV / YAŞAM → Ev Gereçleri; 3.619₺ KDV dahil; kargo ayrı; montaj hariç; stok 0; ORDER_ON_DEMAND; **aktif=false**; görsel PENDING_PERMISSION. max_stok=1 yalnız eski şemanın teknik paydasıdır; fiziksel stok iddiası değildir.
- SKU/slug/benzer ürün kimliği çakışması belirsizse durur. Tekrar uygulama veri çoğaltmaz veya pasif ürünü açmaz. Mevcut onaylı kayıtlar tekrar uygulamayla sıfırlanmaz.

Kodda otomatik ödeme/tahsilat endpoint’i bulunmadı; WhatsApp yönlendirmesi var. Kesin sipariş DB kapısından geçer. Mevcut dış ödeme/manuel havale operasyonu incelenmeden bu migration’ın harici tahsilatı tek başına engellediği iddia edilmez. Operatör ödeme bağlantısını ancak tüm teyitler ve müşteri kabulünden sonra paylaşmalıdır.

## Yayın sırası ve ayrı onay kapıları

- [ ] Yetkili salt-okunur canlı metadata denetimi, rol/RLS/RPC/trigger/view/FK bağımlılık incelemesi ve tespit edilen risklerin kapatılması.
- [ ] Yedek/restore doğrulaması ve geri dönüş penceresi; PRODUCTION-BACKUP-ROLLBACK.md.
- [ ] Canlı şema parmak izi, değişmeyecek SQL dosyasının SHA256 özeti ve yönetici onayı kaydı.
- [ ] **Onay A:** yalnız production migration’ının uygulanması. Hedef, production_approval_ref, verified_backup_ref, restore_verification_ref, expected_schema_fingerprint değerleri yetkili operatörce gerçek kanıttan doldurulur. Referans yazmak kanıtın doğrulanması yerine geçmez.
- [ ] Onay A’dan sonra migration; başarısızsa commit yok. Ürün pasif kalır. Migration’ı şimdi çalıştırmayın.
- [ ] **Onay B:** main merge ve belirtilmiş commit’in production frontend deploy’u. Mevcut production değişkenleri korunur; Preview canlıya bağlanmaz. Yeni Supabase projesi kurulmaz.
- [ ] Yayından sonra yalnız gerçek katalog/metadata/sayaçları salt-okunur kontrol edin. Gerçek müşteri verisiyle yapay talep/sipariş/tahsilat oluşturmayın. Stoklu ürünlerin sepet ekranı/hesaplaması da yazma yapmadan doğrulanır; son checkout/gönderme düğmesine basılmaz.
- [ ] Brabantia pasifken yönetici kaydında fiyat/kategori/koşullar ve teknik özellikler doğrulanır; anonim katalogda henüz görünmemesi beklenir. Gerçek izinli fotoğraf ve lisans kanıtı sağlanır.
- [ ] **Onay C:** ayrıca ürünün görünür satışa açılması. `supabase/production-activate-brabantia.sql` ancak gerçek yayın onayı + görsel izin referansı ve mevcut fotoğraf URL’siyle uygulanır. Canlı kaydın `aktif=true` olması onaydan sonra mümkündür.
- [ ] Ürün açılınca anonim katalog ve detay sayfasındaki 3.619₺, kategori, sipariş üzerine tedarik, ayrı kargo ve montaj hariç ifadeleri yazma yapmadan kontrol edilir. Hata varsa onaylı pause prosedürü uygulanır.

A/B/C için onaylar birbirinin yerine geçmez. Bu çalışma hiçbirini uygulamadı.

## Bekleyen ticari doğrulamalar
Toptancı güncel stok/teklif/alış maliyeti; teyitli KDV oranı; bütün maliyet kalemleri ve minimum kabul edilebilir katkı; gerçek kargo/teslimat; müşterinin iki duvar/montaj uygunluğu; yazılı nihai koşul kabulü; Türkiye’de servis/garanti şartları; görselin ticari kullanım izni. Satış fiyatı 3.619₺ kesindir ve yeniden fiyat onayı beklemez.

## Yöneticiye sunulan sonuç
Paket incelemeye hazırdır; **canlı uygulama için VERİ BEKLE**. Yetkili şema erişimi/metadata kanıtı ve doğrulanmış yedek olmadan canlı uyumluluk onaylanamaz. Canlı SQL, main merge, production deploy ve ürün aktivasyonu için açık, kapsamı belirli ayrı yönetici onayları alınmadan işlem yapılmayacaktır.

## Yerel test sonuçları ve inceleme özeti

Komut: `node --test --test-concurrency=1 tests/*.test.cjs`

**53/53 geçti:** 22 production, 17 ortam ve 14 mevcut tedarik/vitrin testi. Sentetik verilerle eksik onay/yedek/restore engeli, şema drift ve RLS kapalıysa durma, kimlik çakışması, pasif seed, eski ürün/sipariş/kalem/stok/politika korunumu, idempotence, ayrı yayın/görsel onayı, maliyet gizliliği, user_metadata rol taklidi, sunucudan sabit fiyat, eksik/negatif/yetersiz/NaN maliyet engeli, yazılı kabul/24 saatlik stok teyidi, kesinleşmiş kayıt korunumu, stoklu sepet, veri silmeyen pause ve Preview izolasyonu doğrulandı. Gerçek ödeme veya müşteri verisi kullanılmadı.

Production SQL yerel dosya SHA256: `965772bf4659243ca5b7f546fc903f700fcb0de0bfd13d12e16e3e713cd5403e`. Onay ve uygulama aynı dosya içeriğine bağlanmalı; operatör hedef dosyayı yeniden hash’lemelidir. Preview SQL SHA256 önceki commit ile aynıdır: `134e3cf23a736c9868dc8dc409293ddd72478de080a23f86c7e2b2f1c8e11786`.

Gerçek canlı metadata/SQL, müşteri kaydı, tahsilat, yedek/restore, main merge veya production deploy yapılmadı. Bu bölüm canlı yetki/RLS doğrulaması anlamına gelmez.

Onay A formu (henüz doldurulmadı): hedef proje, migration SHA256, canlı şema parmak izi, yedek/restore kanıt referansları, operatör, bakım penceresi ve açık yönetici uygulama onayı.
Onay B formu (henüz doldurulmadı): incelenen commit, main merge ve production frontend deploy için ayrı açık onay.
Onay C formu (henüz doldurulmadı): deploy sonrası salt-okunur kontroller, izinli gerçek görsel/izin kanıtı, ticari teyitler ve ürün aktivasyonu için ayrıca açık onay.
