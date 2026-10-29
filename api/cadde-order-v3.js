'use strict';
// CADDE DEPO — production checkout v3 route candidate, RELEASE GATED.
// Never used by index.html or urun.html until an independently approved cutover.
// The referenced handler fails closed unless all production-specific runtime,
// host, project, credential and explicit enablement checks pass.
module.exports=require('../release/production/candidate-api/whatsapp-request.cjs');
