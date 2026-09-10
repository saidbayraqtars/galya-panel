'use strict';

require('./test-ortam').ayarla();

// Arayüz duman sınaması.
//
//   npx electron kurulum/test-arayuz.js
//
// Gerçek arayüzü görünmez bir pencerede açar, her ekranı sırayla çizer ve
// hata çıkıp çıkmadığına bakar. Ekran görüntüsü almaya ya da tıklamaya
// gerek kalmıyor; `ekranAc()` doğrudan çağrılıyor.
//
// Neyi yakalar: tanımsız değişken, yanlış kanal adı, çizim sırasında patlayan
// kod, boş kalan ekran. Neyi yakalamaz: yerleşim/görünüm hataları.
//
// VEGADB'ye yazmaz — yalnızca ekranları çizer. Sayım kaydetme, üretim, zayi
// gibi yazan düğmelere basılmaz.

const path = require('path');
const { app, BrowserWindow } = require('electron');

const kok = path.join(__dirname, '..');

// main.js bütün IPC uçlarını kaydediyor; onu olduğu gibi kullanıyoruz ki
// sınama gerçek kanallardan geçsin. Kendi penceresini de açar, gizleriz.
require(path.join(kok, 'main.js'));

// Çizilecek ekranlar. Parametre gerekenler ikinci alanda.
const EKRANLAR = [
  ['ana', null],
  ['stok', { suzgec: 'sorunlu' }],
  ['stok', { kod2: 'BAR,MUTFAK' }],
  ['stok', { kod2: 'BAR,MUTFAK', kod2Haric: 1 }],
  ['stok', { pasifDahil: 1 }],
  ['sayim', { tur: 'ara' }],
  ['sayim', { tur: 'tam' }],
  ['sayimOnay', null],
  ['zayi', null],
  ['sayim', { tur: 'tam', kod2: 'BAR', arama: 'a' }],
  ['sayim', { tur: 'tam', stokDurumu: 'eksi' }],
  ['sayim', { tur: 'tam', stokDurumu: 'eksiSifir', kod2: 'BAR' }],
  ['uretim', { kip: 'sifirla' }],
  ['uretim', { kip: 'sifirla', thirdSadece: 1 }],
  ['uretim', { kip: 'fireli' }],
  ['kullanicilar', null],
  ['tutanak', null],
  ['recete', null],
  ['third', null],
  ['gider', null],
  ['gider', { kapsam: 'gider' }],
  ['gider', { tumu: 1 }],
  ['yedek', null],
  ['cari', null],
  ['alisFatura', null],
  ['maliyetlendirme', null],
  ['aktarim', null],
  ['ayarlar', null]
];

let basarili = 0;
let basarisiz = 0;
let atlanan = 0;

function kontrol(ad, kosul, ayrinti) {
  if (kosul) {
    console.log('  OK   ' + ad);
    basarili++;
  } else {
    console.log('  HATA ' + ad + (ayrinti ? '\n       ' + ayrinti : ''));
    basarisiz++;
  }
}

async function bekle(ms) {
  return new Promise((c) => setTimeout(c, ms));
}

