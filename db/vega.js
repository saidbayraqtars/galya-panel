'use strict';

// VEGADB üzerinden yapılan bütün okumalar burada. Bu dosyada tek bir
// INSERT / UPDATE / DELETE yoktur — Vega'ya yazma işlemleri db/yazma.js içindedir.

const { sorgu } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, tablo, kart, tabloVarMi } = require('./firma');

function vt() {
  return ayarOku().vegaVeritabani;
}

// Üretim modülü hiç kullanılmamış firmalarda reçete tabloları oluşmamış olabilir.
async function receteVarMi(firma) {
  return (
    (await tabloVarMi(firma, null, 'TBLURERECETELIST')) &&
    (await tabloVarMi(firma, null, 'TBLURERECETE'))
  );
}

// Depo envanteri hareket başına delta tutuyor; güncel stok = deltaların toplamı.
// BELGETIPI 67 rezerv hareketi olduğu için mevcut Vega raporlarıyla uyumlu
// kalmak adına toplamdan çıkarılıyor.
function kalanAltSorgu(v, f, d) {
  return `
    SELECT E.STOKNO, SUM(E.ENVANTER) AS KALAN
    FROM ${tablo(v, f, d, 'TBLDEPOENVANTER')} E
    WHERE (@depo = 0 OR E.DEPO = @depo)
      AND E.BELGETIPI <> 67
    GROUP BY E.STOKNO
  `;
}

// Kullanımdan kalkmış kartlar listeyi boğmasın diye "aktif ürün" tanımı:
// son @aktifGun gün içinde en az bir stok hareketi görmüş kartlar.
function aktifAltSorgu(v, f, d) {
  return `
    SELECT DISTINCT H.STOKNO
    FROM ${tablo(v, f, d, 'TBLSTOKHAREKETLERI')} H
    WHERE H.TARIH >= DATEADD(day, -@aktifGun, CAST(GETDATE() AS date))
  `;
}

async function stokDurumu(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const a = ayarOku();
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : a.varsayilanDepo) || 0;
  const ust = Number(secim.kritikUst != null ? secim.kritikUst : a.kritikStokUst);

  const aktifGun = Number(secim.aktifGun != null ? secim.aktifGun : a.aktifGun) || 90;

  return sorgu(
    `
    WITH K AS (${kalanAltSorgu(v, firma, donem)}),
         A AS (${aktifAltSorgu(v, firma, donem)})
    SELECT
      S.IND            AS stokNo,
      S.MALINCINSI     AS ad,
      S.STOKKODU       AS kod,
      S.KOD1           AS grup,
      S.KOD11          AS kod11,
      S.STOKTIPI       AS stokTipi,
      ISNULL(K.KALAN, 0)      AS kalan,
      ISNULL(S.ALTSEVIYE, 0)  AS altSeviye,
      ISNULL(S.KRITIKSEVIYE, 0) AS kritikSeviye,
      ISNULL(S.MALIYET, 0)    AS maliyet,
      ISNULL(B.BIRIMADI, '')  AS birim,
      CASE
        WHEN ISNULL(K.KALAN, 0) < 0 THEN 'eksi'
        WHEN ISNULL(K.KALAN, 0) = 0 THEN 'sifir'
        WHEN ISNULL(K.KALAN, 0) <= CASE WHEN ISNULL(S.KRITIKSEVIYE,0) > 0
                                        THEN S.KRITIKSEVIYE ELSE @ust END THEN 'azalan'
        ELSE 'normal'
      END AS durum
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    JOIN A ON A.STOKNO = S.IND
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    WHERE ISNULL(S.DELETED, 0) = 0
      AND S.IND >= 100
      AND S.STOKTIPI NOT IN (3, 7, 9)
      AND (@sadeceSorunlu = 0 OR
           ISNULL(K.KALAN, 0) <= CASE WHEN ISNULL(S.KRITIKSEVIYE,0) > 0
                                      THEN S.KRITIKSEVIYE ELSE @ust END)
    ORDER BY ISNULL(K.KALAN, 0) ASC, S.MALINCINSI ASC
  `,
    { depo, ust, aktifGun, sadeceSorunlu: secim.sadeceSorunlu ? 1 : 0 }
  );
}

