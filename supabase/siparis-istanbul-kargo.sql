-- =====================================================================
-- CADDE DEPO — İstanbul içi ücretsiz teslimat, İstanbul dışı ürün kargosu
-- UYGULANMADI. Bu dosya depoya girer; canlı veritabanında ÇALIŞTIRILMADI.
--
-- Yeni sütun yok. products.kargo_ucreti İstanbul dışı kargo bedelidir (TL, KDV dahil).
-- NULL ve 0: bedel henüz girilmedi, ücretsiz değildir.
-- Pozitif tutar: İstanbul dışı bedel, adet ile çarpılır.
-- musteri.teslimat_ili = İstanbul ise kargo tutarı 0 yazılır ve ürün bedeli eklenmez.
-- İl yoksa veya İstanbul dışıysa, bedeli girilmemiş kalem varsa toplam yalnız ürünlerdir;
-- kargo_tutari NULL kalır, kargo_durumu sipariste_bildirilir olur.
-- Kabul edilen ön bilgilendirme sürümleri: 2026-11-11b, 2026-11-12, 2026-11-14.
-- Yayındaki fonksiyon yalnız 2026-11-11b ve 2026-11-12 kabul eder.
-- Bu dosya uygulanmadan 2026-11-14 istemcisi canlıya çıkarsa sipariş reddedilir.
-- Güvenli sıra: önce bu dosya, sonra yeni istemci.
-- siparis_olustur imzası değişmez: (jsonb, jsonb, jsonb).
-- =====================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS kargo_tutari numeric;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS onbilgi_onay_surum text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS onbilgi_onay_zamani timestamptz;
COMMENT ON COLUMN public.orders.onbilgi_onay_zamani IS
  'Ön bilgilendirme onayının sunucuda kaydedildiği an (now()). İstemci zamanı yazılmaz.';

