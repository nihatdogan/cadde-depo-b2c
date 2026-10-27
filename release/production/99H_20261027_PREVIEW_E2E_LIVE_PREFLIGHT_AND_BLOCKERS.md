# CADDE DEPO — gerçek Preview Turnstile → Vercel → Supabase RPC v3 HTTP E2E

**Son kontrol:** 27 Ekim 2026, Türkiye saati · **Karar:** **E2E LIVE NOT RUN / BLOCKED; PRODUCTION NO-GO**
**PR:** #2, `prep/production-order-security-20261024` · Denetlenen commit `b09109e5a45430a76fd4c19cf4b77b18d4392514`
**Sınır:** `main` birleştirme yok; canlı `caddedepo.com` ve Production `svyqmmivhpfiuhxnmhny` üzerinde yazma yok.

## Doğrulanan kaynak ve altyapı

- Vercel proje: `caddedepo-b2c` / `prj_mNah357bU037hVeniw3AUiAAA8IX`.
- PR Preview deployment: `dpl_7C7jFvVcteYfnzszKTMtkmB7hDhb`, immutable host `caddedepo-b2c-8lud067d4-nihat-proje.vercel.app`, `READY`, commit SHA eşleşti.
- **Canlı testte kullanılacak branch alias:** `caddedepo-b2c-git-prep-production-order-secu-07ed4d-nihat-proje.vercel.app`.
- Vercel proje SSO: `ssoProtection.enabled=true`, `deploymentType=all_except_custom_domains`. SSO'suz istemci HTTP testi yaptı denmedi.
- İncelenen test giriş sayfası: `/preview-checkout-v3-test.html`; API: `/api/cadde-preview-checkout-v3`.
- Yönetilen **ayrı Preview Supabase**: `emnacsavgsjkrocpngcj`, PostgreSQL 17.11; `public.create_whatsapp_request_protected_v3` mevcut.
- RPC `SECURITY DEFINER`, `service_role` EXECUTE true, `anon` EXECUTE false. Bu, kod denetimi/gerçek E2E'nin yerine geçmez.
- **Başlangıç snapshot:** `public.orders=4`, `cadde_internal.trusted_checkout_orders=1`, `cadde_internal.admin_order_status_audit=6`, test SKU `products.id=5, stok=1`.
- GitHub Action `40396848150` iki iş de success: `isolated-postgres16` ve `synthetic-pg17-restore`; bunlar sahte anahtarlar/fixture testleridir, gerçek Turnstile HTTP/browser PASS değildir.
- Vercel Preview branch-scope değişkenleri: `CADDE_PREVIEW_SUPABASE_REF`, `CADDE_PREVIEW_SUPABASE_URL`, `CADDE_PREVIEW_E2E_ENABLED`; sonuncusunun değeri doğrudan yeniden okundu: **`off`**.
- Eski `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `CADDE_RATE_SALT` değişkenleri **farklı** `fix/whatsapp-stok-guard-20261022` dalına özgüdür; otomatik yeni dala genişletilmedi.
- Test gateway'i ayrıca `CADDE_PREVIEW_SUPABASE_SERVICE_ROLE_KEY`, `CADDE_PREVIEW_RATE_SALT`, `CADDE_PREVIEW_TURNSTILE_SITE_KEY`, `CADDE_PREVIEW_TURNSTILE_SECRET_KEY` bekler. PR dalında henüz yok; hiçbir Production secret kopyalanmadı.
- Preview advisor açık uyarıları: `authenticated_security_definer_function_executable` WARN ve `auth_leaked_password_protection` WARN; ilgili risklerin giderilip giderilmediği ayrıca incelenmeli.

## Dış hesapta yapılması gereken ve henüz yapılmayan kontrol

**Cloudflare hesabı için yetkili bir bağlantı/oturum elde olmadığı için gerçek Turnstile widget'ı oluşturulmadı.** Kod zaten widget + server-side Siteverify `success, hostname, action` doğrular. Cloudflare resmî dökümantasyon:
- https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/

1. Cloudflare Dashboard → Turnstile → **Add widget**. Önerilen isim `CADDE_DEPO_PR2_PREVIEW_E2E`; `Managed`; hostname olarak **yalnız** `caddedepo-b2c-git-prep-production-order-secu-07ed4d-nihat-proje.vercel.app` ekle. URL protokolü veya yol ekleme; `vercel.app` genel kökünü açma. Resmî test/dummy anahtarı kullanma.
2. Cloudflare site key (public) ve secret key (private) doğrudan Vercel Project → Settings → Environment Variables içinde yalnız bu git branch'e ve `preview` hedefine yerleştir:
  - `CADDE_PREVIEW_TURNSTILE_SITE_KEY` / `CADDE_PREVIEW_TURNSTILE_SECRET_KEY`
  - İzole `emnacsavgsjkrocpngcj` Preview Supabase projesine ait **server** `CADDE_PREVIEW_SUPABASE_SERVICE_ROLE_KEY` (secret, Production anahtarı değil).
  - Rastgele üretilmiş ayrı en az 32 karakter `CADDE_PREVIEW_RATE_SALT` (secret).
3. SSO'yu ve ayrı test ürününü koru. Tanımlar ve host eşleşmesi denetlendikten sonra kontrollü test penceresi için `CADDE_PREVIEW_E2E_ENABLED=on` yap ve **yalnız Preview yeniden deploy**. Önce `GET /api/cadde-preview-checkout-v3` → 200 `enabled:true` ve doğru `siteKey/action/product=5`.
4. Yetkili kişi Vercel SSO ile Preview test sayfasını açıp **gerçek Cloudflare Turnstile tokenını tarayıcıda üretir**; bot/captcha bypass yok. Tek sentetik istek: SKU #5, 33.000 TL, gerçek müşteri adı/telefon yok. Beklenen gateway 201, `environment:preview`, benzersiz `testOrderId`. Eğer fiyat/stok uyuşmazlığı oluşursa önce veri kontrolü; kayıt uydurma.
5. İkinci taze Turnstile token ile **aynı** idempotency key → beklenen `200 reused:true`, kayıt sayısı artmaz. Yeni bağımsız key kullanmadan replay testi yapılmalı. Negatif testler: kötü token 403, hatalı Origin 403, SKU #29/cart 400, 33.001 TL price mismatch 409. Sadece gateway reddetmesi değil yönetilen DB kayıt/audit korelasyonu okunmalı.
6. Preview Supabase'de `request_id`, `trusted_checkout_orders` güvenilir provenance, tekil idempotency, audit, ürün stok (=1 beklenen statüyle), admin AAL2 izleri; **test öncesi ve sonrası** sayılar, UTC ve UUID (müşteri verisi olmadan) kayıt altına alınmalı. Başarısız veya kısmi timeout'ta key değiştirmeden önce kayıt durumunu incele.
7. Test bitince **`CADDE_PREVIEW_E2E_ENABLED=off`** ve yalnız Preview redeploy; GET endpoint 503 `PREVIEW_CANARY_DISABLED` teyidi. Test kayıtlarını otomatik silme, `main`/Production checkout değiştirme.

### GO testi

Live E2E `PASS` yalnız **tüm** pozitif, replay, negatif, audit, erişim izolasyonu, kapanış/503 ve değişmemiş Production kontrolleriyle ilan edilir. Yukarıdaki Cloudflare ve Vercel dört sır bulunmadığından bu raporda sonuç **BLOCKED — NOT RUN**, **PRODUCTION NO-GO**.

Test/sır ve erişim korumalarına ilişkin değişiklikler yalnız **ayrık Preview** içindir; Production geçişi için ayrıca onay gerekir.
