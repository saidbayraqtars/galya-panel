'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const izleyici = require('./lib/izleyici');

let pencere = null;

function pencereAc() {
  pencere = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    backgroundColor: '#f1f3f5',
    title: 'Galya İzleyici',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  pencere.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

app.whenReady().then(() => {
  pencereAc();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) pencereAc();
  });
});

app.on('window-all-closed', async () => {
  await izleyici.kapat();
  if (process.platform !== 'darwin') app.quit();
});

// --- Ayar dosyası (bağlantı bilgisi exe'nin yanında durur) -----------------

function ayarYolu() {
  return path.join(app.getPath('userData'), 'izleyici-ayar.json');
}

const VARSAYILAN = {
  windowsGirisi: false,
  sunucu: 'localhost',
  port: 1433,
  kullanici: 'sa',
  sifre: '',
  veritabani: 'VEGADB'
};

function ayarOku() {
  try {
    // Not Defteri ile kaydedilen dosyalar başta BOM taşır; JSON.parse kabul etmez.
    const ham = fs.readFileSync(ayarYolu(), 'utf8').replace(/^﻿/, '');
    return Object.assign({}, VARSAYILAN, JSON.parse(ham));
  } catch (e) {
    return Object.assign({}, VARSAYILAN);
  }
}

function ayarYaz(yeni) {
  const birlesik = Object.assign(ayarOku(), yeni);
  try {
    fs.mkdirSync(path.dirname(ayarYolu()), { recursive: true });
    fs.writeFileSync(ayarYolu(), JSON.stringify(birlesik, null, 2), 'utf8');
  } catch (e) {
    /* yazılamazsa da program çalışmaya devam eder */
  }
  return birlesik;
}

// --- IPC -------------------------------------------------------------------

function kayitEt(kanal, isFn) {
  ipcMain.handle(kanal, async (olay, girdi) => {
    try {
      return { tamam: true, veri: await isFn(girdi || {}) };
    } catch (e) {
      return { tamam: false, mesaj: anlasilirHata(e) };
    }
  });
}

function anlasilirHata(e) {
  const m = (e && e.message ? e.message : String(e)) || '';
  if (/Login failed/i.test(m)) return 'SQL kullanıcı adı veya şifre hatalı.';
  if (/ESOCKET|ECONNREFUSED|getaddrinfo|failed to connect/i.test(m)) {
    return 'SQL sunucusuna ulaşılamadı. Sunucu adını ve ağı kontrol edin.';
  }
  if (/permission|denied|not have/i.test(m)) {
    return 'Bu kullanıcının yetkisi yetmiyor. Kayıt almak için sysadmin yetkili bir SQL kullanıcısı gerekir (genelde sa). Detay: ' + m;
  }
  return m;
}

kayitEt('ayar:oku', async () => {
  const a = ayarOku();
  return {
    sunucu: a.sunucu,
    port: a.port,
    kullanici: a.kullanici,
    veritabani: a.veritabani,
    windowsGirisi: !!a.windowsGirisi,
    sifreVar: !!a.sifre,
    windowsKullanilabilir: izleyici.windowsGirisiKullanilabilir()
  };
});

kayitEt('baglan', async (g) => {
  // Şifre alanı boş bırakıldıysa daha önce kaydedilmiş şifreyi koru.
  const ayar = ayarYaz(g.sifre ? g : Object.assign({}, g, { sifre: ayarOku().sifre }));
  return izleyici.baglantiTesti(ayar);
});

kayitEt('baslat', async () => izleyici.baslat(ayarOku()));
kayitEt('durum', async () => izleyici.durum(ayarOku()));
kayitEt('durdur', async () => {
  await izleyici.durdurVeSil(ayarOku());
  return { tamam: true };
});

// Yakalananları masaüstüne tek bir metin dosyası olarak yazar.
kayitEt('kaydet', async (g) => {
  const ayar = ayarOku();
  const klasor = app.getPath('desktop');
  const damga = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const etiket = (g.etiket || 'kayit').replace(/[^a-zA-Z0-9_-]/g, '') || 'kayit';
  const dosya = path.join(klasor, `galya-izleyici-${etiket}-${damga}.txt`);

  const akis = fs.createWriteStream(dosya, { encoding: 'utf8' });
  akis.write(
    `# Galya İzleyici kaydı\n# Makine: ${os.hostname()}\n# Kullanıcı: ${os.userInfo().username}\n` +
      `# Sunucu: ${ayar.sunucu}\n# Veritabanı: ${ayar.veritabani}\n` +
      `# Etiket: ${g.etiket || '-'}\n# Zaman: ${new Date().toLocaleString('tr-TR')}\n\n`
  );

  const sonuc = await izleyici.oku(
    ayar,
    (o, sira) => {
      akis.write(`----- ${sira} ----- ${o.zaman} [${o.uygulama}] {${o.kullanici}}\n${o.metin}\n\n`);
    },
    (toplam) => {
      if (pencere && !pencere.isDestroyed()) pencere.webContents.send('ilerleme', toplam);
    }
  );

  await new Promise((coz) => akis.end(coz));
  return Object.assign({ dosya }, sonuc);
});

kayitEt('dosyaGoster', async (g) => {
  if (g.dosya) shell.showItemInFolder(g.dosya);
  return { tamam: true };
});
