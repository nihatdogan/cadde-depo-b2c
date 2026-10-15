-- SEPARATE PUBLICATION STEP. NOT AUTHORISED OR EXECUTED.
-- After migration, approved frontend, read-only live checks, licence verification and new manager approval.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $$
declare approval text; licence text;
begin
 if current_setting('cadde_depo.target_project_ref',true) is distinct from 'svyqmmivhpfiuhxnmhny' then raise exception 'Wrong target'; end if;
 approval=nullif(trim(current_setting('cadde_depo.publication_approval_ref',true)),'');
 licence=nullif(trim(current_setting('cadde_depo.image_permission_ref',true)),'');
 if approval is null or licence is null then raise exception 'Separate publication and image permission evidence required'; end if;
 if not exists(select 1 from public.products where sku='BRABANTIA-385728' and nullif(trim(gorsel_url),'') is not null) then
  raise exception 'Licensed real image URL required first'; end if;
 update public.supply_release_control set enabled=true,publication_approval_ref=approval,image_permission_ref=licence
 where release_key='brabantia-385728-production-v1';
 if not found then raise exception 'Production migration missing'; end if;
 update public.products set image_rights_status='LICENSED',aktif=true where sku='BRABANTIA-385728';
end $$;
commit;
