// Blocking classic script for static HTML: env is read only inside the Function.
const {getPublicConfig}=require('../lib/supabase-environment.cjs');
module.exports=(req,res)=>{
  res.setHeader('Content-Type','application/javascript; charset=utf-8');
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('CDN-Cache-Control','no-store');
  res.setHeader('Vercel-CDN-Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');res.status(405).send('window.CD_PUBLIC_CONFIG=null;');return;
  }
  try{
    const json=JSON.stringify(getPublicConfig()); // External JS response; fields are explicitly validated.
    res.status(200).send(`window.CD_PUBLIC_CONFIG=Object.freeze(${json});`);
  }catch{
    // No URL, token, secret or environment value is emitted in the error response.
    res.status(503).send('window.CD_PUBLIC_CONFIG=null;');
  }
};
