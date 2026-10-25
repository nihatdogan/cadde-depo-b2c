# CADDE DEPO — 25 Ekim 2026 Devam Denetimi / Production NO-GO

**Kapsam:** GitHub PR #2 / `prep/production-order-security-20261024`.
**Karar:** **PRODUCTION NO-GO**. Bu belge bir üretim geçiş yetkisi değildir.
**Çalışma sınırı:** Production verisi, `main` ve `caddedepo.com` değiştirilmedi; yalnız PR çalışma dalı ve ayrılmış Preview Supabase güvenlik politikası değiştirildi.

## 1. Güncel PR ve CI kanıtı

- Başlangıç PR HEAD: `439c778c333421338263a6c4d5c727350d43cc05`; 62 commit, 34 dosya, OPEN/DRAFT, unmerged.
- Son kod+güvenlik CI kaynak commit: `914f00ee235c616a17831c5623cc7c4c54720cf3`.
- İzole PostgreSQL 16 CI: `https://github.com/nihatdogan/cadde-depo-b2c/actions/runs/40186498351` **SUCCESS**. Sentetik RPC/HTTP ve yeni Preview izolasyonu + AAL2 ürün RLS testleri çalıştı.
- Vercel Preview, bu son kod commit'i için `READY` (deployment `dpl_AKwAnZY87qX4PpDbXAEpEUgsgSgG`; build başarı kaydı). READY tam HTTP checkout kanıtı değildir.
- Branch ileri taşındı; `main` merge yapılmadı.
- Kaynak PR: https://github.com/nihatdogan/cadde-depo-b2c/pull/2

## 2. Kapatılan Preview riskleri

**Önceki bulgu:** PR Preview'da `index.html` doğrudan Production Supabase'e `orders` ve `order_items` INSERT ediyordu; `urun.html` ve `index.html` Production kataloğunu okuyordu. Bu bir izole test ortamı değildi.

**Değişiklik:**
- `index.html` Checkout, Production dışındaki hostlarda eski doğrudan INSERT yoluna girmeden durur. Bu, yalnız geçici frontend kilididir, güvenlik için sunucu kapısının yerini alamaz.
- `index.html` ve `urun.html` Production resmi hostları dışında yalnız Preview Supabase publishable anahtarı ve ref'ini seçer.
- `release/production/tests/preview_source_isolation.cjs` farklı hostlarda veritabanı seçimini ve checkout sırasını statik/VM düzeyinde doğrular. Test, HTTP tarayıcı e2e değildir.
- CI tetik kapsamına `index.html`, `urun.html` ve `release/preview/**` eklendi.

**Kalan teknik risk:** Production hostunda eski doğrudan INSERT kodu aynen duruyor; kapatılması ancak izole v3 uçtan uca kanıtı, geçiş planı ve ayrıca Production onayıyla yapılabilir. Preview frontend kilidinin atlanması halinde savunmanın temel katmanı veritabanı RLS olmalıdır.

## 3. Gerçek Preview Supabase AAL2 yetki kapısı

- Preview proje ref: `emnacsavgsjkrocpngcj`. Production ref: `svyqmmivhpfiuhxnmhny` (**hiçbir üretim migration uygulanmadı**).
- Preview migration: `preview_admin_products_aal2_20261025` / version `20261025105343`, başarıyla uygulandı.
- Önceden `auth_all_products` politikası yalnız `app_metadata.role=admin` kontrol ediyordu; AAL1 ile ürün DML riski vardı.
- Sonrasında ürün INSERT, UPDATE, DELETE RLS politikalarının USING/WITH CHECK koşullarında **`app_metadata.role=admin` VE JWT `aal=aal2`** şartı görüldü. Mevcut aktif ürün public SELECT politikası korundu.
- CI'da sentetik AAL1 admin UPDATE/DELETE/INSERT engelleme, AAL2 admin kabul, AAL2 non-admin engelleme; ROLLBACK testi başarılı.
- Managed Preview'taki sonuç SQL policy introspection'ıdır. Gerçek telefon/TOTP ile yeni AAL2 oturumundan ürün DML uçtan uca ayrıca test edilmelidir. Servis rolü RLS'yi bypass edebildiği için tarayıcıya asla koyulmaz.
- Preview Auth sayımında 1 admin, 1 doğrulanmış MFA'lı admin; Production Auth sayımında 1 admin, 0 doğrulanmış MFA'lı admin. Bu, bütün oturumların AAL2 olduğunun kanıtı değildir.

**Preview korunmuş veri sayımı, migration öncesi → sonrası:**

| Girdi | Önce | Sonra |
|---|---:|---:|
| products | 3 | 3 |
| SKU #5 stok | 1 | 1 |
| orders | 4 | 4 |
| trusted v3 kayıt | 1 | 1 |
| admin audit | 6 | 6 |

## 4. Yönetilen Preview v3 mevcut pozitif kayıt

