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

  console.log(`\nSonuç: ${basarili} başarılı, ${basarisiz} hatalı\n`);
  await sql.havuzKapat();
  process.exit(basarisiz ? 1 : 0);
})().catch(async (e) => {
  console.log('\nBEKLENMEYEN HATA: ' + e.message);
  console.log(e.stack);
  await sql.havuzKapat();
  process.exit(1);
});
