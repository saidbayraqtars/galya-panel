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

const { sorgu, calistir, islem, havuzAl, mssql } = require('./sql');
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

// --- Reçete yazma ---------------------------------------------------------
//
// Reçete iki dönemsiz kart tablosunda durur:
//
//   TBLURERECETELIST → reçete başlığı
//        IND    = reçete numarası
//        STOKNO = üretilen mamulün stok kartı
//        MIKTAR = bu reçetenin verimi (kaç birim mamul çıkıyor)
//
//   TBLURERECETE     → reçete satırları (bileşenler)
//        EVRAKNO = başlığın IND'i     ← mamulün stok IND'i DEĞİL
//        STOKNO  = bileşenin stok kartı
//        DETAY   = satır sırası
//
// Alt reçete ayrı kayıt değildir: bir bileşenin stok kartı başka bir
// başlıkta mamul olarak geçiyorsa ağaç oradan devam eder. Mamul → yarı
// mamul → yarı mamul zinciri böyle kurulur.
//
// Bu tablolar yalnızca tanım tutar; stok hareketi, envanter, maliyet ve
// muhasebe zincirine dokunmaz. Yazma işlemleri arasında en düşük riskli
// olanıdır. Yine de kilide tabidir.

async function receteBilesenBilgisi(v, firma, stokNo) {
  const r = await sorgu(
    `
    SELECT S.IND AS stokNo, S.MALINCINSI AS ad, ISNULL(S.STOKKODU,'') AS kod,
           ISNULL(S.MALIYET, 0) AS maliyet, ISNULL(S.STOKTIPI, 0) AS stokTipi,
           ISNULL(B.BIRIMADI, '') AS birim, ISNULL(B.CARPAN, 1) AS carpan
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    WHERE S.IND = @stokNo
  `,
    { stokNo: Number(stokNo) }
  );
  if (!r.length) throw new Error('Bileşen stok kartı bulunamadı.');
  return r[0];
}

// Yeni reçete başlığı. Bir mamulün reçetesi yoksa önce bu oluşturulur.
async function receteOlustur(kayit) {
  kilitKontrol();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const mamulNo = Number(kayit.mamulNo);
  if (!mamulNo) throw new Error('Mamul seçilmeli.');

  const m = await receteBilesenBilgisi(v, firma, mamulNo);

  const mevcut = await sorgu(
    `SELECT IND FROM ${kart(v, firma, 'TBLURERECETELIST')} WHERE STOKNO = @stokNo`,
    { stokNo: mamulNo }
  );
  if (mevcut.length) {
    return { tamam: true, receteNo: mevcut[0].IND, yeni: false };
  }

  const eklenen = await sorgu(
    `
    INSERT INTO ${kart(v, firma, 'TBLURERECETELIST')}
      (STOKNO, STOKKODU, MALINCINSI, BIRIM, FIYAT, KDV, KULLANICI,
       SONERISIMTARIHI, OLUSTURMATARIHI, TUTAR, ACIKLAMA, STOKTIPI,
       SATISFIYATI, MIKTAR, STANDARTSURE)
    OUTPUT INSERTED.IND AS ind
    VALUES
      (@stokNo, @kod, @ad, @birim, @fiyat, 0, @kullanici,
       GETDATE(), GETDATE(), 0, @aciklama, @stokTipi,
       0, @verim, 0)
  `,
    {
      stokNo: mamulNo,
      kod: m.kod,
      ad: m.ad,
      birim: m.birim,
      fiyat: Number(m.maliyet),
      kullanici: Number(kayit.userNo || 0),
      aciklama: kayit.aciklama || null,
      stokTipi: Number(m.stokTipi),
      verim: Number(kayit.verim || 1)
    }
  );

  await panel.kayit(
    'Reçete',
    'Yeni reçete başlığı oluşturuldu',
    { firma, mamulNo, ad: m.ad, receteNo: eklenen[0].ind },
    kayit.kullanici
  );

  return { tamam: true, receteNo: eklenen[0].ind, yeni: true };
}

