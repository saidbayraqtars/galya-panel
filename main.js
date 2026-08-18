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
const maliyet = require('./db/maliyet');
const alisFatura = require('./db/fatura');
const uretim = require('./db/uretim');

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
kayitEt('stok:kodListeleri', async (g) => vega.stokKodListeleri(g));
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

// Maliyetlendirme: hammaddede son alış fiyatı, mamulde reçeteden hesap.
// "yaz" ucu TBLSTOKLAR.MALIYET alanını günceller — Vega'nın kendi
// maliyetlendirmesinin yaptığı da budur.
kayitEt('maliyet:hesapla', async (g) => maliyet.hesapla(g));
kayitEt('maliyet:yaz', async (g, k) =>
  maliyet.yaz(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('maliyet:gecmis', async (g) => maliyet.gecmis(g));
kayitEt('maliyet:geriAl', async (g, k) =>
  maliyet.geriAl(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('maliyet:mamul', async (g) => maliyet.mamulMaliyeti(g));

// Üretim (stoğu sıfıra çeken üretim fişi)
kayitEt('uretim:adaylar', async (g) => uretim.adaylar(g));
kayitEt('uretim:uret', async (g, k) =>
  uretim.uret(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('uretim:hepsiniUret', async (g, k) =>
  uretim.hepsiniUret(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('uretim:gecmis', async (g) => uretim.gecmis(g));
kayitEt('uretim:geriAl', async (g, k) =>
  uretim.geriAl(Object.assign({}, g, { kullanici: k.kullanici }))
);

// Cari
kayitEt('cari:bakiye', async (g) => vega.cariBakiye(g));
kayitEt('cari:ara', async (g) => vega.cariAra(g));

// E-Fatura
kayitEt('fatura:bekleyen', async (g) => vega.bekleyenFaturalar(g));
kayitEt('fatura:eslesmeler', async (g) => vega.faturaUrunEslesmeleri(g));

// Alış faturası: panelde taslak olarak hazırlanır, ayrı onayla Vega'ya yazılır.
kayitEt('alisFatura:kaydet', async (g, k) =>
  alisFatura.taslakKaydet(Object.assign({}, g, { duzenleyen: g.duzenleyen || k.kullanici }))
);
kayitEt('alisFatura:liste', async (g) => alisFatura.taslakListesi(g));
kayitEt('alisFatura:getir', async (g) => alisFatura.taslakGetir(g));
kayitEt('alisFatura:sil', async (g, k) =>
  alisFatura.taslakSil(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('alisFatura:vegayaYaz', async (g, k) => {
  const f = await alisFatura.taslakGetir({ id: g.id });
  if (f.vegayaYazildi) throw new Error("Bu fatura zaten Vega'ya yazılmış.");
  return yazma.alisFaturasiYaz({
    firma: f.firma,
    donem: f.donem,
    depo: f.depo,
    faturaId: f.id,
    cariNo: f.cariNo,
    cariAdi: f.cariAdi,
    belgeNo: f.belgeNo,
    tarih: f.tarih,
    vadeTarihi: f.vadeTarihi,
    aciklama: f.aciklama,
    satirlar: f.satirlar,
    kullanici: k.kullanici
  });
});
kayitEt('alisFatura:vegadanGeriAl', async (g, k) => {
  const f = await alisFatura.taslakGetir({ id: g.id });
  if (!f.vegayaYazildi || !f.vegaBelgeInd) {
    throw new Error("Bu fatura Vega'ya yazılmamış, geri alınacak belge yok.");
  }
  let oncekiFiyatlar = [];
  try {
    oncekiFiyatlar = JSON.parse(f.oncekiFiyatlar || '[]');
  } catch (e) {
    oncekiFiyatlar = [];
  }
  return yazma.alisFaturasiGeriAl({
    firma: f.firma,
    donem: f.donem,
    faturaId: f.id,
    baslikInd: f.vegaBelgeInd,
    satirlar: oncekiFiyatlar,
    kullanici: k.kullanici
  });
});

// Şefim / satış aktarımı
kayitEt('satis:aktarimDurumu', async () => sefim.aktarimDurumu());
kayitEt('satis:eslestirmeDurumu', async (g) => sefim.eslestirmeDurumu(g));
kayitEt('satis:eslestirmeKaydet', async (g, k) =>
  sefim.eslestirmeKaydet(Object.assign({}, g, { kaydeden: k.kullanici }))
);
kayitEt('satis:oneri', async (g) => sefim.eslesmeOnerisi(g));

// Ara sayım
kayitEt('sayim:liste', async (g) => sayim.listeGetir(g));
kayitEt('sayim:listeyeEkle', async (g, k) =>
  sayim.listeyeEkle(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('sayim:topluEkle', async (g, k) =>
  sayim.topluEkle(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('sayim:listeyiBosalt', async (g, k) =>
  sayim.listeyiBosalt(Object.assign({}, g, { kullanici: k.kullanici }))
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
//
// Tutanak stok miktarını gerçekten değiştiren bir işlem: bir üründen düşer,
// diğerine ekler. Bu yüzden kayıt oluşur oluşmaz Vega'ya da yazılıyor
// (çıkış fişi −, giriş fişi +). Yazma kilidi kapalıysa kayıt yalnızca
// panelde kalır ve listede "Yazılmadı" görünür; kullanıcı sonra tek tuşla
// yazabilir.
kayitEt('tutanak:kaydet', async (g, k) => {
  const sonuc = await tutanak.tutanakKaydet(
    Object.assign({}, g, { duzenleyen: g.duzenleyen || k.kullanici })
  );

  if (g.vegayaYaz === false || !yazma.yazmaAcikMi()) {
    return Object.assign({}, sonuc, { vegayaYazildi: false });
  }

  const t = await tutanak.tutanakGetir({ id: sonuc.tutanakNo });
  try {
    const fis = await yazma.tutanakFisiYaz({
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
    return Object.assign({}, sonuc, {
      vegayaYazildi: true,
      cikisBelgeNo: fis.cikisBelgeNo,
      girisBelgeNo: fis.girisBelgeNo
    });
  } catch (e) {
    // Tutanak kaydı duruyor; sadece Vega'ya yazılamadı. Kullanıcı listeden
    // tekrar deneyebilsin diye hata yutulmuyor, mesaja ekleniyor.
    return Object.assign({}, sonuc, {
      vegayaYazildi: false,
      yazmaHatasi: e.message || String(e)
    });
  }
});
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
// Tutanak belgesi: imzalanacak A4 çıktı (PDF veya doğrudan yazıcı).
kayitEt('tutanak:belgePdf', async (g, k) => {
  const veri = await tutanak.tutanakBelgeVerisi({ id: g.id, imzalar: g.imzalar });
  return rapor.tutanakBelgesiKaydet(pencere, veri, k);
});
kayitEt('tutanak:belgeYazdir', async (g, k) => {
  const veri = await tutanak.tutanakBelgeVerisi({ id: g.id, imzalar: g.imzalar });
  return rapor.tutanakBelgesiYazdir(veri, k);
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
