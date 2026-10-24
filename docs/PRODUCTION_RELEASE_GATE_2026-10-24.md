# CADDE DEPO — ÜRETİM YAYIN PAKETİ / NO-GO

**Tarih:** 24 Ekim 2026
**Kaynak PR:** https://github.com/nihatdogan/cadde-depo-b2c/pull/1
**Durum:** DRAFT / NO-GO. Bu belge üretime uygulama talimatı değildir; onay kapıları tamamlanmadan çalıştırılmaz.
**İzin verilen test ortamı:** Preview Supabase `emnacsavgsjkrocpngcj` ve `fix/whatsapp-stok-guard-20261022`.
**Dokunulmayacaklar:** Production Supabase `svyqmmivhpfiuhxnmhny`, canlı `caddedepo.com`, GitHub `main`.

## 1. Kanıt matrisi

24.10.2026 gerçek Preview RPC testleri; tek `BEGIN…ROLLBACK` işleminde:
- Aynı ziyaretçi ve aynı idempotency anahtarı: aynı sipariş döndü.
- Aynı ziyaretçi ve aynı sepet; yeni anahtar: tekrar sipariş oluşmadı.
- Ayrı ziyaretçiler: ayrı sipariş oluştu.
- Yanlış ürün toplamı: reddedildi.
- Stoktan fazla ürün: reddedildi.
- WhatsApp talebinde stok ayrılmadı.
- Yönetici onayı: stok 1→0, tekrarı: değişiklik yok.
- İkinci siparişin onayı: `INSUFFICIENT_ACTIVE_STOCK`, kayıt değişmedi.
- İptal: stok 0→1; audit sonuçları `accepted`, `unchanged`, `rejected`, `accepted`.
- İşlem ROLLBACK edildi; son okuma: 3 sipariş, 3 sipariş kalemi, 0 dedup, 4 kalıcı eski denetim olayı, 12 kota kaydı, ürün #5 stok 1.

**Açık test:** Gerçek tarayıcı/Turnstile ile iki eşzamanlı POST, ağ kesintisi/retry, güvenli hata ve WhatsApp yönlendirme regresyonu.

## 2. GitHub bağımlılık ve risk kontrolü

PR `main` üzerinde, taslak ve henüz merge edilmemiştir. Preview API (`api/whatsapp-request.js`) açıkça `VERCEL_ENV=preview`, belirli branch/host ve Preview Supabase referansı gerektirir. Üretimde çalışmaya zorlamak için sadece ortam değişkenini değiştirmek **yasak**. Üretime özel konfigürasyon, ayrı gizli anahtarlar, Turnstile hostname doğrulaması ve staging/rollback kontrolleri ayrıca tasarlanmalıdır.

`admin.html` `admin_set_order_status_audited` RPC'sini çağırır. Bunun production Supabase'de kurulu veya erişilebilir olduğu doğrulanmamıştır. Dolayısıyla PR'ı olduğu gibi merge etmek yönetim ekranındaki sipariş durum değişikliğini bozabilir.

`urun.html` doğrudan WhatsApp konuşması açan butonu “WhatsApp'tan Ürünü Sor” olarak etiketler; bu yoldan sipariş kaydı oluşmaz. Sepetteki güvenli talep akışından ayrı tutulmalıdır.

## 3. Önerilen üretim paketleri (ayrı inceleme / ayrı onay)

**Paket A — Ürün görünürlüğü ve metin:** `urun.html` pasif ürün filtreleme ve gerçek CTA açıklamaları. Canlı davranışa etkisi ayrıca regression test ile onaylanmalı.

**Paket B — Denetimli yönetici RPC + yönetim UI:** Production veritabanı şemasının ve RLS/yetkilerin üretime uygun migration'ı; gerçek yönetici oturumunda SQL ve UI testleri; eski RPC yetkisinin ancak başarılı cutover sonrası kapatılması; rollback senaryosu.

**Paket C — Korumalı WhatsApp talep API + frontend:** Production için ortama bağımlı fail-closed konfigürasyon, ayrı servis key/Turnstile, üretime uygun rate limiting, idempotency, güvenli stok kontrolü ve HTTP stres testi. Production stok ve siparişlere gerçek test yükü gönderilmeyecek; pilot canlı plan ayrıca onaylanacak.

**Öncelik:** B ve C birbirinden bağımsız tasarlanmalı. `main` dalına tek, tüm sistem değişikliği şeklinde geçiş yapılmamalı.

## 4. Yayın kapıları

| Kapı | Sorumlu rol | Geçiş koşulu | Durma koşulu |
|---|---|---|---|
| Kod incelemesi | Teknik sorumlu | PR kapsamı ayrıştırılmış; production için Preview ref/hostname sabitleri kaldırılmış veya uygun ortam korumaları tasarlanmış | Preview sırrının production kullanımı veya gizli anahtar sızıntısı |
| Veri katmanı | DB sorumlusu | Production RLS/RPC migration'ı bağımsız gözden geçirilmiş; audit ve stok geri alma testi geçiyor | Güvensiz RLS/üretim stok mutasyonu |
| Kimlik ve parola | Yönetici/güvenlik | Supabase Auth leaked password uyarısı giderilmiş veya alternatif kontrol açıkça kabul edilmiş | Yetki atlama / eksik MFA politikası |
| Audit saklama | Veri sorumlusu/hukuk | Saklama süresi, silme/erişim planı yazılı | Belirsiz sınırsız kayıt tutma |
| Checkout | QA | Gerçek eşzamanlı POST ve kesinti/retry güvenliği Preview'da test edilmiş | Çift sipariş, yanlış fiyat veya hatalı stok |
| Yayın | Proje sahibi | Ayrı üretim ön kontrol ve geri dönüş runbook'u onaylandı | Yukarıdaki kapılardan biri başarısız |

## 5. Geri dönüş planı (uygulama öncesi)

1. Production şema ve yapılandırmasının erişim kontrollü geri dönüş yöntemi hazırlanır; gizli anahtarlar belgelere eklenmez.
2. Önce doğrulanmış immutable Vercel deployment ve gerekli migrasyon geri alma prosedürü tanımlanır.
3. Her paket sonrası `anon` ve yönetici yetkileri, sipariş ve stok sayı tutarlılığı ayrı doğrulanır.
4. Kritik hata olursa yeni checkout kabulü durdurulur; doğrulanmış önceki dağıtıma kontrollü dönüş yapılır. Audit kayıtları silinmez.
5. Production'a geçiş için proje sahibinin ayrı ve açık izni gerekir.

## 6. Kaynak dosyalar

- `docs/PREVIEW_SECURITY_GO_NO_GO_2026-10-24.md`
- `api/whatsapp-request.js`
- `supabase/preview-admin-order-status-audit.sql`
- `supabase/preview-browser-identity-rate-separation.sql`
- `supabase/preview-whatsapp-cross-tab-dedup.sql`
- `supabase/preview-whatsapp-idempotency.sql`

**Not:** Bu belge canlıda değişiklik veya üretim migration'ı yapıldığı anlamına gelmez.
