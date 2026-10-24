# CADDE DEPO — CANLI SİPARİŞ / STOK MUTABAKATI (OKUMA KANITI)

**Tarih:** 24 Ekim 2026 · **Karar:** VERİ BEKLE / fiziksel stok doğrulaması.  
**Kaynak:** Production Supabase `svyqmmivhpfiuhxnmhny` SELECT sorguları; `main` yönetim paneli dosyası ve aynı tarihteki ürün yedeği. **Production'da yazma yapılmadı.**

## Sistemdeki kayıtlar
- SKU **#29 — Yağmur Sandıklı Köşe Koltuk**
- Ürün tablosu `stok=5`, `max_stok=5`, outlet fiyatı **35.000 TL**.
- 7 Ekim 2026 tarihinde aynı ürüne ait **4 sipariş**, her biri **1 adet**, tutar **35.000 TL**: `whatsapp_bekliyor=3`, `teslim=1`.
- `products_backup_20261007` SKU #29 stok **5** gösteriyor; güncel tablo da **5** gösteriyor.
- Mevcut Production `admin.html` içindeki `setStatus`: yalnızca `orders.durum` alanını UPDATE ediyor, stok değiştirmiyor. `orders/order_items/products` üzerinde kullanıcı tanımlı stok trigger'ı bulunmadı.
- **Sonuç:** Teslim edilen 1 adet için *bu akış içinde* otomatik stok düşümü kanıtlanmadı. Buna rağmen manuel stok düzeltmesi veya teslimatın fiilen gerçekleştiği bağımsız kanıtlanmış değildir.

## Doğrulama eksikleri
1. **Fiziksel ürün sayımı:** mağaza + depo + ayrılmış/emanet/hasarlı adet, sayım tarihi ve sorumlu.
2. **Teslim siparişi:** irsaliye / kargo / müşteriye teslim kanıtı, ürün stokundan manuel düşüm olup olmadığı.
3. **3 bekleyen sipariş:** gerçek müşteri talebi mi, test mi; teyitli rezervasyon, tahsilat ve iptal/tekrar durumu (kişisel veriyi bu rapora koyma).

## Senaryo tablosu (hesap, gerçek stok iddiası değil)
| Senaryo | Hesap | Sonuç |
|---|---|---|
| 5 adet sistemdeki fiziksel sayımın kendisi ise | 5 - **ayrılacak kesin siparişler** | Satışa açık miktar sipariş mutabakatına bağlı |
| 5 adet teslimat öncesi başlangıç stoğu ve teslim 1 adet doğrulanırsa | 5 - 1 = 4 | Diğer 3 bekleyen talep ayrıca teyit edilir |
| Üçü de gerçek ve ayrılacak sipariş, 1 teslim, sayım öncesi stok 5 ise | 5 - 1 - 3 = 1 | **Sadece varsayımsal** satışa açık adet |

**Kesin sayı üretilemez:** yalnızca veri tabanı toplamlarından fiziksel eldeki / satılabilir stok belirlenemez. **İşlem önerisi:** SKU #29 için sayım ve sipariş teyidi bitene kadar yeni stok rezervasyonu/garanti edilmiş adet sözü verme; mevcut müşterinin siparişini silme veya değiştirip stok düzeltme yapma.

## Durum sonrası güvenli kayıt
Sayım ve teslim evrakı sorumlu tarafından doğrulandıktan sonra yeni `legacy` uzlaştırma tablosu/olayı için ayrı, onaylı migration tasarlanır. Eski siparişlerde `stok_rezerve=NULL` ve `UNTRUSTED_ORDER_SOURCE` korumaları otomatik değiştirilmez.

**Sorumlular:** Operasyon / depo sayımı; satış destek / sipariş teyidi; DB sorumlusu / mutabakat tasarımı. **Başarı:** ürün hareketleriyle fiziksel stok, tahsilatlar ve 4 sipariş durumu bağımsız belgelerle uzlaştırılmıştır.

