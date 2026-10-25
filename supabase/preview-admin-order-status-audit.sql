-- CADDE DEPO — PREVIEW ONLY: append-only admin order status audit.
-- Apply only to Supabase cadde-depo-preview (emnacsavgsjkrocpngcj).
-- Production must be reviewed and migrated separately.
BEGIN;

CREATE TABLE IF NOT EXISTS cadde_internal.admin_order_status_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  order_id uuid NOT NULL,
  actor_uid uuid NOT NULL,
  requested_status text NOT NULL,
  previous_status text,
  resulting_status text,
  outcome text NOT NULL CHECK (outcome IN ('accepted','unchanged','rejected')),
  error_code text,
  error_sqlstate text,
  reserved_before boolean,
  reserved_after boolean
);

CREATE INDEX IF NOT EXISTS admin_order_status_audit_order_time_idx
  ON cadde_internal.admin_order_status_audit (order_id,occurred_at DESC);

ALTER TABLE cadde_internal.admin_order_status_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cadde_internal.admin_order_status_audit FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE cadde_internal.admin_order_status_audit_audit_id_seq FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_order_status_audited(
  p_order_id uuid,
  p_new_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  previous_order public.orders%ROWTYPE;
  current_order public.orders%ROWTYPE;
  result jsonb;
  error_message text;
  error_state text;
  safe_error text;
  actor uuid;
BEGIN
  actor := (SELECT auth.uid());
  IF actor IS NULL
     OR coalesce((SELECT auth.jwt())->'app_metadata'->>'role','')<>'admin' THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;

  IF p_order_id IS NULL OR p_new_status IS NULL OR p_new_status NOT IN
     ('whatsapp_bekliyor','onaylandi','kargolandi','teslim','iptal') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='22023';
  END IF;

  -- The order lock serializes status changes and stabilizes the audit's before state.
  SELECT * INTO previous_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO cadde_internal.admin_order_status_audit
      (order_id,actor_uid,requested_status,outcome,error_code,error_sqlstate)
    VALUES (p_order_id,actor,p_new_status,'rejected','ORDER_NOT_FOUND','P0002');
    RETURN jsonb_build_object('ok',false,'id',p_order_id,'error_code','ORDER_NOT_FOUND');
  END IF;

  -- Exception block is an internal savepoint: undo an attempted status change,
  -- but persist its rejection in the enclosing transaction.
  BEGIN
    result:=public.admin_set_order_status(p_order_id,p_new_status);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT,error_state=RETURNED_SQLSTATE;
    safe_error:=CASE
      WHEN error_message LIKE 'INSUFFICIENT_ACTIVE_STOCK%' THEN 'INSUFFICIENT_ACTIVE_STOCK'
      WHEN error_message LIKE 'PRICE_RECONFIRMATION_REQUIRED%' THEN 'PRICE_RECONFIRMATION_REQUIRED'
      WHEN error_message LIKE 'INVALID_TRANSITION%' THEN 'INVALID_TRANSITION'
      WHEN error_message LIKE 'INVALID_ORDER_ITEMS%' THEN 'INVALID_ORDER_ITEMS'
      WHEN error_message LIKE 'ORDER_TOTAL_MISMATCH%' THEN 'ORDER_TOTAL_MISMATCH'
      WHEN error_message LIKE 'ALREADY_RESERVED%' THEN 'ALREADY_RESERVED'
      WHEN error_message LIKE 'LEGACY_ORDER_RECONCILIATION_REQUIRED%' THEN 'LEGACY_ORDER_RECONCILIATION_REQUIRED'
      WHEN error_message LIKE 'RESTOCK_EXCEEDS_CAPACITY%' THEN 'RESTOCK_EXCEEDS_CAPACITY'
      WHEN error_message LIKE 'PRODUCT_NOT_FOUND%' THEN 'PRODUCT_NOT_FOUND'
      WHEN error_message LIKE 'CONCURRENT_STOCK_UPDATE%' THEN 'CONCURRENT_STOCK_UPDATE'
      ELSE 'STATUS_CHANGE_FAILED'
    END;
    INSERT INTO cadde_internal.admin_order_status_audit
      (order_id,actor_uid,requested_status,previous_status,resulting_status,
       outcome,error_code,error_sqlstate,reserved_before,reserved_after)
    VALUES (p_order_id,actor,p_new_status,previous_order.durum,previous_order.durum,
      'rejected',safe_error,error_state,previous_order.stok_rezerve,previous_order.stok_rezerve);
    RETURN jsonb_build_object('ok',false,'id',p_order_id,'status',previous_order.durum,
      'reserved',previous_order.stok_rezerve,'error_code',safe_error);
  END;

  SELECT * INTO current_order FROM public.orders WHERE id=p_order_id;
  INSERT INTO cadde_internal.admin_order_status_audit
    (order_id,actor_uid,requested_status,previous_status,resulting_status,
     outcome,reserved_before,reserved_after)
  VALUES (p_order_id,actor,p_new_status,previous_order.durum,current_order.durum,
    CASE WHEN result->>'unchanged'='true' THEN 'unchanged' ELSE 'accepted' END,
    previous_order.stok_rezerve,current_order.stok_rezerve);
  RETURN result||jsonb_build_object('ok',true);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_set_order_status_audited(uuid,text)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_order_status_audited(uuid,text)
  TO authenticated;

-- IMPORTANT: Old public.admin_set_order_status is revoked from authenticated
-- only after the updated preview admin.html has deployed and passed tests.
COMMIT;
