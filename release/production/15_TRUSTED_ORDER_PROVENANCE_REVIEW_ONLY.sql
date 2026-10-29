-- CADDE DEPO / REVIEW ONLY / NO-GO: SERVER-ATTESTED ORDER PROVENANCE
-- NOT applied to Preview, Production or other DBs. Review and test on isolated copy.
-- Only the protected service-role checkout RPC may insert a provenance record,
-- after authoritative product/price checks and a successfully created order,
-- within the SAME transaction. Never backfill historical orders.
BEGIN;
CREATE TABLE IF NOT EXISTS cadde_internal.trusted_checkout_orders (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source = 'protected_checkout_v3'),
  attested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS trusted_checkout_orders_attested_at_idx
  ON cadde_internal.trusted_checkout_orders (attested_at);
ALTER TABLE cadde_internal.trusted_checkout_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cadde_internal.trusted_checkout_orders
  FROM PUBLIC,anon,authenticated,service_role;
-- There are intentionally NO anon/authenticated RLS policies.
-- Keep cadde_internal outside exposed API schemas.
COMMENT ON TABLE cadde_internal.trusted_checkout_orders IS
  'Trusted internal order origin: inserted transactionally ONLY by privileged protected checkout. Not a client-controlled order flag.';
COMMIT;

-- SECURITY REVIEW CONDITIONS:
-- 1. A dedicated v3 service-role-only RPC MUST insert this record inside
--    the same transaction as the order; a direct INSERT by anon cannot do so.
-- 2. Replays may reuse an existing order ONLY after validating this record.
-- 3. Audited admin RPC checks it BEFORE same-status or stock changes.
-- 4. Stop if an existing order is marked by a client or backfill process.
-- 5. REVOKE EXECUTE on deprecated RPC versions only AFTER v3 rollout,
--    with verified gateway and reversible cutover.
-- 6. Privileged postgres/DB owners can bypass table grants; restrict operations
--    and review deployment code. Service role secret must remain server-side.
-- This candidate does not enable production checkout or amend old policies.
