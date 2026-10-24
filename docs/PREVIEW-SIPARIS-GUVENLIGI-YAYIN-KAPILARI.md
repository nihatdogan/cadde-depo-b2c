# Cadde Depo — Preview güvenli yayın kapıları (23.10.2026)

## Karar
**ERTELE — üretime birleştirme yok.** Önizleme Vercel URL'si `login_required` döndürüyor; bağlı Vercel hesabı proje erişiminde 403 veriyor. Gerçek tarayıcı uçtan uca testi doğrulanmadı.

## Doğrulanan
- GitHub preview dalı, doğrulanmış önizleme hostunda `cadde-depo-preview` Supabase projesine bağlanıyor.
- Atomik stok rezervasyonu iki bağımsız eşzamanlı onayda yalnız ilk siparişi kabul etti; diğerinde yetersiz stok hatası oluştu.
- Test verileri silindi; preview 3 ürün / 3 sipariş / 3 sipariş kalemi.
- WhatsApp talep oluşturma RPC'si `create_whatsapp_request` anonim EXECUTE iznine sahip ve kontrollü ürün bilgisiyle talep yazıyor. Bu uç nokta doğrudan internete açık.

## Kritik üretim kapıları
1. **Vercel yetkisi:** Vercel > Settings / Connections üzerinden `nihat-proje` ekibine ve `caddedepo-b2c` projesine erişimi doğrula. Korumalı preview linkini yetkili tarayıcıda test et. Doğrulanmadan otomatik tarayıcı sonuçları "başarılı" sayılmaz.
2. **Rate limit ve bot kontrolü:** Doğrudan `anon` RPC çağrısını genel erişimden kapatıp `POST /api/whatsapp-request` üzerinden server-side Turnstile doğrulaması ve sunucu tarafında kullanıcı/IP tabanlı atomik kota uygula. Turnstile secret ve varsa Redis/Rate-limit kimlik bilgileri **yalnız sunucu ortam değişkenlerinde** olmalı. Turnstile başarısız/eksikse istek fail-closed reddedilmeli. `x-forwarded-for` gibi istemcinin taklit edebileceği header'lar tek başına yetkilendirme sinyali değildir. Doğrudan Supabase RPC açıkken yalnız istemci UI'sına captcha eklemek koruma sağlamaz.
3. **Sipariş yaşam döngüsü:** Talep kayıtları stok rezerve etmez; `admin_set_order_status` onayda atomik stok düşer, iptal edilen rezerve siparişin stoğu geri döner. Admin doğrulamasının `app_metadata.role=admin` şartıyla çalıştığı gerçek authenticated istemci isteğinde de test edilmeli.
4. **Güvenlik danışmanı:** `SECURITY DEFINER` RPC'lerini ve yetkilerini ayrı incele. Bkz. https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable . Sızmış parola korumasını Supabase Auth ayarlarından değerlendir.
5. **Uçtan uca:** Preview ürün #6 pasif sayfa → 404/bulunamadı; ürün #5 aktif; müşterinin eski sepetinde fiyat/stok değişince talep bloklanır; uygun teklif tek kayıt oluşturur; yanlış Turnstile ve kota aşımı 4xx; 2 eşzamanlı siparişten tek onay kabul edilir; iptalde geri dönüş bir defadır.
6. **Go/no-go:** Üretim için ayrıca ayrı SQL migration ve geri dönüş planı hazırlanmalı; preview tablosunun şema farkı canlıya körlemesine taşınmamalı. PR #1 taslak kalsın.

## Kısıt
Vercel ekip/proje erişimi bu oturumda 403 olduğundan Vercel ayarları değiştirilemedi; canlıya dağıtım yapılmadı.
