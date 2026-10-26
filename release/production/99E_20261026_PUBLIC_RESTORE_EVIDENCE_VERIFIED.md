# CADDE DEPO — Gerçek Production `public` Şeması Restore Kanıtı

**Tarih:** 26 Ekim 2026 · **Kaynak:** İşletme sahibinin yerel Windows restore tatbikatı ve ayrı Production SELECT teyidi

## Karar

**PASS — APPLICATION PUBLIC SCHEMA RESTORE EXERCISE ONLY.**

Bu kanıt, tam Supabase felaket kurtarmasının GO onayı **DEĞİLDİR**. `auth`, `storage`, kalıcı yedek saklama ve yeniden üretilebilir kurtarma süresi kapsam dışıdır. PR #2 DRAFT ve production checkout **NO-GO** olarak devam eder.

## Kullanıcı tarafından iletilen kanıt (hassas bilgi içermez)

- JSON adı: `CADDE_DEPO_RESTORE_KANIT_20261026_121923.json`
- Çıktı: `PASS_APPLICATION_PUBLIC_SCHEMA_ONLY`
- Yerel zaman: `2026-10-26 12:20:36 +03:00`
- Kaynak Production ref: `svyqmmivhpfiuhxnmhny`
- Kaynak DB major: `17`
- Geri yükleme hedefi: ephemeral `postgres:17` Docker container, `--network none`
- PG dump SHA-256 (programın raporladığı): `ba30bbecc4e7868d06ffa5b266a9e4965f3c03be2505e2c6c3b961a377d8ca0e`
- Arşiv boyutu (programın raporladığı): `21665` bayt
- Geri yüklenen uygulama tablosu: `5`; RLS etkin tablo: `5`
- Foreign key kontrolleri: `true`
- Ürün #29 sistem stoğu: `5`
- Sipariş satır-tutar tutarlılığı: `true`
- `production_write_performed=false`, `archive_retained=false`, `full_managed_auth_storage_restore_proven=false`

JSON dosyası, kişisel verili `.dump` dosyası ya da parola depolamadan, rapor sonuçları özetlenmiştir.

## Bağımsız kaynak kontrolü: Production SQL READ-ONLY

26 Ekim 2026'da Supabase Production proje ref `svyqmmivhpfiuhxnmhny` üzerinde gerçekleştirilen salt-okunur katalog sorgusunun sonucu:

| Kontrol | Production kaynağı | Yerel restore raporu |
|---|---:|---:|
| PostgreSQL major | 17 | 17 |
| `public` tablolar | 5 | 5 |
| RLS etkin tablolar | 5 | 5 |
| Sipariş kalemleri FK kontrol | 2 | true |
| SKU #29 stok | 5 | 5 |
| Sipariş satır tutarlılığı | true | true |

Bu çapraz kontrol restore edilen arşivin tüm satırlarının kriptografik olarak aynı olduğunu bağımsız kanıtlamaz; rapor yerel betiğin ürettiği manifest ve kullanıcı ekranı ile desteklenmiştir.

## Güvenlik ve kapsam sınırları

- `archive_retained=false`: Gerçek kaynak arşivi test sonrasında silinmiştir. Raporlanan SHA-256 arşiv mevcut olmadığı için üçüncü tarafça yeniden hesaplanamaz. Bu nedenle **durable offsite backup / RPO / RTO** kanıtı değildir.
- Supabase yönetilen `auth` ve `storage` (özellikle Storage nesne baytları) tatbikatı **yapılmadı**.
- Gerçek Preview Cloudflare Turnstile → Vercel Gateway → yönetilen RPC v3 full HTTP checkout GO kanıtı ayrıca bekliyor.
- Production MFA TOTP/AAL2 kaydı önceki çalışmalarda doğrulandı; bu, checkout cutover yetkisi değildir.
- PR `main` dalına birleştirilmedi; Production DB şemasına, gerçek sipariş/stok kayıtlarına veya `caddedepo.com` checkout'una bu denetim tarafından yazılmadı.

**Bundan sonraki kritik adım:** Ayrı onaylı, şifreli, erişim sınırları tanımlı **kalıcı** yedekleme ve saklama yöntemi; ardından gerçek izole restore/RPO-RTO denetimi ve `auth`/`storage` kurtarma kapsamının yazılı olarak tanımlanması.

**Sonuç:** Application/public restore exercise gate **PASS**, full disaster recovery + production GO **OPEN**.
