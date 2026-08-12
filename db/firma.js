'use strict';

const { sorgu } = require('./sql');
const { ayarOku } = require('./ayar');

// VegaWin tablo adı deseni:
//   Dönemli tablo : F0102D0002TBLSTOKHAREKETLERI
//   Kart tablosu  : F0102TBLSTOKLAR   (dönem yok)
// Firma ve dönem kodları sorguya doğrudan gömüldüğü için, sadece
// veritabanında gerçekten var olan kodlara izin veriyoruz.

let onbellek = null;

function gecerliKod(kod, harf) {
  return typeof kod === 'string' && new RegExp('^' + harf + '\\d{4}$').test(kod);
}

async function firmalariGetir(yenile) {
  if (onbellek && !yenile) return onbellek;
  const a = ayarOku();
  const v = a.vegaVeritabani;

  const firmalar = await sorgu(`
    SELECT IND, KOD, KISAAD, AD1
    FROM [${v}].dbo.TBLFIRMA
    ORDER BY IND
  `);

  // Hangi firma/dönem kombinasyonunda gerçekten çalışılabilir veri var?
  // Bir dönemi ancak stok hareketi ve depo envanteri tabloları varsa listeliyoruz;
  // yarım kalmış DEMO firmaları böylece listeye girmiyor.
  const donemTablolari = await sorgu(`
    SELECT
      LEFT(name, CHARINDEX('TBL', name) - 1) AS onek,
      SUBSTRING(name, CHARINDEX('TBL', name), 200) AS tablo
    FROM [${v}].sys.tables
    WHERE name LIKE 'F[0-9][0-9][0-9][0-9]D[0-9][0-9][0-9][0-9]TBL%'
      AND SUBSTRING(name, CHARINDEX('TBL', name), 200)
          IN ('TBLSTOKHAREKETLERI', 'TBLDEPOENVANTER')
  `);

  const kartTablolari = await sorgu(`
    SELECT DISTINCT LEFT(name, CHARINDEX('TBL', name) - 1) AS onek
    FROM [${v}].sys.tables
    WHERE name LIKE 'F[0-9][0-9][0-9][0-9]TBLSTOKLAR'
  `);
  const kartVar = new Set(kartTablolari.map((k) => k.onek));

  const donemHaritasi = {};
  for (const satir of donemTablolari) {
    const onek = satir.onek || '';
    const firmaKodu = onek.substring(0, 5);
    const donemKodu = onek.substring(5);
    if (!gecerliKod(firmaKodu, 'F') || !gecerliKod(donemKodu, 'D')) continue;
    if (!donemHaritasi[firmaKodu]) donemHaritasi[firmaKodu] = {};
    if (!donemHaritasi[firmaKodu][donemKodu]) donemHaritasi[firmaKodu][donemKodu] = new Set();
    donemHaritasi[firmaKodu][donemKodu].add(satir.tablo);
  }

  const liste = [];
  for (const f of firmalar) {
    const kod = 'F' + String(f.IND).padStart(4, '0');
    if (!kartVar.has(kod)) continue;
    const donemler = Object.keys(donemHaritasi[kod] || {})
      .filter((d) => donemHaritasi[kod][d].size === 2)
      .sort();
    if (!donemler.length) continue;
    liste.push({
      kod,
      no: f.IND,
      kisaAd: (f.KISAAD || f.KOD || kod).trim(),
      unvan: (f.AD1 || '').trim(),
      donemler
    });
  }

  // Her firma/dönem için son hareket tarihini bul — kullanıcı hangisinin canlı olduğunu görsün.
  for (const firma of liste) {
    firma.donemBilgi = [];
    for (const d of firma.donemler) {
      const tablo = `[${v}].dbo.${firma.kod}${d}TBLSTOKHAREKETLERI`;
      try {
        const r = await sorgu(`
          SELECT COUNT(*) AS adet, MAX(TARIH) AS sonTarih
          FROM ${tablo}
        `);
        firma.donemBilgi.push({
          donem: d,
          hareket: r[0] ? r[0].adet : 0,
          sonTarih: r[0] ? r[0].sonTarih : null
        });
      } catch (e) {
        firma.donemBilgi.push({ donem: d, hareket: 0, sonTarih: null });
      }
    }
    // Varsayılan dönem = en çok hareketi olan
    const enYogun = firma.donemBilgi.slice().sort((x, y) => y.hareket - x.hareket)[0];
    firma.varsayilanDonem = enYogun ? enYogun.donem : firma.donemler[0];
  }

  onbellek = liste;
  return liste;
}

async function dogrula(firmaKodu, donemKodu) {
  const liste = await firmalariGetir();
  const firma = liste.find((f) => f.kod === firmaKodu);
  if (!firma) throw new Error(`Firma bulunamadı: ${firmaKodu}`);
  const donem = donemKodu || firma.varsayilanDonem;
  if (!firma.donemler.includes(donem)) throw new Error(`Dönem bulunamadı: ${firmaKodu} / ${donem}`);
  return { firma: firma.kod, donem, ad: firma.kisaAd };
}

// Dönemli tablo adı
function tablo(vt, firmaKodu, donemKodu, ad) {
  return `[${vt}].dbo.${firmaKodu}${donemKodu}${ad}`;
}

// Kart tablosu adı (dönemsiz)
function kart(vt, firmaKodu, ad) {
  return `[${vt}].dbo.${firmaKodu}${ad}`;
}

async function depolariGetir() {
  const a = ayarOku();
  const satirlar = await sorgu(`
    SELECT IND AS no, DEPOADI AS ad, DEPOKODU AS kod
    FROM [${a.vegaVeritabani}].dbo.TBLDEPOLAR
    ORDER BY IND
  `);
  return satirlar;
}

// Bazı firmalarda üretim, e-fatura gibi modüller hiç kullanılmadığı için
// ilgili tablolar oluşmamış olabilir. Sorgudan önce varlığını kontrol ediyoruz.
//
// Önceden bütün tablo adları tek seferde çekiliyordu; müşteri veritabanında
// 15 binden fazla tablo olduğu için bu ilk çağrıda 16 saniye sürüyordu.
// Artık yalnızca sorulan tablo soruluyor ve cevap akılda tutuluyor.
const tabloOnbellek = new Map();

async function tabloVarMi(firmaKodu, donemKodu, ad) {
  const tamAd = firmaKodu + (donemKodu || '') + ad;
  if (tabloOnbellek.has(tamAd)) return tabloOnbellek.get(tamAd);

  // Aynı tablo aynı anda birden çok yerden sorulursa tek sorgu yapılsın.
  const bekleyen = (async () => {
    const a = ayarOku();
    const r = await sorgu(
      `SELECT CASE WHEN OBJECT_ID(@tam, 'U') IS NULL THEN 0 ELSE 1 END AS varMi`,
      { tam: `[${a.vegaVeritabani}].dbo.[${tamAd}]` }
    );
    const sonuc = !!(r[0] && Number(r[0].varMi) === 1);
    tabloOnbellek.set(tamAd, sonuc);
    return sonuc;
  })();

  tabloOnbellek.set(tamAd, bekleyen);
  return bekleyen;
}

function onbellekTemizle() {
  onbellek = null;
  tabloOnbellek.clear();
}

module.exports = {
  firmalariGetir,
  dogrula,
  tablo,
  kart,
  depolariGetir,
  tabloVarMi,
  onbellekTemizle
};
