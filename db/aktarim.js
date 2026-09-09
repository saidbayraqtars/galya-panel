'use strict';

// Şefim'in günlük satışlarının VegaWin A5'e aktarılması.
//
// Müşteri bu işi bugüne kadar Vega'nın kendi "Şefim Entegrasyon" programıyla
// her sabah elle yapıyordu. Bu modül aynı işi panelin içinden yapar.
//
// DESEN NEREDEN ÇIKTI
// -------------------
// Gerçek Galya verisinde (F0102/D0002) Şefim Entegrasyon'un 184 gün boyunca
// yazdığı belgeler okunarak çıkarıldı ve 11.08.2026 iş günü için KURUŞU
// KURUŞUNA doğrulandı. Kurallar:
//
//   İş günü      : 04:00 → ertesi gün 04:00 (ayarlarda sefimGunKesimSaati).
//                  11.08 kasa hareketleri 12.08 00:06'ya kadar sürüyor.
//   Satış satırı : Bill ⋈ BillHeader, BillState = 1 (kapanmış adisyon),
//                  Canceling = 0, **veresiye adisyonlar hariç**.
//   Vega satırı  : (ürün adı, fiyat) grubu. MIKTAR = Σ Quantity,
//                  Price KDV DAHİLDİR; FIYATI = Price / (1 + KDV/100).
//   Belge toplamı: nakit + kredi kartı tahsilatı. Satır toplamıyla arasındaki
//                  kuruş farkı başlıktaki YUVARLAMA alanına yazılır.
//
// VERESİYE ADİSYONLAR AYRI BELGEYE GİDİYOR
// ----------------------------------------
// Veresiye kapanan adisyon ŞEFSATIŞ belgesine girmiyor — parası alınmadığı
// için günün tahsilatına dahil değil. Kanıtı: 11.08'de üç adisyon Debit ile
// kapanmıştı (950,00 + 835,00 + 750,00 = 2.535,00 TL). Şefim satır toplamı
// 145.445,21, ŞEFSATIŞ belgesi 142.910,21 — fark tam 2.535,00.
//
// Ama kaybolmuyorlar: her veresiye MÜŞTERİSİ için AYRI bir stok çıkış fişi
// kesiliyor ve tutar o carinin borcuna yazılıyor (A0000474 ERTUĞRUL AVCI
// 950,01 · A0000475 ONUR ÇEBİ 835,00 · A0000476 YENİ - 6030 750,00).
// Cari kartı yoksa Şefim'deki müşteri adıyla açılıyor.
//
// Dikkat: borca yazılan tutar adisyonun TAM tutarıdır, indirim düşülmez.
// ONUR ÇEBİ'nin adisyonu 584,50 veresiye + 250,50 indirimdi; Vega 835,00
// borç yazdı. Panel aynısını yapıyor.
//
// VEGA'NIN KENDİ PROGRAMINDAKİ KUSUR
// ----------------------------------
// Şefim Entegrasyon, aktarmadığı satırları da `Bill.Aktarildi = 1` diye
// işaretliyor. Veresiye adisyonun satırları Vega'ya hiç gitmiyor ama bir daha
// da denenmiyor. Panel bunu tekrarlamaz: yalnızca gerçekten yazdığı Bill
// kimliklerini işaretler, kalanı ertesi gün yeniden aday olur.

const { sorgu } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, kart, tablo } = require('./firma');
const panel = require('./panel');
const yazma = require('./yazma');

function vt() {
  return ayarOku().vegaVeritabani;
}
function sf() {
  return ayarOku().sefimVeritabani;
}
function kesim() {
  const s = Number(ayarOku().sefimGunKesimSaati);
  return Number.isFinite(s) && s >= 0 && s < 12 ? s : 4;
}

