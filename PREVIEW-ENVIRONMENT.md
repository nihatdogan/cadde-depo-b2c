# Preview izolasyonu — güncel işletim kararı

> Güncel güvenlik çalışması: SECURITY-READINESS.md. Yönetim geniş canlı RLS/ACL bulgularını doğruladı; yeni iki aşamalı yetki/sipariş geçişi hazırlanıyor. Eski test sonuçları tarihsel kapsamdadır; canlı uygulama veya geniş izinleri koruma onayı değildir.

15.10.2026 yönetim kararı: Yeni Supabase projesi oluşturulmayacak. Mevcut production altyapısına güvenli geçiş `PRODUCTION-READINESS.md` ve ayrı production migration üzerinden hazırlanır.

Preview canlı Supabase’e bağlanmaz. Ayrı test projesi kurulmayacağı için Preview veritabanı bağlantısı yapılandırılmadan, güvenli biçimde kapalı kalır. Bu bir hata veya production’a fallback gerekçesi değildir. VERCEL_ENV değerini production olarak zorlamayın.

Runtime koruması değişmedi: index.html, urun.html, admin.html ve admin-gorsel.html; `/api/public-config` ve `/supabase-client.js` üzerinden yapılandırılır. Statik HTML environment değişkenlerini kendiliğinden okumaz. Sunucu yalnız public alanları döndürür; yanıt no-store’dur. Production public URL/anahtar ve auth seçenekleri aynıdır. Eksik/geçersiz Preview ayarında SDK/auth/DB çağrısı oluşmaz. Görsel upload API’si de production sunucu anahtarına fallback yapmaz.

Kodda önceki ayrı test projesi denemesi için PREVIEW_SUPABASE_PROJECT_REF, PREVIEW_SUPABASE_URL, PREVIEW_SUPABASE_PUBLISHABLE_KEY, isteğe bağlı PREVIEW_SUPABASE_SERVICE_ROLE_KEY/PREVIEW_ADMIN_EMAILS desteği korunur; **güncel karar kapsamında bunları doldurmak için yeni proje oluşturmayın ve canlı değerleri buraya kopyalamayın.**

`supabase/order-on-demand.sql` ve test-only çalıştırıcısı değişmedi. Bunlar production’da kullanılmaz. Yeni production taslağı: `supabase/order-on-demand.production.sql`; ancak canlı şema/yedek doğrulaması ve açık yönetici uygulama onayından sonra ele alınabilir. Build/deploy hook’u migration çalıştırmaz.

53 yerel test geçti; testler izole PGlite ve mock hedefleri kullanır, gerçek Supabase projesi veya müşteri verisi kullanmaz. Şu aşamada hiçbir uzak DB değişikliği, main merge veya production deploy yapılmadı.
