# CADDE DEPO — V6 şifreli arşivden kurtarma ve ikinci kopya kanıtı

**Çalışma tarihi:** 26 Ekim 2026, 20:28:45 UTC (Türkiye saati 23:28:45)
**Kaynak:** Yetkili işletme kullanıcısının yerel Windows/Docker tatbikatı; `CADDE_DEPO_RECOVERY_V6_20261026T202845Z.json`
**PR:** #2 · `prep/production-order-security-20261024`
**Karar:** **PASS — ENCRYPTED PUBLIC SCHEMA RECOVERY, WITH HASH-VERIFIED SECOND VOLUME COPY**. **Full Production GO = NO-GO**.

## Doğrulanan sonuçlar (V6 raporu)

- `outcome`: `PASS_ENCRYPTED_RECOVERY_WITH_VERIFIED_SECOND_COPY`
- Source project ref: `svyqmmivhpfiuhxnmhny`
- `production_db_connection_used=false`, `production_write_performed=false`
- Önceki V5 kanıt dosyası: `CADDE_DEPO_RESTORE_KANIT_20261026_224116.json`
- Orijinal şifreli arşivin SHA-256 değeri: `b3717bd7d79a9711cbd0ed950d963a4296138f7dda4d695a4f5ed196d18c0646`
- Orijinal açık yedeğin SHA-256 değeri: `9bef3b01193e01ecd29d3de335ce5e91af840d2898f5c4304c029d42648eb3bc`
- Doğrulanmış açık yedek uzunluğu: 21665 bayt
- `verified_aes_gcm=true`
- `second_encrypted_copy_verified=true`
- `recovered_from_secondary=true`
- `restore_from_encrypted_archive_tested=true`
- İzolasyon: PostgreSQL 17 Docker container, `--network none`, exposed port yok, ephemeral, silindiği raporlanıyor
- `public` tablo: 5; RLS etkin tablo: 5; ilgili FK denetimi: true
- SKU #29: 5; sipariş kalem/tutar tutarlılığı: true
- `encryption_passphrase_stored=false`

## Önceki V5 raporuyla çapraz doğrulama

V5 `CADDE_DEPO_RESTORE_KANIT_20261026_224116.json` ve V6 dosyaları doğrudan karşılaştırıldı: **şifreli arşiv SHA-256, açık yedek SHA-256, 21665 bayt, tablo sayısı, RLS sayısı ve SKU #29 stok değerleri birebir eşleşti.**

Ek Production SQL **yalnız SELECT** denetimi: PostgreSQL major=17, `public` tablo=5, RLS etkin tablo=5, SKU #29 sistem stoğu=5. Bu sorgu kaynağın o andaki meta/stok durumunu doğrular; ikinci yedek arşivini doğrudan yeniden hash'lemek değildir.

**Açıklık:** V5/V6 test sonuçları işletme kullanıcısının yerel aracının imzasız JSON raporlarından ve gözlemlenen ekranından gelmektedir. Gizli `.cdp` arşivi, şifreleme parolası veya kişisel veri GitHub'a taşınmamıştır. Hash bağımsız olarak yerel arşivden bu oturumda yeniden hesaplanmadı.

## Kalan kapsam/karar kapıları

- **Fiziksel bağımsız kopya kanıtı OPEN:** V6 `offsite_location_verified=SEPARATE_VOLUME_ONLY_NOT_PHYSICAL_PROOF`. Ayrı volume hash'i, fiziksel bağımsız disk veya farklı lokasyon anlamına gelmez. İkinci cihaz ve erişim sınırları ayrı teyit edilmelidir.
- **Otomatik saklama OPEN:** `scheduled_backup_automated=false`. Periyot, yedek saklama süresi, şifreli kopyaların rotasyonu, kurtarma parolası yönetimi, alarm ve RPO/RTO henüz onaylı ve denenmiş değil.
- **Supabase Auth ve Storage OPEN:** `full_managed_auth_storage_restore_proven=false`. `public` şeması kurtarması yönetilen Auth/Storage ve Storage object bytes kurtarmasının yerine geçmez.
- **Gerçek Preview checkout E2E OPEN:** gerçek Cloudflare Turnstile siteverify → Vercel Preview → managed Supabase RPC v3 zinciri, idempotency, rate limit, rollback ve AAL2 testleri canlı Preview üstünde ayrıca geçmelidir.

## Yetki sınırı ve açılış

Production SQL ve checkout koduna dokunulmadı. `main` merge yok, Production yeni kaynak yok, müşteri siparişi silme/değiştirme yok. PR #2 **DRAFT**, **genel PRODUCTION NO-GO** devam eder. Sonraki odak: sınırlı gerçek Preview HTTP E2E'nin güvenli etkinleştirilmesi; kalıcı fiziksel offsite kopya ve otomatik yedekleme kararının ayrıca kapatılması.
