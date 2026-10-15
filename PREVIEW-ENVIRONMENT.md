# Vercel Preview / Supabase ortam ayrımı

Bu dal production deploy, main merge veya canlı veritabanı değişikliği içermez. Mevcut production proje URL’si, public anahtarı ve varsayılan auth seçenekleri korunur. Production için Vercel değişkenlerini değiştirmeyin.

## Runtime yapılandırma
Dört frontend (index.html, urun.html, admin.html, admin-gorsel.html) önce Supabase SDK’yı, ardından `/api/public-config` ve `/supabase-client.js` dosyasını yükler. Statik HTML’in process.env okuyacağı varsayılmaz. Vercel Function sunucudaki `VERCEL_ENV` değerine göre yalnız `{environment, projectRef, url, publishableKey}` döndürür. Build komutu veya framework eklenmedi. Gizli sunucu anahtarları döndürülmez. Yanıt tarayıcı/CDN katmanlarında no-store’dur.

- `production`: mevcut canlı public bağlantısı aynı kalır. Preview değişkenleri okunmaz.
- `preview`: yalnız açıkça tanımlanmış bağımsız test projesi kabul edilir. Genel `SUPABASE_URL` / diğer production değişkenlerine fallback yoktur.
- `development`: aynı ayrı test değişkenleri gerekir; `vercel dev` gibi Function çalıştıran yerel ortam gerekir. Düz dosya/statik sunucu ile açılırsa bağlantı durur.
- Ortam yoksa/tanınmıyorsa, test URL’si eksikse, ref ile eşleşmiyorsa veya canlı ref ise: endpoint 503; istemci uyarı verir ve Supabase client oluşturmadan durur. Login/refresh, sorgu, talep ve yazma başlatılmaz.
- Yalnız HTTPS `https://<20-karakter-proje-ref>.supabase.co` kabul edilir. Özel alan adları, proxy ve ek URL parçaları bu küçük çözümde desteklenmez.
- Test oturumu farklı storageKey kullanır; URL’den otomatik session alma kapalıdır. Test yöneticisi ayrı projede e-posta/şifreyle giriş yapar.

## Vercel’de tanımlanacak değişkenler
Vercel → Project → Settings → Environment Variables. **Yalnız Preview** kapsamını, tercihen `codex/brabantia-385728-on-demand` dalını seçin:

| İsim | Değer / kapsam |
| --- | --- |
| `PREVIEW_SUPABASE_PROJECT_REF` | Ayrı test projesinin 20 karakterlik referansı; canlı proje olamaz. |
| `PREVIEW_SUPABASE_URL` | Tam olarak `https://<test-ref>.supabase.co` — sonda slash yok. |
| `PREVIEW_SUPABASE_PUBLISHABLE_KEY` | Aynı test projesinin `sb_publishable_…` public anahtarı. Eski JWT anon anahtar da rol/ref kontrolüyle desteklenir. Service-role/secret kabul edilmez. |
| `PREVIEW_SUPABASE_SERVICE_ROLE_KEY` | **İsteğe bağlı; yalnız görsel yükleme testi için. Gizli sunucu değişkeni.** Test projesinin service_role JWT veya sb_secret anahtarı. Olmazsa sadece upload API 503 döner; katalog ve talep public anahtarla çalışabilir. |
| `PREVIEW_ADMIN_EMAILS` | İsteğe bağlı virgülle ayrılmış test yönetici e-postaları. Bu listeye ek olarak upload için test kullanıcısının sunucudan yönetilen `app_metadata.role=admin` olması zorunlu. |

`VERCEL_ENV` Vercel sistem değişkenidir; kendiniz production diye tanımlamayın. Sistem ortam değişkenlerinin Function’a açıldığını doğrulayın; yoksa bağlantı güvenli biçimde kapalı kalır. Development kullanacaksanız test değerlerini ayrıca Development kapsamına ekleyin.

Değişkenleri ekledikten sonra yalnız bu dal için **yeni Preview deployment/redeploy** oluşturun. Mevcut deployment’ın environment snapshot’ı kendiliğinden güncellenmez. Bu çalışma Vercel ayarı veya deployment yapmadı.

## Görsel API’si
`api/admin/upload-product-image.js` aynı ortam seçiciyi kullanır. Preview’da production `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` ve `ADMIN_EMAILS` değişkenleri okunmaz. Test public ayarı eksikse veya ayrı test secret yoksa auth/storage HTTP isteği yapmadan durur. Test kullanıcısı test projesinin `/auth/v1/user` endpoint’inde doğrulanır, app_metadata admin rolü kontrol edilir ve yalnız test Storage’a yüklenir. Production’ın mevcut sunucu bağlantı/allowlist davranışı korunmuştur.

## Test migration — otomatik çalıştırılmaz
Yeni `supabase/order-on-demand.sql` artık yalnız test uygulaması içindir. Önceki yayın notundaki canlı migration adımının yerine bu bölüm geçerlidir.

