'use strict';
// Checkout candidate: only same-origin gated API may create an order. NO direct DB writes.
(function(root){
  const API='/api/cadde-order-v3',KEY='cd_checkout_v3_intent',VISITOR='cd_checkout_v3_visitor';
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const UUID4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const signature=cart=>JSON.stringify(cart.map(p=>[Number(p.id),Number(p.now)]));
  function createClient(options){
    let enabled=false,siteKey=null,busy=false,token=null,widgetId=null,turnstileLoad=null;
    const el=options.elements||{},cart=()=>options.getCart?options.getCart():[];
    const read=k=>{try{return root.localStorage.getItem(k);}catch{return null;}};
    const save=(k,v)=>{try{root.localStorage.setItem(k,v);return true;}catch{return false;}};
    function intent(){try{const x=JSON.parse(read(KEY)||'null');
      return x&&UUID4.test(x.visitorId)&&UUID.test(x.key)&&typeof x.signature==='string'&&
        ['pending','saved'].includes(x.state)?x:null;}catch{return null;}}
    function receipt(status,body,total){return (status===200||status===201)&&body&&typeof body==='object'&&
      UUID.test(body.request_id)&&body.reused===(status===200)&&
      typeof body.total==='number'&&Number.isFinite(body.total)&&body.total===total;}
    const say=s=>{if(el.status){el.status.textContent=s;el.status.hidden=!s;}};
    function showLink(x){
      if(!el.whatsapp||!options.waHref)return;
      const msg='Merhaba Cadde Depo, kayıtlı sipariş talebim için iletişime geçiyorum.\n'+
        'Talep kodu: '+x.orderId+'\n\n'+cart().map(p=>'• '+p.nm+' — '+options.fmt(p.now)).join('\n')+
        '\n\nÜrünler toplamı (kargo hariç): '+options.fmt(x.total)+
        '\nTeslimat adresime göre kargo ücretini ve kesin ödeme toplamını ödeme öncesinde paylaşır mısınız?';
      el.whatsapp.href=options.waHref(msg);el.whatsapp.hidden=false;
    }
    function refresh(){
      const x=intent(),same=x?.signature===signature(cart());
      if(el.whatsapp){el.whatsapp.hidden=true;el.whatsapp.removeAttribute('href');}
      if(x?.state==='saved'&&same){
        showLink(x);say('Talep kaydedildi; ödeme veya stok rezervasyonu değildir. WhatsApp üzerinden teyitle devam edin.');
      }else if(x?.state==='pending'&&!same){
        say('Önceki talebin sonucu bilinmiyor. Sepet değiştirildi; yeni kayıt oluşturulamaz. Destek ile görüşün.');
      }else if(x?.state==='pending'){
        say('Önceki talep kaydedilmiş olabilir. Aynı işlem kimliği ve yeni güvenlik doğrulamasıyla tekrar deneyin.');
      }
      if(el.button)el.button.disabled=busy||!options.isProduction||
        (x?.state==='saved'&&same)||(x?.state==='pending'&&!same)||
        (!!enabled&&!token);
    }
    function canEdit(){const x=intent();return !busy&&x?.state!=='pending';}
    async function check(){
      if(!options.isProduction)return {enabled:false,reason:'PREVIEW_DISABLED'};
      try{
        const response=await root.fetch(API,{method:'GET',cache:'no-store',credentials:'same-origin'});
        const body=await response.json().catch(()=>null);
        enabled=response.status===200&&body?.enabled===true&&
          typeof body.siteKey==='string'&&body.siteKey.length>=8;
        siteKey=enabled?body.siteKey:null;
        return {enabled,siteKey};
      }catch{enabled=false;siteKey=null;return {enabled:false,reason:'UNAVAILABLE'};}
    }
    function loadTurnstile(){
      if(root.turnstile)return Promise.resolve(root.turnstile);
      if(turnstileLoad)return turnstileLoad;
      turnstileLoad=new Promise((resolve,reject)=>{
        const script=root.document.createElement('script');
        script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async=true;
        script.onload=()=>root.turnstile?resolve(root.turnstile):reject(Error('CHALLENGE_UNAVAILABLE'));
        script.onerror=()=>reject(Error('CHALLENGE_UNAVAILABLE'));
        root.document.head.appendChild(script);
      }).catch(e=>{turnstileLoad=null;throw e;});
      return turnstileLoad;
    }
    async function prepare(){
      if(!options.isProduction){say('Preview ortamında sipariş kaydı kapalıdır.');refresh();return;}
      if(enabled)return;
      if(el.button)el.button.disabled=true;
      const available=enabled?{enabled:true,siteKey}:await check();
      if(!available.enabled){say('Güvenli sipariş kaydı şu anda kapalı. Talep oluşturulmadı.');refresh();return;}
      try{
        const widget=await loadTurnstile();
        if(el.challenge)el.challenge.hidden=false;
        widgetId=widget.render(el.turnstile,{sitekey:siteKey,action:'checkout',
          callback:value=>{token=value;say('Güvenlik doğrulaması tamamlandı.');refresh();},
          'expired-callback':()=>{token=null;say('Doğrulama süresi doldu.');refresh();},
          'error-callback':()=>{token=null;say('Doğrulama başarısız.');refresh();}
        });
        say('Sipariş kaydı için güvenlik doğrulamasını tamamlayın.');
      }catch{enabled=false;token=null;say('Güvenlik doğrulaması yüklenemedi. Sipariş oluşturulmadı.');}
      refresh();
    }
    function currentIntent(){
      const x=intent(),sig=signature(cart());
      if(x?.state==='pending'&&x.signature!==sig)return null;
      if(x&&x.signature===sig)return x;
      let visitorId=read(VISITOR);
      if(visitorId&&!UUID4.test(visitorId))return null;
      if(!visitorId){visitorId=root.crypto.randomUUID();if(!save(VISITOR,visitorId))return null;}
      const fresh={visitorId,key:root.crypto.randomUUID(),signature:sig,state:'pending'};
      return save(KEY,JSON.stringify(fresh))?fresh:null;
    }
    function resetToken(){
      token=null;
      if(root.turnstile&&widgetId!==null)root.turnstile.reset(widgetId);
    }
    async function submit(){
      if(!options.isProduction){say('Preview siparişi kapalı.');return;}
      if(busy||!cart().length)return;
      if(!enabled){await prepare();return;}
      if(!token){say('Önce güvenlik doğrulamasını tamamlayın.');return;}
      const ids=cart().map(p=>Number(p.id)),total=cart().reduce((s,p)=>s+Number(p.now),0);
      if(ids.length>12||ids.some(x=>!Number.isSafeInteger(x)||x<=0)||
        !Number.isFinite(total)||total<=0||total>1000000000){
        say('Sepet doğrulanamadı. Talep kaydedilmedi.');return;
      }
      const x=currentIntent();
      if(!x){say('Önceki işlem belirsiz veya güvenli kimlik saklanamadı. Yeni talep gönderilmedi.');refresh();return;}
      if(x.state==='saved'){refresh();return;}
      // Persist the key before network I/O; never mint another key on an ambiguous retry.
      if(!save(KEY,JSON.stringify(x))){say('İşlem kimliği saklanamadı; talep gönderilmedi.');return;}
      busy=true;refresh();say('Talep kaydı kontrol ediliyor…');
      try{
        const response=await root.fetch(API,{method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({productIds:ids,expectedTotal:total,
            visitorId:x.visitorId,idempotencyKey:x.key,turnstileToken:token})});
        const body=await response.json().catch(()=>null);
        if(!receipt(response.status,body,total)){
          say('Sipariş kaydı doğrulanamadı. Yeni talep oluşturmayın; aynı sepet ve işlem kimliğiyle yeniden doğrulayın.');return;
        }
        x.state='saved';x.orderId=body.request_id;x.total=body.total;
        if(!save(KEY,JSON.stringify(x))){say('Talep doğrulandı fakat tarayıcıya kaydedilemedi. Talep kodu: '+body.request_id);return;}
        say('Talep kaydedildi. WhatsApp üzerinden teyitle devam edin.');
      }catch{say('Bağlantı kesildi; kayıt belirsiz. Aynı işlem kimliğiyle yeniden doğrulayın.');}
      finally{busy=false;resetToken();refresh();}
    }
    if(el.button)el.button.onclick=submit;
    refresh();
    return {check,receipt,prepare,submit,refresh,canEdit,get enabled(){return enabled;}};
  }
  const api={createClient,signature};
  root.CaddeCheckoutV3=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
