'use strict';

// Kullanıcı / yetki ve sayım onay akışının sınaması.
//
//   node kurulum/test-yetki.js
//
// Müşteri verisine DOKUNMAZ: panel tablolarını GALYA_TEST içinde açar ve
// orada çalışır. VEGADB yalnızca OKUNUR — sayım ekranı ve kapsam süzgeci
// gerçek stok kartlarına baktığı için okuma şart.
//
// Neden ayrı veritabanı: sınama kullanıcı tablosunu boşaltıyor. Canlı
// GALYA_PANEL üzerinde çalışsaydı müşterinin tanımladığı bütün kullanıcılar
// silinir, program bilinmeyen bir PIN'le kilitlenirdi. Aşağıdaki kontrol
// yanlışlıkla canlıya yönelmeyi de engelliyor.
//
// GALYA_TEST kullanılıyor çünkü `galya_panel` kullanıcısının CREATE DATABASE
// yetkisi yok; o veritabanı `node kurulum/test-yazma.js --kur` ile bir kez
// açılıyor. Önce onu çalıştırın.

const path = require('path');
const fs = require('fs');
const os = require('os');

const kok = path.join(__dirname, '..');

const testAyar = path.join(os.tmpdir(), 'galya-test-yetki-ayarlar.json');
const gercek = JSON.parse(
  fs.readFileSync(path.join(kok, 'ayarlar.json'), 'utf8').replace(/^﻿/, '')
);
fs.writeFileSync(
  testAyar,
  JSON.stringify(Object.assign({}, gercek, { panelVeritabani: 'GALYA_TEST' }), null, 2),
  'utf8'
);
process.env.GALYA_AYAR_DOSYASI = testAyar;

const sql = require(path.join(kok, 'db', 'sql'));
const panel = require(path.join(kok, 'db', 'panel'));
const oturum = require(path.join(kok, 'db', 'oturum'));
const sayim = require(path.join(kok, 'db', 'sayim'));

const SECIM = {
  firma: gercek.varsayilanFirma || 'F0102',
  donem: gercek.varsayilanDonem || 'D0002',
  depo: Number(gercek.varsayilanDepo) || 1
};
const KIM = { kullanici: 'sinama', bilgisayar: 'sinama-pc' };

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

