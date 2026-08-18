'use strict';

// Ürün değişim tutanağı ve THIRD (Özel Kod 11) işaretleme.
// İki iş de kaydını GALYA_PANEL veritabanına yazar; Vega'ya aktarım kapalıdır.

const { sorgu, calistir } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, kart, depolariGetir } = require('./firma');
const panel = require('./panel');

// --- Tutanak --------------------------------------------------------------

async function tutanakKaydet(kayit) {
  await panel.kur();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const p = panel.p();
  const depo = Number(kayit.depo != null ? kayit.depo : ayarOku().varsayilanDepo) || 0;

  if (!kayit.dusenStokNo || !kayit.artanStokNo) {
    throw new Error('Düşülecek ve artırılacak ürünlerin ikisi de seçilmeli.');
  }
  if (Number(kayit.dusenMiktar) <= 0 || Number(kayit.artanMiktar) <= 0) {
    throw new Error('Miktarlar sıfırdan büyük olmalı.');
  }
  if (Number(kayit.dusenStokNo) === Number(kayit.artanStokNo)) {
    throw new Error('Aynı ürün hem düşülüp hem artırılamaz.');
  }

  const r = await sorgu(
    `
    INSERT INTO [${p}].dbo.Tutanak
      (Firma, Donem, Depo, DusenStokNo, DusenStokAdi, DusenMiktar,
       ArtanStokNo, ArtanStokAdi, ArtanMiktar, Sebep, Duzenleyen)
    OUTPUT INSERTED.Id AS id
    VALUES (@firma, @donem, @depo, @dNo, @dAd, @dMik, @aNo, @aAd, @aMik, @sebep, @kisi)
  `,
    {
      firma,
      donem,
      depo,
      dNo: Number(kayit.dusenStokNo),
      dAd: kayit.dusenStokAdi || '',
      dMik: Number(kayit.dusenMiktar),
      aNo: Number(kayit.artanStokNo),
      aAd: kayit.artanStokAdi || '',
      aMik: Number(kayit.artanMiktar),
      sebep: kayit.sebep || null,
      kisi: kayit.duzenleyen || null
    }
  );

  await panel.kayit('Tutanak', 'Tutanak oluşturuldu', kayit, kayit.duzenleyen);
  return { tamam: true, tutanakNo: r[0].id };
}

async function tutanakListesi(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  return sorgu(
    `
    SELECT TOP 200
      Id AS id, Tarih AS tarih,
      DusenStokAdi AS dusenAd, DusenMiktar AS dusenMiktar,
      ArtanStokAdi AS artanAd, ArtanMiktar AS artanMiktar,
      Sebep AS sebep, Duzenleyen AS duzenleyen,
      VegayaYazildi AS vegayaYazildi,
      VegaBelgeNo AS vegaBelgeNo,
      DusenStokNo AS dusenStokNo, ArtanStokNo AS artanStokNo,
      Depo AS depo
    FROM [${p}].dbo.Tutanak
    WHERE Firma = @firma AND Iptal = 0
    ORDER BY Tarih DESC
  `,
    { firma }
  );
}

// Tek bir tutanağın tam kaydı — Vega'ya yazma ve geri alma bunu kullanır.
async function tutanakGetir(secim) {
  await panel.kur();
  const p = panel.p();
  const r = await sorgu(
    `SELECT Id AS id, Firma AS firma, Donem AS donem, Depo AS depo,
            Tarih AS tarih, Duzenleyen AS duzenleyen,
            DusenStokNo AS dusenStokNo, DusenStokAdi AS dusenStokAdi, DusenMiktar AS dusenMiktar,
            ArtanStokNo AS artanStokNo, ArtanStokAdi AS artanStokAdi, ArtanMiktar AS artanMiktar,
            Sebep AS sebep, VegayaYazildi AS vegayaYazildi, VegaBelgeNo AS vegaBelgeNo,
            VegaFisler AS vegaFisler,
            Iptal AS iptal
     FROM [${p}].dbo.Tutanak WHERE Id = @id`,
    { id: Number(secim.id) }
  );
  if (!r.length) throw new Error('Tutanak bulunamadı.');
  const t = r[0];
  try {
    t.fisler = t.vegaFisler ? JSON.parse(t.vegaFisler) : null;
  } catch (e) {
    t.fisler = null;
  }
  return t;
}


