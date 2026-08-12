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
  sayimFisiYaz,
  tutanakFisiYaz
};
