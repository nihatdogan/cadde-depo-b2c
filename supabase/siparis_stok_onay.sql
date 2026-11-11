-- Repo kaydı. Bu migration production Supabase'e uygulanmış kopyadır.
-- supabase/ .vercelignore ile deploy dışı kalır. Bu dosya buradan yeniden çalıştırılmaz.

-- =====================================================================
-- CADDE DEPO — stok_onay_migration (adım 2, production'a uygulandı)
-- Kaynak: PR #2 release/production/30_ADMIN_RPC_REVIEW_ONLY.sql + 10_EXPAND_SCHEMA,
--         canlı şemaya (orders/order_items/products, siparis_olustur) göre sadeleştirildi.
--
-- Ne yapar:
--  1. public.orders.stok_rezerve (boolean) ekler. Mevcut siparişler NULL (= bilinmiyor)
--     kalır; yeni siparişler DEFAULT false alır. siparis_olustur DEĞİŞMEZ.
--  2. public.siparis_durum_log: değişmez durum/stok hareket günlüğü. RLS açık,
--     anon erişimi yok, sadece admin okur; yazma yalnız aşağıdaki fonksiyonlarla.
--  3. public.siparis_durum_degistir(uuid, text): admin-only SECURITY DEFINER.
--     Stok tutan durumlar: onaylandi, kargolandi, teslim.
--     Stok tutmayan durumlar: whatsapp_bekliyor, iptal.
--       - stok_rezerve=false iken stok tutan bir duruma geçiş: ürün satırları id
--         sırasıyla FOR UPDATE kilitlenir, her kalem için stok>=adet kontrol edilir
--         (biri yetmezse hiçbir şey değişmez), stok düşülür, stok_rezerve=true.
--       - stok_rezerve=true iken stok tutmayan bir duruma geçiş (iptal / beklemeye
--         geri alma): stok iade edilir, stok_rezerve=false. max_stok aşılırsa işlem
--         reddedilir (sessizce kırpılmaz).
--       - stok tutan → stok tutan (onaylandi→kargolandi→teslim): stok hareketi yok,
--         çift düşüm olmaz.
--       - stok_rezerve NULL (eski sipariş) iken stok etkileyen geçişler reddedilir.
--  4. public.siparis_stok_esle(uuid, boolean): eski (NULL) siparişleri bir kez
--     true/false olarak işaretlemek için admin-only yardımcı; stoğa dokunmaz.
--  5. EXECUTE: yalnız authenticated (içeride admin JWT kontrolü). PUBLIC/anon kapalı.
--
-- BİLİNÇLİ OLARAK YAPILMAYANLAR (adım 3):
--  - orders üzerindeki auth_update_orders (admin doğrudan UPDATE) politikası
--    KALDIRILMADI. Bu kaldırılana kadar admin.html'deki açılır menü
--    (sb.from('orders').update({durum})) durumu stok hareketi OLMADAN değiştirebilir
--    ve stok_rezerve sütununu da doğrudan yazabilir. Adım 3: admin.html bu RPC'ye
--    geçer, ardından orders UPDATE yetkisi/politikası kapatılır.
--
-- Supabase apply_migration bu dosyayı tek transaction içinde çalıştırır.
-- Elle çalıştırılacaksa BEGIN; ... COMMIT; içine alın. Tekrar çalıştırılabilir.
-- =====================================================================

-- 1) Şema: stok_rezerve ------------------------------------------------
-- DİKKAT: ADD COLUMN ... DEFAULT false TEK ADIMDA YAZILMAZ; yazılırsa mevcut
-- satırlar false ile doldurulur. İki adım: önce default'suz ekle (mevcutlar NULL),
-- sonra default'u ayarla (yalnız yeni satırlar).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stok_rezerve boolean;
ALTER TABLE public.orders ALTER COLUMN stok_rezerve SET DEFAULT false;
COMMENT ON COLUMN public.orders.stok_rezerve IS
  'true: bu siparişin stoğu düşüldü; false: düşülmedi; NULL: eski sipariş, bilinmiyor (siparis_stok_esle ile işaretlenmeli).';

