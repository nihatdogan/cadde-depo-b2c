-- =====================================================================
-- CADDE DEPO — ön bilgilendirme onayı (denetim #26)
-- UYGULANMADI. Canlıya ayrı onaydan sonra SQL Editor'de çalıştırın.
-- Eski siparis_olustur(jsonb, jsonb) çağrısı, yeni imzadaki varsayılan
-- p_onbilgi sayesinde çalışmaya devam eder. Ön yüz bu parametreyi göndermez;
-- onayı musteri jsonb içinde taşır. Migration yokken sipariş açılır, onay
-- kolonları henüz yazılmaz. Migration sonrası aynı çağrı kolonları doldurur.
-- SECURITY DEFINER ve search_path = pg_catalog, public korunur.
-- =====================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS onbilgi_onay_surum text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS onbilgi_onay_zamani timestamptz;
COMMENT ON COLUMN public.orders.onbilgi_onay_surum IS 'Ön bilgilendirme ve mesafeli satış onayı sürümü. Örn. 2026-11-11.';
COMMENT ON COLUMN public.orders.onbilgi_onay_zamani IS 'Alıcının ön bilgilendirme kutusunu işaretlediği an.';

DROP FUNCTION IF EXISTS public.siparis_olustur(jsonb, jsonb);

CREATE FUNCTION public.siparis_olustur(items jsonb, musteri jsonb DEFAULT NULL, p_onbilgi jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order_id uuid;
  v_urun_toplam numeric(12,2) := 0;
  v_kargo_bilinen numeric(12,2) := 0;
  v_any_unknown boolean := false;
  v_toplam numeric(12,2);
  v_kargo_durumu text;
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
    BEGIN
      IF nullif(btrim(coalesce(v_onbilgi->>'onbilgi_zamani', '')), '') IS NOT NULL THEN
        v_onbilgi_zaman := (v_onbilgi->>'onbilgi_zamani')::timestamptz;
      END IF;
    EXCEPTION WHEN others THEN
      v_onbilgi_zaman := NULL;
    END;
  END IF;
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
    IF r.kargo_ucreti IS NULL THEN
      v_any_unknown := true;
    ELSE
      v_kargo_bilinen := v_kargo_bilinen + round(r.kargo_ucreti * r.adet, 2);
    END IF;
    v_kalemler := v_kalemler || jsonb_build_array(jsonb_build_object(
      'product_id', r.product_id, 'ad', r.ad, 'fiyat', r.outlet_fiyat,
      'adet', r.adet, 'kargo_ucreti', r.kargo_ucreti));
  END LOOP;

  IF v_any_unknown THEN
    v_kargo_durumu := 'sipariste_bildirilir';
    v_toplam := v_urun_toplam;
  ELSIF v_kargo_bilinen = 0 THEN
    v_kargo_durumu := 'ucretsiz';
    v_toplam := v_urun_toplam;
  ELSE
    v_kargo_durumu := 'dahil';
    v_toplam := v_urun_toplam + v_kargo_bilinen;
  END IF;

  INSERT INTO public.orders (toplam, durum, kanal, istek_id, onbilgi_onay_surum, onbilgi_onay_zamani)
  VALUES (v_toplam, 'whatsapp_bekliyor', 'whatsapp', v_istek, v_onbilgi_surum, v_onbilgi_zaman)
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, product_id, ad, fiyat, adet)
  SELECT v_order_id, (k->>'product_id')::bigint, k->>'ad', (k->>'fiyat')::numeric, (k->>'adet')::int
  FROM jsonb_array_elements(v_kalemler) k;

  IF v_tel IS NOT NULL THEN
    INSERT INTO public.siparis_musteri (order_id, ad, telefon, aydinlatma_surum)
    VALUES (v_order_id, v_ad, v_tel, v_aydinlatma);
  END IF;

  v_yanit := jsonb_build_object('order_id', v_order_id, 'toplam', v_toplam, 'urun_toplam', v_urun_toplam,
    'kargo_tutari', v_kargo_bilinen, 'kargo_durumu', v_kargo_durumu, 'kalemler', v_kalemler);
  IF v_istek IS NOT NULL THEN
    UPDATE public.orders SET istek_yanit = v_yanit WHERE id = v_order_id;
  END IF;
  RETURN v_yanit;
END;
$$;

REVOKE ALL ON FUNCTION public.siparis_olustur(jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.siparis_olustur(jsonb, jsonb, jsonb) TO anon, authenticated;
COMMENT ON FUNCTION public.siparis_olustur(jsonb, jsonb, jsonb) IS 'Storefront checkout. Prices/totals/status come from DB, not the client. From musteri: istek_id, ad, telefon, aydinlatma, onbilgi_surum, onbilgi_zamani. Optional p_onbilgi carries the same consent fields. ad/telefon go to siparis_musteri (admin-only).';
