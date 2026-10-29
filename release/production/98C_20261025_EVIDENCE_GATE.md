# CADDE DEPO — 25 Ekim 2026 Production Kanıt Kapısı

**KARAR: NO-GO.** Bu kayıt yalnız denetim ve hazırlık içindir; production onayı değildir.

## Bu oturumda canlı sistemlerden salt-okunur doğrulanan
- PR #2 önceki HEAD: `1a44a1888211c96307aa62beb6c3c9bbb103a916` (DRAFT, açık ve birleştirilmemiş), CI `40195752857` SUCCESS. Önceki Preview Vercel deployment READY.
- Production Supabase `svyqmmivhpfiuhxnmhny`: `orders=4`, `teslim=1`, `whatsapp_bekliyor=3`, SKU #29 `stok=5`, doğrulanmış MFA'sı olan admin `0`.
- Preview Supabase `emnacsavgsjkrocpngcj`: `orders=4`, `trusted=1`, `audit=6`, SKU #5 `stok=1`, doğrulanmış MFA'sı olan admin `1`.
- Production Security Advisor WARN: `auth_leaked_password_protection` kapalı; `public.rls_auto_enable()` SECURITY DEFINER EXECUTE anon/authenticated. Fonksiyonun event trigger kapsamı incelemesiz tehlikeli exploit olarak sunulmaz.
- Vercel Turnstile anahtarları eski `fix/whatsapp-stok-guard-20261022` dalına scope edilmiş; bu PR için gerekli `CADDE_PREVIEW_*` yeni değişkenleri listede bulunmadı. Değerler/secret'lar görüntülenmedi.
- Protected Preview test HTML için web GET `login_required`; API GET `timeout`. Bu sonuçlar gateway uygulamasının başarıyla çalıştığı veya başarıyla fail-closed döndüğü iddiası değildir. Vercel deployment protection kaldırılmadı.
- Gerçek Cloudflare widget → Vercel → managed Preview RPC v3 gerçek browser checkout HTTP POST **yapılmadı ve PASS değildir**.

## Yeni sentetik backup/restore tatbikatı
- PR'ye `release/production/tests/synthetic_backup_restore_ci.cjs` eklendi ve PostgreSQL 16 CI'da koşturulacak şekilde workflow güncellendi.
- Bu test yalnız GitHub Actions `cadde_ci` sentetik fixture için `pg_dump` ve ayrı `cadde_restore_ci` üzerinde `pg_restore` çalıştırır; satır sayısı, RLS ve RPC nesnelerini doğrular; geçici DB ve dump dosyasını siler.
- **Production yedeği, point-in-time recovery, gerçek veri restore ve RTO/RPO bu test kapsamında değildir.** CI sonucu yalnız gerçek GitHub Actions koşusundan sonra PASS sayılır.
- Production backup/restore kanıtı veri sahibi tarafından izole ve erişimi kontrol edilen bir hedefte ayrıca istenir.

## Sipariş kanıt zinciri — kişi tarafından tamamlanmalı
Kaynak: `80_LIVE_STOCK_RECONCILIATION_2026-10-24.md`. Dört eski siparişin hiçbirinin durumu değiştirilmeyecek.

| ID kısaltma | Mevcut statü | Gerekli bağımsız kanıt | Sorumlu | Durum |
|---|---|---|---|---|
| `cb0d2c80…24f1` | whatsapp_bekliyor | Gerçek talep/test durumu, rezervasyon ve tahsilat teyidi | Satış destek | BEKLİYOR |
| `2c20a703…2042` | whatsapp_bekliyor | Gerçek talep/test durumu, rezervasyon ve tahsilat teyidi | Satış destek | BEKLİYOR |
| `ad2ce4ea…69d` | whatsapp_bekliyor | Gerçek talep/test durumu, rezervasyon ve tahsilat teyidi | Satış destek | BEKLİYOR |
| `0e2a52e8…3785` | teslim | İrsaliye, teslim tarihi, sevk kanıtı, sayım öncesi/sonrası stok hareketi | Operasyon | BEKLİYOR |

SKU #29 fiziki 5 adet sayım (24 Ekim) kullanıcı beyanıdır, bağımsız imzalı sayım veya mülkiyet/kondisyon/rezervasyon kanıtı değildir. Eski teslimi bugünkü fiziki 5 adetten yeniden düşme: ÇİFTE DÜŞÜM RİSKİ. Üç bekleyen talep otomatik iptal/test/satışa dönüşmez. İlgili kişisel evrak GitHub'a yüklenmez; güvenli evrak deposu referansı ve doğrulayan kişi/tarih/sınıflama kaydedilir.

## Production GO onayı için eksik zorunlu kontroller
1. **İzole gerçek HTTP checkout:** branch-scope Preview ortam değişkenleri, gerçek Cloudflare host/action tokenı, 201 ve idempotent 200, hata/tekrar/race negatif testleri, admin gerçek AAL2 ile onay-iptal, stok ve audit mutabakatı. Test kayıtları saklama kararına tabidir; otomatik silme yok.
2. **Fiziksel ve muhasebe mutabakatı:** dört eski siparişin evrakı + fiziksel satılabilir adet; paylaşılan müşteri kişisel verisi olmadan ikinci kişi onayı.
3. **Üretim güvenlik ve yedekleme:** Production admin TOTP enrol+verify ve AAL2 oturum testi, product RLS/AAL2 planı, parola ihlali koruması veya yazılı telafi, KVKK audit saklama kararı, Production backup/restore kanıtı, migration dry-run ve rollback yetki matrisi, immutable deploy ve sorumlu imzaları.

**DUR:** Test/restore gerçeğe uymuyorsa; yetkisiz anahtar kullanılırsa; sipariş, stok veya audit farkı varsa. Production schema/auth/stock/order/main/checkout değişikliğine ayrı açık onay gereklidir.

Bu oturumda Production UPDATE/INSERT/DELETE, migration, main merge, canlı checkout cutover veya yeni ücretli kaynak oluşturulmadı.
