'use strict';

// ŞEFİM AKTARIMI — YAZMA SINAMASI (GALYA_TEST üzerinde)
//
//   node kurulum/test-yazma.js --kur          (bir kez, test veritabanı için)
//   node kurulum/test-aktarim-yazma.js
//
// Bir iş gününü GERÇEKTEN aktarır, yazılan bütün belgeleri satır satır
// doğrular, sonra geri alır ve hiçbir kalıntı kalmadığını kontrol eder.
//
// GÜVENLİK
// --------
// 1. Yazma hedefi GALYA_TEST'tir. Betik açılışta hedefi kontrol eder; hedef
//    GALYA_TEST değilse hiçbir şey yapmadan durur. Canlı VEGADB'ye yazmaz.
// 2. Okuma kaynağı GERÇEK `sefim` veritabanıdır — aktarımın girdisi orada.
//    Aktarım normalde `Bill.Aktarildi` alanını işaretler; bu betik önce o
//    alanın mevcut değerlerini saklar, sonunda AYNEN geri yazar. Şefim
//    veritabanı sınamadan etkilenmez.
// 3. Sonunda yazdığı her belgeyi geri alır; hata çıksa bile temizlik çalışır.

const path = require('path');
const fs = require('fs');
const os = require('os');

const kok = path.join(__dirname, '..');

// Panel tarafı GALYA_TEST'e yönlendiriliyor; gerçek ayar dosyasına dokunulmuyor.
const gercekAyar = JSON.parse(
  fs.readFileSync(process.env.GALYA_AYAR_DOSYASI || path.join(kok, 'ayarlar.json'), 'utf8')
    .replace(/^﻿/, '')
);
const testAyar = path.join(os.tmpdir(), 'galya-aktarim-yazma-ayarlar.json');
fs.writeFileSync(
  testAyar,
  JSON.stringify(
    Object.assign({}, gercekAyar, {
      vegaVeritabani: 'GALYA_TEST',
      varsayilanFirma: 'F0103',
      varsayilanDonem: 'D0015',
      varsayilanDepo: 1,
      sefimDepo: 1,
      vegayaYazmaAktif: true
    }),
    null,
    2
  ),
  'utf8'
);
process.env.GALYA_AYAR_DOSYASI = testAyar;

const sql = require(path.join(kok, 'db', 'sql'));
const { ayarOku } = require(path.join(kok, 'db', 'ayar'));
const aktarim = require(path.join(kok, 'db', 'aktarim'));
const panel = require(path.join(kok, 'db', 'panel'));

const SECIM = { firma: 'F0103', donem: 'D0015', depo: 1 };
const PD = '[GALYA_TEST].dbo.F0103D0015';

let basarili = 0;
let hatali = 0;

function ok(ad, kosul, not) {
  if (kosul) {
    basarili++;
    console.log(`  OK   ${ad}${not ? '  (' + not + ')' : ''}`);
  } else {
    hatali++;
    console.log(`  HATA ${ad}${not ? '  (' + not + ')' : ''}`);
  }
}

// Şefim'deki aktarım işaretlerinin sınama öncesi hâli. Sonunda aynen geri
// yazılıyor — bu betik gerçek Şefim verisine kalıcı dokunmamalı.
let sefimYedegi = [];

async function sefimIsaretleriniSakla(idler) {
  if (!idler.length) return;
  const s = ayarOku().sefimVeritabani;
  for (let i = 0; i < idler.length; i += 1000) {
    const parca = idler.slice(i, i + 1000);
    const r = await sql.sorgu(
      `SELECT Id, Aktarildi FROM [${s}].dbo.Bill WHERE Id IN (${parca.join(',')})`
    );
    sefimYedegi = sefimYedegi.concat(r);
  }
}

