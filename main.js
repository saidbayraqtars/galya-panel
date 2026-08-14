'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');

const ayarlar = require('./db/ayar');
const sql = require('./db/sql');
const firma = require('./db/firma');
const panel = require('./db/panel');
const vega = require('./db/vega');
const sefim = require('./db/sefim');
const sayim = require('./db/sayim');
const tutanak = require('./db/tutanak');
const ozet = require('./db/ozet');
const yazma = require('./db/yazma');
const guncelleme = require('./db/guncelleme');
const vegaprogram = require('./db/vegaprogram');
const rapor = require('./db/rapor');

let pencere = null;

function pencereAc() {
  pencere = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#f1f3f5',
    title: 'Galya Panel',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  // Arayüzde çıkan hata ve uyarılar destek için terminale de yazılsın.
  pencere.webContents.on('console-message', (olay) => {
    const seviye = olay && olay.level != null ? olay.level : 0;
    const hataMi = seviye === 'error' || seviye === 'warning' || seviye >= 2;
    if (!hataMi) return;
    console.log(`[arayüz] ${olay.message} (${olay.sourceId}:${olay.lineNumber})`);
  });
  pencere.webContents.on('preload-error', (olay, yol, hata) => {
    console.log('[preload hatası] ' + hata.message);
  });

  pencere.loadFile(path.join(__dirname, 'ui', 'index.html'));
  pencere.once('ready-to-show', () => pencere.show());
}

app.whenReady().then(() => {
  pencereAc();
  guncelleme.baslat(pencere);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) pencereAc();
  });
});

