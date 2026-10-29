# CADDE DEPO — ADIM 45.19 / PRODUCTION ONCESI GUVENLIK KARARI

Tarih: 29 Ekim 2026 (Europe/Istanbul)
Karar: **NO-GO**. Bu dosya Production migration, PR merge, checkout acilisi veya yetki degisimi onayi degildir.
Kaynak: https://github.com/nihatdogan/cadde-depo-b2c/pull/2
Incelenen PR HEAD: b5156bb92f0175acca51d10cbb7d8c55df5943a9 (OPEN / DRAFT).

## Dogrudan dogrulanan kanitlar (29 Ekim)

- Vercel Production READY, main dalinda: kaynak commit 6ba49227be907b87f225284bdb222fa3e04f3011. PR #2 henuz birlestirilmedi.
- Branch-scoped Preview E2E bayragi OFF.
- Production veritabaninda onerilen classified-order, trusted-order ve audited-order-status tablolarinin hicbiri yok; onerilen Production checkout/status/classification RPC sayisi sifir.
- Production PostgreSQL GRANT kontrolde anon icin orders ve order_items INSERT, authenticated icin orders ve products UPDATE henuz tanimli. GRANT, RLS kurallarini gecersiz kilmaz; riskli anonim INSERT policy kaniti 28 Ekim incelemesindedir.
- Production Security Advisor: leaked-password protection disabled (WARN); security-definer executable uyarilari (WARN); RLS enabled no policy (INFO). Uyari tek basina exploit kaniti degildir.
- GitHub Actions #113: isolated-postgres16 SUCCESS, synthetic-pg17-restore SUCCESS. T4 izole sentetik DB'de eski yazmanin kapatilmasi + gercek yerel HTTP/PostgREST v3 201/200 tekrar deneme PASS.
- Gercek Preview T2 E2E kaniti: Cloudflare Turnstile, Preview branch alias, yonetilen Preview v3, ayni UUID 201/200, tek DB kaydi; kapali Preview 503. Production E2E kaniti degildir.

## Tarihli onceki kanitlar ve sinirlar

- 29 Ekim onceki ayni calisma oturumunda: Production dort eski test olarak beyan edilmis siparis/yapi eslesmesi, SKU #29 kayitli stok 5, Preview ve Production admin hesabi basina dogrulanmis bir TOTP faktoru goruldu. Bugunku son tekrar sorgularinin bir kismi guvenlik araci tarafindan engellendigi icin guncel yeniden PASS sayilmaz. Fiziki sayim, tahsilat ve teslim gercekligi ayri kanit gerektirir.
- 26 Ekim: kullanicinin Windows manifestine gore sifreli Production public schema arsivinden yalitilmis PostgreSQL 17 restore PASS. 99H tarihli kaynakta bagimsiz ikinci fiziksel kopya ve ikinci kopyadan kurtarma OPEN. Sonraki kanitlar ayrı bir kayitta teyit edilmedikce bagimsiz ortam, otomasyon, olculmus RPO/RTO ve yonetilen Auth/Storage restore DONE sayilmaz.
- TOTP faktorunun kayitli olmasi, JWT AAL2'nin Production kritigi her islemde zorlandigini kanitlamaz.

## Zorunlu GO kapilari

| Kapi | Tamamlanmasi gereken | Durum |
|---|---|---|
| G1 Kurtarma | Gercek Production sifreli bagimsiz backup, ikinci kopyadan restore, Auth/Storage kapsami, RPO/RTO ve rollback sahipligi | OPEN |
| G2 Eski siparis | Dort UUID icin odeme/irsaliye/fiziksel stok mutabakati; immutable AAL2 audit ile TEST siniflandirmasi; test rakamlarini ciro/tahsilat saymama | OPEN |
| G3 Checkout | Production'a ozel kapali-varsayilan API, v3 RPC, server-side fiyat/stok, idempotency, Turnstile, anahtarlarin server-side kalmasi, fail-closed tarayici | CI/Preview PASS; Production OPEN |
| G4 Yetki kesimi | Eski anon insert ve dogrudan admin UPDATE policy/grants kontrol edilen gecis ile kapanacak; eski/yeni korunmasiz yol bir arada kalmayacak | Izole CI PASS; Production OPEN |
| G5 Admin | Production gercek admin JWT + AAL2, audited status ve inventory mutations, negatif yetki senaryolari | OPEN |
| G6 Raporlama | TEST/BUSINESS/UNCLASSIFIED farki, odeme ve sevkiyat kaniti, KDV/kargo/iade ayri | OPEN |
| G7 Smoke/observability | Onayli bakim penceresi, 503 fail-closed, stok/audit/4xx/5xx/409/429 izleme, geri donus senaryosu | OPEN |
| G8 Onay | Teknik, veri/operasyon ve is sahibi ayrica yetkili Production release onayi | YOK |

## En fazla uc oncelik

1. Yedek sahibi: bagimsiz sifreli kopya, bagimsiz ortamdan ikinci restore, Auth/Storage kapsam ve zamanli RPO/RTO kaniti. Sir ve arsiv GitHub/sohbet uzerinden tasinmaz.
2. Isletme/siparis sahibi: dort eski siparisin gercek odeme/teslim olmamasi kanitini, SKU #29 fiziksel satilabilir stok sayimini tamamla; gerekli AAL2 classification taslagi uzerinde ilerle.
3. Yazilim/guvenlik: Production'a esdeger yalitilmis restore uzerinde tam UI-API-DB AAL2/E2E gecis provasi ve karar oturumu planla. Tum kontrolleri PASS olmadan Production islem onayi isteme.

## DUR / guvenli geri donus

- Beklenmeyen siparis, stok, audit, token veya yetki sapmasinda checkout kapali kalir, sirlar aciga cikarilmaz.
- Eski anon INSERT, dogrudan admin UPDATE veya RLS'yi otomatik yeniden acma; veri ve audit kayitlarini silme.
- Tek kullanımlik PostgreSQL CI kaniti Production GO yerine gecmez.
- Bu incelemede Production INSERT/UPDATE/DELETE/DDL, Vercel Production deployment ve GitHub main merge yapilmadi.

**KARAR: NO-GO.**

Referanslar:
- https://github.com/nihatdogan/cadde-depo-b2c/actions/runs/40845141489
- 33_PRODUCTION_SECURITY_GO_NO_GO_READ_ONLY_20261028.md
- 31_LEGACY_TEST_ORDER_RECONCILIATION_READ_ONLY_20261028.sql
- 99G_20261026_V6_ENCRYPTED_RECOVERY_VERIFIED.md
- 99H_20261026_SECOND_COPY_AND_PREVIEW_E2E_PREFLIGHT.md
- 70_CUTOVER_ROLLBACK_EVIDENCE.md