// Stok kontrol listesi: teorik stok + kritik seviye + değer.
// Fiziki sayım karşılıkları panel veritabanından geldiği için burada değil,
// db/sayim.js içindeki fizikiSayimlar() ile birleştiriliyor.
//
// suzgec: 'tumu' | 'eksi' | 'sifir' | 'azalan' | 'sorunlu'
async function stokKontrolListesi(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const a = ayarOku();
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : a.varsayilanDepo) || 0;
  const ust = Number(secim.kritikUst != null ? secim.kritikUst : a.kritikStokUst);
  const aktifGun = Number(secim.aktifGun != null ? secim.aktifGun : a.aktifGun) || 90;
  const suzgec = secim.suzgec || 'sorunlu';
  const tumKartlar = secim.tumKartlar ? 1 : 0;

  // Eşik: karta özel kritik seviye varsa o, yoksa ayarlardaki genel üst sınır.
  const esik = `CASE WHEN ISNULL(S.KRITIKSEVIYE,0) > 0 THEN S.KRITIKSEVIYE ELSE @ust END`;
  const kalan = `ISNULL(K.KALAN, 0)`;

  const suzgecler = {
    tumu: '1 = 1',
    eksi: `${kalan} < 0`,
    sifir: `${kalan} = 0`,
    azalan: `${kalan} > 0 AND ${kalan} <= ${esik}`,
    sorunlu: `${kalan} <= ${esik}`
  };

  return sorgu(
    `
    WITH K AS (${kalanAltSorgu(v, firma, donem)}),
         A AS (${aktifAltSorgu(v, firma, donem)})
    SELECT
      S.IND                     AS stokNo,
      S.MALINCINSI              AS ad,
      ISNULL(S.STOKKODU, '')    AS kod,
      ISNULL(S.KOD1, '')        AS grup,
      S.STOKTIPI                AS stokTipi,
      ISNULL(B.BIRIMADI, '')    AS birim,
      ${kalan}                  AS teorik,
      ISNULL(S.KRITIKSEVIYE, 0) AS kritikSeviye,
      ISNULL(S.MALIYET, 0)      AS birimMaliyet,
      ${kalan} * ISNULL(S.MALIYET, 0) AS deger,
      CASE
        WHEN ${kalan} < 0 THEN 'eksi'
        WHEN ${kalan} = 0 THEN 'sifir'
        WHEN ${kalan} <= ${esik} THEN 'azalan'
        ELSE 'normal'
      END AS durum
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    ${tumKartlar ? 'LEFT JOIN' : 'JOIN'} A ON A.STOKNO = S.IND
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    WHERE ISNULL(S.DELETED, 0) = 0
      AND S.IND >= 100
      AND S.STOKTIPI NOT IN (3, 7, 9)
      AND (${suzgecler[suzgec] || suzgecler.sorunlu})
    ORDER BY ${kalan} ASC, S.MALINCINSI ASC
  `,
    { depo, ust, aktifGun }
  );
}

// Gider ve hizmet kartları (STOKTIPI = 3): elektrik, su, nakliye, reklam gibi.
// Bunların stok miktarı olmaması gerekir; Vega bu kartlarda miktarı elle
// sıfırlatmadığı için birikmiş bakiye kalıyor.
async function giderHizmetStoklari(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;

  return sorgu(
    `
    WITH K AS (${kalanAltSorgu(v, firma, donem)})
    SELECT
      S.IND                  AS stokNo,
      S.MALINCINSI           AS ad,
      ISNULL(S.STOKKODU, '') AS kod,
      S.STOKTIPI             AS stokTipi,
      ISNULL(B.BIRIMADI, '') AS birim,
      ISNULL(K.KALAN, 0)     AS kalan,
      ISNULL(S.MALIYET, 0)   AS birimMaliyet,
      ISNULL(K.KALAN, 0) * ISNULL(S.MALIYET, 0) AS deger
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    WHERE ISNULL(S.DELETED, 0) = 0
      AND S.IND >= 100
      AND S.STOKTIPI = 3
      AND (@sadeceDolu = 0 OR ISNULL(K.KALAN, 0) <> 0)
    ORDER BY ABS(ISNULL(K.KALAN, 0)) DESC, S.MALINCINSI
  `,
    { depo, sadeceDolu: secim.sadeceDolu === false ? 0 : 1 }
  );
}

async function stokAra(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  const terim = '%' + String(secim.terim || '').trim() + '%';

  return sorgu(
    `
    WITH K AS (${kalanAltSorgu(v, firma, donem)})
    SELECT TOP 200
      S.IND AS stokNo,
      S.MALINCINSI AS ad,
      S.STOKKODU AS kod,
      S.KOD1 AS grup,
      ISNULL(K.KALAN, 0) AS kalan,
      ISNULL(S.MALIYET, 0) AS maliyet,
      ISNULL(B.BIRIMADI, '') AS birim
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      AND (S.MALINCINSI LIKE @terim OR S.STOKKODU LIKE @terim)
    ORDER BY S.MALINCINSI
  `,
    { depo, terim }
  );
}

