'use strict';

// ================================================================
//  VEGA'YA YAZMA MODÜLÜ
// ================================================================
//
// Bu dosyadaki fonksiyonlar VEGADB üzerinde kayıt oluşturur. Hepsi
// ayarlar.json içindeki "vegayaYazmaAktif" bayrağına tabidir; bayrak
// false yapılırsa tek satır yazılmaz.
//
// Bayrak deneme aşamasında varsayılan olarak AÇIK. İkinci bir emniyet
// SQL tarafındadır: kurulum/sql-kullanici-olustur.sql ile açılan
// galya_panel kullanıcısı VEGADB üzerinde salt okunurdur, yalnızca
// GALYA_PANEL'de db_owner'dır. Yani canlıda yazabilmek için ayrıca yetki
// verilmesi gerekir.
//
// Canlı kuruluma dağıtmadan önce:
//   1. Bütün yazma işlemlerinin GALYA_TEST üzerinde geçtiğinin görülmesi
//      (node kurulum/test-yazma.js).
//   2. Üretim fişi ve alış faturasının canlıda tek örnekle denenmesi.
//   3. VEGADB yedeğinin alınmış olması.
//
// Yazma kapalıyken program tam olarak çalışmaya devam eder; sayım, tutanak
// ve eşleştirme kayıtları GALYA_PANEL veritabanında saklanır.

const crypto = require('crypto');
const { sorgu, calistir, islem, havuzAl, mssql } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, tablo, kart } = require('./firma');
const panel = require('./panel');

function vt() {
  return ayarOku().vegaVeritabani;
}

// Stok kartındaki sınıf (KOD2) alanı bu değerlerdeyse ürün gerçek
// mutfak/bar stoğudur; gider sıfırlaması bunlara dokunmaz.
const KORUNAN_SINIFLAR = ['BAR', 'MUTFAK'];

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

