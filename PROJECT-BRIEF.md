# CADDE DEPO — Proje Brifi

**Tek cümle:** STOKBANK B2B likidite ağının son tüketiciye açılan B2C "Canlı Boşaltma" mağazası.

---

## Model
- **Tip:** Off-price / live liquidation B2C. Kaynak: fazla, seri sonu, açık kutu, kapanış stoğu.
- **Çerçeve:** Veepee aciliyeti + off-price hazine avı (TJ Maxx) + open-box kondisyon şeffaflığı (Living Spaces).
- **Yapısal aciliyet:** adet gerçekten sınırlı, tekil parti. Aciliyet üretilmiyor, var olan gerçek aktarılıyor.
- **Fiyat çıpası:** perakende fiyat (üstü çizili) + outlet fiyat + %indirim damgası + kondisyon etiketi (Sıfır / Seri Sonu / Açık Kutu).
- **Satış kanalı:** Sepet → WhatsApp checkout + ürün başına tek-tık WhatsApp.
- **Fiyat-stok bağı:** Stok Likidite Protokolü ile uyumlu (stok eridikçe fiyat hareketi).

## Kategori
- Kaynak: `kategori-agaci.json` — 9 ana kategori, alt kategorilerle.
- Ürün her zaman `ANA › Alt` formatında etiketlenir.
- Navigasyon: mega-menü (tüm ağaç) + 2 seviyeli drill-down filtre + kategori şeridi.

## Mevcut varlıklar
- `cadde-depo-magaza.html` — çalışan B2C prototip (statik). Tasarım sistemi: depo/hazard endüstriyel estetik, Anton + Archivo + Spline Sans Mono. Fiyat-etiketi signature, canlı stok erimesi, geri sayım, sepet+WhatsApp, boş-durum lead yakalama.

---

## AÇIK KARARLAR (kilitlenmeden prod kodu yazılmaz)

| # | Karar | Seçenekler | Etki |
|---|-------|-----------|------|
| A | Altyapı | Shopify (hızlı, Mysaloonset çatısı) **vs** Custom React+Supabase (Decision Console'a bağlı, protokolü doğrudan besler) | Tüm prod mimarisi |
| B | Fiyat-stok bağı | Gerçek dinamik düşüş **vs** sadece görsel aciliyet | Likidite hızı + güven |
| C | Arz kapsamı | 9 kategoriyi besle (tedarik genişletme) **vs** vitrin esnek / arz dar + lead toplama | Sourcing operasyonu + STOKBANK kategori hizalaması |
| D | WhatsApp numarası | Canlı Business no. (kodda `905XXXXXXXXX` placeholder) | Tüm sipariş akışı |
| E | Geri sayım kaynağı | Sabit gün sonu **vs** STOKBANK parti bitiş endpoint'i | Drop mekaniği |

## Kapsam çelişkisi
STOKBANK B2B sitesi 8 kategori listeliyor (Mobilya, Ev Tekstili, Züccaciye, Küçük Ev Aletleri, Aksesuar, Yapı/Hırdavat, Kapanış, Seri Sonu). B2C ağacı bunun ötesinde (telefon, bilgisayar, beyaz eşya, motor/spor, kozmetik). Karar C bunu çözer; çözülünce B2B kategori yapısı da B2C ağacına hizalanmalı.

---

## Yol haritası (karar sonrası)
1. Altyapı kur (A) + WhatsApp bağla (D).
2. Kategori ağacını veri kaynağına bağla (`kategori-agaci.json` → DB seed).
3. Ürün/parti şeması: ana, alt, perakende, outlet, stok, max, kondisyon, parti_id, drop_bitis.
4. Stok Likidite Protokolü → fiyat-stok bağı (B) entegrasyonu.
5. STOKBANK → Cadde Depo parti akışı (arz kapsamı C'ye göre).
6. Ödeme (Iyzico) + teslimat (kendi araç + kargo) + KVKK/Mesafeli Satış.
7. Lead modülü (boş kategori → talep toplama) → arz tetikleme.
