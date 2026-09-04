'use strict';

// Vega'ya yazma işlemlerinin sınaması.
//
// Müşteri veritabanına DOKUNMAZ: yapısı VEGADB'den kopyalanmış, boş bir
// GALYA_TEST veritabanı üzerinde çalışır. Kurulumu:
//
//   node kurulum/test-yazma.js --kur     (test veritabanını hazırlar)
//   node kurulum/test-yazma.js           (sınamayı çalıştırır)
//
// Sınama; tutanak fiş çiftini yazar, dört tablodaki satırları doğrular,
// sonra geri alır ve hiçbir satır kalmadığını kontrol eder.

const path = require('path');
const fs = require('fs');
const os = require('os');

const kok = path.join(__dirname, '..');

// Ayarları test veritabanına yönlendir (gerçek ayarlar.json'a dokunulmaz).
const testAyar = path.join(os.tmpdir(), 'galya-test-ayarlar.json');
const gercek = JSON.parse(
  fs.readFileSync(path.join(kok, 'ayarlar.json'), 'utf8').replace(/^﻿/, '')
);
fs.writeFileSync(
  testAyar,
  JSON.stringify(
    Object.assign({}, gercek, {
      vegaVeritabani: 'GALYA_TEST',
      panelVeritabani: 'GALYA_PANEL',
      varsayilanFirma: 'F0103',
      varsayilanDonem: 'D0015',
      varsayilanDepo: 1,
      vegayaYazmaAktif: true
    }),
    null,
    2
  ),
  'utf8'
);
process.env.GALYA_AYAR_DOSYASI = testAyar;

const sql = require(path.join(kok, 'db', 'sql'));
const yazma = require(path.join(kok, 'db', 'yazma'));
const uretim = require(path.join(kok, 'db', 'uretim'));

const SECIM = { firma: 'F0103', donem: 'D0015', depo: 1 };

let basarili = 0;
let basarisiz = 0;

function kontrol(ad, kosul, ayrinti) {
  if (kosul) {
    console.log('  OK   ' + ad);
    basarili++;
  } else {
    console.log('  HATA ' + ad + (ayrinti ? '  → ' + ayrinti : ''));
    basarisiz++;
  }
}

async function say(tabloAdi, kosul, p) {
  const r = await sql.sorgu(
    `SELECT COUNT(*) AS adet FROM [GALYA_TEST].dbo.${tabloAdi} WHERE ${kosul}`,
    p
  );
  return r[0].adet;
}

// Bir stoğun güncel miktarı = depo envanteri deltalarının toplamı.
async function kalan(stokNo) {
  const r = await sql.sorgu(
    `SELECT ISNULL(SUM(ENVANTER), 0) AS k
     FROM [GALYA_TEST].dbo.F0103D0015TBLDEPOENVANTER
     WHERE STOKNO = @s AND BELGETIPI <> 67`,
    { s: Number(stokNo) }
  );
  return Number(r[0].k);
}

// --- Test veritabanı kurulumu (--kur) -------------------------------------
//
// Yapı VEGADB'den `SELECT * INTO … WHERE 1=0` ile kopyalanır. Bu kalıp
// IDENTITY özelliğini korur; belge kimlikleri gerçekteki gibi SQL Server
// tarafından üretilir.
//
// Kaynak firma canlı veritabanındaki ilk firma, hedef her zaman F0103/D0015.

const KART_TABLOLARI = [
  'TBLSTOKLAR', 'TBLBIRIMLEREX', 'TBLCARI',
  'TBLURERECETELIST', 'TBLURERECETE', 'TBLURERECETEPOZ', 'TBLURERECETEARAC',
  'TBLKDVGRUPLARI'
];
const DONEM_TABLOLARI = [
  'TBLSTOKHAREKETLERI', 'TBLDEPOENVANTER', 'TBLCARIHAREKETLERI',
  'TBLSTKCIKBASLIK', 'TBLSTKCIKHAREKET', 'TBLSTKGIRBASLIK', 'TBLSTKGIRHAREKET',
  'TBLALFATBASLIK', 'TBLALFATHAREKET',
  'TBLDEPOHARBASLIK', 'TBLDEPOHARHAREKET',
  'TBLUREURETIMLIST', 'TBLUREURETIM', 'TBLUREURETIMCIKTI', 'TBLUREURETIMPOZ',
  'TBLUREURETIMARAC',
  'TBLUREBELGE',
  'TBLSAYIMGIRISBASLIK', 'TBLSAYIMGIRISHAREKET',
  'TBLSAYIMCIKISBASLIK', 'TBLSAYIMCIKISHAREKET'
];

async function testVeritabaniKur() {
  const kaynakVt = gercek.vegaVeritabani || 'VEGADB';
  console.log(`\n== Test veritabanı kuruluyor (kaynak: ${kaynakVt}) ==`);

  await sql.calistir(`IF DB_ID(N'GALYA_TEST') IS NULL EXEC('CREATE DATABASE [GALYA_TEST]')`);

  // Kaynak firma: yapı bütün firmalarda aynı, ama örnek veri de kopyalandığı
  // için stok kartı en çok olan firma seçiliyor (DEMO firması boş olabiliyor).
  const firmalar = await sql.sorgu(`
    SELECT LEFT(t.name, 5) AS firma, SUM(p.rows) AS satir
    FROM [${kaynakVt}].sys.tables t
    JOIN [${kaynakVt}].sys.partitions p
      ON p.object_id = t.object_id AND p.index_id IN (0, 1)
    WHERE t.name LIKE 'F[0-9][0-9][0-9][0-9]TBLSTOKLAR'
    GROUP BY LEFT(t.name, 5)
    ORDER BY SUM(p.rows) DESC
  `);
  if (!firmalar.length) throw new Error(`${kaynakVt} içinde firma tablosu bulunamadı.`);
  const kaynakFirma = firmalar[0].firma;

  const donemler = await sql.sorgu(`
    SELECT TOP 1 SUBSTRING(name, 6, 5) AS donem
    FROM [${kaynakVt}].sys.tables
    WHERE name LIKE '${kaynakFirma}D[0-9][0-9][0-9][0-9]TBLSTOKHAREKETLERI'
    ORDER BY name DESC
  `);
  if (!donemler.length) throw new Error(`${kaynakFirma} için dönem tablosu bulunamadı.`);
  // SUBSTRING zaten 'D0003' biçiminde dönüyor; başına ikinci bir D konmamalı.
  const kaynakDonem = donemler[0].donem;
  console.log(`  Kaynak firma/dönem: ${kaynakFirma}/${kaynakDonem}`);

  let olusan = 0;
  let atlanan = 0;

  // Bir firma bütün modülleri kullanmamış olabiliyor (F0101'de üretim ve
  // alış faturası tabloları yok). Bu yüzden her tablo için kaynakta o adı
  // taşıyan HERHANGİ bir firma/dönem aranıyor.
  async function kaynakTabloBul(desen) {
    const r = await sql.sorgu(
      `SELECT TOP 1 t.name
       FROM [${kaynakVt}].sys.tables t
       WHERE t.name LIKE @desen
       ORDER BY t.name DESC`,
      { desen }
    );
    return r.length ? r[0].name : null;
  }

  async function kopyala(desen, hedefAd) {
    const varMi = await sql.sorgu(
      `SELECT COUNT(*) AS adet FROM [GALYA_TEST].sys.tables WHERE name = @ad`,
      { ad: hedefAd }
    );
    if (varMi[0].adet > 0) { atlanan++; return; }

    const kaynakAd = await kaynakTabloBul(desen);
    if (!kaynakAd) {
      console.log(`  ATLA  ${hedefAd} (kaynakta ${desen} eşleşmedi)`);
      return;
    }

    await sql.calistir(
      `SELECT * INTO [GALYA_TEST].dbo.[${hedefAd}]
       FROM [${kaynakVt}].dbo.[${kaynakAd}] WHERE 1 = 0`
    );
    olusan++;
    console.log(`  YENİ  ${hedefAd}  (yapı: ${kaynakAd})`);
  }

  for (const t of KART_TABLOLARI) {
    await kopyala('F[0-9][0-9][0-9][0-9]' + t, 'F0103' + t);
  }
  for (const t of DONEM_TABLOLARI) {
    await kopyala('F[0-9][0-9][0-9][0-9]D[0-9][0-9][0-9][0-9]' + t, 'F0103D0015' + t);
  }
  await kopyala('TBLDEPOLAR', 'TBLDEPOLAR');
  await kopyala('TBLFIRMA', 'TBLFIRMA');

  console.log(`  ${olusan} tablo oluşturuldu, ${atlanan} tablo zaten vardı.`);

  // Sınamanın ihtiyacı olan asgari veri. Test tabloları eski bir kopyadan
  // gelmiş olabildiği için sütunlar birebir aynı olmayabilir; iki tarafta da
  // bulunan sütunlar üzerinden kopyalanıyor.
  async function ortakSutunlarlaKopyala(kaynakAd, hedefAd, kosul, adet) {
    const sutunlar = await sql.sorgu(
      `SELECT k.name
       FROM [${kaynakVt}].sys.columns k
       JOIN [GALYA_TEST].sys.columns h
         ON h.name = k.name AND h.object_id = OBJECT_ID('GALYA_TEST.dbo.' + @hedef)
       WHERE k.object_id = OBJECT_ID('${kaynakVt}.dbo.' + @kaynak)
         AND k.is_identity = 0 AND h.is_identity = 0
         AND k.is_computed = 0 AND h.is_computed = 0`,
      { kaynak: kaynakAd, hedef: hedefAd }
    );
    if (!sutunlar.length) {
      console.log(`  (${hedefAd} için ortak sütun bulunamadı, veri kopyalanmadı)`);
      return;
    }
    const liste = sutunlar.map((s) => `[${s.name}]`).join(', ');
    await sql.calistir(`
      SET IDENTITY_INSERT [GALYA_TEST].dbo.[${hedefAd}] ON;
      INSERT INTO [GALYA_TEST].dbo.[${hedefAd}] (IND, ${liste})
      SELECT TOP ${Number(adet)} IND, ${liste}
      FROM [${kaynakVt}].dbo.[${kaynakAd}] WHERE ${kosul} ORDER BY IND;
      SET IDENTITY_INSERT [GALYA_TEST].dbo.[${hedefAd}] OFF;
    `);
    console.log(`  ${hedefAd} için örnek veri kopyalandı.`);
  }

  const stokSayisi = await say('F0103TBLSTOKLAR', '1=1');
  if (stokSayisi < 3) {
    await ortakSutunlarlaKopyala(
      kaynakFirma + 'TBLSTOKLAR', 'F0103TBLSTOKLAR',
      'ISNULL(DELETED,0) = 0 AND IND >= 100', 20
    ).catch((e) => console.log('  (stok kopyalanamadı: ' + e.message + ')'));
  }
  const cariSayisi = await say('F0103TBLCARI', '1=1');
  if (cariSayisi < 1) {
    await ortakSutunlarlaKopyala(
      kaynakFirma + 'TBLCARI', 'F0103TBLCARI',
      'ISNULL(DELETED,0) = 0 AND IND >= 100', 5
    ).catch((e) => console.log('  (cari kopyalanamadı: ' + e.message + ')'));
  }

  console.log('\nTest veritabanı hazır. Sınamayı çalıştırın: node kurulum/test-yazma.js');
}

