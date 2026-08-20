'use strict';

// Üretim. Üç yolu var, üçü de aynı üretim fişini yazar:
//
//   OTOMATİK  hepsiniUret()   — THIRD işaretli, stoğu eksiye düşmüş bütün
//                               ürünleri tek tuşla sıfıra çeker.
//   MANUEL    uret()          — reçetesi olan herhangi bir ürün, istenen
//                               miktarda. Miktar verilmezse stoğu sıfıra
//                               getirecek kadar üretilir.
//   ZAYİATLI  zayiatliUret()  — Vega'da elle yapılan işin tamamı: önce zayi
//                               çıkış fişi kesilir (cari ZAYİ), ürünün stoğu
//                               eksiye düşer, sonra eksik kadar üretim
//                               yapılıp stok sıfıra çekilir.
//
// Zayiatlı üretim deseni `galya döküman/zaiyatlı manuel üretim .md`
// izleyici kaydından çıkarıldı: kullanıcı önce StkÇık\A0000499\ZAYİ fişini
// kesiyor, ardından üretim fişini yazıp doğan 38+38+97+96 belgelerini
// oluşturuyor. Panel ikisini tek işlemde yapıyor; zayi yazılıp üretim
// yazılamazsa zayi fişi geri alınır, yarım iş kalmaz.
//
// Üretim fişinin ve zayi fişinin kendisi db/yazma.js içindedir (yazma
// kilidine tabi).

const { sorgu } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, tablo, kart } = require('./firma');
const panel = require('./panel');
const yazma = require('./yazma');

function vt() {
  return ayarOku().vegaVeritabani;
}

// Bir ürünün depodaki güncel kalanı. Zayi fişi kesildikten sonra üretim
// miktarını buradan hesaplıyoruz; ekrandaki eski sayıyla üretmek stoğu
// yanlış yere oturturdu.
async function kalanMiktar(v, firma, donem, stokNo, depo) {
  const r = await sorgu(
    `SELECT ISNULL(SUM(E.ENVANTER), 0) AS kalan
     FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')} E
     WHERE E.STOKNO = @stokNo AND E.BELGETIPI <> 67
       AND (@depo = 0 OR E.DEPO = @depo)`,
    { stokNo: Number(stokNo), depo: Number(depo) || 0 }
  );
  return Number((r[0] && r[0].kalan) || 0);
}

// Üretilecek adaylar: THIRD işaretli (Vega kartında KOD11 = THIRD ya da
// panelde işaretli), reçetesi olan ve stoğu eksiye düşmüş ürünler.
async function adaylar(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;

  return sorgu(
    `
    WITH K AS (
      SELECT E.STOKNO, SUM(E.ENVANTER) AS KALAN
      FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')} E
      WHERE (@depo = 0 OR E.DEPO = @depo) AND E.BELGETIPI <> 67
      GROUP BY E.STOKNO
    ),
    R AS (
      SELECT L.STOKNO, MIN(L.IND) AS receteNo
      FROM ${kart(v, firma, 'TBLURERECETELIST')} L
      GROUP BY L.STOKNO
    )
    SELECT
      S.IND                 AS stokNo,
      S.MALINCINSI          AS ad,
      ISNULL(S.STOKKODU,'') AS kod,
      ISNULL(S.KOD11, '')   AS kod11,
      ISNULL(B.BIRIMADI,'') AS birim,
      ISNULL(K.KALAN, 0)    AS kalan,
      -ISNULL(K.KALAN, 0)   AS uretilecek,
      R.receteNo,
      ISNULL(SS.satirSayisi, 0) AS receteSatiri,
      CASE WHEN I.StokNo IS NULL THEN 0 ELSE 1 END AS panelIsareti
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    JOIN R ON R.STOKNO = S.IND
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    LEFT JOIN (
      SELECT EVRAKNO, COUNT(*) AS satirSayisi
      FROM ${kart(v, firma, 'TBLURERECETE')}
      GROUP BY EVRAKNO
    ) SS ON SS.EVRAKNO = R.receteNo
    LEFT JOIN [${panel.p()}].dbo.ThirdIsaret I
           ON I.Firma = @firma AND I.StokNo = S.IND AND I.Isaretli = 1
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      AND (S.KOD11 = 'THIRD' OR I.StokNo IS NOT NULL)
      AND ISNULL(K.KALAN, 0) < 0
      AND ISNULL(SS.satirSayisi, 0) > 0
    ORDER BY ISNULL(K.KALAN, 0) ASC
  `,
    { depo, firma }
  );
}