async function receteSatiriEkle(kayit) {
  kilitKontrol();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const bilesenNo = Number(kayit.stokNo);
  if (!bilesenNo) throw new Error('Bileşen seçilmeli.');
  if (!(Number(kayit.miktar) > 0)) throw new Error('Miktar sıfırdan büyük olmalı.');

  // Reçete numarası verilmediyse mamulden başlık üret/bul.
  let receteNo = Number(kayit.receteNo || 0);
  if (!receteNo) {
    if (!kayit.mamulNo) throw new Error('Reçete ya da mamul belirtilmeli.');
    const bas = await receteOlustur(kayit);
    receteNo = bas.receteNo;
  }

  const basliklar = await sorgu(
    `SELECT IND, STOKNO, ISNULL(MALINCINSI,'') AS ad
     FROM ${kart(v, firma, 'TBLURERECETELIST')} WHERE IND = @receteNo`,
    { receteNo }
  );
  if (!basliklar.length) throw new Error('Reçete başlığı bulunamadı.');
  const mamulStokNo = Number(basliklar[0].STOKNO);

  if (mamulStokNo === bilesenNo) {
    throw new Error('Bir mamul kendi reçetesine bileşen olarak eklenemez.');
  }

  // Döngü kontrolü: bileşenin ağacında mamulün kendisi geçiyorsa sonsuz döngü olur.
  await dongruKontrol(v, firma, bilesenNo, mamulStokNo);

  const mevcut = await sorgu(
    `SELECT COUNT(*) AS adet FROM ${kart(v, firma, 'TBLURERECETE')}
     WHERE EVRAKNO = @receteNo AND STOKNO = @bilesen`,
    { receteNo, bilesen: bilesenNo }
  );
  if (mevcut[0].adet > 0) {
    throw new Error('Bu bileşen reçetede zaten var. Miktarını değiştirmek için satırı düzenleyin.');
  }

  const b = await receteBilesenBilgisi(v, firma, bilesenNo);
  const siraR = await sorgu(
    `SELECT ISNULL(MAX(DETAY), -1) + 1 AS sira FROM ${kart(v, firma, 'TBLURERECETE')}
     WHERE EVRAKNO = @receteNo`,
    { receteNo }
  );
  const sira = siraR[0].sira;

  const eklenen = await sorgu(
    `
    INSERT INTO ${kart(v, firma, 'TBLURERECETE')}
      (DETAY, EVRAKNO, STOKNO, STOKKODU, MALINCINSI, MIKTAR, BIRIM, BIRIMMIKTAR,
       KDV, FIYAT, ISLEMTARIHI, SONERISIMTARIHI, KULLANICI, ORAN, TUR, DEPONO,
       ACIKLAMA, MALIYETTURU, MIKTARTURU, POZISYONNO, CIKISPOZISYONNO,
       FIREORANI, ARACLINENO, VARSAYILANBIRIMADI, VARSAYILANBIRIMCARPAN,
       DEPOCIKISMIKTARI, STOKTURU, RANDIMAN)
    OUTPUT INSERTED.IND AS ind
    VALUES
      (@sira, @receteNo, @bilesen, @kod, @ad, @miktar, @birim, @carpan,
       0, @fiyat, GETDATE(), GETDATE(), @kullanici, 0, 0, @depo,
       @aciklama, 0, 0, 0, 0,
       @fire, 0, @birim, @carpan,
       @miktar, @stokTipi, @randiman)
  `,
    {
      sira,
      receteNo,
      bilesen: bilesenNo,
      kod: b.kod,
      ad: b.ad,
      miktar: Number(kayit.miktar),
      birim: kayit.birim || b.birim,
      carpan: Number(b.carpan) || 1,
      fiyat: Number(b.maliyet),
      kullanici: Number(kayit.userNo || 0),
      depo: Number(kayit.depo != null ? kayit.depo : ayarOku().varsayilanDepo) || 0,
      aciklama: (kayit.aciklama || '').substring(0, 100) || null,
      fire: Number(kayit.fireOrani || 0),
      stokTipi: Number(b.stokTipi),
      randiman: Number(kayit.randiman || 0)
    }
  );

  await panel.kayit(
    'Reçete',
    'Reçeteye bileşen eklendi',
    { firma, receteNo, mamulStokNo, bilesenNo, ad: b.ad, miktar: kayit.miktar, ind: eklenen[0].ind },
    kayit.kullanici
  );

  return { tamam: true, ind: eklenen[0].ind, receteNo, sira };
}

