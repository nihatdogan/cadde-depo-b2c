# CADDE DEPO — 24.10.2026 ÜRETİM GO / NO-GO KARARI

**KARAR: NO-GO — ÜRETİM AÇILIŞINA ONAY VERİLMİYOR.**

## Doğrulanan
- Bağımsız CI: PostgreSQL 16 + gerçek PostgREST HTTP + RPC v3 sentetik entegrasyon ve stok testleri başarılı.
- Gerçek Vercel Preview: Cloudflare resmî test Siteverify ve Preview Supabase salt-okunur ürün sorgusu başarılı. Tam yönetilen Supabase v3 sipariş POST'u henüz yapılmadı.
- Production: 4 eski sipariş, ürün #29 sistem stoğu 5; müşteri/stoğa yazma yapılmadı.
- Preview ve Production'da birer admin bulunuyor; hiçbirinde doğrulanmış MFA faktörü yok.
- Security Advisor her iki projede sızdırılmış parola korumasını kapalı gösteriyor. Supabase kuruluşu Free planında.

## Üç zorunlu kapanış
1. Yönetilen izole Supabase projesi/branch üzerinde v3 migration, gerçek HTTP, gerçek uygun Turnstile akışı, kontrol ve koşullu test temizliği. Yeni branch'in maliyet teklifi $0.01344/saat; kullanıcı ücreti açıkça kabul etmeden yeni ücretli branch oluşturulmadı.
2. SKU #29 için fiziksel sayım, 1 teslim kaydının irsaliye/teslim doğrulaması ve 3 bekleyen siparişin doğrulanması. Eski admin durum güncellemesi otomatik stok düşürmez; fiziksel satılabilir stok belirsiz.
3. Admin MFA kurulumu, üretim adayında AAL2 zorunlu kontrolünün testi, leaked-password koruması veya onaylı alternatif ve KVKK audit amaç/saklama/erişim/imha politikası.

## GO kriteri
Tüm kapılar belgelenip bağımsız onaylanmadan Production migration, GitHub main merge ve caddedepo.com checkout cutover yapılmaz. Kesintide legacy anon INSERT yetkileri geri açılmaz.

**Üretim kararı NO-GO; PR #2 taslak.**
## 24 Ekim 2026 nihai ek doğrulama — canlı katalog
Production Supabase salt-okunur sayımı: **toplam 1 ürün, aktif 1 ürün, stok pozitif aktif 1 ürün**. Bu tek ürün **#29 Yağmur Sandıklı Köşe Koltuk**; sistem stok değeri **5** (fiziksel satılabilir stok doğrulanmadı). Siparişler: 3 `whatsapp_bekliyor`, 1 `teslim`. Ürün #29'u devre dışı bırakarak alternatif bir mevcut aktif SKU ile güvenli açılış **mümkün değildir**; başka aktif ürün bulunmuyor.

Aynı tarihte Production ve Preview'daki yönetici sayısı her birinde 1; her iki projede doğrulanmış yönetici MFA **0**. PR #2'de Preview yönetici MFA ekranı kod düzeyinde hazır; gerçek kullanıcı TOTP doğrulaması yok. Gerçek Turnstile üzerinden başarılı yönetilen Supabase v3 checkout testi yok.

**Üretim açılışı için insan eliyle kaçınılmaz kanıtlar:** fiziki sayım + teslim kanıtı + 3 bekleyen talep mutabakatı; cihazda gerçek TOTP MFA doğrulaması. Bu kanıtlar olmadan `GO` kaydı düzenlenemez. Üretim ortamında stok, sipariş, RLS ve Auth ayarları değiştirilmemiştir.
