'use strict';

// Vega Şefim (satış) tarafındaki okumalar ve Şefim ürünü ↔ Vega stok kartı
// eşleştirmesi. Eşleştirme kayıtları GALYA_PANEL veritabanında tutulur;
// Şefim veritabanına da yazılmaz.

const { sorgu, calistir } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, kart, tabloVarMi } = require('./firma');
const panel = require('./panel');
const { stokPasifHaric } = require('./vega');

function sf() {
  return ayarOku().sefimVeritabani;
}
function vt() {
  return ayarOku().vegaVeritabani;
}

async function satisOzeti(secim) {
  const s = sf();
  const gun = Number(secim && secim.gun ? secim.gun : 1);
  return sorgu(
    `
    SELECT TOP 300
      B.ProductName AS urun,
      SUM(B.Quantity) AS miktar,
      SUM(B.Quantity * B.Price) AS tutar,
      SUM(CASE WHEN ISNULL(B.Ikram, 0) = 1 THEN B.Quantity ELSE 0 END) AS ikram,
      SUM(CASE WHEN ISNULL(B.Zayi,  0) = 1 THEN B.Quantity ELSE 0 END) AS zayi
    FROM [${s}].dbo.Bill B
    WHERE B.Date >= DATEADD(day, -@gun, CAST(GETDATE() AS date))
      AND ISNULL(B.Canceling, 0) = 0
    GROUP BY B.ProductName
    ORDER BY SUM(B.Quantity) DESC
  `,
    { gun }
  );
}

// Satılan ürün adları ile Vega stok kartlarının eşleşme durumu.
// Önce panelin kendi eşleştirme tablosuna, orada yoksa birebir isim eşleşmesine bakılır.
async function eslestirmeDurumu(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const s = sf();
  const v = vt();
  const p = panel.p();
  const gun = Number(secim.gun || 45);

  return sorgu(
    `
    WITH Satilan AS (
      SELECT B.ProductName AS urun,
             SUM(B.Quantity) AS miktar,
             MAX(B.Date) AS sonSatis
      FROM [${s}].dbo.Bill B
      WHERE B.Date >= DATEADD(day, -@gun, CAST(GETDATE() AS date))
        AND ISNULL(B.Canceling, 0) = 0
      GROUP BY B.ProductName
    )
    SELECT
      T.urun,
      T.miktar,
      T.sonSatis,
      COALESCE(E.VegaStokNo, S.IND)            AS stokNo,
      COALESCE(E.VegaStokAdi, S.MALINCINSI)    AS stokAdi,
      ISNULL(E.BirimCarpan, 1)                 AS birimCarpan,
      ISNULL(E.Yoksay, 0)                      AS yoksay,
      CASE
        WHEN ISNULL(E.Yoksay, 0) = 1 THEN 'yoksayildi'
        WHEN E.VegaStokNo IS NOT NULL THEN 'elle'
        WHEN S.IND IS NOT NULL THEN 'otomatik'
        ELSE 'eslesmedi'
      END AS durum
    FROM Satilan T
    LEFT JOIN [${p}].dbo.UrunEslestirme E
           ON E.Firma = @firma AND E.SefimUrunAdi = T.urun
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S
           ON S.MALINCINSI = T.urun AND ISNULL(S.DELETED, 0) = 0
    ORDER BY
      CASE
        WHEN ISNULL(E.Yoksay, 0) = 1 THEN 3
        WHEN E.VegaStokNo IS NOT NULL OR S.IND IS NOT NULL THEN 2
        ELSE 1
      END,
      T.miktar DESC
  `,
    { gun, firma }
  );
}

async function eslestirmeKaydet(kayit) {
  await panel.kur();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const p = panel.p();

  await calistir(
    `
    MERGE [${p}].dbo.UrunEslestirme AS H
    USING (SELECT @firma AS Firma, @urun AS SefimUrunAdi) AS Y
       ON H.Firma = Y.Firma AND H.SefimUrunAdi = Y.SefimUrunAdi
    WHEN MATCHED THEN UPDATE SET
      VegaStokNo  = @stokNo,
      VegaStokAdi = @stokAdi,
      BirimCarpan = @carpan,
      Yoksay      = @yoksay,
      Kaydeden    = @kaydeden,
      KayitTarihi = GETDATE()
    WHEN NOT MATCHED THEN INSERT
      (Firma, SefimUrunAdi, VegaStokNo, VegaStokAdi, BirimCarpan, Yoksay, Kaydeden)
      VALUES (@firma, @urun, @stokNo, @stokAdi, @carpan, @yoksay, @kaydeden);
  `,
    {
      firma,
      urun: kayit.urun,
      stokNo: kayit.stokNo != null ? Number(kayit.stokNo) : null,
      stokAdi: kayit.stokAdi || null,
      carpan: Number(kayit.birimCarpan || 1),
      yoksay: kayit.yoksay ? 1 : 0,
      kaydeden: kayit.kaydeden || null
    }
  );

  await panel.kayit('Satış Aktarımı', 'Ürün eşleştirildi', kayit, kayit.kaydeden);
  return { tamam: true };
}