async function stokHareketleri(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const gun = Number(secim.gun || 30);

  return sorgu(
    `
    SELECT TOP 300
      H.TARIH        AS tarih,
      H.IZAHAT       AS izahat,
      H.BELGENO      AS belgeNo,
      ISNULL(H.GIREN, 0)  AS giren,
      ISNULL(H.CIKAN, 0)  AS cikan,
      ISNULL(H.BIRIMFIYAT, 0) AS birimFiyat,
      ISNULL(H.ACIKLAMA, '')  AS aciklama,
      ISNULL(C.FIRMAADI, '')  AS cari
    FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')} H
    LEFT JOIN ${kart(v, firma, 'TBLCARI')} C ON C.IND = H.FIRMANO
    WHERE H.STOKNO = @stokNo
      AND H.TARIH >= DATEADD(day, -@gun, CAST(GETDATE() AS date))
    ORDER BY H.TARIH DESC, H.IND DESC
  `,
    { stokNo: Number(secim.stokNo), gun }
  );
}

// --- Reçete ---------------------------------------------------------------
//
// Vega'da reçete iki tablodan oluşuyor:
//   TBLURERECETELIST : reçete başlığı. IND = reçete numarası,
//                      STOKNO = üretilen mamul, MIKTAR = reçetenin verdiği miktar
//   TBLURERECETE     : reçete satırları. EVRAKNO = başlığın IND'i (stok no DEĞİL),
//                      STOKNO = kullanılan hammadde/yarı mamul
// Alt reçete bağı satırın STOKNO'su üzerinden kurulur: o stoğun kendi
// başlığı varsa ağaç bir seviye daha derinleşir.

async function receteliMamuller(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  if (!(await receteVarMi(firma))) return [];
  return sorgu(`
    SELECT
      L.IND                       AS receteNo,
      L.STOKNO                    AS mamulStokNo,
      ISNULL(S.MALINCINSI, L.MALINCINSI) AS mamulAdi,
      ISNULL(L.MIKTAR, 1)         AS verim,
      ISNULL(L.BIRIM, '')         AS birim,
      ISNULL(L.ACIKLAMA, '')      AS aciklama,
      ISNULL(R.satirSayisi, 0)    AS satirSayisi
    FROM ${kart(v, firma, 'TBLURERECETELIST')} L
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = L.STOKNO
    LEFT JOIN (
      SELECT EVRAKNO, COUNT(*) AS satirSayisi
      FROM ${kart(v, firma, 'TBLURERECETE')}
      GROUP BY EVRAKNO
    ) R ON R.EVRAKNO = L.IND
    ORDER BY ISNULL(S.MALINCINSI, L.MALINCINSI)
  `);
}

async function receteSatirlari(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  if (!(await receteVarMi(firma))) return [];
  return sorgu(
    `
    SELECT
      R.DETAY         AS sira,
      R.STOKNO        AS stokNo,
      ISNULL(S.MALINCINSI, R.MALINCINSI) AS ad,
      ISNULL(R.MIKTAR, 0)     AS miktar,
      ISNULL(R.BIRIM, '')     AS birim,
      ISNULL(R.FIREORANI, 0)  AS fireOrani,
      ISNULL(R.RANDIMAN, 0)   AS randiman,
      ISNULL(S.MALIYET, 0)    AS maliyet,
      ISNULL(S.STOKTIPI, 0)   AS stokTipi,
      AL.IND                  AS altReceteNo
    FROM ${kart(v, firma, 'TBLURERECETE')} R
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = R.STOKNO
    OUTER APPLY (
      SELECT TOP 1 L2.IND
      FROM ${kart(v, firma, 'TBLURERECETELIST')} L2
      WHERE L2.STOKNO = R.STOKNO
      ORDER BY L2.IND
    ) AL
    WHERE R.EVRAKNO = @receteNo
    ORDER BY R.DETAY
  `,
    { receteNo: Number(secim.receteNo) }
  );
}

