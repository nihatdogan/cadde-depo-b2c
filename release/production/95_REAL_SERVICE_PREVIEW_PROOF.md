# CADDE DEPO — GERÇEK VERCEL / TURNSTILE / İZOLE SUPABASE BAĞLANTI KANITI

**24 Ekim 2026 | Karar: DENE / Production NO-GO**

## Gerçek servis testi

GitHub PR #2 dalındaki `api/cadde-services-readonly-preflight.js` Vercel Preview dağıtımına gönderildi.

- Deployment: `caddedepo-b2c-a4bon26ld-nihat-proje.vercel.app` (`READY`)
- GET: `/api/cadde-services-readonly-preflight`
- HTTP: **200**, `verified=true`
- Cloudflare resmi her zaman başarılı test anahtarı ile **gerçek Siteverify endpoint** sonucu: `passed`.
- Supabase `cadde-depo-preview` projesine (`emnacsavgsjkrocpngcj`) sunucudan **GET**: `products.id=5`, sonuç: `passed`.
- API dönüşü `orderWrites=0`. Endpoint kodu sipariş RPC/POST yapmıyor, yalnızca GET ve resmi dummy challenge gönderiyor.
- Production Supabase `svyqmmivhpfiuhxnmhny` bağlantısı veya değişikliği yok. Canlı `caddedepo.com` ve `main` değişmedi.

**Sınır:** Cloudflare test belirteci gerçek kullanıcı CAPTCHA'sı değildir. Supabase RPC v3 bu Preview projesinde kurulu değil ve çalıştırılmadı. Bu **uçtan uca checkout testi değil**, gerçek servis bağlantısı testidir.

## Kalan geçiş kapıları
1. İzole Supabase'de v3 şema + güvenilir kaynak ve admin RPC'nin ayrı test kurulumuna onay; gerçek HTTP/Turnstile uygulama testi. Üretim siparişleriyle çalışılmaz.
2. SKU #29 fiziki sayım / teslimat evrakı / bekleyen 3 talebin gerçek rezervasyon durumu: `80_LIVE_STOCK_RECONCILIATION_2026-10-24.md`.
3. Supabase Auth leaked-password protection ve admin MFA, audit saklama/veri imha kuralları: `90_AUTH_AUDIT_SECURITY_GATE_2026-10-24.md`.

**NO-GO:** PR otomatik birleştirilmez, production SQL çalıştırılmaz, mevcut dört sipariş silinmez/değiştirilmez.
