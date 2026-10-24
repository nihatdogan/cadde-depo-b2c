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
