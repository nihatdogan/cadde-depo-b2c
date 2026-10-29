# CADDE DEPO — 26 Ekim 2026 / Bağımsız yedek ve gerçek Preview E2E kontrol noktası

**Sürüm:** PR #2, commit `dc31d7eda3861a6d2edb5129cc5bbef979f1528e` · **Karar:** PRODUCTION NO-GO.

## A. İkinci şifreli arşivden restore

- Önceki kanıt `CADDE_DEPO_RECOVERY_V6_20261026T200914Z.json`: `PASS_ENCRYPTED_RECOVERY_LOCAL_ONLY_SECOND_COPY_OPEN`.
- Gerçek Production public arşivi AES-256-GCM ile şifrelendi ve tek yerel kopyadan PG17'e geri açıldı.
- V6'nın `recover_from_encrypted_v6.cjs` fonksiyonu, kullanıcı **harici hedef klasörü** seçtiğinde birinci arşivi `wx` ile aşırı yazmadan kopyalar, SHA-256 değerlerini eşleştirir ve PG17'e **second.file** üzerinden `--network none` konteynerine restore eder. Kaynak Production'a bağlantı açmaz.
- **Doğrulama sınırı:** V6 farklı sürücü harfini kontrol eder; harici hedefin ayrı fiziksel disk olduğunu otomatik olarak kanıtlamaz. Bilinçli kullanıcı/doğrulayıcı fiziksel disk envanterinden kontrol etmeli (Windows Disk Yönetimi veya `Get-Partition`/`Get-Disk`). Aynı fiziksel diskte farklı bölüm, OneDrive ya da aynı diskin farklı klasörü bağımsız kopya değildir.
- Gerçek dış disk kullanıcı bilgisayarına bağlı olmadan araç tarafından fiziksel kopyalama yapılamaz. **İkinci kopya ve ikinci kopyadan restore henüz YAPILMADI; PASS YOK.**
- Beklenen yalnız yerel gösterge: `PASS_ENCRYPTED_RECOVERY_WITH_VERIFIED_SECOND_COPY`. Ardından JSON içinde `second_encrypted_copy_verified=true` ve `recovered_from_secondary=true` olmalı.
- Fiziksel bağımsızlık ve USB disk şifrelemesi ayrıca teyit edilir. Arşiv/parola asla GitHub, ChatGPT veya mesaj uygulamasına aktarılmaz.

## B. Gerçek Cloudflare → Vercel Preview → Supabase RPC v3

**Kaynak:** `api/cadde-preview-checkout-v3.js`, `preview-checkout-v3-test.html`.

- Vercel proje `caddedepo-b2c` PR Preview dağıtımı: `READY`, ilgili son Git SHA kontrol edildi.
- Branch alias: `caddedepo-b2c-git-prep-production-order-secu-07ed4d-nihat-proje.vercel.app` (Vercel alias API).
- Vercel Authentication `enabled=true`; dış araçla `/api/cadde-preview-checkout-v3` ve `/preview-checkout-v3-test.html` GET denendi, sonuç `login_required`. Bu **korunan ortam erişim kapısıdır**, backend PASS/FAIL HTTP kanıtı değildir.
- PR branch Preview ortamında şu güvenli env adları mevcut: `CADDE_PREVIEW_E2E_ENABLED` (değeri önceki ayarda `off`), `CADDE_PREVIEW_SUPABASE_REF`, `CADDE_PREVIEW_SUPABASE_URL`. Gerçek Turnstile Site/Secret, branch-only preview service_role ve 32+ karakter rate_salt değişkenleri **bulunmadı**. Herhangi bir Production sırrı kopyalanmadı.
- İzole GitHub Actions CI run `40393693930`: `isolated-postgres16` ve `synthetic-pg17-restore` **success**. CI mock/dummy Siteverify ve izole Postgres kanıtıdır; gerçek tarayıcı→Cloudflare→Vercel→managed RPC v3 HTTP zincirinin PASS kanıtı değildir.
- Preview DB salt-okunur başlangıç ölçümü: `public.orders=4`, `cadde_internal.trusted_checkout_orders=1`, `cadde_internal.admin_order_status_audit=6`, test SKU #5 stoğu `1`. Bu rakamlar testin başarısı olarak kullanılmaz.

### Gerçek E2E koşulları (insan kontrollü, Preview ONLY)
1. Cloudflare Dashboard Turnstile içinde **gerçek**, test için ayrı widget; hostname tam olarak yukarıdaki branch alias. Sahte/dummy key değil. Vercel Authentication etkin kalır.
2. Sırları yalnız Vercel **Settings → Environment Variables → Preview → Git branch** `prep/production-order-security-20261024` hedefinde tanımla, sohbet/GitHub'a kopyalama:
   - `CADDE_PREVIEW_SUPABASE_SERVICE_ROLE_KEY`: yalnız `emnacsavgsjkrocpngcj` Preview Supabase
   - `CADDE_PREVIEW_RATE_SALT`: güçlü rastgele, en az 32 karakter
   - `CADDE_PREVIEW_TURNSTILE_SITE_KEY`: ayrı gerçek widget public sitekey
   - `CADDE_PREVIEW_TURNSTILE_SECRET_KEY`: yalnız server secret
   - `CADDE_PREVIEW_E2E_ENABLED`: yalnız gözetimli test penceresinde `on`
3. Aynı branch'in **yeni** Preview deployment'ını oluştur; deployment SHA, env scope, alias ve Vercel Authentication tekrar doğrulanmadan devam etme.
4. Yetkili tarayıcıdan `https://<branch-alias>/preview-checkout-v3-test.html` sayfası aç; gerçek widget'ı çöz. Test ürün #5 için bir `201` ve gerçek RPC sipariş UUID'si; tekrar aynı idempotency ile `200 reused`; yanlış token/hostname/Origin/product/price için negatif durumlar. Siteverify dönen `hostname` ve `action` doğru olmalı. User-facing cevaba sır yok.
5. Preview Supabase'de her sipariş UUID/provenance/audit ve stok ön/sonra ayrı salt-okunur doğrula; beklenmeyen stok sapmasında STOP. Üretim veritabanına veya canlı checkout'a dokunma. Test kayıtlarını silme.
6. `CADDE_PREVIEW_E2E_ENABLED=off`, yeni deployment ve kapalı `503` kontrolü; kanıt dosyası.
7. Production GO ancak gerçek tam HTTP zinciri, MFA AAL2 koruması, release/migration/rollback ve yönetilen Auth/Storage yedekleme kapsamı ayrıca imzalanırsa değerlendirilebilir.

**Bu tarih itibarıyla:** Bağımsız ikinci kopya **OPEN**, gerçek browser HTTP E2E **BLOCKED BY MISSING SECRETS & AUTH**. Production **NO-GO**. No main merge, no live checkout change, no Production DB write.
