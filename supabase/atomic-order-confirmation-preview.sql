-- CADDE DEPO: PREVIEW ONLY. Apply ONLY to Supabase project cadde-depo-preview.
-- Deploy the matching admin.html and /api/admin/order-status endpoint together.
-- This migration intentionally does NOT touch public.create_checkout_request.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_change_order_status(
  p_order_id uuid,
  p_next_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_status text;
  v_line record;
  v_affected integer;
BEGIN
  IF p_order_id IS NULL OR p_next_status IS NULL
     OR p_next_status NOT IN ('whatsapp_bekliyor', 'onaylandi', 'kargolandi', 'teslim', 'iptal') THEN
    RAISE EXCEPTION 'gecersiz_durum' USING ERRCODE = '22023';
  END IF;

  -- Serializes changes to the SAME order, including repeated confirmation.
  SELECT durum INTO v_old_status
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'siparis_bulunamadi' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent retry: NEVER decrement or restore stock twice.
  IF v_old_status = p_next_status THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'status', v_old_status,
      'stock_reserved', v_old_status IN ('onaylandi','kargolandi','teslim')
    );
  END IF;

  IF v_old_status = 'whatsapp_bekliyor' AND p_next_status = 'onaylandi' THEN
    IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id) THEN
      RAISE EXCEPTION 'siparis_kalemi_yok' USING ERRCODE = '22023';
    END IF;

    -- Lock each product through UPDATE, in deterministic order.
    -- Conditional UPDATE is atomic and rechecks quantity after a competing
    -- transaction commits. Any failure rolls back ALL changes for this order.
    FOR v_line IN
      SELECT product_id, sum(adet)::bigint AS adet
      FROM public.order_items
      WHERE order_id = p_order_id
      GROUP BY product_id
      ORDER BY product_id
    LOOP
      IF v_line.product_id IS NULL OR v_line.adet IS NULL OR v_line.adet <= 0 THEN
        RAISE EXCEPTION 'gecersiz_siparis_kalemi' USING ERRCODE = '22023';
      END IF;
      UPDATE public.products
         SET stok = stok - v_line.adet
       WHERE id = v_line.product_id
         AND aktif IS TRUE
         AND stok >= v_line.adet;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      IF v_affected <> 1 THEN
        RAISE EXCEPTION 'stok_yetersiz_veya_pasif' USING ERRCODE = '23514';
      END IF;
    END LOOP;

  ELSIF v_old_status = 'whatsapp_bekliyor' AND p_next_status = 'iptal' THEN
    NULL; -- never reserved, no stock movement

  ELSIF v_old_status = 'onaylandi' AND p_next_status = 'iptal' THEN
    -- Cancellation BEFORE shipment: release exactly once.
    -- Never exceed max_stok; require manual review if warehouse quantity changed.
    FOR v_line IN
      SELECT product_id, sum(adet)::bigint AS adet
      FROM public.order_items
      WHERE order_id = p_order_id
      GROUP BY product_id
      ORDER BY product_id
    LOOP
      IF v_line.product_id IS NULL OR v_line.adet IS NULL OR v_line.adet <= 0 THEN
        RAISE EXCEPTION 'gecersiz_siparis_kalemi' USING ERRCODE = '22023';
      END IF;
      UPDATE public.products
         SET stok = stok + v_line.adet
       WHERE id = v_line.product_id
         AND stok + v_line.adet <= max_stok;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      IF v_affected <> 1 THEN
        RAISE EXCEPTION 'stok_iadesi_kontrol_gerekli' USING ERRCODE = '23514';
      END IF;
    END LOOP;

  ELSIF (v_old_status = 'onaylandi' AND p_next_status = 'kargolandi')
     OR (v_old_status = 'kargolandi' AND p_next_status = 'teslim') THEN
    NULL; -- stock already reserved on confirmation

  ELSE
    -- Shipment cancellation / delivered return require a separate return flow.
    RAISE EXCEPTION 'gecersiz_durum_gecisi' USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders SET durum = p_next_status WHERE id = p_order_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'siparis_guncellenemedi' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'status', p_next_status,
    'stock_reserved', p_next_status IN ('onaylandi','kargolandi','teslim')
  );
END;
$$;

-- PUBLIC includes anon + authenticated. Only a server-held service_role may
-- call the RPC. The frontend authenticates to /api/admin/order-status instead.
REVOKE ALL ON FUNCTION public.admin_change_order_status(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text) TO service_role;

-- Prevent bypass of reservation via direct browser .update({durum}).
-- This is a COLUMN-level permission in the current preview database.
REVOKE UPDATE (durum) ON public.orders FROM authenticated;

COMMIT;

-- Post-deployment security checks:
-- SELECT has_column_privilege('authenticated','public.orders','durum','UPDATE'); -- false
-- SELECT has_function_privilege('authenticated','public.admin_change_order_status(uuid,text)','EXECUTE'); -- false
-- SELECT has_function_privilege('service_role','public.admin_change_order_status(uuid,text)','EXECUTE'); -- true
