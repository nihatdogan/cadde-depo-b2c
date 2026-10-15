// No default URL/key. Failure occurs before createClient, auth refresh or DB calls.
(function(root){
  function blocked(){
    const show=()=>{
      const banner=document.createElement('div');
      banner.setAttribute('role','alert');
      banner.style.cssText='position:relative;z-index:99999;padding:20px;background:#fff0e6;color:#17150f;border:2px solid #c43d0e;font:16px system-ui';
      banner.textContent='Veritabanı bağlantısı güvenli biçimde durduruldu. Bu ortam için bağımsız test yapılandırması gerekli. İşlem veya sipariş kaydı yapılmadı.';
      document.body.prepend(banner);
    };
    if(document.body) show();else document.addEventListener('DOMContentLoaded',show,{once:true});
    throw new Error('DATABASE_ENVIRONMENT_BLOCKED');
  }
  function createClient(){
    const c=root.CD_PUBLIC_CONFIG;
    if(!c || !['production','preview','development'].includes(c.environment) || !/^[a-z0-9]{20}$/.test(c.projectRef||'') || c.url!==`https://${c.projectRef}.supabase.co` || typeof c.publishableKey!=='string') return blocked();
    const productionRef='svyqmmivhpfiuhxnmhny';
    if(c.environment!=='production' && c.projectRef===productionRef) return blocked();
    if(c.environment==='production' && c.projectRef!==productionRef) return blocked();
    if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.publishableKey)){
      let payload;
      try{
        const encoded=c.publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
        payload=JSON.parse(root.atob(encoded));
      }catch {return blocked();}
      if(payload.role!=='anon' || payload.ref!==c.projectRef || c.publishableKey.split('.').length!==3) return blocked();
    }
    if(!root.supabase?.createClient) return blocked();
    // Production keeps its original auth options and storage key.
    if(c.environment==='production') return root.supabase.createClient(c.url,c.publishableKey);
    return root.supabase.createClient(c.url,c.publishableKey,{auth:{storageKey:`cd-${c.environment}-${c.projectRef}-auth`,detectSessionInUrl:false}});
  }
  root.CDDatabase=Object.freeze({createClient});
})(window);