// Bileşenin reçete ağacında mamulün kendisi geçiyor mu? Geçiyorsa döngü olur.
// Ağaç: stok → (o stoğu üreten başlık) → satırları → her satırın stoğu → …
async function dongruKontrol(v, firma, bilesenStokNo, arananStokNo, seviye, gorulen) {
  seviye = seviye || 0;
  gorulen = gorulen || new Set();
  const no = Number(bilesenStokNo);
  if (seviye > 10 || gorulen.has(no)) return;
  gorulen.add(no);

  if (no === Number(arananStokNo)) {
    throw new Error(
      'Bu bileşen eklenirse reçete kendi kendini içerir (döngü oluşur). ' +
      'Bileşenin reçetesinde bu mamul zaten kullanılıyor.'
    );
  }

  const altlar = await sorgu(
    `SELECT R.STOKNO
     FROM ${kart(v, firma, 'TBLURERECETELIST')} L
     JOIN ${kart(v, firma, 'TBLURERECETE')} R ON R.EVRAKNO = L.IND
     WHERE L.STOKNO = @no`,
    { no }
  );
  for (const a of altlar) {
    await dongruKontrol(v, firma, a.STOKNO, arananStokNo, seviye + 1, gorulen);
  }
}

async function receteSatiriGuncelle(kayit) {
  kilitKontrol();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  if (!(Number(kayit.miktar) > 0)) throw new Error('Miktar sıfırdan büyük olmalı.');

  const oncesi = await sorgu(
    `SELECT IND, EVRAKNO, STOKNO, MALINCINSI, MIKTAR, BIRIM, FIREORANI, RANDIMAN
     FROM ${kart(v, firma, 'TBLURERECETE')} WHERE IND = @ind`,
    { ind: Number(kayit.ind) }
  );
  if (!oncesi.length) throw new Error('Reçete satırı bulunamadı.');

  await calistir(
    `
    UPDATE ${kart(v, firma, 'TBLURERECETE')}
    SET MIKTAR = @miktar,
        DEPOCIKISMIKTARI = @miktar,
        BIRIM = @birim,
        VARSAYILANBIRIMADI = @birim,
        FIREORANI = @fire,
        RANDIMAN = @randiman,
        SONERISIMTARIHI = GETDATE(),
        KULLANICI = @kullanici
    WHERE IND = @ind
  `,
    {
      ind: Number(kayit.ind),
      miktar: Number(kayit.miktar),
      birim: kayit.birim || oncesi[0].BIRIM || '',
      fire: Number(kayit.fireOrani || 0),
      randiman: Number(kayit.randiman || 0),
      kullanici: Number(kayit.userNo || 0)
    }
  );

  await panel.kayit(
    'Reçete',
    'Reçete satırı güncellendi',
    {
      firma,
      ind: Number(kayit.ind),
      mamulNo: oncesi[0].EVRAKNO,
      ad: oncesi[0].MALINCINSI,
      onceki: { miktar: oncesi[0].MIKTAR, birim: oncesi[0].BIRIM, fire: oncesi[0].FIREORANI },
      yeni: { miktar: Number(kayit.miktar), birim: kayit.birim, fire: Number(kayit.fireOrani || 0) }
    },
    kayit.kullanici
  );

  return { tamam: true };
}

