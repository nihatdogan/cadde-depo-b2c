// The database checks app_metadata.role=admin; hiding controls is not authorization.
const supplyLabels={vat_rate:'Satış KDV oranı (ör. 0.20; teyit edin)',purchase_net:'Alış maliyeti (KDV hariç)',inbound:'Giriş nakliyesi',fees:'Ödeme ve kanal komisyonları',packing:'Paketleme ve operasyon',outbound_net:'Net çıkış kargo gideri (kargo gelirinden sonra)',ads:'Satışa bağlı reklam',risk:'Beklenen iade / hasar / garanti',minimum_contribution:'Kabul edilen en düşük katkı'};
const supplyStatus={pending:'Tedarik kontrolü bekliyor',unavailable:'Tedarik edilemiyor / durduruldu',confirmed:'Kesin sipariş'};
async function loadSupplyRequests(){
  const box=document.getElementById('supplyBox');
  box.textContent='Yükleniyor…';
  const {data:{user}}=await sb.auth.getUser();
  if(user?.app_metadata?.role!=='admin'){ box.textContent='Tedarik ve maliyet alanı için yetkili yönetici rolü gerekir.'; return; }
  const res=await sb.from('supply_requests').select('*, products(ad), supply_costs(*)').order('created_at',{ascending:false});
  if(res.error){box.textContent='Tedarik kayıtları yüklenemedi: '+res.error.message;return;}
  box.innerHTML=(res.data||[]).map(r=>{
    const c=r.supply_costs||{};
    const complete=Object.keys(supplyLabels).every(k=>c[k]!==null && c[k]!==undefined);
    const net=complete ? Number(r.unit_price)/(1+Number(c.vat_rate))-['purchase_net','inbound','fees','packing','outbound_net','ads','risk'].reduce((s,k)=>s+Number(c[k]),0) : null;
    const state=net===null?'Maliyet doğrulanmadı':net>0 && net>=Number(c.minimum_contribution)?'Pozitif katkı doğrulandı':'Negatif / yetersiz katkı — işlem durduruldu';
    return `<form class="order" data-supply="${esc(r.id)}"><b>${esc(r.products?.ad)} — ${fmt(r.unit_price)} × 1</b><p>${esc(supplyStatus[r.status])} · ${esc(r.id)}</p><p>${state}${net===null?'':' · '+fmt(net)}</p>
      ${Object.entries(supplyLabels).map(([k,label])=>`<label>${label}<input class="fld" name="${k}" type="number" min="0" ${k==='vat_rate'?'max="1"':''} step="0.0001" value="${esc(c[k]??'')}" required></label>`).join('')}
      <label>Tedarikçi / teklif referansı<input class="fld" name="supplier_ref" value="${esc(c.supplier_ref||'')}" required></label>
      <label>Müşteriye bildirilecek ayrı kargo bedeli (KDV dahil)<input class="fld" name="shipping_quote" type="number" min="0" step="0.01" value="${esc(r.shipping_quote??'')}" required></label>
      <label>Teslimat süresi ve koşulları<input class="fld" name="delivery_terms" value="${esc(r.delivery_terms||'')}" required></label>
      <button class="btn" type="submit">Maliyetleri ve koşulları kaydet</button>
      <button class="btn" type="button" data-action="verify">Güncel stok ve montaj uygunluğunu teyit et</button>
      <button class="btn" type="button" data-action="accept">Nihai koşullar için müşteri kabulünü kaydet</button>
      <button class="btn" type="button" data-action="finalize">Kontrol ederek kesinleştir</button>
      <button class="btn" type="button" data-action="stop">Stok yok: talebi durdur</button>
      <p>Stok teyidi: ${esc(r.supplier_checked_at||'Bekliyor')} · Müşteri kabulü: ${esc(r.customer_accepted_at||'Bekliyor')}</p>
    </form>`;
  }).join('')||'<p>Henüz talep yok.</p>';
  box.querySelectorAll('form').forEach(form=>{
    form.onsubmit=async e=>{
      e.preventDefault(); const d=new FormData(form),cost={request_id:form.dataset.supply};
      Object.keys(supplyLabels).forEach(k=>cost[k]=Number(d.get(k)));
      cost.supplier_ref=String(d.get('supplier_ref')).trim();
      const result=await sb.rpc('save_supply_costs',{p_request_id:form.dataset.supply,p_cost:cost,p_shipping:Number(d.get('shipping_quote')),p_delivery:String(d.get('delivery_terms')).trim()});
      if(result.error) alert(result.error.message); else loadSupplyRequests();
    };
    form.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{
      let res;
      if(b.dataset.action==='finalize'){
        res=await sb.rpc('finalize_supply_request',{p_request_id:form.dataset.supply});
      } else {
        const prompts={verify:'Toptancı stok teyidi ve iki duvar / montaj uygunluğu kanıt referansı:',accept:'3.619₺ ürün + ayrı kargo + teslimat + montaj hariç koşulları kabul eden müşteri yazışması referansı:',stop:'Müşteriye yapılan tedarik edilemiyor bilgilendirmesi referansı:'};
        const evidence=prompt(prompts[b.dataset.action]); if(!evidence?.trim())return;
        res=await sb.rpc('record_supply_check',{p_request_id:form.dataset.supply,p_action:b.dataset.action,p_evidence:evidence.trim()});
      }
      if(res.error)alert(res.error.message);else{loadSupplyRequests();loadOrders();}
    });
  });
}