app.on('window-all-closed', async () => {
  await sql.havuzKapat();
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC ------------------------------------------------------------------
// Her çağrı { tamam, veri } veya { tamam:false, mesaj } döner; arayüzde
// kullanıcıya her zaman anlaşılır bir mesaj gösterilebilsin diye.

const kim = {
  kullanici: os.userInfo().username,
  bilgisayar: os.hostname()
};

function kayitEt(kanal, isFn) {
  ipcMain.handle(kanal, async (olay, girdi) => {
    try {
      const veri = await isFn(girdi || {}, kim);
      return { tamam: true, veri };
    } catch (e) {
      return {
        tamam: false,
        mesaj: anlasilirHata(e),
        kod: e && e.kod ? e.kod : null
      };
    }
  });
}

function anlasilirHata(e) {
  const m = (e && e.message ? e.message : String(e)) || '';
  if (/Login failed/i.test(m)) {
    return 'SQL kullanıcı adı veya şifre hatalı. Ayarlar ekranından kontrol edin.';
  }
  if (/ESOCKET|ECONNREFUSED|getaddrinfo|failed to connect/i.test(m)) {
    return (
      'SQL sunucusuna ulaşılamadı. Sunucu adını ve ağ bağlantısını kontrol edin. ' +
      'Sunucu adı Ayarlar ekranında yazılı.'
    );
  }
  if (/Invalid object name/i.test(m)) {
    return 'Veritabanında beklenen tablo bulunamadı. Firma veya dönem seçimi yanlış olabilir. Detay: ' + m;
  }
  if (/CREATE DATABASE permission|permission was denied/i.test(m)) {
    return (
      'SQL kullanıcısının yetkisi yetersiz. GALYA_PANEL veritabanını oluşturmak için ' +
      'kurulum/sql-kullanici-olustur.sql betiğini bir kez çalıştırın.'
    );
  }
  return m;
}

// Ayar ve bağlantı
kayitEt('ayar:oku', async () => {
  const a = Object.assign({}, ayarlar.ayarOku());
  delete a.sifre; // şifre arayüze gönderilmez
  a.sifreVar = !!ayarlar.ayarOku().sifre;
  a.dosyaYolu = ayarlar.ayarYolu();
  return a;
});

kayitEt('ayar:yaz', async (girdi) => {
  const yeni = Object.assign({}, girdi);
  if (yeni.sifre === '' || yeni.sifre == null) delete yeni.sifre; // boşsa mevcudu koru
  const sonuc = ayarlar.ayarYaz(yeni);
  await sql.havuzKapat();
  firma.onbellekTemizle();
  const g = Object.assign({}, sonuc);
  delete g.sifre;
  return g;
});

kayitEt('baglanti:test', async () => sql.baglantiTesti());
kayitEt('panel:kur', async () => {
  await panel.kur();
  return { tamam: true };
});

// Firma / depo
kayitEt('firma:liste', async (g) => firma.firmalariGetir(!!g.yenile));
kayitEt('depo:liste', async () => firma.depolariGetir());

// Ana ekran
kayitEt('ozet:anaEkran', async (g) => ozet.anaEkran(g));

// Stok
kayitEt('stok:durum', async (g) => vega.stokDurumu(g));
kayitEt('stok:ara', async (g) => vega.stokAra(g));
kayitEt('stok:hareket', async (g) => vega.stokHareketleri(g));

// Stok kontrol: teorik miktarın karşısına en son fiziki sayım yazılıyor.
kayitEt('stok:kontrol', async (g) => {
  const [liste, sayimlar] = await Promise.all([
    vega.stokKontrolListesi(g),
    sayim.fizikiSayimlar(g).catch(() => [])
  ]);
  const harita = new Map();
  for (const s of sayimlar) harita.set(Number(s.stokNo), s);

  for (const satir of liste) {
    const s = harita.get(Number(satir.stokNo));
    satir.sayilan = s ? Number(s.sayilan) : null;
    satir.sayimTarihi = s ? s.sayimTarihi : null;
    satir.sayan = s ? s.sayan : null;
    satir.fark = s ? Number(s.sayilan) - Number(satir.teorik) : null;
    satir.farkTutari = satir.fark == null ? null : satir.fark * Number(satir.birimMaliyet || 0);
  }
  return liste;
});

// Gider / hizmet kartları
kayitEt('gider:liste', async (g) => vega.giderHizmetStoklari(g));
kayitEt('gider:sifirla', async (g, k) =>
  yazma.giderStokSifirla(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('gider:geriAl', async (g, k) =>
  yazma.giderStokSifirlamaGeriAl(Object.assign({}, g, { kullanici: k.kullanici }))
);

// Rapor dışa aktarma
kayitEt('rapor:excel', async (g, k) => rapor.excelKaydet(pencere, g, k));
kayitEt('rapor:pdf', async (g, k) => rapor.pdfKaydet(pencere, g, k));
kayitEt('rapor:ac', async (g) => rapor.dosyaAc(g.yol));

// Reçete
kayitEt('recete:mamuller', async (g) => vega.receteliMamuller(g));
kayitEt('recete:agac', async (g) => vega.receteAgaci(g));
kayitEt('recete:satirlar', async (g) => vega.receteSatirlari(g));
kayitEt('recete:olustur', async (g, k) =>
  yazma.receteOlustur(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('recete:satirEkle', async (g, k) =>
  yazma.receteSatiriEkle(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('recete:satirGuncelle', async (g, k) =>
  yazma.receteSatiriGuncelle(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('recete:satirSil', async (g, k) =>
  yazma.receteSatiriSil(Object.assign({}, g, { kullanici: k.kullanici }))
);

// THIRD
kayitEt('third:adaylar', async (g) => vega.thirdAdaylari(g));
kayitEt('third:isaretliler', async (g) => tutanak.thirdIsaretliler(g));
kayitEt('third:isaretle', async (g, k) =>
  tutanak.thirdIsaretle(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('third:vegayaYaz', async (g, k) =>
  yazma.kod11Yaz(Object.assign({}, g, { kullanici: k.kullanici }))
);

// Maliyet
kayitEt('maliyet:eskiyenler', async (g) => vega.maliyetiEskimisler(g));

// Cari
kayitEt('cari:bakiye', async (g) => vega.cariBakiye(g));

// E-Fatura
kayitEt('fatura:bekleyen', async (g) => vega.bekleyenFaturalar(g));
kayitEt('fatura:eslesmeler', async (g) => vega.faturaUrunEslesmeleri(g));

// Şefim / satış aktarımı
kayitEt('satis:aktarimDurumu', async () => sefim.aktarimDurumu());
kayitEt('satis:ozet', async (g) => sefim.satisOzeti(g));
kayitEt('satis:eslestirmeDurumu', async (g) => sefim.eslestirmeDurumu(g));
kayitEt('satis:eslestirmeKaydet', async (g, k) =>
  sefim.eslestirmeKaydet(Object.assign({}, g, { kaydeden: k.kullanici }))
);
kayitEt('satis:oneri', async (g) => sefim.eslesmeOnerisi(g));
kayitEt('satis:tuketim', async (g) => sefim.satistanTuketim(g));

// Ara sayım
kayitEt('sayim:liste', async (g) => sayim.listeGetir(g));
kayitEt('sayim:listeyeEkle', async (g, k) =>
  sayim.listeyeEkle(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('sayim:listedenCikar', async (g) => sayim.listedenCikar(g));
kayitEt('sayim:ekran', async (g) => sayim.sayimEkraniGetir(g));
kayitEt('sayim:kaydet', async (g, k) =>
  sayim.sayimKaydet(Object.assign({}, g, { sayan: g.sayan || k.kullanici }))
);
kayitEt('sayim:gecmis', async (g) => sayim.sayimListesi(g));
kayitEt('sayim:detay', async (g) => sayim.sayimDetayi(g));
kayitEt('sayim:iptal', async (g, k) =>
  sayim.sayimIptal(Object.assign({}, g, { kullanici: k.kullanici }))
);

// Tutanak
kayitEt('tutanak:kaydet', async (g, k) =>
  tutanak.tutanakKaydet(Object.assign({}, g, { duzenleyen: g.duzenleyen || k.kullanici }))
);
kayitEt('tutanak:liste', async (g) => tutanak.tutanakListesi(g));
kayitEt('tutanak:vegayaYaz', async (g, k) => {
  const t = await tutanak.tutanakGetir({ id: g.id });
  if (t.vegayaYazildi) throw new Error('Bu tutanak zaten Vega\'ya yazılmış.');
  return yazma.tutanakFisiYaz({
    firma: t.firma,
    donem: t.donem,
    depo: t.depo,
    tutanakId: t.id,
    dusenStokNo: t.dusenStokNo,
    dusenMiktar: t.dusenMiktar,
    artanStokNo: t.artanStokNo,
    artanMiktar: t.artanMiktar,
    sebep: t.sebep,
    kullanici: k.kullanici
  });
});
kayitEt('tutanak:vegadanGeriAl', async (g, k) => {
  const t = await tutanak.tutanakGetir({ id: g.id });
  if (!t.vegayaYazildi || !t.fisler) {
    throw new Error('Bu tutanak Vega\'ya yazılmamış, geri alınacak fiş yok.');
  }
  return yazma.tutanakFisiGeriAl({
    firma: t.firma,
    donem: t.donem,
    tutanakId: t.id,
    fisler: t.fisler,
    kullanici: k.kullanici
  });
});
kayitEt('tutanak:iptal', async (g, k) =>
  tutanak.tutanakIptal(Object.assign({}, g, { kullanici: k.kullanici }))
);

// Yazma kilidi
kayitEt('yazma:durum', async () => ({ acik: yazma.yazmaAcikMi() }));

// VegaWinA5 yardımcı programları
kayitEt('vegaprogram:durum', async () => vegaprogram.durum());
kayitEt('vegaprogram:ac', async (g, k) => vegaprogram.ac(g.program, k));

// Güncelleme
kayitEt('guncelleme:kontrol', async () => guncelleme.simdiKontrolEt());
kayitEt('guncelleme:durum', async () => guncelleme.durumAl());

// Yardımcılar
kayitEt('sistem:kullanici', async () => kim);
kayitEt('sistem:surum', async () => ({
  surum: app.getVersion(),
  kurulu: app.isPackaged
}));

kayitEt('sistem:yazdir', async () => {
  if (!pencere) return { tamam: false };
  pencere.webContents.print({ silent: false, printBackground: true });
  return { tamam: true };
});

kayitEt('sistem:klasorAc', async () => {
  shell.showItemInFolder(ayarlar.ayarYolu());
  return { tamam: true };
});

kayitEt('sistem:onay', async (g) => {
  const sonuc = await dialog.showMessageBox(pencere, {
    type: 'question',
    buttons: [g.evet || 'Evet', g.hayir || 'Vazgeç'],
    defaultId: 1,
    cancelId: 1,
    title: g.baslik || 'Onay',
    message: g.mesaj || '',
    detail: g.detay || ''
  });
  return { onay: sonuc.response === 0 };
});
