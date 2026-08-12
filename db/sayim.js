'use strict';

// Ara sayım. Sayım kayıtları GALYA_PANEL veritabanında tutulur.
// Vega'ya sayım fişi yazma işi db/yazma.js içinde ve varsayılan olarak kapalıdır.

const { sorgu, calistir } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, kart, tablo } = require('./firma');
const panel = require('./panel');

function vt() {
  return ayarOku().vegaVeritabani;
}

// --- Sayım listesi (hangi ürünler sayılacak) ------------------------------

async function listeGetir(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  return sorgu(
    `
    SELECT Id AS id, StokNo AS stokNo, StokAdi AS stokAdi, Sira AS sira
    FROM [${p}].dbo.SayimListesi
    WHERE Firma = @firma AND Aktif = 1
    ORDER BY Sira, StokAdi
  `,
    { firma }
  );
}

async function listeyeEkle(kayit) {
  await panel.kur();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const p = panel.p();
  await calistir(
    `
    MERGE [${p}].dbo.SayimListesi AS H
    USING (SELECT @firma AS Firma, @stokNo AS StokNo) AS Y
       ON H.Firma = Y.Firma AND H.StokNo = Y.StokNo
    WHEN MATCHED THEN UPDATE SET Aktif = 1, StokAdi = @stokAdi
    WHEN NOT MATCHED THEN INSERT (Firma, StokNo, StokAdi, Sira, Aktif)
      VALUES (@firma, @stokNo, @stokAdi, 0, 1);
  `,
    { firma, stokNo: Number(kayit.stokNo), stokAdi: kayit.stokAdi || '' }
  );
  await panel.kayit('Ara Sayım', 'Listeye ürün eklendi', kayit, kayit.kullanici);
  return { tamam: true };
}

async function listedenCikar(kayit) {
  await panel.kur();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const p = panel.p();
  await calistir(
    `UPDATE [${p}].dbo.SayimListesi SET Aktif = 0
     WHERE Firma = @firma AND StokNo = @stokNo`,
    { firma, stokNo: Number(kayit.stokNo) }
  );
  return { tamam: true };
}

// --- Yeni sayım -----------------------------------------------------------

// Sayım ekranını açarken teorik (Vega'daki) miktarları da getiriyoruz.
async function sayimEkraniGetir(secim) {
  await panel.kur();
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const p = panel.p();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;

  return sorgu(
    `
    WITH K AS (
      SELECT E.STOKNO, SUM(E.ENVANTER) AS KALAN
      FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')} E
      WHERE (@depo = 0 OR E.DEPO = @depo) AND E.BELGETIPI <> 67
      GROUP BY E.STOKNO
    )
    SELECT
      L.StokNo AS stokNo,
      ISNULL(S.MALINCINSI, L.StokAdi) AS stokAdi,
      ISNULL(B.BIRIMADI, '') AS birim,
      ISNULL(K.KALAN, 0)     AS teorik,
      ISNULL(S.MALIYET, 0)   AS birimMaliyet
    FROM [${p}].dbo.SayimListesi L
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = L.StokNo
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B ON B.STOKNO = L.StokNo AND B.VARSAYILAN = 1
    LEFT JOIN K ON K.STOKNO = L.StokNo
    WHERE L.Firma = @firma AND L.Aktif = 1
    ORDER BY L.Sira, ISNULL(S.MALINCINSI, L.StokAdi)
  `,
    { firma, depo }
  );
}

async function sayimKaydet(kayit) {
  await panel.kur();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const p = panel.p();
  const depo = Number(kayit.depo != null ? kayit.depo : ayarOku().varsayilanDepo) || 0;
  const satirlar = Array.isArray(kayit.satirlar) ? kayit.satirlar : [];
  if (!satirlar.length) throw new Error('Sayım satırı yok. En az bir ürün girin.');

  const basliklar = await sorgu(
    `
    INSERT INTO [${p}].dbo.AraSayim (Firma, Donem, Depo, Sayan, Aciklama)
    OUTPUT INSERTED.Id AS id
    VALUES (@firma, @donem, @depo, @sayan, @aciklama)
  `,
    {
      firma,
      donem,
      depo,
      sayan: kayit.sayan || null,
      aciklama: kayit.aciklama || null
    }
  );
  const sayimId = basliklar[0].id;

  for (const s of satirlar) {
    await calistir(
      `
      INSERT INTO [${p}].dbo.AraSayimSatir
        (SayimId, StokNo, StokAdi, Birim, TeorikMiktar, SayilanMiktar, BirimMaliyet)
      VALUES (@sayimId, @stokNo, @stokAdi, @birim, @teorik, @sayilan, @maliyet)
    `,
      {
        sayimId,
        stokNo: Number(s.stokNo),
        stokAdi: s.stokAdi || '',
        birim: s.birim || '',
        teorik: Number(s.teorik || 0),
        sayilan: Number(s.sayilan || 0),
        maliyet: Number(s.birimMaliyet || 0)
      }
    );
  }

  await panel.kayit('Ara Sayım', 'Sayım kaydedildi', { sayimId, satir: satirlar.length }, kayit.sayan);
  return { tamam: true, sayimId };
}

