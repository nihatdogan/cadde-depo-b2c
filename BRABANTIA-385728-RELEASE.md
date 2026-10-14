# Brabantia 385728 — yayın hazırlığı

## Ticari kayıt
- SKU: BRABANTIA-385728; beyaz; kategori EV / YAŞAM → Ev Gereçleri.
- Bir adet: **3.619₺ KDV dahil**; kargo ayrı, montaj dahil değil.
- ORDER_ON_DEMAND; fiziksel stok 0; aktif katalog hedefi. Eski fiyat NULL, indirim yok.
- max_stok=1 yalnız mevcut şemanın pozitif teknik paydasıdır; stok vaadi veya tedarikçi stoğu değildir. Bu ürünün sayaçları vitrinde gösterilmez.

## Değişiklikler
- index.html: kategori filtrelerinde tedarik kartı, ayrı talep CTA, kargo/montaj açıklamaları; genel ücretsiz kargo eşik duyurusu kaldırıldı. Mevcut stoklu kartlar ve sepet korunur; eski sepetteki tedarik ürünü ödeme akışına giremez.
- urun.html: tedarik rozeti, stoktan bağımsız talep akışı, koşullar ve görsel izni eksikliği.
- on-demand.js: talebi RPC ile kaydeder, talep numarasıyla WhatsApp yazışmasını açar. Mesaj otomatik gönderilmez; WhatsApp açılması satış veya müşteri kabulü değildir.
- admin.html / supply-admin.js: talepler sipariş/cirodan ayrı; maliyetler ve teyit kanıt referansları yalnız yönetici alanında.
- supabase/order-on-demand.sql: ürün seed, ayrı talep/maliyet tabloları, RLS, yetkili RPC, kesinleştirme ve fiyat korumaları.
- package.json / package-lock.json / tests/supply.test.cjs: yerel PostgreSQL (PGlite) ve vitrin davranış testleri. .gitignore: yerel bağımlılıklar.

## Tedarik ve katkı kontrolü
1. Talep kaydı bir adet ürün fiyatının anlık görüntüsünü saklar. Kesin sipariş veya tahsilat oluşturmaz.
2. Yetkili yönetici toptan alış (KDV hariç), teyit edilmiş satış KDV oranı, giriş nakliyesi, komisyonlar, paketleme/operasyon, net çıkış kargo gideri, reklam, beklenen iade/hasar/garanti ve minimum kabul edilen katkıyı girer. Bilinmeyen değer boş kalır; doğrulanmış gerçek sıfır ayrıca girilir.
3. Katkı = 3619 / (1 + teyitli KDV oranı) − tüm belirtilen net giderler. Kargo geliri ayrı tutulur; kargo fazlası ürün marjına eklenmez. Net kargo gideri negatif olamaz. Eksik maliyette kâr gösterilmez; katkı pozitif ve yönetici eşiğine eşit/üstünde olmalıdır.
4. Kargo bedeli ve teslimat koşulları kaydedilir; güncel tedarikçi stoku ve montaj/iki duvar uygunluğu yazışma referansıyla teyit edilir. Stok teyidi 24 saat geçerlidir; sonra tekrar teyit gerekir.
5. Müşterinin ürün fiyatı + ayrı kargo + teslimat + montaj hariç koşullara kabulü referansıyla kaydedilir. Maliyet veya koşul değişikliği stok ve müşteri kabul teyitlerini sıfırlar.
6. Kesinleştirme RPC’si tüm koşulları veritabanında denetler; yalnız yönetici eylemiyle orders/order_items kaydı oluşturur ve maliyet/koşul/kanıt/kullanıcı anlık görüntüsünü saklar. Tekrarlanan çağrı aynı siparişi döndürür. Otomatik tahsilat kodu yoktur.
7. Stok sağlanamıyorsa müşteri bilgilendirme referansıyla talep durdurulur; kesinleştirilemez.

## Teknik kaynak ve görsel
Üretici: https://www.brabantia.com/uk/pull-out-clothes-line-22-metres-white/
Teknik veri sayfası: https://sales.brabantia.com/Articles/385728.pdf
Doğrulanan: model 385728, beyaz, 22 m, iç mekân, en fazla 4,4 m iki duvar aralığı. Türkiye garantisi veya tedarikçi stoku çıkarımı yapılmadı.
Fotoğrafın ticari yeniden kullanım izni doğrulanamadı. Görsel eklenmedi; PENDING_PERMISSION ve müşteriye açıklama mevcut. İzinli gerçek görsel tedarikçiden alınmalı; yönetici yüklemeli ve izin kaydı saklamalı.

## Yönetici onayına sunulacak yayın adımları
1. Canlı şemayı yedekleyin ve staging üzerinde doğrulayın. Bu migration canlıda çalıştırılmadı.
2. Önkoşullar: supabase-schema.sql içindeki products/orders şeması; supabase-admin.sql, supabase/products-detail.sql ve supabase/products-slug.sql. Farklı taslak olan supabase/schema.sql kullanılmaz. Eski seed dosyalarını mevcut canlıya yeniden çalıştırmayın.
3. Yalnız güvenilir yöneticinin Supabase app_metadata.role alanını sunucu/Dashboard üzerinden admin yapın, oturumu yenileyin. user_metadata veya istemci bilgisine güvenilmez. Mevcut geniş authenticated ürün/sipariş yetkileri değiştirilmedi; yeni hassas tablolarda yalnız app_metadata yönetici rolü geçerlidir.
4. Onaylanan supabase/order-on-demand.sql dosyasını önce uygulayın; ardından frontend'i yayımlayın. RPC yoksa talep kaydı başarısız olur ve kesin sipariş oluşmaz.
5. Staging: kategori filtresi → 3.619₺ → talep → WhatsApp → admin maliyet/teyit → eksik/negatif engel → müşteri kabulü → tek kesin sipariş. Normal stoklu sepeti ayrıca kontrol edin. Gerçek WhatsApp gönderimi ve canlı ödeme yapılmadı.
6. main birleştirme ve production deploy için yönetici onayı alın. Yerel testler canlı RLS, hesap rolü, tarayıcı görünümü ve gerçek tedarikçi erişiminin uçtan uca doğrulamasının yerini tutmaz.

## Geri alma
Frontend'i önce önceki sürüme döndürmek bu ürün için eski sıfır stok görünümünü getirir; yeni talep alımını durdurmak için ürün aktifliğini kapatın. Kanıt ve maliyet tablolarını silmeyin; kesinleşmiş siparişleri veya stok sayaçlarını geriye dönük değiştirmeyin.

## Bekleyenler
Canlı şema ve yetkili yönetici rolü; toptancı teklif/stok teyidi, gerçek maliyetler ve kabul edilebilir minimum katkı; kargo ve teslimat; müşterinin montaj uygunluğu; görsel kullanım izni; staging ve yönetici canlı yayın onayı. Ürün fiyatı yeniden onay beklemiyor.

## Yerel test sonucu
`npm test`: 13/13 geçti. Gerçek PostgreSQL motoru PGlite üzerinde migration iki kez uygulandı; RLS ve anon/normal kullanıcı/yönetici ayrımı, eksik ve negatif katkı, eksik veya eskimiş teyitler, stok yok, tek seferlik kesinleştirme, sabit fiyat, ayrı kargo, eski sepet engeli, mevcut stoklu satış ve DOM tabanlı katalog/detay davranışları doğrulandı. JavaScript sözdizimi ve git diff --check temiz. Tarayıcıda görsel QA ve staging entegrasyonu yapılmadı.
