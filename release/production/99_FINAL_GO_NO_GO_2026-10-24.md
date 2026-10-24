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