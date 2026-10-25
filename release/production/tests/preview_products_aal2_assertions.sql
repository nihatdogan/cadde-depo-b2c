-- PostgreSQL 16 CI only. All synthetic mutations are inside ROLLBACK.
-- Assert admin AAL1 can't mutate products while admin AAL2 can.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"},"aal":"aal1"}',true);
DO $aal1$
DECLARE n integer; denied boolean:=false;
BEGIN
  PERFORM 1 FROM public.products WHERE id=5;
  IF NOT FOUND THEN RAISE EXCEPTION 'AAL1_ADMIN_SELECT_SHOULD_WORK'; END IF;
  UPDATE public.products SET ad='FORBIDDEN_AAL1_WRITE' WHERE id=5;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'AAL1_UPDATE_NOT_BLOCKED'; END IF;
  DELETE FROM public.products WHERE id=5;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'AAL1_DELETE_NOT_BLOCKED'; END IF;
  BEGIN
    INSERT INTO public.products(id,ad,aktif,stok,max_stok,outlet_fiyat)
      VALUES(702,'FORBIDDEN_AAL1_INSERT',true,1,1,33000);
  EXCEPTION WHEN insufficient_privilege THEN
    denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'AAL1_INSERT_NOT_BLOCKED'; END IF;
END
$aal1$;

SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"},"aal":"aal2"}',true);
DO $aal2$
DECLARE n integer;
BEGIN
  INSERT INTO public.products(id,ad,aktif,stok,max_stok,outlet_fiyat)
    VALUES(702,'AAL2_INSERT',true,1,1,33000);
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'AAL2_INSERT_BLOCKED'; END IF;
  UPDATE public.products SET ad='AAL2_UPDATE' WHERE id=702;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'AAL2_UPDATE_BLOCKED'; END IF;
  DELETE FROM public.products WHERE id=702;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'AAL2_DELETE_BLOCKED'; END IF;
END
$aal2$;

SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000002","app_metadata":{"role":"customer"},"aal":"aal2"}',true);
DO $notadmin$
DECLARE n integer;
BEGIN
  UPDATE public.products SET ad='FORBIDDEN_NONADMIN' WHERE id=5;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'NON_ADMIN_UPDATE_NOT_BLOCKED'; END IF;
END
$notadmin$;
ROLLBACK;
SELECT 'PREVIEW_PRODUCT_AAL2_RLS_ROLLBACK_PASSED' AS evidence;
