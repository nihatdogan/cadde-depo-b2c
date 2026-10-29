# CADDE DEPO — Production Security Cutover GO/NO-GO (Step 43)

**Date:** 2026-10-28 (Europe/Istanbul)  
**Verdict:** **NO-GO** for Production v3 cutover or PR merge.  
**Audit mode:** READ ONLY — catalog/RLS/GRANT introspection, GitHub read, Vercel read. **No live SQL mutation, permission changes, deployments, or transactions.**  
**Target:** Supabase Production `svyqmmivhpfiuhxnmhny`; Vercel `caddedepo-b2c` project; repo `nihatdogan/cadde-depo-b2c` `main`.  
**Separated environment:** Supabase Preview `emnacsavgsjkrocpngcj`; draft PR #2 `prep/production-order-security-20261024`. **Do not confuse them.**

## 1. Verified baseline (not a business revenue claim)

| Evidence | Observed |
|---|---|
| Vercel Production domain | `caddedepo.com` verified and redirects to `www.caddedepo.com`; both resolve to Production deployment `dpl_3UF5HkkPpWvcLnVZRXy1bED1yJui` |
| Production Vercel status/source | READY; Git branch `main`; Git commit `6ba49227be907b87f225284bdb222fa3e04f3011` |
| PR #2 base vs deploy | PR base commit matches the deployed Production commit; PR is still OPEN + DRAFT |
| Production database state | PostgreSQL 17.6; Supabase project ACTIVE_HEALTHY (read at audit) |
| Product SKU #29 | `products.stok=5`; operator stated physical saleable stock=5 |
| Legacy orders and items | 4 orders, 4 items, all referencing SKU #29 |
| Legacy order statuses | 3 `whatsapp_bekliyor` records totaling 105,000 TL recorded value; 1 `teslim` record with 35,000 TL recorded value |
| Actual collections or delivery | **Operator attestation:** four test orders, no actual payment, refund or dispatch. **Not verified against bank/payment/transport ledgers.** These figures are test-order recorded amounts, not revenue or cash. |
| Production classification | `cadde_internal.order_classification_events` and AAL2 classification RPC absent |
| Production secure order RPC | No order/WhatsApp/checkout/status RPC found in exposed `public` schema |
| Database migration history | Supabase `list_migrations` returned empty; does **not** establish existence/absence of backups or out-of-band historical DDL |

## 2. Directly observed authorization controls

**RLS is enabled** for `public.orders`, `public.order_items`, and `public.products`. However enabling RLS is not sufficient: policy predicates matter.

| Object / role | Observed RLS policy | Risk |
|---|---|---|
| `orders` / `anon,authenticated` | `anon_insert_orders`, INSERT `WITH CHECK true` | **P0:** Unauthenticated user can submit arbitrary order row values subject to schema constraints; no server-side price, idempotency, trusted provenance, or quota check in this policy. |
| `order_items` / `anon,authenticated` | `anon_insert_items`, INSERT `WITH CHECK true` | **P0:** Client-controlled item price, product ID and qty not checked against authoritative catalog as part of one transaction. |
| `orders` / `authenticated` | `auth_update_orders` UPDATE USING/WITH CHECK `auth.jwt()->'app_metadata'->>'role'='admin'` | **P0:** JWT admin status checked, but no AAL2/MFA clause and no audited stock transition RPC is enforced in this policy. |
| `orders`, `order_items` / `authenticated` | SELECT with JWT `app_metadata.role=admin` | Role-restricted read; protected by RLS, not open anonymous read. |
| `products` / `anon,authenticated` | `anon_read_products` SELECT WHERE `aktif` | Intended storefront read; review exact exposure as part of release. |
| `products` / `authenticated` | admin SELECT, INSERT, UPDATE, DELETE based on `app_metadata.role=admin` | **P0 for stock integrity:** No AAL2 predicate on admin product mutation policies; current admin uses direct client table writes. |

`anon` and `authenticated` have broad PostgreSQL table-level INSERT/UPDATE/DELETE grants for these three tables, **but RLS narrows the effective permissions**. Do not confuse broad GRANTs with a demonstrated RLS bypass. The specific anonymous INSERT policies above are the verified open write path; anonymous UPDATE/DELETE is not proven accessible by this audit.

No user-supplied JWT, endpoint exploit, test order or other write was attempted in Production.

## 3. Live deployed application paths

