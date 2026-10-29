-- CADDE DEPO / Preview-only / 25 Oct 2026
-- AAL2 must be checked by Postgres for ALL product writes, not only admin.html.
-- STRICTLY NOT A PRODUCTION MIGRATION. Never run against svyqmmivhpfiuhxnmhny.
-- Applying to Preview requires explicit project selection: emnacsavgsjkrocpngcj.
-- Old policy: auth_all_products (authenticated admin, ANY assurance level).
-- Existing preview_active_products_read is intentionally preserved.
BEGIN;
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='products'
      AND policyname='auth_all_products'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='products'
      AND policyname='preview_active_products_read'
  ) THEN
    RAISE EXCEPTION 'PREVIEW_POLICY_SIGNATURE_MISMATCH' USING ERRCODE='23514';
  END IF;
END
$guard$;

DROP POLICY auth_all_products ON public.products;
CREATE POLICY preview_admin_products_read
  ON public.products FOR SELECT TO authenticated
  USING (coalesce((select auth.jwt())->'app_metadata'->>'role','')='admin');
CREATE POLICY preview_admin_products_insert_aal2
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (
    coalesce((select auth.jwt())->'app_metadata'->>'role','')='admin'
    AND coalesce((select auth.jwt())->>'aal','')='aal2'
  );
CREATE POLICY preview_admin_products_update_aal2
  ON public.products FOR UPDATE TO authenticated
  USING (
    coalesce((select auth.jwt())->'app_metadata'->>'role','')='admin'
    AND coalesce((select auth.jwt())->>'aal','')='aal2'
  )
  WITH CHECK (
    coalesce((select auth.jwt())->'app_metadata'->>'role','')='admin'
    AND coalesce((select auth.jwt())->>'aal','')='aal2'
  );
CREATE POLICY preview_admin_products_delete_aal2
  ON public.products FOR DELETE TO authenticated
  USING (
    coalesce((select auth.jwt())->'app_metadata'->>'role','')='admin'
    AND coalesce((select auth.jwt())->>'aal','')='aal2'
  );
COMMIT;

-- Rollback requires a separate supervised migration:
-- remove these four Preview policies, then recreate auth_all_products;
-- this weakens security and must not be an automatic disaster rollback.
-- Never disable RLS or expose service_role to browser.