CREATE OR REPLACE FUNCTION public.siparis_olustur(items jsonb, musteri jsonb DEFAULT NULL, p_onbilgi jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order_id uuid;
  v_urun_toplam numeric(12,2) := 0;
  v_kargo_bilinen numeric(12,2) := 0;
  v_kargo_yaz numeric(12,2);
  v_any_unknown boolean := false;
  v_toplam numeric(12,2);
  v_kargo_durumu text;
  v_il text;
  v_istanbul boolean := false;
  v_kalemler jsonb := '[]'::jsonb;
  v_len int;
  v_merged jsonb;
  r record;
  v_istek_raw text;
  v_istek uuid;
  v_yanit jsonb;
  v_ad text;
  v_tel_raw text;
  v_tel text;
  v_aydinlatma text;
  v_onbilgi jsonb;
  v_onbilgi_surum text;
  v_onbilgi_zaman timestamptz;
  v_zorunlu boolean;
  c_limit_10dk CONSTANT int := 20;
  c_limit_24s  CONSTANT int := 200;
BEGIN
  IF items IS NULL OR jsonb_typeof(items) <> 'array' THEN
    RAISE EXCEPTION 'Geçersiz sepet' USING ERRCODE = '22023';
  END IF;
  v_len := jsonb_array_length(items);
  IF v_len < 1 OR v_len > 20 THEN
    RAISE EXCEPTION 'Sepet 1 ile 20 kalem arasında olmalıdır' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'adet', x.adet)), '[]'::jsonb)
    INTO v_merged
  FROM (
    SELECT (e->>'product_id')::bigint AS product_id,
      SUM(CASE WHEN e->>'adet' IS NULL OR e->>'adet' = '' THEN 1 ELSE (e->>'adet')::int END)::int AS adet
    FROM jsonb_array_elements(items) e
    GROUP BY 1
  ) x;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_merged) e
    WHERE e->>'product_id' IS NULL OR (e->>'adet')::int < 1 OR (e->>'adet')::int > 20) THEN
    RAISE EXCEPTION 'Geçersiz ürün veya adet (1–20)' USING ERRCODE = '22023';
  END IF;

  -- Tekrar koruması: aynı istek_id için tek sipariş.
  IF musteri IS NOT NULL AND jsonb_typeof(musteri) = 'object' THEN
    v_istek_raw := musteri->>'istek_id';
  END IF;
  IF v_istek_raw IS NOT NULL THEN
    IF v_istek_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Geçersiz istek kimliği' USING ERRCODE = '22023';
    END IF;
    v_istek := v_istek_raw::uuid;
    -- Aynı anahtarlı eşzamanlı istekler sıraya girer; ikincisi ilkinin kaydını görür.
    PERFORM pg_advisory_xact_lock(hashtextextended('siparis_istek:' || v_istek::text, 0));
    SELECT o.istek_yanit INTO v_yanit FROM public.orders o WHERE o.istek_id = v_istek;
    IF FOUND AND v_yanit IS NOT NULL THEN
      RETURN v_yanit || jsonb_build_object('tekrar', true);
    END IF;
  END IF;

  -- Müşteri bağı (Karar B). Tekrar isteğinde buraya gelinmez; ilk kayıt geçerlidir.
  IF musteri IS NOT NULL AND jsonb_typeof(musteri) = 'object' THEN
    v_ad := nullif(btrim(regexp_replace(coalesce(musteri->>'ad', ''), '[[:cntrl:]]+', ' ', 'g')), '');
    v_tel_raw := nullif(btrim(coalesce(musteri->>'telefon', '')), '');
    v_aydinlatma := left(nullif(btrim(coalesce(musteri->>'aydinlatma', '')), ''), 20);
  END IF;
  v_onbilgi := CASE
    WHEN p_onbilgi IS NOT NULL AND jsonb_typeof(p_onbilgi) = 'object' THEN p_onbilgi
    WHEN musteri IS NOT NULL AND jsonb_typeof(musteri) = 'object' THEN musteri
    ELSE NULL END;
  IF v_onbilgi IS NOT NULL THEN
    v_onbilgi_surum := left(nullif(btrim(coalesce(v_onbilgi->>'onbilgi_surum', '')), ''), 40);
  END IF;
  -- Kabul listesi: yayındaki istemci (2026-11-11b) ve yeni metin (2026-11-12). İkisi de geçerli.
  IF v_onbilgi_surum IS NULL OR v_onbilgi_surum NOT IN ('2026-11-11b', '2026-11-12', '2026-11-14') THEN
    RAISE EXCEPTION 'Ön bilgilendirme onayı gerekli' USING ERRCODE = '22023';
  END IF;
  v_onbilgi_zaman := now();
  SELECT coalesce((SELECT a.deger = 'true'::jsonb FROM public.siparis_ayar a WHERE a.anahtar = 'musteri_zorunlu'), false)
    INTO v_zorunlu;
  IF v_zorunlu AND (v_ad IS NULL OR v_tel_raw IS NULL) THEN
    RAISE EXCEPTION 'Ad soyad ve telefon gerekli' USING ERRCODE = '22023';
  END IF;
  IF v_ad IS NOT NULL OR v_tel_raw IS NOT NULL THEN
    IF v_ad IS NULL OR char_length(v_ad) < 2 OR char_length(v_ad) > 80 THEN
      RAISE EXCEPTION 'Geçersiz ad soyad' USING ERRCODE = '22023';
    END IF;
    v_tel := regexp_replace(regexp_replace(coalesce(v_tel_raw, ''), '[^0-9]', '', 'g'), '^00', '');
    v_tel := CASE
      WHEN v_tel ~ '^905[0-9]{9}$' THEN v_tel
      WHEN v_tel ~ '^05[0-9]{9}$'  THEN '9' || v_tel
      WHEN v_tel ~ '^5[0-9]{9}$'   THEN '90' || v_tel
      ELSE NULL END;
    IF v_tel IS NULL THEN
      RAISE EXCEPTION 'Geçersiz telefon' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Devre kesici: kişi bazlı değil, toplam yeni kayıt üst sınırı.
  IF (SELECT count(*) FROM public.orders o WHERE o.created_at > now() - interval '10 minutes') >= c_limit_10dk
     OR (SELECT count(*) FROM public.orders o WHERE o.created_at > now() - interval '24 hours') >= c_limit_24s THEN
    RAISE EXCEPTION 'Sipariş kaydı geçici olarak sınırlandı' USING ERRCODE = '54000';
  END IF;

  PERFORM p.id FROM public.products p
  WHERE p.id IN (SELECT (e->>'product_id')::bigint FROM jsonb_array_elements(v_merged) e)
  FOR SHARE;

  FOR r IN
    SELECT (e->>'product_id')::bigint AS product_id, (e->>'adet')::int AS adet,
      p.ad, p.outlet_fiyat, p.kargo_ucreti, p.aktif, p.stok
    FROM jsonb_array_elements(v_merged) e
    LEFT JOIN public.products p ON p.id = (e->>'product_id')::bigint
  LOOP
    IF r.ad IS NULL OR r.aktif IS NOT TRUE THEN
      RAISE EXCEPTION 'Ürün satışta değil' USING ERRCODE = '22023';
    END IF;
    IF r.adet > r.stok THEN
      RAISE EXCEPTION 'Yetersiz stok' USING ERRCODE = '22023';
    END IF;
    v_urun_toplam := v_urun_toplam + round(r.outlet_fiyat * r.adet, 2);
    -- Pozitif kargo_ucreti: İstanbul dışı bedel, TL, KDV dahil, adet ile çarpılır.
    -- NULL ve 0: bedel henüz girilmedi. 0 ücretsiz İstanbul dışı kargo değildir.
    IF r.kargo_ucreti IS NULL OR r.kargo_ucreti <= 0 THEN
      v_any_unknown := true;
    ELSE
      v_kargo_bilinen := v_kargo_bilinen + round(r.kargo_ucreti * r.adet, 2);
    END IF;
    v_kalemler := v_kalemler || jsonb_build_array(jsonb_build_object(
      'product_id', r.product_id, 'ad', r.ad, 'fiyat', r.outlet_fiyat,
      'adet', r.adet, 'kargo_ucreti', r.kargo_ucreti));
  END LOOP;

  v_il := btrim(coalesce(musteri->>'teslimat_ili', ''));
  v_istanbul := v_il IN ('İstanbul', 'Istanbul', 'istanbul', 'İSTANBUL');
  -- İl istemciden gelir; tutar istemciden gelmez. İstanbul içi her zaman ücretsizdir.
  IF v_istanbul THEN
    v_kargo_durumu := 'istanbul_ici';
    v_kargo_bilinen := 0;
    v_kargo_yaz := 0;
    v_toplam := v_urun_toplam;
  ELSIF v_any_unknown THEN
    v_kargo_durumu := 'sipariste_bildirilir';
    v_kargo_bilinen := 0;
    v_kargo_yaz := NULL;
    v_toplam := v_urun_toplam;
  ELSE
    v_kargo_durumu := 'dahil';
    v_kargo_yaz := v_kargo_bilinen;
    v_toplam := v_urun_toplam + v_kargo_bilinen;
  END IF;

  INSERT INTO public.orders (toplam, durum, kanal, istek_id, onbilgi_onay_surum, onbilgi_onay_zamani, kargo_tutari)
  VALUES (v_toplam, 'whatsapp_bekliyor', 'whatsapp', v_istek, v_onbilgi_surum, v_onbilgi_zaman, v_kargo_yaz)
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, product_id, ad, fiyat, adet)
  SELECT v_order_id, (k->>'product_id')::bigint, k->>'ad', (k->>'fiyat')::numeric, (k->>'adet')::int
  FROM jsonb_array_elements(v_kalemler) k;

  IF v_tel IS NOT NULL THEN
    INSERT INTO public.siparis_musteri (order_id, ad, telefon, aydinlatma_surum)
    VALUES (v_order_id, v_ad, v_tel, v_aydinlatma);
  END IF;

  v_yanit := jsonb_build_object('order_id', v_order_id, 'toplam', v_toplam, 'urun_toplam', v_urun_toplam,
    'kargo_tutari', v_kargo_yaz, 'kargo_durumu', v_kargo_durumu, 'teslimat_ili', CASE WHEN v_istanbul THEN 'İstanbul' ELSE NULLIF(v_il, '') END, 'kalemler', v_kalemler);
  IF v_istek IS NOT NULL THEN
    UPDATE public.orders SET istek_yanit = v_yanit WHERE id = v_order_id;
  END IF;
  RETURN v_yanit;
