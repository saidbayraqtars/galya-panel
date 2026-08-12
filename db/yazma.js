'use strict';

// ================================================================
//  VEGA'YA YAZMA MODÜLÜ — VARSAYILAN OLARAK KAPALI
// ================================================================
//
// Bu dosyadaki fonksiyonlar VEGADB üzerinde kayıt oluşturur. ayarlar.json
// içindeki "vegayaYazmaAktif" değeri true yapılmadan hiçbiri çalışmaz.
//
// Açmadan önce yapılması gerekenler:
//   1. Hakan Aytaçoğlu'ndan belge yazma yönteminin teyidi
//      (ENVANTERUPDATE / STOKHAREKETEYAZ / SUCCESS bayrakları, numaralama).
//   2. Önce DEMO firmasında (F0100) denenmesi.
//   3. Yazmadan önce VEGADB'nin yedeğinin alınması.
//
// Yazma kapalıyken program tam olarak çalışmaya devam eder; sayım, tutanak
// ve eşleştirme kayıtları GALYA_PANEL veritabanında saklanır.

const { sorgu, calistir, havuzAl, mssql } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, tablo, kart } = require('./firma');
const panel = require('./panel');

function vt() {
  return ayarOku().vegaVeritabani;
}

function kilitKontrol() {
  const a = ayarOku();
  if (!a.vegayaYazmaAktif) {
    const hata = new Error(
      "Vega'ya yazma kapalı. Kayıt sadece panel veritabanında tutuldu. " +
      'Açmak için Ayarlar ekranındaki "Vega\'ya yazma" kilidini kaldırın.'
    );
    hata.kod = 'YAZMA_KAPALI';
    throw hata;
  }
}

function yazmaAcikMi() {
  return !!ayarOku().vegayaYazmaAktif;
}

// Vega'nın kendi numara üreticisi. Kart/belge numarası bu procedure'den alınır.
async function siradakiNumara(firmaKodu, ad) {
  const v = vt();
  const procAdi = `[${v}].dbo.sp_${firmaKodu}getKartSequence`;
  const h = await havuzAl();
  const istek = h.request();
  istek.input('name', mssql.NVarChar(128), ad);
  const sonuc = await istek.execute(procAdi);
  return sonuc.returnValue;
}

// --- Özel Kod 11 (THIRD) yazma -------------------------------------------
// En dar kapsamlı yazma işlemi: sadece stok kartındaki bir metin alanını
// günceller, hiçbir hareket veya envanter etkilenmez. İlk denenecek işlem budur.
async function kod11Yaz(kayit) {
  kilitKontrol();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const deger = kayit.deger != null ? String(kayit.deger) : 'THIRD';

  const oncesi = await sorgu(
    `SELECT IND, MALINCINSI, ISNULL(KOD11,'') AS kod11
     FROM ${kart(v, firma, 'TBLSTOKLAR')} WHERE IND = @stokNo`,
    { stokNo: Number(kayit.stokNo) }
  );
  if (!oncesi.length) throw new Error('Stok kartı bulunamadı.');

  await calistir(
    `UPDATE ${kart(v, firma, 'TBLSTOKLAR')}
     SET KOD11 = @deger, GUNCELLEMETARIHI = GETDATE()
     WHERE IND = @stokNo`,
    { deger, stokNo: Number(kayit.stokNo) }
  );

  await panel.kayit(
    'THIRD',
    "Vega'ya KOD11 yazıldı",
    { stokNo: kayit.stokNo, oncekiDeger: oncesi[0].kod11, yeniDeger: deger },
    kayit.kullanici
  );

  await calistir(
    `UPDATE [${panel.p()}].dbo.ThirdIsaret SET VegayaYazildi = 1
     WHERE Firma = @firma AND StokNo = @stokNo`,
    { firma, stokNo: Number(kayit.stokNo) }
  );

  return { tamam: true, oncekiDeger: oncesi[0].kod11 };
}

async function kod11GeriAl(kayit) {
  kilitKontrol();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  await calistir(
    `UPDATE ${kart(v, firma, 'TBLSTOKLAR')}
     SET KOD11 = @deger WHERE IND = @stokNo`,
    { deger: kayit.oncekiDeger || '', stokNo: Number(kayit.stokNo) }
  );
  await panel.kayit('THIRD', 'KOD11 geri alındı', kayit, kayit.kullanici);
  return { tamam: true };
}

