# CADDE DEPO — MANAGED PREVIEW RPC V3 E2E SQL PROOF
**2026-10-24 | Preview-only | Production NO-GO**

## Applied
- Supabase project: cadde-depo-preview (`emnacsavgsjkrocpngcj`).
- Migration `preview_additive_v3_canary_20261024` applied successfully, version `20261024195437`.
- Added private `cadde_internal.trusted_checkout_orders` with RLS, service-role-only `create_whatsapp_request_protected_v3`, isolated admin function names `admin_set_order_status_v3`, `admin_set_order_status_audited_v3`.
- Existing v2 checkout, previous admin RPC, production assets, old Preview orders/audits remained unchanged.

## Real managed Preview SQL validation
One BEGIN/ROLLBACK transaction called real v3 RPC under `service_role`, generated two new request IDs, observed two trusted source records, confirmed stock remained 1 until approval. AAL1 synthetic authenticated JWT was rejected as `MFA_REQUIRED`; AAL2 synthetic admin JWT approved first order; second approval returned `INSUFFICIENT_ACTIVE_STOCK`; first order cancellation restored stock to 1.

**Observed result: `MANAGED_PREVIEW_V3_SQL_ROLLBACK_PASSED`.**

After ROLLBACK: 3 existing orders, 3 items, 0 dedup, 0 trust, 4 existing audit events, 12 quotas and stock #5=1. Migration persists, transactional test rows do not.

## Permissions
v2 protected RPC and v3 protected RPC: `service_role` execute, not anon/authenticated. v2 and v3 audited admin RPC: authenticated execute, not anon/service_role. The core admin RPC remains inaccessible. Post-install advisor INFO: RLS enabled no policies for internal tables, intentionally private. WARN: authenticated SECURITY DEFINER functions; requires source review and explicit admin JWT/AAL2 enforcement. WARN: leaked-password protection disabled.

## Not yet proven
- Real browser + Cloudflare Turnstile challenge + Vercel gateway + managed Preview v3 RPC in one HTTP checkout with cleanup. Do not claim completed.
- Real admin enrolled MFA, Auth provider leaked password policy, retention decision and production SKU #29 stock reconciliation.
- Production cutover, main merge and actual customer checkout acceptance.

**GO / NO-GO: Preview SQL canary PASS; Production NO-GO.**
