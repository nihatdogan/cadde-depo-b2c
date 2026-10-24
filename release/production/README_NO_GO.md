# CADDE DEPO — PRODUCTION CUTOVER TASLAĞI (NO-GO)
**24 Ekim 2026.** Sadece GitHub hazırlık dalında dokümantasyon. Production veri/şema/ayarlarında değişiklik yok.

## Kanıt: mevcut Production
- `public.orders` 5 sütunlu; `stok_rezerve` yok.
- `public.order_items`: sipariş referansı, ürün referansı, ad, fiyat, adet.
- `create_whatsapp_request_protected_v2` ve `admin_set_order_status_audited` RPC'leri bulunmuyor.
- `anon` ve `authenticated` için sipariş/satır INSERT politikaları mevcut; yöneticiye doğrudan sipariş UPDATE politikası var.
- Salt-okunur gözlemde 4 sipariş: `whatsapp_bekliyor=3`, `teslim=1`; 1 ürün, negatif veya max üstü stok gözlenmedi. **Bu rakamlar sadece 24 Ekim anlık fotoğrafıdır; müşteri kaydı kimliği çıkartılmadı.**
- Preview-only PR #1 doğrudan birleşirse API prod ortamında kapanır ve admin UI mevcut olmayan RPC'yi çağırır.

## Dosyalar
- `00_PRECHECK_READ_ONLY.sql`: yalnızca SELECT. Güvenli hazırlık denetimi; production'da otomatik çalıştırılmayacak.
- `10_EXPAND_SCHEMA_REVIEW_ONLY.sql`: **EXECUTE ETME**. Eski siparişlerde stok rezervasyonu **NULL (bilinmiyor)** bırakılır; yalnızca yeni kayıt varsayılanı false olur. Şema taslağı hiç uygulanmadı.
- `20_GATEWAY_FAIL_CLOSED_SPEC.md`: Varsayılan kapalı, üretime özel API kontrol listesi; çalışan API değil.
- Bu doküman: karar ve rollback.

## Riskli eski siparişler
Güncellenen taslak, `stok_rezerve` alanını nullable ekler; eski siparişlerde `NULL` (belirsiz) bırakır, yalnızca yeni kayıtların varsayılanı `false` olur. Bu, stok geçmişini yeniden kurmaz. `teslim` veya `onaylandi` olan eski siparişin stoğunun düşülüp düşülmediği kesinleştirilmeden yönetici RPC'si bu eski siparişlere uygulanmamalı. Ayrı `legacy` uzlaştırma/engel mekanizması gerekli.

## Kesintisiz geçiş / dört ayrık kapı
**Kapı A — Denetim ve yedek:** DB sahibi Production siparişleri, stok sayıları, RLS/grant, yönetici kullanıcı yetkileri ve yedeğin geri alınabilirliğini kaydeder. Auth MFA/parola ayarı ve audit saklama kararı yazılı olur. Şimdi: AÇIK.

**Kapı B — Genişletme:** Yalnızca onaydan sonra additive schema, sınırlı RPC/grant, legacy sipariş geçiş kuralı ayrı migration ile. Geçiş başarısı: eski UI halen çalışır; yeni nesne anon'a açık değildir. Öncesinde Preview üzerinde üretim şemasını taklit eden izole klonda test şart. Şimdi: HAZIRLANMADI.

**Kapı C — Sunucu + UI geçişi:** Üretime özel fail-closed API, ayrı server secret/Turnstile domain, kesin host kontrolü, fiyat/stok kontrolü, IP quota, idempotency, loglama, auth admin ve rollback. Preview branch/host/ref sabitlerini sadece ortam değişkenine çevirme. Uçtan uca güvenlik, idempotency ve canlıya zarar vermeyen canary testinden sonra yeni checkout'a geç; ancak bunun ardından eski anonim INSERT ve yöneticinin doğrudan UPDATE yetkilerini kaldır. Şimdi: HAZIRLANMADI.

**Kapı D — Doğrulama:** SQL rollback testleri, gerçek HTTP yarış testi, kimlik yetkisi, veri geri kazanımı, sipariş kayıt sayısı, olay günlüğü, RLS advisors, Vercel deploy smoke test. Kritik hata: hemen dur ve daha önce doğrulanmış pakete kontrollü geri dön. Şimdi: AÇIK.

## Stop / rollback
- Üretimden önce immutable Vercel deployment URL ve DB yedek/restore testi istenir.
- `CREATE` işlemlerini üretimde körlemesine geri almak eski/yeni verileri silebilir; DROP yapılmaz.
- Kapatılan grants eski sürümle uyumsuz olabilir. Eski uygulamanın yeniden çalışması için revocation rollback ve izin matrisinin önceden onaylanması gerekir.
- Audit tablosu otomatik silinmez; veri saklama süresi yetkili kararıyla belirlenir.
- Prod şema/grant geçişinden önce proje sahibinden **ayrı, açık üretim değişiklik onayı** alınır.
- GitHub `main` veya Production Supabase üzerinde bu hazırlık nedeniyle hiçbir işlem yapılmaz.

## Açık üç öncelik
1. Tek mağaza canlılığı için production-ready API ve RPC mimarisini güvenlik kod incelemesine sok.
2. Legacy siparişlerin stok geçmişini ve yönetim yetkilerini izole klonda uzlaştır.
3. Supabase Auth parola koruması ve KVKK audit saklama kararlarını resmileştir.

**GO/NO-GO: NO-GO**. Yalnızca plan ve SQL taslaklarıdır.
