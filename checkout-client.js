(function(root){
 let scriptPromise;
 function challenge(siteKey){
  if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{
   if(root.turnstile){resolve();return;}
   const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
   script.onload=resolve;script.onerror=()=>{scriptPromise=null;reject(new Error('Doğrulama yüklenemedi.'));};document.head.append(script);
  });
  return scriptPromise.then(()=>new Promise((resolve,reject)=>{
   const modal=document.createElement('dialog'),text=document.createElement('p'),slot=document.createElement('div'),cancel=document.createElement('button');
   text.textContent='Sipariş talebi için doğrulamayı tamamlayın.';cancel.textContent='Vazgeç';modal.append(text,slot,cancel);document.body.append(modal);modal.showModal();
   let widget,done=false;
   function finish(token,error){if(done)return;done=true;if(widget!==undefined)root.turnstile.remove(widget);modal.close();modal.remove();error?reject(error):resolve(token);}
   cancel.onclick=()=>finish(null,new Error('Talep iptal edildi.'));modal.addEventListener('cancel',e=>{e.preventDefault();cancel.onclick();});
   widget=root.turnstile.render(slot,{sitekey:siteKey,action:'cadde-checkout',callback:t=>finish(t),'error-callback':()=>finish(null,new Error('Doğrulama başarısız.')),'expired-callback':()=>finish(null,new Error('Doğrulamanın süresi doldu.'))});
  }));
 }
 async function create(kind,items){
  const siteKey=root.CD_PUBLIC_CONFIG?.checkout?.siteKey;
  if(!siteKey)throw new Error('Sipariş talebi şu an kullanıma hazır değil. Lütfen daha sonra tekrar deneyin.');
  const canonical=Array.from(items.reduce((m,i)=>m.set(Number(i.id),(m.get(Number(i.id))||0)+Number(i.quantity)),new Map()),([id,quantity])=>({id,quantity})).sort((a,b)=>a.id-b.id);
  const fingerprint=JSON.stringify({kind,items:canonical});
  let saved;try{saved=JSON.parse(sessionStorage.getItem('cd_secure_checkout')||'null');}catch{}
  if(!saved || saved.fingerprint!==fingerprint || Date.now()-saved.time>15*60*1000){saved={fingerprint,time:Date.now(),key:root.crypto.randomUUID()};sessionStorage.setItem('cd_secure_checkout',JSON.stringify(saved));}
  const challengeToken=await challenge(siteKey);
  const response=await root.fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({kind,items:canonical,idempotencyKey:saved.key,challengeToken})});
  const data=await response.json();
  if(!response.ok){if(data.error==='QUOTE_EXPIRED')sessionStorage.removeItem('cd_secure_checkout');const messages={RATE_LIMITED:'Çok sık talep gönderildi. Biraz sonra tekrar deneyin.',STOCK_UNAVAILABLE:'Yeterli stok yok. Sepeti yenileyin.',PRODUCT_UNAVAILABLE:'Ürün artık satışta değil. Sepeti yenileyin.',QUOTE_EXPIRED:'Talebin süresi doldu. Yeniden deneyin.',CHALLENGE_REJECTED:'Doğrulama başarısız. Yeniden deneyin.',IDEMPOTENCY_CONFLICT:'Bu talep doğrulanamadı. Sepeti kontrol edin.'};throw new Error(messages[data.error]||'Talep kaydedilemedi. Lütfen daha sonra tekrar deneyin.');}
  return data;
 }
 root.CDCheckout=Object.freeze({create});
})(window);