// Manuel ve zayiatlı üretimde seçilecek ürünler: reçetesi olan HER ürün.
// "Adaylar" listesinden farkı, stoğun eksi olmasını ve THIRD işaretini
// şart koşmaması — kullanıcı istediği mamulü istediği miktarda üretebilsin.
async function uretilebilirler(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  const arama = (secim.arama || '').trim();

  return sorgu(
    `
    WITH K AS (
      SELECT E.STOKNO, SUM(E.ENVANTER) AS KALAN
      FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')} E
      WHERE (@depo = 0 OR E.DEPO = @depo) AND E.BELGETIPI <> 67
      GROUP BY E.STOKNO
    ),
    R AS (
      SELECT L.STOKNO, MIN(L.IND) AS receteNo
      FROM ${kart(v, firma, 'TBLURERECETELIST')} L
      GROUP BY L.STOKNO
    )
    SELECT TOP 500
      S.IND                 AS stokNo,
      S.MALINCINSI          AS ad,
      ISNULL(S.STOKKODU,'') AS kod,
      ISNULL(S.KOD2, '')    AS sinif,
      ISNULL(S.KOD11, '')   AS kod11,
      ISNULL(B.BIRIMADI,'') AS birim,
      ISNULL(K.KALAN, 0)    AS kalan,
      R.receteNo,
      ISNULL(SS.satirSayisi, 0) AS receteSatiri
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    JOIN R ON R.STOKNO = S.IND
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    LEFT JOIN (
      SELECT EVRAKNO, COUNT(*) AS satirSayisi
      FROM ${kart(v, firma, 'TBLURERECETE')}
      GROUP BY EVRAKNO
    ) SS ON SS.EVRAKNO = R.receteNo
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      AND ISNULL(SS.satirSayisi, 0) > 0
      AND ISNULL(S.KOD8, '') <> N'PASİF'
      AND (@arama = '' OR S.MALINCINSI LIKE @desen OR S.STOKKODU LIKE @desen)
    ORDER BY S.MALINCINSI
  `,
    { depo, arama, desen: '%' + arama + '%' }
  );
}

// Sayaç yarışında (Şefim entegrasyonu aynı 96/97 numarasını alırsa) işlem
// geri alınıp yeniden deneniyor.
async function denemeliYaz(istek) {
  let sonHata = null;
  for (let deneme = 1; deneme <= 3; deneme++) {
    try {
      return await yazma.uretimFisiYaz(istek);
    } catch (e) {
      if (e && e.kod === 'SAYAC_CAKISMASI') {
        sonHata = e;
        continue;
      }
      throw e;
    }
  }
  throw sonHata || new Error('Üretim fişi yazılamadı.');
}

// Tek ürünü verilen miktarda üretir. Miktar verilmezse stoğu sıfıra
// getirecek kadar üretilir.
async function uret(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const stokNo = Number(secim.stokNo);
  if (!stokNo) throw new Error('Ürün seçilmeli.');

  // Miktar verilmezse "stoğu sıfıra çek" demektir. Kalan doğrudan depo
  // envanterinden okunuyor; böylece THIRD işareti olmayan bir ürün de
  // sıfıra kadar üretilebiliyor.
  let miktar = Number(secim.miktar || 0);
  if (!(miktar > 0)) {
    const kalan = await kalanMiktar(
      vt(),
      firma,
      donem,
      stokNo,
      secim.depo != null ? secim.depo : ayarOku().varsayilanDepo
    );
    if (kalan >= -0.0001) {
      throw new Error('Bu ürünün stoğu eksi değil, üretilecek miktar yok. Miktarı elle yazın.');
    }
    miktar = -kalan;
  }

  return denemeliYaz({
    firma,
    donem,
    depo: secim.depo,
    mamulStokNo: stokNo,
    miktar,
    aciklama: secim.aciklama || 'Stok sıfırlama üretimi',
    kullanici: secim.kullanici,
    userNo: secim.userNo
  });
}