// --- Gider / hizmet stoğunu sıfırlama -------------------------------------
//
// Elektrik, su, nakliye gibi gider-hizmet kartlarının (STOKTIPI = 3) stok
// miktarı olmaması gerekir; Vega bunlarda miktarı elle sıfırlatmadığı için
// faturalardan birikmiş bakiye kalıyor.
//
// Yöntem: miktar TBLDEPOENVANTER satırlarının toplamından geliyor. Kalanı
// kapatan tek bir denge satırı ekliyoruz — sayım fişinin yaptığının aynısı,
// ama belge oluşturmadan. Belge tablolarında Vega'nın "GK" adında bir
// doğrulama alanı var ve nasıl üretildiği bilinmiyor; elle belge yazmak yerine
// dokunmadığımız bu yolu seçtik.
//
// Etkilenmeyenler: stok hareketleri, maliyet, cari, muhasebe. Sadece depo
// envanteri değişir.
async function giderStokSifirla(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const depo = Number(kayit.depo != null ? kayit.depo : ayarOku().varsayilanDepo) || 0;
  if (!depo) {
    throw new Error('Sıfırlama için tek bir depo seçilmelidir. Üst çubuktan depo seçin.');
  }

  const stokNo = Number(kayit.stokNo);
  const kartlar = await sorgu(
    `SELECT IND, MALINCINSI AS ad, STOKTIPI AS stokTipi
     FROM ${kart(v, firma, 'TBLSTOKLAR')} WHERE IND = @stokNo`,
    { stokNo }
  );
  if (!kartlar.length) throw new Error('Stok kartı bulunamadı.');
  if (Number(kartlar[0].stokTipi) !== 3) {
    throw new Error(
      `"${kartlar[0].ad}" gider/hizmet kartı değil (stok tipi ${kartlar[0].stokTipi}). ` +
      'Bu işlem yalnızca gider ve hizmet kartlarında yapılabilir.'
    );
  }

  const mevcut = await sorgu(
    `SELECT ISNULL(SUM(ENVANTER), 0) AS kalan
     FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
     WHERE STOKNO = @stokNo AND DEPO = @depo AND BELGETIPI <> 67`,
    { stokNo, depo }
  );
  const kalan = Number(mevcut[0] ? mevcut[0].kalan : 0);
  if (kalan === 0) return { tamam: true, degisiklik: false, kalan: 0 };

  // Kalan artıysa çıkış (94), eksiyse giriş (93) yönünde denge satırı.
  const belgeTipi = kalan > 0 ? 94 : 93;
  const eklenen = await sorgu(
    `
    INSERT INTO ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
      (TARIH, STOKNO, DEPO, ENVANTER, BELGETIPI, BELGEIND, HAREKETIND,
       SIRALAMATARIHI, SIRALAMATARIHIEX, ACIKLAMA)
    OUTPUT INSERTED.IND AS ind
    VALUES
      (CAST(GETDATE() AS date), @stokNo, @depo, @envanter, @belgeTipi, 0, 0,
       GETDATE(), CONVERT(DECIMAL(28,10), GETDATE()), @aciklama)
  `,
    {
      stokNo,
      depo,
      envanter: -kalan,
      belgeTipi,
      aciklama: 'Galya Panel - gider/hizmet stok sifirlama'
    }
  );

  const envanterInd = eklenen[0] ? eklenen[0].ind : null;

  await panel.kayit(
    'Gider Stok',
    'Gider/hizmet stoğu sıfırlandı',
    {
      stokNo,
      ad: kartlar[0].ad,
      depo,
      oncekiKalan: kalan,
      eklenenMiktar: -kalan,
      envanterInd
    },
    kayit.kullanici
  );

  return { tamam: true, degisiklik: true, oncekiKalan: kalan, envanterInd };
}

// Sıfırlamayı geri alır: eklenen denge satırını siler.
async function giderStokSifirlamaGeriAl(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const ind = Number(kayit.envanterInd);
  if (!ind) throw new Error('Geri alınacak kayıt numarası eksik.');

  const etkilenen = await calistir(
    `DELETE FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
     WHERE IND = @ind AND ACIKLAMA = @aciklama`,
    { ind, aciklama: 'Galya Panel - gider/hizmet stok sifirlama' }
  );

  await panel.kayit('Gider Stok', 'Sıfırlama geri alındı', kayit, kayit.kullanici);
  return { tamam: true, silinen: etkilenen[0] || 0 };
}

// --- Sayım fişi yazma -----------------------------------------------------
// TASLAK: Aşağıdaki alan eşlemesi Hakan görüşmesinde teyit edilmeden
// kullanılmamalıdır. Sayım farkı pozitifse sayım girişi (IZAHAT 93),
// negatifse sayım çıkışı (IZAHAT 94) belgesi oluşur.
async function sayimFisiYaz(kayit) {
  kilitKontrol();
  throw new Error(
    'Sayım fişi yazma henüz açılmadı. Vega belge yazma yöntemi (belge başlığı ' +
    'alanları, ENVANTERUPDATE ve SUCCESS bayrakları, EVRAKNO üretimi) Hakan ' +
    'Aytaçoğlu ile teyit edildikten sonra bu fonksiyon tamamlanacak.'
  );
}

// --- Tutanak (stok çıkış + stok giriş fişi çifti) -------------------------
async function tutanakFisiYaz(kayit) {
  kilitKontrol();
  throw new Error(
    'Tutanak fişi yazma henüz açılmadı. Ürün değişimi Vega tarafında stok çıkış ' +
    '(IZAHAT 33) ve stok giriş (IZAHAT 32) fişi çifti olarak oluşacak; alan ' +
    'eşlemesi teyit bekliyor.'
  );
}

module.exports = {
  yazmaAcikMi,
  kilitKontrol,
  siradakiNumara,
  kod11Yaz,
  kod11GeriAl,
  giderStokSifirla,
  giderStokSifirlamaGeriAl,
  sayimFisiYaz,
  tutanakFisiYaz
};
