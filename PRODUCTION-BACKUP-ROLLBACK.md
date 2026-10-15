# Production yedek, geri yükleme kanıtı ve veri koruyan geri alma

Durum: YALNIZ HAZIRLIK. Canlı yedek alınmadı, restore doğrulanmadı, SQL uygulanmadı. Yeni Supabase projesi oluşturulmayacak. Proje: svyqmmivhpfiuhxnmhny.

## Uygulama öncesi zorunlu kanıt

Yetkili operatör aşağıdaki kayıtları özel ve erişimi sınırlı alanda tamamlamalıdır. Gerçek dump, müşteri verisi, bağlantı parolası veya service-role anahtarı bu repository’ye/chat’e konmaz.

1. Gerçek ortam/DB rolü, yedek zamanı, son sipariş referansı/zamanı ve bakım penceresi; salt-okunur ürün/sipariş/kalem toplamları ve metadata parmak izi. Aktif sipariş hareketi varsa sayılar arasındaki farklar gerçek siparişlerle mutabık olmalı; sayının değişmesi otomatik hata değildir.
2. Mevcut Supabase planında erişilebilen yedek/PITR türü ve geri dönüş noktası. Yedek var sayılmaz; gerçekten erişilebilir olduğu ve kapsamı kontrol edilir. [Supabase yedek belgeleri](https://supabase.com/docs/guides/platform/backups).
3. Yetkili araçla tutarlı, uygulama öncesi DB yedeği: şema, veriler, roller/grant/RLS/trigger/RPC ve ilgili auth bağımlılıkları. Dump aracının kapsam/dışlamaları kontrol edilir; migration geçmişi ve Storage dosyaları gibi DB dışı içerikler ayrıca ele alınır. Mevcut fotoğraf dosyaları ve kullanım izinleri ayrıca korunur. [Resmî yedek/restore rehberi](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
4. Şifreli saklama, SHA256, erişim sorumlusu, saklama/temizleme süresi. Özet ve kanıt referansı rapora; dump özel alana. SQL dosyası özeti ayrıca alınır; onay farklı içerikle tekrar kullanılamaz.
5. Aynı yedeği erişimi kontrollü yerel, Supabase bağımlılıklarıyla uyumlu bir PostgreSQL ortamında geri yükleyip okunabilirlik, şema, tablo sayımları ve RLS/rol/işlev bağımlılıklarını doğrulayın. Yeni bulut/Supabase test projesi açılmaz. Gerçek yedek kişisel bilgisayarda gelişigüzel çoğaltılmaz; onaylı veri işleme koşulları sağlanmalıdır. PGlite sentetik testleri gerçek yedeğin geri yüklenebildiğinin kanıtı değildir.
6. `verified_backup_ref` ve `restore_verification_ref`: gerçekten doğrulanmış kanıtın özel kayıt referansı, operatör ve doğrulama zamanı. Bu değerleri sırf SQL kapısını geçmek için uydurmayın.

Gerekli araç/erişim veya güvenli yerel restore ortamı yoksa VERİ BEKLE; canlı migration uygulanmaz.

## Normal geri alma: ürünü kapat, gerçek kayıtları koru

Sorun halinde önce yeni tedarik taleplerini durdurmak için ayrıca yönetici geri alma onayı alınır. `supabase/production-pause-brabantia.sql` hedef proje ve rollback_approval_ref ister; transaction içinde yalnız kontrol bayrağını kapatır ve Brabantia `aktif=false` yapar.

- Sipariş, kalem, müşteri kabulü, maliyet, snapshot, ürün veya denetim kaydı silinmez.
- Stok geri yazılmaz, teslim edilmiş siparişler yok sayılmaz, ürün normal stoğa çevrilmez.
- Yeni talepler/henüz kesinleşmemiş tedarik işlemleri ürün pasif olduğu için durur. Önceden kesinleşmiş gerçek siparişler operasyonel olarak takip edilmeye devam eder.
- Önceki bilinen çalışan frontend sürümüne dönmek için ayrı production deploy onayı gerekir. Eklenen DB kolon/tablo/korumaları yerinde tutulur; çalışan veri için schema-down yapılmaz.
- Geri alma öncesi/sonrası sayaçlar ve gerçek sipariş kimlikleri özel ortamda mutabık tutulur; aradaki meşru trafik açıklanır. Yeni maliyet/snapshot kayıtları korunur.
- Yeniden açma yeni yayın/görsel/teyit değerlendirmesi ve Onay C gerektirir. Production migration’ı tekrar çalıştırmak ürünü açmaz.

## Migration hatası

Migration tek transaction’dır. SQL/lock/statement timeout hatasında commit edilmez; operatör hata ve rollback durumunu doğrular. Körlemesine tekrar çalıştırılmaz: yeniden salt-okunur audit ve parmak izi ile neden incelenir. Verilen idempotence desteği hatalı canlı şemayı zorlayarak geçme izni değildir.

## Ağır olayda yedekten geri dönüş

Tam DB restore normal feature rollback değildir. Yedek anından sonra gelen gerçek siparişleri kaybettirebilir. Bu nedenle bu pakette otomatik full-restore veya DROP/DELETE komutu yoktur. Gerekirse yeni değişiklikler kontrollü durdurulur; yedek sonrası gerçek sipariş/ödeme/kargo kayıtları korunup mutabakat planı hazırlanır; yalnız ayrı olay müdahalesi ve açık yönetici onayıyla restore kararı verilir. Öncelik veri koruyan onarım ve forward rollback’tir.

## Yerel doğrulama kapsamı

Sentetik PostgreSQL testleri migration öncesi ürün/sipariş/kalem/sayaçları, eski RLS politikalarının korunmasını, pasif seed’i, tekrar uygulamayı ve pause sonrasında tüm sipariş/maliyet/snapshot kayıtlarının kalmasını kontrol eder. Gerçek yedek ve canlı şema bu testlerle doğrulanmış sayılmaz.
