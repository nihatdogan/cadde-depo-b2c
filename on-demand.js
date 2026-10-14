// Public product data only. Costs remain in admin-only tables.
(function(root){
  const isDemand = p => p?.fulfillment_mode === 'ORDER_ON_DEMAND';
  const terms = 'KDV dahil ürün fiyatı; kargo ayrıca ücretlendirilir. Montaj dahil değildir. Tedarik, teslimat ve montaj uygunluğu ödeme öncesinde teyit edilir. Talep kesin sipariş veya tahsilat değildir.';
  function message(p, id){
    return `Merhaba Cadde Depo, ${p.ad || p.nm} için sipariş talebi oluşturmak istiyorum. Bir adet ürün fiyatı: ${Number(p.outlet_fiyat ?? p.now).toLocaleString('tr-TR')}₺ (KDV dahil). ${terms}${id ? '\nTalep no: '+id : ''}`;
  }
  async function request(sb,p,number){
    // Opening synchronously avoids popup blockers after the RPC finishes.
    const popup = root.open('about:blank','_blank');
    if(popup) popup.opener=null;
    try {
      const {data,error} = await sb.rpc('create_supply_request',{p_product_id:p.id});
      if(error) throw error;
      const href=`https://wa.me/${number}?text=${encodeURIComponent(message(p,data))}`;
      if(popup) popup.location.href=href; else root.location.href=href;
      return data;
    } catch(e){
      if(popup) popup.close();
      root.alert('Talep kaydedilemedi. Lütfen WhatsApp\'tan sorun; henüz sipariş oluşturulmadı.');
      throw e;
    }
  }
  root.CDDemand={isDemand,terms,message,request};
})(window);
