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
    for (const suzgec of ['sorunlu', 'eksi', 'sifir', 'azalan', 'tumu']) {
      await dene('Stok kontrol: ' + suzgec, () =>
        vega.stokKontrolListesi(Object.assign({ suzgec }, s)));
    }
    await dene('Fiziki sayımlar', () => sayim.fizikiSayimlar(s));
    await dene('Gider / hizmet stokları', () => vega.giderHizmetStoklari(s));
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

  console.log('\n== Dışa aktarma ==');
  const disaAktar = require(path.join(kok, 'db', 'disaaktar'));
  await dene('Excel üretimi', async () => {
    const veri = disaAktar.excelUret({
      baslik: 'Sınama raporu',
      altBaslik: 'test',
      sayfaAdi: 'Test',
      sutunlar: [
        { ad: 'Ürün', alan: 'ad', tur: 'metin' },
        { ad: 'Miktar', alan: 'miktar', tur: 'sayi' },
        { ad: 'Tutar', alan: 'tutar', tur: 'para' }
      ],
      satirlar: [
        { ad: 'ÇAY & YAĞ <ışİĞ>', miktar: 12.5, tutar: -3.25 },
        { ad: 'Boş değerli satır', miktar: null, tutar: null }
      ]
    });
    // ZIP imzası ve makul boyut: dosyanın Excel'e gidebilecek halde olduğunu gösterir.
    if (veri.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP başlığı bozuk');
    if (veri.length < 800) throw new Error('Dosya beklenenden küçük: ' + veri.length);
    return 'tamam';
  });
  await dene('PDF sayfası üretimi', async () => {
    const html = disaAktar.pdfHtml({
      baslik: 'Sınama',
      altBaslik: 'test',
      sutunlar: [{ ad: 'Ürün', alan: 'ad', tur: 'metin' }],
      satirlar: [{ ad: '<script>x</script>' }]
    });
    if (html.includes('<script>x')) throw new Error('HTML kaçırma çalışmıyor');
    return 'tamam';
  });

  // Sınıflandırma süzgeci: çoklu seçim, "hariç tut" kipi ve pasif kartlar.
  // Müşterinin istediği "bar-mutfak dışındakileri getirme" işi bu ikisiyle
  // çıkıyor; sayıların birbirini tutması aranıyor.
  console.log('\n== Sınıflandırma süzgeci ==');
  // Sınıf kullanan bir firma seçiyoruz; DEMO firmasında stok kartı yok.
  // Pasif kartı da olan firma tercih ediliyor, yoksa o kontrol atlanıyor.
  let SECIM = null;
  let pasifKartVar = false;
  for (const f of firmalar) {
    const aday = { firma: f.kod, donem: f.varsayilanDonem, depo: 0 };
    const kodlar = await vega.stokKodListeleri(aday).catch(() => ({}));
    if (!((kodlar && kodlar.kod2) || []).some((o) => o.adet > 0)) continue;
    const pasifli = ((kodlar && kodlar['kod' + vega.PASIF_ALANI.slice(3)]) || []).some(
      (o) => o.deger === vega.PASIF_KODU && o.adet > 0
    );
    if (!SECIM || (pasifli && !pasifKartVar)) {
      SECIM = aday;
      pasifKartVar = pasifli;
    }
    if (pasifKartVar) break;
  }
  if (!SECIM) SECIM = { firma: firmalar[0].kod, donem: firmalar[0].varsayilanDonem, depo: 0 };
  console.log(`  (firma ${SECIM.firma}/${SECIM.donem}${pasifKartVar ? '' : ', pasif kart yok'})`);
  const temel = { suzgec: 'tumu', tumKartlar: 1 };

  // SQL Server karşılaştırması büyük/küçük harfe duyarsız; JS tarafındaki
  // doğrulama da öyle olmalı, yoksa "70 cl" ile "70 CL" farklı sanılır.
  const sinifi = (s) => String(s.sinif || '').trim().toLocaleLowerCase('tr');
  const hepsi = await dene('Pasifler gizli (varsayılan)', () =>
    vega.stokKontrolListesi(Object.assign({}, SECIM, temel))
  );
  const pasifli = await dene('Pasifler dahil', () =>
    vega.stokKontrolListesi(Object.assign({}, SECIM, temel, { pasifDahil: 1 }))
  );
  await dene('Pasif kartlar varsayılanda gizleniyor', async () => {
    if (!hepsi || !pasifli) throw new Error('önceki sorgu başarısız');
    if (hepsi.some((s) => s.pasif)) throw new Error('gizli listede pasif kart var');
    // Firmada hiç pasif kart yoksa iki liste eşit olur; bu da doğru sonuç.
    if (pasifKartVar && !(pasifli.length > hepsi.length)) {
      throw new Error(`pasifli ${pasifli.length}, gizli ${hepsi.length}`);
    }
    if (!pasifKartVar && pasifli.length !== hepsi.length) {
      throw new Error('pasif kart yokken listeler farklı çıktı');
    }
    return 'tamam';
  });

  const secilenSinif = ((await vega.stokKodListeleri(SECIM)).kod2 || [])
    .filter((o) => o.adet > 0)
    .slice(0, 2)
    .map((o) => o.deger);
  if (secilenSinif.length === 2) {
    const icinde = await dene(`Yalnızca ${secilenSinif.join(' + ')}`, () =>
      vega.stokKontrolListesi(
        Object.assign({}, SECIM, temel, { kod2: secilenSinif.join(',') })
      )
    );
    const disinda = await dene(`${secilenSinif.join(' + ')} HARİÇ`, () =>
      vega.stokKontrolListesi(
        Object.assign({}, SECIM, temel, { kod2: secilenSinif.join(','), kod2Haric: 1 })
      )
    );
    const secilenKucuk = secilenSinif.map((d) => d.toLocaleLowerCase('tr'));
    await dene('Seçilen ve hariç tutulan birbirini tamamlıyor', async () => {
      if (!icinde || !disinda) throw new Error('önceki sorgu başarısız');
      const sizan = icinde.find((s) => !secilenKucuk.includes(sinifi(s)));
      if (sizan) throw new Error('seçim dışı sınıf sızdı: ' + sizan.sinif);
      const kalan = disinda.find((s) => secilenKucuk.includes(sinifi(s)));
      if (kalan) throw new Error('hariç tutulan sınıf listede kaldı: ' + kalan.sinif);
      if (icinde.length + disinda.length !== hepsi.length) {
        throw new Error(
          `${icinde.length} + ${disinda.length} = ${icinde.length + disinda.length}, ` +
          `toplam ${hepsi.length}`
        );
      }
      return 'tamam';
    });
    await dene('Dizi olarak da seçilebiliyor', async () => {
      const dizi = await vega.stokKontrolListesi(
        Object.assign({}, SECIM, temel, { kod2: [secilenSinif[0]] })
      );
      if (!dizi.length) throw new Error('boş döndü');
      if (!dizi.every((s) => sinifi(s) === secilenKucuk[0])) {
        throw new Error('başka sınıf sızdı');
      }
      return dizi;
    });
  }

  console.log(`\nSonuç: ${basarili} başarılı, ${basarisiz} hatalı\n`);
  await sql.havuzKapat();
  process.exit(basarisiz ? 1 : 0);
})();
