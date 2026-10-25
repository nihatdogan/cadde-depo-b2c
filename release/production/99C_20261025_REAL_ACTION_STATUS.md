# CADDE DEPO — 25.10.2026 Gerçek Üretim Kanıtları: Son Durum

**Karar: PRODUCTION NO-GO.** PR #2 yalnızca güvenli hazırlıktır. `main` birleştirilmedi, Production DB/Auth yapılandırması değiştirilmedi, `caddedepo.com` checkout değiştirilmedi.

## Bu oturumda doğrulanan
- Production PostgreSQL 17.6; Project `svyqmmivhpfiuhxnmhny` ACTIVE_HEALTHY, dev branch 0.
- Production yönetici 1; doğrulanmış MFA faktörlü yönetici **0**.
- Production sipariş 4, order_items 4; 3 `whatsapp_bekliyor`, 1 `teslim`; SKU #29 sistem stoğu 5, max_stok 5, aktif true.
- Sentetik PG17 PostgreSQL dump ve ayrı DB restore CI: https://github.com/nihatdogan/cadde-depo-b2c/actions/runs/40207577269 **SUCCESS**. Paralel PG16 isolated integration da SUCCESS. Bunlar **Production kaynak verinin yedeği/restore kanıtı DEĞİL**.
- PR #2 içinde önceki taslak MFA ekranı yalnız Preview Supabase projesine sabitlidir; Production hesabının gerçek TOTP kurulumu değildir.
- Bağlı Google Drive ve Gmail üzerinde Cadde Depo için siparişe ait teslim irsaliyesi veya imzalı sayım evrakı doğrulanamadı. Aramanın kapsamı bağlı hesaplarla sınırlıdır.

## Açık ve yalnız insan yetkisi/işlemle doğrulanabilir kapılar
1. **Production MFA:** Yönetici kendi cihazında TOTP enrollment + challenge + verify; Production Auth faktör kaydı `verified`, ilgili oturumda `aal2`, yetki denemeleri ve bağımsız ikinci kontrol. TOTP QR/kod/sessions/veri GitHub'a ve sohbete alınmaz. Kullanılabilir güvenli Production enrollment yüzeyi henüz yoktur; yayın için ayrı açık değişiklik onayı gerekir.
2. **Saha belgeleri:** Dört siparişin gerçek müşteri talebi, rezervasyon, tahsilat veya teslim belgeleri ve SKU #29'un imzalı 5 birimlik sayım/mülkiyet/kondisyon/tahsis formu. Eski teslim bugünkü beş adetten ikinci kez düşülmez. Evraklar güvenli özel arşivde kalmalı; GitHub'da yalnız maskeli referans/kanıt sonucu tutulmalı.
3. **Gerçek backup/restore:** Üretim PG17 yedeğinin kaynağı, arşiv kimliği/tarihi, hash, erişim kontrolleri ve **ayrı maliyet/onay kontrollü** PG17 hedefe restore. RPO/RTO ölçülmeli, `orders=4` / `order_items=4` / SKU #29 = 5 ve auth/Storage kapsamı karşılaştırılmalı. Hiçbir koşulda Production veritabanı üzerine restore yapılmamalı.
4. Gerçek Turnstile + Vercel Preview + managed Supabase RPC v3 HTTP checkout ve kapalı/açık feature flag kanıtları, Production RLS/GRANT ve güvenlik danışmanı uyarıları ve migration/rollback onayı ayrıca bekliyor.

## İmza kapısı
- MFA cihaz sahibi + güvenlik sorumlusu: **BEKLİYOR**.
- Satış, depo ve finans kaynak belge + ikinci kontrol: **BEKLİYOR**.
- DB yöneticisi gerçek restore + ikinci kontrol: **BEKLİYOR**.
- Teknik QA gerçek E2E HTTP: **BEKLİYOR**.
- Production yazma/deploy yetkilendirmesi: **AYRI AÇIK ONAY GEREKİR**.

**Başarı sayılmayan:** CI'da synthetic PASS; Supabase Preview'da MFA factor verified; production siparişi 'teslim' yazması; beş adet sistem stoğu; Vercel Preview READY.

**Sonuç:** Daha ileri production GO imzası verilmez. Production verileri, main ve canlı checkout korunur.