if (process.argv.includes('--kur')) {
  testVeritabaniKur()
    .then(async () => { await sql.havuzKapat(); process.exit(0); })
    .catch(async (e) => {
      console.log('\nKurulum hatası: ' + e.message);
      await sql.havuzKapat();
      process.exit(1);
    });
  return;
}

(async () => {
  console.log('\n== Hazırlık ==');
  const stoklar = await sql.sorgu(`
    SELECT TOP 2 IND AS stokNo, MALINCINSI AS ad
    FROM [GALYA_TEST].dbo.F0103TBLSTOKLAR
    ORDER BY IND
  `);
  if (stoklar.length < 2) {
    console.log('Test veritabanında yeterli stok kartı yok. Önce --kur çalıştırın.');
    process.exit(1);
  }
  console.log(`  Düşülecek : ${stoklar[0].ad} (#${stoklar[0].stokNo})`);
  console.log(`  Artırılan : ${stoklar[1].ad} (#${stoklar[1].stokNo})`);

  const oncekiEnvanter = await say('F0103D0015TBLDEPOENVANTER', '1=1');

  console.log('\n== Kilit ==');
  const ayar = require(path.join(kok, 'db', 'ayar'));
  ayar.ayarYaz({ vegayaYazmaAktif: false });
  let engellendi = false;
  let kod = null;
  try {
    await yazma.tutanakFisiYaz(
      Object.assign({}, SECIM, {
        dusenStokNo: stoklar[0].stokNo, dusenMiktar: 1,
        artanStokNo: stoklar[1].stokNo, artanMiktar: 1,
        kullanici: 'test'
      })
    );
  } catch (e) {
    engellendi = true;
    kod = e.kod;
  }
  kontrol('Kilit kapalıyken yazma engelleniyor', engellendi && kod === 'YAZMA_KAPALI', 'kod=' + kod);
  kontrol('Kilit kapalıyken hiç satır yazılmadı',
    (await say('F0103D0015TBLSTKCIKBASLIK', '1=1')) === 0);
  ayar.ayarYaz({ vegayaYazmaAktif: true });

  console.log('\n== Tutanak yazma ==');
  let sonuc = null;
  try {
    sonuc = await yazma.tutanakFisiYaz(
      Object.assign({}, SECIM, {
        dusenStokNo: stoklar[0].stokNo,
        dusenMiktar: 10,
        artanStokNo: stoklar[1].stokNo,
        artanMiktar: 10,
        sebep: 'Sınama: yanlış ürün düşülmüş',
        kullanici: 'test'
      })
    );
    console.log(`  Çıkış fişi: ${sonuc.cikisBelgeNo}   Giriş fişi: ${sonuc.girisBelgeNo}`);
  } catch (e) {
    console.log('  HATA yazma başarısız: ' + e.message);
    process.exit(1);
  }

  const cikis = sonuc.fisler[0];
  const giris = sonuc.fisler[1];

  kontrol('Çıkış fişi başlığı yazıldı',
    (await say('F0103D0015TBLSTKCIKBASLIK', 'IND=@i', { i: cikis.baslikInd })) === 1);
  kontrol('Çıkış fişi satırı yazıldı',
    (await say('F0103D0015TBLSTKCIKHAREKET', 'IND=@i AND EVRAKNO=@b', { i: cikis.satirInd, b: cikis.baslikInd })) === 1);
  kontrol('Giriş fişi başlığı yazıldı',
    (await say('F0103D0015TBLSTKGIRBASLIK', 'IND=@i', { i: giris.baslikInd })) === 1);
  kontrol('Giriş fişi satırı yazıldı',
    (await say('F0103D0015TBLSTKGIRHAREKET', 'IND=@i AND EVRAKNO=@b', { i: giris.satirInd, b: giris.baslikInd })) === 1);

  kontrol('Stok hareketi: çıkan 10 yazıldı',
    (await say('F0103D0015TBLSTOKHAREKETLERI',
      'LN=@s AND BELGENO=@b AND IZAHAT=33 AND CIKAN=10', { s: cikis.satirInd, b: cikis.baslikInd })) === 1);
  kontrol('Stok hareketi: giren 10 yazıldı',
    (await say('F0103D0015TBLSTOKHAREKETLERI',
      'LN=@s AND BELGENO=@b AND IZAHAT=32 AND GIREN=10', { s: giris.satirInd, b: giris.baslikInd })) === 1);

  kontrol('Envanter: -10 satırı yazıldı',
    (await say('F0103D0015TBLDEPOENVANTER',
      'BELGEIND=@b AND HAREKETIND=@s AND BELGETIPI=33 AND ENVANTER=-10', { b: cikis.baslikInd, s: cikis.satirInd })) === 1);
  kontrol('Envanter: +10 satırı yazıldı',
    (await say('F0103D0015TBLDEPOENVANTER',
      'BELGEIND=@b AND HAREKETIND=@s AND BELGETIPI=32 AND ENVANTER=10', { b: giris.baslikInd, s: giris.satirInd })) === 1);

  const dusenKalan = await sql.sorgu(
    `SELECT ISNULL(SUM(ENVANTER),0) AS k FROM [GALYA_TEST].dbo.F0103D0015TBLDEPOENVANTER WHERE STOKNO=@s`,
    { s: stoklar[0].stokNo }
  );
  const artanKalan = await sql.sorgu(
    `SELECT ISNULL(SUM(ENVANTER),0) AS k FROM [GALYA_TEST].dbo.F0103D0015TBLDEPOENVANTER WHERE STOKNO=@s`,
    { s: stoklar[1].stokNo }
  );
  kontrol('Düşülen ürünün kalanı -10 oldu', Number(dusenKalan[0].k) === -10, 'kalan=' + dusenKalan[0].k);
  kontrol('Artırılan ürünün kalanı +10 oldu', Number(artanKalan[0].k) === 10, 'kalan=' + artanKalan[0].k);

  console.log('\n== Geri alma ==');
  const geri = await yazma.tutanakFisiGeriAl(
    Object.assign({}, SECIM, { fisler: sonuc.fisler, kullanici: 'test' })
  );
  console.log(`  Silinen satır: ${geri.silinenSatir}`);
  kontrol('Geri almada 8 satır silindi', geri.silinenSatir === 8, 'silinen=' + geri.silinenSatir);
  kontrol('Envanter tablosu ilk hâline döndü',
    (await say('F0103D0015TBLDEPOENVANTER', '1=1')) === oncekiEnvanter);
  kontrol('Çıkış fişi başlığı silindi',
    (await say('F0103D0015TBLSTKCIKBASLIK', 'IND=@i', { i: cikis.baslikInd })) === 0);
  kontrol('Giriş fişi başlığı silindi',
    (await say('F0103D0015TBLSTKGIRBASLIK', 'IND=@i', { i: giris.baslikInd })) === 0);

  console.log('\n== Reçete yazma ==');
  const vega = require(path.join(kok, 'db', 'vega'));
  const mamulStok = stoklar[0].stokNo;
  const bilesenStok = stoklar[1].stokNo;

  // Önceki koşudan kalan reçete başlıkları temizleniyor; yoksa "yeni başlık
  // oluştu" sınaması ikinci çalıştırmada boşuna hata veriyor.
  await sql.calistir(
    `DELETE R FROM [GALYA_TEST].dbo.F0103TBLURERECETE R
     JOIN [GALYA_TEST].dbo.F0103TBLURERECETELIST L ON L.IND = R.EVRAKNO
     WHERE L.STOKNO IN (@m, @b);
     DELETE FROM [GALYA_TEST].dbo.F0103TBLURERECETELIST WHERE STOKNO IN (@m, @b);`,
    { m: mamulStok, b: bilesenStok }
  );

  const bas = await yazma.receteOlustur(
    Object.assign({}, SECIM, { mamulNo: mamulStok, verim: 1, kullanici: 'test' })
  );
  kontrol('Reçete başlığı oluşturuldu', bas.yeni === true && bas.receteNo > 0, 'receteNo=' + bas.receteNo);
  const receteNo = bas.receteNo;

  const tekrar = await yazma.receteOlustur(
    Object.assign({}, SECIM, { mamulNo: mamulStok, kullanici: 'test' })
  );
  kontrol('Aynı mamule ikinci başlık açılmıyor',
    tekrar.yeni === false && tekrar.receteNo === receteNo);

  const ek1 = await yazma.receteSatiriEkle(
    Object.assign({}, SECIM, { receteNo, stokNo: bilesenStok, miktar: 2.5, fireOrani: 3, kullanici: 'test' })
  );
  kontrol('Reçeteye bileşen eklendi', ek1.tamam === true);

  let satirlar = await vega.receteSatirlari(Object.assign({}, SECIM, { receteNo }));
  kontrol('Reçete okunduğunda 1 satır var', satirlar.length === 1, 'satır=' + satirlar.length);
  kontrol('Miktar doğru yazıldı', Number(satirlar[0].miktar) === 2.5, 'miktar=' + satirlar[0].miktar);
  kontrol('Fire oranı doğru yazıldı', Number(satirlar[0].fireOrani) === 3, 'fire=' + satirlar[0].fireOrani);

  const mamuller = await vega.receteliMamuller(SECIM);
  kontrol('Reçeteli mamuller listesinde görünüyor',
    mamuller.some((m) => m.receteNo === receteNo && m.satirSayisi === 1),
    'liste=' + JSON.stringify(mamuller.map((m) => [m.receteNo, m.satirSayisi])));

  let ikiliHata = null;
  try {
    await yazma.receteSatiriEkle(
      Object.assign({}, SECIM, { receteNo, stokNo: bilesenStok, miktar: 1, kullanici: 'test' })
    );
  } catch (e) { ikiliHata = e.message; }
  kontrol('Aynı bileşen ikinci kez eklenemiyor', ikiliHata !== null);

  let kendiHata = null;
  try {
    await yazma.receteSatiriEkle(
      Object.assign({}, SECIM, { receteNo, stokNo: mamulStok, miktar: 1, kullanici: 'test' })
    );
  } catch (e) { kendiHata = e.message; }
  kontrol('Mamul kendi reçetesine eklenemiyor', kendiHata !== null);

  // Döngü: bileşenin reçetesine mamulü eklemeye çalış
  let dongu = null;
  try {
    await yazma.receteSatiriEkle(
      Object.assign({}, SECIM, { mamulNo: bilesenStok, stokNo: mamulStok, miktar: 1, kullanici: 'test' })
    );
  } catch (e) { dongu = e.message; }
  kontrol('Döngü oluşturan bileşen engelleniyor', dongu !== null, dongu);

  await yazma.receteSatiriGuncelle(
    Object.assign({}, SECIM, { ind: ek1.ind, miktar: 7, birim: satirlar[0].birim, fireOrani: 1.5, kullanici: 'test' })
  );
  satirlar = await vega.receteSatirlari(Object.assign({}, SECIM, { receteNo }));
  kontrol('Güncelleme miktarı değiştirdi', Number(satirlar[0].miktar) === 7, 'miktar=' + satirlar[0].miktar);

  await yazma.receteSatiriSil(Object.assign({}, SECIM, { ind: ek1.ind, kullanici: 'test' }));
  satirlar = await vega.receteSatirlari(Object.assign({}, SECIM, { receteNo }));
  kontrol('Silme sonrası reçete boş', satirlar.length === 0, 'satır=' + satirlar.length);

  console.log('\n== Belge numarası ==');
  const ikinci = await yazma.tutanakFisiYaz(
    Object.assign({}, SECIM, {
      dusenStokNo: stoklar[0].stokNo, dusenMiktar: 1,
      artanStokNo: stoklar[1].stokNo, artanMiktar: 1,
      sebep: 'Sınama: numara artışı', kullanici: 'test'
    })
  );
  kontrol('Belge numarası A ile başlıyor ve 7 hane', /^A\d{7}$/.test(ikinci.cikisBelgeNo),
    ikinci.cikisBelgeNo);
  await yazma.tutanakFisiGeriAl(Object.assign({}, SECIM, { fisler: ikinci.fisler, kullanici: 'test' }));

  // --- Alış faturası ------------------------------------------------------
  console.log('\n== Alış faturası ==');
  const cariler = await sql.sorgu(`
    SELECT TOP 1 IND AS cariNo, FIRMAADI AS ad
    FROM [GALYA_TEST].dbo.F0103TBLCARI ORDER BY IND
  `);
  if (!cariler.length) {
    kontrol('Test carisi bulundu', false, 'F0103TBLCARI boş, --kur çalıştırın');
  } else {
    const cari = cariler[0];
    const fSatir = [
      { stokNo: stoklar[0].stokNo, stokAdi: stoklar[0].ad, miktar: 5, birimFiyat: 100, kdvOrani: 20 },
      { stokNo: stoklar[1].stokNo, stokAdi: stoklar[1].ad, miktar: 2, birimFiyat: 250, kdvOrani: 10 }
    ];
    const oncekiKalanF = await kalan(stoklar[0].stokNo);

    const fatura = await yazma.alisFaturasiYaz(Object.assign({}, SECIM, {
      cariNo: cari.cariNo, cariAdi: cari.ad, satirlar: fSatir,
      aciklama: 'Sınama faturası', kullanici: 'test'
    }));
    console.log(`  Fatura: ${fatura.belgeNo} (IND ${fatura.baslikInd})`);

    kontrol('Fatura başlığı yazıldı',
      (await say('F0103D0015TBLALFATBASLIK', 'IND = @i AND BELGETIPI = 20', { i: fatura.baslikInd })) === 1);
    kontrol('Fatura satırları yazıldı',
      (await say('F0103D0015TBLALFATHAREKET', 'EVRAKNO = @i', { i: fatura.baslikInd })) === 2);
    kontrol('Stok hareketleri yazıldı',
      (await say('F0103D0015TBLSTOKHAREKETLERI', 'BELGENO = @i AND IZAHAT = 20', { i: fatura.baslikInd })) === 2);
    kontrol('Depo envanteri arttı',
      (await say('F0103D0015TBLDEPOENVANTER', 'BELGEIND = @i AND BELGETIPI = 20', { i: fatura.baslikInd })) === 2);
    kontrol('Cari hareketi (borç) yazıldı',
      (await say('F0103D0015TBLCARIHAREKETLERI', 'LN = @i AND IZAHAT = 20', { i: fatura.baslikInd })) === 1);

    const genel = 5 * 100 * 1.2 + 2 * 250 * 1.1;
    const cariTutar = await sql.sorgu(
      `SELECT ALACAK AS a FROM [GALYA_TEST].dbo.F0103D0015TBLCARIHAREKETLERI
       WHERE LN = @i AND IZAHAT = 20`,
      { i: fatura.baslikInd }
    );
    kontrol('Cari borcu KDV dahil tutar',
      Math.abs(Number(cariTutar[0].a) - genel) < 0.01,
      `${cariTutar[0].a} ≠ ${genel}`);

    kontrol('Ürünün stoğu 5 arttı',
      (await kalan(stoklar[0].stokNo)) - oncekiKalanF === 5);

    const gk = await sql.sorgu(
      `SELECT COUNT(*) AS adet FROM [GALYA_TEST].dbo.F0103D0015TBLALFATHAREKET
       WHERE EVRAKNO = @i AND (GK IS NULL OR GK = 0)`,
      { i: fatura.baslikInd }
    );
    kontrol('Satırlarda GK dolduruldu', gk[0].adet === 0, 'boş GK=' + gk[0].adet);

    const alisFiyati = await sql.sorgu(
      `SELECT ALISFIYATI AS f FROM [GALYA_TEST].dbo.F0103TBLSTOKLAR WHERE IND = @i`,
      { i: stoklar[0].stokNo }
    );
    kontrol('Stok kartına son alış fiyatı işlendi',
      Math.abs(Number(alisFiyati[0].f) - 100) < 0.01, 'fiyat=' + alisFiyati[0].f);

    const oncekiFiyat = fatura.satirlar[0].oncekiAlisFiyati;
    await yazma.alisFaturasiGeriAl(Object.assign({}, SECIM, {
      baslikInd: fatura.baslikInd, satirlar: fatura.satirlar, kullanici: 'test'
    }));
    const donenFiyat = await sql.sorgu(
      `SELECT ISNULL(ALISFIYATI, 0) AS f FROM [GALYA_TEST].dbo.F0103TBLSTOKLAR WHERE IND = @i`,
      { i: stoklar[0].stokNo }
    );
    kontrol('Geri almada kartın alış fiyatı eski hâline döndü',
      Math.abs(Number(donenFiyat[0].f) - Number(oncekiFiyat)) < 0.01,
      `${donenFiyat[0].f} ≠ ${oncekiFiyat}`);
    kontrol('Geri almada fatura başlığı silindi',
      (await say('F0103D0015TBLALFATBASLIK', 'IND = @i', { i: fatura.baslikInd })) === 0);
    kontrol('Geri almada cari hareketi silindi',
      (await say('F0103D0015TBLCARIHAREKETLERI', 'LN = @i AND IZAHAT = 20', { i: fatura.baslikInd })) === 0);
    kontrol('Geri almada stok eski hâline döndü',
      (await kalan(stoklar[0].stokNo)) === oncekiKalanF);
  }

  // --- Üretim fişi --------------------------------------------------------
  console.log('\n== Üretim fişi ==');
  // stoklar[0] mamul, stoklar[1] bileşen olacak şekilde reçete kuruluyor.
  await yazma.receteOlustur(
    Object.assign({}, SECIM, { mamulNo: mamulStok, verim: 1, kullanici: 'test' })
  );
  const uReceteler = await sql.sorgu(
    `SELECT IND FROM [GALYA_TEST].dbo.F0103TBLURERECETELIST WHERE STOKNO = @s`,
    { s: mamulStok }
  );
  await yazma.receteSatiriEkle(Object.assign({}, SECIM, {
    receteNo: uReceteler[0].IND, stokNo: bilesenStok, miktar: 2, kullanici: 'test'
  }));

  const oncekiMamul = await kalan(mamulStok);
  const oncekiBilesen = await kalan(bilesenStok);

  const uretimSonuc = await yazma.uretimFisiYaz(Object.assign({}, SECIM, {
    mamulStokNo: mamulStok, miktar: 3, aciklama: 'Sınama üretimi', kullanici: 'test'
  }));
  console.log(`  Üretim fişi: ${uretimSonuc.fisNo} (IND ${uretimSonuc.uretimInd})`);

  kontrol('Üretim başlığı yazıldı',
    (await say('F0103D0015TBLUREURETIMLIST', 'IND = @i', { i: uretimSonuc.uretimInd })) === 1);
  kontrol('Tüketim satırı yazıldı',
    (await say('F0103D0015TBLUREURETIM', 'EVRAKNO = @i', { i: uretimSonuc.uretimInd })) === 1);
  kontrol('Çıktı satırı yazıldı',
    (await say('F0103D0015TBLUREURETIMCIKTI', 'EVRAKNO = @i', { i: uretimSonuc.uretimInd })) === 1);
  kontrol('İki pozisyon adımı yazıldı',
    (await say('F0103D0015TBLUREURETIMPOZ', 'EVRAKNO = @i', { i: uretimSonuc.uretimInd })) === 2);
  kontrol('Dört doğan belge dizine yazıldı',
    (await say('F0103D0015TBLUREBELGE', 'EIND = @i', { i: uretimSonuc.uretimInd })) === 4);
  kontrol('İki depo transferi oluştu',
    (await say('F0103D0015TBLDEPOHARBASLIK', 'BELGETIPI = 38', {})) >= 2);
  kontrol('96 çıktı hareketi yazıldı',
    (await say('F0103D0015TBLSTOKHAREKETLERI', 'IZAHAT = 96 AND STOKNO = @s', { s: mamulStok })) === 1);
  kontrol('97 tüketim hareketi yazıldı',
    (await say('F0103D0015TBLSTOKHAREKETLERI', 'IZAHAT = 97 AND STOKNO = @s', { s: bilesenStok })) === 1);
  kontrol('Mamul stoğu 3 arttı', (await kalan(mamulStok)) - oncekiMamul === 3,
    `${await kalan(mamulStok)} - ${oncekiMamul}`);
  kontrol('Bileşen stoğu 6 azaldı', oncekiBilesen - (await kalan(bilesenStok)) === 6,
    `${oncekiBilesen} → ${await kalan(bilesenStok)}`);

  const belgeler = await sql.sorgu(
    `SELECT BELGENO AS belgeNo, IZAHAT AS izahat, EVRAKNO AS evrakNo
     FROM [GALYA_TEST].dbo.F0103D0015TBLUREBELGE WHERE EIND = @i`,
    { i: uretimSonuc.uretimInd }
  );
  await yazma.uretimFisiGeriAl(Object.assign({}, SECIM, {
    uretimInd: uretimSonuc.uretimInd, belgeler, kullanici: 'test'
  }));
  kontrol('Geri almada üretim başlığı silindi',
    (await say('F0103D0015TBLUREURETIMLIST', 'IND = @i', { i: uretimSonuc.uretimInd })) === 0);
  kontrol('Geri almada 96/97 hareketleri silindi',
    (await say('F0103D0015TBLSTOKHAREKETLERI', 'IZAHAT IN (96, 97)', {})) === 0);
  kontrol('Geri almada mamul stoğu eski hâline döndü',
    (await kalan(mamulStok)) === oncekiMamul);
  kontrol('Geri almada bileşen stoğu eski hâline döndü',
    (await kalan(bilesenStok)) === oncekiBilesen);

  // --- Fireli üretim ------------------------------------------------------
  //
  // Müşterinin tarif ettiği iş: "10 kg ham somon girdi, 3 kg somon çıktı,
  // 7 kg fire." Beklenen sonuç iki belge: firenin zayi çıkış fişi ve kalan
  // hammaddeyi tüketen üretim fişi. Reçete kullanılmıyor — bileşenler elle
  // veriliyor.
  console.log('\n== Fireli üretim ==');
  const fCariler = await sql.sorgu(`
    SELECT TOP 1 IND AS cariNo, FIRMAADI AS ad
    FROM [GALYA_TEST].dbo.F0103TBLCARI ORDER BY IND
  `);
  if (!fCariler.length) {
    kontrol('Fire carisi bulundu', false, 'F0103TBLCARI boş, --kur çalıştırın');
  } else {
    const fCari = fCariler[0];
    const fOncekiMamul = await kalan(mamulStok);
    const fOncekiHam = await kalan(bilesenStok);
    const oncekiZayiFisi = await say('F0103D0015TBLSTKCIKBASLIK', 'BELGETIPI = 33', {});

    const fSonuc = await uretim.fireliUret(Object.assign({}, SECIM, {
      mamulStokNo: mamulStok,
      uretilenMiktar: 3,
      hammaddeler: [{ stokNo: bilesenStok, miktar: 10, fire: 7 }],
      cariNo: fCari.cariNo,
      cariAdi: fCari.ad,
      altHesap: 'FİRE',
      sebep: 'Sınama: temizleme firesi',
      kullanici: 'test'
    }));
    console.log(`  Fire fişi: ${fSonuc.zayiBelgeNo} · Üretim fişi: ${fSonuc.fisNo}`);

    kontrol('Fire için zayi fişi kesildi',
      (await say('F0103D0015TBLSTKCIKBASLIK', 'BELGETIPI = 33', {})) === oncekiZayiFisi + 1);
    kontrol('Üretim fişi yazıldı',
      (await say('F0103D0015TBLUREURETIMLIST', 'IND = @i', { i: fSonuc.uretimInd })) === 1);
    kontrol('Tüketim satırı elle verilen bileşenden geldi',
      (await say('F0103D0015TBLUREURETIM', 'EVRAKNO = @i AND STOKNO = @s',
                 { i: fSonuc.uretimInd, s: bilesenStok })) === 1);
    kontrol('Mamul stoğu 3 arttı',
      Math.abs((await kalan(mamulStok)) - fOncekiMamul - 3) < 0.001,
      `${await kalan(mamulStok)} - ${fOncekiMamul}`);
    // 7 fire (zayi fişi) + 3 üretim tüketimi = 10.
    kontrol('Hammadde stoğu 10 azaldı (7 fire + 3 tüketim)',
      Math.abs(fOncekiHam - (await kalan(bilesenStok)) - 10) < 0.001,
      `${fOncekiHam} → ${await kalan(bilesenStok)}`);

    // Temizlik: üretimi ve fire fişini geri al.
    const fBelgeler = await sql.sorgu(
      `SELECT BELGENO AS belgeNo, IZAHAT AS izahat, EVRAKNO AS evrakNo
       FROM [GALYA_TEST].dbo.F0103D0015TBLUREBELGE WHERE EIND = @i`,
      { i: fSonuc.uretimInd }
    );
    await yazma.uretimFisiGeriAl(Object.assign({}, SECIM, {
      uretimInd: fSonuc.uretimInd, belgeler: fBelgeler, kullanici: 'test'
    }));
    await yazma.zayiFisiGeriAl(Object.assign({}, SECIM, {
      baslikInd: fSonuc.zayiBaslikInd, kullanici: 'test'
    }));
    kontrol('Geri almada hammadde stoğu eski hâline döndü',
      Math.abs((await kalan(bilesenStok)) - fOncekiHam) < 0.001,
      `${await kalan(bilesenStok)} ≠ ${fOncekiHam}`);
    kontrol('Geri almada mamul stoğu eski hâline döndü',
      Math.abs((await kalan(mamulStok)) - fOncekiMamul) < 0.001);

    // Fire sıfırken zayi fişi HİÇ kesilmemeli.
    const firesizOncekiFis = await say('F0103D0015TBLSTKCIKBASLIK', 'BELGETIPI = 33', {});
    const firesiz = await uretim.fireliUret(Object.assign({}, SECIM, {
      mamulStokNo: mamulStok,
      uretilenMiktar: 1,
      hammaddeler: [{ stokNo: bilesenStok, miktar: 2, fire: 0 }],
      kullanici: 'test'
    }));
    kontrol('Fire sıfırken zayi fişi kesilmiyor', firesiz.zayiBelgeNo === null,
      String(firesiz.zayiBelgeNo));
    kontrol('Fire sıfırken çıkış fişi sayısı değişmedi',
      (await say('F0103D0015TBLSTKCIKBASLIK', 'BELGETIPI = 33', {})) === firesizOncekiFis);
    const firesizBelgeler = await sql.sorgu(
      `SELECT BELGENO AS belgeNo, IZAHAT AS izahat, EVRAKNO AS evrakNo
       FROM [GALYA_TEST].dbo.F0103D0015TBLUREBELGE WHERE EIND = @i`,
      { i: firesiz.uretimInd }
    );
    await yazma.uretimFisiGeriAl(Object.assign({}, SECIM, {
      uretimInd: firesiz.uretimInd, belgeler: firesizBelgeler, kullanici: 'test'
    }));

    // Fire, giren miktardan büyük olamaz.
    let fHata = null;
    try {
      await uretim.fireliUret(Object.assign({}, SECIM, {
        mamulStokNo: mamulStok,
        uretilenMiktar: 1,
        hammaddeler: [{ stokNo: bilesenStok, miktar: 2, fire: 5 }],
        cariNo: fCari.cariNo,
        kullanici: 'test'
      }));
    } catch (e) { fHata = e; }
    kontrol('Fire giren miktardan büyük olamıyor', !!fHata, fHata ? '' : 'hata çıkmadı');

    // Hepsi fire ise üretilecek bir şey kalmıyor.
    let fHepsi = null;
    try {
      await uretim.fireliUret(Object.assign({}, SECIM, {
        mamulStokNo: mamulStok,
        uretilenMiktar: 1,
        hammaddeler: [{ stokNo: bilesenStok, miktar: 2, fire: 2 }],
        cariNo: fCari.cariNo,
        kullanici: 'test'
      }));
    } catch (e) { fHepsi = e; }
    kontrol('Hepsi fire olunca üretim reddediliyor', !!fHepsi, fHepsi ? '' : 'hata çıkmadı');
  }

  // --- Sıfıra kadar üretim -------------------------------------------------
  //
  // Mamulün stoğu zayi fişiyle eksiye düşürülüyor, sonra sıfıra çekiliyor.
  // Gerçek akış da bu: zayi girişi Zayi ekranından yapılır, üretim ekranı
  // yalnızca eksiği kapatır. Üretilecek miktarı kullanıcı yazmıyor.
  console.log('\n== Sıfıra kadar üretim ==');

  const sCariler = await sql.sorgu(`
    SELECT TOP 1 IND AS cariNo, FIRMAADI AS ad
    FROM [GALYA_TEST].dbo.F0103TBLCARI ORDER BY IND
  `);
  if (!sCariler.length) {
    kontrol('Zayi carisi bulundu', false, 'F0103TBLCARI boş, --kur çalıştırın');
  } else {
    const sOncekiMamul = await kalan(mamulStok);
    // Stoğu 2 birim eksiye düşürmek için önce zayi fişi.
    const sZayi = await yazma.zayiFisiYaz(Object.assign({}, SECIM, {
      cariNo: sCariler[0].cariNo,
      cariAdi: sCariler[0].ad,
      altHesap: 'ZAYİ',
      sebep: 'Sınama: sıfıra kadar üretim hazırlığı',
      satirlar: [{ stokNo: mamulStok, miktar: sOncekiMamul + 2 }],
      kullanici: 'test'
    }));
    const eksiKalan = await kalan(mamulStok);
    kontrol('Zayi fişi stoğu eksiye düşürdü', eksiKalan < 0, String(eksiKalan));

    const adaylar = await uretim.sifirAdaylari(Object.assign({}, SECIM));
    kontrol('Eksideki mamul aday listesine düştü',
      adaylar.some((a) => Number(a.stokNo) === mamulStok),
      adaylar.map((a) => a.stokNo).join(','));

    const sSonuc = await uretim.sifiraKadarUret(Object.assign({}, SECIM, {
      stokNo: mamulStok, kullanici: 'test'
    }));
    kontrol('Üretilen miktar eksinin karşılığı',
      Math.abs(sSonuc.uretilenMiktar + eksiKalan) < 0.001,
      `${sSonuc.uretilenMiktar} ≠ ${-eksiKalan}`);
    kontrol('Stok sıfıra oturdu', Math.abs(await kalan(mamulStok)) < 0.001,
      String(await kalan(mamulStok)));

    // Stok eksi değilken üretim reddedilmeli — miktarı program buluyor,
    // bulacak bir şey yoksa fiş kesilmemeli.
    let sHata = null;
    try {
      await uretim.sifiraKadarUret(Object.assign({}, SECIM, {
        stokNo: mamulStok, kullanici: 'test'
      }));
    } catch (e) { sHata = e; }
    kontrol('Eksi olmayan stokta üretim reddediliyor', !!sHata,
      sHata ? '' : 'hata çıkmadı');

    // Temizlik: üretimi ve zayi fişini geri al.
    const sBelgeler = await sql.sorgu(
      `SELECT BELGENO AS belgeNo, IZAHAT AS izahat, EVRAKNO AS evrakNo
       FROM [GALYA_TEST].dbo.F0103D0015TBLUREBELGE WHERE EIND = @i`,
      { i: sSonuc.uretimInd }
    );
    await yazma.uretimFisiGeriAl(Object.assign({}, SECIM, {
      uretimInd: sSonuc.uretimInd, belgeler: sBelgeler, kullanici: 'test'
    }));
    await yazma.zayiFisiGeriAl(Object.assign({}, SECIM, {
      baslikInd: sZayi.baslikInd, kullanici: 'test'
    }));
    kontrol('Geri almada mamul stoğu eski hâline döndü',
      Math.abs((await kalan(mamulStok)) - sOncekiMamul) < 0.001,
      `${await kalan(mamulStok)} ≠ ${sOncekiMamul}`);
  }

  // --- Sayım fişi ---------------------------------------------------------
  //
  // Sayım fişi fark belgesidir: fişe yazılan miktar "sayımda şu çıktı" değil,
  // "stoğa şu kadar eklenecek" demektir. Sınama iki yönü birden deniyor:
  // bir üründe sayım stoktan fazla (giriş fişi), diğerinde az (çıkış fişi).
  console.log('\n== Sayım fişi ==');

  const panelDb = require(path.join(kok, 'db', 'panel'));
  await panelDb.kur();
  const pAd = panelDb.p();

  const sayimStok1 = stoklar[0].stokNo; // sayım fazla çıkacak
  const sayimStok2 = stoklar[1].stokNo; // sayım eksik çıkacak
  const oncekiS1 = await kalan(sayimStok1);
  const oncekiS2 = await kalan(sayimStok2);

  const sayimBaslik = await sql.sorgu(
    `INSERT INTO [${pAd}].dbo.AraSayim (Firma, Donem, Depo, Sayan, Aciklama)
     OUTPUT INSERTED.Id AS id VALUES ('F0103', 'D0015', 1, 'test', 'sınama sayımı')`
  );
  const sayimId = sayimBaslik[0].id;
  // Fiziki sayım: birincide 4 fazla, ikincide 2,5 eksik.
  for (const [stokNo, sayilan] of [[sayimStok1, oncekiS1 + 4], [sayimStok2, oncekiS2 - 2.5]]) {
    await sql.calistir(
      `INSERT INTO [${pAd}].dbo.AraSayimSatir
         (SayimId, StokNo, StokAdi, Birim, TeorikMiktar, SayilanMiktar, BirimMaliyet)
       VALUES (@sayimId, @stokNo, 'sınama', 'ADET', 0, @sayilan, 10)`,
      { sayimId, stokNo, sayilan }
    );
  }

  const sayimSonuc = await yazma.sayimFisiYaz(
    Object.assign({}, SECIM, { sayimId, kullanici: 'test' })
  );
  console.log(`  Sayım belgeleri: ${sayimSonuc.belgeNo}`);

  kontrol('Sayım giriş fişi kesildi', !!sayimSonuc.girisBelgeNo, String(sayimSonuc.girisBelgeNo));
  kontrol('Sayım çıkış fişi kesildi', !!sayimSonuc.cikisBelgeNo, String(sayimSonuc.cikisBelgeNo));
  kontrol('Belge numarası Z serisi',
    /^Z\d{7}$/.test(sayimSonuc.girisBelgeNo || ''), String(sayimSonuc.girisBelgeNo));
  kontrol('Artan ürün sayısı 1', sayimSonuc.artan === 1, String(sayimSonuc.artan));
  kontrol('Azalan ürün sayısı 1', sayimSonuc.azalan === 1, String(sayimSonuc.azalan));

  const sayimGirisBaslik = await sql.sorgu(
    `SELECT IND AS ind, BELGETIPI AS tip, GIRIS AS giris, DEPO AS depo
     FROM [GALYA_TEST].dbo.F0103D0015TBLSAYIMGIRISBASLIK WHERE BELGENO = @b`,
    { b: sayimSonuc.girisBelgeNo }
  );
  kontrol('Giriş başlığı belge tipi 93', sayimGirisBaslik[0].tip === 93,
    String(sayimGirisBaslik[0].tip));
  kontrol('Giriş başlığında GIRIS bayrağı açık', sayimGirisBaslik[0].giris === true);

  const sayimCikisBaslik = await sql.sorgu(
    `SELECT IND AS ind, BELGETIPI AS tip, GIRIS AS giris
     FROM [GALYA_TEST].dbo.F0103D0015TBLSAYIMCIKISBASLIK WHERE BELGENO = @b`,
    { b: sayimSonuc.cikisBelgeNo }
  );
  kontrol('Çıkış başlığı belge tipi 94', sayimCikisBaslik[0].tip === 94,
    String(sayimCikisBaslik[0].tip));

  kontrol('Giriş hareketi yazıldı',
    (await say('F0103D0015TBLSAYIMGIRISHAREKET', 'EVRAKNO = @i',
      { i: sayimGirisBaslik[0].ind })) === 1);
  kontrol('Çıkış hareketi yazıldı',
    (await say('F0103D0015TBLSAYIMCIKISHAREKET', 'EVRAKNO = @i',
      { i: sayimCikisBaslik[0].ind })) === 1);
  kontrol('Stok hareketi 93 yazıldı',
    (await say('F0103D0015TBLSTOKHAREKETLERI', 'IZAHAT = 93 AND STOKNO = @s',
      { s: sayimStok1 })) === 1);
  kontrol('Stok hareketi 94 yazıldı',
    (await say('F0103D0015TBLSTOKHAREKETLERI', 'IZAHAT = 94 AND STOKNO = @s',
      { s: sayimStok2 })) === 1);

  const sayimGk = await sql.sorgu(
    `SELECT COUNT(*) AS adet FROM [GALYA_TEST].dbo.F0103D0015TBLSAYIMGIRISHAREKET
     WHERE EVRAKNO = @i AND (GK IS NULL OR GK = 0)`,
    { i: sayimGirisBaslik[0].ind }
  );
  kontrol('Sayım satırlarında GK dolduruldu', sayimGk[0].adet === 0);

  // Asıl mesele: stok fiziki sayıma oturmuş olmalı.
  kontrol('Fazla çıkan ürünün stoğu sayılan miktara oturdu',
    Math.abs((await kalan(sayimStok1)) - (oncekiS1 + 4)) < 0.0001,
    `${await kalan(sayimStok1)} beklenen ${oncekiS1 + 4}`);
  kontrol('Eksik çıkan ürünün stoğu sayılan miktara oturdu',
    Math.abs((await kalan(sayimStok2)) - (oncekiS2 - 2.5)) < 0.0001,
    `${await kalan(sayimStok2)} beklenen ${oncekiS2 - 2.5}`);

  const yazildiMi = await sql.sorgu(
    `SELECT VegayaYazildi AS y, VegaBelgeNo AS b FROM [${pAd}].dbo.AraSayim WHERE Id = @i`,
    { i: sayimId }
  );
  kontrol('Panel kaydı yazıldı olarak işaretlendi', yazildiMi[0].y === true);

  let ikinciYazmaHatasi = null;
  try {
    await yazma.sayimFisiYaz(Object.assign({}, SECIM, { sayimId, kullanici: 'test' }));
  } catch (e) {
    ikinciYazmaHatasi = e.message;
  }
  kontrol('Aynı sayım ikinci kez yazılamıyor', !!ikinciYazmaHatasi, String(ikinciYazmaHatasi));

  await yazma.sayimFisiGeriAl(Object.assign({}, SECIM, { sayimId, kullanici: 'test' }));
  kontrol('Geri almada giriş başlığı silindi',
    (await say('F0103D0015TBLSAYIMGIRISBASLIK', 'IND = @i',
      { i: sayimGirisBaslik[0].ind })) === 0);
  kontrol('Geri almada çıkış başlığı silindi',
    (await say('F0103D0015TBLSAYIMCIKISBASLIK', 'IND = @i',
      { i: sayimCikisBaslik[0].ind })) === 0);
  kontrol('Geri almada 93/94 hareketleri silindi',
    (await say('F0103D0015TBLSTOKHAREKETLERI', 'IZAHAT IN (93, 94)', {})) === 0);
  kontrol('Geri almada birinci ürünün stoğu eski hâline döndü',
    Math.abs((await kalan(sayimStok1)) - oncekiS1) < 0.0001);
  kontrol('Geri almada ikinci ürünün stoğu eski hâline döndü',
    Math.abs((await kalan(sayimStok2)) - oncekiS2) < 0.0001);

  // Fark yoksa fiş kesilmemeli.
  await sql.calistir(
    `UPDATE [${pAd}].dbo.AraSayimSatir SET SayilanMiktar = @m WHERE SayimId = @i AND StokNo = @s`,
    { i: sayimId, s: sayimStok1, m: await kalan(sayimStok1) }
  );
  await sql.calistir(
    `UPDATE [${pAd}].dbo.AraSayimSatir SET SayilanMiktar = @m WHERE SayimId = @i AND StokNo = @s`,
    { i: sayimId, s: sayimStok2, m: await kalan(sayimStok2) }
  );
  const farksiz = await yazma.sayimFisiYaz(
    Object.assign({}, SECIM, { sayimId, kullanici: 'test' })
  );
  kontrol('Fark yokken fiş kesilmiyor', farksiz.yazilmadi === true, String(farksiz.mesaj));

  await sql.calistir(`DELETE FROM [${pAd}].dbo.AraSayimSatir WHERE SayimId = @i`, { i: sayimId });
  await sql.calistir(`DELETE FROM [${pAd}].dbo.AraSayim WHERE Id = @i`, { i: sayimId });
  // --- Zayi / personel çıkışı ---------------------------------------------
  //
  // Vega'nın kendi zayi fişlerinden çıkarılan desen: stok çıkış fişi (33) +
  // seçilen carinin BORÇ hareketi. Fiyat sıfırken de cari hareketi oluşur.
  console.log('\n== Zayi fişi ==');
  const zayiCariler = await sql.sorgu(`
    SELECT TOP 1 IND AS cariNo, FIRMAADI AS ad
    FROM [GALYA_TEST].dbo.F0103TBLCARI ORDER BY IND
  `);
  if (!zayiCariler.length) {
    kontrol('Zayi carisi bulundu', false, 'F0103TBLCARI boş, --kur çalıştırın');
  } else {
    const zCari = zayiCariler[0];
    const zOncekiKalan = await kalan(stoklar[0].stokNo);

    const zayiFis = await yazma.zayiFisiYaz(Object.assign({}, SECIM, {
      cariNo: zCari.cariNo,
      cariAdi: zCari.ad,
      altHesap: 'ZAYİ',
      sebep: 'Sınama: kırılan mal',
      maliyetliMi: false,
      satirlar: [
        { stokNo: stoklar[0].stokNo, stokAdi: stoklar[0].ad, miktar: 4 },
        { stokNo: stoklar[1].stokNo, stokAdi: stoklar[1].ad, miktar: 1.5 }
      ],
      kullanici: 'test'
    }));
    console.log(`  Zayi fişi: ${zayiFis.belgeNo} (IND ${zayiFis.baslikInd})`);

    kontrol('Zayi başlığı yazıldı',
      (await say('F0103D0015TBLSTKCIKBASLIK', 'IND = @i AND BELGETIPI = 33',
        { i: zayiFis.baslikInd })) === 1);

    const zBaslik = await sql.sorgu(
      `SELECT FIRMANO, OZELKOD4, STOKHAREKETEYAZ, CARIHAREKETEYAZ, HAREKETDEPOSU, GIRIS
       FROM [GALYA_TEST].dbo.F0103D0015TBLSTKCIKBASLIK WHERE IND = @i`,
      { i: zayiFis.baslikInd }
    );
    kontrol('Başlıkta cari ZAYİ kartını gösteriyor',
      Number(zBaslik[0].FIRMANO) === Number(zCari.cariNo));
    kontrol('Alt hesap OZELKOD4 alanına yazıldı', zBaslik[0].OZELKOD4 === 'ZAYİ');
    kontrol('Cari hareketine yaz bayrağı açık', zBaslik[0].CARIHAREKETEYAZ === true);
    kontrol('Stok hareketine yaz bayrağı açık', zBaslik[0].STOKHAREKETEYAZ === true);
    kontrol('Çıkış fişi (GIRIS = 0)', zBaslik[0].GIRIS === false);

    kontrol('İki hareket satırı yazıldı',
      (await say('F0103D0015TBLSTKCIKHAREKET', 'EVRAKNO = @i', { i: zayiFis.baslikInd })) === 2);
    kontrol('İki stok hareketi yazıldı',
      (await say('F0103D0015TBLSTOKHAREKETLERI', 'BELGENO = @i AND IZAHAT = 33',
        { i: zayiFis.baslikInd })) === 2);
    kontrol('İki envanter satırı yazıldı',
      (await say('F0103D0015TBLDEPOENVANTER', 'BELGEIND = @i AND BELGETIPI = 33',
        { i: zayiFis.baslikInd })) === 2);
    kontrol('Cari borç hareketi yazıldı',
      (await say('F0103D0015TBLCARIHAREKETLERI', 'LN = @i AND IZAHAT = 33',
        { i: zayiFis.baslikInd })) === 1);

    const zStokHar = await sql.sorgu(
      `SELECT GIREN, CIKAN FROM [GALYA_TEST].dbo.F0103D0015TBLSTOKHAREKETLERI
       WHERE BELGENO = @i AND IZAHAT = 33 AND STOKNO = @s`,
      { i: zayiFis.baslikInd, s: stoklar[0].stokNo }
    );
    kontrol('Zayi ÇIKAN sütununa yazıldı',
      Number(zStokHar[0].CIKAN) === 4 && Number(zStokHar[0].GIREN) === 0);

    kontrol('Zayi stoğu düşürdü',
      Math.abs((await kalan(stoklar[0].stokNo)) - (zOncekiKalan - 4)) < 0.0001);

    // Fiyatsız zayide cari borcu sıfır olmalı (Vega'nın normu).
    const zCariHar = await sql.sorgu(
      `SELECT BORC, ALACAK, OZELKOD FROM [GALYA_TEST].dbo.F0103D0015TBLCARIHAREKETLERI
       WHERE LN = @i AND IZAHAT = 33`,
      { i: zayiFis.baslikInd }
    );
    kontrol('Fiyatsız zayide cari borcu 0', Number(zCariHar[0].BORC) === 0);
    kontrol('Cari hareketinde alt hesap var', zCariHar[0].OZELKOD === 'ZAYİ');

    await yazma.zayiFisiGeriAl(Object.assign({}, SECIM, {
      baslikInd: zayiFis.baslikInd, kullanici: 'test'
    }));
    kontrol('Geri almada zayi başlığı silindi',
      (await say('F0103D0015TBLSTKCIKBASLIK', 'IND = @i', { i: zayiFis.baslikInd })) === 0);
    kontrol('Geri almada hareket satırları silindi',
      (await say('F0103D0015TBLSTKCIKHAREKET', 'EVRAKNO = @i', { i: zayiFis.baslikInd })) === 0);
    kontrol('Geri almada cari hareketi silindi',
      (await say('F0103D0015TBLCARIHAREKETLERI', 'LN = @i AND IZAHAT = 33',
        { i: zayiFis.baslikInd })) === 0);
    kontrol('Geri almada stok eski hâline döndü',
      Math.abs((await kalan(stoklar[0].stokNo)) - zOncekiKalan) < 0.0001);

    // Maliyetle yazınca tutar cari borcuna düşmeli.
    await sql.calistir(
      `UPDATE [GALYA_TEST].dbo.F0103TBLSTOKLAR SET MALIYET = 20 WHERE IND = @s`,
      { s: stoklar[0].stokNo }
    );
    const zMaliyetli = await yazma.zayiFisiYaz(Object.assign({}, SECIM, {
      cariNo: zCari.cariNo, cariAdi: zCari.ad, altHesap: 'ZAYİ',
      maliyetliMi: true,
      satirlar: [{ stokNo: stoklar[0].stokNo, stokAdi: stoklar[0].ad, miktar: 3 }],
      kullanici: 'test'
    }));
    const zMalCari = await sql.sorgu(
      `SELECT BORC FROM [GALYA_TEST].dbo.F0103D0015TBLCARIHAREKETLERI
       WHERE LN = @i AND IZAHAT = 33`,
      { i: zMaliyetli.baslikInd }
    );
    kontrol('Maliyetli zayide cari borcu tutarı taşıyor', Number(zMalCari[0].BORC) > 0,
      'borç=' + (zMalCari[0] && zMalCari[0].BORC));
    await yazma.zayiFisiGeriAl(Object.assign({}, SECIM, {
      baslikInd: zMaliyetli.baslikInd, kullanici: 'test'
    }));
    kontrol('Maliyetli zayi geri alındı',
      (await say('F0103D0015TBLSTKCIKBASLIK', 'IND = @i', { i: zMaliyetli.baslikInd })) === 0);

    // Boş satır / eksik cari reddedilmeli.
    let zHata = null;
    try {
      await yazma.zayiFisiYaz(Object.assign({}, SECIM, {
        cariNo: zCari.cariNo, satirlar: [], kullanici: 'test'
      }));
    } catch (e) { zHata = e; }
    kontrol('Satırsız zayi reddediliyor', zHata !== null);

    zHata = null;
    try {
      await yazma.zayiFisiYaz(Object.assign({}, SECIM, {
        cariNo: 0,
        satirlar: [{ stokNo: stoklar[0].stokNo, miktar: 1 }],
        kullanici: 'test'
      }));
    } catch (e) { zHata = e; }
    kontrol('Carisiz zayi reddediliyor', zHata !== null);
  }

  // --- Stok kartını pasife alma -------------------------------------------
  console.log('\n== Pasife alma ==');
  const pOnceki = await sql.sorgu(
    `SELECT ISNULL(KOD8, '') AS k FROM [GALYA_TEST].dbo.F0103TBLSTOKLAR WHERE IND = @s`,
    { s: stoklar[1].stokNo }
  );
  await yazma.stokPasifYap(Object.assign({}, SECIM, {
    stokNolar: [stoklar[1].stokNo], pasif: true, kullanici: 'test'
  }));
  const pSonra = await sql.sorgu(
    `SELECT ISNULL(KOD8, '') AS k, ISNULL(STATUS, 1) AS d
     FROM [GALYA_TEST].dbo.F0103TBLSTOKLAR WHERE IND = @s`,
    { s: stoklar[1].stokNo }
  );
  kontrol('Kart KOD8 alanına PASİF yazıldı', pSonra[0].k === 'PASİF');
  // Vega kartı ancak STATUS = 2 iken pasif sayıyor; yalnız KOD8 yazmak
  // panelde gizliyordu ama Vega'da kart aktif kalıyordu.
  kontrol("Vega'nın pasif alanı STATUS = 2 yapıldı", Number(pSonra[0].d) === 2);

  await yazma.stokPasifYap(Object.assign({}, SECIM, {
    stokNolar: [stoklar[1].stokNo], pasif: false, kullanici: 'test'
  }));
  const pGeri = await sql.sorgu(
    `SELECT ISNULL(KOD8, '') AS k, ISNULL(STATUS, 1) AS d
     FROM [GALYA_TEST].dbo.F0103TBLSTOKLAR WHERE IND = @s`,
    { s: stoklar[1].stokNo }
  );
  kontrol('Pasiften çıkarınca işaret silindi', pGeri[0].k === '');
  kontrol('Pasiften çıkarınca STATUS = 1 oldu', Number(pGeri[0].d) === 1);

  // Bizim yazmadığımız bir KOD8 değeri pasiften çıkarmada korunmalı.
  await sql.calistir(
    `UPDATE [GALYA_TEST].dbo.F0103TBLSTOKLAR SET KOD8 = 'BASKA' WHERE IND = @s`,
    { s: stoklar[1].stokNo }
  );
  await yazma.stokPasifYap(Object.assign({}, SECIM, {
    stokNolar: [stoklar[1].stokNo], pasif: false, kullanici: 'test'
  }));
  const pKorunan = await sql.sorgu(
    `SELECT ISNULL(KOD8, '') AS k FROM [GALYA_TEST].dbo.F0103TBLSTOKLAR WHERE IND = @s`,
    { s: stoklar[1].stokNo }
  );
  kontrol('Başka KOD8 değerine dokunulmuyor', pKorunan[0].k === 'BASKA');
  await sql.calistir(
    `UPDATE [GALYA_TEST].dbo.F0103TBLSTOKLAR SET KOD8 = @k WHERE IND = @s`,
    { s: stoklar[1].stokNo, k: pOnceki[0].k }
  );

  // Kilit kapalıyken pasife alma da çalışmamalı.
  ayar.ayarYaz({ vegayaYazmaAktif: false });
  let pKilit = null;
  try {
    await yazma.stokPasifYap(Object.assign({}, SECIM, {
      stokNolar: [stoklar[1].stokNo], pasif: true, kullanici: 'test'
    }));
  } catch (e) { pKilit = e; }
  kontrol('Kilit kapalıyken pasife alma engelleniyor',
    pKilit && pKilit.kod === 'YAZMA_KAPALI');
  let zKilit = null;
  try {
    await yazma.zayiFisiYaz(Object.assign({}, SECIM, {
      cariNo: 1, satirlar: [{ stokNo: stoklar[0].stokNo, miktar: 1 }], kullanici: 'test'
    }));
  } catch (e) { zKilit = e; }
  kontrol('Kilit kapalıyken zayi engelleniyor', zKilit && zKilit.kod === 'YAZMA_KAPALI');
  ayar.ayarYaz({ vegayaYazmaAktif: true });


  console.log(`\nSonuç: ${basarili} başarılı, ${basarisiz} hatalı\n`);
  await sql.havuzKapat();
  process.exit(basarisiz ? 1 : 0);
})().catch(async (e) => {
  console.log('\nBEKLENMEYEN HATA: ' + e.message);
  console.log(e.stack);
  await sql.havuzKapat();
  process.exit(1);
});
