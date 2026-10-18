-- CADDE DEPO / PREVIEW ONLY / AŞAMA A
-- Bilerek stok düşmez, rezervasyon yapmaz. Tek transaction içinde sipariş+kalem kaydeder.
-- EXECUTE hakkı sadece service_role, çağrı sadece sunucudan yapılır.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_checkout_request(
  p_request_id uuid,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_entry record;
  v_product public.products%ROWTYPE;
  v_lines jsonb := '[]'::jsonb;
  v_total numeric(12,2) := 0;
  v_n int := 0;
  v_qty_total int := 0;
BEGIN
  IF p_request_id IS NULL OR p_lines IS NULL
     OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'gecersiz_talep' USING ERRCODE = '22023';
  END IF;

  -- PostgREST transaction and PK protect against half-written/duplicate orders.
  IF EXISTS (SELECT 1 FROM public.orders WHERE id = p_request_id) THEN
    RAISE EXCEPTION 'tekrar_istek' USING ERRCODE = '23505';
  END IF;

  -- Group same SKU (cart may contain duplicates); lock deterministic ID order.
  FOR v_entry IN
    SELECT r.product_id, sum(r.adet)::int AS adet
    FROM jsonb_to_recordset(p_lines) AS r(product_id bigint, adet int)
    GROUP BY r.product_id
    ORDER BY r.product_id
  LOOP
    IF v_entry.product_id IS NULL OR v_entry.adet IS NULL
       OR v_entry.adet < 1 OR v_entry.adet > 20 THEN
      RAISE EXCEPTION 'gecersiz_urun_adet' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_product FROM public.products
      WHERE id = v_entry.product_id AND aktif IS TRUE FOR SHARE;
    IF NOT FOUND OR v_product.stok < v_entry.adet THEN
      RAISE EXCEPTION 'stok_yetersiz_veya_pasif' USING ERRCODE = '22023';
    END IF;
    v_n := v_n + 1;
    v_qty_total := v_qty_total + v_entry.adet;
    IF v_qty_total > 20 THEN
      RAISE EXCEPTION 'sepet_limit_asildi' USING ERRCODE = '22023';
    END IF;
    v_total := v_total + v_product.outlet_fiyat * v_entry.adet;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'ad', v_product.ad,
      'fiyat', v_product.outlet_fiyat,
      'adet', v_entry.adet
    ));
  END LOOP;
  IF v_n = 0 OR v_n > 20 THEN
    RAISE EXCEPTION 'sepet_bos' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.orders (id, toplam, durum, kanal)
    VALUES (p_request_id, v_total, 'whatsapp_bekliyor', 'whatsapp');
  INSERT INTO public.order_items (order_id, product_id, ad, fiyat, adet)
    SELECT p_request_id, i.product_id, i.ad, i.fiyat, i.adet
    FROM jsonb_to_recordset(v_lines)
      AS i(product_id bigint, ad text, fiyat numeric, adet int);

  RETURN jsonb_build_object(
    'order_id', p_request_id,
    'product_subtotal', v_total,
    'line_count', v_n,
    'stock_reserved', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_checkout_request(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_request(uuid,jsonb) TO service_role;

COMMIT;