// ZAYİATLI ÜRETİM — Vega'da elle yapılan işin tamamı, tek düğmede.
//
// İzleyici kaydındaki sıra birebir uygulanıyor:
//   1. Zayi çıkış fişi (belge tipi 33, cari ZAYİ) — ürünün stoğu düşer.
//   2. Kalan eksiye düştüyse eksik kadar üretim fişi — stok sıfıra gelir.
//
// İkinci adım hata verirse birincisi geri alınır: yarım iş, yani stoktan
// düşmüş ama üretilmemiş bir ürün bırakılmaz.
//
// Kalan miktar zayi fişi kesildikten SONRA yeniden okunuyor. Ekrandaki eski
// sayı kullanılsaydı, Şefim aradaki saniyelerde satış işlediğinde üretim
// miktarı yanlış çıkardı.
async function zayiatliUret(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  const stokNo = Number(secim.stokNo);
  const zayiMiktar = Number(secim.zayiMiktar);
  if (!stokNo) throw new Error('Ürün seçilmeli.');
  if (!(zayiMiktar > 0)) throw new Error('Zayi miktarı sıfırdan büyük olmalı.');
  if (!Number(secim.cariNo)) throw new Error('Zayi carisi seçilmeli (ZAYİ, FİRE ya da personel).');

  const kartlar = await sorgu(
    `SELECT IND AS stokNo, MALINCINSI AS ad FROM ${kart(v, firma, 'TBLSTOKLAR')} WHERE IND = @stokNo`,
    { stokNo }
  );
  if (!kartlar.length) throw new Error('Stok kartı bulunamadı.');
  const ad = kartlar[0].ad;

  const zayiFisi = await yazma.zayiFisiYaz({
    firma,
    donem,
    depo,
    cariNo: Number(secim.cariNo),
    cariAdi: secim.cariAdi || null,
    altHesap: secim.altHesap || 'ZAYİ',
    sebep: secim.sebep || 'Zayiatlı üretim',
    maliyetliMi: !!secim.maliyetliMi,
    satirlar: [{ stokNo, stokAdi: ad, miktar: zayiMiktar }],
    kullanici: secim.kullanici,
    userNo: secim.userNo
  });

  const kalan = await kalanMiktar(v, firma, donem, stokNo, depo);
  // Zayi sonrası stok hâlâ eksi değilse üretecek bir şey yok. Fiş kesilmiş
  // olarak kalır; kullanıcının girdiği zayi gerçekten oldu.
  if (kalan >= -0.0001) {
    await panel.kayit(
      'Üretim',
      'Zayiatlı üretim — zayi yazıldı, üretim gerekmedi',
      { firma, donem, stokNo, ad, zayiMiktar, kalan, zayiBelgeNo: zayiFisi.belgeNo },
      secim.kullanici
    );
    return {
      tamam: true,
      zayiBelgeNo: zayiFisi.belgeNo,
      zayiBaslikInd: zayiFisi.baslikInd,
      uretildi: false,
      kalan,
      mamulAdi: ad,
      mesaj: `Zayi fişi kesildi (${zayiFisi.belgeNo}). Stok eksiye düşmediği için üretim yapılmadı.`
    };
  }

  const uretilecek = -kalan;
  try {
    const fis = await denemeliYaz({
      firma,
      donem,
      depo,
      mamulStokNo: stokNo,
      miktar: uretilecek,
      aciklama: 'Zayiatlı üretim',
      kullanici: secim.kullanici,
      userNo: secim.userNo
    });

    await panel.kayit(
      'Üretim',
      'Zayiatlı üretim yapıldı',
      {
        firma, donem, depo, stokNo, ad, zayiMiktar, uretilecek,
        zayiBelgeNo: zayiFisi.belgeNo, uretimFisNo: fis.fisNo
      },
      secim.kullanici
    );

    return {
      tamam: true,
      zayiBelgeNo: zayiFisi.belgeNo,
      zayiBaslikInd: zayiFisi.baslikInd,
      uretildi: true,
      uretilenMiktar: uretilecek,
      fisNo: fis.fisNo,
      uretimInd: fis.uretimInd,
      mamulAdi: ad
    };
  } catch (e) {
    // Üretim yazılamadı: zayi fişini geri alıp stoğu eski hâline döndürüyoruz.
    let geriAlindi = false;
    try {
      await yazma.zayiFisiGeriAl({
        firma,
        donem,
        baslikInd: zayiFisi.baslikInd,
        kullanici: secim.kullanici
      });
      geriAlindi = true;
    } catch (e2) {
      // Geri alma da başarısızsa kullanıcıya belge numarası söylenmeli;
      // elle düzeltmesi gerekecek.
    }
    const hata = new Error(
      `Üretim fişi yazılamadı: ${e.message || e}. ` +
      (geriAlindi
        ? `Zayi fişi (${zayiFisi.belgeNo}) geri alındı, stok değişmedi.`
        : `DİKKAT: zayi fişi ${zayiFisi.belgeNo} Vega'da kaldı ve geri alınamadı, elle silin.`)
    );
    hata.kod = e && e.kod ? e.kod : null;
    throw hata;
  }
}

