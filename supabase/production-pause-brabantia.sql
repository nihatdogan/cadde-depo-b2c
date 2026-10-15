-- APPROVAL-GATED FORWARD ROLLBACK: stop new requests; preserve every real order and evidence row.
-- Prepared only. No DROP, DELETE, TRUNCATE, stock restoration or destructive backup restore.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $$ begin
 if current_setting('cadde_depo.target_project_ref',true) is distinct from 'svyqmmivhpfiuhxnmhny'
 or nullif(trim(current_setting('cadde_depo.rollback_approval_ref',true)),'') is null then
  raise exception 'Explicit rollback approval required'; end if;
 update public.supply_release_control set enabled=false where release_key='brabantia-385728-production-v1';
 update public.products set aktif=false where sku='BRABANTIA-385728';
end $$;
commit;