async function receteSatiriSil(kayit) {
  kilitKontrol();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();

  const oncesi = await sorgu(
    `SELECT IND, EVRAKNO, STOKNO, MALINCINSI, MIKTAR, BIRIM, FIREORANI
     FROM ${kart(v, firma, 'TBLURERECETE')} WHERE IND = @ind`,
    { ind: Number(kayit.ind) }
  );
  if (!oncesi.length) throw new Error('Reçete satırı bulunamadı.');

  await calistir(
    `DELETE FROM ${kart(v, firma, 'TBLURERECETE')} WHERE IND = @ind`,
    { ind: Number(kayit.ind) }
  );

  await panel.kayit(
    'Reçete',
    'Reçete satırı silindi',
    { firma, silinen: oncesi[0] },
    kayit.kullanici
  );

  return { tamam: true, silinen: oncesi[0] };
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
//
// Örnek: 10 cl Gordon's gin kullanıldığı hâlde sistemde başka bir gin
// düşülmüşse, yanlış üründen 10 cl çıkış + doğru üründen 10 cl giriş yapılır.
//
// Vega'nın kendi fişlerinden çıkarılan yazım deseni (bkz. kurulum/BELGE-DESENI.md):
//   1) TBLSTK{CIK|GIR}BASLIK  → IND kimliği, belge kimliği
//   2) TBLSTK{CIK|GIR}HAREKET → EVRAKNO = başlık IND, IND = satır kimliği
//   3) TBLSTOKHAREKETLERI     → LN = satır IND, BELGENO = başlık IND,
//                               EVRAKNO = belge numarası metni, IZAHAT = belge tipi
//   4) TBLDEPOENVANTER        → BELGEIND = başlık IND, HAREKETIND = satır IND
//
// Dört tablonun IND alanı da IDENTITY; numarayı SQL Server üretiyor.
// Hepsi tek bir işlem içinde yazılır: bir adım hata verirse yarım belge kalmaz.

const CIKIS_BELGE_TIPI = 33; // Stok çıkış fişi (elle girilen)
const GIRIS_BELGE_TIPI = 32; // Stok giriş fişi (elle girilen)
const BELGE_ONEKI = 'A';     // Vega elle girilen fişlerde A öneki kullanıyor

// Elle girilen fişlerin numarası A0000001 biçiminde ilerliyor.
async function siradakiBelgeNo(t, tabloAdi) {
  const r = await t.sorgu(
    `SELECT MAX(CAST(SUBSTRING(BELGENO, 2, 20) AS INT)) AS sonNo
     FROM ${tabloAdi}
     WHERE BELGENO LIKE @desen AND ISNUMERIC(SUBSTRING(BELGENO, 2, 20)) = 1`,
    { desen: BELGE_ONEKI + '%' }
  );
  const sonraki = (r[0] && r[0].sonNo ? Number(r[0].sonNo) : 0) + 1;
  return BELGE_ONEKI + String(sonraki).padStart(7, '0');
}

// Tek yönlü fiş: bir üründen düşer ya da bir ürüne ekler.
async function fisYaz(t, ayrinti) {
  const { v, firma, donem, cikis, stokNo, stokAdi, miktar, depo, birim, birimEx,
          maliyet, aciklama, userNo } = ayrinti;

  const baslikTablosu = tablo(v, firma, donem, cikis ? 'TBLSTKCIKBASLIK' : 'TBLSTKGIRBASLIK');
  const hareketTablosu = tablo(v, firma, donem, cikis ? 'TBLSTKCIKHAREKET' : 'TBLSTKGIRHAREKET');
  const belgeTipi = cikis ? CIKIS_BELGE_TIPI : GIRIS_BELGE_TIPI;
  const belgeNo = await siradakiBelgeNo(t, baslikTablosu);
  const tutar = Number(miktar) * Number(maliyet || 0);

  const baslik = await t.sorgu(
    `
    INSERT INTO ${baslikTablosu}
      (BELGENO, TARIH, HAREKETDEPOSU, DEPO, BELGETIPI, EKBELGETIPI,
       ENVANTERUPDATE, SUCCESS, STOKHAREKETEYAZ, CARIHAREKETEYAZ,
       FIRMANO, USERNO, KAYNAK, TUTAR, ARATOPLAM, KDV, IPTAL, IADE,
       CONVERTED, GIRIS, PARABIRIMI, KUR, ALTNOT, CREDATE, LADATE)
    OUTPUT INSERTED.IND AS ind
    VALUES
      (@belgeNo, @tarih, @depo, @depo, @belgeTipi, 0,
       1, 1, 1, 0,
       0, @userNo, 0, @tutar, @tutar, 0, 0, 0,
       0, @giris, 'TL', 1, @aciklama, GETDATE(), GETDATE())
  `,
    {
      belgeNo,
      tarih: new Date(),
      depo: Number(depo),
      belgeTipi,
      userNo: Number(userNo || 0),
      tutar,
      giris: cikis ? 0 : 1,
      aciklama: aciklama || null
    }
  );
  const baslikInd = baslik[0].ind;

  const satir = await t.sorgu(
    `
    INSERT INTO ${hareketTablosu}
      (TARIH, DETAY, EVRAKNO, FIRMANO, STOKNO, MALINCINSI, MIKTAR, BIRIMMIKTAR,
       BIRIM, BIRIMEX, KDV, KDVTUTARI, AFIYATI, FIYATI, GERCEKTOPLAM,
       DEPO, ENVANTER, PARABIRIMI, KUR, ACIKLAMA)
    OUTPUT INSERTED.IND AS ind
    VALUES
      (@tarih, 0, @baslikInd, 0, @stokNo, @stokAdi, @miktar, 1,
       @birim, @birimEx, 0, 0, @maliyet, @maliyet, @tutar,
       @depo, @miktar, 'TL', 1, @aciklama)
  `,
    {
      tarih: new Date(),
      baslikInd,
      stokNo: Number(stokNo),
      stokAdi: stokAdi || '',
      miktar: Number(miktar),
      birim: birim || '',
      birimEx: birimEx != null ? Number(birimEx) : 0,
      maliyet: Number(maliyet || 0),
      tutar,
      depo: Number(depo),
      aciklama: aciklama || null
    }
  );
  const satirInd = satir[0].ind;

  await t.calistir(
    `
    INSERT INTO ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')}
      (EVRAKNO, IZAHAT, TARIH, GIREN, CIKAN, KALAN, TUTAR, FIRMANO, STOKNO,
       BELGENO, LN, DEPO, KDV, IADE, BIRIMFIYAT, BIRIMMALIYET,
       SIRALAMATARIHI, SIRALAMATARIHIEX, KUR, PARABIRIMI, BIRIMEX, ACIKLAMA)
    VALUES
      (@belgeNo, @izahat, @tarih, @giren, @cikan, 0, @tutar, 0, @stokNo,
       @baslikInd, @satirInd, @depo, 0, 0, @maliyet, @maliyet,
       @tarih, CONVERT(FLOAT, GETDATE()), 1, 'TL', @birimEx, @aciklama)
  `,
    {
      belgeNo,
      izahat: belgeTipi,
      tarih: new Date(),
      giren: cikis ? 0 : Number(miktar),
      cikan: cikis ? Number(miktar) : 0,
      tutar,
      stokNo: Number(stokNo),
      baslikInd,
      satirInd,
      depo: Number(depo),
      maliyet: Number(maliyet || 0),
      birimEx: birimEx != null ? Number(birimEx) : 0,
      aciklama: aciklama || null
    }
  );

  await t.calistir(
    `
    INSERT INTO ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
      (TARIH, STOKNO, DEPO, ENVANTER, BELGETIPI, BELGEIND, HAREKETIND,
       SIRALAMATARIHI, SIRALAMATARIHIEX, ACIKLAMA)
    VALUES
      (@tarih, @stokNo, @depo, @envanter, @belgeTipi, @baslikInd, @satirInd,
       @tarih, CONVERT(FLOAT, GETDATE()), @aciklama)
  `,
    {
      tarih: new Date(),
      stokNo: Number(stokNo),
      depo: Number(depo),
      envanter: cikis ? -Number(miktar) : Number(miktar),
      belgeTipi,
      baslikInd,
      satirInd,
      aciklama: aciklama || null
    }
  );

  return { belgeNo, baslikInd, satirInd, belgeTipi };
}

async function tutanakFisiYaz(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const depo = Number(kayit.depo != null ? kayit.depo : ayarOku().varsayilanDepo) || 0;
  if (!depo) {
    throw new Error('Tutanak için tek bir depo seçilmelidir. Üst çubuktan depo seçin.');
  }
  if (Number(kayit.dusenStokNo) === Number(kayit.artanStokNo)) {
    throw new Error('Aynı ürün hem düşülüp hem artırılamaz.');
  }
  if (!(Number(kayit.dusenMiktar) > 0) || !(Number(kayit.artanMiktar) > 0)) {
    throw new Error('Miktarlar sıfırdan büyük olmalı.');
  }

  // Stok kartlarının güncel bilgisi (birim ve maliyet fişe yazılıyor)
  const kartlar = await sorgu(
    `
    SELECT S.IND AS stokNo, S.MALINCINSI AS ad, ISNULL(S.MALIYET, 0) AS maliyet,
           ISNULL(B.BIRIMADI, '') AS birim, ISNULL(B.IND, 0) AS birimEx
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    WHERE S.IND IN (@dusen, @artan)
  `,
    { dusen: Number(kayit.dusenStokNo), artan: Number(kayit.artanStokNo) }
  );
  const dusenKart = kartlar.find((k) => k.stokNo === Number(kayit.dusenStokNo));
  const artanKart = kartlar.find((k) => k.stokNo === Number(kayit.artanStokNo));
  if (!dusenKart || !artanKart) throw new Error('Stok kartlarından biri bulunamadı.');

  const aciklama = ('Galya Panel tutanak' + (kayit.sebep ? ' - ' + kayit.sebep : '')).substring(0, 100);

  const sonuc = await islem(async (t) => {
    const cikisFisi = await fisYaz(t, {
      v, firma, donem, cikis: true, depo, aciklama,
      stokNo: dusenKart.stokNo,
      stokAdi: dusenKart.ad,
      miktar: Number(kayit.dusenMiktar),
      birim: dusenKart.birim,
      birimEx: dusenKart.birimEx,
      maliyet: dusenKart.maliyet,
      userNo: kayit.userNo
    });
    const girisFisi = await fisYaz(t, {
      v, firma, donem, cikis: false, depo, aciklama,
      stokNo: artanKart.stokNo,
      stokAdi: artanKart.ad,
      miktar: Number(kayit.artanMiktar),
      birim: artanKart.birim,
      birimEx: artanKart.birimEx,
      maliyet: artanKart.maliyet,
      userNo: kayit.userNo
    });
    return { cikisFisi, girisFisi };
  });

  await panel.kayit(
    'Tutanak',
    "Tutanak Vega'ya yazıldı",
    {
      tutanakId: kayit.tutanakId || null,
      firma,
      donem,
      depo,
      dusen: { stokNo: dusenKart.stokNo, ad: dusenKart.ad, miktar: Number(kayit.dusenMiktar) },
      artan: { stokNo: artanKart.stokNo, ad: artanKart.ad, miktar: Number(kayit.artanMiktar) },
      cikisFisi: sonuc.cikisFisi,
      girisFisi: sonuc.girisFisi
    },
    kayit.kullanici
  );

  if (kayit.tutanakId) {
    await calistir(
      `UPDATE [${panel.p()}].dbo.Tutanak
       SET VegayaYazildi = 1, VegaBelgeNo = @belgeNo, VegaFisler = @fisler
       WHERE Id = @id`,
      {
        id: Number(kayit.tutanakId),
        belgeNo: `${sonuc.cikisFisi.belgeNo} / ${sonuc.girisFisi.belgeNo}`,
        fisler: JSON.stringify([sonuc.cikisFisi, sonuc.girisFisi])
      }
    );
  }

  return {
    tamam: true,
    cikisBelgeNo: sonuc.cikisFisi.belgeNo,
    girisBelgeNo: sonuc.girisFisi.belgeNo,
    fisler: [sonuc.cikisFisi, sonuc.girisFisi]
  };
}

// Yazılan fiş çiftini Vega'dan tamamen siler. Dört tablodan da kaldırır.
async function tutanakFisiGeriAl(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const fisler = Array.isArray(kayit.fisler) ? kayit.fisler : [];
  if (!fisler.length) throw new Error('Geri alınacak fiş bilgisi eksik.');

  const silinen = await islem(async (t) => {
    let toplam = 0;
    for (const f of fisler) {
      const cikis = Number(f.belgeTipi) === CIKIS_BELGE_TIPI;
      const baslikTablosu = tablo(v, firma, donem, cikis ? 'TBLSTKCIKBASLIK' : 'TBLSTKGIRBASLIK');
      const hareketTablosu = tablo(v, firma, donem, cikis ? 'TBLSTKCIKHAREKET' : 'TBLSTKGIRHAREKET');

      const a = await t.calistir(
        `DELETE FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
         WHERE BELGEIND = @baslikInd AND HAREKETIND = @satirInd AND BELGETIPI = @belgeTipi`,
        { baslikInd: Number(f.baslikInd), satirInd: Number(f.satirInd), belgeTipi: Number(f.belgeTipi) }
      );
      const b = await t.calistir(
        `DELETE FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')}
         WHERE LN = @satirInd AND BELGENO = @baslikInd AND IZAHAT = @belgeTipi`,
        { satirInd: Number(f.satirInd), baslikInd: Number(f.baslikInd), belgeTipi: Number(f.belgeTipi) }
      );
      const c = await t.calistir(
        `DELETE FROM ${hareketTablosu} WHERE IND = @satirInd AND EVRAKNO = @baslikInd`,
        { satirInd: Number(f.satirInd), baslikInd: Number(f.baslikInd) }
      );
      const d = await t.calistir(
        `DELETE FROM ${baslikTablosu} WHERE IND = @baslikInd`,
        { baslikInd: Number(f.baslikInd) }
      );
      toplam += (a[0] || 0) + (b[0] || 0) + (c[0] || 0) + (d[0] || 0);
    }
    return toplam;
  });

  await panel.kayit('Tutanak', "Vega'ya yazılan tutanak geri alındı", kayit, kayit.kullanici);

  if (kayit.tutanakId) {
    await calistir(
      `UPDATE [${panel.p()}].dbo.Tutanak
       SET VegayaYazildi = 0, VegaBelgeNo = NULL, VegaFisler = NULL WHERE Id = @id`,
      { id: Number(kayit.tutanakId) }
    );
  }

  return { tamam: true, silinenSatir: silinen };
}

module.exports = {
  yazmaAcikMi,
  kilitKontrol,
  siradakiNumara,
  kod11Yaz,
  kod11GeriAl,
  giderStokSifirla,
  giderStokSifirlamaGeriAl,
  receteOlustur,
  receteSatiriEkle,
  receteSatiriGuncelle,
  receteSatiriSil,
  sayimFisiYaz,
  tutanakFisiYaz,
  tutanakFisiGeriAl,
  CIKIS_BELGE_TIPI,
  GIRIS_BELGE_TIPI
};
