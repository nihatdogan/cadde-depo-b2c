// CADDE DEPO: bilgilendirme amacli, SATISA KAPALI yakinda gelecek urunleri.
// Stok/fiyat/siparis bilgisi burada bilerek tutulmaz; aktif urunler Supabase'den ayri yuklenir.
(() => {
  'use strict';
  const upcoming = [
    {
      code:'CD-003', name:'Parex Tornado Otomatik Temizlik Seti', category:'EV / YAŞAM',
      image:'https://www.parex.com.tr/wp-content/uploads/2025/08/tornado-urun-ve-kutu.png.webp',
      details:'360° dönen mop başlığı · 15 L kova · Teleskopik sap · Mikrofiber mop'
    },
    {
      code:'CD-012', name:'Arzum AR5036 Superstar Saç Düzleştirici Fırça', category:'KÜÇÜK EV ALETLERİ',
      image:'https://witcdn.arzum.com.tr/ar5036-superstar-sac-duzlestirici-firca-siyah-sac-duzlestirici-firca-arzum-ar5036-0100-1251-16-B.jpg',
      details:'140–220°C ısı ayarı · Seramik tarak dişleri · LED ekran · Otomatik kapanma'
    },
    {
      code:'CD-005', name:'Kiwi KAH-6643 Ultrasonik Hava Nemlendirici', category:'KÜÇÜK EV ALETLERİ',
      image:'https://cdn03.ciceksepeti.com/cicek/kcm79034069-1/L/kiwi-kah-6643-ultrasonik-hava-nemlendirici-kcm79034069-1-b292dbff461e49c5bc708d38639f0129.jpg',
      details:'Ultrasonik hava nemlendirme · Kiwi KAH-6643 model'
    },
    {
      code:'CD-010', name:'Fakir Kaave Mono Türk Kahvesi Makinesi', category:'KÜÇÜK EV ALETLERİ',
      image:'https://fakir.witcdn.net/kaave-mono-turk-kahvesi-makinesi-beyaz-fakir-8692-32-B.jpg',
      details:'535 W güç · 4 fincan kapasite · Taşma önleme · Sesli ve ışıklı uyarı'
    },
    {
      code:'CD-002', name:'Perilla Triplex 3 Katlı Çamaşır Kurutmalık', category:'EV / YAŞAM',
      image:'https://cdn.perilla.com.tr/urunler/camasir-kurutmalik/perilla-triblex-camasir-kurutmalik-01.png',
      details:'3 kat · 6 kanat · Katlanabilir tasarım · 16 m asma alanı'
    }
  ];
  const host = document.getElementById('urunler');
  if (!host || document.getElementById('yakinda-gelecek')) return;
  const style = document.createElement('style');
  style.textContent = `
    #yakinda-gelecek{padding:12px 0 64px}
    #yakinda-gelecek .cd-soon-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:0 0 20px}
    #yakinda-gelecek h2{font-family:'Anton',sans-serif;font-size:clamp(27px,3vw,40px);text-transform:uppercase;line-height:1}
    #yakinda-gelecek .cd-soon-note{font-size:13px;color:var(--ink-soft)}
    #yakinda-gelecek .cd-soon-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}
    #yakinda-gelecek .cd-soon-card{position:relative;min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:9px;background:var(--card);box-shadow:var(--shadow)}
    #yakinda-gelecek .cd-soon-photo{position:relative;aspect-ratio:1/1;background:#fff}
    #yakinda-gelecek .cd-soon-photo img{display:block;width:100%;height:100%;object-fit:contain;padding:12px}
    #yakinda-gelecek .cd-soon-ribbon{position:absolute;left:0;right:0;top:0;z-index:2;padding:9px 5px;text-align:center;background:var(--signal);color:#fff;font-size:11px;font-weight:800;letter-spacing:.12em;line-height:1.25}
    #yakinda-gelecek .cd-soon-body{padding:13px}
    #yakinda-gelecek .cd-soon-cat{font-size:10px;letter-spacing:.08em;color:var(--steel-2);font-weight:800;margin:0 0 6px}
    #yakinda-gelecek h3{font-size:14px;line-height:1.3;font-weight:800;min-height:56px;margin:0 0 9px}
    #yakinda-gelecek .cd-soon-details{font-size:12px;color:var(--ink-soft);line-height:1.5;margin:0 0 12px}
    #yakinda-gelecek .cd-soon-state{border-top:1px solid var(--line);padding-top:10px;font-size:11px;font-weight:700;color:var(--signal-dk)}
    @media(max-width:1100px){#yakinda-gelecek .cd-soon-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:620px){#yakinda-gelecek .cd-soon-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}#yakinda-gelecek .cd-soon-body{padding:10px}#yakinda-gelecek h3{font-size:12.5px;min-height:62px}#yakinda-gelecek .cd-soon-ribbon{font-size:10px}}
  `;
  document.head.appendChild(style);
  const section = document.createElement('section');
  section.id = 'yakinda-gelecek';
  section.setAttribute('aria-label','Yakında gelecek ürünler');
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const head = document.createElement('div');
  head.className = 'cd-soon-head';
  const h = document.createElement('h2'); h.textContent = 'Yakında Gelecek';
  const note = document.createElement('p');note.className='cd-soon-note';note.textContent='Ürünler tanıtım aşamasındadır; henüz siparişe açık değildir.';
  head.append(h,note);
  wrap.append(head);
  const grid = document.createElement('div');grid.className='cd-soon-grid';
  for (const p of upcoming) {
    const article = document.createElement('article');article.className='cd-soon-card';
    const photo = document.createElement('div');photo.className='cd-soon-photo';
    const ribbon=document.createElement('span');ribbon.className='cd-soon-ribbon';ribbon.textContent='YAKINDA GELECEK';
    const img=document.createElement('img');img.src=p.image;img.alt=p.name;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
    photo.append(ribbon,img);
    const body=document.createElement('div');body.className='cd-soon-body';
    const cat=document.createElement('div');cat.className='cd-soon-cat';cat.textContent=p.category+' · '+p.code;
    const title=document.createElement('h3');title.textContent=p.name;
    const info=document.createElement('p');info.className='cd-soon-details';info.textContent=p.details;
    const state=document.createElement('div');state.className='cd-soon-state';state.textContent='Satışa henüz açılmadı';
    body.append(cat,title,info,state);article.append(photo,body);grid.append(article);
  }
  wrap.append(grid);section.append(wrap);host.insertAdjacentElement('afterend',section);
})();