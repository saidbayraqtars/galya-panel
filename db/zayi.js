'use strict';

// Zayi / personel çıkışı — GALYA_PANEL veritabanında taslak olarak tutulur.
//
// İki iş aynı belgeyle görülüyor, ikisi de stok çıkış fişi (belge tipi 33):
//
//   - gerçek zayi: bozulan, kırılan, dökülen mal   → cari ZAYİ
//   - personelde kalan mal                          → cari personelin kartı
//
// Aradaki tek fark seçilen cari. Vega'da elle yapılırken de aynı ekran
// kullanılıyor (bkz. galya döküman/zayiat durumunda... .png): "Firma Kodu"
// ve "Alt Hesap" ZAYİ seçiliyor.
//
// Fatura gibi önce panelde durur, Vega'ya yazma ayrı bir onaydan geçer;
// böylece yanlış giriş Vega'nın stok ve cari zincirine hiç dokunmaz.

const { sorgu, calistir, islem } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, kart, tablo } = require('./firma');
const panel = require('./panel');

function p() {
  return panel.p();
}

function vt() {
  return ayarOku().vegaVeritabani;
}

// Zayi için kullanılan cariler. Firma bunları kendi açmış: ZAYİ, FİRE ve
// malın üstünde kaldığı personel kartları. Sabit liste yazmak yerine geçmiş
// çıkış fişlerinden hangi carilerin kullanıldığı okunuyor; kullanılmayan
// binlerce tedarikçi listeyi boğmasın diye.
async function cariler(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const arama = (secim.arama || '').trim();

  return sorgu(
    `
    WITH KULLANIM AS (
      SELECT FIRMANO, COUNT(*) AS adet, MAX(TARIH) AS sonKullanim
      FROM ${tablo(v, firma, donem, 'TBLSTKCIKBASLIK')}
      WHERE BELGETIPI = 33 AND FIRMANO IS NOT NULL
      GROUP BY FIRMANO
    )
    SELECT TOP 100
      C.IND                    AS cariNo,
      ISNULL(C.FIRMAKODU, '')  AS kod,
      ISNULL(C.FIRMAADI, '')   AS ad,
      ISNULL(K.adet, 0)        AS kullanim,
      K.sonKullanim            AS sonKullanim
    FROM ${kart(v, firma, 'TBLCARI')} C
    LEFT JOIN KULLANIM K ON K.FIRMANO = C.IND
    WHERE ISNULL(C.DELETED, 0) = 0
      AND (
        @arama <> '' AND (C.FIRMAKODU LIKE @desen OR C.FIRMAADI LIKE @desen)
        OR (@arama = '' AND K.adet IS NOT NULL)
      )
    ORDER BY ISNULL(K.adet, 0) DESC, C.FIRMAKODU
  `,
    { arama, desen: '%' + arama + '%' }
  );
}

function satirlariDogrula(satirlar) {
  if (!Array.isArray(satirlar) || !satirlar.length) {
    throw new Error('Zayi fişinde en az bir ürün satırı olmalı.');
  }
  for (const s of satirlar) {
    if (!Number(s.stokNo)) throw new Error('Satırlardan birinde ürün seçilmemiş.');
    if (!(Number(s.miktar) > 0)) {
      throw new Error(`"${s.stokAdi || 'Ürün'}" satırında miktar sıfırdan büyük olmalı.`);
    }
  }
}

// Satırların maliyeti kartlardan okunur; arayüzden gelen tutara güvenilmez.
async function satirlariZenginlestir(firma, satirlar) {
  const v = vt();
  const nolar = satirlar.map((s) => Number(s.stokNo)).filter(Boolean);
  // KDV oranı kartta değil, kartın KDVGRUBU'nun bağlı olduğu tabloda.
  const kartlar = await sorgu(
    `SELECT S.IND AS stokNo, S.MALINCINSI AS ad, ISNULL(S.STOKKODU,'') AS kod,
            ISNULL(S.MALIYET, 0) AS maliyet, ISNULL(G.KDV, 0) AS kdv,
            ISNULL(B.BIRIMADI, '') AS birim, ISNULL(B.IND, 0) AS birimEx
     FROM ${kart(v, firma, 'TBLSTOKLAR')} S
     LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
            ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
     LEFT JOIN ${kart(v, firma, 'TBLKDVGRUPLARI')} G ON G.IND = S.KDVGRUBU
     WHERE S.IND IN (${nolar.join(',')})`
  );
  const harita = new Map(kartlar.map((k) => [Number(k.stokNo), k]));

  return satirlar.map((s) => {
    const k = harita.get(Number(s.stokNo));
    if (!k) throw new Error(`Stok kartı bulunamadı: ${s.stokAdi || s.stokNo}`);
    return {
      stokNo: Number(k.stokNo),
      stokAdi: k.ad,
      stokKodu: k.kod,
      birim: k.birim,
      birimEx: Number(k.birimEx),
      miktar: Number(s.miktar),
      birimMaliyet: Number(k.maliyet),
      kdvOrani: Number(k.kdv) || 0
    };
  });
}

