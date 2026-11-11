-- =====================================================================
-- CADDE DEPO — public.siparis_olustur (istek koruması ile)
-- Canlı fonksiyonun tek kaynağı. Fiyat, toplam ve durum istemciden gelmez.
-- orders/order_items için açık INSERT politikası yeniden oluşturulmaz.
--
-- Denetim bulgusu #3 düzeltmesi (migration: siparis_olustur_istek_koruma):
--  1. Tekrar koruması: istemci musteri = {"istek_id": "<uuid>"} gönderir.
--     Aynı istek_id ikinci kez gelirse yeni sipariş AÇILMAZ; ilk yanıt
--     "tekrar": true ile aynen döner (çift tıklama, ağ kesintisi, yeniden deneme).
--     musteri NULL ise eski davranış sürer (geriye uyumlu).
--  2. Devre kesici: son 10 dakikada 20, son 24 saatte 200 yeni kayıttan sonra
--     fonksiyon yazmayı reddeder. Kişi bazlı sınır DEĞİLDİR; tabloyu sahte
--     kayıtla doldurmanın üst sınırıdır. Kişi bazlı koruma (Turnstile / ağ geçidi)
--     ayrı iştir.
--  musteri içindeki başka hiçbir alan okunmaz ve saklanmaz.
-- Tek transaction içinde çalıştırılır. Tekrar çalıştırılabilir.
-- =====================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS istek_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS istek_yanit jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS orders_istek_id_key ON public.orders (istek_id) WHERE istek_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON public.orders (created_at DESC);
COMMENT ON COLUMN public.orders.istek_id IS 'İstemcinin ürettiği tekrar-koruma anahtarı. Kişisel veri değildir.';
COMMENT ON COLUMN public.orders.istek_yanit IS 'Bu isteğe verilen ilk yanıt; aynı istek_id tekrar gelirse aynen döner.';

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
  v_istek_raw text;
  v_istek uuid;
  v_yanit jsonb;
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

  INSERT INTO public.orders (toplam, durum, kanal, istek_id)
  VALUES (v_toplam, 'whatsapp_bekliyor', 'whatsapp', v_istek)
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, product_id, ad, fiyat, adet)
  SELECT v_order_id, (k->>'product_id')::bigint, k->>'ad', (k->>'fiyat')::numeric, (k->>'adet')::int
  FROM jsonb_array_elements(v_kalemler) k;

  v_yanit := jsonb_build_object('order_id', v_order_id, 'toplam', v_toplam, 'urun_toplam', v_urun_toplam,
    'kargo_tutari', v_kargo_bilinen, 'kargo_durumu', v_kargo_durumu, 'kalemler', v_kalemler);
  IF v_istek IS NOT NULL THEN
    UPDATE public.orders SET istek_yanit = v_yanit WHERE id = v_order_id;
  END IF;
  RETURN v_yanit;
END;
$$;

REVOKE ALL ON FUNCTION public.siparis_olustur(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.siparis_olustur(jsonb, jsonb) TO anon, authenticated;
COMMENT ON FUNCTION public.siparis_olustur(jsonb, jsonb) IS 'Storefront checkout. Prices/totals/status come from DB, not the client. Only musteri.istek_id (idempotency key) is read; nothing else in musteri is stored.';
