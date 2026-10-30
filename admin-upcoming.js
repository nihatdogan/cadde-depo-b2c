// CADDE DEPO PR #3 — Preview-only management screen.
// No service-role keys, no order mutations, no Production auto-publish.
(() => {
  'use strict';
  const tabs = document.querySelector('.tabs');
  const existing = document.getElementById('tab-urunler');
  if (!tabs || !existing) return;

  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.dataset.tab = 'yakinda';
  tab.textContent = 'Yakında Gelecek';
  tabs.append(tab);

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = 'tab-yakinda';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="toolbar">
      <div><div class="sec-title" style="margin:0">Yakında Gelecek · Ürün Kataloğu</div>
      <div class="hint">Tanıtım ürünleri satışa kapalıdır. Fiyat ve stok kamuya açıklanmaz.</div></div>
      <button class="btn btn-primary btn-sm" type="button" id="u_new">+ Tanıtım ürünü</button>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th>Ürün / kod</th><th>Durum</th><th>Yayın hazırlığı</th><th>İşlemler</th></tr></thead>
      <tbody id="u_rows"><tr><td colspan="4" class="empty">Yükleniyor…</td></tr></tbody>
    </table></div>`;
  existing.insertAdjacentElement('afterend',panel);

  const modal = document.createElement('div');
  modal.className = 'overlay';
  modal.id = 'u_overlay';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="u_title">
      <div class="mhead"><b id="u_title">Tanıtım ürünü</b><button type="button" id="u_close">×</button></div>
      <form id="u_form">
        <div class="mbody">
          <div><label for="u_code">Ürün kodu</label><input class="fld mono" id="u_code" required pattern="CD-[0-9]{3}" placeholder="CD-013"></div>
          <div><label for="u_status">Tanıtım durumu</label><select class="fld" id="u_status"><option value="draft">Taslak</option><option value="upcoming">Yakında Gelecek</option></select></div>
          <div class="full"><label for="u_ad">Ürün adı</label><input class="fld" id="u_ad" required maxlength="220"></div>
          <div><label for="u_ana">Ana kategori</label><select class="fld" id="u_ana"></select></div>
          <div><label for="u_alt">Alt kategori</label><select class="fld" id="u_alt"></select></div>
          <div class="full"><label for="u_details">Kısa özellikler</label><textarea class="fld" id="u_details" rows="2" maxlength="700"></textarea></div>
          <div class="full"><label for="u_img">Ana görsel URL (https)</label><input class="fld" type="url" id="u_img" placeholder="https://…"></div>
          <div class="full"><label for="u_imgfile">Veya kendi görselini yükle (max 4 MB)</label><input class="fld" type="file" id="u_imgfile" accept="image/jpeg,image/png,image/webp"><div class="hint">Yüklenen görsel mevcut Supabase Storage 'urunler' bucket'ına kaydedilir.</div></div>
          <div class="full"><div class="sec-title">Satışa açma hazırlığı — yalnızca doğrulanmış bilgiler</div>
            <div class="hint">Bu alanlar doldurulmadan satışa açılamaz. Taslak için boş kalabilir.</div></div>
          <div><label for="u_outlet">Satış fiyatı (₺, KDV dahil)</label><input class="fld mono" id="u_outlet" type="number" step="0.01" min="0.01"></div>
          <div><label for="u_retail">Doğrulanmış karşılaştırma fiyatı (₺)</label><input class="fld mono" id="u_retail" type="number" step="0.01" min="0.01"><div class="hint">Eski fiyat kanıtlanmıyorsa satışa geçilmez; sonraki sürümde fiyatsız referans modeli değerlendirilecek.</div></div>
          <div><label for="u_stock">Doğrulanmış satılabilir adet</label><input class="fld mono" id="u_stock" type="number" min="0" step="1"></div>
          <div><label for="u_maxstock">Lot başlangıç adedi</label><input class="fld mono" id="u_maxstock" type="number" min="1" step="1"></div>
          <div><label for="u_condition">Kondisyon</label><select class="fld" id="u_condition"><option value="">Seçilmedi</option><option>Sıfır</option><option>Seri Sonu</option><option>Açık Kutu</option></select></div>
          <div class="full"><label for="u_description">Ürün/garanti/kutu/teslimat açıklaması</label><textarea class="fld" id="u_description" rows="4"></textarea></div>
          <div class="full"><label for="u_evidence">Doğrulama belgesi / teklif referansı</label><input class="fld" id="u_evidence" placeholder="Tarih + belge / lot referansı"></div>
          <div class="full"><div id="u_checks" class="pr3-checks"></div></div>
        </div>
        <div class="mfoot"><button type="button" class="btn btn-ghost btn-sm" id="u_cancel">Vazgeç</button><button type="submit" class="btn btn-primary btn-sm" id="u_save">Kaydet (satışa açma yok)</button></div>
      </form>
    </div>`;
  document.body.append(modal);
  const css = document.createElement('style');
  css.textContent = '#u_overlay .pr3-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#u_overlay .pr3-checks label{display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:12px}#u_overlay .pr3-checks input{width:17px;height:17px}@media(max-width:600px){#u_overlay .pr3-checks{grid-template-columns:1fr}}';
  document.head.append(css);

  const $u = id => document.getElementById('u_' + id);
  const checks = {
    supplier_verified: 'Tedarikçi ve mülkiyet teyit edildi',
    cost_verified: 'Toplam maliyet ve katkı hesaplandı',
    price_verified: 'Satış ve karşılaştırma fiyatı doğrulandı',
    stock_verified: 'Fiilî stok ve müsait adet doğrulandı',
    condition_verified: 'Kondisyon / kutu içeriği doğrulandı',
    compliance_verified: 'Ürün uygunluğu ve mevzuat doğrulandı',
    shipping_verified: 'Kargo/teslimat koşulu doğrulandı',
    warranty_verified: 'Garanti ve satış sonrası yükümlülük doğrulandı'
  };
  $u('checks').innerHTML = Object.entries(checks).map(([k,v]) =>
    `<label><input type="checkbox" data-check="${k}"><span>${v}</span></label>`).join('');

  let current = null;
  let cached = [];
  let busy = false;
  function setBusy(v) { busy = v; $u('save').disabled=v; $u('save').textContent=v?'Kaydediliyor…':'Kaydet (satışa açma yok)'; }
  const val = k => $u(k).value.trim();
  const moneyOrNull = k => val(k)==='' ? null : Number(val(k));
  const intOrNull = k => val(k)==='' ? null : Number(val(k));

  function setCategory(ana,alt) {
    $u('ana').innerHTML = tree.map(x=>`<option value="${esc(x.nm)}">${esc(x.nm)}</option>`).join('');
    $u('ana').value = ana || tree[0].nm;
    const category = tree.find(x=>x.nm===$u('ana').value);
    $u('alt').innerHTML = '<option value="">—</option>' + (category?.subs||[]).map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
    $u('alt').value = alt || '';
  }
  $u('ana').addEventListener('change',()=>setCategory($u('ana').value,''));

  function openForm(p) {
    current = p || null;
    $u('form').reset();
    $u('title').textContent = p ? 'Tanıtım ürününü düzenle' : 'Yeni tanıtım ürünü';
    $u('code').value=p?.code||'';
    $u('code').disabled=!!p;
    $u('status').value=p?.status||'draft';
    $u('ad').value=p?.ad||'';
    setCategory(p?.ana_kategori,p?.alt_kategori);
    $u('details').value=p?.details||'';
    $u('img').value=p?.gorsel_url||'';
    $u('outlet').value=p?.outlet_fiyat??'';
    $u('retail').value=p?.perakende_fiyat??'';
    $u('stock').value=p?.stok??'';
    $u('maxstock').value=p?.max_stok??'';
    $u('condition').value=p?.kondisyon||'';
    $u('description').value=p?.aciklama||'';
    $u('evidence').value=p?.verification_ref||'';
    $u('checks').querySelectorAll('input[data-check]').forEach(x=>x.checked=!!p?.[x.dataset.check]);
    modal.classList.add('open');
  }
  function close() { if(!busy) modal.classList.remove('open'); }
  $u('close').onclick=close; $u('cancel').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
  $u('new').onclick=()=>openForm(null);

  async function load() {
    const body=$u('rows');
    body.innerHTML='<tr><td colspan="4" class="empty">Yükleniyor…</td></tr>';
    const {data,error}=await sb.from('upcoming_products').select('*').order('created_at',{ascending:true});
    if(error){body.innerHTML=`<tr><td colspan="4" class="empty">Yetki veya veritabanı hatası: ${esc(error.message)}</td></tr>`;return;}
    cached=data||[];
    if(!cached.length){body.innerHTML='<tr><td colspan="4" class="empty">Tanıtım ürünü yok.</td></tr>';return;}
    body.innerHTML=cached.map(p=>{
      const done=Object.keys(checks).filter(k=>p[k]).length;
      const state=p.status==='published'?'Satışta':p.status==='upcoming'?'Yakında Gelecek':'Taslak';
      return `<tr><td><b>${esc(p.ad)}</b><div class="mono">${esc(p.code)}</div></td>
        <td>${state}</td><td>${done}/8 kontrol · ${p.verification_ref?'Belge var':'Belge eksik'}</td>
        <td><div class="rowbtns">${p.status==='published'
          ? `<a href="/urun/${encodeURIComponent(p.code.toLowerCase())}" target="_blank" rel="noopener">Satıştaki ürün</a>`
          : `<button type="button" class="btn btn-ghost btn-sm" data-ue="${p.id}">Düzenle</button>
             ${p.status==='upcoming'? `<button type="button" class="btn btn-primary btn-sm" data-up="${p.id}">Satışa Aç</button>`:''}`}</div></td></tr>`;
    }).join('');
    body.querySelectorAll('[data-ue]').forEach(b=>b.onclick=()=>openForm(cached.find(p=>p.id===b.dataset.ue)));
    body.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>publish(b.dataset.up,b));
  }

  async function publish(id,btn) {
    const p=cached.find(p=>p.id===id);
    if(!p || p.status!=='upcoming')return;
    if(!confirm(p.code+' · '+p.ad+' satışa açılacak. Gerçek stok, fiyat, kalite, garanti ve kargo belgeleri doğrulandı mı?')) return;
    btn.disabled=true;
    const {data,error}=await sb.rpc('cd_publish_upcoming_product',{p_id:id});
    if(error)toast('Yayın engellendi: '+error.message,false);
    else toast('Satışa açıldı. Ürün ID: '+data);
    await load();
    btn.disabled=false;
  }

  $u('form').onsubmit=async e=>{
    e.preventDefault();
    if(busy)return;
    setBusy(true);
    try{
      let image=val('img')||null;
      const file=$u('imgfile').files[0];
      if(file){
        if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>4*1024*1024)
          throw new Error('Görsel jpg/png/webp ve en fazla 4 MB olmalıdır.');
        image=await uploadImage(file);
      }
      if(image&&!/^https:\/\//i.test(image))throw new Error('Görsel URL https:// ile başlamalı.');
      const row={
        code:val('code'),ad:val('ad'),ana_kategori:val('ana'),alt_kategori:val('alt')||null,
        details:val('details')||null,gorsel_url:image,status:val('status'),
        outlet_fiyat:moneyOrNull('outlet'),perakende_fiyat:moneyOrNull('retail'),
        stok:intOrNull('stock'),max_stok:intOrNull('maxstock'),
        kondisyon:val('condition')||null,aciklama:val('description')||null,
        verification_ref:val('evidence')||null,
        updated_at:new Date().toISOString()
      };
      $u('checks').querySelectorAll('input[data-check]').forEach(x=>row[x.dataset.check]=x.checked);
      let query=current
        ?sb.from('upcoming_products').update(row).eq('id',current.id).eq('updated_at',current.updated_at).select('id')
        :sb.from('upcoming_products').insert(row).select('id');
      const {data,error}=await query;
      if(error)throw new Error(error.message);
      if(!data?.length)throw new Error('Kayıt güncellenmedi. Başka kullanıcı değiştirmiş olabilir; yeniden yükleyin.');
      modal.classList.remove('open');
      toast('Tanıtım kaydedildi; satışa açılmadı.');
      await load();
    }catch(err){toast('Kaydedilemedi: '+err.message,false);}
    finally{setBusy(false);}
  };

  tab.onclick=()=>{
    document.querySelectorAll('.tabs .tab').forEach(x=>x.classList.toggle('active',x===tab));
    document.querySelectorAll('.panel').forEach(x=>x.hidden=(x!==panel));
    load();
  };
})();
