# Cadde Depo — canlı RLS ve sipariş güvenliği hazırlığı

Referans: 294b0a7. Dal: codex/brabantia-385728-on-demand.

**Nihai durum: canlı bulgular DÜZELTME GEREKLİ; uygulama kararı VERİ BEKLE.** Bu çalışma yalnız kod/SQL hazırlığı ve izole testtir. Canlı SQL, main merge, production deploy, gerçek müşteri testi/tahsilatı veya Brabantia aktivasyonu yapılmaz. Yeni Supabase projesi kurulmaz; Preview’ın canlı projeye bağlanma engeli korunur.

## 1. Doğrulanmış bulgular ve eksik canlı kanıt

Yönetimin bu görevde bildirdiği salt-okunur canlı SQL sonuçları kanıt kabul edilmiştir; tarafımdan canlı SQL tekrar çalıştırılmamıştır:

| Canlı bulgu | Etki |
| --- | --- |
| products/orders/order_items: anon ve authenticated için tüm temel tablo izinleri | Gereğinden geniş ACL; RLS ile gereksiz izinler birbirini telafi etmez. TRUNCATE gibi işlemler ayrıca ele alınmalıdır. REST tablo API’si tek başına TRUNCATE sunmaz; fazla DB yetkisi yine de kaldırılır. |
| products authenticated ALL / true | Normal giriş yapan kullanıcı fiyat, stok, kondisyon, aktiflik ve ürün yönetimini değiştirebilir. |
| orders authenticated SELECT / true, UPDATE / true | Sipariş görünürlüğü ve durum/toplam değişiklikleri yöneticiye bağlı değildir. |
| order_items authenticated SELECT / true | Kalemler yönetici rolüyle sınırlandırılmamıştır. |
| orders/order_items anon + authenticated INSERT / true | Tarayıcı fiyat ve kalemi seçebilir; iki ayrı INSERT kısmi kayıt bırakabilir. |
| RLS etkin | Tek başına yeterli değildir; mevcut politikalar fazla izinlidir. |

Repository incelemesi ayrıca eski frontend’in toplam/fiyatı tarayıcıdan gönderdiğini, Supabase INSERT sonuçlarındaki error alanlarını kontrol etmeden WhatsApp açabildiğini ve admin ekranının yalnız session varlığıyla açıldığını doğruladı. Görsel upload API’si production’da rol yerine isteğe bağlı e-posta listesine dayanabiliyordu.

**Henüz doğrulanmayanlar:** tam canlı kolon/tip/FK/indeks/trigger/RPC tanımları ve EXECUTE ACL’leri; Storage.objects/buckets politikaları ve bucket ayarları; column/default ACL’ler; rol üyelikleri/BYPASSRLS ve Data API exposed schema listesi; Auth kullanıcılarının gerçek yönetici atamaları, ban/silinme durumu ve Auth metadata yazma izinleri; mevcut stok düşme davranışı; legacy bekleyen siparişlerin fiziksel stok mutabakatı; yedek/restore kanıtı. `supabase/production-readonly-audit.sql` bunların metadata kısmı için genişletildi, canlıda çalıştırılmadı. Kimlik, parola, token ve müşteri satırları alınmaz. Fonksiyon tanımlarında gömülü sır bulunabileceğinden gerçek çıktılar özel alanda incelenmeli, ham olarak Git’e/chat’e konmamalıdır.

## 2. Yetki modeli ve değişecek izinler

`public.is_cadde_admin()` yalnız JWT app_metadata.role=admin, gerçek auth.uid ve aynı Auth satırındaki güncel raw_app_meta_data.role=admin birlikte doğruysa true döner. Silinmiş veya halen banlı kullanıcı reddedilir. user_metadata, istemci beyanı ve e-posta listesi yönetici yetkisi vermez. Rol kaldırıldığında eski JWT tek başına yeterli olmaz.

| Alan | Anon | Normal authenticated | Doğrulanmış admin |
| --- | --- | --- | --- |
| products | Yalnız aktif SELECT | Yalnız aktif SELECT | SELECT/INSERT/UPDATE/DELETE; Brabantia korumaları ayrıca geçerli |
| orders | Doğrudan okuma/yazma yok | RLS ile görünmez; INSERT/DELETE yok | SELECT; güvenli durum RPC’si; korunmuş alanlar değişmez |
| order_items | Doğrudan işlem yok | Okuma görünmez; DML yok | SELECT; doğrudan INSERT/UPDATE/DELETE yok |
| checkout_requests | Yok | Yok | Salt-okunur kayıt/kanıt görüntüleme |
| tedarik maliyetleri | Yok | Yok | Güncel admin denetimiyle mevcut kontrollü RPC/okuma |
| urunler Storage objeleri | Listeleme/yazma/silme yok | Listeleme/yazma/silme yok | Bucket kapsamında CRUD |

