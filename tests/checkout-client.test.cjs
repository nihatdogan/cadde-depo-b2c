const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function fixture(){
 const store=new Map(),calls=[],modals=[];let id=0;const w={CD_PUBLIC_CONFIG:{checkout:{siteKey:'LOCAL_PUBLIC_KEY'}},crypto:{randomUUID:()=>`LOCAL-${++id}`},turnstile:{render(slot,o){setTimeout(()=>o.callback('LOCAL_TOKEN'),0);return 1;},remove(){}},fetch:async(url,options)=>{calls.push([url,options]);return Response.json({id:'SERVER_ID',items:[{name:'SERVER_NAME',unitPrice:100,quantity:2}],total:200});}};
 const document={createElement:()=>({append(){},showModal(){},close(){},remove(){},addEventListener(){}}),body:{append(m){modals.push(m);}},head:{append(){}}};
 const storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 vm.runInNewContext(fs.readFileSync('checkout-client.js','utf8'),{window:w,document,sessionStorage:storage,Date,Map});return{w,calls,store};
}
test('client canonicalizes quantities and reuses request UUID but obtains a fresh challenge per retry',async()=>{
 const {w,calls}=fixture();await w.CDCheckout.create('stock',[{id:1,quantity:1},{id:1,quantity:1}]);await w.CDCheckout.create('stock',[{id:1,quantity:2}]);
 const a=JSON.parse(calls[0][1].body),b=JSON.parse(calls[1][1].body);assert.equal(a.idempotencyKey,b.idempotencyKey);assert.deepEqual(a.items,[{id:1,quantity:2}]);assert.deepEqual(Object.keys(a).sort(),['challengeToken','idempotencyKey','items','kind']);
 await w.CDCheckout.create('stock',[{id:1,quantity:1}]);assert.notEqual(JSON.parse(calls[2][1].body).idempotencyKey,a.idempotencyKey);
});
test('missing runtime checkout config creates no request and has no legacy fallback',async()=>{
 const {w,calls}=fixture();w.CD_PUBLIC_CONFIG={};await assert.rejects(w.CDCheckout.create('stock',[{id:1,quantity:1}]),/hazır değil/);assert.equal(calls.length,0);
});
test('WhatsApp message uses server name/price/total rather than stale browser cart',async()=>{
 const html=fs.readFileSync('index.html','utf8'),code=html.slice(html.indexOf("document.getElementById('checkoutWa').onclick="),html.indexOf('// ----- WhatsApp CTA'));
 const button={},popup={location:{},close(){this.closed=true;}};const context={cart:[{id:1,nm:'FORGED',now:1}],document:{getElementById:()=>button},window:{open:()=>popup},CDCheckout:{create:async()=>({id:'SERVER',items:[{name:'TRUE_PRODUCT',quantity:1,unitPrice:100}],total:100})},fmt:n=>n+'₺',waHref:s=>s,alert(){}};
 vm.createContext(context);vm.runInContext(code,context);await button.onclick();assert.match(popup.location.href,/TRUE_PRODUCT/);assert.match(popup.location.href,/Ürün toplamı: 100₺/);assert.doesNotMatch(popup.location.href,/FORGED/);assert.equal(button.disabled,false);
 context.CDCheckout.create=async()=>{throw new Error('offline');};await button.onclick();assert.equal(popup.closed,true);
});
