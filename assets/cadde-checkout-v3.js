'use strict';
// Review-only UI gate. Never create orders on Preview.
(function(root){
  const API='/api/cadde-order-v3';
  function createClient(options){
    let enabled=false,siteKey=null;
    async function check(){
      if(!options.isProduction)return {enabled:false,reason:'PREVIEW_DISABLED'};
      try{
        const response=await root.fetch(API,{method:'GET',cache:'no-store'});
        const body=await response.json().catch(()=>null);
        enabled=response.status===200&&body?.enabled===true&&typeof body.siteKey==='string';
        siteKey=enabled?body.siteKey:null;
        return {enabled,siteKey};
      }catch{enabled=false;return {enabled:false,reason:'UNAVAILABLE'};}
    }
    function receipt(status,body,total){
      return (status===200||status===201)&&body&&
        body.reused===(status===200)&&body.total===total&&
        typeof body.request_id==='string'&&
        /^[a-f0-9-]{36}$/i.test(body.request_id);
    }
    return {check,receipt,get enabled(){return enabled;}};
  }
  root.CaddeCheckoutV3={createClient};
  if(typeof module!=='undefined'&&module.exports)module.exports={createClient};
})(typeof window!=='undefined'?window:globalThis);
