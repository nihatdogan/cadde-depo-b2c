-- REVIEW-ONLY DRAFT. NOT APPROVED FOR EXECUTION ON ANY DATABASE.
-- Never apply to Production without separately approved release gate.
-- Scope: additive objects only; no grants, no status mutation, no legacy cutover.
BEGIN;
CREATE SCHEMA IF NOT EXISTS cadde_internal;
REVOKE ALL ON SCHEMA cadde_internal FROM PUBLIC, anon, authenticated;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stok_rezerve boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS cadde_internal.whatsapp_request_dedup(
 visitor_hash text NOT NULL,
 idempotency_key uuid NOT NULL,
 request_signature jsonb NOT NULL,
 request_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
 response jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(visitor_hash,idempotency_key)
);
ALTER TABLE cadde_internal.whatsapp_request_dedup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cadde_internal.whatsapp_request_dedup FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS cadde_internal.whatsapp_request_quota(
 visitor_hash text NOT NULL,
 window_seconds integer NOT NULL,
 window_start timestamptz NOT NULL,
 requests integer NOT NULL DEFAULT 0 CHECK (requests>=0),
 PRIMARY KEY(visitor_hash,window_seconds,window_start)
);
ALTER TABLE cadde_internal.whatsapp_request_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cadde_internal.whatsapp_request_quota FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS cadde_internal.admin_order_status_audit(
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
 ON cadde_internal.admin_order_status_audit(order_id,occurred_at DESC);
ALTER TABLE cadde_internal.admin_order_status_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cadde_internal.admin_order_status_audit FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE cadde_internal.admin_order_status_audit_audit_id_seq FROM PUBLIC,anon,authenticated;
COMMIT;
-- STOP HERE. This creates NO checkout or admin RPC and does NOT make production safe.
-- Old orders are backfilled with reserved=false as an initial technical default,
-- NOT proof of whether historical stock was already deducted. Reconcile before status cutover.
-- Explicitly do NOT revoke old INSERT/UPDATE grants until a tested replacement is deployed.
-- Do NOT enable the new client without production-specific gateway, signed-off migrations
-- and separate tested fail-closed / rollback plan.
