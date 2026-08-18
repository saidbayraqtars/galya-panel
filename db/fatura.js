'use strict';

// Alış faturası taslağı — GALYA_PANEL veritabanında tutulur.
//
// Kullanıcı faturayı burada hazırlar, kaydeder, gerekirse düzeltir. Vega'ya
// yazma ayrı bir onay düğmesiyle olur (db/yazma.js → alisFaturasiYaz).
// Böylece yanlış girilen bir fatura Vega'nın stok, cari ve maliyet zincirine
// hiç dokunmaz.

const { sorgu, calistir, islem } = require('./sql');
const { dogrula } = require('./firma');
const panel = require('./panel');

function p() {
  return panel.p();
}

function satirToplamlari(satirlar) {
  let araToplam = 0;
  let kdvToplam = 0;
  for (const s of satirlar) {
    const tutar = Number(s.miktar) * Number(s.birimFiyat);
    araToplam += tutar;
    kdvToplam += tutar * (Number(s.kdvOrani || 0) / 100);
  }
  return {
    araToplam: Number(araToplam.toFixed(4)),
    kdvToplam: Number(kdvToplam.toFixed(4)),
    genelToplam: Number((araToplam + kdvToplam).toFixed(4))
  };
}

function satirlariDogrula(satirlar) {
  if (!Array.isArray(satirlar) || !satirlar.length) {
    throw new Error('Faturada en az bir ürün satırı olmalı.');
  }
  for (const s of satirlar) {
    if (!Number(s.stokNo)) throw new Error('Satırlardan birinde ürün seçilmemiş.');
    if (!(Number(s.miktar) > 0)) throw new Error(`"${s.stokAdi || 'Ürün'}" satırında miktar sıfırdan büyük olmalı.`);
    if (!(Number(s.birimFiyat) >= 0)) throw new Error(`"${s.stokAdi || 'Ürün'}" satırında birim fiyat eksi olamaz.`);
  }
}

async function taslakKaydet(kayit) {
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const depo = Number(kayit.depo) || 0;
  if (!depo) throw new Error('Fatura için tek bir depo seçilmelidir. Üst çubuktan depo seçin.');
  if (!Number(kayit.cariNo)) throw new Error('Tedarikçi seçilmeli.');

  const satirlar = kayit.satirlar || [];
  satirlariDogrula(satirlar);
  const toplam = satirToplamlari(satirlar);

  const faturaId = await islem(async (t) => {
    let id = Number(kayit.id) || 0;

    if (id) {
      const mevcut = await t.sorgu(
        `SELECT VegayaYazildi AS yazildi FROM [${p()}].dbo.AlisFatura WHERE Id = @id`,
        { id }
      );
      if (!mevcut.length) throw new Error('Fatura taslağı bulunamadı.');
      if (mevcut[0].yazildi) {
        throw new Error("Bu fatura Vega'ya yazılmış. Değiştirmek için önce Vega'dan geri alın.");
      }
      await t.calistir(
        `UPDATE [${p()}].dbo.AlisFatura
         SET CariNo = @cariNo, CariAdi = @cariAdi, BelgeNo = @belgeNo, Tarih = @tarih,
             VadeTarihi = @vade, Aciklama = @aciklama, Depo = @depo,
             AraToplam = @ara, KdvToplam = @kdv, GenelToplam = @genel
         WHERE Id = @id`,
        {
          id,
          cariNo: Number(kayit.cariNo),
          cariAdi: kayit.cariAdi || '',
          belgeNo: kayit.belgeNo || null,
          tarih: kayit.tarih || new Date(),
          vade: kayit.vadeTarihi || null,
          aciklama: kayit.aciklama || null,
          depo,
          ara: toplam.araToplam,
          kdv: toplam.kdvToplam,
          genel: toplam.genelToplam
        }
      );
      await t.calistir(`DELETE FROM [${p()}].dbo.AlisFaturaSatir WHERE FaturaId = @id`, { id });
    } else {
      const eklenen = await t.sorgu(
        `INSERT INTO [${p()}].dbo.AlisFatura
           (Firma, Donem, Depo, CariNo, CariAdi, BelgeNo, Tarih, VadeTarihi,
            Aciklama, AraToplam, KdvToplam, GenelToplam, Duzenleyen)
         OUTPUT INSERTED.Id AS id
         VALUES (@firma, @donem, @depo, @cariNo, @cariAdi, @belgeNo, @tarih, @vade,
                 @aciklama, @ara, @kdv, @genel, @duzenleyen)`,
        {
          firma,
          donem,
          depo,
          cariNo: Number(kayit.cariNo),
          cariAdi: kayit.cariAdi || '',
          belgeNo: kayit.belgeNo || null,
          tarih: kayit.tarih || new Date(),
          vade: kayit.vadeTarihi || null,
          aciklama: kayit.aciklama || null,
          ara: toplam.araToplam,
          kdv: toplam.kdvToplam,
          genel: toplam.genelToplam,
          duzenleyen: kayit.duzenleyen || null
        }
      );
      id = eklenen[0].id;
    }

    let sira = 0;
    for (const s of satirlar) {
      await t.calistir(
        `INSERT INTO [${p()}].dbo.AlisFaturaSatir
           (FaturaId, Sira, StokNo, StokAdi, StokKodu, Birim, BirimEx,
            Miktar, BirimFiyat, KdvOrani)
         VALUES (@faturaId, @sira, @stokNo, @stokAdi, @stokKodu, @birim, @birimEx,
                 @miktar, @fiyat, @kdv)`,
        {
          faturaId: id,
          sira: sira++,
          stokNo: Number(s.stokNo),
          stokAdi: s.stokAdi || '',
          stokKodu: s.stokKodu || null,
          birim: s.birim || null,
          birimEx: s.birimEx != null ? Number(s.birimEx) : null,
          miktar: Number(s.miktar),
          fiyat: Number(s.birimFiyat),
          kdv: Number(s.kdvOrani || 0)
        }
      );
    }
    return id;
  });

  await panel.kayit(
    'Alış Faturası',
    Number(kayit.id) ? 'Fatura taslağı güncellendi' : 'Fatura taslağı oluşturuldu',
    { faturaId, cariAdi: kayit.cariAdi, toplam: toplam.genelToplam, satir: satirlar.length },
    kayit.duzenleyen
  );

  return { tamam: true, faturaId, toplam };
}

