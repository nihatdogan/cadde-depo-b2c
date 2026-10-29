-- CADDE DEPO / 2026-10-28 / REVIEW ONLY / SELECT ONLY
-- Production legacy test-order reconciliation, not a migration or a public dashboard.
-- Operator attested: all four 2026-10-07 orders were TESTS; no collections,
-- refunds or physical dispatch. Physical saleable SKU29=5, database SKU29=5.
-- IMPORTANT: source database has NO durable test_order flag. Never delete
-- or mutate rows, infer payment from "teslim", or count these as actual revenue.
-- Values are order-record amounts, NOT KDV-net revenues or real payments.
-- Execute only against expected Production project: svyqmmivhpfiuhxnmhny.
-- For future reporting use a reviewed, permission-restricted classification
-- table with actor/time/reason and audit, not a permanent client-side hardcode.

-- Query 1: Exact identification, structural consistency and exceptions.
WITH operator_declared_test_ids (order_id) AS (
  VALUES
  ('cb0d2c80-22cd-412f-a2e1-83f4a2b324f1'::uuid),
  ('2c20a703-be0d-4597-b8a0-53be53072042'::uuid),
  ('ad2ce4ea-6f7d-477b-9533-87a3d78e469d'::uuid),
  ('0e2a52e8-7bdd-4646-8834-59ac92843785'::uuid)
), item_totals AS (
  SELECT i.order_id,COUNT(*) AS lines,COALESCE(SUM(i.adet),0) AS units,
     COALESCE(SUM(i.adet*i.fiyat),0) AS line_total,
     COALESCE(SUM(i.adet) FILTER (WHERE i.product_id=29),0) AS sku29_units
  FROM public.order_items i GROUP BY i.order_id
)
SELECT d.order_id::text AS order_id,o.durum,o.kanal,o.toplam::text AS recorded_order_total,
  CASE WHEN o.id IS NULL THEN 'MISSING_REVIEW'
       WHEN o.kanal='whatsapp'
        AND o.created_at::date='2026-10-07'::date
        AND o.toplam=35000
        AND COALESCE(t.lines,0)=1 AND COALESCE(t.units,0)=1
        AND COALESCE(t.sku29_units,0)=1 AND t.line_total=35000
       THEN 'MATCHES_DECLARED_TEST'
       ELSE 'CHANGED_REVIEW' END AS classification_check
FROM operator_declared_test_ids d
LEFT JOIN public.orders o ON o.id=d.order_id
LEFT JOIN item_totals t ON t.order_id=d.order_id
ORDER BY d.order_id;

-- Query 2: Legacy order-ledger report, excluding exactly the four
-- operator-declared tests; NOT a standalone financial revenue report.
WITH operator_declared_test_ids (order_id) AS (
  VALUES
  ('cb0d2c80-22cd-412f-a2e1-83f4a2b324f1'::uuid),
  ('2c20a703-be0d-4597-b8a0-53be53072042'::uuid),
  ('ad2ce4ea-6f7d-477b-9533-87a3d78e469d'::uuid),
  ('0e2a52e8-7bdd-4646-8834-59ac92843785'::uuid)
)
SELECT COUNT(*) AS all_order_rows,
  COUNT(*) FILTER (WHERE d.order_id IS NOT NULL) AS declared_test_rows,
  COUNT(*) FILTER (WHERE d.order_id IS NULL) AS other_order_rows,
  COUNT(*) FILTER (WHERE d.order_id IS NULL AND o.durum='whatsapp_bekliyor') AS other_pending_rows,
  COUNT(*) FILTER (WHERE d.order_id IS NULL AND o.durum='teslim') AS other_delivered_rows,
  COALESCE(SUM(o.toplam) FILTER (WHERE d.order_id IS NOT NULL AND o.durum='teslim'),0)::text
    AS test_delivered_record_value_to_exclude,
  COALESCE(SUM(o.toplam) FILTER (WHERE d.order_id IS NULL AND o.durum='teslim'),0)::text
    AS other_delivered_record_value_not_verified_revenue,
  (SELECT COUNT(*) FROM operator_declared_test_ids d2
    LEFT JOIN public.orders o2 ON o2.id=d2.order_id
    WHERE o2.id IS NULL) AS declared_id_not_found
FROM public.orders o
LEFT JOIN operator_declared_test_ids d ON d.order_id=o.id;

-- Decision gate: if ANY classification_check is CHANGED_REVIEW/MISSING_REVIEW,
-- stop and investigate before adjusting a dashboard/reporting query.
-- No production SQL mutations or access-control changes are authorized here.