// Çok seviyeli ağaç: mamul → yarı mamul → yarı mamul
async function receteAgaci(secim, seviye, gorulen) {
  seviye = seviye || 0;
  gorulen = gorulen || new Set();
  if (seviye > 6) return [];
  const anahtar = String(secim.receteNo);
  if (gorulen.has(anahtar)) return [];
  gorulen.add(anahtar);

  const satirlar = await receteSatirlari(secim);
  for (const s of satirlar) {
    s.seviye = seviye;
    s.altRecetesiVar = s.altReceteNo != null ? 1 : 0;
    if (s.altReceteNo != null) {
      s.alt = await receteAgaci(
        { firma: secim.firma, donem: secim.donem, receteNo: s.altReceteNo },
        seviye + 1,
        gorulen
      );
    }
  }
  return satirlar;
}

// --- THIRD (Özel Kod 11) --------------------------------------------------

async function thirdAdaylari(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  if (!(await receteVarMi(firma))) return [];

  // Aday: kendi reçetesi olan (yani üretim gerektiren) stoklar.
  // Reçete bağı TBLURERECETELIST.STOKNO üzerinden kurulur.
  return sorgu(
    `
    WITH K AS (${kalanAltSorgu(v, firma, donem)})
    SELECT
      S.IND                AS stokNo,
      S.MALINCINSI         AS ad,
      ISNULL(S.KOD11, '')  AS kod11,
      ISNULL(K.KALAN, 0)   AS kalan,
      ISNULL(S.KRITIKSEVIYE, 0) AS kritikSeviye,
      R.receteNo,
      ISNULL(R.satirSayisi, 0) AS receteSatiri
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    JOIN (
      SELECT
        L.STOKNO,
        MIN(L.IND) AS receteNo,
        SUM(ISNULL(A.satirSayisi, 0)) AS satirSayisi
      FROM ${kart(v, firma, 'TBLURERECETELIST')} L
      LEFT JOIN (
        SELECT EVRAKNO, COUNT(*) AS satirSayisi
        FROM ${kart(v, firma, 'TBLURERECETE')}
        GROUP BY EVRAKNO
      ) A ON A.EVRAKNO = L.IND
      GROUP BY L.STOKNO
    ) R ON R.STOKNO = S.IND
    LEFT JOIN K ON K.STOKNO = S.IND
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
    ORDER BY ISNULL(K.KALAN, 0) ASC, S.MALINCINSI
  `,
    { depo }
  );
}

// --- Maliyet --------------------------------------------------------------

async function maliyetiEskimisler(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const gun = Number(secim.gun != null ? secim.gun : ayarOku().maliyetEskimeGun);

  // Alış fiyatı değişmiş ama kart maliyeti hâlâ eski/boş kalan stoklar.
  return sorgu(
    `
    SELECT
      S.IND AS stokNo,
      S.MALINCINSI AS ad,
      ISNULL(S.ALISFIYATI, 0)     AS alisFiyati,
      ISNULL(S.ESKIALISFIYATI, 0) AS eskiAlisFiyati,
      ISNULL(S.MALIYET, 0)        AS maliyet,
      S.ALISFIYATIDEGISMETARIHI   AS fiyatDegismeTarihi,
      S.SONALISTARIHI             AS sonAlisTarihi,
      CASE
        WHEN ISNULL(S.MALIYET, 0) = 0 THEN 'Maliyet hiç hesaplanmamış'
        WHEN ISNULL(S.ALISFIYATI, 0) > 0
         AND ABS(ISNULL(S.MALIYET,0) - S.ALISFIYATI) / S.ALISFIYATI > 0.10
             THEN 'Maliyet ile alış fiyatı arasında %10''dan fazla fark var'
        ELSE 'Alış fiyatı değişmiş'
      END AS sebep
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      AND S.STOKTIPI NOT IN (3, 7, 9)
      AND ISNULL(S.ALISFIYATI, 0) > 0
      AND (
            ISNULL(S.MALIYET, 0) = 0
         OR ABS(ISNULL(S.MALIYET,0) - S.ALISFIYATI) / S.ALISFIYATI > 0.10
         OR (S.ALISFIYATIDEGISMETARIHI IS NOT NULL
             AND S.ALISFIYATIDEGISMETARIHI >= DATEADD(day, -@gun, GETDATE()))
      )
    ORDER BY S.ALISFIYATIDEGISMETARIHI DESC
  `,
    { gun }
  );
}

// --- Cari -----------------------------------------------------------------