Yerel manuel çalıştırıcı: `scripts/apply-preview-migration.cjs`. `psql` kurulu olmalıdır. Vercel build/deploy hook’u yoktur. Bu dosyayı canlı SQL Editor’e yapıştırmayın; eksik Preview işaretinde SQL daha DDL/seed başlamadan hata verir.

1. Ayrı test Supabase projesini kurun. Temiz test projesine yalnız burada temel şemayı uygulayın: `supabase-schema.sql`, `supabase-admin.sql`, `supabase/products-detail.sql`, `supabase/products-slug.sql`. Storage testleri için `urunler` test bucket’ı ve mevcut storage politikaları gerekir. Canlı şema/seed çalıştırmayın. Farklı taslak `supabase/schema.sql` kullanılmaz.
2. Test projesinde test yöneticisi oluşturup app_metadata.role alanını güvenilir Dashboard/Admin API yoluyla admin yapın; müşteri user_metadata alanı yetki vermez.
3. Yalnız yerel terminal oturumuna `PREVIEW_SUPABASE_PROJECT_REF`, `PREVIEW_SUPABASE_URL` ve gizli `PREVIEW_DATABASE_URL` verin. DB URL: `postgresql://postgres:<URL-encoded-test-password>@db.<test-ref>.supabase.co:5432/postgres?sslmode=verify-full`. **DB URL’yi frontend’e veya Vercel public değişkenine koymayın.** Yerel dosyaya kaydetmek gerekli değildir.
4. `npm run db:preview -- --check`: hedef ve migration doğrulanır, DB bağlantısı yapılmaz.
5. `npm run db:preview -- --apply`: yalnız doğrulanmış doğrudan test DB hostname’ine psql ile, sertifika doğrulaması açık TLS üzerinden bağlanır. Gerekirse test projesinin güvenilir CA dosyasını yerel `PGSSLROOTCERT` ile sağlayın. SQL tek transaction içindedir; hata durumunda commit olmaz. Parola komut satırına veya çıktıya yazılmaz.

Çalıştırıcı production ortamını/canlı ref’i, farklı DB hostunu, pooler/proxy’yi, kapalı TLS’yi reddeder. Doğrudan test hostunun ağ/IPv6 erişimi gerekir; erişilemezse production veya pooler’a otomatik geçiş yoktur. SQL işaretleri tek başına sunucunun kimliğinin kanıtı değildir; asıl hedef kontrolünü hostname+TLS doğrulayan çalıştırıcı yapar. Bu işaretleri elle canlıda set etmeyin.

## Doğrulama
`npm test` ağ bağlantısı kurmadan izole PGlite PostgreSQL üzerinde RLS, talep ve yönetici RPC kontrollerini çalıştırır. Ortam testleri Function yanıtını, SDK oluşturmayı ve auth/storage fetch çağrılarını yerel mock’larla sınar; gerçek Supabase anahtarı/bağlantısı kullanılmaz. Başarı, gerçek Preview projesinin hazır olduğunu göstermez.

Test değişkenleri girildikten sonra Preview’da ayrıca doğrulayın:
- `/api/public-config` yalnız test URL/ref/public key göstermeli; secret göstermemeli. Eksik ayarda 503 olmalı.
- DevTools Network’te Supabase auth/rest/storage istekleri yalnız test-ref alan adına gitmeli; canlı ref’e hiç istek gitmemeli.
- Test katalog → talep → WhatsApp taslağı → test yönetici → maliyet/teyit → kesinleştirme akışını test verisiyle deneyin. WhatsApp mesajı otomatik gönderilmez.
- Normal kullanıcının maliyet okuma/doğrudan yazma/teyit/kesinleştirme girişimleri reddedilmeli.
- Test ayarlarından biri kaldırılmış yeni bir Preview’da tüm veritabanı işlemleri client oluşturulmadan durmalı. Production değişkenleri mevcut olsa bile fallback olmamalı.

Canlı Supabase’e bu çalışma sırasında bağlanılmadı; migration hiçbir uzak veritabanında çalıştırılmadı. Gerçek test projesi bağlantısı ve Preview uçtan uca doğrulaması environment ayarlarından sonra bekler.

Resmî kaynaklar: https://vercel.com/docs/environment-variables/system-environment-variables ; https://vercel.com/docs/environment-variables ; https://vercel.com/docs/caching/cache-control-headers

## Son yerel test sonucu
`npm test`: **31/31 geçti**. Ortam seçimi/yanıt allowlist’i, no-store, eksik ayarda sıfır client/HTTP çağrısı, test auth session ayrımı, test upload yetkisi/hedefi, migration hedef doğrulaması ve SQL ortam engeli, RLS/yönetici yetkileri ve sipariş talebi/katkı kuralları doğrulandı. Gerçek Vercel Preview veya uzak Supabase bağlantısı kullanılmadı.
