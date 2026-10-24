'use strict';
// CADDE DEPO — Preview-only fail-closed deployment probe.
// NO orders, NO database calls, NO Turnstile challenge, NO secrets returned.
// This is NOT the checkout API. Safe even if accidentally present on main.
const candidate = require('../release/production/candidate-api/whatsapp-request.cjs');

module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  const reply=(status,payload)=>res.status(status).json(payload);
  if(req.method!=='GET')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(process.env.VERCEL!=='1' ||
     process.env.VERCEL_ENV!=='preview' ||
     process.env.VERCEL_GIT_COMMIT_REF!=='prep/production-order-security-20261024') {
    return reply(404,{error:'NOT_FOUND'});
  }
  // This GET-only probe calls candidate's configuration gate with a
  // synthetic in-memory response. Candidate cannot make a DB or Turnstile
  // request because it rejects non-production environments up front.
  let status=0, result=null;
  const fakeRes={
    writeHead(code){status=code;return this;},
    end(payload){try{result=JSON.parse(payload);}catch{result=null;}return this;}
  };
  try {
    await candidate({method:'GET',headers:{host:'caddedepo.com'}},fakeRes);
  }catch{
    return reply(500,{error:'CANDIDATE_GATE_UNEXPECTED'});
  }
  if(status!==503 || result?.error!=='ORDER_API_DISABLED'){
    return reply(500,{error:'CANDIDATE_NOT_FAIL_CLOSED'});
  }
  return reply(503,{enabled:false,check:'PRODUCTION_CANDIDATE_FAIL_CLOSED'});
};