async function sefimIsaretleriniGeriYaz() {
  if (!sefimYedegi.length) return;
  const s = ayarOku().sefimVeritabani;
  const acik = sefimYedegi.filter((x) => x.Aktarildi).map((x) => Number(x.Id));
  const kapali = sefimYedegi.filter((x) => !x.Aktarildi).map((x) => Number(x.Id));
  for (const [idler, deger] of [[acik, 1], [kapali, 0]]) {
    for (let i = 0; i < idler.length; i += 1000) {
      const parca = idler.slice(i, i + 1000);
      if (!parca.length) continue;
      await sql.calistir(
        `UPDATE [${s}].dbo.Bill SET Aktarildi = ${deger} WHERE Id IN (${parca.join(',')})`
      );
    }
  }
  console.log(`  (Şefim aktarım işaretleri eski hâline döndürüldü: ${sefimYedegi.length} satır)`);
}

async function testTemizle() {
  const hedef = ayarOku().vegaVeritabani;
  if (hedef !== 'GALYA_TEST') throw new Error(`Temizlik yalnız GALYA_TEST'te; hedef "${hedef}".`);
  for (const t of [
    'TBLSTOKHAREKETLERI', 'TBLDEPOENVANTER', 'TBLCARIHAREKETLERI',
    'TBLSTKCIKHAREKET', 'TBLSTKCIKBASLIK',
    'TBLCARGIRHAREKET', 'TBLCARGIRBASLIK',
    'TBLCARCIKHAREKET', 'TBLCARCIKBASLIK',
    'TBLCARIGENELHAREKET', 'TBLKASA'
  ]) {
    await sql.calistir(`DELETE FROM ${PD}${t}`).catch(() => {});
  }
}

let aktarimId = null;