25 Ekim salt-okunur Preview sorgusunda:
- 1 kayıt `trusted_checkout_orders.source=protected_checkout_v3`.
- İlişkili sipariş: 33.000 TL, `whatsapp`, 25 Ekim 2026 08:56:50 UTC tarihinde oluşturulmuş, mevcut durum `iptal`.
- Audit: 08:59:24 UTC'de `whatsapp_bekliyor` → `onaylandi` başarılı; 08:59:32 UTC'de `onaylandi` → `iptal` başarılı.
- Bu, yönetilen Supabase'de gerçek yazılmış v3 sipariş ve admin audit izi olduğunu doğrular. Ancak hangi istemcinin istek yaptığı, Cloudflare gerçek kullanıcı challenge'ı, Vercel gateway ve gerçek tarayıcı arasında tek bir korelasyon kaydı bulunmadan **tam zincir geçti** denilemez.
- 24 Ekim SQL BEGIN/ROLLBACK testi ayrıca `97_MANAGED_PREVIEW_RPC_V3_SQL_PROOF.md` dosyasında açıklanmıştır; bunu kalıcı API checkout e2e kanıtı sayma.

## 5. Production salt-okunur anlık kontrol

25 Ekim doğrulama:
- `public.products`: toplam 1 / aktif 1, SKU #29 sistem `stok=5`.
- `public.orders`: toplam 4; 3 `whatsapp_bekliyor`, 1 `teslim`.
- Production yönetici: 1, MFA verified: 0.
- Ürün stokunun 5 olması **5 adet serbest satılabilir stok** kanıtı değildir.
- 24 Ekim `80_LIVE_STOCK_RECONCILIATION_2026-10-24.md` kullanıcı fiziki 5 sayım beyanını kaydeder ama beyan, bağımsız sayım evrakı, sevk/teslim kanıtı ya da 3 bekleyen talebin rezervasyon/ödeme kararı yerine geçmez. Önceden teslim edilmiş 1 adedi bugünkü 5 fiziksel sayıdan ikinci kez düşme.

## 6. Security Advisor — hâlâ açık

- Production ve Preview'da `auth_leaked_password_protection` WARN. Bu özellik/alternatif için ayrı güvenlik kararı ve yeniden test gerekiyor.
- Production `public.rls_auto_enable()` SECURITY DEFINER EXECUTE için anon/auth WARN. Event-trigger çalışma bağlamı, erişim ve uygulama etkisi ayrıntılı incelenmeden yetki kesme veya exploit iddiası yapılmaz.
- Preview `admin_set_order_status_audited` ve `_v3` SECURITY DEFINER authenticated WARN; fonksiyonun JWT role/AAL2 kontrolü, `search_path`, EXECUTE grant ve JWT tazeliği ayrıca incelenir.
- Audit için amaç, erişim, saklama ve imha kararı açık.

## 7. Production engelleri ve çıkış kapıları

**P0 — İzole uçtan uca checkout:** Üretim dışı host, gerçek Cloudflare sitekey/secret ve challenge (test anahtarı değil), Vercel sunucu gateway, yönetilen Preview v3 RPC, sipariş idempotency, fiyat/stok yarışları, hatalı token/red, gerçek admin AAL2 onay/iptal, test verisinin yasal ve açık temizliği. Production host/ref/tokenlarını testte kullanma. *Henüz PASS yok.*

**P0 — Legacy mutabakat:** 4 sipariş için satır bazında gerçek talep/teslim/ödeme/rezervasyon ve stok olay kaynağı belgelenecek; mevcut siparişler otomatik silinmeyecek veya yeniden sınıflandırılmayacak. Fark kayıtlarından önce yeni stok motoru etkinleştirilmeyecek.

**P0 — Üretim güvenliği ve geri dönüş:** Production admin MFA, password protection veya yetkili telafi kontrolü, 4 sipariş ve ürün yedeği/restore tatbikatı, additive migration dry run, RLS/grant revizyonu, güvenli kesim/geri dönüş prosedürü, müşteri checkout sonrası gözetim, sorumlu imzaları. Legacy anonim sipariş INSERT'i rollback bahanesiyle otomatik açılmayacak.

### Takipte ilk 7 gün (önerilen, otomatik görev değildir)

- **Gün 1–2 / Yazılım + güvenlik:** Preview gateway ve gerçek Turnstile/domain ayrımını tamamla, tekil trace ID ile gerçek yönetilen v3 HTTP checkout/negatif/idempotency/temizlik kanıtı üret.
- **Gün 2–4 / Depo + satış + finans:** SKU #29 fiziki sayım formu, tek teslim kanıtı, üç bekleyen sipariş teyidi; telefon/kimlik bilgilerini PR belgesine koyma.
- **Gün 4–7 / DB sahibi + güvenlik sorumlusu:** Production-safe additive migration ve yedek/restore + RLS/grant dry run incelemesini tamamla; önce Preview AAL2 ürün DML gerçek kullanıcı testi, ardından ayrı Production onayı kararı.

**GO koşulu:** Tüm P0'lar için tarihli kanıt + inceleyen/onaylayan kişi + geri alma planı. O zamana kadar **PRODUCTION NO-GO**, PR DRAFT, main/caddedepo.com/Production veri aynen bırakılacak.
