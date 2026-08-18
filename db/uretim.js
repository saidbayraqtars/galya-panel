'use strict';

// "Stoğu sıfır olana kadar üret".
//
// Vega'da zayiat girilince (stok çıkış fişi, cari ZAYİ) yarı mamulün stoğu
// eksiye düşüyor; sonra eksik kadar üretim yapılıp stok sıfıra çekiliyor.
// Aynı işi THIRD (Özel Kod 11) işaretli ürünler için burası yapıyor:
// eksideki her ürün için eksi miktarı kadar üretim fişi yazılır.
//
// Üretim fişinin kendisi db/yazma.js içindedir (yazma kilidine tabi).

const { sorgu } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, tablo, kart } = require('./firma');
const panel = require('./panel');
const yazma = require('./yazma');

function vt() {
  return ayarOku().vegaVeritabani;
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

  let miktar = Number(secim.miktar || 0);
  if (!(miktar > 0)) {
    const liste = await adaylar({ firma, donem, depo: secim.depo });
    const aday = liste.find((a) => Number(a.stokNo) === stokNo);
    if (!aday) {
      throw new Error('Bu ürünün stoğu eksi değil, üretilecek miktar yok.');
    }
    miktar = Number(aday.uretilecek);
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

module.exports = { adaylar, uret, hepsiniUret, gecmis, geriAl };