-- 2) Günlük tablosu --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.siparis_durum_log (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  siparis_id         uuid        NOT NULL,
  yapan              uuid        NOT NULL,
  islem              text        NOT NULL CHECK (islem IN ('durum','degismedi','esleme')),
  eski_durum         text,
  yeni_durum         text        NOT NULL,
  stok_rezerve_once  boolean,
  stok_rezerve_sonra boolean,
  stok_hareketleri   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS siparis_durum_log_siparis_idx
  ON public.siparis_durum_log (siparis_id, created_at DESC);
ALTER TABLE public.siparis_durum_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.siparis_durum_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.siparis_durum_log TO authenticated;
REVOKE ALL ON SEQUENCE public.siparis_durum_log_id_seq FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS siparis_durum_log_admin_read ON public.siparis_durum_log;
CREATE POLICY siparis_durum_log_admin_read ON public.siparis_durum_log
  FOR SELECT TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

-- 3) Durum değiştirme + stok ---------------------------------------------
CREATE OR REPLACE FUNCTION public.siparis_durum_degistir(p_siparis_id uuid, p_yeni_durum text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor        uuid;
  v_order        public.orders%ROWTYPE;
  v_eski_stoklu  boolean;
  v_yeni_stoklu  boolean;
  v_yon          integer := 0;     -- -1: stok düş, +1: stok iade, 0: hareket yok
  v_rezerve_yeni boolean;
  v_hareket      jsonb := '[]'::jsonb;
  v_kalem        record;
  v_urun         record;
BEGIN
  v_actor := (SELECT auth.uid());
  IF v_actor IS NULL
     OR coalesce((SELECT auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir.' USING ERRCODE = '42501';
  END IF;

  IF p_siparis_id IS NULL OR p_yeni_durum IS NULL OR p_yeni_durum NOT IN
     ('whatsapp_bekliyor','onaylandi','kargolandi','teslim','iptal') THEN
    RAISE EXCEPTION 'Geçersiz sipariş veya durum: %', coalesce(p_yeni_durum,'(boş)')
      USING ERRCODE = '22023';
  END IF;

  -- Sipariş satırı kilidi: aynı sipariş üzerindeki eşzamanlı işlemler sıraya girer.
  SELECT * INTO v_order FROM public.orders WHERE id = p_siparis_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sipariş bulunamadı.' USING ERRCODE = 'P0002';
  END IF;

  -- Aynı durum: idempotent, stok hareketi yok.
  IF v_order.durum = p_yeni_durum THEN
    INSERT INTO public.siparis_durum_log
      (siparis_id, yapan, islem, eski_durum, yeni_durum, stok_rezerve_once, stok_rezerve_sonra)
    VALUES (v_order.id, v_actor, 'degismedi', v_order.durum, p_yeni_durum,
            v_order.stok_rezerve, v_order.stok_rezerve);
    RETURN jsonb_build_object('id', v_order.id, 'durum', v_order.durum, 'eski_durum', v_order.durum,
      'stok_rezerve', v_order.stok_rezerve, 'degismedi', true, 'stok_hareketleri', '[]'::jsonb);
  END IF;

  v_eski_stoklu := v_order.durum  IN ('onaylandi','kargolandi','teslim');
  v_yeni_stoklu := p_yeni_durum   IN ('onaylandi','kargolandi','teslim');

  IF v_order.stok_rezerve IS NULL THEN
    -- Eski sipariş: stok geçmişi bilinmiyor. Grup değiştiren geçişler stok etkiler.
    IF v_eski_stoklu IS DISTINCT FROM v_yeni_stoklu THEN
      RAISE EXCEPTION 'Bu sipariş stok takibi başlamadan önce oluşturulmuş; stoğu etkileyen durum değişikliği yapılamaz. Önce siparişin stoğunun düşülüp düşülmediğini işaretleyin (siparis_stok_esle).'
        USING ERRCODE = '23514';
    END IF;
    v_yon := 0;
  ELSIF v_yeni_stoklu AND v_order.stok_rezerve = false THEN
    v_yon := -1;
  ELSIF NOT v_yeni_stoklu AND v_order.stok_rezerve = true THEN
    v_yon := 1;
  END IF;

  IF v_yon <> 0 THEN
    IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = v_order.id) THEN
      RAISE EXCEPTION 'Siparişin ürün satırı yok; stok işlemi yapılamaz.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = v_order.id AND product_id IS NULL) THEN
      RAISE EXCEPTION 'Sipariş satırlarından birinin ürün bağlantısı yok; stok işlemi yapılamaz.'
        USING ERRCODE = '23514';
    END IF;

    -- Ürünleri id sırasıyla kilitle (kilitlenme/deadlock'u önler), kontrol et, güncelle.
    -- Herhangi bir hata tüm transaction'ı geri alır: kısmi stok değişikliği olmaz.
    FOR v_kalem IN
      SELECT product_id, sum(adet)::integer AS adet
      FROM public.order_items WHERE order_id = v_order.id
      GROUP BY product_id ORDER BY product_id
    LOOP
      SELECT id, ad, stok, max_stok INTO v_urun
      FROM public.products WHERE id = v_kalem.product_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ürün bulunamadı (id %).', v_kalem.product_id USING ERRCODE = 'P0002';
      END IF;
      IF v_yon = -1 THEN
        IF v_urun.stok < v_kalem.adet THEN
          RAISE EXCEPTION 'Yetersiz stok: % (mevcut %, gereken %). Sipariş onaylanmadı, stok değişmedi.',
            v_urun.ad, v_urun.stok, v_kalem.adet USING ERRCODE = 'P0001';
        END IF;
        UPDATE public.products SET stok = stok - v_kalem.adet WHERE id = v_urun.id;
      ELSE
        IF v_urun.stok + v_kalem.adet > v_urun.max_stok THEN
          RAISE EXCEPTION 'Stok iadesi max_stok sınırını aşıyor: % (mevcut %, iade %, max %). Önce ürünün stok/max_stok değerini düzeltin.',
            v_urun.ad, v_urun.stok, v_kalem.adet, v_urun.max_stok USING ERRCODE = '23514';
        END IF;
        UPDATE public.products SET stok = stok + v_kalem.adet WHERE id = v_urun.id;
      END IF;
      v_hareket := v_hareket || jsonb_build_array(jsonb_build_object(
        'product_id', v_urun.id, 'degisim', v_yon * v_kalem.adet,
        'stok_once', v_urun.stok, 'stok_sonra', v_urun.stok + v_yon * v_kalem.adet));
    END LOOP;
  END IF;

  v_rezerve_yeni := CASE WHEN v_yon = -1 THEN true WHEN v_yon = 1 THEN false ELSE v_order.stok_rezerve END;

  UPDATE public.orders SET durum = p_yeni_durum, stok_rezerve = v_rezerve_yeni WHERE id = v_order.id;

  INSERT INTO public.siparis_durum_log
    (siparis_id, yapan, islem, eski_durum, yeni_durum, stok_rezerve_once, stok_rezerve_sonra, stok_hareketleri)
  VALUES (v_order.id, v_actor, 'durum', v_order.durum, p_yeni_durum,
          v_order.stok_rezerve, v_rezerve_yeni, v_hareket);

  RETURN jsonb_build_object('id', v_order.id, 'durum', p_yeni_durum, 'eski_durum', v_order.durum,
    'stok_rezerve', v_rezerve_yeni, 'degismedi', false, 'stok_hareketleri', v_hareket);
END
$function$;

-- 4) Eski siparişler için tek seferlik işaretleme -------------------------
CREATE OR REPLACE FUNCTION public.siparis_stok_esle(p_siparis_id uuid, p_stok_dusuldu boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid;
  v_order public.orders%ROWTYPE;
BEGIN
  v_actor := (SELECT auth.uid());
  IF v_actor IS NULL
     OR coalesce((SELECT auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir.' USING ERRCODE = '42501';
  END IF;
  IF p_siparis_id IS NULL OR p_stok_dusuldu IS NULL THEN
    RAISE EXCEPTION 'Sipariş ve stok bilgisi zorunludur.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_siparis_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sipariş bulunamadı.' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.stok_rezerve IS NOT NULL THEN
    RAISE EXCEPTION 'Bu siparişin stok durumu zaten belli; yeniden işaretlenemez.' USING ERRCODE = '23514';
  END IF;
  IF p_stok_dusuldu AND v_order.durum NOT IN ('onaylandi','kargolandi','teslim') THEN
    RAISE EXCEPTION 'Bekleyen veya iptal edilmiş bir sipariş "stoğu düşüldü" olarak işaretlenemez.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.orders SET stok_rezerve = p_stok_dusuldu WHERE id = v_order.id;
  INSERT INTO public.siparis_durum_log
    (siparis_id, yapan, islem, eski_durum, yeni_durum, stok_rezerve_once, stok_rezerve_sonra)
  VALUES (v_order.id, v_actor, 'esleme', v_order.durum, v_order.durum, NULL, p_stok_dusuldu);
  RETURN jsonb_build_object('id', v_order.id, 'durum', v_order.durum, 'stok_rezerve', p_stok_dusuldu);
END
$function$;

-- 5) Yetkiler ----------------------------------------------------------------
REVOKE ALL ON FUNCTION public.siparis_durum_degistir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.siparis_durum_degistir(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.siparis_stok_esle(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.siparis_stok_esle(uuid, boolean) TO authenticated;
COMMENT ON FUNCTION public.siparis_durum_degistir(uuid, text) IS
  'Admin-only. Sipariş durumunu değiştirir; onaylandi/kargolandi/teslim stok düşer, iptal/whatsapp_bekliyor stok iade eder. Her işlem siparis_durum_log''a yazılır.';
COMMENT ON FUNCTION public.siparis_stok_esle(uuid, boolean) IS
  'Admin-only. stok_rezerve NULL olan eski siparişi bir kez true/false işaretler; stoğa dokunmaz.';

-- =====================================================================
-- ROLLBACK (uygulanmaz; gerekirse ayrı onayla, tek transaction içinde çalıştırın)
-- UYARI: Fonksiyonun daha önce düşürdüğü stoklar GERİ VERİLMEZ; products.stok olduğu
-- gibi kalır. stok_rezerve ve günlük silinirse hangi siparişin stok düşürdüğü bilgisi
-- kaybolur. Gerekirse önce günlüğü dışa aktarın.
-- ---------------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.siparis_stok_esle(uuid, boolean);
-- DROP FUNCTION IF EXISTS public.siparis_durum_degistir(uuid, text);
-- DROP TABLE IF EXISTS public.siparis_durum_log;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS stok_rezerve;
-- COMMIT;
-- =====================================================================
