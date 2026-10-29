# CADDE DEPO — GÜVENLİ YAYIN / GERİ DÖNÜŞ KAPISI

**Tarih:** 24 Ekim 2026  
**Durum:** NO-GO. Yalnızca izole PostgreSQL 16 CI kanıtı.  
**Kaynak PR:** https://github.com/nihatdogan/cadde-depo-b2c/pull/2  
**Kesin sınır:** Production Supabase, canlı caddedepo.com ve GitHub main değiştirilmemiştir.

## Kanıt
Geri alınabilir `tests/cutover_and_reversal_contract.sql` testinde:
1. Sentetik eski doğrudan INSERT ve yönetici UPDATE yolu çalıştı.
2. `anon`/`authenticated` doğrudan `orders`/`order_items` yazma izinleri ve ilgili RLS politikaları kapatıldı.
3. Anonim sipariş INSERT ve yöneticinin doğrudan UPDATE denemeleri reddedildi.
4. Korumalı RPC v3 sipariş oluşturmayı sürdürdü; denetimli yönetici RPC'si onay/iptal ve audit üretti.
5. Eski INSERT izinleri ve izin veren RLS politikaları **geri açıldığında**, korumasız doğrudan sipariş oluşturma yolunun da geri açıldığı gözlendi.
6. Test `ROLLBACK` ile tamamlandı; yalnızca CI PostgreSQL 16, sentetik veri.

GitHub Actions: https://github.com/nihatdogan/cadde-depo-b2c/actions/runs/40102142201

## Üretim için zorunlu geçiş sırası — henüz uygulanmadı

- **Ön kontrol:** Yedek/restore tatbikatı, dört eski siparişin stok geçmişi, yetki/RLS envanteri ve yönetici oturumları doğrulanmalı.
- **RPC ve API hazırlığı:** Production RPC v3 ve denetimli yönetici RPC için bağımsız değişiklik incelemesi ve geri dönüş planı. API **varsayılan kapalı** kalmalı.
- **Kontrollü kesim:** Eski ve yeni arayüzün eşzamanlı korumasız sipariş kabul etmeyeceği bakım/feature-off kapısı olmalı. Sipariş kabulünü kısa süreli durdurmak, çift sipariş veya stok kaybı riskini kabul etmekten tercih edilir.
- **Atomik yetki kesimi:** Eski doğrudan `orders/order_items` INSERT ve `orders` UPDATE yetkileri ve izin veren RLS politikaları tek denetlenebilir ve geri alınabilir işlem olarak ele alınmalı. Ürün yönetimi izinleri gelişigüzel kaldırılmamalı.
- **Yayın:** Yalnızca geçiş testi geçen üretime özgü gateway ve frontend etkinleştirilmeli; smoke test gerçek müşteri siparişi veya stok müdahalesi olmadan yapılmalı.
- **İzleme:** 4xx/5xx, 409, 429, order dedup, audit, stok mutabakatı ve retry davranışı izlenmeli.

## DUR / geri dönüş
**Güvenli varsayılan:** Checkout'u kapalı tut; order, stock, audit verisini yerinde koru; müşteri etkisini operasyonel olarak yönet ve doğrulanmış güvenli sürüme dön.

**YASAK / otomatik yapma:** Eski anonim INSERT politikalarını açmak, RLS kaldırmak, eski `admin` doğrudan UPDATE'i açmak, audit silmek, müşteri siparişlerini yeni stok mantığına kayıtsız taşımak.

Eski sisteme dönüş, korumasız yolun yeniden açılmasını beraberinde getirdiği için ancak ayrı iş/operasyon kararı ve risk kabulüyle değerlendirilebilir; **varsayılan rollback adımı değildir**.

## Açık GO kapıları
1. Gerçek Vercel + Cloudflare Turnstile + izole Supabase uçtan uca testleri; production secrets kullanılmamalı.
2. Eski siparişlerin mutabakatı, production migration dry-run ve rollback planı.
3. Supabase Auth parola/MFA ve KVKK audit saklama politikası.

**NO-GO:** PR merge, Production Supabase migration, canlı checkout veya `main` değişikliği için onay verilmedi.