async function taslakListesi(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  return sorgu(
    `SELECT TOP 200
       F.Id AS id, F.Tarih AS tarih, F.CariNo AS cariNo, F.CariAdi AS cariAdi,
       F.BelgeNo AS belgeNo, F.AraToplam AS araToplam, F.KdvToplam AS kdvToplam,
       F.GenelToplam AS genelToplam, F.Duzenleyen AS duzenleyen,
       F.VegayaYazildi AS vegayaYazildi, F.VegaBelgeNo AS vegaBelgeNo,
       F.Depo AS depo, F.Aciklama AS aciklama, F.VadeTarihi AS vadeTarihi,
       (SELECT COUNT(*) FROM [${p()}].dbo.AlisFaturaSatir S WHERE S.FaturaId = F.Id) AS satirSayisi
     FROM [${p()}].dbo.AlisFatura F
     WHERE F.Firma = @firma AND F.Donem = @donem AND F.Iptal = 0
     ORDER BY F.Id DESC`,
    { firma, donem }
  );
}

async function taslakGetir(secim) {
  const basliklar = await sorgu(
    `SELECT Id AS id, Firma AS firma, Donem AS donem, Depo AS depo,
            CariNo AS cariNo, CariAdi AS cariAdi, BelgeNo AS belgeNo,
            Tarih AS tarih, VadeTarihi AS vadeTarihi, Aciklama AS aciklama,
            AraToplam AS araToplam, KdvToplam AS kdvToplam, GenelToplam AS genelToplam,
            VegayaYazildi AS vegayaYazildi, VegaBelgeInd AS vegaBelgeInd,
            VegaBelgeNo AS vegaBelgeNo, OncekiFiyatlar AS oncekiFiyatlar
     FROM [${p()}].dbo.AlisFatura WHERE Id = @id`,
    { id: Number(secim.id) }
  );
  if (!basliklar.length) throw new Error('Fatura taslağı bulunamadı.');

  const satirlar = await sorgu(
    `SELECT Id AS id, Sira AS sira, StokNo AS stokNo, StokAdi AS stokAdi,
            StokKodu AS stokKodu, Birim AS birim, BirimEx AS birimEx,
            Miktar AS miktar, BirimFiyat AS birimFiyat, KdvOrani AS kdvOrani
     FROM [${p()}].dbo.AlisFaturaSatir WHERE FaturaId = @id ORDER BY Sira`,
    { id: Number(secim.id) }
  );

  return Object.assign({}, basliklar[0], { satirlar });
}

async function taslakSil(secim) {
  const f = await taslakGetir({ id: secim.id });
  if (f.vegayaYazildi) {
    throw new Error("Bu fatura Vega'ya yazılmış. Önce Vega'dan geri alın.");
  }
  await calistir(
    `UPDATE [${p()}].dbo.AlisFatura SET Iptal = 1 WHERE Id = @id`,
    { id: Number(secim.id) }
  );
  await panel.kayit('Alış Faturası', 'Fatura taslağı silindi', { faturaId: secim.id }, secim.kullanici);
  return { tamam: true };
}

module.exports = { taslakKaydet, taslakListesi, taslakGetir, taslakSil, satirToplamlari };