app.whenReady().then(async () => {
  // main.js'in açtığı pencereyi gizle; sınama görünmez çalışsın.
  for (const p of BrowserWindow.getAllWindows()) p.hide();

  const pencere = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    webPreferences: {
      preload: path.join(kok, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const hatalar = [];
  pencere.webContents.on('console-message', (olay) => {
    const seviye = olay && olay.level != null ? olay.level : 0;
    if (seviye === 'error' || seviye >= 3) hatalar.push(olay.message);
  });

  await pencere.loadFile(path.join(kok, 'ui', 'index.html'));

  // Yakalanmamış hatalar da toplansın.
  await pencere.webContents.executeJavaScript(`
    window.__hatalar = [];
    window.addEventListener('error', (e) => window.__hatalar.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) =>
      window.__hatalar.push('reddedildi: ' + String(e.reason && e.reason.message || e.reason)));
    true;
  `);

  console.log('\n== Açılış ==');
  // baslat() firma listesini okuyup ana ekranı çiziyor; bitmesini bekliyoruz.
  let hazir = false;
  for (let i = 0; i < 60 && !hazir; i++) {
    await bekle(500);
    // GALYA_TEST'te kullanıcı tutulmaz. Yeni kurulumdaki gerçek akışı izleyip
    // "Kullanıcı tanımlamadan devam et" düğmesine bir kez basarak ekran
    // testlerine geçiyoruz.
    await pencere.webContents.executeJavaScript(`
      (() => {
        if (!(durum && durum.kullaniciYok) || durum.firma) return false;
        const dugme = [...document.querySelectorAll('#icerik button')]
          .find((d) => d.textContent.includes('Kullanıcı tanımlamadan devam et'));
        if (!dugme) return false;
        dugme.click();
        return true;
      })()
    `).catch(() => false);
    hazir = await pencere.webContents.executeJavaScript(
      `!!(durum && durum.firma) && !document.querySelector('#icerik .yukleniyor')`
    ).catch(() => false);
  }
  kontrol('Program açıldı ve firma seçildi', hazir, 'firma okunamadı (SQL kapalı olabilir)');
  if (!hazir) {
    console.log(`\nSonuç: ${basarili} başarılı, ${basarisiz} hatalı\n`);
    app.exit(1);
    return;
  }

  console.log('\n== Ekranlar ==');
  for (const [ad, parametre] of EKRANLAR) {
    const etiket = ad + (parametre ? ' ' + JSON.stringify(parametre) : '');
    try {
      const sonuc = await pencere.webContents.executeJavaScript(`
        (async () => {
          window.__hatalar = [];
          await ekranAc(${JSON.stringify(ad)}, ${JSON.stringify(parametre || {})});
          return {
            metin: document.getElementById('icerik').innerText.slice(0, 4000),
            dugme: document.querySelectorAll('#icerik button').length,
            hatalar: window.__hatalar
          };
        })()
      `);

      // "Hata" başlığı ekranAc'ın kendi yakaladığı çizim hatasıdır.
      const cizimHatasi = /^Hata\b/m.test(sonuc.metin);
      const bos = !sonuc.metin.trim();
      kontrol(
        etiket,
        !cizimHatasi && !bos && !sonuc.hatalar.length,
        cizimHatasi
          ? sonuc.metin.split('\n').slice(0, 3).join(' | ')
          : bos
            ? 'ekran boş kaldı'
            : sonuc.hatalar.join(' | ')
      );
    } catch (e) {
      kontrol(etiket, false, e.message);
    }
  }

  console.log('\n== Pencereler ==');
  // Katman (modal) açan yollar: hepsi kendi verisini okuyor.
  //
  // Üçüncü alan, pencerenin okuduğu ucun istediği yetki. Panelde kullanıcı
  // tanımlıysa sınama oturumu GİRİŞ YAPMAMIŞ sayılır ve o uçlar haklı olarak
  // "yetkiniz yok" döner; bu bir arayüz hatası değil, o yüzden atlanıyor.
  // Gerçek kullanımda düğme zaten yetkisiz kişiye çizilmiyor.
  const katmanlar = [
    ['Giriş penceresi', 'girisPenceresi()', null],
    ['Yeni zayi', 'zayiPenceresi(null)', 'zayi'],
    ['Yeni kullanıcı', 'kullaniciPenceresi(null, [{deger:"BAR",adet:5},{deger:"MUTFAK",adet:9}])', null],
    ['Yeni fatura', 'alisFaturaPenceresi(null)', 'alisFatura'],
    ['Yeni tutanak', 'tutanakPenceresi()', 'tutanak'],
    ['Sayım listesi', 'sayimListesiDuzenle()', 'sayim']
  ];
  for (const [ad, cagri, gerekenYetki] of katmanlar) {
    if (gerekenYetki) {
      const yetkili = await pencere.webContents.executeJavaScript(
        `durum.rol === 'yonetici' || !!(durum.yetkiler && durum.yetkiler[${JSON.stringify(gerekenYetki)}])`
      ).catch(() => true);
      if (!yetkili) {
        console.log('  ATLA ' + ad + '  (oturum açık değil, "' + gerekenYetki + '" yetkisi yok)');
        atlanan++;
        continue;
      }
    }
    try {
      const sonuc = await pencere.webContents.executeJavaScript(`
        (async () => {
          window.__hatalar = [];
          katmanKapat();
          await ${cagri};
          await new Promise((c) => setTimeout(c, 400));
          return {
            acik: !document.getElementById('kutuKatman').classList.contains('hidden'),
            metin: document.getElementById('katmanIcerik').innerText.slice(0, 200),
            hatalar: window.__hatalar
          };
        })()
      `);
      kontrol(ad, sonuc.acik && !sonuc.hatalar.length,
        sonuc.hatalar.length ? sonuc.hatalar.join(' | ') : 'katman açılmadı');
    } catch (e) {
      kontrol(ad, false, e.message);
    }
  }

  if (hatalar.length) {
    console.log('\nArayüz konsolundaki hatalar:');
    for (const h of hatalar.slice(0, 20)) console.log('  ' + h);
  }

  console.log(
    `\nSonuç: ${basarili} başarılı, ${basarisiz} hatalı` +
    (atlanan ? `, ${atlanan} atlandı (oturum açık değil)` : '') + '\n'
  );
  app.exit(basarisiz ? 1 : 0);
});
