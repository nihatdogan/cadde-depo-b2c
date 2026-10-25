# CADDE DEPO — Gerçek Kanıt ve Üretime Geçiş İmza Dosyası
**Tarih:** 25 Ekim 2026 · **Konu:** PR #2 · **Karar:** PRODUCTION **NO-GO**

> Bu belge üretim açılışının gerçekleştirildiği veya imzalandığı anlamına gelmez. Kaynak kanıtı ve sorumlu imzası olmadan herhangi bir satır PASS yapılamaz.

## 1. Read-only tespit — bugün doğrulanan
- PR #2 başlangıç HEAD: `b19940cba6a41bd8309d076bae269733731dbf36`, OPEN/DRAFT, main merge yapılmamış.
- Izole PostgreSQL 16 testleri / sentetik dump-restore: CI #40205969282 **SUCCESS**. Sentetik veriler, gerçek Production yedeği değildir.
- Üretim Supabase: `svyqmmivhpfiuhxnmhny`, PostgreSQL **17.6**, ACTIVE_HEALTHY, *0 development branch*. Test CI PostgreSQL **16** kullanıyor. PG17 eşdeğer restore henüz yok.
- Üretim: 1 yönetici, 0 doğrulanmış MFA faktörü; Preview: 1 yönetici, 1 doğrulanmış MFA faktörü.
- Üretim: `orders=4`, `order_items=4`, 3 `whatsapp_bekliyor`, 1 `teslim`; SKU #29 `stok=5`, `max_stok=5`.
- Üretim `main/admin.html`: MFA enrol/challenge/verify akışı yok; yalnız PR Preview `admin.html` içeriğinde mevcut. Doğrudan main merge yaparak bunu üretime sunmak **yasak** ve release gate'i atlatır.
- Güvenlik danışmanı: Production `auth_leaked_password_protection` WARN, `rls_auto_enable()` anon/auth SECURITY DEFINER EXECUTE WARN.
- Mevcut Vercel Preview Turnstile anahtarları PR #2 dalına scope edilmemiş; gerçek Vercel Preview/Turnstile/managed RPC v3 HTTP zinciri PASS değil.

## 2. Dört eski sipariş — kaynak tablo, otomatik karar yok
Referans: `80_LIVE_STOCK_RECONCILIATION_2026-10-24.md`. Kişisel ve müşteriye özgü evraklar GitHub'a konulmamalıdır.

| Order ID kısaltması | Mevcut DB durumu | Kanıt gereksinimi | İş kanıtı | Kontrol eden |
|---|---|---|---|---|
| `cb0d2c80…24f1` | whatsapp_bekliyor | Müşteri talebi/test olup olmadığı + rezervasyon/tahsilat teyidi | YOK | Satış sorumlusu: İMZA BEKLENİYOR |
| `2c20a703…2042` | whatsapp_bekliyor | Müşteri talebi/test olup olmadığı + rezervasyon/tahsilat teyidi | YOK | Satış sorumlusu: İMZA BEKLENİYOR |
| `ad2ce4ea…69d` | whatsapp_bekliyor | Müşteri talebi/test olup olmadığı + rezervasyon/tahsilat teyidi | YOK | Satış sorumlusu: İMZA BEKLENİYOR |
| `0e2a52e8…3785` | teslim | İrsaliye, sevk/teslim fişi, manuel stok hareketi/sayım tarihi | YOK | Depo/operasyon: İMZA BEKLENİYOR |

SKU #29 için 24 Ekim itibarıyla '5 adet fiziki sayıldı' **kullanıcı beyanı** mevcuttur, ama birim/konum/emanet/kondisyon/rezervasyon içeren imzalı fiş bulunmuyor. `satılabilir stok=5` **kanıtlanmış değildir**. Daha önce teslim edilmiş ürün, sonradan sayılan eldeki 5 birimden tekrar düşülmez.

**Kapanış ölçütü:** 4 siparişin her birinde güvenli evrak deposu referansı, doğrulayan kişi, tarih, ödeme/tahsilat statüsü, fiziksel stok etkisi; ikinci kişi tarafından miktar ve sipariş mutabakatı. Bunlar yoksa eski siparişe UPDATE veya otomatik sınıflama **yapma**.

## 3. Production MFA / AAL2 — GERÇEK KULLANICI KANITI GEREKİYOR
**Mevcut durum: BLOCKED; VERIFIED_FACTOR=0/1.**

1. Yeni yayın için yalnız MFA enrollment/bootstrap yüzeyi hazırlanmalı ve ayrıca onayla etkinleştirilmeli; genel checkout kapalı kalmalı. Mevcut main yönetici sayfasında MFA arayüzü yok.
2. Gerçek yönetici, kendi cihazında oturum açıp authenticator TOTP QR'ını kendisi kaydetmeli; kodu kendi cihazında girmeli. QR, kod, parolalar, access token veya refresh token PR'ye ve sohbete konmaz.
3. Supabase Auth'da ilgili yönetici için `auth.mfa_factors.status=verified` tekrar salt-okunur doğrulanmalı.
4. İlgili yöneticinin imzalı gerçek yeni oturumu `aal2` kullanarak admin ürün INSERT/UPDATE/DELETE güvenlik sınırı ve yeni audited RPC AAL2 zorunluluğu kontrollü olarak test edilmeli. Gerçek stok/sipariş kullanılmamalı.
5. AAL1 admin işlemleri güvenli biçimde reddedilmeli; yetki ve audit kayıtları incelenmeli.
6. İç kontrol sorumlusu kullanıcı oturumu test sonuçlarını gerçek log/kimlik gizlemesiyle kaydetmeli.

