# SERVER-ATTESTED SIPARIŞ KAYNAĞI — KANIT VE AÇIK KAPILAR
**24 Ekim 2026 | İnceleme dalı | NO-GO**

## Doğrulanan karar
- `stok_rezerve=false` tek başına güvenilir kaynak kanıtı değildir. Eski UI anonim INSERT ile benzer kayıt oluşturabilir.
- Önerilen özel tablo: `cadde_internal.trusted_checkout_orders`. Bu tablo istemciye veya genel `service_role` tablo yetkisine açılmayacak.
- Yalnızca yetkili sunucu checkout RPC'si sipariş, sipariş kalemleri ve güvenilirlik kaydını **aynı DB transaction'ında** oluşturmalı.
- Yönetici RPC taslağında `UNTRUSTED_ORDER_SOURCE` kontrolü, tekrar onay kontrolü dahil, **bütün durum geçişlerinden önce** bulunuyor.
- İlgili dosyalar: `15_TRUSTED_ORDER_PROVENANCE_REVIEW_ONLY.sql`, `30_ADMIN_RPC_REVIEW_ONLY.sql`.

## Geri alınabilir test
Preview Supabase'de 24.10.2026 geçici tablolar ve geçici fonksiyonla; `BEGIN ... ROLLBACK`.
- Geçmiş kaynak kaydı olmayan sipariş: reddedildi.
- Eski doğrudan INSERT'i taklit eden `false` değerli ama kaynak kaydı olmayan sipariş: reddedildi.
- Güvenilir yeni sipariş: onay, tekrar onay, stok yetersizliği reddi ve iptal geçti.
- Sonuç: `ALL_ASSERTIONS_PASSED`, test stoğu yeniden 1.

**Sınır:** Bu test üretim adayı gerçek `public.admin_set_order_status` ve `public.admin_set_order_status_audited` fonksiyonlarının tamamını çalıştırmadı. Gerçek API/RPC v3 kaynak kaydı yazan uygulama henüz YOK. Production üzerinde hiçbir migration yok.

## GO/NO-GO kapıları
1. `create_whatsapp_request_protected_v3` **ayrı tasarlanmalı**, idempotency ve atomik kaynak kaydı bütünlüğü gözden geçirilmeli. v2'nin eski güvenilirlik kaydı bulunmayan siparişleri yeniden kullanması kesilmeli.
2. Tam üretim şema klonunda **aday fonksiyonun kendisi** ve admin JWT doğrulama testi yapılmalı. `SECURITY DEFINER` fonksiyon/grant, SQL injection, ayrıcalık, stale JWT ve eski sipariş senaryoları denetlenmeli.
3. Gerçek HTTP/Turnstile yarış ve ağ kesinti testleri başarılı olmadan üretim flag'i açılmamalı. Eski anon INSERT/UPDATE izinlerini kapatma işlemi yalnızca eşzamanlı geçiş planı ve rollback doğrulamasından sonra.
4. KVKK/audit saklama ve Supabase leaked-password protection kararı henüz açık.

**DUR: PR #2 taslak, asla otomatik merge edilmez.**