// Eksideki bütün THIRD ürünlerini sıfıra çeker. Bir ürün hata verirse
// diğerleri yazılmaya devam eder; sonuç listesinde hangisinin neden
// yazılamadığı görünür.
async function hepsiniUret(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const liste = await adaylar({ firma, donem, depo: secim.depo });
  if (!liste.length) {
    return { tamam: true, yazilan: 0, hatali: 0, sonuclar: [] };
  }

  const sonuclar = [];
  for (const aday of liste) {
    try {
      const s = await denemeliYaz({
        firma,
        donem,
        depo: secim.depo,
        mamulStokNo: Number(aday.stokNo),
        miktar: Number(aday.uretilecek),
        aciklama: 'Stok sıfırlama üretimi',
        kullanici: secim.kullanici,
        userNo: secim.userNo
      });
      sonuclar.push({
        stokNo: Number(aday.stokNo), ad: aday.ad, miktar: Number(aday.uretilecek),
        tamam: true, fisNo: s.fisNo
      });
    } catch (e) {
      sonuclar.push({
        stokNo: Number(aday.stokNo), ad: aday.ad, miktar: Number(aday.uretilecek),
        tamam: false, mesaj: e.message || String(e)
      });
    }
  }

  const yazilan = sonuclar.filter((s) => s.tamam).length;
  await panel.kayit(
    'Üretim',
    'Toplu sıfırlama üretimi',
    { firma, donem, aday: liste.length, yazilan },
    secim.kullanici
  );

  return { tamam: true, yazilan, hatali: sonuclar.length - yazilan, sonuclar };
}

async function gecmis(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  return sorgu(
    `SELECT TOP 100
       Id AS id, Tarih AS tarih, MamulStokNo AS stokNo, MamulAdi AS mamulAdi,
       Miktar AS miktar, FisNo AS fisNo, UretimInd AS uretimInd,
       Kullanici AS kullanici, GeriAlindi AS geriAlindi, Belgeler AS belgeler
     FROM [${panel.p()}].dbo.UretimFisi
     WHERE Firma = @firma AND Donem = @donem
     ORDER BY Id DESC`,
    { firma, donem }
  );
}

async function geriAl(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const kayitlar = await sorgu(
    `SELECT UretimInd AS uretimInd, Belgeler AS belgeler, GeriAlindi AS geriAlindi
     FROM [${panel.p()}].dbo.UretimFisi WHERE Id = @id AND Firma = @firma`,
    { id: Number(secim.id), firma }
  );
  if (!kayitlar.length) throw new Error('Üretim kaydı bulunamadı.');
  if (kayitlar[0].geriAlindi) throw new Error('Bu üretim zaten geri alınmış.');

  return yazma.uretimFisiGeriAl({
    firma,
    donem,
    uretimInd: kayitlar[0].uretimInd,
    belgeler: JSON.parse(kayitlar[0].belgeler || '[]'),
    kullanici: secim.kullanici
  });
}

module.exports = {
  adaylar,
  uretilebilirler,
  uret,
  zayiatliUret,
  hepsiniUret,
  gecmis,
  geriAl
};
