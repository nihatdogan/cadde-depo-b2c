# CADDE DEPO — AUTH / DENETİM VERİSİ GÜVENLİK KARAR KAPISI

**24 Ekim 2026 · Durum: NO-GO / uygulama kararı bekliyor.**  
**Doğrulama:** Production Supabase Security Advisor SELECT/inspection; Preview Advisor; Production fonksiyon yetkileri okunmuştur. Canlı Auth ayarı veya RLS değiştirilmemiştir.

## Supabase Advisor — kanıt
Production:
- `auth_leaked_password_protection`: **WARN — kapalı**.
- `anon_security_definer_function_executable`: **WARN**. Kaynak `public.rls_auto_enable()`: `RETURNS event_trigger`, yeni public tablolar için RLS açıyor. `anon` ve `authenticated` rolleri katalog yetkisi açısından EXECUTE görüyor. **Bu, anonim kullanıcının API üzerinden keyfî event-trigger çalıştırabildiğinin kanıtı değildir.** Fonksiyonun kullanım bağlamı ve event trigger kayıtları incelenmeden "anon yönetici yetkisini ele geçiriyor" sonucu çıkartma. İşlevi silme/kapatma.
- `authenticated_security_definer_function_executable`: Aynı rutin ile ilgili uyarı; önce işlev/çağrı kapsamını incele.
- `rls_enabled_no_policy`: INFO. Tablo kimliğini, kullanım amacını ve exposed schema olup olmadığını kontrol et; körlemesine policy açma.

Preview:
- `auth_leaked_password_protection`: kapalı.
- Yönetici audited RPC için `authenticated_security_definer_function_executable` WARN. Kodda JWT app_metadata.admin kontrolü bulunuyor; ama JWT tazeliği/MFA ve izin matrisi ayrıca incelenmeli.
- Private iç tablolar `rls_enabled_no_policy`: INFO; anon/auth erişimine açılmaması tasarım gereğidir.

## Kullanıcı tarafından yapılacak Dashboard kararları
1. Supabase Dashboard → **önce Preview** → Authentication → Security/Email password ayarlarında leaked password protection (paket/erişime bağlı) özelliğini doğrula ve etkinleştir. Sonra Security Advisor'ı yeniden çalıştır.
2. Admin MFA gereksinimi ve `auth.jwt()` freshness kontrolü: ikinci faktör kaydı, token expire / oturum kapatma prosedürü ve kurtarma hesabını belirle. Yalnızca `app_metadata.role=admin` yeterli operatör disiplini değildir.
3. Production için aynı ayarları **ayrı ve açık onayla** planla. Buradan Production Auth ayarı değiştirilmedi.

## Audit saklama ve KVKK kapısı
- **Olgu:** Önceki Preview testiyle üretilmiş 4 admin audit olayı korundu. Production'da bu yeni tablo mevcut değil.
- **Risk:** admin `actor_uid`, `order_id`, IP ilişkilendirmesi ve işlem zamanları kişisel veriyle ilişkilendirilebilir.
- **Karar bekliyor:** veri sorumlusu/hukuk uzmanı hangi kayıt için hangi amaç, mevzuat kaynaklı saklama zorunluluğu, erişim rolü, gerektiğinde anonimleştirme/silme, erişim denetim aralığı ve imha prosedürünü yazılı onaylasın.
- **Önerilen geçici tasarım:** Gereksiz IP/ad/telefonu audit tablosuna alma; doğrudan tablo erişimi açma; erişim yalnız yetkili, denetlenen yönetim süreciyle; otomatik silme görevi saklama kararı verilmeden kurma. **Bu bir yasal saklama süresi tayini değildir.**
- Tüketici sipariş evrakının saklama yükümlülüğü ile uygulama operasyon audit süresi aynı olmak zorunda değildir. Resmî hukuk/vergi kaynaklarını ayrıca doğrula.

## Durma ve başarı
- Üretim gizli anahtarları istemciye veya CI loglarına sızarsa DUR.
- Leaked password protection/MFA kontrolü tamamlanmadan kullanıcı yönetimi GO ilan edilmez.
- Birleşmeden önce Production RBAC/RLS/GitHub owner onayı, geri dönüş planı, audit veri yönetimi kararı dosyalanır.

Kaynak dokümanlar:
- https://supabase.com/docs/guides/auth/password-security
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/database/database-linter
- https://www.kvkk.gov.tr/

**NO-GO.** Bu dosya yalnızca doğrulanmış bulgular ve gereken insan/onay işlemlerini içerir.
