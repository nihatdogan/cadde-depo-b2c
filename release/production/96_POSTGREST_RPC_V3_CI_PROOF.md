# CADDE DEPO — POSTGREST + RPC V3 GERÇEK HTTP ENTEGRASYON KANITI

**Tarih:** 24 Ekim 2026  
**Karar:** DENE / Production NO-GO  
**CI:** https://github.com/nihatdogan/cadde-depo-b2c/actions/runs/40106217942

## Doğrulanan
GitHub Actions ephemeral `postgres:16` ve iki gerçek `postgrest/postgrest:v12.2.8` HTTP servisiyle sentetik veri kullanıldı. `POST /rpc/create_whatsapp_request_protected_v3` gerçek SQL RPC'yi çağırdı.

- Eski v2 kaynak kaydı olmayan isteğin yeniden kullanımı reddedildi.
- Aynı idempotency anahtarıyla eşzamanlı HTTP çağrıları tek sipariş döndürdü.
- Farklı anahtar / aynı ziyaretçi-sepet tekilleşti.
- Ayrı ziyaretçiler aynı IP hash ve sepetle farklı sipariş oluşturdu.
- Fiyat uyuşmazlığı reddedildi.
- Anonim PostgREST rolü hem RPC v3 hem doğrudan `orders` yazma denemesinde reddedildi.
- Önceki CI basamaklarında gerçek Cloudflare Siteverify test anahtarları, yönetici audit, stok geri iadesi, ayrı PostgreSQL bağlantıları, yerel HTTP retry ve geçiş/rollback testleri de geçti.
- GitHub CI durumu: **success**.

## Test sınırı
- PostgREST yerel Docker servisidir, yönetilen Supabase HTTP hosting'i değildir.
- CI `service_role` PostgREST varsayılan rolü sunucunun test servisinde yapılandırıldı; anonim servis ayrı rol/portta test edildi. Bu kurulum **kesinlikle internet üzerinde yayımlanmamalı**, gerçek service role anahtarı yerine geçmez.
- Cloudflare Siteverify gerçek servise bağlandı fakat resmî dummy test belirteci kullanıldı; müşteri CAPTCHA'sı çalıştırılmadı.
- Vercel Preview'dan gerçek Cloudflare Siteverify + izole Supabase products GET bağlantısı daha önce geçti; bütün zincirde gerçek v3 checkout henüz yönetilen Supabase projesinde kurulmadı.
- Sonuç gerçek Production Supabase migration, yetki/grant veya ürün stoğu değişikliği değildir.

## Kapanış için kalan kanıtlar
1. Ayrı onaylı, izole yönetilen Supabase ortamında v3 schema/RPC ve korumalı Vercel Preview'la uçtan uca onay/iptal + cleanup testi; prod kimlik/anahtarlarından ayrılmalı.
2. Ürün #29 fiziksel sayımı, teslim edilmiş 1 siparişin evrakı ve bekleyen üç talebin gerçek statüsü.
3. Supabase Auth leaked password koruması, yönetici MFA ve audit veri saklama politikası kararları.

**Ana karar: NO-GO.** PR #2 taslak kalır; Production Supabase, `caddedepo.com`, `main` değiştirilmez.
