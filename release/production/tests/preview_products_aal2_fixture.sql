-- Ephemeral PostgreSQL 16 CI only: reproduce Preview's pre-migration product RLS.
-- DO NOT run against managed Supabase, Preview, or Production.
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT ON public.products TO anon;
CREATE POLICY auth_all_products ON public.products FOR ALL TO authenticated
  USING (coalesce((select auth.jwt())->'app_metadata'->>'role','')='admin')
  WITH CHECK (coalesce((select auth.jwt())->'app_metadata'->>'role','')='admin');
CREATE POLICY preview_active_products_read ON public.products FOR SELECT TO anon,authenticated
  USING (aktif IS TRUE);