---

## 24 Ekim 2026 — Fiziksel sayım beyanıyla güncelleme (canlı yazma YOK)

**Kullanıcı beyanı:** SKU #29 bugün fiziken **5 adet** sayıldı. **Kaynağı:** kullanıcı tarafından iletilen sayı; asistanın bağımsız yerinde sayımı değildir. Aynı gün Production SELECT sorgusunda `products.stok=5`. **Mutabakat farkı = 5 − 5 = 0 adet.** Bu, ürünlerin tamamının satılabilir veya herhangi bir sipariş için ayrılmamış olduğunu kanıtlamaz.

**Önemli sayım ilkesi:** Fiziksel **şu an** 5 adet mevcutsa, daha önce `teslim` durumuna alınmış 1 siparişi bu 5 adetten tekrar düşmek çifte stok indirimi riski doğurur. Teslim gerçekten gerçekleşmiş mi, sayılan beş üründen biri o müşteriye ayrılmış mı, manuel stok düzeltmesi yapılmış mı henüz belgeli değil.

### Dört eski siparişin belge bazlı kontrolü
| Sipariş ID (kısaltılmış) | 7 Ekim durum kaydı | Adet | Kayıtlı tutar | İşlemsel karar |
|---|---|---:|---:|---|
| `cb0d2c80…24f1` | whatsapp_bekliyor | 1 | 35.000 TL | Talep/rezervasyon/tahsilat teyidi bekleniyor |
| `2c20a703…2042` | whatsapp_bekliyor | 1 | 35.000 TL | Talep/rezervasyon/tahsilat teyidi bekleniyor |
| `ad2ce4ea…69d` | whatsapp_bekliyor | 1 | 35.000 TL | Talep/rezervasyon/tahsilat teyidi bekleniyor |
| `0e2a52e8…3785` | teslim | 1 | 35.000 TL | Teslim/irsaliye ve stok hareketi teyidi bekleniyor |

**Not:** Kayıtlı tutar tahsilat kanıtı değildir. Bu siparişler otomatik olarak iptal, satış, test, rezervasyon ya da tahsil edildi olarak sınıflandırılmadı. Production kamuya açık tablolarında ayrıca `payment`, `shipment`, `reservation` defteri bulunmadı.

### Satışa ayrılabilir stok hesabı
- Fiziki sayım: **5 adet (kullanıcı beyanı)**
- Kesin teyit edilmiş bekleyen rezervasyon: **bilinmiyor**; **sıfır diye varsayılmayacak**
- Hasar/emanet/başka tahsis: **bilinmiyor**
- **Kesin satılabilir stok: doğrulanmadı**.
- *Şartlı örnek:* Beş ürünün tamamı kusursuz, mülkiyeti ve satış yetkisi Cadde Depo'ya ait, dışarıya ayrılmamışsa ve bekleyen üç siparişten `R` tanesi gerçekten rezerveyse, `satılabilir=5−R` (`R=0..3` ⇒ **2–5**). Bu **stok kaydı veya açılış onayı değildir**.

### Kalan üç kanıt — sorumlu/aksiyon
1. **Satış destek:** Bekleyen üç siparişin her biri için müşteriyle teyit edilmiş aktif talep / test / iptal / rezervasyon kararı ve varsa ödeme durumu; kişisel verileri rapora yazma.
2. **Operasyon:** `teslim` statülü siparişin gerçekten sevk edilip teslim edildiğine ilişkin belge, tarih ve bu teslimin bugünkü fiziksel sayımın öncesinde olduğunun teyidi.
3. **Depo sorumlusu:** Sayımdaki beş birimin kondisyonu, müşteri/emanet tahsisi, satış yetkisi ve gerçekten satılabilir adet.

**Değişiklik yapılmadı:** Production'da UPDATE/INSERT/DELETE yok; sipariş durumları, stok=5 ve ürünün aktif işareti aynen korundu. Satış açılışına GO kararı verilmedi.