// GALYA_TEST'i aktarım için hazırlar.
//
// `test-yazma.js --kur` yalnız kendi ihtiyacı olan tabloları açıyor; aktarım
// cari giriş/çıkış, cari genel hareket ve kasa tablolarını da kullanıyor.
// Şema gerçek VEGADB'den kopyalanıyor (SELECT TOP 0 ... INTO, IDENTITY dahil).
//
// Ayrıca aktarımın o gün kullandığı stok kartları ile veresiye müşterilerinin
// cari kartları GALYA_TEST'e AYNI IND ile taşınıyor; aksi hâlde önizleme
// "0 kalem" çıkıyor ve yazma yolu gerçekten denenmiş olmuyor.
async function testVeritabaniniHazirla(kaynakVT, kaynakFirma, kaynakDonem) {
  const KD = `[${kaynakVT}].dbo.${kaynakFirma}${kaynakDonem}`;
  const KK = `[${kaynakVT}].dbo.${kaynakFirma}`;

  for (const t of [
    'TBLCARGIRBASLIK', 'TBLCARGIRHAREKET',
    'TBLCARCIKBASLIK', 'TBLCARCIKHAREKET',
    'TBLCARIGENELHAREKET', 'TBLKASA'
  ]) {
    const var_ = Number(
      (await sql.sorgu(
        `SELECT COUNT(*) a FROM GALYA_TEST.sys.tables WHERE name = @t`,
        { t: 'F0103D0015' + t }
      ))[0].a
    );
    if (var_) continue;
    await sql.calistir(`SELECT TOP 0 * INTO ${PD}${t} FROM ${KD}${t}`);
    console.log(`  (GALYA_TEST'e ${t} tablosu açıldı)`);
  }

  // Aktarımın kullanacağı stok kartları. Kaynak firmadaki Şefim belgelerinde
  // geçen kartların hepsi taşınıyor.
  const eksik = await sql.sorgu(
    `SELECT DISTINCT H.STOKNO
     FROM ${KD}TBLSTKCIKHAREKET H
     JOIN ${KD}TBLSTKCIKBASLIK B ON B.IND = H.EVRAKNO
     WHERE B.OZELKOD4 = 'SEFIM'
       AND H.STOKNO NOT IN (SELECT IND FROM [GALYA_TEST].dbo.F0103TBLSTOKLAR)`
  );
  if (eksik.length) {
    const kolonlar = (await sql.sorgu(
      `SELECT c.name FROM GALYA_TEST.sys.columns c
       JOIN GALYA_TEST.sys.tables t ON t.object_id = c.object_id
       WHERE t.name = 'F0103TBLSTOKLAR' AND c.name IN (
         SELECT c2.name FROM [${kaynakVT}].sys.columns c2
         JOIN [${kaynakVT}].sys.tables t2 ON t2.object_id = c2.object_id
         WHERE t2.name = '${kaynakFirma}TBLSTOKLAR')`
    )).map((x) => '[' + x.name + ']').join(', ');
    await sql.calistir(
      `SET IDENTITY_INSERT [GALYA_TEST].dbo.F0103TBLSTOKLAR ON;
       INSERT INTO [GALYA_TEST].dbo.F0103TBLSTOKLAR (${kolonlar})
       SELECT ${kolonlar} FROM ${KK}TBLSTOKLAR
       WHERE IND IN (${eksik.map((x) => Number(x.STOKNO)).join(',')});
       SET IDENTITY_INSERT [GALYA_TEST].dbo.F0103TBLSTOKLAR OFF;`
    );
    console.log(`  (${eksik.length} stok kartı GALYA_TEST'e taşındı)`);
  }

  // KDV grupları ve birimler de aynı IND'lerle gerekli.
  for (const [tablo, kosul] of [
    ['TBLKDVGRUPLARI', 'IND NOT IN (SELECT IND FROM [GALYA_TEST].dbo.F0103TBLKDVGRUPLARI)'],
    ['TBLBIRIMLEREX', 'IND NOT IN (SELECT IND FROM [GALYA_TEST].dbo.F0103TBLBIRIMLEREX) AND STOKNO IN (SELECT IND FROM [GALYA_TEST].dbo.F0103TBLSTOKLAR)']
  ]) {
    const kolonlar = (await sql.sorgu(
      `SELECT c.name FROM GALYA_TEST.sys.columns c
       JOIN GALYA_TEST.sys.tables t ON t.object_id = c.object_id
       WHERE t.name = 'F0103${tablo}' AND c.name IN (
         SELECT c2.name FROM [${kaynakVT}].sys.columns c2
         JOIN [${kaynakVT}].sys.tables t2 ON t2.object_id = c2.object_id
         WHERE t2.name = '${kaynakFirma}${tablo}')`
    )).map((x) => '[' + x.name + ']').join(', ');
    await sql.calistir(
      `SET IDENTITY_INSERT [GALYA_TEST].dbo.F0103${tablo} ON;
       INSERT INTO [GALYA_TEST].dbo.F0103${tablo} (${kolonlar})
       SELECT ${kolonlar} FROM ${KK}${tablo} WHERE ${kosul};
       SET IDENTITY_INSERT [GALYA_TEST].dbo.F0103${tablo} OFF;`
    ).catch(() => {});
  }
}

