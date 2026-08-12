'use strict';

// Veritabanı katmanını Electron olmadan sınamak için.
//   node kurulum/test-sorgular.js

const path = require('path');
const kok = path.join(__dirname, '..');

const sql = require(path.join(kok, 'db', 'sql'));
const firma = require(path.join(kok, 'db', 'firma'));
const panel = require(path.join(kok, 'db', 'panel'));
const vega = require(path.join(kok, 'db', 'vega'));
const sefim = require(path.join(kok, 'db', 'sefim'));
const sayim = require(path.join(kok, 'db', 'sayim'));
const ozet = require(path.join(kok, 'db', 'ozet'));

let basarili = 0;
let basarisiz = 0;

async function dene(ad, isFn) {
  const basla = Date.now();
  try {
    const sonuc = await isFn();
    const sure = Date.now() - basla;
    const olcu = Array.isArray(sonuc) ? sonuc.length + ' satır' : 'tamam';
    console.log(`  OK   ${ad}  (${olcu}, ${sure} ms)`);
    basarili++;
    return sonuc;
  } catch (e) {
    console.log(`  HATA ${ad}`);
    console.log(`       ${e.message}`);
    basarisiz++;
    return null;
  }
}

(async () => {
  console.log('\n== Bağlantı ==');
  await dene('SQL bağlantısı', () => sql.baglantiTesti());
  await dene('GALYA_PANEL kurulumu', () => panel.kur());

  console.log('\n== Firma / depo ==');
  const firmalar = await dene('Firma listesi', () => firma.firmalariGetir(true));
  await dene('Depo listesi', () => firma.depolariGetir());

  if (!firmalar || !firmalar.length) {
    console.log('\nFirma bulunamadı, test durduruldu.');
    await sql.havuzKapat();
    process.exit(1);
  }

  for (const f of firmalar) {
    const d = f.varsayilanDonem;
    const s = { firma: f.kod, donem: d, depo: 0 };
    console.log(`\n== ${f.kisaAd} (${f.kod}/${d}) ==`);

    await dene('Ana ekran özeti', () => ozet.anaEkran(s));
    await dene('Stok durumu (sorunlu)', () =>
      vega.stokDurumu(Object.assign({ sadeceSorunlu: true }, s)));
    await dene('Reçeteli mamuller', () => vega.receteliMamuller(s));
    await dene('THIRD adayları', () => vega.thirdAdaylari(s));
    await dene('Maliyeti eskimişler', () => vega.maliyetiEskimisler(s));
    await dene('Cari bakiye', () => vega.cariBakiye(s));
    await dene('Bekleyen e-faturalar', () => vega.bekleyenFaturalar(s));
    await dene('Fatura ürün eşleşmeleri', () => vega.faturaUrunEslesmeleri(s));
    await dene('Günlük hareket', () => vega.gunlukHareket(Object.assign({ gun: 7 }, s)));
    await dene('Şefim eşleştirme durumu', () =>
      sefim.eslestirmeDurumu(Object.assign({ gun: 45 }, s)));
    await dene('Satıştan tüketim', () => sefim.satistanTuketim(Object.assign({ gun: 7 }, s)));
    await dene('Sayım ekranı', () => sayim.sayimEkraniGetir(s));
    await dene('Sayım geçmişi', () => sayim.sayimListesi(s));

    const mamuller = await vega.receteliMamuller(s).catch(() => []);
    if (mamuller.length) {
      await dene('Reçete ağacı (ilk mamul)', () =>
        vega.receteAgaci({ firma: f.kod, donem: d, receteNo: mamuller[0].receteNo }));
    }
  }

  console.log('\n== Şefim ==');
  await dene('Aktarım durumu', () => sefim.aktarimDurumu());
  await dene('Günlük satış özeti', () => sefim.satisOzeti({ gun: 7 }));

  console.log(`\nSonuç: ${basarili} başarılı, ${basarisiz} hatalı\n`);
  await sql.havuzKapat();
  process.exit(basarisiz ? 1 : 0);
})();