(async () => {
  await panel.kur();
  const p = panel.p();
  if (p === (gercek.panelVeritabani || 'GALYA_PANEL')) {
    throw new Error('Sınama canlı panel veritabanına yönlenmiş, durduruldu.');
  }
  await sql.calistir(`DELETE FROM [${p}].dbo.Kullanici`);
  oturum.onbellekTemizle();

  console.log('\n== Kullanıcı yokken kilit yok ==');
  kontrol('Rol yönetici', (await oturum.rolAl()) === oturum.YONETICI);
  kontrol('Kilit kapalı', (await oturum.pinVarMi()) === false);
  kontrol('Kapsam sınırsız', (await oturum.kapsamAl()).length === 0);

  console.log('\n== Kullanıcı tanımlama ==');
  await oturum.kullaniciKaydet({ ad: 'Sınama Yönetici', rol: 'yonetici', pin: '9137' }, KIM);
  await oturum.kullaniciKaydet(
    {
      ad: 'Sınama Barcı',
      rol: 'kullanici',
      pin: '4268',
      yetkiler: { sayim: true, siniflar: ['BAR'] }
    },
    KIM
  );
  const tumYetkiler = {};
  for (const y of oturum.YETKILER) tumYetkiler[y.anahtar] = true;
  await oturum.kullaniciKaydet(
    {
      ad: 'Sınama Operasyon',
      rol: 'kullanici',
      pin: '6842',
      yetkiler: tumYetkiler
    },
    KIM
  );
  let liste = await oturum.kullaniciListesi();
  kontrol('Üç kullanıcı kaydedildi', liste.length === 3);
  const barci = liste.find((k) => k.ad === 'Sınama Barcı');
  const operasyon = liste.find((k) => k.ad === 'Sınama Operasyon');
  kontrol('Sayım yetkisi işaretli', barci.yetkiler.sayim === true);
  kontrol('Tam sayım yetkisi işaretsiz', barci.yetkiler.tamSayim === false);
  kontrol('Kapsam BAR', JSON.stringify(barci.yetkiler.siniflar) === '["BAR"]');
  kontrol(
    'Bütün modül yetkileri kaydedilip okunuyor',
    oturum.YETKILER.every((y) => operasyon.yetkiler[y.anahtar] === true)
  );

  console.log('\n== Kilit devrede ==');
  kontrol('Kilit açıldı', (await oturum.pinVarMi()) === true);
  kontrol('Giriş yapılmadan rol kullanıcı', (await oturum.rolAl()) === oturum.KULLANICI);

  console.log('\n== PIN ile giriş (kullanıcı seçilmeden) ==');
  const g1 = await oturum.giris({ pin: '4268' }, KIM);
  kontrol('PIN sahibini buldu', g1.kullaniciAdi === 'Sınama Barcı');
  kontrol('Rolü kullanıcı', g1.rol === oturum.KULLANICI);
  kontrol('Kapsamı BAR', JSON.stringify(await oturum.kapsamAl()) === '["BAR"]');
  kontrol('Sayım yetkisi var', (await oturum.yetkiVarMi('sayim')) === true);
  kontrol('Üretim yetkisi yok', (await oturum.yetkiVarMi('uretim')) === false);
  kontrol('Tam sayım yetkisi yok', (await oturum.yetkiVarMi('tamSayim')) === false);

  console.log('\n== Yönetici girişi ==');
  const g2 = await oturum.giris({ pin: '9137' }, KIM);
  kontrol('Yönetici olarak girildi', g2.rol === oturum.YONETICI);
  kontrol('Yöneticinin kapsamı sınırsız', (await oturum.kapsamAl()).length === 0);
  kontrol('Yönetici her yetkiye sahip', (await oturum.yetkiVarMi('uretim')) === true);

  console.log('\n== Yanlış PIN ve benzersizlik ==');
  let hata = null;
  try { await oturum.giris({ pin: '0000' }, KIM); } catch (e) { hata = e; }
  kontrol('Yanlış PIN reddedildi', hata && hata.kod === 'PIN_YANLIS');

  hata = null;
  try {
    await oturum.kullaniciKaydet({ ad: 'Üçüncü', rol: 'kullanici', pin: '4268' }, KIM);
  } catch (e) { hata = e; }
  kontrol('Aynı PIN ikinci kullanıcıya verilemiyor', hata !== null,
    hata ? '' : 'çakışma yakalanmadı');

  hata = null;
  try { await oturum.kullaniciKaydet({ ad: 'PINsiz', rol: 'kullanici' }, KIM); } catch (e) { hata = e; }
  kontrol('PIN\'siz yeni kullanıcı reddediliyor', hata !== null);

  console.log('\n== Son yönetici korunuyor ==');
  liste = await oturum.kullaniciListesi();
  const yoneticiId = liste.find((k) => k.rol === 'yonetici').id;
  hata = null;
  try { await oturum.kullaniciSil({ id: yoneticiId }, KIM); } catch (e) { hata = e; }
  kontrol('Son yönetici silinemiyor', hata && /Son y/.test(hata.message));

  console.log('\n== Sayım kapsamı ==');
  const tam = await sayim.sayimEkraniGetir(Object.assign({}, SECIM, { tur: 'tam' }));
  const bar = await sayim.sayimEkraniGetir(
    Object.assign({}, SECIM, { tur: 'tam', siniflar: ['BAR'] })
  );
  kontrol('Tam sayım listesi doldu', tam.length > 0, tam.length + ' satır');
  kontrol('Kapsam listeyi daralttı', bar.length > 0 && bar.length < tam.length,
    `${bar.length} / ${tam.length}`);
  kontrol('Kapsamdakilerin hepsi BAR', bar.every((s) => s.sinif === 'BAR'));
  kontrol('Pasif kart sayım listesinde yok',
    !tam.some((s) => String(s.sinif || '').trim() === 'PASİF'));

  const ikisi = await sayim.sayimEkraniGetir(
    Object.assign({}, SECIM, { tur: 'tam', siniflar: ['BAR', 'MUTFAK'] })
  );
  kontrol('İki sınıf birlikte seçilebiliyor', ikisi.length > bar.length);
  kontrol('Yalnızca seçilen iki sınıf geldi',
    ikisi.every((s) => s.sinif === 'BAR' || s.sinif === 'MUTFAK'));

  console.log('\n== Kapsam dışı ürün reddediliyor ==');
  const mutfakUrun = ikisi.find((s) => s.sinif === 'MUTFAK');
  hata = null;
  try {
    await sayim.sayimKaydet(Object.assign({}, SECIM, {
      tur: 'tam',
      siniflar: ['BAR'],
      sayan: 'sinama',
      satirlar: [{ stokNo: mutfakUrun.stokNo, stokAdi: mutfakUrun.stokAdi, sayilan: 5 }]
    }));
  } catch (e) { hata = e; }
  kontrol('Kapsam dışı ürün kaydedilemiyor', hata && /kapsam/i.test(hata.message));

  console.log('\n== Onay akışı ==');
  const barUrun = bar[0];
  const kayit = await sayim.sayimKaydet(Object.assign({}, SECIM, {
    tur: 'tam',
    siniflar: ['BAR'],
    sayan: 'sinama-barci',
    satirlar: [{ stokNo: barUrun.stokNo, stokAdi: barUrun.stokAdi, sayilan: 7 }]
  }));
  kontrol('Sayım kaydedildi', kayit.tamam && kayit.sayimId > 0);
  kontrol('Durum bekliyor (Vega\'ya yazılmadı)', kayit.durum === 'bekliyor');
  kontrol('Tür tam olarak kaydedildi', kayit.tur === 'tam');

  let bekleyen = await sayim.bekleyenler(SECIM);
  kontrol('Onay kuyruğunda görünüyor', bekleyen.some((b) => b.id === kayit.sayimId));
  kontrol('Kapsam kuyruğa yazıldı',
    (bekleyen.find((b) => b.id === kayit.sayimId) || {}).kapsam === 'BAR');

  await sayim.sayimReddet({
    sayimId: kayit.sayimId, onaylayan: 'sinama-yonetici', sebep: 'sınama'
  });
  bekleyen = await sayim.bekleyenler(SECIM);
  kontrol('Reddedilen kuyruktan çıktı', !bekleyen.some((b) => b.id === kayit.sayimId));
  let gecmis = (await sayim.sayimListesi(SECIM)).find((x) => x.id === kayit.sayimId);
  kontrol('Durum reddedildi', gecmis.durum === 'reddedildi');
  kontrol('Red sebebi saklandı', gecmis.redSebebi === 'sınama');

  // Ara sayım listeye bağlı: listede olmayan ürün kaydedilemez.
  await sayim.listeyeEkle(Object.assign({}, SECIM, {
    stokNo: barUrun.stokNo, stokAdi: barUrun.stokAdi, kullanici: 'sinama'
  }));
  const araListe = await sayim.sayimEkraniGetir(Object.assign({}, SECIM, { tur: 'ara' }));
  kontrol('Ara sayım listeden besleniyor',
    araListe.some((s) => Number(s.stokNo) === Number(barUrun.stokNo)));

  const kayit2 = await sayim.sayimKaydet(Object.assign({}, SECIM, {
    tur: 'ara',
    sayan: 'sinama',
    satirlar: [{ stokNo: barUrun.stokNo, stokAdi: barUrun.stokAdi, sayilan: 3 }],
    siniflar: []
  }));
  await sayim.onayIsaretle({ sayimId: kayit2.sayimId, onaylayan: 'sinama-yonetici' });
  gecmis = (await sayim.sayimListesi(SECIM)).find((x) => x.id === kayit2.sayimId);
  kontrol('Durum onaylandı', gecmis.durum === 'onaylandi');
  kontrol('Onaylayan yazıldı', gecmis.onaylayan === 'sinama-yonetici');

  console.log('\n== Çıkış ==');
  await oturum.cikis({}, KIM);
  kontrol('Çıkışta rol kullanıcı', (await oturum.rolAl()) === oturum.KULLANICI);

  // Sınama verisini bırakmıyoruz.
  await sql.calistir(`DELETE FROM [${p}].dbo.Kullanici`);
  await sql.calistir(`DELETE FROM [${p}].dbo.SayimListesi WHERE StokNo = @s`, {
    s: Number(barUrun.stokNo)
  });
  await sql.calistir(
    `DELETE FROM [${p}].dbo.AraSayimSatir WHERE SayimId IN (@a, @b)`,
    { a: kayit.sayimId, b: kayit2.sayimId }
  );
  await sql.calistir(`DELETE FROM [${p}].dbo.AraSayim WHERE Id IN (@a, @b)`, {
    a: kayit.sayimId,
    b: kayit2.sayimId
  });

  console.log(`\nSonuç: ${basarili} başarılı, ${basarisiz} hatalı\n`);
  await sql.havuzKapat();
  process.exit(basarisiz ? 1 : 0);
})().catch(async (e) => {
  console.log('\nBEKLENMEYEN HATA: ' + e.message);
  console.log(e.stack);
  await sql.havuzKapat();
  process.exit(1);
});
