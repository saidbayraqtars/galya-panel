'use strict';

require('./test-ortam').ayarla();

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
const uretim = require(path.join(kok, 'db', 'uretim'));
const yedek = require(path.join(kok, 'db', 'yedek'));

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

  // --- 22.08.2026'da eklenenler -----------------------------------------

  console.log('\n== Gider / hizmet ekranının kapsamı ==');
  const giderKartlari = await dene('Yalnızca gider/hizmet (STOKTIPI 3)', () =>
    vega.giderHizmetStoklari(Object.assign({}, SECIM, { kapsam: 'gider', sadeceDolu: false }))
  );
  const barMutfakDisi = await dene('Bar-mutfak dışı tüm ürünler', () =>
    vega.giderHizmetStoklari(Object.assign({}, SECIM, { kapsam: 'disi', sadeceDolu: false }))
  );
  await dene('Listeye BAR ve MUTFAK sızmıyor', async () => {
    if (!barMutfakDisi) throw new Error('önceki sorgu başarısız');
    const sizan = barMutfakDisi.find((k) => {
      const sinif = String(k.sinif || '').trim().toLocaleUpperCase('tr');
      // Gider/hizmet kartları sınıfı ne olursa olsun listeye girer.
      return Number(k.stokTipi) !== 3 && (sinif === 'BAR' || sinif === 'MUTFAK');
    });
    if (sizan) throw new Error('sızan kart: ' + sizan.ad + ' / ' + sizan.sinif);
    return 'tamam';
  });
  await dene('Geniş liste dar listeyi kapsıyor', async () => {
    if (!giderKartlari || !barMutfakDisi) throw new Error('önceki sorgu başarısız');
    const genis = new Set(barMutfakDisi.map((k) => Number(k.stokNo)));
    const eksik = giderKartlari.find((k) => !genis.has(Number(k.stokNo)));
    if (eksik) throw new Error('gider kartı geniş listede yok: ' + eksik.ad);
    return `${giderKartlari.length} gider kartı, ${barMutfakDisi.length} toplam`;
  });

  console.log('\n== Sayım süzgeci (tam sayım) ==');
  const tamHepsi = await dene('Tam sayım — süzgeçsiz', () =>
    sayim.sayimEkraniGetir(Object.assign({}, SECIM, { tur: 'tam' }))
  );
  const tamBar = await dene('Tam sayım — yalnızca BAR', () =>
    sayim.sayimEkraniGetir(Object.assign({}, SECIM, { tur: 'tam', kod2: 'BAR' }))
  );
  const tamBarHaric = await dene('Tam sayım — BAR hariç', () =>
    sayim.sayimEkraniGetir(Object.assign({}, SECIM, { tur: 'tam', kod2: 'BAR', kod2Haric: 1 }))
  );
  await dene('Süzgeç listeyi ikiye bölüyor', async () => {
    if (!tamHepsi || !tamBar || !tamBarHaric) throw new Error('önceki sorgu başarısız');
    if (tamBar.length + tamBarHaric.length !== tamHepsi.length) {
      throw new Error(
        `${tamBar.length} + ${tamBarHaric.length} = ${tamBar.length + tamBarHaric.length}, ` +
        `toplam ${tamHepsi.length}`
      );
    }
    const sizan = tamBar.find((x) => String(x.sinif || '').trim() !== 'BAR');
    if (sizan) throw new Error('süzgeç dışı sınıf sızdı: ' + sizan.sinif);
    return 'tamam';
  });
  await dene('Süzgeç kapsamı GENİŞLETEMİYOR', async () => {
    // Kullanıcının kapsamı BAR iken MUTFAK süzgeci istense bile liste boş
    // kalmalı; süzgeç ile kapsam AND'leniyor.
    const liste = await sayim.sayimEkraniGetir(
      Object.assign({}, SECIM, { tur: 'tam', siniflar: ['BAR'], kod2: 'MUTFAK' })
    );
    if (liste.length) throw new Error(liste.length + ' satır sızdı');
    return 'tamam';
  });

  await dene('Sayım stok durumu süzgeci (eksi)', async () => {
    const liste = await sayim.sayimEkraniGetir(
      Object.assign({}, SECIM, { tur: 'tam', stokDurumu: 'eksi' })
    );
    for (const x of liste) {
      if (!(Number(x.teorik) < 0)) throw new Error('eksi olmayan satır sızdı: ' + x.stokAdi);
    }
    return liste.length + ' satır';
  });
  await dene('Sayım stok durumu süzgeci (sıfır)', async () => {
    const liste = await sayim.sayimEkraniGetir(
      Object.assign({}, SECIM, { tur: 'tam', stokDurumu: 'sifir' })
    );
    for (const x of liste) {
      if (Math.abs(Number(x.teorik)) > 0.0001) {
        throw new Error('sıfır olmayan satır sızdı: ' + x.stokAdi);
      }
    }
    return liste.length + ' satır';
  });
  await dene('Stok durumu süzgeci kapsamı genişletmiyor', async () => {
    // Kapsamı BAR olan kullanıcı "eksi" süzgeciyle mutfak ürünü göremez.
    const liste = await sayim.sayimEkraniGetir(
      Object.assign({}, SECIM, { tur: 'tam', siniflar: ['BAR'], stokDurumu: 'eksi' })
    );
    for (const x of liste) {
      if ((x.sinif || '').trim() !== 'BAR') throw new Error('kapsam dışı: ' + x.stokAdi);
    }
    return liste.length + ' satır';
  });

  console.log('\n== Üretim ==');
  await dene('Pasif mamul üretim listesinde ve ürün seçicide görünmüyor', async () => {
    const a = require('../db/ayar').ayarOku();
    const pasifler = await sql.sorgu(`SELECT S.IND AS stokNo FROM ${firma.kart(a.vegaVeritabani, SECIM.firma, 'TBLSTOKLAR')} S
      WHERE ${vega.pasifIfadesi()} = 1`);
    const no = new Set(pasifler.map((s) => Number(s.stokNo)));
    const aday = await uretim.sifirAdaylari(SECIM);
    const secici = await uretim.urunAra({ ...SECIM, receteliSadece: true });
    if ([...aday, ...secici].some((s) => no.has(Number(s.stokNo)))) throw new Error('Pasif mamul sızdı.');
    return pasifler;
  });
  await dene('Pasif bileşenli reçete uyarı veriyor; bileşen korunuyor', async () => {
    const a = require('../db/ayar').ayarOku();
    const kk = (ad) => firma.kart(a.vegaVeritabani, SECIM.firma, ad);
    const r = await sql.sorgu(`SELECT DISTINCT L.STOKNO AS stokNo, R.STOKNO AS bilesen
      FROM ${kk('TBLURERECETELIST')} L JOIN ${kk('TBLURERECETE')} R ON R.EVRAKNO=L.IND
      JOIN ${kk('TBLSTOKLAR')} S ON S.IND=R.STOKNO
      JOIN ${kk('TBLSTOKLAR')} M ON M.IND=L.STOKNO
      WHERE ${vega.pasifIfadesi()} = 1 AND ${vega.stokPasifHaric('M')} AND ISNULL(M.DELETED,0)=0`);
    if (!r.length) throw new Error('Pasif bileşen örneği yok; vaka doğrulanamadı.');
    for (const x of r) {
      const emir = await uretim.isEmri({ ...SECIM, mamulStokNo: x.stokNo });
      if (!emir.girdiler.some((g) => g.stokNo === Number(x.bilesen) && g.pasif) ||
          !emir.uyarilar.some((u) => u.includes('pasif kart'))) throw new Error('Pasif bileşen uyarısı eksik.');
    }
    return r;
  });
  await dene('Reçeteli ürün kapsamı SQL ile birebir; pasif reçeteler rozetli', async () => {
    const a = require('../db/ayar').ayarOku();
    const kk = (ad) => firma.kart(a.vegaVeritabani, SECIM.firma, ad);
    const ham = await sql.sorgu(`SELECT DISTINCT STOKNO AS stokNo FROM ${kk('TBLURERECETELIST')}`);
    const liste = await vega.receteliMamuller(SECIM);
    const numaralar = new Set(liste.map((r) => Number(r.mamulStokNo)));
    if (liste.length !== ham.length || ham.some((r) => !numaralar.has(Number(r.stokNo)))) throw new Error('Reçete listesi farklı.');
    const aktif = await sql.sorgu(`SELECT DISTINCT S.IND AS stokNo FROM ${kk('TBLSTOKLAR')} S
      JOIN ${kk('TBLURERECETELIST')} L ON L.STOKNO=S.IND
      WHERE S.IND>=100 AND ISNULL(S.DELETED,0)=0 AND S.STOKTIPI NOT IN (3,7,9,11,26) AND ${vega.stokPasifHaric()}`);
    const secici = await uretim.urunAra({ ...SECIM, receteliSadece: true });
    const seciciNo = new Set(secici.map((r) => Number(r.stokNo)));
    if (aktif.length !== secici.length || aktif.some((r) => !seciciNo.has(Number(r.stokNo)))) throw new Error('Üretim seçicisi reçete kapsamı farklı.');
    const maliyet = await require('../db/maliyet').hesapla(SECIM);
    const maliyetListe = Array.isArray(maliyet) ? maliyet : maliyet.satirlar;
    if (!maliyetListe) throw new Error('Maliyet listesi dönmedi.');
    const maliyetNo = new Set(maliyetListe.filter((r) => r.mamulMu).map((r) => Number(r.stokNo)));
    if (aktif.length !== maliyetNo.size || aktif.some((r) => !maliyetNo.has(Number(r.stokNo)))) throw new Error('Maliyet motoru reçete kapsamı farklı.');
    console.log(`       Ham reçeteli ${ham.length}; pasif ${liste.filter((r) => r.pasif).length}; aktif seçici/maliyet ${aktif.length}`);
    return liste;
  });
  await dene('TUBORG kartları reçetesiz', async () => {
    const liste = await uretim.urunAra({ ...SECIM, arama: 'TUBORG' });
    if (!liste.length || liste.some((r) => r.receteNo)) throw new Error('TUBORG reçete işareti yanlış veya örnek yok.');
    return liste;
  });
  await dene('Ürün arama (reçete şartsız)', () =>
    uretim.urunAra(Object.assign({}, SECIM, { arama: '' }))
  );
  await dene('Sıfıra çekilecek adaylar (eksi stok + reçete)', async () => {
    const liste = await uretim.sifirAdaylari(Object.assign({}, SECIM));
    // Liste boş olabilir (eksiye düşmüş ürün yoksa); dolan satırların hepsi
    // eksi kalanlı, reçeteli olmalı ve üretilecek miktar eksinin karşılığı.
    for (const a of liste) {
      if (!(Number(a.kalan) < 0)) throw new Error('eksi olmayan satır: ' + a.ad);
      if (!(Number(a.receteSatiri) > 0)) throw new Error('reçetesiz satır: ' + a.ad);
      // Kendini tüketmeyen reçetede üretilecek miktar eksinin karşılığı;
      // tüketende eksik / (1 - oran) kadar (şişeden kadeh üretimi böyle).
      const oran = Number(a.kendiOran) || 0;
      if (a.isEmriGerekli) {
        if (!a.uretilemez || a.uretilecek != null) throw new Error('çok çıktılı ürün toplu üretime açık');
        continue;
      }
      if (oran >= 1) {
        if (!a.uretilemez) throw new Error('oran 1 ustu ama uretilemez isareti yok: ' + a.ad);
        continue;
      }
      const beklenen = -Number(a.kalan) / (1 - oran);
      if (Math.abs(Number(a.uretilecek) - beklenen) > 0.0001) {
        throw new Error(`üretilecek miktar yanlış: ${a.ad} ${a.uretilecek} != ${beklenen}`);
      }
    }
    return liste.length + ' aday';
  });
  await dene('Kendini tüketen reçetede üretim ölçekleniyor', async () => {
    const liste = await uretim.sifirAdaylari(Object.assign({}, SECIM));
    const kendini = liste.filter((a) => Number(a.kendiOran) > 0);
    // F0102'de içki kartlarının reçetesi kendini tüketiyor (şişeden kadeh).
    // Böyle bir kart yoksa sınama yalnızca "sızmadı" demiş oluyor.
    for (const a of kendini) {
      if (!(Number(a.uretilecek) > -Number(a.kalan))) {
        throw new Error('ölçeklenmemiş: ' + a.ad);
      }
    }
    return kendini.length + ' kart kendini tüketiyor';
  });
  // İş Emri ucu: ekranın mamul seçildiği anda çağırdığı tek uç. Girdiler,
  // çıktılar ve birim maliyetler bir arada dönmezse ekran Vega'nın İş Emri
  // ekranını dolduramaz.
  await dene('İş emri girdi + çıktı + birim maliyet döndürüyor', async () => {
    const adaylar = await uretim.urunAra(Object.assign({}, SECIM, { arama: '' }));
    let receteli = 0;
    let denenen = 0;
    for (const u of adaylar) {
      if (denenen >= 25) break;
      const e = await uretim.isEmri(Object.assign({}, SECIM, { mamulStokNo: u.stokNo }));
      denenen++;
      if (!e.mamul || Number(e.mamul.stokNo) !== Number(u.stokNo)) {
        throw new Error('mamul kartı dönmedi: ' + u.ad);
      }
      if (!e.receteNo) {
        if (e.girdiler.length || e.ciktilar.length) {
          throw new Error('reçetesiz mamulde satır döndü: ' + u.ad);
        }
        continue;
      }
      receteli++;
      // Reçeteli mamulde çıktı satırlarının içinde ana mamul olmalı ve oran
      // toplamı satırların toplamına eşit olmalı.
      const ana = e.ciktilar.filter((c) => c.anaMamul);
      if (e.ciktilar.length && ana.length !== 1) {
        throw new Error('ana mamul çıktısı tek değil: ' + u.ad + ' (' + ana.length + ')');
      }
      const toplam = e.ciktilar.reduce((t, c) => t + Number(c.oran), 0);
      if (Math.abs(toplam - e.oranToplami) > 0.0001) {
        throw new Error('oran toplamı tutmuyor: ' + u.ad);
      }
      for (const g of e.girdiler) {
        if (!(Number(g.birimMaliyet) >= 0)) throw new Error('birim maliyet yok: ' + g.ad);
      }
    }
    return denenen + ' mamul denendi, ' + receteli + ' reçeteli';
  });

  // Ekranın gösterdiği maliyet Vega'nın kendi yazdığı fişle aynı formülden
  // çıkmalı (URETIM-BULGU-08-09-2026.md):
  //
  //   satır.TUTAR = toplamMaliyet × ORAN / 100
  //   satır.FIYAT = satır.TUTAR / satır.MIKTAR
  //
  // Vega'nın gerçek çok çıktılı fişleri üzerinde doğrulanıyor: bir fişteki
  // ORAN'ı sıfırdan büyük herhangi bir satırdan toplam maliyet geri
  // hesaplanıp bütün satırlar onunla karşılaştırılıyor.
  // BAŞLA / BİTİR adımı KOD ile bulunmalı, SIRANO ile değil. F0102'de 4481 ve
  // 4529'da BİTİR 3. sırada; 1153'te 3. sırada deposu boş ikinci bir BAŞLA
  // var. Ayardaki depo ne olursa olsun mamul reçetenin BİTİR deposuna girer.
  await dene('Pozisyon depoları KOD ile seçiliyor (3 adımlı reçeteler)', async () => {
    const v = require(path.join(kok, 'db', 'ayar')).ayarOku().vegaVeritabani;
    const { pozisyonlariOku, depoSecimi } = require(path.join(kok, 'db', 'uretim-depo'));
    const beklenen = [
      { recete: 4516, uretim: 100, mamul: 1 },  // BAŞLA MUTFAK → BİTİR MERKEZ
      { recete: 4481, uretim: 101, mamul: 1 },  // BİTİR 3. sırada
      { recete: 4529, mamul: 1 },               // BAŞLA deposu 0, BİTİR 3. sırada
      { recete: 1153, uretim: 101, mamul: 1 }   // 3. sırada boş ikinci BAŞLA
    ];
    for (const b of beklenen) {
      const pozlar = await pozisyonlariOku(v, 'F0102', b.recete);
      if (!pozlar.length) continue; // başka kurulumda reçete yok
      for (const ayarDepo of [1, 100, 102]) {
        const d = depoSecimi(pozlar, ayarDepo, ayarDepo);
        if (d.mamulDeposu !== b.mamul) {
          throw new Error(`Reçete ${b.recete}, ayar ${ayarDepo}: mamul deposu ${d.mamulDeposu}, beklenen ${b.mamul}`);
        }
        if (b.uretim && d.uretimDeposu !== b.uretim) {
          throw new Error(`Reçete ${b.recete}: üretim deposu ${d.uretimDeposu}, beklenen ${b.uretim}`);
        }
        if (!d.receteDeposu) throw new Error(`Reçete ${b.recete}: depo seçicisi kilitlenmiyor`);
      }
    }
    return 'tamam';
  });

  await dene('Vega fişlerinde TUTAR = toplam × ORAN / 100', async () => {
    const v = require(path.join(kok, 'db', 'ayar')).ayarOku().vegaVeritabani;
    const on = `[${v}].dbo.${SECIM.firma}${SECIM.donem}`;
    const satirlar = await sql.sorgu(
      `SELECT TOP 400 C.EVRAKNO, ISNULL(C.MIKTAR,0) AS miktar, ISNULL(C.ORAN,0) AS oran,
              ISNULL(C.FIYAT,0) AS fiyat, ISNULL(C.TUTAR,0) AS tutar
       FROM ${on}TBLUREURETIMCIKTI C
       WHERE C.EVRAKNO IN (
         SELECT EVRAKNO FROM ${on}TBLUREURETIMCIKTI
         GROUP BY EVRAKNO HAVING COUNT(*) > 1
       )
       ORDER BY C.EVRAKNO DESC`,
      {}
    );
    if (!satirlar.length) return 'çok çıktılı fiş yok';

    const fisler = new Map();
    for (const r of satirlar) {
      if (!fisler.has(r.EVRAKNO)) fisler.set(r.EVRAKNO, []);
      fisler.get(r.EVRAKNO).push(r);
    }

    let denetlenen = 0;
    for (const [evrakNo, grup] of fisler) {
      const oranli = grup.find((r) => Number(r.oran) > 0 && Number(r.tutar) > 0);
      if (!oranli) continue;
      const toplam = Number(oranli.tutar) * 100 / Number(oranli.oran);
      for (const r of grup) {
        const beklenen = toplam * Number(r.oran) / 100;
        // Vega tutarı altı basamağa yuvarlıyor; oransal sapma payı bırakıldı.
        if (Math.abs(Number(r.tutar) - beklenen) > Math.max(0.02, beklenen * 1e-6)) {
          throw new Error(
            `fiş ${evrakNo}: tutar ${r.tutar} != ${beklenen.toFixed(6)} (oran ${r.oran})`
          );
        }
        if (Number(r.miktar) > 0) {
          const birim = Number(r.tutar) / Number(r.miktar);
          if (Math.abs(birim - Number(r.fiyat)) > Math.max(0.01, birim * 1e-6)) {
            throw new Error(`fiş ${evrakNo}: fiyat ${r.fiyat} != ${birim.toFixed(6)}`);
          }
        }
      }
      denetlenen++;
    }
    return denetlenen + ' çok çıktılı fiş denetlendi';
  });

  await dene('THIRD süzgeci adayları daraltıyor', async () => {
    const hepsi = await uretim.sifirAdaylari(Object.assign({}, SECIM));
    const dar = await uretim.sifirAdaylari(Object.assign({}, SECIM, { thirdSadece: 1 }));
    if (dar.length > hepsi.length) throw new Error('dar liste daha uzun döndü');
    return `${hepsi.length} -> ${dar.length}`;
  });
  await dene('Kaldırılan üretim uçları geri gelmemiş', async () => {
    for (const ad of ['adaylar', 'uret', 'hepsiniUret', 'zayiatliUret', 'uretilebilirler']) {
      if (typeof uretim[ad] === 'function') throw new Error('hâlâ duruyor: ' + ad);
    }
    return 'tamam';
  });

  console.log('\n== Yedekleme ==');
  await dene('Yedek durumu okunuyor', async () => {
    const d = await yedek.durum();
    if (!d || !Array.isArray(d.veritabanlari)) throw new Error('durum eksik döndü');
    // Yetki verilmemiş olabilir; sınama yetkiyi değil, ucun çalıştığını denetliyor.
    return `sunucu ${d.sunucu}, klasör ${d.klasor || '(yok)'}, ` +
      d.veritabanlari.map((v) => v.ad + (v.yedekYetkisi ? '+' : '-')).join(' ');
  });
  await dene('Yedek hatırlatması', async () => {
    const h = await yedek.hatirlatma();
    if (typeof h.gerekli !== 'boolean') throw new Error('gerekli alanı yok');
    return h.mesaj;
  });
  await dene('Yedek listesi', async () => {
    const l = await yedek.liste({});
    if (!Array.isArray(l.yedekler)) throw new Error('liste dizi değil');
    return l.yedekler;
  });
  // Bu sınama YEDEK ALMIYOR: VEGADB'nin tam yedeği 2,2 GB ve her sınama
  // çalıştırışında bir tane almak kabul edilemez. Yalnızca okuma uçlarına
  // ve ayarların yerine oturduğuna bakıyoruz. İşlem öncesi yedeğin kendisi
  // canlıda uçtan uca denendi (bkz. DEVIR-NOTU → işlem öncesi yedek).
  await dene('Geri dönüş noktaları okunuyor', async () => {
    const n = await yedek.donusNoktalari({ sinir: 10 });
    if (!Array.isArray(n)) throw new Error('dizi değil');
    for (const x of n) {
      if (!x.dosya) throw new Error('dosya alanı boş');
      if (!x.temelDosya) throw new Error('temel dosya alanı boş: ' + x.dosya);
    }
    return n;
  });
  await dene('İşlem öncesi yedek ayarları okunuyor', async () => {
    const d = await yedek.durum();
    if (typeof d.islemOncesiYedek !== 'boolean') throw new Error('islemOncesiYedek yok');
    if (!(d.islemSayisi >= 2)) throw new Error('islemSayisi geçersiz: ' + d.islemSayisi);
    if (!(d.temelSaat > 0)) throw new Error('temelSaat geçersiz: ' + d.temelSaat);
    return `işlem öncesi ${d.islemOncesiYedek ? 'açık' : 'kapalı'}, ` +
      `${d.islemSayisi} dönüş noktası, temel ${d.temelSaat} saat`;
  });

  console.log(`\nSonuç: ${basarili} başarılı, ${basarisiz} hatalı\n`);
  await sql.havuzKapat();
  process.exit(basarisiz ? 1 : 0);
})();