- `main/index.html` writes to `orders` then `order_items` using two **separate client-side** Supabase `.insert(...)` calls, without one server-side atomic transaction. Values originate from browser cart and client UUID.
- It opens a WhatsApp message even after its `try/catch` for a failed database write. Further, without checking returned `error` properties, Supabase's normal error-returning behavior may not enter `catch`. A WhatsApp contact must **not** be misrepresented as an accepted reservation.
- `main/admin.html` invokes `sb.from('orders').update({durum})`, not an audited AAL2 transition RPC. Its session UI does not implement the Preview MFA gate.
- `main/admin.html` displays sum of recorded `orders.toplam` with `durum='teslim'` as `Toplam ciro`. On current user-attested test-only historical data this falsely presents **35,000 TL** as a delivered-order revenue proxy; no collection evidence exists. Real net sales cannot be inferred.
- GitHub `main` matches the Vercel Production deployment commit. The secure PR branch has **not** been deployed to Production.

## 4. Additional security advisor findings

2026-10-28 Supabase Security Advisor:
1. **WARN:** `public.rls_auto_enable()` is SECURITY DEFINER and executable by anon/authenticated. Source inspected: this is an **event-trigger function** using `pg_event_trigger_ddl_commands()` to enable RLS on newly created public tables. Advisor flags unnecessary EXECUTE exposure; **not proof of a callable escalation exploit**. Review and revoke unneeded EXECUTE in a separately tested release. Reference: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
2. **WARN:** leaked password protection disabled. Review enabling in Supabase Auth settings. Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
3. **INFO:** `public.products_backup_20261007` has RLS enabled without policies, so public reads are blocked. Confirm retention and backup classification; no deletion recommended. Reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## 5. Release gates (all required; none may be waived due solely to Preview success)

| Gate | Requirement | Current |
|---|---|---|
| G1 — Restore evidence | Verify a **real Production** recoverable backup, restore procedure, restore exercise, RPO/RTO and authorized backout plan; don't rely on synthetic CI restore alone | **NOT VERIFIED** |
| G2 — Production schema and exact legacy rows | Reconcile old four tests, preserve immutable history; classify with AAL2/admin, no deletion or invented sales; maintain legacy `stok_rezerve=NULL` safety | **PREPARED IN DRAFT ONLY** |
| G3 — Protected checkout | Deploy server-side v3 gateway using server-side price/stock checks, atomic order+items, signed trusted source, idempotency, anti-abuse and fail-closed error semantics; no private secrets in browser | **NOT DEPLOYED** |
| G4 — Database cutover privileges | In a tightly controlled launch window retire `anon_insert_orders`/`anon_insert_items` and direct legacy status writes only when replacement checkout/admin flows are tested and ready; verify no other write route | **NOT DONE** |
| G5 — Admin safety | AAL2/admin audited status transitions, product stock mutations gated appropriately, test-vs-business labeling, idempotent transitions and rollback controls | **PREVIEW PASS; PRODUCTION NOT DEPLOYED** |
| G6 — Dashboard truthfulness | Ensure old test orders are not counted as real demand/cash; classify unclassified separately; report payment evidence, refunds and KDV correctly | **PREVIEW PASS; PRODUCTION NOT DEPLOYED** |
| G7 — E2E + observability | On approved Production launch, confirm checkout, bad input rejection, concurrent stock, MFA reject/accept, logs and rollback/health checks against *noncustomer* controlled test data | **NOT VERIFIED ON PRODUCTION** |
| G8 — Approval | Explicit authorized Production cutover approval after evidence and rollback sign-off, `main` merge & deployment plan | **NOT GIVEN** |

**Known safety tradeoff:** Abruptly revoking the old anonymous INSERT policies before deploying a compatible protected checkout will break the current website's order-recording path. Leaving both old and protected writes open indefinitely defeats the security objective. A coordinated cutover with clear user-visible fail-closed behavior, controlled service verification and an exercised rollback is required.

## 6. Recommended minimal next step

**Step 44: independently verify Production backup and practical restore readiness, read only.** Request Supabase dashboard screenshots/details or an approved backup evidence path; never copy customer data, access tokens, MFA keys or secrets into the report. Only once this gate is known should a Production migration/cutover plan be submitted for explicit approval.

## 7. Evidence boundaries

- Source evidence: production `pg_policies`, `pg_class`, `has_table_privilege`, `pg_proc`, function definition; Supabase security advisors, deployment/project read; GitHub `main` checkout and admin files; GitHub PR #2 metadata.
- Preview prior evidence: Postgres 16/17 CI, real Preview AAL2 pilot, status audit, one append-only classification event and dashboard summary; proves Preview operation only.
- **Not inspected:** verified Production backup status, external bank/PSP collections, dispatch proof, operational logs across a real Production checkout, current customer traffic, real disaster recovery restore. No claim of those checks passing.
- No Production INSERT/UPDATE/DELETE/DDL, no granting or revoking roles, no new orders, no deployment or merge was performed by this audit.
