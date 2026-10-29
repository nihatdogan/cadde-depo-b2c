# RPC v3 — Geri Alınabilir Preview Doğrulaması
**24 Ekim 2026 | NO-GO | Sadece inceleme.**

Aday: `25_CHECKOUT_RPC_V3_REVIEW_ONLY.sql`. Preview üzerinde tek SQL transaction içinde geçici `cadde_internal.trusted_checkout_orders` oluşturuldu, aday RPC oluşturuldu, servis rolüyle çağrıldı ve tüm değişiklikler `ROLLBACK` ile geri alındı.

## Başarılı kanıt
`V3_ATOMICITY_BASIC_ASSERTIONS_PASSED`
- İki ayrı ziyaretçiyle iki farklı sipariş oluştu.
- Aynı ziyaretçi + aynı idempotency anahtarı ile aynı sipariş kullanıldı.
- Aynı ziyaretçi + aynı sepet + farklı anahtar için yeni sipariş oluşmadı.
- İki siparişte iki ürün kalemi ve iki kaynak doğrulama kaydı aynı işlemin içinde görüldü.
- İlk denemede `service_role` özel kaynak tablosuna doğrudan erişemedi. Tablonun erişim izni **açılmadı**; kontrol, ayrıcalıklı test bağlamında yapıldı.

## Sınırlar
- Test, üretim ortamı değildir; gerçek HTTP/Turnstile, ağ kesintisi, eşzamanlı ayrı bağlantı, hash çakışması, rate-limit ve tüm bozuk girişleri henüz kapsamaz.
- Kaynak kaydı olmayan önceki v2 siparişinin tekrar kullanılmasının reddi ayrıca test edilmelidir.
- Gerçek aday yönetici fonksiyonu v3 kaynak kaydıyla birlikte izole kopyada uçtan uca test edilmedi.
- Production migration, secrets, `main` ve canlı web değişmedi.
- `create_whatsapp_request_protected_v2` servis yetkisi kesilmedi; üretime geçiş yok.

## Karar
**DENE:** V3 çekirdek atomiklik testi geçti. **DUR:** üretim geçişi kapalı.
