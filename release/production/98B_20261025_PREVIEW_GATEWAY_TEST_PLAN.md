# CADDE DEPO — Preview RPC v3 E2E Hazırlık / 25 Ekim 2026

**Karar: DENE (yalnız izolasyon ve güvenlik kontrolü); Production NO-GO.**

## Kaynak
- PR #2 / `prep/production-order-security-20261024`
- `api/cadde-preview-checkout-v3.js` — yalnız Preview ortamında açıkça etkinleştirildiğinde POST kabul eden ayrı gateway.
- `release/production/tests/preview_gateway_contract.cjs` — sahte sırlarla ve mock ağ istekleriyle güvenlik sözleşmesi.
- CI: https://github.com/nihatdogan/cadde-depo-b2c/actions/runs/40194061043 — başarılı (CI yalnız mock gateway + mevcut izole testler).
- Production checkout hâlâ eski akıştadır; bu endpoint ile bağlantısı yoktur.

## Tamamlanan
- Gateway `VERCEL_ENV=preview` ve bilinen PR dalı koşulu sağlar; Production ortamında ilk kapıda kapanır.
- Yalnız doğrulanmış Preview Supabase URL/ref'i kabul edilir; hiçbir Production ref'i ile checkout yönlendirmesi yoktur.
- Ürün #5 (sentetik Preview ürün) ve 33.000 TL ödeme öncesi ürün tutarı dışında sipariş kabul etmez. 33.001 TL yalnız hata/reddetme senaryosu için ayrılmıştır; başarılı RPC sonucu olamaz.
- POST: içerik/UUID/Origin/hostname/IP denetimi, gerçek Siteverify success + hostname + action eşleşmesi, sonra `create_whatsapp_request_protected_v3` çağrısı.
- Sırlar ve IP/hash değerleri istemci yanıtına yazılmaz. Timeout halinde yeni idempotency key ile otomatik yeniden deneme yapılmaz.
- Eksik konfigürasyonda 503 `PREVIEW_CANARY_DISABLED`. Olası Vercel SSO korumasını atlatma yöntemi dahil edilmedi.

## Eksik konfigürasyon: işlem için proje sahibi tarafından güvenli Vercel ayarlarına kaydedilmeli
Yalnız `prep/production-order-security-20261024` dalına özgü Preview hedefli değişkenler, değerleri **sohbete veya PR'a yazılmadan**:

| Değişken | Güvenlik şartı |
|---|---|
| `CADDE_PREVIEW_E2E_ENABLED` | Başlangıç `off`; yalnız planlı insan gözetimli test penceresinde `on` |
| `CADDE_PREVIEW_SUPABASE_REF` | `emnacsavgsjkrocpngcj` |
| `CADDE_PREVIEW_SUPABASE_URL` | `https://emnacsavgsjkrocpngcj.supabase.co` |
| `CADDE_PREVIEW_SUPABASE_SERVICE_ROLE_KEY` | **Yalnız Preview projesinin sunucu sırrı**; frontend/CI/rapora kopyalama yok |
| `CADDE_PREVIEW_RATE_SALT` | Yalnız Preview için ayrı yüksek entropili, 32+ karakterli sır |
| `CADDE_PREVIEW_TURNSTILE_SITE_KEY` | Gerçek Preview hostuna kayıtlı sitekey; Cloudflare resmî dummy anahtarı değil |
| `CADDE_PREVIEW_TURNSTILE_SECRET_KEY` | Eşleşen gerçek Preview widget sırrı; sunucu tarafı בלבד |

> Mevcut eski Turnstile değişkenleri farklı Git dalına scope edilmiştir. Bunları üretime genişletmek veya production credential'ı buraya bağlamak **yasaktır**. Branch-scoped değişkenler girildiğinde yeni Preview build için güvenlik incelemesi yapılmalıdır.

## Henüz PASS olmayan gerçek uçtan uca aşama
1. Preview projesinde Cloudflare gerçek widget'ı, `action=cadde_preview_checkout`, hostname eşleşmesi ve Vercel deployment protection erişimi.
2. Gerçek tarayıcıdan tek kullanıcı eylemi; başarılı 201; eş idempotency key ile yeniden istek 200 reused; farklı toplam veya kötü token için reddetme.
3. Supabase Preview'da yalnız test ürün #5, güvenilir kaynak, sipariş durumu ve audit korelasyonu. Kişisel veri kullanma.
4. Gerçek MFA'lı admin AAL2 ile kontrollü onay ve iptal; stock #5 önce/sonra eşit ve tutarlı olmalı.
5. Test siparişi ve audit izleri saklama politikasına göre yetkili kontrol altında tutulur. **Otomatik DELETE/CLEANUP yok**; data geriye dönük silinmiş gibi beyan edilmez.
6. Test bitince `CADDE_PREVIEW_E2E_ENABLED=off` ve yeniden deploy. Tekrar 503 kontrolü.

## Risk ve ek güvenlik kapısı
Bu endpoint henüz genel müşteri checkout'ına bağlı değildir. Vercel Preview erişim koruması ve test süresince insan gözetimi olmadan `on` yapılmamalıdır; aksi durumda geçerli Turnstile çözen herhangi bir kullanıcı test siparişi açabilir. Feature flag bir erişim kontrolü değildir. Ayrı kimlik veya ağ tabanlı test yetkisi gerekli olabilir. Sonuçta RPC/ürün, idempotency, RLS ve test hesapları her seviyede doğrulanmalıdır.

**GO / NO-GO:** İzole gateway kodu + mock CI PASS; gerçek browser → Cloudflare → Vercel → managed Supabase POST zinciri **UNVERIFIED**. Production **NO-GO**; `main`, Production Supabase ve canlı checkout değiştirilmedi.