Commerce tablolarında PUBLIC/anon/authenticated tablo **ve kolon** izinleri temizlenip gerekli dar izinler yeniden verilir. Yönetici ürün DML’si authenticated tablo yetkisi + admin RLS birlikteliğiyle çalışır. Sipariş INSERT yalnız güvenli RPC’nin sahibi üzerinden yapılır; API’ye doğrudan RPC çağrı yetkisi sadece server service_role’a verilir. Sipariş/item trigger’ları eski ayrıcalıklı RPC ile yazma girişimlerini de sınırlar.

Storage’da diğer bucket’ların politikaları silinmez. `urunler` için restrictive politika eski geniş permissive politikaların üstüne AND koşulu koyar; ayrıca admin permissive politika eklenir. Gereksiz Storage TRUNCATE/TRIGGER/REFERENCES izinleri kaldırılır. Public bucket’ın mevcut gerçek dosya URL’leri public kalır; metadata listeleme ve yükleme/silme bundan ayrıdır. [Supabase public bucket davranışı](https://supabase.com/docs/guides/storage/buckets/fundamentals).

İncelenmemiş uygulama RPC’si anon/authenticated tarafından çağrılabiliyorsa (yalnız SECURITY DEFINER olanlar değil) cutover durur. Bilinen saf pgcrypto/uuid-ossp extension üyeleri ayrı tutulur. Bilinmeyen fonksiyonlar körlemesine silinmez veya geniş yetkiyle bırakılarak başarı ilan edilmez. Auth metadata yazma veya uygulama rolünde service_role üyeliği/BYPASSRLS/owner/inherited TRUNCATE tespit edilirse de geçiş durur.

## 3. Güvenli sipariş akışı

1. Tarayıcı yalnız ürün ID/adet, tür, rastgele talep anahtarı ve bot doğrulama token’ı gönderir; fiyat/toplam kabul edilmez.
2. `/api/checkout` yalnız aynı site origin’ini ve Vercel’in sağladığı tek geçerli IP başlığını kabul eder; client actor/IP alanı kabul etmez. Turnstile token’ı sunucuda success + hostname + action doğrulamasından geçer. [Vercel başlık davranışı](https://vercel.com/docs/headers/request-headers), [Turnstile doğrulama](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
3. Sunucu IP’yi ayrı HMAC sırrıyla anonimleştirilmiş actor anahtarına çevirir; ham IP DB’ye veya müşteriye gönderilmez. Secret anahtarlar hiçbir public config/HTML/JS yanıtına konmaz.
4. `create_checkout_request` yalnız service_role’a açıktır. Aynı transaction’da ürünleri ID sırasıyla kilitler, aktiflik/tür/stok/fiyat kontrolü yapar ve DB fiyatından sipariş + kalem + receipt oluşturur. Kalem hatası başlığı ve talep anahtarını da geri alır.
5. Aynı actor + anahtar + kanonik sepet tekrarında aynı receipt döner; farklı sepet/actor aynı anahtarı kullanamaz. Başarılı yeni taleplerde actor başına 5/10 dakika ve toplam 120/dakika kotası aynı transaction lock altında uygulanır. Taslak sınırlar yayın öncesinde trafik/NAT/iş ihtiyacına göre onaylanmalıdır.
6. Talep stok ayırmaz, fiziksel stoğu düşürmez ve tahsilat değildir. Böylece anonim talepler gerçek stoğu rezerve ederek tüketemez. UI ve WhatsApp metni bunu açıkça belirtir. Fiyat/isim/toplam WhatsApp’a server receipt’inden taşınır.
7. Stoklu kesinleştirmede admin RPC’si 15 dakikalık teklif geçerliliğini, yazılı kabul referansını, güncel fiyatı/aktifliği ve stoğu tekrar kontrol eder; ürünleri aynı sırada kilitleyip stoğu bir kez düşer. Yarışan iki teyit son adedi birlikte satamaz. Tekrar durum çağrısı ikinci stok düşümü yapmaz. İptal fiziksel iade gerçekleşmiş gibi otomatik stok artırmaz.
8. Tedarik ürününde aynı server kapısı yalnız bir adet ORDER_ON_DEMAND talebi açar. Kesin sipariş mevcut ayrı supplier/maliyet/katkı/kargo/teslimat/yazılı kabul denetimli finalizer’dan geçer. Fiziksel stok 0 ve 3.619₺ korunur; otomatik aktifleştirme yoktur.

Taslak 15 dakika bir satış/teslimat taahhüdü değildir; operasyon onayı bekleyen güvenlik sınırıdır. CAPTCHA/üçüncü taraf servis, doğru domain/sitekey, HMAC üretimi, Vercel ingress davranışı ve WAF/edge kotaları gerçek ortamda ayrıca doğrulanmalıdır. Dağıtık botlar, ortak NAT ve geçersiz istek DDoS’u yalnız DB kotasıyla çözülmüş sayılmaz. Provider/DB erişilemiyorsa akış kapalı kalır; eski doğrudan yazmaya fallback yoktur.

## 4. Değişen frontend/backend dosyaları

- index.html: tarayıcıdan orders/order_items INSERT kaldırıldı; güvenli gateway ve server receipt; hata olursa WhatsApp siparişi açılmaz.
- urun.html/on-demand.js: tedarik talebi aynı server gateway’i kullanır.
- checkout-client.js: doğrulama widget’ı, kanonik sepet ve session bazlı idempotency; secret içermez.
- admin-access.js, admin.html, admin-gorsel.html: fresh Auth kullanıcı + DB rol kontrolü olmadan yönetim verisi yüklenmez. Admin olayları Supabase auth callback’i dışında çalışır. Normal session yeterli değildir.
- admin.html: sipariş durumu güvenli RPC ile güncellenir; kabul referansı istenir; eski bekleyen talep mutabakat uyarısıyla işaretlenir.
- api/admin/upload-product-image.js: bütün ortamlarda güvenilir rol + kullanıcı token’ıyla DB admin doğrulaması; allowlist tek başına yetki vermez. Admin frontend’lerinin doğrudan Storage SDK kullanımı da DB politikalarıyla korunur. Görseli galeriden kaldırmak referansı kaldırır; gerçek Storage silme yetkisi ayrıca RLS’de admin’e bağlıdır.
- api/checkout.js, api/public-config.js, lib/supabase-environment.cjs: sadece public sitekey istemciye; server secrets yalnız Function içinde. Production URL sabit mevcut projedir; Preview canlıya geçemez.
- vercel.json: HTML ve değişen auth/checkout script’lerinde no-store. Önceden açık eski sekmeler yine kontrollü yenilenmelidir.
- supabase/security-foundation.sql ve security-cutover.sql; production-readonly-audit.sql ve Brabantia production migration’ının yeni rol modeliyle uyumu; izole testler. pg yalnız isteğe bağlı yerel çok oturumlu testin geliştirme bağımlılığıdır.

## 5. Geriye uyumlu geçiş ve açık onaylar

**A — Hazırlık migration’ı:** gerçek metadata/backup/restore/stock-trigger incelemesi ve mevcut admin UUID’lerinin doğrulanması olmadan çalışmaz. Yeni helper/tablo/RPC’leri ekler; eski commerce politikalarını ve doğrudan yazma izinlerini kaldırmaz. Dolayısıyla A tek başına canlı açıkları kapatmaz. Bilinmeyen stok trigger’ı varsa çift sayım riski nedeniyle durur.

**B — Yeni frontend/backend:** ayrı onayla yeni sürüm ve gerçek bot/HMAC ayarları kurulur. Mevcut admin’lerin fresh token ile ürün/sipariş/Storage/maliyet erişimi doğrulanır. Bu görevde deploy veya gerçek müşteri kaydıyla test yapılmadı. Yeni endpoint’in gerçek ortam doğrulaması için gerçek müşteri verisiyle sahte sipariş oluşturulmaz; onaylı izole fixture/çevrimdışı veya ayrı açık test planı gerekir. Kalıcı müşteri verisiyle deneme yapılamaz.

**C — Yetki cutover:** yeni sürüm hazır, yöneticiler doğrulanmış, legacy pending stok mutabakatı tamamlanmış ve gözlem kayıtları mevcut olduktan sonra security-cutover.sql için ayrı uygulama onayı alınır. Bu dosya önce kanıtları kontrol eder, sonra geniş tablo/kolon izinlerini ve permissive politikaları değiştirir. Tekrar çalıştırma kayıt çoğaltmaz veya eski geniş izinleri geri açmaz.

| İstemci | A sonrası / C öncesi | C sonrası |
| --- | --- | --- |
| Eski doğrudan INSERT frontend | Çalışır; eski açıklar sürer | Bilinçli olarak reddedilir; yeniden yükleme gerekir |
| Yeni güvenli frontend | Gateway hazırsa çalışır | Gateway üzerinden çalışır |
| Eski bekleyen sipariş | Veri korunur | Otomatik kesinleştirme stok mutabakatı ister; iptal mümkün |
| Önceden kesinleşmiş eski sipariş | Korunur | Admin RPC ile kargo/teslim devam eder |
| Brabantia | Pasif seed; ayrı ticari kontrol | Fiyat/tedarik korunur; ayrıca aktivasyon onayı gerekir |

Eski tarayıcı INSERT’lerini reddedip aynı eski kodu değişmeden çalıştırmak aynı anda mümkün değildir. Cache temizliği, aktif sekme yenilemesi ve kısa kontrollü geçiş penceresi gerekir. Eski bekleyenlerin ne zaman stok düşürdüğü bilinmeden otomatik taşıma/decrement yapılmaz. Mevcut gerçek kayıtlar silinmez veya sahte kalemlerle yeniden yazılmaz.

## 6. Eksik üretim ayarları ve role doğrulama planı

Production Vercel’de mevcut SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY sunucu kapsamındadır. Hazırlanan gateway için CHECKOUT_ENABLED=true, CHECKOUT_TURNSTILE_SITE_KEY (public), CHECKOUT_TURNSTILE_SECRET_KEY (secret), CHECKOUT_ACTOR_HASH_SECRET (en az 32 karakter, kriptografik rastgele secret) gerekir. Henüz hiçbiri bu görevde tanımlanmadı. Turnstile entegrasyon tercihi ve operasyonel eşikler yönetim onayı bekler. Preview’a canlı değer kopyalanmaz; yeni Supabase projesi kurulmaz.

Yönetici planı:
1. Gerçek admin hesaplarının UUID’lerini yetkili özel kayıtla doğrulayın; kullanıcı e-postalarını veya token’larını Git’e koymayın.
2. Atamalar yalnız Dashboard/korumalı Admin API üzerinden yetkili kişi tarafından yapılır. Bu paket kimseye otomatik admin atamaz.
3. Auth metadata/grant/rol üyeliklerini, silinme/ban durumunu ve oturum yenilemesini kontrol edin. JWT’deki role ile güncel Auth kaydı birlikte doğru olmalıdır.
4. En az bir gerçekten doğrulanmış aktif admin; mümkünse yönetici tarafından onaylanmış kurtarma hesabı. Ürün/sipariş/durum/Storage/maliyet kontrolleri ve ayrı normal kullanıcı negatif testi özel ortamda tamamlanır.
5. Her iki SQL aşaması `admin_role_verification_ref` ve `verified_admin_ids` ister; kayıtlar kaynak metadata ile eşleşmezse durur. B ve C için frontend/endpoint/mutabakat kanıtları ayrıca gerekir. Kanıt referansı yazmak gerçek kontrolün yerine geçmez.
6. Uygulama esnasında hesap/rol ve şema değişikliklerini kontrollü dondurun; değişim varsa taze audit/fingerprint ve onay gerekir.

## 7. Yedek ve geri alma

PRODUCTION-BACKUP-ROLLBACK.md koşulları geçerlidir: gerçek, erişilebilir ve geri yüklenmesi doğrulanmış yedek; özel şifreli saklama; metadata/SQL SHA256; son gerçek siparişlerle mutabakat. PGlite başarısı restore kanıtı değildir.

C öncesinde yeni sürüm sorunu varsa ayrı onayla eski frontend’e dönülebilir; eski riskler hâlâ sürdüğünden bu güvenli son durum sayılmaz. C sonrasında ALL/true veya anon INSERT’leri otomatik geri açmayın ve eski frontend’e dönmeyin. Yeni endpoint’i CHECKOUT_ENABLED=false içeren onaylı yeni deployment/WAF müdahalesiyle durdurup son güvenli frontend’i koruyun; mevcut admin teslimat işlemlerini sürdürün. Vercel env değişikliği mevcut deployment snapshot’ına anında yansımaz.

DB tabloları, gerçek sipariş/kalemler, kabul kanıtı, actor/idempotency ve maliyet snapshot’ları korunur; DROP/DELETE/TRUNCATE veya stok geri yazma rollback’i hazırlanmadı. Tam DB restore daha sonraki gerçek siparişleri kaybettirebileceğinden ayrıca olay müdahalesi/onay/mutabakat gerektirir. Yeniden açma düzeltme + taze kanıt + açık onayla yapılır.

## 8. Testler ve nihai kapı

Komut: `node --test --test-concurrency=1 tests/*.test.cjs`. PGlite gerçek PostgreSQL semantiğini tek oturumda çalıştırır; Promise.all ile seri motor üzerinde yapılan yarış testi gerçek iki oturum testi sayılmaz.

Gerçek çok oturumlu test ayrıca hazırdır: `tests/concurrency.test.cjs`. Yalnız loopback host, boş `cadde_security_test_*` DB ve LOCAL_SECURITY_TEST_ISOLATED=yes ile çalışır; LOCAL_SECURITY_TEST_URL yoksa açıkça SKIP olur. Sunucu/ayrı yerel test instance’ı bu görevde kurulmadı. DB bağlantı parolası yalnız yerel gizli env’de tutulur. Test yalnız sentetik fixture kullanır ve veri silen otomatik temizlik yapmaz. Cloud/Supabase production veya dolu DB’ye bağlanmayı reddeder.

Canlı Storage/RPC/trigger/rol doğrulaması, gerçek admin erişimi, gerçek bot/ingress/endpoint kontrolü, gerçek iki oturum testi ve yedek/restore kanıtı olmadan **YAYINA HAZIR veya uygulama onayı verilmez**. Hazırlık paketi bu kontrolleri ve ayrı yönetici SQL/main/deploy/aktivasyon onaylarını bekler.

Data API exposed schema listesi ayrıca doğrulanmalı; pg_catalog veya Auth yönetim şemalarının istemciye/RPC’ye açık olması kabul edilmez. Rol kalıtımıyla service_role EXECUTE kazanılması her iki migration aşamasında ayrıca reddedilir.

## Son izole test sonucu ve dosya özetleri

Tam paket: **87 test; 86 geçti, 0 hata, 1 SKIP**. Atlanan test yalnız gerçek iki PostgreSQL oturumu testidir; yerel sunucu/bağlantı tanımlı değildir. Bu sınır yayın kapısını açık bırakır.

| Kapsam | Geçen test |
| --- | --- |
| Gateway, origin/ingress, bot doğrulama, secret/rol ve durum ekranı sınırları | 12 |
| Checkout istemcisi, UUID tekrarı ve server receipt | 3 |
| Runtime ortam ayrımı ve Preview koruması | 17 |
| Brabantia production taslağı ve veri korunumu | 22 |
| İki aşamalı RLS/ACL/Storage/sipariş/stok/legacy güvenliği | 18 |
| Önceki tedarik/vitrin davranışları | 14 |

Yeni header/item atomikliği, aynı anahtarda tek kayıt, bozuk sepet/yanlış stok/price injection, CAPTCHA action+hostname, role revocation/user_metadata taklidi, doğru bucket kapsamı, mirasla service_role kazanımının reddi, eski ayrıcalıklı RPC bypass engeli, quote expiry ve veri saklama kontrol edildi. Gerçek Vercel/Supabase/Cloudflare bağlantısı veya gerçek müşteri/tahsilat testi yapılmadı.

İncelenecek migration SHA256 özetleri (uygulamadan önce hedef dosyada yeniden doğrulanmalıdır):

- `supabase/security-foundation.sql`: `6d69c6c243bf121ef12d23600c3d0b96fefb70748718327d6d8ee0bf79586012`
- `supabase/security-cutover.sql`: `104dd735e0965e9d57bc1d1c83a70fbc2b8c72539cc5d3f090b3e43c8822b6a4`
- `supabase/order-on-demand.production.sql`: `4b4659b3a6341b07df84a11831bef9faa7762794d229b7defbc201e1d25212c2`

Bu özetler, placeholder kanıt referansları veya yerel test başarısı uygulama onayı değildir. Canlı SQL/main merge/deploy/ürün aktivasyonu için ayrıca açık yönetici onayı gerekir.

Ek canlı kolon kontrolü: products içinde geçmişten kalan alış maliyeti veya özel alanlar bulunuyorsa public SELECT kapsamı ayrıca daraltılmalıdır. Yeni maliyetler ayrı admin tablosundadır; bilinmeyen canlı kolonların güvenli olduğu varsayılmaz.

Yönetici durum ekranında reddedilen veya ağda başarısız olan işlemden sonra kayıtlar DB’den yeniden yüklenir; seçilen ama kaydedilmemiş durum kesinleşmiş gibi bırakılmaz. Eski kesinleşmiş siparişlerin kargo/teslim geçişi ayrıca sentetik fixture ile doğrulandı.