async function taslakKaydet(kayit) {
  await panel.kur();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const depo = Number(kayit.depo != null ? kayit.depo : ayarOku().varsayilanDepo) || 0;
  if (!depo) throw new Error('Zayi için tek bir depo seçilmelidir. Üst çubuktan depo seçin.');
  if (!Number(kayit.cariNo)) throw new Error('Zayi carisi seçilmeli (ZAYİ, FİRE ya da personel).');

  satirlariDogrula(kayit.satirlar);
  const satirlar = await satirlariZenginlestir(firma, kayit.satirlar);
  const maliyetli = !!kayit.maliyetliMi;
  // Toplam yalnızca ekranda gösterilmek için tutuluyor; fişteki tutarı
  // yazma anında yazma.js kartlardan yeniden hesaplıyor.
  const toplam = maliyetli
    ? satirlar.reduce((t, s) => t + s.miktar * s.birimMaliyet, 0)
    : 0;

  const zayiId = await islem(async (t) => {
    let id = Number(kayit.id) || 0;

    if (id) {
      const mevcut = await t.sorgu(
        `SELECT VegayaYazildi AS yazildi FROM [${p()}].dbo.Zayi WHERE Id = @id`,
        { id }
      );
      if (!mevcut.length) throw new Error('Zayi kaydı bulunamadı.');
      if (mevcut[0].yazildi) {
        throw new Error("Bu zayi fişi Vega'ya yazılmış. Değiştirmek için önce Vega'dan geri alın.");
      }
      await t.calistir(
        `UPDATE [${p()}].dbo.Zayi
         SET Depo = @depo, Tarih = @tarih, CariNo = @cariNo, CariAdi = @cariAdi,
             AltHesap = @altHesap, Sebep = @sebep, MaliyetliMi = @maliyetli, Toplam = @toplam
         WHERE Id = @id`,
        {
          id,
          depo,
          tarih: kayit.tarih || new Date(),
          cariNo: Number(kayit.cariNo),
          cariAdi: kayit.cariAdi || '',
          altHesap: kayit.altHesap || null,
          sebep: kayit.sebep || null,
          maliyetli: maliyetli ? 1 : 0,
          toplam
        }
      );
      await t.calistir(`DELETE FROM [${p()}].dbo.ZayiSatir WHERE ZayiId = @id`, { id });
    } else {
      const eklenen = await t.sorgu(
        `INSERT INTO [${p()}].dbo.Zayi
           (Firma, Donem, Depo, Tarih, CariNo, CariAdi, AltHesap, Sebep,
            MaliyetliMi, Toplam, Duzenleyen)
         OUTPUT INSERTED.Id AS id
         VALUES (@firma, @donem, @depo, @tarih, @cariNo, @cariAdi, @altHesap, @sebep,
                 @maliyetli, @toplam, @duzenleyen)`,
        {
          firma,
          donem,
          depo,
          tarih: kayit.tarih || new Date(),
          cariNo: Number(kayit.cariNo),
          cariAdi: kayit.cariAdi || '',
          altHesap: kayit.altHesap || null,
          sebep: kayit.sebep || null,
          maliyetli: maliyetli ? 1 : 0,
          toplam,
          duzenleyen: kayit.duzenleyen || null
        }
      );
      id = eklenen[0].id;
    }

    let sira = 0;
    for (const s of satirlar) {
      await t.calistir(
        `INSERT INTO [${p()}].dbo.ZayiSatir
           (ZayiId, Sira, StokNo, StokAdi, StokKodu, Birim, BirimEx,
            Miktar, BirimMaliyet, KdvOrani)
         VALUES (@zayiId, @sira, @stokNo, @stokAdi, @stokKodu, @birim, @birimEx,
                 @miktar, @maliyet, @kdv)`,
        {
          zayiId: id,
          sira: sira++,
          stokNo: s.stokNo,
          stokAdi: s.stokAdi,
          stokKodu: s.stokKodu || null,
          birim: s.birim || null,
          birimEx: s.birimEx != null ? Number(s.birimEx) : null,
          miktar: s.miktar,
          maliyet: s.birimMaliyet,
          kdv: s.kdvOrani
        }
      );
    }
    return id;
  });

  await panel.kayit(
    'Zayi',
    Number(kayit.id) ? 'Zayi kaydı güncellendi' : 'Zayi kaydı oluşturuldu',
    { zayiId, cariAdi: kayit.cariAdi, satir: satirlar.length, maliyetli },
    kayit.duzenleyen
  );

  return { tamam: true, zayiId, satirSayisi: satirlar.length, toplam };
}