END;
$$;

REVOKE ALL ON FUNCTION public.siparis_olustur(jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.siparis_olustur(jsonb, jsonb, jsonb) TO postgres, anon, authenticated, service_role;
COMMENT ON FUNCTION public.siparis_olustur(jsonb, jsonb, jsonb) IS 'Storefront checkout. Prices and shipping come from products, not the client. Istanbul delivery is free. products.kargo_ucreti is the outside-Istanbul fee; NULL and 0 mean not entered. musteri.teslimat_ili selects the rule. Accepted onbilgi versions: 2026-11-11b, 2026-11-12, 2026-11-14.';
NOTIFY pgrst, 'reload schema';

SET check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.siparis_durum_degistir(p_siparis_id uuid, p_yeni_durum text, p_kargo_tutari numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor        uuid;
  v_order        public.orders%ROWTYPE;
  v_eski_stoklu  boolean;
  v_yeni_stoklu  boolean;
  v_yon          integer := 0;
  v_rezerve_yeni boolean;
  v_hareket      jsonb := '[]'::jsonb;
  v_kalem        record;
  v_urun         record;
  v_kargo_gerek  boolean := false;
  v_kargo        numeric;
  v_toplam       numeric;
BEGIN
  v_actor := (SELECT auth.uid());
  IF v_actor IS NULL
     OR coalesce((SELECT auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir.' USING ERRCODE = '42501';
  END IF;

  IF p_siparis_id IS NULL OR p_yeni_durum IS NULL OR p_yeni_durum NOT IN
     ('whatsapp_bekliyor','onaylandi','kargolandi','teslim','iptal') THEN
    RAISE EXCEPTION 'Geçersiz sipariş veya durum: %', coalesce(p_yeni_durum,'(boş)')
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_siparis_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sipariş bulunamadı.' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.durum = p_yeni_durum THEN
    INSERT INTO public.siparis_durum_log
      (siparis_id, yapan, islem, eski_durum, yeni_durum, stok_rezerve_once, stok_rezerve_sonra)
    VALUES (v_order.id, v_actor, 'degismedi', v_order.durum, p_yeni_durum,
            v_order.stok_rezerve, v_order.stok_rezerve);
    RETURN jsonb_build_object('id', v_order.id, 'durum', v_order.durum, 'eski_durum', v_order.durum,
      'stok_rezerve', v_order.stok_rezerve, 'kargo_tutari', v_order.kargo_tutari,
      'degismedi', true, 'stok_hareketleri', '[]'::jsonb);
  END IF;

  v_eski_stoklu := v_order.durum IN ('onaylandi','kargolandi','teslim');
  v_yeni_stoklu := p_yeni_durum IN ('onaylandi','kargolandi','teslim');

  IF v_order.stok_rezerve IS NULL THEN
    IF v_eski_stoklu IS DISTINCT FROM v_yeni_stoklu THEN
      RAISE EXCEPTION 'Bu sipariş stok takibi başlamadan önce oluşturulmuş; stoğu etkileyen durum değişikliği yapılamaz. Önce siparişin stoğunun düşülüp düşülmediğini işaretleyin (siparis_stok_esle).'
        USING ERRCODE = '23514';
    END IF;
    v_yon := 0;
  ELSIF v_yeni_stoklu AND v_order.stok_rezerve = false THEN
    v_yon := -1;
  ELSIF NOT v_yeni_stoklu AND v_order.stok_rezerve = true THEN
    v_yon := 1;
  END IF;

  IF v_yon <> 0 THEN
    IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = v_order.id) THEN
      RAISE EXCEPTION 'Siparişin ürün satırı yok; stok işlemi yapılamaz.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = v_order.id AND product_id IS NULL) THEN
      RAISE EXCEPTION 'Sipariş satırlarından birinin ürün bağlantısı yok; stok işlemi yapılamaz.'
        USING ERRCODE = '23514';
    END IF;

    FOR v_kalem IN
      SELECT product_id, sum(adet)::integer AS adet
      FROM public.order_items WHERE order_id = v_order.id
      GROUP BY product_id ORDER BY product_id
    LOOP
      SELECT id, ad, stok, max_stok INTO v_urun
      FROM public.products WHERE id = v_kalem.product_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ürün bulunamadı (id %).', v_kalem.product_id USING ERRCODE = 'P0002';
      END IF;
      IF v_yon = -1 THEN
        IF v_urun.stok < v_kalem.adet THEN
          RAISE EXCEPTION 'Yetersiz stok: % (mevcut %, gereken %). Sipariş onaylanmadı, stok değişmedi.',
            v_urun.ad, v_urun.stok, v_kalem.adet USING ERRCODE = 'P0001';
        END IF;
        UPDATE public.products SET stok = stok - v_kalem.adet WHERE id = v_urun.id;
      ELSE
        IF v_urun.stok + v_kalem.adet > v_urun.max_stok THEN
          RAISE EXCEPTION 'Stok iadesi max_stok sınırını aşıyor: % (mevcut %, iade %, max %). Önce ürünün stok/max_stok değerini düzeltin.',
            v_urun.ad, v_urun.stok, v_kalem.adet, v_urun.max_stok USING ERRCODE = '23514';
        END IF;
        UPDATE public.products SET stok = stok + v_kalem.adet WHERE id = v_urun.id;
      END IF;
      v_hareket := v_hareket || jsonb_build_array(jsonb_build_object(
        'product_id', v_urun.id, 'degisim', v_yon * v_kalem.adet,
        'stok_once', v_urun.stok, 'stok_sonra', v_urun.stok + v_yon * v_kalem.adet));
    END LOOP;
  END IF;

  v_kargo := v_order.kargo_tutari;
  v_toplam := v_order.toplam;
  IF v_yeni_stoklu AND v_order.kargo_tutari IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.products pr ON pr.id = oi.product_id
      WHERE oi.order_id = v_order.id AND (pr.kargo_ucreti IS NULL OR pr.kargo_ucreti <= 0)
    ) INTO v_kargo_gerek;
    IF v_kargo_gerek THEN
      IF p_kargo_tutari IS NULL OR p_kargo_tutari < 0 THEN
        RAISE EXCEPTION 'Kargo tutarı gerekli. Bilinmeyen kargolu siparişte tam kargo tutarını girin.'
          USING ERRCODE = '22023';
      END IF;
      v_kargo := round(p_kargo_tutari, 2);
      v_toplam := v_order.toplam + v_kargo;
    END IF;
  END IF;

  v_rezerve_yeni := CASE WHEN v_yon = -1 THEN true WHEN v_yon = 1 THEN false ELSE v_order.stok_rezerve END;

  UPDATE public.orders
  SET durum = p_yeni_durum,
      stok_rezerve = v_rezerve_yeni,
      kargo_tutari = v_kargo,
      toplam = v_toplam
  WHERE id = v_order.id;

  INSERT INTO public.siparis_durum_log
    (siparis_id, yapan, islem, eski_durum, yeni_durum, stok_rezerve_once, stok_rezerve_sonra, stok_hareketleri)
  VALUES (v_order.id, v_actor, 'durum', v_order.durum, p_yeni_durum,
          v_order.stok_rezerve, v_rezerve_yeni, v_hareket);

  RETURN jsonb_build_object('id', v_order.id, 'durum', p_yeni_durum, 'eski_durum', v_order.durum,
    'stok_rezerve', v_rezerve_yeni, 'kargo_tutari', v_kargo, 'toplam', v_toplam,
    'degismedi', false, 'stok_hareketleri', v_hareket);
END
$function$;

REVOKE ALL ON FUNCTION public.siparis_durum_degistir(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.siparis_durum_degistir(uuid, text, numeric) TO authenticated;
COMMENT ON FUNCTION public.siparis_durum_degistir(uuid, text, numeric) IS
  'Admin-only. Durum ve stok hareketi. İstanbul dışı bedeli girilmemiş (NULL veya 0) kalem varsa ve siparişte kargo_tutari boşsa onay/kargo/teslim için p_kargo_tutari zorunludur; tutar bir kez toplama eklenir.';

RESET check_function_bodies;