(async () => {
  const hedef = ayarOku().vegaVeritabani;
  console.log(`Şefim aktarımı YAZMA sınaması — hedef ${hedef} / F0103 / D0015\n`);
  if (hedef !== 'GALYA_TEST') {
    console.error(`DURDURULDU: yazma hedefi "${hedef}". Bu betik yalnız GALYA_TEST'te çalışır.`);
    process.exit(1);
  }

  await panel.kur();
  await testTemizle();

  // Kaynak (okuma) tarafı gerçek Vega kurulumudur; şema ve kartlar oradan
  // kopyalanıyor. Yazma yine yalnız GALYA_TEST'e gidiyor.
  console.log('== Hazırlık ==');
  await testVeritabaniniHazirla(
    gercekAyar.vegaVeritabani || 'VEGADB',
    gercekAyar.varsayilanFirma || 'F0102',
    gercekAyar.varsayilanDonem || 'D0002'
  );
  console.log('');

  // Aktarılacak gün: Şefim'de satışı olan son iş günü.
  const gunler = await aktarim.gunler(Object.assign({}, SECIM, { gun: 400 }));
  const aday = gunler.find((g) => g.satirSayisi > 20);
  if (!aday) {
    console.log('Şefim tarafında aktarılacak gün bulunamadı; sınama atlandı.');
    await sql.havuzKapat().catch(() => {});
    process.exit(0);
  }
  const gun = new Date(aday.isGunu).toISOString().slice(0, 10);
  console.log(`Aktarılacak iş günü: ${gun}\n`);

  const on = await aktarim.onizleme(Object.assign({}, SECIM, { tarih: gun }));
  console.log(
    `Önizleme: ${on.toplam.satir} kalem · ${on.toplam.tahsilatToplami.toFixed(2)} TL tahsilat · ` +
    `${on.kasaHareketleri.length} kasa hareketi · ${on.veresiye.length} veresiye müşterisi\n`
  );

  try {
    console.log('== Aktarım ==');
    const sonuc = await aktarim.aktar(
      Object.assign({}, SECIM, { tarih: gun, zorla: true }),
      { kullanici: 'test-aktarim-yazma', bilgisayar: os.hostname() }
    );
    aktarimId = sonuc.id;
    ok('Aktarım tamamlandı', sonuc.tamam === true, `${sonuc.belgeler.length} belge`);

    const satisBelgesi = sonuc.belgeler.find((b) => b.ne === 'satis');
    ok('Satış belgesi kesildi', !!satisBelgesi, satisBelgesi && satisBelgesi.belgeNo);
    ok(
      'Belge numarası panelin kendi serisinde',
      satisBelgesi && /^[A-Z0-9]{1,4}\d{7}$/.test(satisBelgesi.belgeNo) &&
        !satisBelgesi.belgeNo.startsWith('A'),
      satisBelgesi && satisBelgesi.belgeNo
    );

    console.log('\n== Yazılan satırlar ==');
    const ind = satisBelgesi.baslikInd;
    const baslik = (await sql.sorgu(
      `SELECT TUTAR, ARATOPLAM, YUVARLAMA, BELGETIPI, FIRMANO, DEPO, OZELKOD4
       FROM ${PD}TBLSTKCIKBASLIK WHERE IND = @i`, { i: ind }))[0];
    ok('Başlık yazıldı', !!baslik);
    ok('Belge tipi 33', baslik && Number(baslik.BELGETIPI) === 33);
    ok('SEFIM işareti kondu', baslik && baslik.OZELKOD4 === 'SEFIM');
    ok(
      'Başlık tutarı önizlemeyle aynı',
      baslik && Math.abs(Number(baslik.TUTAR) - on.toplam.tahsilatToplami) < 0.01,
      baslik && Number(baslik.TUTAR).toFixed(2)
    );

    const say = async (t, kosul, p) =>
      Number((await sql.sorgu(`SELECT COUNT(*) a FROM ${PD}${t} WHERE ${kosul}`, p))[0].a);

    const satirSayisi = await say('TBLSTKCIKHAREKET', 'EVRAKNO = @i', { i: ind });
    ok('Satır sayısı önizlemeyle aynı', satirSayisi === on.toplam.satir,
      `${satirSayisi} / ${on.toplam.satir}`);
    ok('Stok hareketi yazıldı',
      (await say('TBLSTOKHAREKETLERI', 'BELGENO = @i AND IZAHAT = 33', { i: ind })) === satirSayisi);
    ok('Depo envanteri yazıldı',
      (await say('TBLDEPOENVANTER', 'BELGEIND = @i AND BELGETIPI = 33', { i: ind })) === satirSayisi);
    ok('Cari hareketi yazıldı',
      (await say('TBLCARIHAREKETLERI', "LN = @i AND IZAHAT = '33'", { i: ind })) === 1);

    // Stok gerçekten düştü mü?
    const ornek = on.satirlar[0];
    const envanter = (await sql.sorgu(
      `SELECT SUM(ENVANTER) AS toplam FROM ${PD}TBLDEPOENVANTER
       WHERE STOKNO = @s AND BELGEIND = @i`, { s: ornek.stokNo, i: ind }))[0];
    ok(
      'Stok eksiye yazıldı (çıkış)',
      envanter && Math.abs(Number(envanter.toplam) + ornek.miktar) < 0.0001,
      `${ornek.stokAdi}: ${envanter && envanter.toplam}`
    );

    console.log('\n== Tahsilat ve kasa belgeleri ==');
    for (const b of sonuc.belgeler.filter((x) => x.ne === 'tahsilat')) {
      const h = await say('TBLCARGIRHAREKET', 'EVRAKNO = @i', { i: b.baslikInd });
      const g = await say('TBLCARIGENELHAREKET', 'BELGEIND = @i AND BELGEIZAHAT = 13', { i: b.baslikInd });
      ok(`Tahsilat belgesi ${b.tur}`, h > 0 && g === h, `${h} satır`);
    }
    const kasaCikisB = sonuc.belgeler.find((x) => x.ne === 'kasaCikis');
    if (kasaCikisB) {
      const h = await say('TBLCARCIKHAREKET', 'EVRAKNO = @i', { i: kasaCikisB.baslikInd });
      const kasa = await say('TBLKASA', 'BELGELINK = @i AND BELGEIZAHAT = 11', { i: kasaCikisB.baslikInd });
      ok('Kasa çıkış belgesi', h === on.kasaHareketleri.filter((x) => x.tutar < 0).length);
      ok('Kasa satırları yazıldı', kasa === h, `${kasa} satır`);
    }
    // Kredi kartı tahsilatının kasa satırı OLMAMALI — para kasaya girmiyor.
    const kkBelge = sonuc.belgeler.find((x) => x.ne === 'tahsilat' && x.tur === 'KREDİKARTI');
    if (kkBelge) {
      ok(
        'Kredi kartı tahsilatının kasa satırı yok',
        (await say('TBLKASA', 'BELGELINK = @i AND BELGEIZAHAT = 13', { i: kkBelge.baslikInd })) === 0
      );
    }

    console.log('\n== Veresiye belgeleri ==');
    const veresiyeBelgeleri = sonuc.belgeler.filter((x) => x.ne === 'veresiye');
    ok(
      'Her veresiye müşterisine fiş kesildi',
      veresiyeBelgeleri.length === on.veresiye.filter((m) => m.satirlar.length).length,
      `${veresiyeBelgeleri.length} fiş`
    );
    for (const b of veresiyeBelgeleri.slice(0, 3)) {
      const bh = (await sql.sorgu(
        `SELECT TUTAR, FIRMANO FROM ${PD}TBLSTKCIKBASLIK WHERE IND = @i`, { i: b.baslikInd }))[0];
      const m = on.veresiye.find((x) => x.musteri === b.musteri);
      ok(
        `Veresiye "${b.musteri}" fişi`,
        bh && m && Math.abs(Number(bh.TUTAR) - m.toplam) < 0.01,
        bh && Number(bh.TUTAR).toFixed(2)
      );
    }

    console.log('\n== Aynı günü ikinci kez aktarma ==');
    let ikinciGecti = false;
    try {
      await aktarim.aktar(
        Object.assign({}, SECIM, { tarih: gun, zorla: true }),
        { kullanici: 'test-aktarim-yazma' }
      );
      ikinciGecti = true;
    } catch (e) {
      ok('İkinci aktarım reddedildi', /ZATEN_AKTARILDI|AKTARIM_SURUYOR/.test(e.kod || ''), e.kod);
    }
    if (ikinciGecti) ok('İkinci aktarım reddedildi', false, 'İKİNCİ AKTARIM GEÇTİ');

    console.log('\n== Geri alma ==');
    const geri = await aktarim.geriAl(
      Object.assign({}, SECIM, { id: aktarimId }),
      { kullanici: 'test-aktarim-yazma' }
    );
    aktarimId = null;
    ok('Geri alma çalıştı', geri.tamam === true, `${geri.silinenSatir} satır silindi`);

    ok('Stok çıkış başlığı silindi',
      (await say('TBLSTKCIKBASLIK', 'IND = @i', { i: ind })) === 0);
    ok('Stok çıkış satırları silindi',
      (await say('TBLSTKCIKHAREKET', 'EVRAKNO = @i', { i: ind })) === 0);
    ok('Stok hareketleri silindi',
      (await say('TBLSTOKHAREKETLERI', 'BELGENO = @i AND IZAHAT = 33', { i: ind })) === 0);
    ok('Depo envanteri silindi',
      (await say('TBLDEPOENVANTER', 'BELGEIND = @i AND BELGETIPI = 33', { i: ind })) === 0);
    ok('Cari hareketi silindi',
      (await say('TBLCARIHAREKETLERI', "LN = @i AND IZAHAT = '33'", { i: ind })) === 0);

    let kalan = 0;
    for (const b of sonuc.belgeler) {
      if (b.belgeTipi === 33) {
        kalan += await say('TBLSTKCIKBASLIK', 'IND = @i', { i: b.baslikInd });
      } else if (b.belgeTipi === 13) {
        kalan += await say('TBLCARGIRBASLIK', 'IND = @i', { i: b.baslikInd });
        kalan += await say('TBLKASA', 'BELGELINK = @i AND BELGEIZAHAT = 13', { i: b.baslikInd });
      } else {
        kalan += await say('TBLCARCIKBASLIK', 'IND = @i', { i: b.baslikInd });
        kalan += await say('TBLKASA', 'BELGELINK = @i AND BELGEIZAHAT = 11', { i: b.baslikInd });
      }
    }
    ok('Hiçbir belgeden kalıntı yok', kalan === 0, `${kalan} kalıntı`);

    console.log('\n== Geri alınan gün yeniden aktarılabiliyor ==');
    const tekrar = await aktarim.onizleme(Object.assign({}, SECIM, { tarih: gun }));
    ok('Gün yeniden aday', !tekrar.zatenAktarildi);
  } finally {
    // Yarım kalmışsa geri al, sonra Şefim işaretlerini eski hâline döndür.
    if (aktarimId) {
      await aktarim
        .geriAl(Object.assign({}, SECIM, { id: aktarimId }), { kullanici: 'test-temizlik' })
        .catch((e) => console.log('  !! Temizlik sırasında geri alma başarısız: ' + e.message));
    }
    const p = ayarOku().panelVeritabani;
    await sql.calistir(
      `DELETE FROM [${p}].dbo.SefimAktarim WHERE Firma = 'F0103' AND Donem = 'D0015'`
    ).catch(() => {});
    await testTemizle().catch(() => {});
    await sefimIsaretleriniGeriYaz().catch((e) =>
      console.log('  !! Şefim işaretleri geri yazılamadı: ' + e.message)
    );
  }

  console.log(`\nSonuç: ${basarili} başarılı, ${hatali} hatalı`);
  await sql.havuzKapat().catch(() => {});
  process.exit(hatali ? 1 : 0);
})().catch(async (e) => {
  console.error('\nBEKLENMEYEN HATA:', e.message);
  console.error(e.stack);
  await sefimIsaretleriniGeriYaz().catch(() => {});
  process.exit(1);
});

// Şefim işaretleri, aktarım onları değiştirmeden önce saklanmalı. aktar()
// içinden çağrılan yazma fonksiyonunu sarmalayarak yakalıyoruz.
const yazma = require(path.join(kok, 'db', 'yazma'));
const asilIsaretle = yazma.sefimSatirlariIsaretle;
yazma.sefimSatirlariIsaretle = async function (billIdler, deger) {
  await sefimIsaretleriniSakla((Array.isArray(billIdler) ? billIdler : []).map(Number).filter(Boolean));
  return asilIsaretle.call(this, billIdler, deger);
};