// Eşleşmemiş ürünler için Vega'da benzer isimli kart önerisi
async function eslesmeOnerisi(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const urun = String(secim.urun || '');
  // "Grup.Ürün" biçimindeki adın son parçası genelde ürün adıdır.
  const parcalar = urun.split('.');
  const sonParca = (parcalar[parcalar.length - 1] || urun).trim();

  return sorgu(
    `
    SELECT TOP 15
      S.IND AS stokNo,
      S.MALINCINSI AS ad,
      S.STOKKODU AS kod,
      ISNULL(S.MALIYET, 0) AS maliyet
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      AND ${stokPasifHaric()}
      AND (S.MALINCINSI LIKE @tam OR S.MALINCINSI LIKE @parca)
    ORDER BY
      CASE WHEN S.MALINCINSI = @urun THEN 0
           WHEN S.MALINCINSI LIKE @tam THEN 1 ELSE 2 END,
      LEN(S.MALINCINSI)
  `,
    { urun, tam: '%' + urun + '%', parca: '%' + sonParca + '%' }
  );
}

// Şefim satışının reçeteler üzerinden hammadde tüketimine çevrilmesi.
// Sadece hesaplama yapar, hiçbir yere yazmaz.
async function satistanTuketim(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const s = sf();
  const v = vt();
  const p = panel.p();
  const gun = Number(secim.gun || 1);
  if (
    !(await tabloVarMi(firma, null, 'TBLURERECETELIST')) ||
    !(await tabloVarMi(firma, null, 'TBLURERECETE'))
  ) {
    return [];
  }

  return sorgu(
    `
    WITH Satilan AS (
      SELECT B.ProductName AS urun, SUM(B.Quantity) AS miktar
      FROM [${s}].dbo.Bill B
      WHERE B.Date >= DATEADD(day, -@gun, CAST(GETDATE() AS date))
        AND ISNULL(B.Canceling, 0) = 0
      GROUP BY B.ProductName
    ),
    Eslesen AS (
      SELECT T.urun,
             T.miktar * ISNULL(E.BirimCarpan, 1) AS miktar,
             COALESCE(E.VegaStokNo, S.IND) AS stokNo
      FROM Satilan T
      LEFT JOIN [${p}].dbo.UrunEslestirme E
             ON E.Firma = @firma AND E.SefimUrunAdi = T.urun AND ISNULL(E.Yoksay,0) = 0
      LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S
             ON S.MALINCINSI = T.urun AND ISNULL(S.DELETED, 0) = 0
    )
    SELECT
      R.STOKNO                 AS hammaddeNo,
      ISNULL(HS.MALINCINSI, R.MALINCINSI) AS hammadde,
      SUM(
        E.miktar / NULLIF(L.MIKTAR, 0)
        * ISNULL(R.MIKTAR, 0)
        * (1 + ISNULL(R.FIREORANI, 0) / 100.0)
      ) AS tuketim,
      ISNULL(MIN(R.BIRIM), '') AS birim,
      ISNULL(MIN(HS.MALIYET), 0) AS birimMaliyet
    FROM Eslesen E
    JOIN ${kart(v, firma, 'TBLURERECETELIST')} L ON L.STOKNO = E.stokNo
    JOIN ${kart(v, firma, 'TBLURERECETE')} R ON R.EVRAKNO = L.IND
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} HS ON HS.IND = R.STOKNO
    WHERE E.stokNo IS NOT NULL
    GROUP BY R.STOKNO, ISNULL(HS.MALINCINSI, R.MALINCINSI)
    ORDER BY SUM(E.miktar / NULLIF(L.MIKTAR, 0) * ISNULL(R.MIKTAR, 0)) DESC
  `,
    { gun, firma }
  );
}

module.exports = {
  satisOzeti,
  eslestirmeDurumu,
  eslestirmeKaydet,
  eslesmeOnerisi,
  satistanTuketim
};
