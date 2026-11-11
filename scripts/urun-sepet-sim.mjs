// Ürün sayfasındaki "Sepete ekle" işleyicisini tanımsız değişkene karşı çalıştırır. Ağa ve canlıya dokunmaz.
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../urun.html', import.meta.url), 'utf8');
const m = html.match(/addBtn\.onclick = \(\)=>\{([\s\S]*?)\n  \};/);
if(!m){ console.error('FAIL: sepete ekle isleyicisi bulunamadi'); process.exit(1); }
let saved = null, toasts = 0;
const run = new Function('out','loadCart','saveCart','refreshCartBadge','toast','addBtn','p','outlet','images','explicitShipping','setTimeout', m[1]);
try {
  run(false, () => [], c => { saved = c; }, () => {}, () => { toasts++; }, {}, { id: 7, ad: 'Deneme', stok: 2, max_stok: 5, kondisyon: 'Sıfır', ana_kategori: 'TEST' }, 100, ['x.jpg'], () => null, () => {});
} catch (e) { console.error('FAIL: sepete ekle hata verdi: ' + e.name + ': ' + e.message); process.exit(1); }
const ok = Array.isArray(saved) && saved.length === 1 && saved[0].id === 7 && saved[0].now === 100 && saved[0].nm === 'Deneme' && !('was' in saved[0]) && toasts === 1;
console.log(ok ? 'ALL CHECKS PASSED' : 'FAIL: sepet kaydi beklenen gibi degil');
process.exit(ok ? 0 : 1);