// 'YYYY-MM-DD' — iş gününün etiketi. Date nesnesi saat dilimine göre bir gün
// kayabildiği için metin üzerinden gidiliyor.
function gunMetni(deger) {
  if (deger instanceof Date) {
    return (
      deger.getUTCFullYear() +
      '-' +
      String(deger.getUTCMonth() + 1).padStart(2, '0') +
      '-' +
      String(deger.getUTCDate()).padStart(2, '0')
    );
  }
  const m = String(deger || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error('Geçersiz tarih: ' + deger);
  return m[1] + '-' + m[2] + '-' + m[3];
}

// --- Kart çözümleme --------------------------------------------------------

async function cariBul(v, firma, kod) {
  const r = await sorgu(
    `SELECT TOP 1 IND AS ind, FIRMAKODU AS kod, FIRMAADI AS ad
     FROM ${kart(v, firma, 'TBLCARI')}
     WHERE ISNULL(DELETED, 0) = 0 AND (FIRMAKODU = @kod OR FIRMAADI = @kod)
     ORDER BY IND`,
    { kod }
  );
  return r[0] || null;
}

async function cariler(firma) {
  const v = vt();
  const a = ayarOku();
  const satis = await cariBul(v, firma, a.sefimSatisCarisi || 'ŞEFSATIŞ');
  const kasa = await cariBul(v, firma, a.sefimKasaCarisi || 'ŞEFİMKASA');
  return { satis, kasa };
}

// --- Gün listesi ve mutabakat ---------------------------------------------

// Şefim'de satışı olan iş günleri ile Vega'daki karşılıklarının yan yana
// listesi. "Aktarıldı mı" sorusunun tek doğru cevabı burası: Bill.Aktarildi
// alanına BAKILMAZ, çünkü Vega'nın programı yazmadığı satırı da işaretliyor.
async function gunler(secim) {
  await panel.kur();
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const s = sf();
  const p = panel.p();
  const k = kesim();
  const gun = Math.min(Number(secim.gun || 60), 400);
  const c = await cariler(firma);
  if (!c.satis) {
    throw new Error(
      `Satış carisi bulunamadı ("${ayarOku().sefimSatisCarisi}"). ` +
        'Ayarlar ekranından cari kodunu düzeltin.'
    );
  }

  return sorgu(
    `
    WITH SefimGun AS (
      SELECT CAST(DATEADD(hour, -@kesim, B.Date) AS date) AS isGunu,
             SUM(B.Quantity * B.Price) AS hamTutar,
             COUNT(*) AS satirSayisi
      FROM [${s}].dbo.Bill B
      JOIN [${s}].dbo.BillHeader H ON H.Id = B.HeaderId
      WHERE ISNULL(B.Canceling, 0) = 0
        AND H.BillState = 1
        AND B.Date >= DATEADD(hour, @kesim, CAST(DATEADD(day, -@gun, CAST(GETDATE() AS date)) AS datetime))
      GROUP BY CAST(DATEADD(hour, -@kesim, B.Date) AS date)
    ),
    VegaGun AS (
      SELECT CAST(TARIH AS date) AS isGunu,
             COUNT(*) AS belgeSayisi,
             SUM(TUTAR) AS tutar,
             MIN(BELGENO) AS belgeNo
      FROM ${tablo(v, firma, donem, 'TBLSTKCIKBASLIK')}
      WHERE FIRMANO = @satisNo
      GROUP BY CAST(TARIH AS date)
    ),
    -- Bu dönemin başladığı gün. Şefim'in satış geçmişi Vega dönemininkinden
    -- eski: F0102/D0002'de 184 günlük belge varken Şefim'de 341 gün satış
    -- var. Aradaki fark "aktarılmamış gün" değil, BAŞKA DÖNEME ait gündür;
    -- bugün aktarılırsa yanlış döneme belge yazılır.
    DonemBasi AS (
      SELECT MIN(isGunu) AS ilkGun FROM VegaGun
    ),
    PanelGun AS (
      SELECT IsGunu AS isGunu, MAX(Id) AS panelId
      FROM [${p}].dbo.SefimAktarim
      WHERE Firma = @firma AND Donem = @donem AND GeriAlindi = 0
      GROUP BY IsGunu
    )
    SELECT TOP 400
      S.isGunu,
      S.hamTutar,
      S.satirSayisi,
      ISNULL(V.belgeSayisi, 0) AS belgeSayisi,
      V.tutar   AS vegaTutari,
      V.belgeNo AS vegaBelgeNo,
      P.panelId,
      CASE
        WHEN V.isGunu IS NOT NULL THEN 'aktarildi'
        WHEN D.ilkGun IS NOT NULL AND S.isGunu < D.ilkGun THEN 'kapsamDisi'
        ELSE 'eksik'
      END AS durum
    FROM SefimGun S
    CROSS JOIN DonemBasi D
    LEFT JOIN VegaGun  V ON V.isGunu = S.isGunu
    LEFT JOIN PanelGun P ON P.isGunu = S.isGunu
    ORDER BY S.isGunu DESC
  `,
    { kesim: k, gun, satisNo: c.satis.ind, firma, donem }
  );
}

// --- Bir iş gününün dökümü -------------------------------------------------

// Aktarılacak satış satırları. Vega'ya yazılacak belgenin satırlarıyla
// birebir aynı kümedir; önizleme de yazma da bunu kullanır.
async function satisSatirlari(firma, donem, isGunu, k) {
  const s = sf();
  const v = vt();
  return sorgu(
    `
    WITH Kapsam AS (
      SELECT B.Id, B.ProductName, B.Price, B.Quantity, B.Ikram, B.Zayi
      FROM [${s}].dbo.Bill B
      JOIN [${s}].dbo.BillHeader H ON H.Id = B.HeaderId
      WHERE ISNULL(B.Canceling, 0) = 0
        AND H.BillState = 1
        AND B.Date >= DATEADD(hour, @kesim, @gun)
        AND B.Date <  DATEADD(hour, @kesim, DATEADD(day, 1, @gun))
        -- Veresiye kapanan adisyon aktarılmaz: parası alınmadığı için
        -- ŞEFSATIŞ tahsilatına girmiyor, Vega'nın programı da almıyor.
        AND NOT EXISTS (
          SELECT 1 FROM [${s}].dbo.Payment P
          WHERE P.HeaderId = H.Id AND ISNULL(P.Debit, 0) <> 0
        )
    ),
    Grup AS (
      SELECT ProductName AS urun, Price AS fiyat,
             SUM(Quantity) AS miktar,
             SUM(CASE WHEN ISNULL(Ikram, 0) = 1 THEN Quantity ELSE 0 END) AS ikram,
             SUM(CASE WHEN ISNULL(Zayi, 0) = 1 THEN Quantity ELSE 0 END) AS zayi
      FROM Kapsam GROUP BY ProductName, Price
    ),
    -- ÜRÜN → STOK KARTI EŞLEŞMESİ, üç kademeli:
    --
    --   1. Panelin kendi eşleştirme tablosu (kullanıcı elle bağladıysa).
    --   2. Vega'nın GEÇMİŞ Şefim belgelerinde aynı ürün adına yazdığı kart —
    --      EN SON kullanılanı. Firma zaman zaman bir ürünü başka bir karta
    --      bağlıyor (birkaç bira "BAŞLANGIÇ İKRAM"a, "Karpuz Tabağı"
    --      "FİX 7 YAŞ ALTI"na bağlanmış); en SIK kullanılan alınırsa eski
    --      eşleşme kazanıyor ve stok yanlış karttan düşüyor.
    --   3. Birebir isim eşleşmesi (geçmişi olmayan yeni ürün).
    --
    -- 11.08.2026 iş günü bu zincirle Vega'nın kendi belgesinin 105 satırının
    -- 103'ünü birebir üretiyor. Kalanı ekranda "eşleşmedi" diye görünür ve
    -- kullanıcı bir kez bağlayınca kalıcı olur.
    Ogrenilen AS (
      SELECT urun, stokNo FROM (
        SELECT LTRIM(RTRIM(H.MALINCINSI)) AS urun, H.STOKNO AS stokNo,
               ROW_NUMBER() OVER (
                 PARTITION BY LTRIM(RTRIM(H.MALINCINSI)) ORDER BY MAX(H.IND) DESC) AS sira
        FROM ${tablo(v, firma, donem, 'TBLSTKCIKHAREKET')} H
        JOIN ${tablo(v, firma, donem, 'TBLSTKCIKBASLIK')} B ON B.IND = H.EVRAKNO
        WHERE B.OZELKOD4 = 'SEFIM' AND ISNULL(H.MALINCINSI, '') <> ''
        GROUP BY LTRIM(RTRIM(H.MALINCINSI)), H.STOKNO
      ) X WHERE sira = 1
    )
    SELECT
      G.urun, G.fiyat, G.miktar, G.ikram, G.zayi,
      COALESCE(E.VegaStokNo, S.IND)         AS stokNo,
      COALESCE(E.VegaStokAdi, S.MALINCINSI) AS stokAdi,
      ISNULL(S.STOKKODU, '')                AS stokKodu,
      ISNULL(S.STOKTIPI, 0)                 AS stokTipi,
      ISNULL(S.MALIYET, 0)                  AS maliyet,
      ISNULL(K.KDV, 0)                      AS kdv,
      ISNULL(BR.BIRIMADI, '')               AS birim,
      ISNULL(BR.IND, 0)                     AS birimEx,
      ISNULL(E.BirimCarpan, 1)              AS birimCarpan,
      ISNULL(E.Yoksay, 0)                   AS yoksay
    FROM Grup G
    LEFT JOIN [${panel.p()}].dbo.UrunEslestirme E
           ON E.Firma = @firma AND E.SefimUrunAdi = G.urun
    LEFT JOIN Ogrenilen O ON O.urun = LTRIM(RTRIM(G.urun))
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S
           ON S.IND = COALESCE(E.VegaStokNo, O.stokNo,
                (SELECT TOP 1 X.IND FROM ${kart(v, firma, 'TBLSTOKLAR')} X
                 WHERE X.MALINCINSI = G.urun AND ISNULL(X.DELETED, 0) = 0 ORDER BY X.IND))
    LEFT JOIN ${kart(v, firma, 'TBLKDVGRUPLARI')} K ON K.IND = S.KDVGRUBU
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} BR ON BR.STOKNO = S.IND AND BR.VARSAYILAN = 1
    ORDER BY G.urun, G.fiyat
  `,
    { kesim: k, gun: isGunu, firma }
  );
}

// Aktarılan satırların Bill kimlikleri — yazma sonrası Aktarildi işaretlemesi
// YALNIZ bunlara konuyor.
//
// Vega'nın kendi programı gün içindeki bütün satırları işaretliyor, yazmadığı
// satırları bile; o satırlar bir daha aday olmuyor ve sessizce kayboluyor.
// Panel yalnız belgeye giren ürünleri işaretliyor: eşleşmeyen bir ürün
// kartına bağlandığı gün yeniden aktarılabiliyor.
//
// Veresiye adisyonlar da dahil — onlar da müşteri fişine yazılıyor.
async function billKimlikleri(firma, isGunu, k, urunler) {
  if (!urunler.length) return [];
  const s = sf();
  const r = await sorgu(
    `
    SELECT B.Id
    FROM [${s}].dbo.Bill B
    JOIN [${s}].dbo.BillHeader H ON H.Id = B.HeaderId
    WHERE ISNULL(B.Canceling, 0) = 0
      AND H.BillState = 1
      AND B.Date >= DATEADD(hour, @kesim, @gun)
      AND B.Date <  DATEADD(hour, @kesim, DATEADD(day, 1, @gun))
      AND B.ProductName IN (${urunler.map((_, i) => '@u' + i).join(',')})
  `,
    Object.assign(
      { kesim: k, gun: isGunu },
      ...urunler.map((u, i) => ({ ['u' + i]: u }))
    )
  );
  return r.map((x) => Number(x.Id));
}

// Günün tahsilat dağılımı. Vega'da her ödeme türü için ayrı bir cari giriş
// belgesi (tip 13) kesiliyor.
//
// IZAHAT değerleri Vega'nın kendi ödeme türü listesidir; gerçek belgelerde
// nakit 1, kredi kartı 11 olarak görüldü.
const ODEME_TURLERI = [
  { alan: 'CashPayment', ad: 'Nakit Ödeme', kod: 'NAKİT', izahat: 1, kasaya: true },
  { alan: 'CreditPayment', ad: 'Kredi kartı', kod: 'KREDİKARTI', izahat: 11, kasaya: false },
  { alan: 'TicketPayment', ad: 'Yemek kartı', kod: 'YEMEKKARTI', izahat: 11, kasaya: false },
  { alan: 'OnlinePayment', ad: 'Online ödeme', kod: 'ONLINE', izahat: 11, kasaya: false }
];

async function tahsilat(isGunu, k) {
  const s = sf();
  const r = await sorgu(
    `
    SELECT ${ODEME_TURLERI.map((o) => `SUM(ISNULL(${o.alan}, 0)) AS ${o.alan}`).join(', ')},
           SUM(ISNULL(Discount, 0)) AS indirim,
           SUM(ISNULL(Debit, 0))    AS veresiye,
           COUNT(*) AS adisyon
    FROM [${s}].dbo.Payment
    WHERE PaymentTime >= DATEADD(hour, @kesim, @gun)
      AND PaymentTime <  DATEADD(hour, @kesim, DATEADD(day, 1, @gun))
  `,
    { kesim: k, gun: isGunu }
  );
  const c = r[0] || {};
  return {
    satirlar: ODEME_TURLERI.map((o) => ({
      ad: o.ad,
      kod: o.kod,
      izahat: o.izahat,
      kasaya: o.kasaya,
      tutar: Number(c[o.alan] || 0)
    })).filter((x) => Math.abs(x.tutar) > 0.0001),
    indirim: Number(c.indirim || 0),
    veresiye: Number(c.veresiye || 0),
    adisyon: Number(c.adisyon || 0)
  };
}

// Şefim'de elle girilen kasa hareketleri. Total < 0 gider (Vega'da cari
// çıkış, tip 11), Total > 0 giriş (cari giriş, tip 13).
async function kasaHareketleri(isGunu, k) {
  const s = sf();
  const r = await sorgu(
    `
    SELECT Id, Date, Description, Total, UserName
    FROM [${s}].dbo.DirectTransaction
    WHERE Date >= DATEADD(hour, @kesim, @gun)
      AND Date <  DATEADD(hour, @kesim, DATEADD(day, 1, @gun))
    ORDER BY Id
  `,
    { kesim: k, gun: isGunu }
  );
  return r.map((x) => ({
    id: Number(x.Id),
    tarih: x.Date,
    // Vega'nın kendi belgelerinde satır açıklaması "açıklama (kullanıcı)"
    // biçiminde; birebir aynısı yazılıyor.
    aciklama: (String(x.Description || '') + ' (' + String(x.UserName || '') + ')').substring(0, 100),
    tutar: Number(x.Total || 0)
  }));
}

// Veresiye (Debit) kapanan adisyonlar. ŞEFSATIŞ belgesine girmiyorlar; her
// MÜŞTERİ için ayrı bir stok çıkış fişi kesiliyor ve tutar o carinin borcuna
// yazılıyor. Müşteri adı Şefim'in Payment.CustomerName alanından geliyor.
//
// Borca yazılan tutar adisyonun TAM tutarıdır (indirim düşülmez) — Vega'nın
// kendi programı da böyle yapıyor, bkz. dosya başındaki not.
async function veresiyeAdisyonlar(firma, donem, isGunu, k) {
  const s = sf();
  const v = vt();
  const ham = await sorgu(
    `
    WITH Kapsam AS (
      SELECT LTRIM(RTRIM(ISNULL(P.CustomerName, ''))) AS musteri,
             B.ProductName AS urun, B.Price AS fiyat, B.Quantity AS miktar
      FROM [${s}].dbo.Bill B
      JOIN [${s}].dbo.BillHeader H ON H.Id = B.HeaderId
      JOIN [${s}].dbo.Payment P ON P.HeaderId = H.Id
      WHERE ISNULL(B.Canceling, 0) = 0
        AND H.BillState = 1
        AND ISNULL(P.Debit, 0) <> 0
        AND B.Date >= DATEADD(hour, @kesim, @gun)
        AND B.Date <  DATEADD(hour, @kesim, DATEADD(day, 1, @gun))
    ),
    Grup AS (
      SELECT musteri, urun, fiyat, SUM(miktar) AS miktar
      FROM Kapsam GROUP BY musteri, urun, fiyat
    ),
    Ogrenilen AS (
      SELECT urun, stokNo FROM (
        SELECT LTRIM(RTRIM(H.MALINCINSI)) AS urun, H.STOKNO AS stokNo,
               ROW_NUMBER() OVER (
                 PARTITION BY LTRIM(RTRIM(H.MALINCINSI)) ORDER BY MAX(H.IND) DESC) AS sira
        FROM ${tablo(v, firma, donem, 'TBLSTKCIKHAREKET')} H
        JOIN ${tablo(v, firma, donem, 'TBLSTKCIKBASLIK')} B ON B.IND = H.EVRAKNO
        WHERE B.OZELKOD4 = 'SEFIM' AND ISNULL(H.MALINCINSI, '') <> ''
        GROUP BY LTRIM(RTRIM(H.MALINCINSI)), H.STOKNO
      ) X WHERE sira = 1
    )
    SELECT
      G.musteri, G.urun, G.fiyat, G.miktar,
      COALESCE(E.VegaStokNo, S.IND)         AS stokNo,
      COALESCE(E.VegaStokAdi, S.MALINCINSI) AS stokAdi,
      ISNULL(S.STOKKODU, '')                AS stokKodu,
      ISNULL(S.STOKTIPI, 0)                 AS stokTipi,
      ISNULL(S.MALIYET, 0)                  AS maliyet,
      ISNULL(KD.KDV, 0)                     AS kdv,
      ISNULL(BR.BIRIMADI, '')               AS birim,
      ISNULL(BR.IND, 0)                     AS birimEx,
      ISNULL(E.Yoksay, 0)                   AS yoksay,
      C.IND                                 AS cariNo
    FROM Grup G
    LEFT JOIN [${panel.p()}].dbo.UrunEslestirme E
           ON E.Firma = @firma AND E.SefimUrunAdi = G.urun
    LEFT JOIN Ogrenilen O ON O.urun = LTRIM(RTRIM(G.urun))
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S
           ON S.IND = COALESCE(E.VegaStokNo, O.stokNo,
                (SELECT TOP 1 X.IND FROM ${kart(v, firma, 'TBLSTOKLAR')} X
                 WHERE X.MALINCINSI = G.urun AND ISNULL(X.DELETED, 0) = 0 ORDER BY X.IND))
    LEFT JOIN ${kart(v, firma, 'TBLKDVGRUPLARI')} KD ON KD.IND = S.KDVGRUBU
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} BR ON BR.STOKNO = S.IND AND BR.VARSAYILAN = 1
    LEFT JOIN ${kart(v, firma, 'TBLCARI')} C
           ON (C.FIRMAKODU = G.musteri OR C.FIRMAADI = G.musteri) AND ISNULL(C.DELETED, 0) = 0
    ORDER BY G.musteri, G.urun
  `,
    { kesim: k, gun: isGunu, firma }
  );

  const musteriler = new Map();
  for (const r of ham) {
    const ad = String(r.musteri || '').trim();
    if (!musteriler.has(ad)) {
      musteriler.set(ad, {
        musteri: ad,
        cariNo: r.cariNo != null ? Number(r.cariNo) : null,
        // Cari kartı yoksa yazma sırasında açılacak; ekranda görünsün diye
        // işaretleniyor.
        cariAcilacak: r.cariNo == null,
        satirlar: [],
        eslesmeyen: []
      });
    }
    const m = musteriler.get(ad);
    const kdvOrani = Number(r.kdv) || 0;
    const kdvli = Number(r.fiyat);
    const miktar = Number(r.miktar);
    if (!r.stokNo || Number(r.yoksay)) {
      m.eslesmeyen.push({ urun: r.urun, miktar, fiyat: kdvli });
      continue;
    }
    m.satirlar.push({
      urun: r.urun,
      urunler: [r.urun],
      stokNo: Number(r.stokNo),
      stokAdi: r.stokAdi,
      stokKodu: r.stokKodu || '',
      stokTipi: Number(r.stokTipi) || 0,
      birim: r.birim || '',
      birimEx: Number(r.birimEx) || 0,
      maliyet: Number(r.maliyet) || 0,
      kdv: kdvOrani,
      miktar,
      kdvliFiyat: kdvli,
      fiyat: kdvli / (1 + kdvOrani / 100),
      tutar: (miktar * kdvli) / (1 + kdvOrani / 100),
      kdvliTutar: miktar * kdvli,
      ikram: 0,
      zayi: 0
    });
  }

  return [...musteriler.values()]
    .filter((m) => m.satirlar.length || m.eslesmeyen.length)
    .map((m) =>
      Object.assign(m, {
        toplam: m.satirlar.reduce((x, y) => x + y.kdvliTutar, 0),
        araToplam: m.satirlar.reduce((x, y) => x + y.tutar, 0)
      })
    );
}

// Ekranın ve yazmanın ortak girdisi. Hiçbir yere yazmaz.
async function onizleme(secim) {
  await panel.kur();
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const isGunu = gunMetni(secim.tarih);
  const k = kesim();
  const v = vt();
  const c = await cariler(firma);

  const ham = await satisSatirlari(firma, donem, isGunu, k);
  const eslesen = ham.filter((x) => x.stokNo && !Number(x.yoksay));
  const eslesmeyen = ham.filter((x) => !x.stokNo && !Number(x.yoksay));
  const yoksayilan = ham.filter((x) => Number(x.yoksay));

  // Vega belgesinde satır = (stok kartı, KDV dahil fiyat). İki farklı Şefim
  // ürünü aynı karta bağlanmışsa (firma birkaç birayı tek karta bağlamış) tek
  // satırda toplanır; ayrı yazılırsa belge Vega'nınkiyle tutmuyor.
  const birlesik = new Map();
  for (const r of eslesen) {
    const kdvOrani = Number(r.kdv) || 0;
    const miktar = Number(r.miktar) * (Number(r.birimCarpan) || 1);
    const kdvli = Number(r.fiyat);
    const anahtar = Number(r.stokNo) + '|' + kdvli.toFixed(4);
    const varOlan = birlesik.get(anahtar);
    if (varOlan) {
      varOlan.miktar += miktar;
      varOlan.ikram += Number(r.ikram) || 0;
      varOlan.zayi += Number(r.zayi) || 0;
      if (!varOlan.urunler.includes(r.urun)) varOlan.urunler.push(r.urun);
      continue;
    }
    birlesik.set(anahtar, {
      urun: r.urun,
      urunler: [r.urun],
      stokNo: Number(r.stokNo),
      stokAdi: r.stokAdi,
      stokKodu: r.stokKodu || '',
      stokTipi: Number(r.stokTipi) || 0,
      birim: r.birim || '',
      birimEx: Number(r.birimEx) || 0,
      maliyet: Number(r.maliyet) || 0,
      kdv: kdvOrani,
      miktar,
      kdvliFiyat: kdvli,
      fiyat: kdvli / (1 + kdvOrani / 100),
      ikram: Number(r.ikram) || 0,
      zayi: Number(r.zayi) || 0
    });
  }
  const satirlar = [...birlesik.values()].map((x) =>
    Object.assign(x, { tutar: x.miktar * x.fiyat, kdvliTutar: x.miktar * x.kdvliFiyat })
  );

  const t = await tahsilat(isGunu, k);
  const kasa = await kasaHareketleri(isGunu, k);
  const veresiye = await veresiyeAdisyonlar(firma, donem, isGunu, k);
  const satirToplami = satirlar.reduce((a, b) => a + b.kdvliTutar, 0);
  const tahsilatToplami = t.satirlar.reduce((a, b) => a + b.tutar, 0);

  // Gün, seçili Vega döneminin başlangıcından eski mi? Öyleyse aktarılamaz.
  const donemBasi = await sorgu(
    `SELECT MIN(CAST(TARIH AS date)) AS ilkGun
     FROM ${tablo(v, firma, donem, 'TBLSTKCIKBASLIK')}
     WHERE FIRMANO = @satisNo`,
    { satisNo: c.satis ? c.satis.ind : 0 }
  );
  const ilkGun = donemBasi[0] && donemBasi[0].ilkGun ? gunMetni(donemBasi[0].ilkGun) : null;
  const kapsamDisi = !!(ilkGun && isGunu < ilkGun);

  const p = panel.p();
  const mevcut = await sorgu(
    `SELECT TOP 1 Id AS id, Tarih AS tarih, Kullanici AS kullanici, Bilgisayar AS bilgisayar,
            SatisTutari AS tutar, Durum AS durum
     FROM [${p}].dbo.SefimAktarim
     WHERE Firma = @firma AND Donem = @donem AND IsGunu = @gun AND GeriAlindi = 0`,
    { firma, donem, gun: isGunu }
  );

  // AYNI GÜN İKİ KEZ AKTARILMASIN — Vega tarafına da bakılıyor.
  //
  // Panelin kendi kaydı yeterli değil: aynı günü Vega'nın kendi "Şefim
  // Entegrasyon" programı da aktarmış olabilir (müşteri iki yolu bir süre
  // birlikte kullanacak). O durumda panelde kayıt yok ama Vega'da belge var;
  // ikinci kez aktarılırsa günün satışı stoktan İKİ KEZ düşer.
  const vegaBelgesi = await sorgu(
    `SELECT TOP 1 BELGENO AS belgeNo, TUTAR AS tutar, OZELKOD4 AS isaret
     FROM ${tablo(v, firma, donem, 'TBLSTKCIKBASLIK')}
     WHERE FIRMANO = @satisNo AND CAST(TARIH AS date) = @gun AND ISNULL(IPTAL, 0) = 0
     ORDER BY IND`,
    { satisNo: c.satis ? c.satis.ind : 0, gun: isGunu }
  );

  // MUTABAKAT. Satır toplamı ile tahsilat birbirini tutmalı; aradaki fark
  // Vega'da da kuruş mertebesinde (11.08'de −0,0299). Büyük bir fark
  // "yuvarlama" değil, kaybolan satırdır: eşleşmeyen ya da yoksayılan bir
  // ürün belgeye girmemiş demektir. Bu durumda yazma engelleniyor —
  // 4.100 TL'lik bir "yuvarlama" ile Vega'ya belge kesmek, sonradan
  // bulunması çok zor bir stok hatası bırakır.
  const yuvarlama = tahsilatToplami - satirToplami;
  const esik = Math.max(1, Math.abs(tahsilatToplami) * 0.0005);
  const uyarilar = [];
  if (Math.abs(yuvarlama) > esik) {
    uyarilar.push({
      kod: 'MUTABAKAT',
      engel: true,
      mesaj:
        `Satır toplamı (${satirToplami.toFixed(2)} TL) ile tahsilat ` +
        `(${tahsilatToplami.toFixed(2)} TL) arasında ${Math.abs(yuvarlama).toFixed(2)} TL ` +
        'fark var. Bu bir yuvarlama farkı değil; aşağıdaki eşleşmeyen ya da ' +
        'yoksayılan ürünler belgeye girmiyor. Önce onları bir stok kartına ' +
        'bağlayın.'
    });
  }
  if (eslesmeyen.length) {
    uyarilar.push({
      kod: 'ESLESMEYEN',
      engel: false,
      mesaj:
        `${eslesmeyen.length} ürün hiçbir stok kartına bağlı değil ve belgeye ` +
        'girmiyor: ' + eslesmeyen.map((x) => x.urun).join(', ')
    });
  }
  const veresiyeEslesmeyen = veresiye.reduce((n, m) => n + m.eslesmeyen.length, 0);
  if (veresiyeEslesmeyen) {
    uyarilar.push({
      kod: 'VERESIYE_ESLESMEYEN',
      engel: false,
      mesaj:
        `Veresiye adisyonlarda ${veresiyeEslesmeyen} ürün stok kartına bağlı ` +
        'değil; o müşterinin fişine girmiyor.'
    });
  }
  const acilacakCari = veresiye.filter((m) => m.cariAcilacak && m.satirlar.length);
  if (acilacakCari.length) {
    uyarilar.push({
      kod: 'CARI_ACILACAK',
      engel: false,
      mesaj:
        `${acilacakCari.length} veresiye müşterisinin Vega'da cari kartı yok; ` +
        'aktarımda açılacak: ' + acilacakCari.map((m) => m.musteri || '(adsız)').join(', ')
    });
  }
  if (yoksayilan.length) {
    uyarilar.push({
      kod: 'YOKSAYILAN',
      engel: false,
      mesaj:
        `${yoksayilan.length} ürün eşleştirme ekranında "yoksay" işaretli, ` +
        'belgeye girmiyor: ' + yoksayilan.map((x) => x.urun).join(', ')
    });
  }

  if (vegaBelgesi[0] && !(mevcut[0] && mevcut[0].durum === 'tamam')) {
    uyarilar.push({
      kod: 'VEGADA_BELGE_VAR',
      engel: true,
      mesaj:
        `Bu güne ait stok çıkış belgesi Vega'da ZATEN VAR ` +
        `(${vegaBelgesi[0].belgeNo}, ${Number(vegaBelgesi[0].tutar).toFixed(2)} TL). ` +
        'Muhtemelen Vega\'nın kendi Şefim Entegrasyon programı aktarmış. ' +
        'Yeniden aktarılırsa günün satışı stoktan iki kez düşer.'
    });
  }
  if (kapsamDisi) {
    uyarilar.push({
      kod: 'KAPSAM_DISI',
      engel: true,
      mesaj:
        `Bu gün seçili dönemin (${donem}) ilk belgesinden (${ilkGun}) eski. ` +
        'Şefim satış geçmişi Vega döneminden uzun; eski günler başka bir ' +
        'döneme ait ve buraya aktarılmamalı.'
    });
  }

  return {
    isGunu,
    kesimSaati: k,
    kapsamDisi,
    donemIlkGunu: ilkGun,
    satisCarisi: c.satis,
    kasaCarisi: c.kasa,
    uyarilar,
    satirlar,
    eslesmeyen: eslesmeyen.map((x) => ({
      urun: x.urun,
      miktar: Number(x.miktar),
      fiyat: Number(x.fiyat)
    })),
    yoksayilan: yoksayilan.map((x) => ({ urun: x.urun, miktar: Number(x.miktar) })),
    tahsilat: t,
    kasaHareketleri: kasa,
    veresiye,
    toplam: {
      satir: satirlar.length,
      satirToplami,
      tahsilatToplami,
      // Vega belgesinin TUTAR alanı tahsilat toplamıdır; aradaki kuruş farkı
      // başlıktaki YUVARLAMA alanına gider. Kuruştan büyükse fark yuvarlama
      // değildir — aşağıdaki `uyari` bunu yakalıyor.
      yuvarlama: tahsilatToplami - satirToplami,
      kasaGiris: kasa.filter((x) => x.tutar > 0).reduce((a, b) => a + b.tutar, 0),
      kasaCikis: kasa.filter((x) => x.tutar < 0).reduce((a, b) => a - b.tutar, 0),
      veresiyeMusteri: veresiye.filter((m) => m.satirlar.length).length,
      veresiyeToplami: veresiye.reduce((a, b) => a + b.toplam, 0)
    },
    zatenAktarildi: mevcut[0] || null,
    vegadaBelgeVar: vegaBelgesi[0] || null
  };
}

// --- Yazma ve geri alma ----------------------------------------------------

async function aktar(secim, kim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const isGunu = gunMetni(secim.tarih);
  const on = await onizleme({ firma, donem, tarih: isGunu });

  // AYNI GÜNÜ İKİNCİ KEZ AKTARMA — birinci kapı.
  //
  // Aynı günü iki kişi aktarırsa günün satışı stoktan İKİ KEZ düşer ve cari
  // iki kez borçlanır; geri alması da elle iş olur. Üç kapı var:
  //
  //   1. Burada: panelin kendi kaydına bakılıyor.
  //   2. onizleme(): Vega'da o güne ait belge var mı (Vega'nın kendi Şefim
  //      Entegrasyon programı aktarmış olabilir — panelde kaydı olmaz).
  //   3. Aşağıda: yazmaya başlamadan ÖNCE gün "yaziliyor" diye rezerve
  //      ediliyor. Asıl kilit budur; 1 ve 2 önden uyarı, 3 yarıştan koruyor.
  //
  // 1 ve 2 tek başına yetmez: iki kişi aynı saniyede düğmeye basarsa ikisi de
  // kontrolü geçer, ikisi de Vega'ya yazar. 3'teki benzersizlik kısıtı
  // ikincisini veritabanı seviyesinde durduruyor.
  if (on.zatenAktarildi && !secim.tekrar) {
    const z = on.zatenAktarildi;
    const e = new Error(
      z.durum === 'yaziliyor'
        ? `${isGunu} ŞU AN başka bir kullanıcı tarafından aktarılıyor ` +
          `(${z.kullanici || 'bilinmeyen'}${z.bilgisayar ? ' · ' + z.bilgisayar : ''}, ` +
          `${new Date(z.tarih).toLocaleString('tr-TR')}). Bitmesini bekleyin.`
        : `${isGunu} zaten aktarılmış (${new Date(z.tarih).toLocaleString('tr-TR')}` +
          `${z.kullanici ? ', ' + z.kullanici : ''}). ` +
          'Yeniden aktarmak için önce mevcut aktarımı geri alın.'
    );
    e.kod = z.durum === 'yaziliyor' ? 'AKTARIM_SURUYOR' : 'ZATEN_AKTARILDI';
    throw e;
  }
  if (!on.satirlar.length && !on.kasaHareketleri.length && !on.veresiye.length) {
    const e = new Error(`${isGunu} için aktarılacak satış ya da kasa hareketi yok.`);
    e.kod = 'BOS_GUN';
    throw e;
  }
  // Mutabakatı tutmayan gün yazılmaz. `zorla` yalnız yöneticinin bilerek
  // geçmesi için; ekran farkı büyük harflerle gösteriyor.
  const engel = (on.uyarilar || []).filter((u) => u.engel);
  if (engel.length && !secim.zorla) {
    const e = new Error(engel.map((u) => u.mesaj).join(' '));
    e.kod = 'MUTABAKAT';
    throw e;
  }
  if (!on.satisCarisi) throw new Error('Satış carisi bulunamadı; Ayarlar ekranından kontrol edin.');
  if (on.kapsamDisi) {
    const e = new Error(
      `${isGunu}, seçili dönemin (${donem}) başlangıcından eski. O günün ` +
        'satışı başka bir döneme ait; bu döneme yazılırsa belge yanlış yere ' +
        'düşer. Doğru dönemi üst çubuktan seçin.'
    );
    e.kod = 'KAPSAM_DISI';
    throw e;
  }
  if (on.kasaHareketleri.length && !on.kasaCarisi) {
    throw new Error('Kasa carisi bulunamadı; Ayarlar ekranından kontrol edin.');
  }

  const depo =
    Number(secim.depo || ayarOku().sefimDepo || ayarOku().varsayilanDepo) || 0;
  if (!depo) throw new Error('Aktarım için depo seçilmeli.');

  const p = panel.p();

  // GÜNÜ REZERVE ET — Vega'ya tek satır yazmadan önce.
  //
  // SefimAktarim üzerindeki süzgeçli benzersiz indeks (Firma, Donem, IsGunu
  // · GeriAlindi = 0) burada kilit görevi görüyor: aynı anda gelen ikinci
  // INSERT veritabanı seviyesinde reddediliyor. Yukarıdaki okuma kontrolleri
  // yarışı çözemez, bu çözüyor.
  let rezervasyonId = null;
  try {
    const r = await sorgu(
      `INSERT INTO [${p}].dbo.SefimAktarim
         (Firma, Donem, Depo, IsGunu, Kullanici, Bilgisayar, Durum)
       OUTPUT INSERTED.Id AS id
       VALUES (@firma, @donem, @depo, @gun, @kul, @bil, 'yaziliyor')`,
      {
        firma,
        donem,
        depo,
        gun: isGunu,
        kul: (kim && kim.kullanici) || null,
        bil: (kim && kim.bilgisayar) || null
      }
    );
    rezervasyonId = r[0].id;
  } catch (e) {
    // Benzersizlik ihlali = başka biri aynı anda başlamış.
    if (/duplicate key|UQ_SefimAktarim_Gun/i.test(e.message || '')) {
      const yeni = new Error(
        `${isGunu} şu anda başka bir kullanıcı tarafından aktarılıyor. ` +
          'Vega\'ya hiçbir şey yazılmadı. Birkaç saniye sonra ekranı yenileyin.'
      );
      yeni.kod = 'AKTARIM_SURUYOR';
      throw yeni;
    }
    throw e;
  }

  let sonuc;
  try {
    sonuc = await yazma.sefimAktarimYaz({
    firma,
    donem,
    depo,
    isGunu,
    satisCariNo: on.satisCarisi.ind,
    satisCariAdi: on.satisCarisi.kod,
    kasaCariNo: on.kasaCarisi ? on.kasaCarisi.ind : null,
    kasaCariAdi: on.kasaCarisi ? on.kasaCarisi.kod : null,
    satirlar: on.satirlar,
    tahsilat: on.tahsilat.satirlar,
    kasaHareketleri: on.kasaHareketleri,
    veresiye: on.veresiye.filter((m) => m.satirlar.length),
      toplam: on.toplam,
      kullanici: kim && kim.kullanici
    });
  } catch (e) {
    // Yazma başarısız: rezervasyon kalkıyor, gün yeniden aktarılabilir hâle
    // dönüyor. sefimAktarimYaz tek işlem olduğu için Vega'da yarım belge
    // kalmıyor.
    await sorgu(`DELETE FROM [${p}].dbo.SefimAktarim WHERE Id = @id`, { id: rezervasyonId })
      .catch(() => {});
    throw e;
  }

  const urunler = Array.from(
    new Set(
      on.satirlar
        .reduce((liste, x) => liste.concat(x.urunler || [x.urun]), [])
        .concat(
          on.veresiye.reduce(
            (liste, m) => liste.concat(m.satirlar.map((x) => x.urun)),
            []
          )
        )
    )
  );
  const billIdler = await billKimlikleri(firma, isGunu, kesim(), urunler);
  // Şefim tarafına "aktarıldı" işareti. Başarısız olursa aktarım geçerli
  // kalıyor (panel kendi kaydına bakıyor) ama Vega'nın kendi Şefim
  // Entegrasyon programı aynı günü bir kez daha aktarabilir; bu yüzden
  // sonuç ekrana taşınıyor.
  const isaret = await yazma.sefimSatirlariIsaretle(billIdler);

  // Rezervasyon satırı sonuçla tamamlanıyor.
  await sorgu(
    `UPDATE [${p}].dbo.SefimAktarim
     SET SatisTutari = @tutar, SatirSayisi = @satir, KasaGiris = @kgir,
         KasaCikis = @kcik, BillIdler = @bill, Belgeler = @belge,
         Durum = 'tamam', Tarih = GETDATE()
     WHERE Id = @id`,
    {
      id: rezervasyonId,
      tutar: on.toplam.tahsilatToplami,
      satir: on.toplam.satir,
      kgir: on.toplam.kasaGiris,
      kcik: on.toplam.kasaCikis,
      bill: JSON.stringify(billIdler),
      belge: JSON.stringify(sonuc.belgeler)
    }
  );

  await panel.kayit(
    'Şefim Aktarımı',
    `${isGunu} Vega'ya aktarıldı`,
    {
      firma,
      donem,
      depo,
      isGunu,
      belgeler: sonuc.belgeler,
      satir: on.toplam.satir,
      tutar: on.toplam.tahsilatToplami,
      isaretlenenBill: billIdler.length
    },
    kim && kim.kullanici,
    kim && kim.bilgisayar
  );

  return {
    tamam: true,
    id: rezervasyonId,
    isGunu,
    belgeler: sonuc.belgeler,
    satir: on.toplam.satir,
    tutar: on.toplam.tahsilatToplami,
    isaretlenenBill: billIdler.length,
    sefimIsareti: isaret,
    // Ekranın gösterdiği uyarı. Yetki yoksa müşteri bunu görmeli.
    sefimIsaretiUyarisi: isaret && isaret.tamam
      ? null
      : "Aktarım yazıldı, ancak Şefim tarafındaki \"aktarıldı\" işareti " +
        'konulamadı (SQL kullanıcısının sefim veritabanında yazma yetkisi yok). ' +
        "Vega'nın kendi Şefim Entegrasyon programı bu günü bir kez daha " +
        'aktarabilir — o programı bu gün için ÇALIŞTIRMAYIN. Kalıcı çözüm: ' +
        'kurulum/sql-yazma-yetkisi-ver.sql betiğini çalıştırın.'
  };
}

async function gecmis(secim) {
  await panel.kur();
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  return sorgu(
    `SELECT TOP 200 Id AS id, IsGunu AS isGunu, Tarih AS tarih, Depo AS depo,
            SatisTutari AS tutar, SatirSayisi AS satir, KasaGiris AS kasaGiris,
            KasaCikis AS kasaCikis, Kullanici AS kullanici, Bilgisayar AS bilgisayar,
            Durum AS durum, GeriAlindi AS geriAlindi, Belgeler AS belgeler,
            CASE WHEN Durum = 'yaziliyor' AND DATEDIFF(minute, Tarih, GETDATE()) > @omur
                 THEN 1 ELSE 0 END AS asiliKalmis
     FROM [${p}].dbo.SefimAktarim
     WHERE Firma = @firma AND Donem = @donem
     ORDER BY Id DESC`,
    { firma, donem, omur: ASILI_KALMA_DK }
  );
}

// ASILI KALAN REZERVASYONU TEMİZLEME
//
// Aktarım sırasında program çakarsa ya da ağ koparsa satır 'yaziliyor'da
// kalır ve o gün bir daha aktarılamaz. Bu, yazma başlamadan önce rezerve
// etmenin bedeli — alternatifi iki kişinin aynı günü aktarabilmesiydi.
//
// Temizlik ELLE ve yalnız YÖNETİCİ tarafından yapılıyor, üstelik yalnız
// yeterince eskimiş satırlar için: hâlâ süren bir aktarımın kilidini kaldırmak
// tam da önlemeye çalıştığımız çift aktarımı açardı.
//
// Temizlemeden önce Vega'ya bakılıyor: belge yazılmışsa rezervasyon 'tamam'a
// çevriliyor (aktarım aslında bitmiş, sadece kayıt güncellenememiş); belge
// yoksa satır siliniyor ve gün yeniden aday oluyor.
const ASILI_KALMA_DK = 15;

async function kilitTemizle(secim, kim) {
  await panel.kur();
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const p = panel.p();
  const id = Number(secim.id);
  if (!id) throw new Error('Temizlenecek kaydın kimliği eksik.');

  const r = await sorgu(
    `SELECT Id AS id, IsGunu AS isGunu, Durum AS durum, Kullanici AS kullanici,
            DATEDIFF(minute, Tarih, GETDATE()) AS dakika
     FROM [${p}].dbo.SefimAktarim
     WHERE Firma = @firma AND Donem = @donem AND Id = @id`,
    { firma, donem, id }
  );
  const k = r[0];
  if (!k) throw new Error('Kayıt bulunamadı.');
  if (k.durum !== 'yaziliyor') {
    throw new Error('Bu kayıt asılı kalmış bir aktarım değil; temizlemeye gerek yok.');
  }
  if (Number(k.dakika) < ASILI_KALMA_DK) {
    const e = new Error(
      `Bu aktarım ${k.dakika} dakikadır sürüyor. Hâlâ çalışıyor olabilir ` +
        `(${k.kullanici || 'bilinmeyen kullanıcı'}). En az ${ASILI_KALMA_DK} dakika ` +
        'geçmeden kilidi kaldırmayın; kaldırılırsa aynı gün iki kez aktarılabilir.'
    );
    e.kod = 'HENUZ_ERKEN';
    throw e;
  }

  const isGunu = gunMetni(k.isGunu);
  const c = await cariler(firma);
  const belge = await sorgu(
    `SELECT TOP 1 BELGENO AS belgeNo FROM ${tablo(v, firma, donem, 'TBLSTKCIKBASLIK')}
     WHERE FIRMANO = @satisNo AND CAST(TARIH AS date) = @gun AND ISNULL(IPTAL, 0) = 0`,
    { satisNo: c.satis ? c.satis.ind : 0, gun: isGunu }
  );

  if (belge[0]) {
    await sorgu(`UPDATE [${p}].dbo.SefimAktarim SET Durum = 'tamam' WHERE Id = @id`, { id });
    await panel.kayit(
      'Şefim Aktarımı',
      'Asılı kalan aktarım "tamam" olarak işaretlendi',
      { firma, donem, id, isGunu, vegaBelgesi: belge[0].belgeNo },
      kim && kim.kullanici,
      kim && kim.bilgisayar
    );
    return {
      tamam: true,
      sonuc: 'tamamlandi',
      mesaj:
        `Vega'da ${belge[0].belgeNo} belgesi bulundu — aktarım aslında ` +
        'yapılmış, kayıt düzeltildi. Gün yeniden aktarılmayacak.'
    };
  }

  await sorgu(`DELETE FROM [${p}].dbo.SefimAktarim WHERE Id = @id`, { id });
  await panel.kayit(
    'Şefim Aktarımı',
    'Asılı kalan aktarım kaydı silindi',
    { firma, donem, id, isGunu },
    kim && kim.kullanici,
    kim && kim.bilgisayar
  );
  return {
    tamam: true,
    sonuc: 'silindi',
    mesaj: `Vega'da o güne ait belge yok; kayıt silindi. ${isGunu} yeniden aktarılabilir.`
  };
}

async function geriAl(secim, kim) {
  await panel.kur();
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  const id = Number(secim.id);
  if (!id) throw new Error('Geri alınacak aktarımın kimliği eksik.');

  const r = await sorgu(
    `SELECT Id AS id, IsGunu AS isGunu, Belgeler AS belgeler, BillIdler AS billIdler,
            GeriAlindi AS geriAlindi, Durum AS durum
     FROM [${p}].dbo.SefimAktarim WHERE Firma = @firma AND Donem = @donem AND Id = @id`,
    { firma, donem, id }
  );
  const k = r[0];
  if (!k) throw new Error('Aktarım kaydı bulunamadı.');
  if (k.geriAlindi) throw new Error('Bu aktarım zaten geri alınmış.');
  if (k.durum === 'yaziliyor') {
    const e = new Error(
      'Bu aktarım hâlâ sürüyor ya da yarıda kalmış; geri alınamaz. ' +
        'Yarıda kaldıysa "asılı kalan kaydı temizle" ile çözülür.'
    );
    e.kod = 'AKTARIM_SURUYOR';
    throw e;
  }

  let belgeler = [];
  let billIdler = [];
  try {
    belgeler = JSON.parse(k.belgeler || '[]');
  } catch (e) {
    belgeler = [];
  }
  try {
    billIdler = JSON.parse(k.billIdler || '[]');
  } catch (e) {
    billIdler = [];
  }

  const silinen = await yazma.sefimAktarimGeriAl({ firma, donem, belgeler });
  await yazma.sefimSatirlariIsaretle(billIdler, 0);

  await sorgu(`UPDATE [${p}].dbo.SefimAktarim SET GeriAlindi = 1 WHERE Id = @id`, { id });
  await panel.kayit(
    'Şefim Aktarımı',
    `${gunMetni(k.isGunu)} aktarımı geri alındı`,
    { firma, donem, id, belgeler, silinenSatir: silinen, billGeriAlinan: billIdler.length },
    kim && kim.kullanici,
    kim && kim.bilgisayar
  );

  return { tamam: true, silinenSatir: silinen, billGeriAlinan: billIdler.length };
}

module.exports = {
  gunler,
  onizleme,
  aktar,
  gecmis,
  geriAl,
  kilitTemizle,
  ASILI_KALMA_DK,
  cariler,
  ODEME_TURLERI
};