async function cariBakiye(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  return sorgu(`
    SELECT
      C.FIRMAKODU AS kod,
      C.FIRMAADI  AS ad,
      ISNULL(SUM(H.BORC), 0)   AS borc,
      ISNULL(SUM(H.ALACAK), 0) AS alacak,
      ISNULL(SUM(H.BORC - H.ALACAK), 0) AS bakiye
    FROM ${kart(v, firma, 'TBLCARI')} C
    LEFT JOIN ${tablo(v, firma, donem, 'TBLCARIHAREKETLERI')} H
           ON H.FIRMANO = C.IND
          AND H.IZAHAT NOT IN (18, 19, 30, 31)
    WHERE ISNULL(C.DELETED, 0) = 0 AND C.IND >= 100
      AND C.FIRMATIPI NOT IN (11, 12)
    GROUP BY C.FIRMAKODU, C.FIRMAADI
    HAVING ISNULL(SUM(H.BORC - H.ALACAK), 0) <> 0
    ORDER BY ISNULL(SUM(H.BORC - H.ALACAK), 0) DESC
  `);
}

// --- E-Fatura -------------------------------------------------------------

async function bekleyenFaturalar(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  if (!(await tabloVarMi(firma, donem, 'TBLEFAINBOX'))) return [];
  return sorgu(`
    SELECT
      IND        AS id,
      Evrakno    AS evrakNo,
      Tarih      AS tarih,
      FirmaAdi   AS tedarikci,
      VKN        AS vkn,
      ISNULL(Tutar, 0) AS tutar,
      ISNULL(PB, 'TL') AS paraBirimi,
      ISNULL(Senaryo, '') AS senaryo,
      ISNULL(IMPORTSTATUS, 0) AS durum,
      KabulTarihi AS kabulTarihi
    FROM ${tablo(v, firma, donem, 'TBLEFAINBOX')}
    WHERE ISNULL(IMPORTSTATUS, 0) = 0
    ORDER BY Tarih DESC
  `);
}

async function faturaUrunEslesmeleri(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  if (!(await tabloVarMi(firma, null, 'TBLEFAPRODUCTMATCH'))) return [];
  return sorgu(`
    SELECT
      M.IND       AS id,
      M.STOKKODU  AS tedarikciKodu,
      M.STOKNO    AS stokNo,
      ISNULL(S.MALINCINSI, '') AS stokAdi,
      ISNULL(C.FIRMAADI, '')   AS tedarikci
    FROM ${kart(v, firma, 'TBLEFAPRODUCTMATCH')} M
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = M.STOKNO
    LEFT JOIN ${kart(v, firma, 'TBLCARI')} C ON C.IND = M.CARINO
    ORDER BY ISNULL(C.FIRMAADI, ''), M.STOKKODU
  `);
}

// --- Günlük hareket özeti -------------------------------------------------

const IZAHAT_ADLARI = {
  20: 'Alış faturası',
  22: 'Alış iadesi',
  32: 'Stok giriş fişi',
  33: 'Stok çıkış fişi',
  90: 'Devir girişi',
  93: 'Sayım girişi',
  94: 'Sayım çıkışı',
  96: 'Üretim çıktısı',
  97: 'Üretim tüketimi'
};

async function gunlukHareket(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const gun = Number(secim.gun || 1);
  const satirlar = await sorgu(
    `
    SELECT
      H.IZAHAT AS izahat,
      COUNT(*) AS adet,
      ISNULL(SUM(H.GIREN), 0) AS giren,
      ISNULL(SUM(H.CIKAN), 0) AS cikan,
      ISNULL(SUM(H.TUTAR), 0) AS tutar
    FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')} H
    WHERE H.TARIH >= DATEADD(day, -@gun, CAST(GETDATE() AS date))
    GROUP BY H.IZAHAT
    ORDER BY COUNT(*) DESC
  `,
    { gun }
  );
  for (const s of satirlar) s.ad = IZAHAT_ADLARI[s.izahat] || ('Kod ' + s.izahat);
  return satirlar;
}

async function sonHareketTarihi(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const r = await sorgu(`
    SELECT MAX(TARIH) AS sonTarih
    FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')}
  `);
  return r[0] ? r[0].sonTarih : null;
}

module.exports = {
  stokDurumu,
  stokKontrolListesi,
  giderHizmetStoklari,
  stokAra,
  stokHareketleri,
  receteliMamuller,
  receteSatirlari,
  receteAgaci,
  thirdAdaylari,
  maliyetiEskimisler,
  cariBakiye,
  bekleyenFaturalar,
  faturaUrunEslesmeleri,
  gunlukHareket,
  sonHareketTarihi,
  IZAHAT_ADLARI
};