async function sayimListesi(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  return sorgu(
    `
    SELECT TOP 100
      S.Id AS id,
      S.SayimTarihi AS tarih,
      S.Sayan AS sayan,
      S.Aciklama AS aciklama,
      S.VegayaYazildi AS vegayaYazildi,
      COUNT(D.Id) AS satirSayisi,
      SUM(CASE WHEN D.Fark <> 0 THEN 1 ELSE 0 END) AS farkliSatir,
      ISNULL(SUM(D.Fark * D.BirimMaliyet), 0) AS farkTutari
    FROM [${p}].dbo.AraSayim S
    LEFT JOIN [${p}].dbo.AraSayimSatir D ON D.SayimId = S.Id
    WHERE S.Firma = @firma AND S.Iptal = 0
    GROUP BY S.Id, S.SayimTarihi, S.Sayan, S.Aciklama, S.VegayaYazildi
    ORDER BY S.SayimTarihi DESC
  `,
    { firma }
  );
}

async function sayimDetayi(secim) {
  await panel.kur();
  const p = panel.p();
  return sorgu(
    `
    SELECT
      StokNo AS stokNo,
      StokAdi AS stokAdi,
      Birim AS birim,
      TeorikMiktar AS teorik,
      SayilanMiktar AS sayilan,
      Fark AS fark,
      BirimMaliyet AS birimMaliyet,
      Fark * BirimMaliyet AS farkTutari
    FROM [${p}].dbo.AraSayimSatir
    WHERE SayimId = @sayimId
    ORDER BY ABS(Fark) DESC, StokAdi
  `,
    { sayimId: Number(secim.sayimId) }
  );
}

async function sonSayimFarki(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  const r = await sorgu(
    `
    SELECT TOP 1
      S.Id AS sayimId,
      S.SayimTarihi AS tarih,
      SUM(CASE WHEN D.Fark <> 0 THEN 1 ELSE 0 END) AS farkliSatir,
      ISNULL(SUM(D.Fark * D.BirimMaliyet), 0) AS farkTutari
    FROM [${p}].dbo.AraSayim S
    LEFT JOIN [${p}].dbo.AraSayimSatir D ON D.SayimId = S.Id
    WHERE S.Firma = @firma AND S.Iptal = 0
    GROUP BY S.Id, S.SayimTarihi
    ORDER BY S.SayimTarihi DESC
  `,
    { firma }
  );
  return r[0] || { sayimId: null, tarih: null, farkliSatir: 0, farkTutari: 0 };
}

// Her stok için EN SON yapılan fiziki sayım. Stok kontrol ekranında teorik
// miktarın karşısına bunu yazıyoruz. İptal edilmiş sayımlar hesaba katılmaz.
async function fizikiSayimlar(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  return sorgu(
    `
    SELECT
      D.StokNo         AS stokNo,
      D.SayilanMiktar  AS sayilan,
      S.SayimTarihi    AS sayimTarihi,
      S.Sayan          AS sayan
    FROM [${p}].dbo.AraSayimSatir D
    JOIN [${p}].dbo.AraSayim S ON S.Id = D.SayimId
    JOIN (
      SELECT D2.StokNo, MAX(S2.Id) AS SonId
      FROM [${p}].dbo.AraSayimSatir D2
      JOIN [${p}].dbo.AraSayim S2 ON S2.Id = D2.SayimId
      WHERE S2.Firma = @firma AND S2.Iptal = 0
      GROUP BY D2.StokNo
    ) SON ON SON.StokNo = D.StokNo AND SON.SonId = S.Id
    WHERE S.Firma = @firma AND S.Iptal = 0
  `,
    { firma }
  );
}

async function sayimIptal(kayit) {
  await panel.kur();
  const p = panel.p();
  await calistir(`UPDATE [${p}].dbo.AraSayim SET Iptal = 1 WHERE Id = @id`, {
    id: Number(kayit.sayimId)
  });
  await panel.kayit('Ara Sayım', 'Sayım geri alındı', kayit, kayit.kullanici);
  return { tamam: true };
}

module.exports = {
  listeGetir,
  listeyeEkle,
  listedenCikar,
  sayimEkraniGetir,
  sayimKaydet,
  sayimListesi,
  sayimDetayi,
  sonSayimFarki,
  fizikiSayimlar,
  sayimIptal
};
