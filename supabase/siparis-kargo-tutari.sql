-- =====================================================================
-- CADDE DEPO — sipariş kargo tutarı
-- UYGULANDI. Canlıya 2026-11-11 tarihinde uygulandı.
--
-- orders.kargo_tutari: yönetici, kargosu belli olmayan bir siparişi
-- onaylarken/kargolarken/teslim ederken girdiği tam kargo tutarı.
-- NULL = henüz girilmedi. 0 = ücretsiz olarak girildi.
-- Tutar bir kez toplam'a eklenir; sonraki durum değişikliklerinde tekrar eklenmez.
-- Ürün kargo_ucreti zaten doluysa (0 dahil) bu alan istenmez; checkout toplamı geçerlidir.
-- =====================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS kargo_tutari numeric;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_kargo_tutari_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_kargo_tutari_check CHECK (kargo_tutari IS NULL OR kargo_tutari >= 0);
COMMENT ON COLUMN public.orders.kargo_tutari IS
  'Kargosu NULL olan kalemler için yöneticinin girdiği tam kargo tutarı. NULL: girilmedi. 0: ücretsiz.';

DROP FUNCTION IF EXISTS public.siparis_durum_degistir(uuid, text);
DROP FUNCTION IF EXISTS public.siparis_durum_degistir(uuid, text, numeric);

CREATE FUNCTION public.siparis_durum_degistir(p_siparis_id uuid, p_yeni_durum text, p_kargo_tutari numeric DEFAULT NULL)
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
      WHERE oi.order_id = v_order.id AND pr.kargo_ucreti IS NULL
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
  'Admin-only. Durum ve stok hareketi. Kargosu NULL kalem varsa onay/kargo/teslim için p_kargo_tutari zorunludur; tutar bir kez toplama eklenir.';