// Vega, her belge satırına GK adında bir tam sayı yazıyor. Uzun süre "ne
// olduğu bilinmiyor" diye boş bırakıldı. Gerçek veride bakıldı: aynı stok,
// aynı miktar ve aynı fiyatla girilmiş 14 satırın 14 farklı GK'sı var; yani
// alan içerikten türeyen bir sağlama değil, satırın rastgele kimliği.
// Vega'nın kendi satırlarının tamamı dolu (21.456/21.456), bu yüzden biz de
// dolduruyoruz.
function gkUret() {
  return Math.floor(Math.random() * 4294967296) - 2147483648;
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
// 22.08.2026'dan beri ekran bar ve mutfak DIŞINDAKİ bütün ürünleri de
// listeliyor; sıfırlama onlarda da çalışıyor. Bar ve mutfak sınıfı korumalı:
// o iki sınıfın stoğu yalnızca sayımla değişir.
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
    `SELECT IND, MALINCINSI AS ad, STOKTIPI AS stokTipi, ISNULL(KOD2, '') AS sinif
     FROM ${kart(v, firma, 'TBLSTOKLAR')} WHERE IND = @stokNo`,
    { stokNo }
  );
  if (!kartlar.length) throw new Error('Stok kartı bulunamadı.');

  // Kapsam denetimi. Ekran 22.08.2026'da genişledi: gider/hizmet kartlarının
  // (STOKTIPI 3) yanında bar-mutfak dışındaki bütün ürünler de sıfırlanabiliyor.
  // Buradaki denetim ARAYÜZDEN gelmiyor, kartın kendi sınıfından okunuyor —
  // istek kurcalansa bile gerçek mutfak/bar stoğu bu uçtan sıfırlanamaz.
  const sinif = String(kartlar[0].sinif || '').trim().toLocaleUpperCase('tr');
  if (Number(kartlar[0].stokTipi) !== 3 && KORUNAN_SINIFLAR.includes(sinif)) {
    throw new Error(
      `"${kartlar[0].ad}" ${sinif} sınıfında. Bar ve mutfak ürünlerinin stoğu ` +
      'bu ekrandan sıfırlanamaz; sayım yapın.'
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
//
// Vega'nın sayım fişi MUTLAK bir belge değil, FARK belgesidir. Fişteki miktar
// "sayımda şu kadar çıktı" değil, "sistemdeki miktara şu kadar eklenecek"
// demektir. Firmanın 31.07.2026 sayımı bunu doğruluyor:
//
//   Bira.Carlsberg 33 cl : öncesi -10 , fiş +10 , sonrası 0
//   TUZ                  : öncesi -11,197 , fiş +29,017 , sonrası 17,820
//
// Yani  fark = fiziki sayım - sistemdeki miktar. Artı farklar sayım GİRİŞ
// fişine (belge tipi 93), eksi farklar sayım ÇIKIŞ fişine (94) yazılır.
// Vega tek bir sayımda ikisini arka arkaya keser; program da öyle yapıyor.
//
// Tablolar ve bağlantıları (gerçek fişlerden çıkarıldı, bkz. BELGE-DESENI.md):
//   1) TBLSAYIM{GIRIS|CIKIS}BASLIK  → IND belge kimliği, BELGENO = Z0000001…
//   2) TBLSAYIM{GIRIS|CIKIS}HAREKET → EVRAKNO = başlık IND
//   3) TBLSTOKHAREKETLERI           → BELGENO = başlık IND, LN = satır IND,
//                                     EVRAKNO = belge numarası metni,
//                                     IZAHAT = 93 / 94
//   4) TBLDEPOENVANTER              → BELGEIND = başlık IND,
//                                     HAREKETIND = satır IND,
//                                     ENVANTER = +fark / -fark
//
// Çıkış fişinde Vega tutarı sıfırlıyor: FIYATI = 1 ve ISK1 = 100 (yüzde yüz
// iskonto). Giriş fişinde ise FIYATI = AFIYATI = kartın maliyeti.

const SAYIM_GIRIS_TIPI = 93;
const SAYIM_CIKIS_TIPI = 94;
const SAYIM_ONEKI = 'Z';

// Tek yönlü sayım belgesi: verilen satırların tamamı tek fişe yazılır.
async function sayimBelgesiYaz(t, ayrinti) {
  const { v, firma, donem, cikis, depo, depoAdi, satirlar, tarih, userNo, aciklama } = ayrinti;
  if (!satirlar.length) return null;

  const baslikTablosu = tablo(v, firma, donem, cikis ? 'TBLSAYIMCIKISBASLIK' : 'TBLSAYIMGIRISBASLIK');
  const hareketTablosu = tablo(v, firma, donem, cikis ? 'TBLSAYIMCIKISHAREKET' : 'TBLSAYIMGIRISHAREKET');
  const belgeTipi = cikis ? SAYIM_CIKIS_TIPI : SAYIM_GIRIS_TIPI;
  const belgeNo = await siradakiBelgeNo(t, baslikTablosu, SAYIM_ONEKI);

  // Giriş fişinde tutar görünür, çıkış fişinde Vega tutarı sıfır bırakıyor.
  const tutar = cikis
    ? 0
    : satirlar.reduce((toplam, s) => toplam + Math.abs(s.fark) * Number(s.maliyet || 0), 0);

  const baslik = await t.sorgu(
    `
    INSERT INTO ${baslikTablosu}
      (BELGENO, TARIH, ODEMETARIHI, DEPO, HAREKETDEPOSU, BELGETIPI, EKBELGETIPI,
       OZELKOD1, OZELKOD2, GIRIS, STOKHAREKETEYAZ, CARIHAREKETEYAZ,
       FIRMANO, USERNO, TUTAR, ARATOPLAM, KDV, IPTAL, IADE, CONVERTED,
       PARABIRIMI, KUR, ALTNOT, CREDATE, LADATE)
    OUTPUT INSERTED.IND AS ind
    VALUES
      (@belgeNo, @tarih, @tarih, @depo, @depo, @belgeTipi, 0,
       @depoAdi, @depoAdi, @giris, 1, 1,
       1, @userNo, @tutar, @tutar, 0, 0, 0, 0,
       'TL', 1, @aciklama, GETDATE(), GETDATE())
  `,
    {
      belgeNo,
      tarih,
      depo: Number(depo),
      belgeTipi,
      depoAdi: (depoAdi || '').substring(0, 50) || null,
      giris: cikis ? 0 : 1,
      userNo: Number(userNo || 0),
      tutar,
      aciklama: (aciklama || 'Galya Panel sayımı').substring(0, 100)
    }
  );
  const baslikInd = baslik[0].ind;

  const yazilan = [];
  for (const s of satirlar) {
    const miktar = Math.abs(Number(s.fark));
    const maliyet = Number(s.maliyet || 0);
    const satirTutari = cikis ? 0 : miktar * maliyet;

    const satir = await t.sorgu(
      `
      INSERT INTO ${hareketTablosu}
        (TARIH, DETAY, EVRAKNO, FIRMANO, STOKNO, MALINCINSI, STOKKODU, STOKTIPI,
         MIKTAR, BIRIMMIKTAR, BIRIM, BIRIMEX, KDV, KDVTUTARI, ISK1,
         AFIYATI, FIYATI, GERCEKTOPLAM, DEPO, SATISKOSULU, SERIMIKTAR, ENVANTER,
         TERMIN, PARABIRIMI, KUR, ACIKLAMA, GK)
      OUTPUT INSERTED.IND AS ind
      VALUES
        (@tarih, 0, @baslikInd, 1, @stokNo, @stokAdi, @stokKodu, @stokTipi,
         @miktar, 1, @birim, @birimEx, @kdv, 0, @isk1,
         @afiyati, @fiyati, @satirTutari, @depo, 1, 1, @miktar,
         @termin, 'TL', 1, @satirAciklama, @gk)
    `,
      {
        tarih,
        baslikInd,
        stokNo: Number(s.stokNo),
        stokAdi: (s.stokAdi || '').substring(0, 100),
        stokKodu: (s.stokKodu || '').substring(0, 50),
        stokTipi: Number(s.stokTipi || 0),
        miktar,
        birim: s.birim || '',
        birimEx: Number(s.birimEx || 0),
        kdv: Number(s.kdv || 0),
        // Çıkışta yüzde yüz iskonto: Vega böyle yapıyor, tutar sıfır kalıyor.
        isk1: cikis ? 100 : 0,
        afiyati: maliyet,
        fiyati: cikis ? 1 : maliyet,
        satirTutari,
        depo: Number(depo),
        termin: new Date(1899, 11, 30),
        satirAciklama: 'Sayım',
        gk: gkUret()
      }
    );
    const satirInd = satir[0].ind;

    await t.calistir(
      `
      INSERT INTO ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')}
        (EVRAKNO, IZAHAT, TARIH, GIREN, CIKAN, KALAN, TUTAR, FIRMANO, STOKNO,
         BELGENO, LN, DEPO, KDV, IADE, BIRIMFIYAT, BIRIMMALIYET, STOKTIPI,
         SIRALAMATARIHI, SIRALAMATARIHIEX, KUR, PARABIRIMI, BIRIMEX, ACIKLAMA)
      VALUES
        (@belgeNo, @izahat, @tarih, @giren, @cikan, 0, @satirTutari, 1, @stokNo,
         @baslikInd, @satirInd, @depo, @kdv, 0, @birimFiyat, @birimMaliyet, @stokTipi,
         GETDATE(), CONVERT(FLOAT, GETDATE()), 1, 'TL', @birimEx, 'Sayım')
    `,
      {
        belgeNo,
        izahat: String(belgeTipi),
        tarih,
        giren: cikis ? 0 : miktar,
        cikan: cikis ? miktar : 0,
        satirTutari,
        stokNo: Number(s.stokNo),
        baslikInd,
        satirInd,
        depo: Number(depo),
        kdv: Number(s.kdv || 0),
        birimFiyat: cikis ? 1 : maliyet,
        birimMaliyet: cikis ? 0 : maliyet,
        stokTipi: Number(s.stokTipi || 0),
        birimEx: Number(s.birimEx || 0)
      }
    );

    await t.calistir(
      `
      INSERT INTO ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
        (TARIH, STOKNO, DEPO, ENVANTER, BELGETIPI, BELGEIND, HAREKETIND,
         SIRALAMATARIHI, SIRALAMATARIHIEX)
      VALUES
        (@tarih, @stokNo, @depo, @envanter, @belgeTipi, @baslikInd, @satirInd,
         GETDATE(), CONVERT(FLOAT, GETDATE()))
    `,
      {
        tarih,
        stokNo: Number(s.stokNo),
        depo: Number(depo),
        envanter: cikis ? -miktar : miktar,
        belgeTipi,
        baslikInd,
        satirInd
      }
    );

    yazilan.push({ stokNo: Number(s.stokNo), stokAdi: s.stokAdi, miktar, satirInd });
  }

  return { belgeNo, baslikInd, belgeTipi, satir: yazilan.length, satirlar: yazilan };
}

// Panelde kaydedilmiş bir ara sayımı Vega'ya işler.
//
// Fark yazma anında yeniden hesaplanır. Sayım kaydedildikten sonra Şefim
// satış işlemeye devam ettiği için sayfadaki eski teorik miktarla yazmak
// stoğu yanlış yere oturtur; belirleyici olan fişin kesildiği andaki miktar.
async function sayimFisiYaz(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const p = panel.p();
  const sayimId = Number(kayit.sayimId);
  if (!sayimId) throw new Error('Sayım numarası verilmedi.');

  const basliklar = await sorgu(
    `SELECT Id AS id, Depo AS depo, Sayan AS sayan, Aciklama AS aciklama,
            VegayaYazildi AS vegayaYazildi, Iptal AS iptal
     FROM [${p}].dbo.AraSayim WHERE Id = @sayimId`,
    { sayimId }
  );
  const sayim = basliklar[0];
  if (!sayim) throw new Error('Sayım bulunamadı.');
  if (sayim.iptal) throw new Error('İptal edilmiş sayım Vega\'ya yazılamaz.');
  if (sayim.vegayaYazildi) throw new Error('Bu sayım Vega\'ya zaten yazılmış.');

  const depo = Number(sayim.depo != null ? sayim.depo : ayarOku().varsayilanDepo) || 0;
  if (!depo) {
    throw new Error('Sayım fişi için tek bir depo seçilmelidir. Üst çubuktan depo seçin.');
  }

  // Sayılan miktarlar panelden, güncel stok ve kart bilgisi Vega'dan.
  const satirlar = await sorgu(
    `
    WITH K AS (
      SELECT E.STOKNO, SUM(E.ENVANTER) AS KALAN
      FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')} E
      WHERE E.DEPO = @depo AND E.BELGETIPI <> 67
      GROUP BY E.STOKNO
    )
    SELECT
      D.StokNo               AS stokNo,
      ISNULL(S.MALINCINSI, D.StokAdi) AS stokAdi,
      ISNULL(S.STOKKODU, '') AS stokKodu,
      ISNULL(S.STOKTIPI, 0)  AS stokTipi,
      ISNULL(S.MALIYET, 0)   AS maliyet,
      ISNULL(S.KDVGRUBU, 0)  AS kdvGrubu,
      ISNULL(B.BIRIMADI, '') AS birim,
      ISNULL(B.IND, 0)       AS birimEx,
      D.SayilanMiktar        AS sayilan,
      ISNULL(K.KALAN, 0)     AS teorik
    FROM [${p}].dbo.AraSayimSatir D
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = D.StokNo
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = D.StokNo AND B.VARSAYILAN = 1
    LEFT JOIN K ON K.STOKNO = D.StokNo
    WHERE D.SayimId = @sayimId
    ORDER BY D.Id
  `,
    { sayimId, depo }
  );
  if (!satirlar.length) throw new Error('Sayımda satır yok.');

  const eksikKart = satirlar.filter((s) => !s.stokKodu && !s.stokAdi);
  if (eksikKart.length) {
    throw new Error(eksikKart.length + ' satırın stok kartı Vega\'da bulunamadı.');
  }

  // Kuruş altı farklar yuvarlama artığıdır; fiş kesmeye değmez.
  const farkli = satirlar
    .map((s) => Object.assign({}, s, { fark: Number(s.sayilan) - Number(s.teorik) }))
    .filter((s) => Math.abs(s.fark) >= 0.0001);

  if (!farkli.length) {
    return {
      tamam: true,
      yazilmadi: true,
      mesaj: 'Sayım Vega ile birebir aynı; fark olmadığı için fiş kesilmedi.'
    };
  }

  const artanlar = farkli.filter((s) => s.fark > 0);
  const azalanlar = farkli.filter((s) => s.fark < 0);
  const depolar = await sorgu(
    `SELECT DEPOADI AS ad FROM [${v}].dbo.TBLDEPOLAR WHERE IND = @depo`,
    { depo }
  );
  const depoAdi = (depolar[0] && depolar[0].ad) || '';
  const tarih = new Date();
  const aciklama = 'Galya Panel sayımı' + (sayim.aciklama ? ' - ' + sayim.aciklama : '');

  const sonuc = await islem(async (t) => {
    const girisFisi = await sayimBelgesiYaz(t, {
      v, firma, donem, cikis: false, depo, depoAdi,
      satirlar: artanlar, tarih, userNo: kayit.userNo, aciklama
    });
    const cikisFisi = await sayimBelgesiYaz(t, {
      v, firma, donem, cikis: true, depo, depoAdi,
      satirlar: azalanlar, tarih, userNo: kayit.userNo, aciklama
    });
    return { girisFisi, cikisFisi };
  });

  const belgeNolar = [
    sonuc.girisFisi && sonuc.girisFisi.belgeNo,
    sonuc.cikisFisi && sonuc.cikisFisi.belgeNo
  ].filter(Boolean).join(' / ');

  await calistir(
    `UPDATE [${p}].dbo.AraSayim
     SET VegayaYazildi = 1, VegaBelgeNo = @belgeNo, VegaFisler = @fisler
     WHERE Id = @sayimId`,
    { sayimId, belgeNo: belgeNolar.substring(0, 50), fisler: JSON.stringify(sonuc) }
  );

  await panel.kayit(
    'Ara Sayım',
    'Sayım Vega\'ya yazıldı',
    {
      sayimId, firma, donem, depo,
      artan: artanlar.length,
      azalan: azalanlar.length,
      girisFisi: sonuc.girisFisi,
      cikisFisi: sonuc.cikisFisi
    },
    kayit.kullanici
  );

  return {
    tamam: true,
    belgeNo: belgeNolar,
    girisBelgeNo: sonuc.girisFisi ? sonuc.girisFisi.belgeNo : null,
    cikisBelgeNo: sonuc.cikisFisi ? sonuc.cikisFisi.belgeNo : null,
    artan: artanlar.length,
    azalan: azalanlar.length
  };
}

// Yanlış kesilen sayım fişini geri alır: dört tablodaki satırlar da silinir,
// stok fişin kesilmesinden önceki hâline döner.
async function sayimFisiGeriAl(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const p = panel.p();
  const sayimId = Number(kayit.sayimId);

  const kayitlar = await sorgu(
    `SELECT VegaFisler AS vegaFisler, VegayaYazildi AS vegayaYazildi
     FROM [${p}].dbo.AraSayim WHERE Id = @sayimId`,
    { sayimId }
  );
  if (!kayitlar.length) throw new Error('Sayım bulunamadı.');
  if (!kayitlar[0].vegayaYazildi) throw new Error('Bu sayım Vega\'ya yazılmamış.');
  const ayrinti = JSON.parse(kayitlar[0].vegaFisler || '{}');

  const fisler = [ayrinti.girisFisi, ayrinti.cikisFisi].filter(Boolean);
  if (!fisler.length) throw new Error('Geri alınacak fiş yok.');

  await islem(async (t) => {
    for (const f of fisler) {
      const cikis = f.belgeTipi === SAYIM_CIKIS_TIPI;
      const baslikTablosu = tablo(v, firma, donem, cikis ? 'TBLSAYIMCIKISBASLIK' : 'TBLSAYIMGIRISBASLIK');
      const hareketTablosu = tablo(v, firma, donem, cikis ? 'TBLSAYIMCIKISHAREKET' : 'TBLSAYIMGIRISHAREKET');

      await t.calistir(
        `DELETE FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
         WHERE BELGEIND = @ind AND BELGETIPI = @tip`,
        { ind: f.baslikInd, tip: f.belgeTipi }
      );
      await t.calistir(
        `DELETE FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')}
         WHERE BELGENO = @ind AND IZAHAT = @izahat`,
        { ind: f.baslikInd, izahat: String(f.belgeTipi) }
      );
      await t.calistir(`DELETE FROM ${hareketTablosu} WHERE EVRAKNO = @ind`, { ind: f.baslikInd });
      await t.calistir(`DELETE FROM ${baslikTablosu} WHERE IND = @ind`, { ind: f.baslikInd });
    }
  });

  await calistir(
    `UPDATE [${p}].dbo.AraSayim
     SET VegayaYazildi = 0, VegaBelgeNo = NULL, VegaFisler = NULL
     WHERE Id = @sayimId`,
    { sayimId }
  );

  await panel.kayit(
    'Ara Sayım',
    'Sayım fişi geri alındı',
    { sayimId, firma, donem, fisler },
    kayit.kullanici
  );

  return { tamam: true, geriAlinan: fisler.map((f) => f.belgeNo).join(' / ') };
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

// Elle girilen fişlerin numarası A0000001 biçiminde ilerliyor. Sayım fişleri
// aynı biçimi Z önekiyle kullanıyor ve sayaç her tabloda ayrı yürüyor
// (sayım girişinde Z0000048 iken sayım çıkışında Z0000022 olabiliyor).
//
// UPDLOCK/HOLDLOCK okuma sırasında konur: iki kullanıcı aynı anda fiş
// kesmeye kalkarsa ikincisi bekler, aynı numarayı almaz.
async function siradakiBelgeNo(t, tabloAdi, onek) {
  const o = onek || BELGE_ONEKI;
  const r = await t.sorgu(
    `SELECT MAX(CAST(SUBSTRING(BELGENO, 2, 20) AS INT)) AS sonNo
     FROM ${tabloAdi} WITH (UPDLOCK, HOLDLOCK)
     WHERE BELGENO LIKE @desen AND ISNUMERIC(SUBSTRING(BELGENO, 2, 20)) = 1`,
    { desen: o + '%' }
  );
  const sonraki = (r[0] && r[0].sonNo ? Number(r[0].sonNo) : 0) + 1;
  return o + String(sonraki).padStart(7, '0');
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
       DEPO, ENVANTER, PARABIRIMI, KUR, ACIKLAMA, GK)
    OUTPUT INSERTED.IND AS ind
    VALUES
      (@tarih, 0, @baslikInd, 0, @stokNo, @stokAdi, @miktar, 1,
       @birim, @birimEx, 0, 0, @maliyet, @maliyet, @tutar,
       @depo, @miktar, 'TL', 1, @aciklama, @gk)
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
      aciklama: aciklama || null,
      gk: gkUret()
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

// --- Zayi / personel çıkışı -----------------------------------------------
//
// Desen, F0102/D0002 içindeki 37 gerçek ZAYİ fişi okunarak çıkarıldı
// (`galya döküman/zayiat durumunda alt hesap ve cari zayi seçilir .png`
// ekranının veritabanı karşılığı). Tutanağın çıkış fişinden iki farkı var:
//
//   1. FIRMANO bir cariyi gösterir — ZAYİ (IND 158), FİRE, ya da malın
//      elinde kaldığı personelin kartı. Ekranda "Firma Kodu" diye görünen bu.
//   2. CARIHAREKETEYAZ = 1 ve TBLCARIHAREKETLERI'ne BORÇ satırı düşer.
//      Zayiin TL karşılığı böyle takip ediliyor.
//
// Alt hesap (ekrandaki "Alt Hesap" kutusu) başlıkta OZELKOD4, cari
// hareketinde OZELKOD alanına yazılıyor.
//
// Birim fiyat: Vega'nın kendi zayi fişlerinde 945 satırın 801'i sıfır
// fiyatlı, yani zayi çoğunlukla tutarsız giriliyor ve yalnızca miktar
// düşüyor. Panel ikisini de yapabiliyor; hangisi olacağına kullanıcı
// "maliyetle yaz" kutusundan karar veriyor (varsayılan: kapalı).
const ZAYI_BELGE_TIPI = CIKIS_BELGE_TIPI; // 33 — elle girilen stok çıkış fişi

async function zayiFisiYaz(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const depo = Number(kayit.depo != null ? kayit.depo : ayarOku().varsayilanDepo) || 0;
  if (!depo) throw new Error('Zayi için tek bir depo seçilmelidir. Üst çubuktan depo seçin.');
  const cariNo = Number(kayit.cariNo);
  if (!cariNo) throw new Error('Zayi carisi seçilmemiş (ZAYİ, FİRE ya da personel kartı).');

  const satirlar = (Array.isArray(kayit.satirlar) ? kayit.satirlar : []).filter(
    (s) => Number(s.stokNo) && Number(s.miktar) > 0
  );
  if (!satirlar.length) throw new Error('Zayi fişinde satır yok.');

  const maliyetli = !!kayit.maliyetliMi;
  const tarih = kayit.tarih ? new Date(kayit.tarih) : new Date();
  const aciklama = (kayit.sebep ? String(kayit.sebep) : 'Galya Panel zayi').substring(0, 100);
  const altHesap = (kayit.altHesap || '').substring(0, 50) || null;

  // Kart bilgileri (birim, maliyet, KDV) fişe yazılıyor; arayüzden gelen
  // maliyete güvenilmiyor.
  // KDV oranı stok kartında doğrudan yazmıyor: kartta KDVGRUBU var, oran
  // TBLKDVGRUPLARI'nda duruyor (100 → %10, 101 → %1). Vega'nın kendi zayi
  // fişlerinde satırdaki KDV alanı bu orandan geliyor.
  const kartlar = await sorgu(
    `SELECT S.IND AS stokNo, S.MALINCINSI AS ad, ISNULL(S.STOKKODU,'') AS kod,
            ISNULL(S.STOKTIPI, 0) AS stokTipi, ISNULL(S.MALIYET, 0) AS maliyet,
            ISNULL(G.KDV, 0) AS kdv,
            ISNULL(B.BIRIMADI, '') AS birim, ISNULL(B.IND, 0) AS birimEx
     FROM ${kart(v, firma, 'TBLSTOKLAR')} S
     LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
            ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
     LEFT JOIN ${kart(v, firma, 'TBLKDVGRUPLARI')} G ON G.IND = S.KDVGRUBU
     WHERE S.IND IN (${satirlar.map((s) => Number(s.stokNo)).join(',')})`
  );
  const kartHaritasi = new Map(kartlar.map((k) => [Number(k.stokNo), k]));

  const hazir = satirlar.map((s) => {
    const k = kartHaritasi.get(Number(s.stokNo));
    if (!k) throw new Error(`Stok kartı bulunamadı: ${s.stokAdi || s.stokNo}`);
    const miktar = Number(s.miktar);
    const maliyet = Number(k.maliyet);
    const fiyat = maliyetli ? maliyet : 0;
    const kdvOrani = Number(k.kdv) || 0;
    const tutar = miktar * fiyat;
    return {
      stokNo: Number(k.stokNo),
      ad: k.ad,
      kod: k.kod,
      stokTipi: Number(k.stokTipi),
      birim: k.birim,
      birimEx: Number(k.birimEx),
      miktar,
      maliyet,
      fiyat,
      kdvOrani,
      tutar,
      kdvTutari: (tutar * kdvOrani) / 100
    };
  });

  const araToplam = hazir.reduce((t, s) => t + s.tutar, 0);
  const kdvToplam = hazir.reduce((t, s) => t + s.kdvTutari, 0);
  const genelToplam = araToplam + kdvToplam;

  const baslikTablosu = tablo(v, firma, donem, 'TBLSTKCIKBASLIK');
  const hareketTablosu = tablo(v, firma, donem, 'TBLSTKCIKHAREKET');

  const sonuc = await islem(async (t) => {
    const sube = await faturaSubeKodlari(t, tablo(v, firma, donem, 'TBLALFATBASLIK'));
    const belgeNo = await siradakiBelgeNo(t, baslikTablosu);

    const baslik = await t.sorgu(
      `
      INSERT INTO ${baslikTablosu}
        (BELGENO, TARIH, ODEMETARIHI, FIRMANO, HAREKETDEPOSU, BELGETIPI, EKBELGETIPI,
         TUTAR, ARATOPLAM, KDV, IPTAL, IADE, CONVERTED, GIRIS,
         STOKHAREKETEYAZ, CARIHAREKETEYAZ, KAYNAK, USERNO,
         OZELKOD1, OZELKOD2, OZELKOD4, PARABIRIMI, KUR, ALTNOT,
         CREDATE, LADATE, UID)
      OUTPUT INSERTED.IND AS ind
      VALUES
        (@belgeNo, @tarih, @tarih, @cariNo, @depo, @belgeTipi, 0,
         @genel, @ara, 0, 0, 0, 0, 0,
         1, 1, 0, @userNo,
         @k1, @k2, @altHesap, 'TL', 1, @aciklama,
         GETDATE(), GETDATE(), @uid)
    `,
      {
        belgeNo,
        tarih,
        cariNo,
        depo,
        belgeTipi: ZAYI_BELGE_TIPI,
        genel: genelToplam,
        ara: araToplam,
        userNo: Number(kayit.userNo || 0),
        k1: sube.k1,
        k2: sube.k2,
        altHesap,
        aciklama,
        uid: '{' + crypto.randomUUID().toUpperCase() + '}'
      }
    );
    const baslikInd = baslik[0].ind;

    const yazilanSatirlar = [];
    for (const s of hazir) {
      const satir = await t.sorgu(
        `
        INSERT INTO ${hareketTablosu}
          (TARIH, DETAY, EVRAKNO, FIRMANO, STOKNO, MALINCINSI, STOKKODU, STOKTIPI,
           MIKTAR, BIRIMMIKTAR, BIRIM, BIRIMEX, KDV, AFIYATI, FIYATI, GERCEKTOPLAM,
           DEPO, SATISKOSULU, SERIMIKTAR, ENVANTER, PARABIRIMI, KUR,
           GRUPMIKTAR, ACIKLAMA, GK)
        OUTPUT INSERTED.IND AS ind
        VALUES
          (@tarih, 0, @baslikInd, @cariNo, @stokNo, @ad, @kod, @stokTipi,
           @miktar, 1, @birim, @birimEx, @kdv, @maliyet, @fiyat, @tutar,
           @depo, 1, 1, @miktar, 'TL', 1,
           1, @aciklama, @gk)
      `,
        {
          tarih,
          baslikInd,
          cariNo,
          stokNo: s.stokNo,
          ad: s.ad,
          kod: s.kod,
          stokTipi: s.stokTipi,
          miktar: s.miktar,
          birim: s.birim,
          birimEx: s.birimEx,
          kdv: s.kdvOrani,
          maliyet: s.maliyet,
          fiyat: s.fiyat,
          tutar: s.tutar,
          depo,
          aciklama,
          gk: gkUret()
        }
      );
      const satirInd = satir[0].ind;

      await t.calistir(
        `
        INSERT INTO ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')}
          (EVRAKNO, IZAHAT, TARIH, GIREN, CIKAN, KALAN, TUTAR, FIRMANO, STOKNO,
           BELGENO, LN, DEPO, KDV, IADE, BIRIMFIYAT, BIRIMMALIYET,
           SIRALAMATARIHI, SIRALAMATARIHIEX, KUR, PARABIRIMI, BIRIMEX, STOKTIPI, ACIKLAMA)
        VALUES
          (@belgeNo, @izahat, @tarih, 0, @miktar, 0, @tutar, @cariNo, @stokNo,
           @baslikInd, @satirInd, @depo, @kdv, 0, @fiyat, @fiyat,
           @tarih, CONVERT(FLOAT, GETDATE()), 1, 'TL', @birimEx, @stokTipi, @aciklama)
      `,
        {
          belgeNo,
          izahat: ZAYI_BELGE_TIPI,
          tarih,
          miktar: s.miktar,
          tutar: s.tutar,
          cariNo,
          stokNo: s.stokNo,
          baslikInd,
          satirInd,
          depo,
          kdv: s.kdvOrani,
          fiyat: s.fiyat,
          birimEx: s.birimEx,
          stokTipi: s.stokTipi,
          aciklama
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
          tarih,
          stokNo: s.stokNo,
          depo,
          envanter: -s.miktar,
          belgeTipi: ZAYI_BELGE_TIPI,
          baslikInd,
          satirInd,
          aciklama
        }
      );

      yazilanSatirlar.push({ stokNo: s.stokNo, satirInd, miktar: s.miktar, tutar: s.tutar });
    }

    // Cari hareket: zayi seçilen cariye borçtur. Vega'nın kendi zayi
    // fişlerinin 37'sinde de CARIHAREKETEYAZ = 1 ve BORÇ satırı var; fiyat
    // sıfır girildiğinde tutar 0 olarak düşüyor.
    const cariHareket = await t.sorgu(
      `
      INSERT INTO ${tablo(v, firma, donem, 'TBLCARIHAREKETLERI')}
        (FIRMANO, TARIH, IZAHAT, EVRAKNO, BORC, ALACAK, LN, IADE, OZELKOD,
         PARABIRIMI, KUR, ODEMETARIHI, ISLEMTARIHI, SIRALAMATARIHI, SIRALAMATARIHIEX)
      OUTPUT INSERTED.IND AS ind
      VALUES
        (@cariNo, @tarih, @izahat, @belgeNo, @genel, 0, @baslikInd, 0, @altHesap,
         'TL', 1, @tarih, GETDATE(), GETDATE(), CONVERT(FLOAT, GETDATE()))
    `,
      {
        cariNo,
        tarih,
        izahat: ZAYI_BELGE_TIPI,
        belgeNo,
        genel: genelToplam,
        baslikInd,
        altHesap
      }
    );

    return {
      belgeNo,
      baslikInd,
      satirlar: yazilanSatirlar,
      cariHareketInd: cariHareket[0].ind
    };
  });

  await panel.kayit(
    'Zayi',
    "Zayi fişi Vega'ya yazıldı",
    {
      zayiId: kayit.zayiId || null,
      firma,
      donem,
      depo,
      cariNo,
      cariAdi: kayit.cariAdi || null,
      altHesap,
      belgeNo: sonuc.belgeNo,
      baslikInd: sonuc.baslikInd,
      maliyetli,
      genelToplam,
      satir: sonuc.satirlar.length
    },
    kayit.kullanici
  );

  if (kayit.zayiId) {
    await calistir(
      `UPDATE [${panel.p()}].dbo.Zayi
       SET VegayaYazildi = 1, VegaBelgeInd = @ind, VegaBelgeNo = @belgeNo
       WHERE Id = @id`,
      { id: Number(kayit.zayiId), ind: sonuc.baslikInd, belgeNo: sonuc.belgeNo }
    );
  }

  return {
    tamam: true,
    belgeNo: sonuc.belgeNo,
    baslikInd: sonuc.baslikInd,
    genelToplam,
    satirSayisi: sonuc.satirlar.length
  };
}

// Yazılan zayi fişini beş tablodan da siler; stok fiş öncesine döner.
async function zayiFisiGeriAl(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const baslikInd = Number(kayit.baslikInd);
  if (!baslikInd) throw new Error('Geri alınacak zayi fişinin kimliği eksik.');

  const silinen = await islem(async (t) => {
    let toplam = 0;
    const say = (r) => {
      toplam += r[0] || 0;
    };

    say(
      await t.calistir(
        `DELETE FROM ${tablo(v, firma, donem, 'TBLCARIHAREKETLERI')}
         WHERE LN = @baslikInd AND IZAHAT = @tip`,
        { baslikInd, tip: String(ZAYI_BELGE_TIPI) }
      )
    );
    say(
      await t.calistir(
        `DELETE FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
         WHERE BELGEIND = @baslikInd AND BELGETIPI = @tip`,
        { baslikInd, tip: ZAYI_BELGE_TIPI }
      )
    );
    say(
      await t.calistir(
        `DELETE FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')}
         WHERE BELGENO = @baslikInd AND IZAHAT = @tip`,
        { baslikInd, tip: ZAYI_BELGE_TIPI }
      )
    );
    say(
      await t.calistir(
        `DELETE FROM ${tablo(v, firma, donem, 'TBLSTKCIKHAREKET')} WHERE EVRAKNO = @baslikInd`,
        { baslikInd }
      )
    );
    say(
      await t.calistir(
        `DELETE FROM ${tablo(v, firma, donem, 'TBLSTKCIKBASLIK')} WHERE IND = @baslikInd`,
        { baslikInd }
      )
    );
    return toplam;
  });

  await panel.kayit(
    'Zayi',
    "Vega'ya yazılan zayi fişi geri alındı",
    { firma, donem, baslikInd, zayiId: kayit.zayiId || null, silinenSatir: silinen },
    kayit.kullanici
  );

  if (kayit.zayiId) {
    await calistir(
      `UPDATE [${panel.p()}].dbo.Zayi
       SET VegayaYazildi = 0, VegaBelgeInd = NULL, VegaBelgeNo = NULL WHERE Id = @id`,
      { id: Number(kayit.zayiId) }
    );
  }

  return { tamam: true, silinenSatir: silinen };
}

// --- Stok kartını pasife alma ---------------------------------------------
//
// Firma pasif kartları KOD8 alanına "PASİF" yazarak işaretliyor (373 kart).
// Panel aynı alanı kullanıyor: yeni bir alan uydurmak Vega'nın kendi
// raporlarında görünmezdi. THIRD yazması gibi tek alanlık, hareketsiz bir
// güncelleme; envanteri ve maliyeti etkilemez.
const PASIF_KODU = 'PASİF';
const PASIF_ALANI = 'KOD8';

async function stokPasifYap(kayit) {
  kilitKontrol();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const stokNolar = (Array.isArray(kayit.stokNolar) ? kayit.stokNolar : [kayit.stokNo])
    .map(Number)
    .filter(Boolean);
  if (!stokNolar.length) throw new Error('Pasife alınacak ürün seçilmedi.');
  const pasif = kayit.pasif !== false;

  // Geri alınabilsin diye önceki değerler okunuyor: kartta KOD8 başka bir şey
  // yazıyorsa pasiften çıkarken ona dokunulmaz.
  const oncesi = await sorgu(
    `SELECT IND AS stokNo, MALINCINSI AS ad, ISNULL(${PASIF_ALANI}, '') AS onceki
     FROM ${kart(v, firma, 'TBLSTOKLAR')} WHERE IND IN (${stokNolar.join(',')})`
  );
  if (!oncesi.length) throw new Error('Stok kartı bulunamadı.');

  let etkilenen = 0;
  for (const k of oncesi) {
    if (!pasif && k.onceki !== PASIF_KODU) continue;
    const r = await calistir(
      `UPDATE ${kart(v, firma, 'TBLSTOKLAR')}
       SET ${PASIF_ALANI} = @deger, GUNCELLEMETARIHI = GETDATE()
       WHERE IND = @stokNo`,
      { deger: pasif ? PASIF_KODU : '', stokNo: Number(k.stokNo) }
    );
    etkilenen += r[0] || 0;
  }

  await panel.kayit(
    'Stok',
    pasif ? 'Stok kartı pasife alındı' : 'Stok kartı pasiften çıkarıldı',
    { firma, stoklar: oncesi.map((k) => ({ stokNo: k.stokNo, ad: k.ad, onceki: k.onceki })) },
    kayit.kullanici
  );

  return { tamam: true, etkilenen, pasif };
}

// --- Alış faturası --------------------------------------------------------
//
// Desen, F0102/D0002 içindeki 706 gerçek alış faturası okunarak çıkarıldı.
// Bir fatura beş tabloya yazılır:
//
//   TBLALFATBASLIK      IND (IDENTITY) = belge kimliği, BELGENO = 'A0000123'
//   TBLALFATHAREKET     EVRAKNO = başlık IND, IND = satır kimliği
//   TBLSTOKHAREKETLERI  BELGENO = başlık IND, LN = satır IND, IZAHAT = 20
//   TBLDEPOENVANTER     BELGEIND = başlık IND, HAREKETIND = satır IND, +miktar
//   TBLCARIHAREKETLERI  LN = başlık IND, ALACAK = genel toplam, IZAHAT = 20
//
// Stok giriş/çıkış fişinden farkı: cari hareket de oluşur, yani tedarikçiye
// borç yazılır. Bu yüzden panelde önce taslak olarak hazırlanır (db/fatura.js),
// Vega'ya yazma ayrı bir onaydan geçer.
const ALIS_FATURA_TIPI = 20;

// Şube/kasa alanları (OZELKOD1, OZELKOD2) firmadan firmaya değişiyor;
// mevcut faturalarda en çok geçen değer neyse onu kullanıyoruz.
async function faturaSubeKodlari(t, baslikTablosu) {
  const r = await t.sorgu(`
    SELECT TOP 1 ISNULL(OZELKOD1, '') AS k1, ISNULL(OZELKOD2, '') AS k2
    FROM ${baslikTablosu}
    WHERE OZELKOD1 IS NOT NULL
    GROUP BY OZELKOD1, OZELKOD2
    ORDER BY COUNT(*) DESC
  `);
  return r.length ? { k1: r[0].k1, k2: r[0].k2 } : { k1: '', k2: '' };
}

async function alisFaturasiYaz(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const depo = Number(kayit.depo) || 0;
  if (!depo) throw new Error('Fatura için tek bir depo seçilmelidir.');
  if (!Number(kayit.cariNo)) throw new Error('Tedarikçi seçilmemiş.');
  const satirlar = Array.isArray(kayit.satirlar) ? kayit.satirlar : [];
  if (!satirlar.length) throw new Error('Faturada satır yok.');

  const baslikTablosu = tablo(v, firma, donem, 'TBLALFATBASLIK');
  const hareketTablosu = tablo(v, firma, donem, 'TBLALFATHAREKET');

  // Satırlara stok kartı bilgisi (kod, birim, stok tipi) eklenir; Vega bu
  // alanları fişin içine kopyalıyor.
  const stokNolar = satirlar.map((s) => Number(s.stokNo));
  const kartlar = await sorgu(
    `SELECT S.IND AS stokNo, S.MALINCINSI AS ad, ISNULL(S.STOKKODU,'') AS kod,
            ISNULL(S.STOKTIPI, 0) AS stokTipi, ISNULL(S.ALISFIYATI, 0) AS alisFiyati,
            ISNULL(S.ESKIALISFIYATI, 0) AS eskiAlisFiyati,
            S.ALISFIYATIDEGISMETARIHI AS fiyatDegismeTarihi,
            S.SONALISTARIHI AS sonAlisTarihi,
            ISNULL(B.BIRIMADI, '') AS birim, ISNULL(B.IND, 0) AS birimEx
     FROM ${kart(v, firma, 'TBLSTOKLAR')} S
     LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
            ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
     WHERE S.IND IN (${stokNolar.map((n) => Number(n)).join(',')})`
  );
  const kartHaritasi = new Map();
  for (const k of kartlar) kartHaritasi.set(Number(k.stokNo), k);
  for (const s of satirlar) {
    if (!kartHaritasi.has(Number(s.stokNo))) {
      throw new Error(`Stok kartı bulunamadı (${s.stokAdi || s.stokNo}).`);
    }
  }

  let araToplam = 0;
  let kdvToplam = 0;
  for (const s of satirlar) {
    const tutar = Number(s.miktar) * Number(s.birimFiyat);
    araToplam += tutar;
    kdvToplam += tutar * (Number(s.kdvOrani || 0) / 100);
  }
  const genelToplam = araToplam + kdvToplam;
  const tarih = kayit.tarih ? new Date(kayit.tarih) : new Date();
  const vade = kayit.vadeTarihi ? new Date(kayit.vadeTarihi) : tarih;
  const aciklama = ('Galya Panel alış faturası' + (kayit.aciklama ? ' - ' + kayit.aciklama : ''))
    .substring(0, 200);

  const sonuc = await islem(async (t) => {
    const sube = await faturaSubeKodlari(t, baslikTablosu);
    const belgeNo = kayit.belgeNo && String(kayit.belgeNo).trim()
      ? String(kayit.belgeNo).trim().substring(0, 50)
      : await siradakiBelgeNo(t, baslikTablosu);

    const baslik = await t.sorgu(
      `
      INSERT INTO ${baslikTablosu}
        (BELGENO, TARIH, ODEMETARIHI, DEPO, HAREKETDEPOSU, BELGETIPI, EKBELGETIPI,
         FIRMANO, USERNO, TUTAR, ARATOPLAM, KDV, GIRIS, IADE, IPTAL, CONVERTED,
         ENVANTERUPDATE, SUCCESS, STOKHAREKETEYAZ, CARIHAREKETEYAZ,
         PARABIRIMI, KUR, ALTNOT, OZELKOD1, OZELKOD2, EFATURA, YURTDISI,
         MUHASEBELESMEYECEK, IRSALIYELIFATURA, YAZARKASAFISI,
         CREDATE, LADATE, UID)
      OUTPUT INSERTED.IND AS ind
      VALUES
        (@belgeNo, @tarih, @vade, @depo, @depo, @belgeTipi, 0,
         @cariNo, @userNo, @genel, @ara, 0, 1, 0, 0, 0,
         0, 0, 1, 1,
         'TL', 1, @aciklama, @k1, @k2, 0, 0,
         0, 0, 0,
         GETDATE(), GETDATE(), @uid)
    `,
      {
        belgeNo,
        tarih,
        vade,
        depo,
        belgeTipi: ALIS_FATURA_TIPI,
        cariNo: Number(kayit.cariNo),
        userNo: Number(kayit.userNo || 0),
        genel: genelToplam,
        ara: araToplam,
        aciklama,
        k1: sube.k1,
        k2: sube.k2,
        uid: '{' + crypto.randomUUID().toUpperCase() + '}'
      }
    );
    const baslikInd = baslik[0].ind;

    const yazilanSatirlar = [];
    let sira = 0;
    for (const s of satirlar) {
      const k = kartHaritasi.get(Number(s.stokNo));
      const miktar = Number(s.miktar);
      const fiyat = Number(s.birimFiyat);
      const tutar = miktar * fiyat;
      const kdvOrani = Number(s.kdvOrani || 0);

      const satir = await t.sorgu(
        `
        INSERT INTO ${hareketTablosu}
          (TARIH, DETAY, EVRAKNO, FIRMANO, STOKNO, MALINCINSI, STOKKODU, STOKTIPI,
           MIKTAR, BIRIMMIKTAR, BIRIM, BIRIMEX, KDV, KDVTUTARI, AFIYATI, FIYATI,
           GERCEKTOPLAM, DEPO, OPSIYON, SERIMIKTAR, ENVANTER, PARABIRIMI, KUR,
           ORJFIYAT, GMIKTAR, ACIKLAMA, GK)
        OUTPUT INSERTED.IND AS ind
        VALUES
          (@tarih, @sira, @baslikInd, @cariNo, @stokNo, @ad, @kod, @stokTipi,
           @miktar, 1, @birim, @birimEx, @kdvOrani, @kdvTutari, @fiyat, @fiyat,
           @tutar, @depo, 1, 1, @miktar, 'TL', 1,
           @fiyat, @miktar, @aciklama, @gk)
      `,
        {
          tarih,
          sira: sira++,
          baslikInd,
          cariNo: Number(kayit.cariNo),
          stokNo: Number(s.stokNo),
          ad: k.ad,
          kod: k.kod,
          stokTipi: Number(k.stokTipi),
          miktar,
          birim: s.birim || k.birim,
          birimEx: s.birimEx != null ? Number(s.birimEx) : Number(k.birimEx),
          kdvOrani,
          kdvTutari: tutar * (kdvOrani / 100),
          fiyat,
          tutar,
          depo,
          aciklama: aciklama.substring(0, 100),
          gk: gkUret()
        }
      );
      const satirInd = satir[0].ind;

      await t.calistir(
        `
        INSERT INTO ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')}
          (EVRAKNO, IZAHAT, TARIH, GIREN, CIKAN, KALAN, TUTAR, FIRMANO, STOKNO,
           BELGENO, LN, DEPO, KDV, IADE, OPSIYON, BIRIMFIYAT, BIRIMMALIYET,
           SIRALAMATARIHI, SIRALAMATARIHIEX, KUR, PARABIRIMI, BIRIMEX, STOKTIPI,
           ACIKLAMA)
        VALUES
          (@belgeNo, @izahat, @tarih, @miktar, 0, 0, @tutar, @cariNo, @stokNo,
           @baslikInd, @satirInd, @depo, @kdvOrani, 0, 1, @fiyat, @fiyat,
           GETDATE(), CONVERT(FLOAT, GETDATE()), 1, 'TL', @birimEx, @stokTipi,
           @aciklama)
      `,
        {
          belgeNo,
          izahat: ALIS_FATURA_TIPI,
          tarih,
          miktar,
          tutar,
          cariNo: Number(kayit.cariNo),
          stokNo: Number(s.stokNo),
          baslikInd,
          satirInd,
          depo,
          kdvOrani,
          fiyat,
          birimEx: s.birimEx != null ? Number(s.birimEx) : Number(k.birimEx),
          stokTipi: Number(k.stokTipi),
          aciklama: aciklama.substring(0, 100)
        }
      );

      await t.calistir(
        `
        INSERT INTO ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
          (TARIH, STOKNO, DEPO, ENVANTER, BELGETIPI, BELGEIND, HAREKETIND,
           SIRALAMATARIHI, SIRALAMATARIHIEX, ACIKLAMA)
        VALUES
          (@tarih, @stokNo, @depo, @miktar, @belgeTipi, @baslikInd, @satirInd,
           GETDATE(), CONVERT(FLOAT, GETDATE()), @aciklama)
      `,
        {
          tarih,
          stokNo: Number(s.stokNo),
          depo,
          miktar,
          belgeTipi: ALIS_FATURA_TIPI,
          baslikInd,
          satirInd,
          aciklama: aciklama.substring(0, 100)
        }
      );

      yazilanSatirlar.push({
        stokNo: Number(s.stokNo),
        satirInd,
        miktar,
        fiyat,
        // Kartın fatura öncesi hâli; geri alma bunları geri yazıyor.
        oncekiAlisFiyati: Number(k.alisFiyati),
        oncekiEskiAlisFiyati: Number(k.eskiAlisFiyati),
        oncekiFiyatDegismeTarihi: k.fiyatDegismeTarihi || null,
        oncekiSonAlisTarihi: k.sonAlisTarihi || null
      });
    }

    // Cari hareket: alış faturası tedarikçiye borçlanmadır, ALACAK sütununa
    // genel toplam yazılır (Vega'nın kendi faturalarında da böyle).
    const cariHareket = await t.sorgu(
      `
      INSERT INTO ${tablo(v, firma, donem, 'TBLCARIHAREKETLERI')}
        (FIRMANO, TARIH, IZAHAT, EVRAKNO, BORC, ALACAK, LN, IADE,
         PARABIRIMI, KUR, ODEMETARIHI, ISLEMTARIHI, SIRALAMATARIHI, SIRALAMATARIHIEX)
      OUTPUT INSERTED.IND AS ind
      VALUES
        (@cariNo, @tarih, @izahat, @belgeNo, 0, @genel, @baslikInd, 0,
         'TL', 1, @vade, GETDATE(), GETDATE(), CONVERT(FLOAT, GETDATE()))
    `,
      {
        cariNo: Number(kayit.cariNo),
        tarih,
        izahat: ALIS_FATURA_TIPI,
        belgeNo,
        genel: genelToplam,
        baslikInd,
        vade
      }
    );

    // Son alış fiyatı stok kartına işlenir; maliyetlendirme bunun üzerinden
    // çalışıyor.
    for (const s of yazilanSatirlar) {
      await t.calistir(
        `UPDATE ${kart(v, firma, 'TBLSTOKLAR')}
         SET ESKIALISFIYATI = ALISFIYATI,
             ALISFIYATI = @fiyat,
             ALISFIYATIDEGISMETARIHI = GETDATE(),
             SONALISTARIHI = @tarih,
             GUNCELLEMETARIHI = GETDATE()
         WHERE IND = @stokNo`,
        { fiyat: s.fiyat, tarih, stokNo: s.stokNo }
      );
    }

    return {
      belgeNo,
      baslikInd,
      satirlar: yazilanSatirlar,
      cariHareketInd: cariHareket[0].ind
    };
  });

  await panel.kayit(
    'Alış Faturası',
    "Alış faturası Vega'ya yazıldı",
    {
      faturaId: kayit.faturaId || null,
      firma,
      donem,
      depo,
      cariNo: kayit.cariNo,
      cariAdi: kayit.cariAdi,
      belgeNo: sonuc.belgeNo,
      baslikInd: sonuc.baslikInd,
      genelToplam,
      satir: sonuc.satirlar.length
    },
    kayit.kullanici
  );

  if (kayit.faturaId) {
    await calistir(
      `UPDATE [${panel.p()}].dbo.AlisFatura
       SET VegayaYazildi = 1, VegaBelgeInd = @ind, VegaBelgeNo = @belgeNo,
           OncekiFiyatlar = @fiyatlar
       WHERE Id = @id`,
      {
        id: Number(kayit.faturaId),
        ind: sonuc.baslikInd,
        belgeNo: sonuc.belgeNo,
        fiyatlar: JSON.stringify(sonuc.satirlar)
      }
    );
  }

  return {
    tamam: true,
    belgeNo: sonuc.belgeNo,
    baslikInd: sonuc.baslikInd,
    genelToplam,
    satirlar: sonuc.satirlar
  };
}

// Yazılan faturayı Vega'dan tamamen siler. Stok kartındaki alış fiyatı
// faturadan önceki değerine döndürülür.
async function alisFaturasiGeriAl(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const baslikInd = Number(kayit.baslikInd);
  if (!baslikInd) throw new Error('Geri alınacak fatura kimliği eksik.');

  const silinen = await islem(async (t) => {
    let toplam = 0;
    const say = (r) => { toplam += (r[0] || 0); };

    say(await t.calistir(
      `DELETE FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
       WHERE BELGEIND = @ind AND BELGETIPI = @tip`,
      { ind: baslikInd, tip: ALIS_FATURA_TIPI }
    ));
    say(await t.calistir(
      `DELETE FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')}
       WHERE BELGENO = @ind AND IZAHAT = @tip`,
      { ind: baslikInd, tip: ALIS_FATURA_TIPI }
    ));
    say(await t.calistir(
      `DELETE FROM ${tablo(v, firma, donem, 'TBLCARIHAREKETLERI')}
       WHERE LN = @ind AND IZAHAT = @tip`,
      { ind: baslikInd, tip: ALIS_FATURA_TIPI }
    ));
    say(await t.calistir(
      `DELETE FROM ${tablo(v, firma, donem, 'TBLALFATHAREKET')} WHERE EVRAKNO = @ind`,
      { ind: baslikInd }
    ));
    say(await t.calistir(
      `DELETE FROM ${tablo(v, firma, donem, 'TBLALFATBASLIK')} WHERE IND = @ind`,
      { ind: baslikInd }
    ));

    // Stok kartındaki alış fiyatı alanları fatura öncesine döndürülüyor.
    // Bu yapılmazsa belge silinse bile kartta faturanın fiyatı kalır ve
    // maliyetlendirme yanlış hesaplar.
    const oncekiler = Array.isArray(kayit.satirlar) ? kayit.satirlar : [];
    for (const s of oncekiler) {
      if (!s || !s.stokNo) continue;
      await t.calistir(
        `UPDATE ${kart(v, firma, 'TBLSTOKLAR')}
         SET ALISFIYATI = @fiyat,
             ESKIALISFIYATI = @eski,
             ALISFIYATIDEGISMETARIHI = @degisme,
             SONALISTARIHI = @sonAlis
         WHERE IND = @stokNo`,
        {
          stokNo: Number(s.stokNo),
          fiyat: Number(s.oncekiAlisFiyati || 0),
          eski: Number(s.oncekiEskiAlisFiyati || 0),
          degisme: s.oncekiFiyatDegismeTarihi ? new Date(s.oncekiFiyatDegismeTarihi) : null,
          sonAlis: s.oncekiSonAlisTarihi ? new Date(s.oncekiSonAlisTarihi) : null
        }
      );
    }

    return toplam;
  });

  await panel.kayit(
    'Alış Faturası',
    "Alış faturası Vega'dan geri alındı",
    { faturaId: kayit.faturaId || null, firma, donem, baslikInd, silinenSatir: silinen },
    kayit.kullanici
  );

  if (kayit.faturaId) {
    await calistir(
      `UPDATE [${panel.p()}].dbo.AlisFatura
       SET VegayaYazildi = 0, VegaBelgeInd = NULL, VegaBelgeNo = NULL WHERE Id = @id`,
      { id: Number(kayit.faturaId) }
    );
  }

  return { tamam: true, silinenSatir: silinen };
}

// --- Üretim fişi ----------------------------------------------------------
//
// Desen 256 gerçek üretim fişi okunarak çıkarıldı; ayrıntısı
// kurulum/BELGE-DESENI.md → "Üretim fişi" bölümünde.
//
// Bir üretim beş kendi tablosuna, ayrıca dört doğan belgeye yazar:
//
//   TBLUREURETIMLIST    başlık (IDENTITY), FISNO = 'A0000290'
//   TBLUREURETIM        tüketilen bileşen satırları  (EVRAKNO = başlık IND)
//   TBLUREURETIMCIKTI   çıktı satırları              (RECETENO = başlık IND!)
//   TBLUREURETIMPOZ     iki pozisyon adımı (BAŞLA / BİTİR)
//   TBLUREBELGE         doğan belgelerin dizini
//
//   38 + 38  depo transferi (mamul deposu → üretim yeri → geri)
//   97       tüketim  (TBLSTOKHAREKETLERI + TBLDEPOENVANTER, −miktar)
//   96       çıktı    (TBLSTOKHAREKETLERI + TBLDEPOENVANTER, +miktar)
//
// 96 ve 97'nin başlık tablosu YOKTUR; BELGENO ikisi arasında paylaşılan bir
// sayaçtır ve IDENTITY değildir. Şefim entegrasyonu aynı sayacı günde
// 250–600 belge hızında ilerlettiği için numara işlem içinde kilitli
// okunuyor (UPDLOCK, HOLDLOCK) ve yazımdan hemen önce bir kez daha
// doğrulanıyor; çakışırsa işlem geri alınıp yeni numarayla denenir.
const URETIM_CIKTI_TIPI = 96;
const URETIM_TUKETIM_TIPI = 97;
const DEPO_TRANSFER_TIPI = 38;

// 96/97 sayaçları. Kilit işlem sonuna kadar tutulur.
async function uretimSayaclari(t, stokHareketTablosu) {
  const r = await t.sorgu(`
    SELECT
      ISNULL(MAX(BELGENO), 0) AS belgeNo,
      ISNULL(MAX(LN), 0)      AS ln,
      ISNULL(MAX(CASE WHEN EVRAKNO LIKE 'Z%'
                       AND ISNUMERIC(SUBSTRING(EVRAKNO, 2, 20)) = 1
                      THEN CAST(SUBSTRING(EVRAKNO, 2, 20) AS INT) END), 0) AS evrakNo
    FROM ${stokHareketTablosu} WITH (UPDLOCK, HOLDLOCK)
    WHERE IZAHAT IN (${URETIM_CIKTI_TIPI}, ${URETIM_TUKETIM_TIPI})
  `);
  const s = r[0] || { belgeNo: 0, ln: 0, evrakNo: 0 };
  return {
    belgeNo: Number(s.belgeNo),
    ln: Number(s.ln),
    evrakNo: Number(s.evrakNo)
  };
}

function zNo(sayi) {
  return 'Z' + String(sayi).padStart(7, '0');
}

// Depo transfer belgesi (IZAHAT 38). Stok hareketine YAZMAZ; yalnızca depo
// envanterinde iki satır oluşturur (hedefe +, kaynaktan −).
async function depoTransferiYaz(t, a) {
  const { v, firma, donem, hedefDepo, kaynakDepo, fisNo, tarih, satirlar, userNo, sube } = a;
  const baslikTablosu = tablo(v, firma, donem, 'TBLDEPOHARBASLIK');
  const toplam = satirlar.reduce((x, s) => x + s.miktar * s.birimMaliyet, 0);

  const sonNo = await t.sorgu(
    `SELECT MAX(CAST(SUBSTRING(BELGENO, 2, 20) AS INT)) AS sonNo
     FROM ${baslikTablosu} WITH (UPDLOCK, HOLDLOCK)
     WHERE BELGENO LIKE 'Z%' AND ISNUMERIC(SUBSTRING(BELGENO, 2, 20)) = 1`
  );
  const belgeNo = zNo((sonNo[0] && sonNo[0].sonNo ? Number(sonNo[0].sonNo) : 0) + 1);

  const baslik = await t.sorgu(
    `
    INSERT INTO ${baslikTablosu}
      (BELGENO, TARIH, ODEMETARIHI, ALTBELGENO, ALTBELGETARIHI, DEPO, HAREKETDEPOSU,
       BELGETIPI, EKBELGETIPI, TUTAR, ARATOPLAM, KDV, GIRIS, IADE, IPTAL, CONVERTED,
       ENVANTERUPDATE, SUCCESS, STOKHAREKETEYAZ, CARIHAREKETEYAZ,
       PARABIRIMI, KUR, USERNO, OZELKOD1, OZELKOD2, CREDATE, LADATE, UID)
    OUTPUT INSERTED.IND AS ind
    VALUES
      (@belgeNo, @tarih, @tarih, @fisNo, @tarih, @hedefDepo, @kaynakDepo,
       @belgeTipi, 0, @tutar, @tutar, 1, 0, 0, 0, 0,
       0, 0, 1, 1,
       'TL', 1, @userNo, @k1, @k2, GETDATE(), GETDATE(), @uid)
  `,
    {
      belgeNo,
      tarih,
      fisNo,
      hedefDepo,
      kaynakDepo,
      belgeTipi: DEPO_TRANSFER_TIPI,
      tutar: toplam,
      userNo: Number(userNo || 0),
      k1: sube.k1,
      k2: sube.k2,
      uid: '{' + crypto.randomUUID().toUpperCase() + '}'
    }
  );
  const baslikInd = baslik[0].ind;

  for (const s of satirlar) {
    const hareket = await t.sorgu(
      `
      INSERT INTO ${tablo(v, firma, donem, 'TBLDEPOHARHAREKET')}
        (TARIH, DETAY, EVRAKNO, STOKNO, MALINCINSI, STOKKODU, STOKTIPI,
         MIKTAR, BIRIMMIKTAR, BIRIM, BIRIMEX, AFIYATI, FIYATI, GERCEKTOPLAM,
         DEPO, SERIMIKTAR, ENVANTER, PARABIRIMI, KUR, GK)
      OUTPUT INSERTED.IND AS ind
      VALUES
        (@tarih, 0, @baslikInd, @stokNo, @ad, @kod, @stokTipi,
         @miktar, 1, @birim, @birimEx, @fiyat, @fiyat, @tutar,
         @kaynakDepo, 1, @miktar, 'TL', 1, @gk)
    `,
      {
        tarih,
        baslikInd,
        stokNo: s.stokNo,
        ad: s.ad,
        kod: s.kod,
        stokTipi: s.stokTipi,
        miktar: s.miktar,
        birim: s.birim,
        birimEx: s.birimEx,
        fiyat: s.birimMaliyet,
        tutar: s.miktar * s.birimMaliyet,
        kaynakDepo,
        gk: gkUret()
      }
    );
    const hareketInd = hareket[0].ind;

    for (const [depo, envanter] of [[hedefDepo, s.miktar], [kaynakDepo, -s.miktar]]) {
      await t.calistir(
        `
        INSERT INTO ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
          (TARIH, STOKNO, DEPO, ENVANTER, BELGETIPI, BELGEIND, HAREKETIND,
           SIRALAMATARIHI, SIRALAMATARIHIEX)
        VALUES
          (@tarih, @stokNo, @depo, @envanter, @belgeTipi, @baslikInd, @hareketInd,
           GETDATE(), CONVERT(FLOAT, GETDATE()))
      `,
        {
          tarih,
          stokNo: s.stokNo,
          depo,
          envanter,
          belgeTipi: DEPO_TRANSFER_TIPI,
          baslikInd,
          hareketInd
        }
      );
    }
  }

  return { belgeNo, baslikInd };
}

// Mamulün reçetesini, bileşen kartlarını ve pozisyon adımlarını toplar.
//
// `elleBilesenler` verilirse reçeteye HİÇ bakılmaz: tüketilecek satırları
// kullanıcı kendisi seçmiştir (fireli üretim — "10 kg ham somondan 3 kg
// somon"). Reçetesi olmayan mamul de böyle üretilebiliyor. Reçete varsa
// yalnızca pozisyon adımları ve KDV oranı ondan okunur; miktarlar elle
// gelenlerdir.
async function uretimHazirligi(v, firma, mamulStokNo, miktar, elleBilesenler) {
  const mamuller = await sorgu(
    `SELECT S.IND AS stokNo, S.MALINCINSI AS ad, ISNULL(S.STOKKODU,'') AS kod,
            ISNULL(S.STOKTIPI, 0) AS stokTipi, ISNULL(S.MALIYET, 0) AS maliyet,
            ISNULL(B.BIRIMADI, '') AS birim, ISNULL(B.IND, 0) AS birimEx
     FROM ${kart(v, firma, 'TBLSTOKLAR')} S
     LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
            ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
     WHERE S.IND = @stokNo`,
    { stokNo: Number(mamulStokNo) }
  );
  if (!mamuller.length) throw new Error('Üretilecek mamulün stok kartı bulunamadı.');
  const mamul = mamuller[0];

  const elle = Array.isArray(elleBilesenler) && elleBilesenler.length > 0;

  const basliklar = await sorgu(
    `SELECT TOP 1 IND AS receteNo, ISNULL(MIKTAR, 1) AS verim, ISNULL(KDV, 0) AS kdv
     FROM ${kart(v, firma, 'TBLURERECETELIST')}
     WHERE STOKNO = @stokNo ORDER BY IND`,
    { stokNo: Number(mamulStokNo) }
  );
  if (!elle && !basliklar.length) {
    throw new Error(`"${mamul.ad}" için reçete tanımlı değil. Üretim fişi reçetesiz yazılamaz.`);
  }
  const receteNo = basliklar.length ? Number(basliklar[0].receteNo) : 0;
  const verim = basliklar.length && Number(basliklar[0].verim) > 0
    ? Number(basliklar[0].verim)
    : 1;
  const kdv = basliklar.length ? Number(basliklar[0].kdv) : 0;

  // Üretim yeri ve mamul deposu reçetenin kendi pozisyon tanımından gelir.
  // Reçetesi olmayan mamulde boş kalır; uretimFisiYaz varsayılan BAŞLA/BİTİR
  // adımlarını yazar.
  const pozlar = receteNo
    ? await sorgu(
        `SELECT SIRANO AS sira, KOD AS kod, ISNULL(ACIKLAMA,'') AS aciklama,
                POZISYONNO AS pozisyonNo, URETIMYERINO AS yerNo,
                ISNULL(URETIMYERIKODU,'') AS yerKodu,
                ISNULL(DEPONO, 0) AS depoNo, ISNULL(DEPOKODU,'') AS depoKodu
         FROM ${kart(v, firma, 'TBLURERECETEPOZ')}
         WHERE EVRAKNO = @receteNo ORDER BY SIRANO`,
        { receteNo }
      )
    : [];

  if (elle) {
    const istenen = elleBilesenler
      .map((b) => ({ stokNo: Number(b.stokNo), miktar: Number(b.miktar) }))
      .filter((b) => b.stokNo);
    if (!istenen.length) throw new Error('Tüketilecek hammadde seçilmedi.');
    if (istenen.some((b) => !(b.miktar > 0))) {
      throw new Error('Her hammadde satırının miktarı sıfırdan büyük olmalı.');
    }

    const parametreler = {};
    const adlar = istenen.map((b, i) => {
      parametreler['ham' + i] = b.stokNo;
      return '@ham' + i;
    });
    const kartlar = await sorgu(
      `SELECT S.IND AS stokNo, S.MALINCINSI AS ad, ISNULL(S.STOKKODU,'') AS kod,
              ISNULL(S.STOKTIPI, 0) AS stokTipi, ISNULL(S.MALIYET, 0) AS maliyet,
              ISNULL(B.BIRIMADI, '') AS birim, ISNULL(B.IND, 0) AS birimEx
       FROM ${kart(v, firma, 'TBLSTOKLAR')} S
       LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
              ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
       WHERE S.IND IN (${adlar.join(', ')})`,
      parametreler
    );
    const harita = new Map(kartlar.map((k) => [Number(k.stokNo), k]));
    const eksik = istenen.filter((b) => !harita.has(b.stokNo));
    if (eksik.length) {
      throw new Error(`Hammadde stok kartı bulunamadı (${eksik.map((b) => b.stokNo).join(', ')}).`);
    }

    const elleBilesen = istenen.map((b) => {
      const k = harita.get(b.stokNo);
      return {
        stokNo: b.stokNo,
        ad: k.ad,
        kod: k.kod,
        stokTipi: Number(k.stokTipi),
        birim: k.birim,
        birimEx: Number(k.birimEx),
        birimMaliyet: Number(k.maliyet),
        receteMiktari: b.miktar,
        miktar: b.miktar
      };
    });
    return { mamul, receteNo, verim, kdv, bilesenler: elleBilesen, pozlar, elle: true };
  }

  const satirlar = await sorgu(
    `SELECT R.STOKNO AS stokNo, ISNULL(R.MIKTAR, 0) AS miktar,
            ISNULL(R.FIREORANI, 0) AS fireOrani,
            S.MALINCINSI AS ad, ISNULL(S.STOKKODU,'') AS kod,
            ISNULL(S.STOKTIPI, 0) AS stokTipi, ISNULL(S.MALIYET, 0) AS maliyet,
            ISNULL(B.BIRIMADI, '') AS birim, ISNULL(B.IND, 0) AS birimEx
     FROM ${kart(v, firma, 'TBLURERECETE')} R
     JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = R.STOKNO
     LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
            ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
     WHERE R.EVRAKNO = @receteNo
     ORDER BY R.DETAY`,
    { receteNo }
  );
  if (!satirlar.length) {
    throw new Error(`"${mamul.ad}" reçetesinde bileşen yok. Önce reçeteyi doldurun.`);
  }

  const oran = Number(miktar) / verim;
  const bilesenler = satirlar.map((s) => ({
    stokNo: Number(s.stokNo),
    ad: s.ad,
    kod: s.kod,
    stokTipi: Number(s.stokTipi),
    birim: s.birim,
    birimEx: Number(s.birimEx),
    birimMaliyet: Number(s.maliyet),
    receteMiktari: Number(s.miktar),
    // Fire oranı yüzde: %5 fire, 100 birimlik reçetede 105 birim tüketim.
    miktar: Number(s.miktar) * oran * (1 + Number(s.fireOrani || 0) / 100)
  }));

  return { mamul, receteNo, verim, kdv, bilesenler, pozlar, elle: false };
}

async function uretimFisiYaz(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const miktar = Number(kayit.miktar);
  if (!(miktar > 0)) throw new Error('Üretim miktarı sıfırdan büyük olmalı.');

  const h = await uretimHazirligi(v, firma, kayit.mamulStokNo, miktar, kayit.bilesenler);

  // BİTİR adımının deposu mamul deposu, BAŞLA adımınınki üretim yeri deposu.
  const bitir = h.pozlar.find((p) => Number(p.sira) === 2) || null;
  const basla = h.pozlar.find((p) => Number(p.sira) === 1) || null;
  const mamulDeposu = Number(
    kayit.depo || (bitir && bitir.depoNo) || ayarOku().varsayilanDepo || 1
  );
  const uretimDeposu = Number((basla && basla.depoNo) || 0) || mamulDeposu;

  const tarih = kayit.tarih ? new Date(kayit.tarih) : new Date();
  const stokHareketTablosu = tablo(v, firma, donem, 'TBLSTOKHAREKETLERI');
  const birimMaliyet = h.bilesenler.reduce((t, b) => t + b.miktar * b.birimMaliyet, 0) / miktar;
  const toplamMaliyet = birimMaliyet * miktar;

  const sonuc = await islem(async (t) => {
    const sube = await faturaSubeKodlari(t, tablo(v, firma, donem, 'TBLALFATBASLIK'));

    // Üretim fişinin kendi A serisi sayacı
    const sonFis = await t.sorgu(
      `SELECT MAX(CAST(SUBSTRING(FISNO, 2, 20) AS INT)) AS sonNo
       FROM ${tablo(v, firma, donem, 'TBLUREURETIMLIST')} WITH (UPDLOCK, HOLDLOCK)
       WHERE FISNO LIKE 'A%' AND ISNUMERIC(SUBSTRING(FISNO, 2, 20)) = 1`
    );
    const fisNo = 'A' + String((sonFis[0] && sonFis[0].sonNo ? Number(sonFis[0].sonNo) : 0) + 1)
      .padStart(7, '0');

    const baslik = await t.sorgu(
      `
      INSERT INTO ${tablo(v, firma, donem, 'TBLUREURETIMLIST')}
        (DURUM, TARIH, FISNO, STOKNO, STOKKODU, MALINCINSI, OZELKOD, BIRIM,
         FIYAT, KDV, MIKTAR, TUTAR, RECETENO, POZNO, STOKTIPI,
         SONERISIMTARIHI, URETIMEBASLAMATARIHI, URETIMBITISTARIHI, ACIKLAMA)
      OUTPUT INSERTED.IND AS ind
      VALUES
        (2, @tarih, @fisNo, @stokNo, @kod, @ad, @ozelKod, @birim,
         @fiyat, @kdv, @miktar, @tutar, @receteNo, 2, @stokTipi,
         GETDATE(), @tarih, @tarih, @aciklama)
    `,
      {
        tarih,
        fisNo,
        stokNo: h.mamul.stokNo,
        kod: h.mamul.kod,
        ad: h.mamul.ad,
        ozelKod: sube.k1,
        birim: h.mamul.birim,
        fiyat: birimMaliyet,
        kdv: h.kdv,
        miktar,
        tutar: toplamMaliyet,
        receteNo: h.receteNo,
        stokTipi: h.mamul.stokTipi,
        aciklama: (kayit.aciklama || 'Galya Panel üretim').substring(0, 100)
      }
    );
    const uretimInd = baslik[0].ind;

    // Tüketim satırları
    for (const b of h.bilesenler) {
      await t.calistir(
        `
        INSERT INTO ${tablo(v, firma, donem, 'TBLUREURETIM')}
          (EVRAKNO, STOKNO, STOKKODU, MALINCINSI, MIKTAR, BIRIM, BIRIMMIKTAR,
           KDV, FIYAT, ISLEMTARIHI, SONERISIMTARIHI, DEPONO,
           MALIYETTURU, MIKTARTURU, POZISYONNO, CIKISPOZISYONNO,
           VARSAYILANBIRIMADI, VARSAYILANBIRIMCARPAN)
        VALUES
          (@uretimInd, @stokNo, @kod, @ad, @miktar, @birim, @birimMiktar,
           @kdv, @fiyat, @tarih, @tarih, @depo,
           -1, 1, 1, 2,
           @birim, 1)
      `,
        {
          uretimInd,
          stokNo: b.stokNo,
          kod: b.kod,
          ad: b.ad,
          miktar: b.miktar,
          birim: b.birim,
          birimMiktar: b.miktar / miktar,
          kdv: h.kdv,
          fiyat: b.birimMaliyet,
          tarih,
          depo: mamulDeposu
        }
      );
    }

    // Çıktı satırı. RECETENO alanı reçeteyi değil, üretim başlığının IND'ini
    // tutuyor — alan adı yanıltıcı, Vega'nın kendi fişlerinde de böyle.
    await t.calistir(
      `
      INSERT INTO ${tablo(v, firma, donem, 'TBLUREURETIMCIKTI')}
        (EVRAKNO, STOKNO, STOKKODU, MALINCINSI, MIKTAR, BIRIM, BIRIMMIKTAR,
         KDV, FIYAT, ISLEMTARIHI, SONERISIMTARIHI, ORAN, RECETENO, TUR,
         TUTAR, POZISYONNO, KALANMIKTAR)
      VALUES
        (@uretimInd, @stokNo, @kod, @ad, @miktar, @birim, 1,
         @kdv, @fiyat, @tarih, @tarih, 100, @uretimInd, 0,
         @tutar, 2, @miktar)
    `,
      {
        uretimInd,
        stokNo: h.mamul.stokNo,
        kod: h.mamul.kod,
        ad: h.mamul.ad,
        miktar,
        birim: h.mamul.birim,
        kdv: h.kdv,
        fiyat: birimMaliyet,
        tarih,
        tutar: toplamMaliyet
      }
    );

    // Pozisyon adımları: reçetede tanımlıysa oradan kopyalanır.
    const pozSatirlari = h.pozlar.length
      ? h.pozlar
      : [
          { sira: 1, kod: 'BAŞLA', aciklama: 'BAŞLA', pozisyonNo: 100, yerNo: uretimDeposu, yerKodu: '', depoNo: uretimDeposu, depoKodu: '' },
          { sira: 2, kod: 'BİTİR', aciklama: 'BİTİR', pozisyonNo: 101, yerNo: mamulDeposu, yerKodu: '', depoNo: mamulDeposu, depoKodu: '' }
        ];
    for (const poz of pozSatirlari) {
      await t.calistir(
        `
        INSERT INTO ${tablo(v, firma, donem, 'TBLUREURETIMPOZ')}
          (EVRAKNO, SIRANO, KOD, ACIKLAMA, POZISYONNO, URETIMYERINO, URETIMYERIKODU,
           DEPONO, DEPOKODU, GIRISTARIHI, CIKISTARIHI, GIRISMIKTARI, CIKISMIKTARI,
           SUREHESAPLAMATURU, MALIYET, TOPLAMMALIYET)
        VALUES
          (@uretimInd, @sira, @kod, @aciklama, @pozisyonNo, @yerNo, @yerKodu,
           @depoNo, @depoKodu, GETDATE(), GETDATE(), @miktar, @miktar,
           1, @maliyet, @maliyet)
      `,
        {
          uretimInd,
          sira: Number(poz.sira),
          kod: poz.kod,
          aciklama: poz.aciklama || poz.kod,
          pozisyonNo: Number(poz.pozisyonNo || 0),
          yerNo: Number(poz.yerNo || 0),
          yerKodu: poz.yerKodu || '',
          depoNo: Number(poz.depoNo || 0),
          depoKodu: poz.depoKodu || '',
          miktar,
          maliyet: Number(poz.sira) === 2 ? toplamMaliyet : 0
        }
      );
    }

    // Üretim araçları (makine/tezgâh tanımları). Vega bunları reçeteden
    // olduğu gibi kopyalıyor; izleyici kaydında görülen ifade birebir bu:
    //   INSERT INTO …TBLUREURETIMARAC (…) SELECT @uretimInd, … FROM
    //   …TBLURERECETEARAC WHERE EVRAKNO = @receteNo
    // Reçetede araç tanımlı değilse hiç satır oluşmaz.
    await t.calistir(
      `
      INSERT INTO ${tablo(v, firma, donem, 'TBLUREURETIMARAC')}
        (EVRAKNO, ARACNO, ARACKODU, CALISMAUSULU, POZISYONNO, MIKTAR, BIRIMMIKTAR, SIRANO)
      SELECT @uretimInd, ARACNO, ARACKODU, CALISMAUSULU, POZISYONNO, MIKTAR, BIRIMMIKTAR, SIRANO
      FROM ${kart(v, firma, 'TBLURERECETEARAC')}
      WHERE EVRAKNO = @receteNo
    `,
      { uretimInd, receteNo: h.receteNo }
    );

    // Doğan belgeler — 1) hammadde üretim yerine, 2) geri
    const transferSatirlari = h.bilesenler.map((b) => ({
      stokNo: b.stokNo, ad: b.ad, kod: b.kod, stokTipi: b.stokTipi,
      birim: b.birim, birimEx: b.birimEx, miktar: b.miktar, birimMaliyet: b.birimMaliyet
    }));

    const transfer1 = await depoTransferiYaz(t, {
      v, firma, donem, hedefDepo: uretimDeposu, kaynakDepo: mamulDeposu,
      fisNo, tarih, satirlar: transferSatirlari, userNo: kayit.userNo, sube
    });
    const transfer2 = await depoTransferiYaz(t, {
      v, firma, donem, hedefDepo: mamulDeposu, kaynakDepo: uretimDeposu,
      fisNo, tarih, satirlar: transferSatirlari, userNo: kayit.userNo, sube
    });

    // 96/97 sayaçları — kilitli okunur
    const sayac = await uretimSayaclari(t, stokHareketTablosu);
    const tuketimBelgeNo = sayac.belgeNo + 1;
    const ciktiBelgeNo = sayac.belgeNo + 2;
    const tuketimEvrakNo = zNo(sayac.evrakNo + 1);
    const ciktiEvrakNo = zNo(sayac.evrakNo + 2);
    let ln = sayac.ln;

    // 97 — tüketim
    for (const b of h.bilesenler) {
      ln++;
      await t.calistir(
        `
        INSERT INTO ${stokHareketTablosu}
          (EVRAKNO, IZAHAT, TARIH, GIREN, CIKAN, KALAN, TUTAR, FIRMANO, STOKNO,
           BELGENO, LN, DEPO, KDV, IADE, BIRIMFIYAT, BIRIMMALIYET,
           SIRALAMATARIHI, SIRALAMATARIHIEX, KUR, PARABIRIMI, BIRIMEX, STOKTIPI, ACIKLAMA)
        VALUES
          (@evrakNo, @izahat, @tarih, 0, @miktar, 0, @tutar, 0, @stokNo,
           @belgeNo, @ln, @depo, 0, 0, @fiyat, @fiyat,
           GETDATE(), CONVERT(FLOAT, GETDATE()), 1, 'TL', @birimEx, @stokTipi, @aciklama)
      `,
        {
          evrakNo: tuketimEvrakNo,
          izahat: URETIM_TUKETIM_TIPI,
          tarih,
          miktar: b.miktar,
          tutar: b.miktar * b.birimMaliyet,
          stokNo: b.stokNo,
          belgeNo: tuketimBelgeNo,
          ln,
          depo: mamulDeposu,
          fiyat: b.birimMaliyet,
          birimEx: b.birimEx,
          stokTipi: b.stokTipi,
          aciklama: 'Galya Panel üretim ' + fisNo
        }
      );
      await t.calistir(
        `
        INSERT INTO ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
          (TARIH, STOKNO, DEPO, ENVANTER, BELGETIPI, BELGEIND, HAREKETIND,
           SIRALAMATARIHI, SIRALAMATARIHIEX)
        VALUES
          (@tarih, @stokNo, @depo, @envanter, @belgeTipi, @belgeNo, @ln,
           GETDATE(), CONVERT(FLOAT, GETDATE()))
      `,
        {
          tarih,
          stokNo: b.stokNo,
          depo: mamulDeposu,
          envanter: -b.miktar,
          belgeTipi: URETIM_TUKETIM_TIPI,
          belgeNo: tuketimBelgeNo,
          ln
        }
      );
    }

    // 96 — çıktı (mamul)
    ln++;
    const mamulSatiri = ln;
    await t.calistir(
      `
      INSERT INTO ${stokHareketTablosu}
        (EVRAKNO, IZAHAT, TARIH, GIREN, CIKAN, KALAN, TUTAR, FIRMANO, STOKNO,
         BELGENO, LN, DEPO, KDV, IADE, BIRIMFIYAT, BIRIMMALIYET,
         SIRALAMATARIHI, SIRALAMATARIHIEX, KUR, PARABIRIMI, BIRIMEX, STOKTIPI, ACIKLAMA)
      VALUES
        (@evrakNo, @izahat, @tarih, @miktar, 0, 0, @tutar, 0, @stokNo,
         @belgeNo, @ln, @depo, 0, 0, @fiyat, @fiyat,
         GETDATE(), CONVERT(FLOAT, GETDATE()), 1, 'TL', @birimEx, @stokTipi, @aciklama)
    `,
      {
        evrakNo: ciktiEvrakNo,
        izahat: URETIM_CIKTI_TIPI,
        tarih,
        miktar,
        tutar: toplamMaliyet,
        stokNo: h.mamul.stokNo,
        belgeNo: ciktiBelgeNo,
        ln: mamulSatiri,
        depo: mamulDeposu,
        fiyat: birimMaliyet,
        birimEx: h.mamul.birimEx,
        stokTipi: h.mamul.stokTipi,
        aciklama: 'Galya Panel üretim ' + fisNo
      }
    );
    await t.calistir(
      `
      INSERT INTO ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
        (TARIH, STOKNO, DEPO, ENVANTER, BELGETIPI, BELGEIND, HAREKETIND,
         SIRALAMATARIHI, SIRALAMATARIHIEX)
      VALUES
        (@tarih, @stokNo, @depo, @envanter, @belgeTipi, @belgeNo, @ln,
         GETDATE(), CONVERT(FLOAT, GETDATE()))
    `,
      {
        tarih,
        stokNo: h.mamul.stokNo,
        depo: mamulDeposu,
        envanter: miktar,
        belgeTipi: URETIM_CIKTI_TIPI,
        belgeNo: ciktiBelgeNo,
        ln: mamulSatiri
      }
    );

    // Sayaç yarışı kontrolü: kilide rağmen aynı numaraya başka bir yazan
    // girmişse (Şefim entegrasyonu) işlemi geri alıp yeniden deniyoruz.
    const cakisma = await t.sorgu(
      `SELECT COUNT(*) AS adet FROM ${stokHareketTablosu}
       WHERE BELGENO IN (@b1, @b2) AND IZAHAT IN (${URETIM_CIKTI_TIPI}, ${URETIM_TUKETIM_TIPI})
         AND EVRAKNO NOT IN (@e1, @e2)`,
      { b1: tuketimBelgeNo, b2: ciktiBelgeNo, e1: tuketimEvrakNo, e2: ciktiEvrakNo }
    );
    if (Number(cakisma[0].adet) > 0) {
      const hata = new Error('Üretim belge numarası başka bir işlem tarafından alındı.');
      hata.kod = 'SAYAC_CAKISMASI';
      throw hata;
    }

    // Doğan belgelerin dizini
    const belgeler = [
      { belgeNo: transfer1.baslikInd, izahat: DEPO_TRANSFER_TIPI, evrakNo: transfer1.belgeNo, pozisyon: 1, mamulSatiri: null },
      { belgeNo: transfer2.baslikInd, izahat: DEPO_TRANSFER_TIPI, evrakNo: transfer2.belgeNo, pozisyon: 2, mamulSatiri: null },
      { belgeNo: tuketimBelgeNo, izahat: URETIM_TUKETIM_TIPI, evrakNo: tuketimEvrakNo, pozisyon: 2, mamulSatiri: null },
      { belgeNo: ciktiBelgeNo, izahat: URETIM_CIKTI_TIPI, evrakNo: ciktiEvrakNo, pozisyon: 2, mamulSatiri: mamulSatiri }
    ];
    for (const b of belgeler) {
      await t.calistir(
        `
        INSERT INTO ${tablo(v, firma, donem, 'TBLUREBELGE')}
          (EIND, BELGENO, IZAHAT, EVRAKNO, TARIH, POZISYON, MAMULSATIRI)
        VALUES (@eind, @belgeNo, @izahat, @evrakNo, @tarih, @pozisyon, @mamulSatiri)
      `,
        {
          eind: uretimInd,
          belgeNo: b.belgeNo,
          izahat: b.izahat,
          evrakNo: b.evrakNo,
          tarih,
          pozisyon: b.pozisyon,
          mamulSatiri: b.mamulSatiri
        }
      );
    }

    return { fisNo, uretimInd, belgeler, tuketimBelgeNo, ciktiBelgeNo, mamulSatiri };
  });

  const kayitDetayi = {
    firma, donem, depo: mamulDeposu, uretimDeposu,
    mamulStokNo: h.mamul.stokNo, mamulAdi: h.mamul.ad,
    miktar, receteNo: h.receteNo, fisNo: sonuc.fisNo,
    uretimInd: sonuc.uretimInd, belgeler: sonuc.belgeler,
    bilesenler: h.bilesenler.map((b) => ({ stokNo: b.stokNo, ad: b.ad, miktar: b.miktar }))
  };

  await panel.kayit('Üretim', "Üretim fişi Vega'ya yazıldı", kayitDetayi, kayit.kullanici);

  await calistir(
    `INSERT INTO [${panel.p()}].dbo.UretimFisi
       (Firma, Donem, Depo, MamulStokNo, MamulAdi, Miktar, ReceteNo, FisNo,
        UretimInd, Kullanici, Belgeler)
     VALUES (@firma, @donem, @depo, @stokNo, @ad, @miktar, @receteNo, @fisNo,
             @uretimInd, @kullanici, @belgeler)`,
    {
      firma, donem, depo: mamulDeposu,
      stokNo: h.mamul.stokNo, ad: h.mamul.ad, miktar,
      receteNo: h.receteNo, fisNo: sonuc.fisNo, uretimInd: sonuc.uretimInd,
      kullanici: kayit.kullanici || null,
      belgeler: JSON.stringify(sonuc.belgeler)
    }
  );

  return {
    tamam: true,
    fisNo: sonuc.fisNo,
    uretimInd: sonuc.uretimInd,
    mamulAdi: h.mamul.ad,
    miktar,
    birimMaliyet,
    bilesenSayisi: h.bilesenler.length
  };
}

// Yazılan üretim fişini bütün doğan belgeleriyle birlikte siler.
async function uretimFisiGeriAl(kayit) {
  kilitKontrol();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const v = vt();
  const uretimInd = Number(kayit.uretimInd);
  if (!uretimInd) throw new Error('Geri alınacak üretim fişi kimliği eksik.');

  const belgeler = Array.isArray(kayit.belgeler) ? kayit.belgeler : [];
  const stokHareketTablosu = tablo(v, firma, donem, 'TBLSTOKHAREKETLERI');

  const silinen = await islem(async (t) => {
    let toplam = 0;
    const say = (r) => { toplam += (r[0] || 0); };

    for (const b of belgeler) {
      const izahat = Number(b.izahat);
      if (izahat === DEPO_TRANSFER_TIPI) {
        say(await t.calistir(
          `DELETE FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
           WHERE BELGEIND = @ind AND BELGETIPI = @tip`,
          { ind: Number(b.belgeNo), tip: DEPO_TRANSFER_TIPI }
        ));
        say(await t.calistir(
          `DELETE FROM ${tablo(v, firma, donem, 'TBLDEPOHARHAREKET')} WHERE EVRAKNO = @ind`,
          { ind: Number(b.belgeNo) }
        ));
        say(await t.calistir(
          `DELETE FROM ${tablo(v, firma, donem, 'TBLDEPOHARBASLIK')} WHERE IND = @ind`,
          { ind: Number(b.belgeNo) }
        ));
      } else {
        say(await t.calistir(
          `DELETE FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')}
           WHERE BELGEIND = @belgeNo AND BELGETIPI = @tip`,
          { belgeNo: Number(b.belgeNo), tip: izahat }
        ));
        say(await t.calistir(
          `DELETE FROM ${stokHareketTablosu}
           WHERE BELGENO = @belgeNo AND IZAHAT = @tip AND EVRAKNO = @evrakNo`,
          { belgeNo: Number(b.belgeNo), tip: izahat, evrakNo: b.evrakNo }
        ));
      }
    }

    for (const t2 of ['TBLUREBELGE']) {
      say(await t.calistir(
        `DELETE FROM ${tablo(v, firma, donem, t2)} WHERE EIND = @ind`,
        { ind: uretimInd }
      ));
    }
    for (const t2 of ['TBLUREURETIMARAC', 'TBLUREURETIMPOZ', 'TBLUREURETIMCIKTI', 'TBLUREURETIM']) {
      say(await t.calistir(
        `DELETE FROM ${tablo(v, firma, donem, t2)} WHERE EVRAKNO = @ind`,
        { ind: uretimInd }
      ));
    }
    say(await t.calistir(
      `DELETE FROM ${tablo(v, firma, donem, 'TBLUREURETIMLIST')} WHERE IND = @ind`,
      { ind: uretimInd }
    ));
    return toplam;
  });

  await panel.kayit(
    'Üretim',
    'Üretim fişi geri alındı',
    { firma, donem, uretimInd, silinenSatir: silinen },
    kayit.kullanici
  );

  await calistir(
    `UPDATE [${panel.p()}].dbo.UretimFisi SET GeriAlindi = 1 WHERE UretimInd = @ind AND Firma = @firma`,
    { ind: uretimInd, firma }
  );

  return { tamam: true, silinenSatir: silinen };
}

module.exports = {
  yazmaAcikMi,
  kilitKontrol,
  gkUret,
  uretimFisiYaz,
  uretimFisiGeriAl,
  siradakiNumara,
  siradakiBelgeNo,
  alisFaturasiYaz,
  alisFaturasiGeriAl,
  kod11Yaz,
  kod11GeriAl,
  giderStokSifirla,
  giderStokSifirlamaGeriAl,
  receteOlustur,
  receteSatiriEkle,
  receteSatiriGuncelle,
  receteSatiriSil,
  sayimFisiYaz,
  sayimFisiGeriAl,
  tutanakFisiYaz,
  tutanakFisiGeriAl,
  zayiFisiYaz,
  zayiFisiGeriAl,
  stokPasifYap,
  CIKIS_BELGE_TIPI,
  GIRIS_BELGE_TIPI,
  ZAYI_BELGE_TIPI,
  PASIF_KODU,
  PASIF_ALANI
};
