-- CADDE DEPO: READ-ONLY PRODUCTION PRECHECK (DRAFT / NO-GO).
-- Intended target: production Supabase svyqmmivhpfiuhxnmhny.
-- DO NOT APPLY schema changes from this file: it performs SELECTs only.
-- 24.10.2026 baseline: orders has NO stok_rezerve; there are NO secured order RPCs.
-- Execute read-only before a separately approved migration and archive results securely.

SELECT current_database() AS database_name, current_user AS reader, now() AS checked_at;

SELECT table_schema,table_name,column_name,data_type,is_nullable,column_default
FROM information_schema.columns
WHERE table_schema IN ('public','cadde_internal')
  AND table_name IN ('orders','order_items','products',
                     'whatsapp_request_dedup','whatsapp_request_quota',
                     'admin_order_status_audit')
ORDER BY table_schema,table_name,ordinal_position;

SELECT n.nspname AS schema_name,p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('create_whatsapp_request',
                    'create_whatsapp_request_protected_v2',
                    'admin_set_order_status',
                    'admin_set_order_status_audited')
ORDER BY p.proname;

SELECT tablename,policyname,roles,cmd,qual,with_check
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('orders','order_items','products')
ORDER BY tablename,policyname;

-- Aggregated counts only: no order IDs, customer details or keys.
SELECT durum,kanal,count(*) AS orders
FROM public.orders GROUP BY durum,kanal ORDER BY durum,kanal;

SELECT count(*) AS orders FROM public.orders;
SELECT count(*) AS order_items FROM public.order_items;
SELECT count(*) AS products,
       count(*) FILTER (WHERE stok<0) AS negative_stock,
       count(*) FILTER (WHERE stok>max_stok) AS exceed_max
FROM public.products;

SELECT c.conname,t.relname AS table_name,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid=c.conrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname IN ('orders','order_items','products')
ORDER BY table_name,c.conname;
