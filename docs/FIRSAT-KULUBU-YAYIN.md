# Ücretsiz Fırsat Kulübü — yayın kapıları (v2)

Kulüp; ücretsiz, yalnız e-posta ile bildirim veren bir ön kayıt listesidir. Ücretli üyelik, servis, rezervasyon, indirim ve WhatsApp bildirimi bu sürümde YOKTUR.

## Aşamalar

| Aşama | Ne yayına girer | Koşul |
|---|---|---|
| A — Tanıtım | `/firsat-kulubu` ve `/firsat-kulubu-aydinlatma` sayfaları, kayıt KAPALI | CI yeşil, PR onayı |
| B — Ön kayıt | Form açılır, e-posta ve kategori kaydedilir | Aşağıdaki dört kapı |
| C — Bildirim | Doğrulanmış üyelere e-posta | Bu pakette yok; ayrı iş |

## B aşaması için dört kapı (hepsi kapanmadan `CLUB_REGISTRATION_ENABLED` açılmaz)

1. **Satıcı kimliği:** `satici.js` içinde açık adres ve vergi/MERSİS bilgisi dolu (denetim bulgusu #5).
2. **Hukuk onayı:** `firsat-kulubu-aydinlatma.html` ve formdaki onay cümlesi avukat tarafından onaylandı. Onaylanan sürüm `CLUB_LEGAL_VERSION` değişkenine elle yazılır; koddaki `METIN_SURUM` ile aynı değilse kayıt kapalı kalır.
3. **Veritabanı:** `supabase/firsat-kulubu.sql` önce önizleme projesinde, sonra ayrı onayla üretimde çalıştırıldı.
4. **İleti altyapısı kararı:** İYS kaydı ve e-posta doğrulama (çift onay) yöntemi belirlendi. Bu olmadan toplanan adreslere e-posta GÖNDERİLEMEZ.

## Ortam değişkenleri (Vercel)

| Değişken | Ortam | Değer |
|---|---|---|
| `CLUB_REGISTRATION_ENABLED` | Production / Preview | `true` (yalnız dört kapıdan sonra) |
| `CLUB_LEGAL_VERSION` | Production / Preview | onaylanan metin sürümü, ör. `firsat-kulubu-2026-11-12-v2` |
| `CLUB_PROD_SUPABASE_URL` | Production | üretim proje adresi |
| `CLUB_PROD_SERVICE_ROLE_KEY` | Production (Sensitive) | üretim service role anahtarı |
| `CLUB_PROD_RATE_SECRET` | Production (Sensitive) | en az 32 karakter rastgele |
| `CLUB_PREVIEW_SUPABASE_URL` | Preview | önizleme proje adresi (üretim projesi OLAMAZ; kod reddeder) |
| `CLUB_PREVIEW_SERVICE_ROLE_KEY` | Preview (Sensitive) | önizleme anahtarı |
| `CLUB_PREVIEW_RATE_SECRET` | Preview (Sensitive) | en az 32 karakter rastgele |

## Testler

`scripts/firsat-kulubu-api-sim.mjs`, `scripts/firsat-kulubu-sql-sim.mjs`, `scripts/firsat-kulubu-sayfa-sim.mjs`. CI her PR'da çalıştırır; hiçbiri ağa veya canlıya dokunmaz.

## Açık kararlar

- Saklama süresi ve silme prosedürü.
- Veritabanı ve barındırma sunucularının bulunduğu ülke; yurt dışındaysa aktarım hükümleri (avukat).
- Metin her değiştiğinde `METIN_SURUM` üç yerde birlikte değişir: `api/firsat-kulubu.js`, `firsat-kulubu.html`, `firsat-kulubu-aydinlatma.html`. Sayfa testi uyumsuzluğu yakalar.
