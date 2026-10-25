# CADDE DEPO — PREVIEW GÜVENLİK DENETİMİ VE ÜRETİM KAPILARI

**Durum:** `ERTELE / NO-GO`  
**Denetim tarihi:** 24 Ekim 2026  
**Kapsam:** Sadece `cadde-depo-preview` Supabase (`emnacsavgsjkrocpngcj`) ve GitHub `fix/whatsapp-stok-guard-20261022`.  
**Kesin yasak:** `cadde-depo` production (`svyqmmivhpfiuhxnmhny`), `caddedepo.com` ve `main` üzerinde onaysız işlem yapma.  
**PR:** https://github.com/nihatdogan/cadde-depo-b2c/pull/1 (24.10.2026 itibarıyla `draft=true`, `merged=false`, `mergeable=false`; neden ayrıca araştırılmalı).

## 1. Doğrulanan durum (Preview veritabanı)

| Kontrol | Doğrulanmış değer |
|---|---:|
| `public.orders` | 3 |
| `public.order_items` | 3 |
| `cadde_internal.whatsapp_request_dedup` | 0 |
| `cadde_internal.whatsapp_request_quota` kayıtları | 12 |
| `cadde_internal.admin_order_status_audit` | 4 |
| Ürün #5 stoğu | 1 |

**Kaynak:** 24.10.2026 Supabase Preview SQL okuma sorguları. Hedef değerler testler sonrası durumdur, üretim ölçümü değildir.

### Gerçek yönetici testi ve kalıcı olaylar

4 olay, 2 silinmiş sentetik test siparişine aittir:
- A: `whatsapp_bekliyor → onaylandi`, `accepted`, rezervasyon `false → true`
- A: `onaylandi → iptal`, `accepted`, rezervasyon `true → false`
- B: `onaylandi` denemesi, `rejected`, `INSUFFICIENT_ACTIVE_STOCK`, rezervasyon `false → false`
- B: `whatsapp_bekliyor → iptal`, `accepted`, rezervasyon `false → false`

İlgili iki test siparişi ve kalemleri kontrollü silinmiştir. Bu 4 olay **kasıtlı olarak korunur**. Audit tablosundaki `order_id` alanı FK değildir; test siparişleri silindiğinde olayların kaybolmaması tasarım gereğidir.

### Teknik doğrulamalar ve sınırları

- Ayrı Chrome / Edge InPrivate ziyaretçi kimlikleriyle ayrı WhatsApp talepleri: **geçti**.
- Aynı ziyaretçiye ait farklı anahtarlarla iki bağımsız SQL bağlantısından eşzamanlı talep: aynı `request_id` döndü (**SQL testi geçti**).
- Yönetici onayı, tekrar onay, stok yetersizliği ret, iptal ve stok iadesi: SQL testi ve yönetim paneli üzerinden kullanıcı kontrollü manuel test **geçti**.
- Ret olayı `INSUFFICIENT_ACTIVE_STOCK` koduyla kalıcı audit tablosunda **doğrulandı**.
- Gerçek tarayıcı + Turnstile üzerinden tamamen aynı anda iki POST isteği: **bağımsız uçtan uca test yok**.
- Audit yalnızca **yönetici sipariş durum değişiklikleri** içindir. Yönetim panelinden doğrudan ürün/stok düzenlemeleri bu tablo ile kayda alınmaz; tüm stok hareketlerini kapsayan genel stok defteri olarak sunulamaz.

## 2. Veri erişimi ve güvenlik uyarıları

| Bileşen | Mevcut kontrol | Karar |
|---|---|---|
| `cadde_internal.admin_order_status_audit` | RLS açık, politika yok, `anon`/`authenticated`/`service_role` için doğrudan şema ve tablo erişimi yok | Koru |
| Günlük tablosu sahibi | `postgres`; uygulama kullanıcıları sahip değil | Yönetim erişimini ayrıca kontrol et |
| `public.admin_set_order_status` | `authenticated` rolüne `EXECUTE=false`; yalnızca iç işlevden çağrılıyor | Koru |
| `public.admin_set_order_status_audited` | `authenticated` için çağrılabilir; işlev içinde `auth.uid()` ve JWT `app_metadata.role=admin` kontrolleri | Açık uyarı, gerekçeli yetki incelemesi |
| `cadde_internal.whatsapp_request_dedup` | RLS açık, politika yok: istemciye kapalı iç tablo | Koru |
| Supabase Auth | Sızdırılmış parola koruması kapalı | Prod öncesi düzelt |

Supabase Security Advisor bulguları (24.10.2026):
- **INFO:** `rls_enabled_no_policy` — iki iç tablo için. Deny-by-default tasarımıyla tutarlı; kamuya politika açma.
- **WARN:** `authenticated_security_definer_function_executable` — `admin_set_order_status_audited`. Bu doğrudan gerçek bir güvenlik açığı kanıtı değildir; ancak `SECURITY DEFINER` kodunun bütün yetki kontrolleri ve çağrılabilirliği mutlaka uzman incelemesinden geçmelidir.
- **WARN:** `auth_leaked_password_protection` — Supabase Auth ayarında kapalı.