// Tutanak belgesinin (imzalı çıktının) ihtiyacı olan her şeyi tek yerde
// toplar: panel kaydı + Vega stok kartlarından kod, birim ve maliyet +
// firma ve depo adı. Belgeyi basan taraf ayrıca sorgu atmasın diye.
async function tutanakBelgeVerisi(secim) {
  const t = await tutanakGetir({ id: secim.id });
  const v = ayarOku().vegaVeritabani;

  let kartlar = [];
  try {
    kartlar = await sorgu(
      `SELECT S.IND AS stokNo, ISNULL(S.STOKKODU,'') AS kod,
              ISNULL(S.MALIYET, 0) AS maliyet,
              ISNULL(B.BIRIMADI, '') AS birim
       FROM ${kart(v, t.firma, 'TBLSTOKLAR')} S
       LEFT JOIN ${kart(v, t.firma, 'TBLBIRIMLEREX')} B
              ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
       WHERE S.IND IN (@dusen, @artan)`,
      { dusen: Number(t.dusenStokNo), artan: Number(t.artanStokNo) }
    );
  } catch (e) {
    // Kart okunamazsa belge yine basılsın; miktar ve ad panel kaydında var.
    kartlar = [];
  }
  const bul = (no) => kartlar.find((k) => Number(k.stokNo) === Number(no)) || {};
  const d = bul(t.dusenStokNo);
  const a = bul(t.artanStokNo);

  let firmaAdi = t.firma;
  let depoAdi = null;
  try {
    const bilgi = await dogrula(t.firma, t.donem);
    firmaAdi = bilgi.ad || t.firma;
    const depolar = await depolariGetir();
    const depo = depolar.find((x) => Number(x.no) === Number(t.depo));
    depoAdi = depo ? depo.ad : null;
  } catch (e) {
    // Firma/depo adı okunamazsa kodlarla basılır.
  }

  return {
    id: t.id,
    tarih: t.tarih,
    firma: t.firma,
    donem: t.donem,
    depo: t.depo,
    depoAdi,
    firmaAdi,
    duzenleyen: t.duzenleyen,
    sebep: t.sebep,
    dusenAd: t.dusenStokAdi,
    dusenKod: d.kod || '',
    dusenMiktar: t.dusenMiktar,
    dusenBirim: d.birim || '',
    dusenMaliyet: d.maliyet || 0,
    artanAd: t.artanStokAdi,
    artanKod: a.kod || '',
    artanMiktar: t.artanMiktar,
    artanBirim: a.birim || '',
    artanMaliyet: a.maliyet || 0,
    vegayaYazildi: !!t.vegayaYazildi,
    vegaBelgeNo: t.vegaBelgeNo || null,
    imzalar: Array.isArray(secim.imzalar) && secim.imzalar.length ? secim.imzalar : null
  };
}

async function tutanakIptal(kayit) {
  await panel.kur();
  const p = panel.p();
  await calistir(`UPDATE [${p}].dbo.Tutanak SET Iptal = 1 WHERE Id = @id`, {
    id: Number(kayit.id)
  });
  await panel.kayit('Tutanak', 'Tutanak geri alındı', kayit, kayit.kullanici);
  return { tamam: true };
}

// --- THIRD işaretleme -----------------------------------------------------

async function thirdIsaretle(kayit) {
  await panel.kur();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const p = panel.p();
  await calistir(
    `
    MERGE [${p}].dbo.ThirdIsaret AS H
    USING (SELECT @firma AS Firma, @stokNo AS StokNo) AS Y
       ON H.Firma = Y.Firma AND H.StokNo = Y.StokNo
    WHEN MATCHED THEN UPDATE SET
      Isaretli = @isaretli, StokAdi = @stokAdi,
      Kaydeden = @kisi, KayitTarihi = GETDATE()
    WHEN NOT MATCHED THEN INSERT (Firma, StokNo, StokAdi, Isaretli, Kaydeden)
      VALUES (@firma, @stokNo, @stokAdi, @isaretli, @kisi);
  `,
    {
      firma,
      stokNo: Number(kayit.stokNo),
      stokAdi: kayit.stokAdi || '',
      isaretli: kayit.isaretli === false ? 0 : 1,
      kisi: kayit.kullanici || null
    }
  );
  await panel.kayit('THIRD', 'İşaretlendi', kayit, kayit.kullanici);
  return { tamam: true };
}

async function thirdIsaretliler(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  return sorgu(
    `
    SELECT StokNo AS stokNo, StokAdi AS stokAdi, Isaretli AS isaretli,
           VegayaYazildi AS vegayaYazildi, KayitTarihi AS tarih
    FROM [${p}].dbo.ThirdIsaret
    WHERE Firma = @firma
  `,
    { firma }
  );
}

module.exports = {
  tutanakKaydet,
  tutanakListesi,
  tutanakGetir,
  tutanakBelgeVerisi,
  tutanakIptal,
  thirdIsaretle,
  thirdIsaretliler
};
