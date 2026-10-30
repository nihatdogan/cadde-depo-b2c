# CADDE DEPO — PR #3 Preview doğrulama ve yayın kapısı

Durum: **DRAFT / NO-GO**. Bu çalışma `main` veya Production veri tabanına uygulanmamalıdır.

## 1. İzolasyon (kodda tamamlandı)
- `index.html`, `urun.html`, `admin.html`, `admin-gorsel.html`: yalnız `caddedepo.com` / `www.caddedepo.com` → Production; diğer hostlar → `cadde-depo-preview`.
- `api/admin/upload-product-image.js`: `VERCEL_ENV` ile `SUPABASE_URL` hedefi eşleşmiyorsa HTTP 503 döndürür. Sadece `app_metadata.role=admin` ile yükleme kabul edilir.
- Vercel Preview sunucu ortamındaki `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` **yalnız Preview Supabase projesine** ait olmalı. Bağlı Production anahtarının kopyası kullanılmamalı. API güvenli biçimde hata veriyorsa gizli anahtarları sohbete taşımayın; Vercel ortam değişkenlerini kendi panelinizden düzeltin.
- Tarayıcıda yalnız `sb_publishable_...` kullanılmalı; server-side `service_role` asla tarayıcı koduna konmamalı.

## 2. Eski beş kartın korunması (kodda tamamlandı)
- `yakinda-gelecek.js` dinamik `cd_list_upcoming_products()` RPC'den tanıtım kaydı okur.
- RPC migration nedeniyle yoksa yalnız `PGRST202` / `42883` için mevcut beş statik tanıtım kartına geri döner.
- Ağ veya yetki hatalarını sessizce geçerli katalog sanmaz; ilgili hatayı konsola yazar.
- Kartlarda fiyat, stok, sepet ve satış butonu yoktur.
- Migration kurulduğunda yalnız `status='upcoming'` kayıtları görüntülenir.

## 3. Preview migration (BEKLİYOR — güvenlik kontrolü uygulanmasını engelledi)
Dosya: `supabase/pr3-upcoming-catalog-preview.sql`

Hedef Supabase: **cadde-depo-preview** (ref: `emnacsavgsjkrocpngcj`). Bu dosyayı Production projesinde çalıştırmayın.

Migration başlamadan önce **salt okunur** baz kayıtlarını ve varsa mevcut tablo isimlerini not edin. Başlangıç gözlemi (30 Ekim 2026): Preview 3 ürün, 9 sipariş, 9 sipariş kalemi; `upcoming_products` yoktu. Sayılar değişirse yeni baz değerini esas alın.

Migration hedefleri: `upcoming_products` kayıt tablosu, admin rolüyle sınırlandırılmış RLS, tanıtım alanlarıyla sınırlı public read RPC, 5 adet seed, atomik satışa açma RPC'si ve audit tablosu.

**Güvenlik:** `cd_pr3_internal.release_gate` içinde `sales_publish=false` varsayılandır. Yetkili admin bile bu kapı açılmadan ürün yayınlayamaz. Yönetim panelinde kapıyı açan düğme yoktur.

## 4. Gerekli negatif testler (Preview)
- Anon `upcoming_products` tablosunu okuyamaz veya değiştiremez; `cd_list_upcoming_products()` yalnız tanıtım alanlarını döndürür.
- Taslaklar public RPC'ye düşmez; `upcoming` beş kart olarak görünür.
- Standart `authenticated` kullanıcı admin kayıtları okuyamaz/değiştiremez.
- Admin `aal1` yayınlayamaz; `aal2` admin bile `sales_publish=false` iken yayınlayamaz.
- Eksik fiyat, fiilî stok, kondisyon, tedarik, garanti veya kargo kanıtıyla yayınlama başarısız olur.
- Mevcut `products`, `orders`, `order_items` satır sayıları ve sipariş içerikleri değişmez.
- Farklı Preview/Production anahtarları ve hedefleri karşılaştırılır; Preview sunucu yükleme endpoint'i yanlış hedefte 503 döndürür.
- Çeşitli tarayıcılarla görseller, erişilebilirlik, mobil grid kontrol edilir.

## 5. Release kapısı ve pozitif testler (şimdilik yasak)
Aşağıdakiler tamamlanmadan `sales_publish` kapısını açmayın:
1. Sipariş, eşzamanlı stok düşüşü, iadeler ve ödeme/tahsilat kontrolü PR #1 ve #2 güvenlik başlıklarında doğrulansın.
2. Ticari onay: tedarik mülkiyeti, maliyet, fiyat, KDV, gerçek stok, kondisyon, ürün ve garanti yükümlülükleri, kargo koşulları belgeli olsun.
3. Preview'da DBA tarafından ayrı gözden geçirilmiş geçici açma işlemiyle tek ürünün atomik yayınlanması, tekrar çağrısı, eşzamanlı iki çağrı, işlem günlüğü ve geri alma davranışı test edilsin. Ürün alımını ve stok rezervasyonunu end-to-end doğrulayın. Test bitince yayın kapısını tekrar kapatın.
4. Production migration, Vercel Production, `main` merge ve gerçek satış aktivasyonu için **ayrı ve açık onay** alınsın.

## 6. Kontrol kanıtları
- GitHub Actions: `PR3 Preview Safety (read-only)` → Node.js statik/sözdizimi ve güvenlik kontrolü.
- Son Preview deploy'un `READY` olması bir **build sonucu**dur; veri tabanı, RLS veya gerçek sipariş testi sonucu değildir.
- Merge kararı: **NO-GO**, Preview migration ve E2E kanıtları oluşana kadar korunacak.