Dokümantasyon: https://supabase.com/docs/guides/auth/auth-mfa

## 4. Production yedek/restore kanıtı — GERÇEK DUMP İLE BAŞARILI TEST GEREKİYOR
**Mevcut durum: BLOCKED.** Production PostgreSQL 17.6; sentetik CI PostgreSQL 16. Production yedekleme stratejisi ve yönetilen saklama hizmeti proje planına göre değişir. Yalnızca source SQL SELECT veya pg_dump komut örneği restore kanıtı değildir.

**Yalnız DB yetkilisi, kontrollü erişimle:**
1. Supabase Dashboard Database → Backups bölümünde mevcut yedekleme türü, son başarılı yedek zamanı ve saklama/PITR imkanı belirlenecek. Free plan için günlük otomatik backup varsayılmayacak.
2. Restore/test kaynağı alınırken bağlantı kullanıcıları, parolalar, ticari/müşteri verileri ve yedek kopyası gizli tutulacak. Veri yerini ve erişimini KVKK politikasıyla sınırla. Kaynaktan veri okumak bile gizlilik kontrolüne tabidir.
3. Veriyi mevcut Production'a geri restore **etme**. İzole, yetkili ve **fiyatı onaylanmış** ayrı hedefte PG17 uyumlu client ile geri yükleme tatbikatı yap.
4. `orders`, `order_items`, `products`, tablo şemaları, RLS, güvenlik politikaları, RPC tanımları, bütünlük, backup manifest hash ve yetkilerin eşdeğerliği karşılaştırılmalı. Özellikle legacy 4 sipariş ve SKU #29 tutarlılığı.
5. Kaynak/restore timestamp, kullanılan `pg_dump`/`pg_restore` sürümü, bağımsız doğrulayan, RPO ve RTO sonuçları imzalanmalı. Test ortamı saklama/imha planı kayıt altına alınmalı.
6. `auth` ve Storage nesneleri için ayrı kurtarma kapsamı belgelenmeli; veritabanı dump'ı Storage API nesne baytlarını içermez.
7. Sonuç FAIL ise release kapısı kapanır; Production üzerinde hiçbir düzeltme otomatik çalıştırılmaz.

Dokümantasyon: https://supabase.com/docs/guides/platform/backups

## 5. Gerçek checkout ve güvenlik eksikleri
- Cloudflare gerçek widget/site key + hostname + `cadde_preview_checkout` action; gerçek browser'dan Vercel Preview'a POST, yönetilen v3 RPC'ye ulaşan tekil request trace, idempotent tekrar ve negatif testler **doğrulanmadı**.
- Sadece Preview-only anahtarlar kullanılabilir; Production server secrets ve Production test siparişleri kullanılamaz. `CADDE_PREVIEW_E2E_ENABLED` yalnız denetimli test penceresinde açılıp kapatılabilir, Vercel deployment protection kaldırılmaz.
- Production Admin ürün RLS ve Auth AAL2, password protection veya belgeli telafi; `rls_auto_enable` grant incelemesi; eski anonim sipariş yazma yolunun atomik kapanışı gerekli.
- Audit olay amaç, erişim, saklama ve silme koşulları henüz onaylı değil.
- Geri dönüş yolu eski anonim `orders`/ `order_items` INSERT politikalarını otomatik açmamalı.
- Production açılışı için ayrı açık değişiklik onayı ve ikinci kişi kontrolü şart.

## 6. Nihai imza matrisi
| Onay | Sorumlu | Kanıt | Durum |
|---|---|---|---|
| Gerçek Production MFA/AAL2 | Yönetici + güvenlik denetçisi | TOTP faktör durumu + oturum/AAL2 endpoint izi | **BLOCKED** |
| Dört eski sipariş | Satış/operasyon + ikinci kontrol | 4 evrak eşlemesi + rezervasyon/ödeme | **BLOCKED** |
| Fiziki satılabilir stok | Depo + operasyon | İmzalı sayım, tahsis ve kondisyon | **BLOCKED** |
| Production backup/restore | Veritabanı sahibi + ikinci kontrol | Gerçek yedek + izole restore + hash/RPO/RTO | **BLOCKED** |
| Gerçek Preview checkout v3 | Teknik sorumlu + güvenlik | Gerçek Turnstile HTTP trace ve stok/audit | **BLOCKED** |
| Production güvenlik ve rollback | Güvenlik ve release sahibi | RLS/GRANT/backup/security/onay kayıtları | **BLOCKED** |
| Ayrı production değişiklik izni | Şirket yetkilisi | Kapsamlı açık üretim geçiş onayı | **WAITING** |

**Sonuç:** Production için GO veya 'güvenli açılış tamamlandı' beyanı oluşturulamaz. `main`, Production Supabase, canlı `caddedepo.com`, mevcut siparişler/stoklar bu belge nedeniyle değiştirilmez.

## İlk yapılacaklar (ilk 7 gün — plan, zamanlanmış görev değildir)
- **Gün 1–2:** Üretim yöneticisiyle güvenli MFA bootstrap/gerçek TOTP doğrulaması; Production değişikliği öncesi ayrı izin.
- **Gün 1–3:** Depo/satış belge asılları, onay imzaları ve SKU #29 birim bazında mutabakat.
- **Gün 3–7:** Maliyet onaylı izole PG17 Production dump/restore + son Preview gerçek HTTP testleri; QA/red-team ve ikinci bağımsız inceleme.

**KARAR: NO-GO (25.10.2026).**
