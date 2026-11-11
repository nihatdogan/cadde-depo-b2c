-- =====================================================================
-- CADDE DEPO — public.siparis_olustur
-- Canlı fonksiyonun kaynağı. Fiyat, toplam ve durum istemciden gelmez.
-- orders/order_items için açık INSERT politikası yeniden oluşturulmaz.
-- Bu dosya test veya önizlemeden çalıştırılmaz; canlıya sipariş yazmaz.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.siparis_olustur(items jsonb, musteri jsonb DEFAULT NULL)
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

  INSERT INTO public.orders (toplam, durum, kanal)
  VALUES (v_toplam, 'whatsapp_bekliyor', 'whatsapp')
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, product_id, ad, fiyat, adet)
  SELECT v_order_id, (k->>'product_id')::bigint, k->>'ad', (k->>'fiyat')::numeric, (k->>'adet')::int
  FROM jsonb_array_elements(v_kalemler) k;

  RETURN jsonb_build_object('order_id', v_order_id, 'toplam', v_toplam, 'urun_toplam', v_urun_toplam,
    'kargo_tutari', v_kargo_bilinen, 'kargo_durumu', v_kargo_durumu, 'kalemler', v_kalemler);
END;
$$;

REVOKE ALL ON FUNCTION public.siparis_olustur(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.siparis_olustur(jsonb, jsonb) TO anon, authenticated;
COMMENT ON FUNCTION public.siparis_olustur(jsonb, jsonb) IS 'Storefront checkout. Prices/totals/status come from DB, not the client. musteri is ignored and not stored.';