async function liste(secim) {
  await panel.kur();
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  return sorgu(
    `SELECT TOP 200
       Z.Id AS id, Z.Tarih AS tarih, Z.CariNo AS cariNo, Z.CariAdi AS cariAdi,
       Z.AltHesap AS altHesap, Z.Sebep AS sebep, Z.MaliyetliMi AS maliyetliMi,
       Z.Toplam AS toplam, Z.Duzenleyen AS duzenleyen, Z.KayitTarihi AS kayitTarihi,
       Z.Depo AS depo, Z.VegayaYazildi AS vegayaYazildi,
       Z.VegaBelgeInd AS vegaBelgeInd, Z.VegaBelgeNo AS vegaBelgeNo,
       (SELECT COUNT(*) FROM [${p()}].dbo.ZayiSatir S WHERE S.ZayiId = Z.Id) AS satirSayisi
     FROM [${p()}].dbo.Zayi Z
     WHERE Z.Firma = @firma AND Z.Donem = @donem AND Z.Iptal = 0
     ORDER BY Z.Id DESC`,
    { firma, donem }
  );
}

// Ayrıntılı dışa aktarma için satır dökümü: her zayi fişinin her kalemi ayrı
// satır. Ekrandaki liste yalnızca başlıkları gösteriyor; "hangi çalışan neyi
// ne kadar zayi etti" sorusunun cevabı ancak satır düzeyinde çıkıyor.
async function satirDokumu(secim) {
  await panel.kur();
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  return sorgu(
    `SELECT
       Z.Id AS zayiId, Z.Tarih AS tarih, Z.CariAdi AS cariAdi,
       Z.AltHesap AS altHesap, Z.Sebep AS sebep, Z.Duzenleyen AS duzenleyen,
       Z.MaliyetliMi AS maliyetliMi, Z.VegayaYazildi AS vegayaYazildi,
       Z.VegaBelgeNo AS vegaBelgeNo, Z.Depo AS depo,
       S.Sira AS sira, S.StokNo AS stokNo, S.StokAdi AS stokAdi,
       S.StokKodu AS stokKodu, S.Birim AS birim, S.Miktar AS miktar,
       S.BirimMaliyet AS birimMaliyet,
       S.Miktar * ISNULL(S.BirimMaliyet, 0) AS tutar
     FROM [${p()}].dbo.Zayi Z
     JOIN [${p()}].dbo.ZayiSatir S ON S.ZayiId = Z.Id
     WHERE Z.Firma = @firma AND Z.Donem = @donem AND Z.Iptal = 0
     ORDER BY Z.Id DESC, S.Sira`,
    { firma, donem }
  );
}

async function getir(secim) {
  await panel.kur();
  const basliklar = await sorgu(
    `SELECT Id AS id, Firma AS firma, Donem AS donem, Depo AS depo, Tarih AS tarih,
            CariNo AS cariNo, CariAdi AS cariAdi, AltHesap AS altHesap, Sebep AS sebep,
            MaliyetliMi AS maliyetliMi, Toplam AS toplam, Duzenleyen AS duzenleyen,
            VegayaYazildi AS vegayaYazildi, VegaBelgeInd AS vegaBelgeInd,
            VegaBelgeNo AS vegaBelgeNo
     FROM [${p()}].dbo.Zayi WHERE Id = @id`,
    { id: Number(secim.id) }
  );
  if (!basliklar.length) throw new Error('Zayi kaydı bulunamadı.');

  const satirlar = await sorgu(
    `SELECT Id AS id, Sira AS sira, StokNo AS stokNo, StokAdi AS stokAdi,
            StokKodu AS stokKodu, Birim AS birim, BirimEx AS birimEx,
            Miktar AS miktar, BirimMaliyet AS birimMaliyet, KdvOrani AS kdvOrani
     FROM [${p()}].dbo.ZayiSatir WHERE ZayiId = @id ORDER BY Sira`,
    { id: Number(secim.id) }
  );

  const b = basliklar[0];
  return Object.assign({}, b, { maliyetliMi: !!b.maliyetliMi, satirlar });
}

async function sil(secim) {
  const z = await getir({ id: secim.id });
  if (z.vegayaYazildi) {
    throw new Error("Bu zayi fişi Vega'ya yazılmış. Önce Vega'dan geri alın.");
  }
  await calistir(`UPDATE [${p()}].dbo.Zayi SET Iptal = 1 WHERE Id = @id`, {
    id: Number(secim.id)
  });
  await panel.kayit('Zayi', 'Zayi kaydı silindi', { zayiId: secim.id }, secim.kullanici);
  return { tamam: true };
}

module.exports = { cariler, taslakKaydet, liste, satirDokumu, getir, sil };
