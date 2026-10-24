#!/usr/bin/env node
// CADDE DEPO review-only static contract checker; no network, no DB writes.
// Run: node release/production/tests/check_v3_static.cjs
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const v3=fs.readFileSync(path.join(root,'25_CHECKOUT_RPC_V3_REVIEW_ONLY.sql'),'utf8');
const admin=fs.readFileSync(path.join(root,'30_ADMIN_RPC_REVIEW_ONLY.sql'),'utf8');
const trust=fs.readFileSync(path.join(root,'15_TRUSTED_ORDER_PROVENANCE_REVIEW_ONLY.sql'),'utf8');
const body=v3.slice(v3.indexOf('CREATE OR REPLACE FUNCTION'));
const same=body.slice(body.indexOf('IF inserted_count=0 THEN'),body.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock'));
const cross=body.slice(body.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock'),body.indexOf('FOR w,cap IN'));
const cases=[
 ['service-role-only gateway',v3.includes('TO service_role;') && !v3.includes('TO anon;')],
 ['hash null explicitly rejected',v3.includes('p_visitor_hash IS NULL OR p_rate_hash IS NULL')],
 ['same-key replay verifies trusted source',same.includes('trusted_checkout_orders') && same.indexOf('trusted_checkout_orders')<same.indexOf('RETURN prior.response')],
 ['cross-key replay verifies trusted source',cross.includes('trusted_checkout_orders') && cross.indexOf('trusted_checkout_orders')<cross.indexOf('RETURN prior.response')],
 ['attestation atomic with request',body.indexOf('r:=public.create_whatsapp_request')<body.indexOf('INSERT INTO cadde_internal.trusted_checkout_orders')&&body.indexOf('INSERT INTO cadde_internal.trusted_checkout_orders')<body.lastIndexOf('UPDATE cadde_internal.whatsapp_request_dedup')],
 ['admin checks trusted origin before no-op',admin.indexOf('trusted_checkout_orders')<admin.indexOf('old_order.durum=p_new_status')],
 ['admin checks NULL legacy before no-op',admin.indexOf('old_order.stok_rezerve IS NULL')<admin.indexOf('old_order.durum=p_new_status')],
 ['core admin direct grants revoked',/REVOKE ALL ON FUNCTION public\.admin_set_order_status\(uuid,text\)[\s\S]*?FROM PUBLIC,anon,authenticated,service_role;/i.test(admin)],
 ['audited RPC granted to authenticated',admin.includes('GRANT EXECUTE ON FUNCTION public.admin_set_order_status_audited(uuid,text)')],
 ['rejected provenance audit code',admin.includes("WHEN error_message LIKE 'UNTRUSTED_ORDER_SOURCE%' THEN 'UNTRUSTED_ORDER_SOURCE'")],
 ['trusted table RLS enabled',trust.includes('ALTER TABLE cadde_internal.trusted_checkout_orders ENABLE ROW LEVEL SECURITY')],
 ['trusted table direct access revoked',trust.includes('FROM PUBLIC,anon,authenticated,service_role;')]
];
let failed=0; for(const [label,ok] of cases){console.log((ok?'PASS':'FAIL')+' '+label);if(!ok)failed++;}
console.log(cases.length-failed+'/'+cases.length+' checks passed');
if(failed) process.exitCode=1;