Resmî belgeler:
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/auth/password-security

## 3. Audit saklama ve silme politikası — karar bekliyor

**Gerçek:** Şu anda doğrulanmış bir veri saklama süresi veya otomatik imha görevi yoktur. Dört Preview test olayı korunmuştur. `actor_uid` ve sipariş kimliği işlem izinin parçalarıdır; sınırsız tutma kararı da otomatik silme kararı da verilmemelidir.

**Uygulanacak kontrol kuralı:**
1. Hukuk/KVKK danışmanı ve veri sorumlusu, işlem amacını, ilgili yasal yükümlülükleri, olay günlüklerinin kişisel veri niteliğini, saklama süresini ve silme koşullarını yazılı tanımlasın.
2. **Karar verilene kadar** otomatik audit temizleme işi kurma ve olayları silme.
3. Süre belirlendiğinde, onaylı saklama kuralı + öngörülebilir arşiv/export + sadece yetkili manuel/otomatik imha + işlem sonrası bütünlük testi tasarla.
4. Üretim için erişim ve saklama kararını Preview bulgularından bağımsız olarak yeniden doğrula.

## 4. Parola güvenliği — Preview'da yönetici aksiyonu

Supabase Dashboard → proje **cadde-depo-preview** → Authentication → Email sağlayıcı/parola güvenliği ayarları:
- Desteklenen planda **Leaked password protection** aç.
- Güçlü minimum parola uzunluğu ve karakter politikası belirle.
- Mümkünse MFA'yı yönetici hesaplarında zorunlu kıl; oturum süresi ve yetki değişimi sonrası token yenileme planı oluştur.
- Ayar sonrası Supabase **Security Advisor**'ı yeniden çalıştır.
- Bağlayıcıda mevcut Auth ayarlarını güncelleme aracı bulunmadığından bu ayar yapılmış **sayılmıyor**.

## 5. Üretim yayınlama kapıları

| Kapı | Mevcut karar | Başarı eşiği |
|---|---|---|
| A — Gerçek talep / stok atomikliği | SQL ve manuel test geçti | Uçtan uca eşzamanlı POST testi ve tekrar deneme koşulları geçmeli |
| B — Yönetici ve audit | Preview geçti | Üretim RBAC, audit ve geri alma planı gözden geçirilmeli |
| C — Parola koruması | Açık | Supabase Advisor uyarısı giderilmeli ya da alternatif kontrol açıkça onaylanmalı |
| D — Saklama/erişim politikası | Açık | Yazılı saklama süresi, sorumlu, erişim rolü, silme usulü |
| E — Yayın / PR | Bloke | Taslak PR kapıları tamamlanmalı, `mergeable=false` nedeni çözülmeli, kod incelemesi yapılmalı |
| F — Üretim konfigürasyonu | Bloke | `api/whatsapp-request.js` kodu özellikle `VERCEL_ENV=preview`, Preview Supabase ref'i ve branch adına kilitli. **Bu hâliyle üretim checkout'u için kullanılamaz.** Üretim uyarlaması, secret ayrımı, geri dönüş planı ve production'a özgü Turnstile doğrulaması yapılmadan birleştirme! |

## 6. İlk yedi günlük kapanış planı

**Gün 1–2 — Teknik sorumlu:** PR birleştirilememe nedenini çöz; bağımsız kod incelemesi; audit ve RPC least-privilege kontrolü. Başarı: kritik açıklık yok. Durma: izin atlaması veya bağımlılık uyumsuzluğu.

**Gün 3–4 — Operasyon / test sorumlusu:** Eşzamanlı gerçek API POST'ları, hata/retry, başarısız Turnstile, kesilen bağlantı ve yönetici oturum yenileme testlerini Preview'da tamamla. Başarı: veri kaybı, çift stok düşüşü ve yanlış müşteri birleştirmesi yok. Durma: bir kritik test başarısız.

**Gün 5–6 — Proje sahibi / güvenlik sorumlusu:** Supabase Auth parola koruması ve audit saklama politikası kararı, geri dönüş/runbook, üretim sırları ve fiyat/stok geçiş denetimi. Başarı: kararlar belgelendi. Durma: kural/sorumlu belirsiz.

**Gün 7 — Yayın sorumlusu:** Ayrı üretim yayını için kontrol listesi ve geri dönüş senaryosu üzerinden go/no-go. **Otomatik merge veya üretim SQL aktarımı yok.**

## 7. Değişiklik disiplini

Bu dosya bir **denetim kaydı ve yayın kapısı listesi**dir; tek başına üretime hazır olunduğuna dair sertifika değildir. Üretim dosyaları, production veritabanı, ana dal ve canlı siparişler bu denetim kapsamında değiştirilmemiştir.
