# PRODUCTION GATEWAY — FAIL-CLOSED SPECIFICATION (NOT DEPLOYED)

**Status:** REVIEW ONLY, NO-GO. Production application must not use Preview-only API directly.

## Fail-closed runtime gates
Before serving GET or POST:
- `VERCEL=1` and `VERCEL_ENV=production`.
- `CADDE_DEPLOY_STAGE=production`, `CADDE_ORDER_API_ENABLED=on` (default absent/off).
- `CADDE_EXPECTED_SUPABASE_REF=svyqmmivhpfiuhxnmhny`; verify `SUPABASE_URL=https://svyqmmivhpfiuhxnmhny.supabase.co` exactly.
- Canonical request host is `caddedepo.com` or `www.caddedepo.com`; validate `Origin` exactly on mutating requests.
- Separate production-only server credentials: `SUPABASE_SERVICE_ROLE_KEY`, `CADDE_RATE_SALT`, `TURNSTILE_SECRET_KEY` and public site key. Never echo secrets in GET or error text (except public Turnstile site key).
- A securely reviewed, production-installed `create_whatsapp_request_protected_v2` RPC must be verified BEFORE enabling the flag.
- Preserve 8 KB JSON size, 1–12 item, verified UUID, current price and availability server-side.
- Verify Turnstile success/hostname/action; never accept challenge reuse.
- Choose trusted Vercel forwarding headers only under verified Vercel runtime. Always use server-generated HMACs for visitor and rate keys.
- Do not couple retry idempotency to anonymous browser UUID alone as unique customer identity; explicit checkout-intent token and intentional reorder semantics require review.
- Fail with 503 on absent dependencies; do not fall back to unprotected direct INSERT.
- No API secret or privilege-bearing key in HTML/client JS.

## Release sequencing
1. Auth, RLS, backward-compatible schema migration and historical NULL order reconciliation approved and tested in isolated clone.
2. Atomic request/stock RPC and audited admin RPC deployed and checked via signed roles.
3. Production-only API deployed **disabled**. Verify 503/feature off.
4. Enable the server API after production-specific Turnstile and end-to-end tests in a controlled canary.
5. Swap checkout UI after gateway verified.
6. Revoke former `anon` direct INSERT and admin direct UPDATE paths only once replacement verified, with reversible grant/runbook.
7. Monitor new orders, stock, errors, audit. Roll back web deployment + grants as approved. Do not drop or truncate audit.

## Open gates
- Production migrations, full code and real HTTP requests have NOT been run.
- Auth leaked-password protection and audit retention policy unapproved.
- Historical delivered/pending orders must be reconciled before a status-RPC migration.
