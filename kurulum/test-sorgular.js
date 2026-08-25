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
