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
const yedek = require('./db/yedek');
const oturum = require('./db/oturum');
const zayi = require('./db/zayi');

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

// Yetki süzgeci.
//
// HİÇ KULLANICI TANIMLI DEĞİLSE kilit yoktur; program bugüne kadar nasıl
// çalışıyorsa öyle çalışır ve herkes yöneticidir. Kullanıcı tanımlandığı
// anda aşağıdaki üç katman devreye girer:
//
//   1. YONETICI_KANALLARI — yalnızca yönetici çağırabilir.
//   2. YETKI_KANALLARI    — kullanıcının o yetkisi işaretliyse çağrılabilir.
//   3. Yanıt süzme        — sayım ekranının teorik miktarı gibi alanlar
//                           role göre nesneden çıkarılır (gizlenmez,
//                           GÖNDERİLMEZ).
//
// Sayan kişi Vega'daki miktarı görürse çoğu zaman aynı sayıyı yazar ve
// sayım anlamını kaybeder; yönetici girişi yapılınca teorik miktar gelir.
const YONETICI_KANALLARI = new Set([
  'sayim:gecmis',        // fark tutarı ve farklı satır sayısı
  'sayim:detay',         // satır satır teorik / fark
  'sayim:bekleyenler',   // onay kuyruğu
  'sayim:onayla',        // sayımı Vega'ya işleyen tek uç
  'sayim:reddet',
  'sayim:vegayaYaz',
  'sayim:vegadanGeriAl',
  'sayim:iptal',
  'kullanici:liste',
  'kullanici:kaydet',
  'kullanici:sil',
  'oturum:pinBelirle',
  'oturum:pinKaldir',
  'ayar:yaz',
  'stok:pasifYap',
  // Geri yükleme veritabanını yedeğin alındığı ana döndürür ve aradaki her
  // şeyi siler; panelde geri dönüşü olmayan tek iş budur.
  'yedek:geriYukle'
]);

// Kanal → gereken yetki anahtarı. Yönetici hepsini geçer.
const YETKI_KANALLARI = {
  'sayim:ekran': 'sayim',
  'sayim:kaydet': 'sayim',
  'sayim:liste': 'sayim',
  'sayim:listeyeEkle': 'sayim',
  'sayim:topluEkle': 'sayim',
  'sayim:listedenCikar': 'sayim',
  'sayim:listeyiBosalt': 'sayim',
  'zayi:kaydet': 'zayi',
  'zayi:liste': 'zayi',
  'zayi:satirDokumu': 'zayi',
  'zayi:getir': 'zayi',
  'zayi:sil': 'zayi',
  'zayi:cariler': 'zayi',
  'zayi:vegayaYaz': 'zayi',
  'zayi:vegadanGeriAl': 'zayi',
  'uretim:sifirAdaylari': 'uretim',
  'uretim:urunAra': 'uretim',
  'uretim:sifiraKadar': 'uretim',
  'uretim:hepsiniSifirla': 'uretim',
  'uretim:fireli': 'uretim',
  'uretim:gecmis': 'uretim',
  'uretim:geriAl': 'uretim',
  // Sayım ekranındaki sınıflandırma süzgeçlerinin seçenekleri. Stok
  // ekranının aynı listesi `stok` yetkisine bağlı; sayımcıya o yetki
  // verilmediği için ayrı bir uç açıldı.
  'sayim:kodListeleri': 'sayim',
  'stok:durum': 'stok',
  'stok:kontrol': 'stok',
  'stok:ara': 'stok',
  'stok:hareket': 'stok',
  'cari:bakiye': 'stok',
  'cari:ara': 'stok'
};

// VEGADB'ye YAZAN kanallar. Bu listedeki bir kanal çağrılmadan ÖNCE
// otomatik yedek alınıyor (db/yedek.js → islemOncesiYedek).
//
// Müşterinin isteği: "işlemden önce yedeği alacak, eğer işlemi yanlış
// yaparsa anında geri dönebilmeli." Yedek diferansiyel olduğu için işlem
// başına ~60 milisaniye sürüyor; kullanıcı beklediğini fark etmiyor.
//
// Geri alma uçları da (`…GeriAl`, `…vegadanGeriAl`) listede: geri alma da
// bir yazma işlemidir ve yanlış kaydı geri almak da bir hatadır.
//
// 'yedek:geriYukle' burada YOK — kendi güvenlik yedeğini zaten alıyor.
const YAZAN_KANALLAR = new Set([
  'sayim:onayla',
  'sayim:vegayaYaz',
  'sayim:vegadanGeriAl',
  'zayi:vegayaYaz',
  'zayi:vegadanGeriAl',
  'alisFatura:vegayaYaz',
  'alisFatura:vegadanGeriAl',
  'tutanak:kaydet',
  'tutanak:vegayaYaz',
  'tutanak:vegadanGeriAl',
  'uretim:sifiraKadar',
  'uretim:hepsiniSifirla',
  'uretim:fireli',
  'uretim:geriAl',
  'gider:sifirla',
  'gider:geriAl',
  'maliyet:yaz',
  'maliyet:geriAl',
  'third:vegayaYaz',
  'recete:olustur',
  'recete:satirEkle',
  'recete:satirGuncelle',
  'recete:satirSil',
  'stok:pasifYap'
]);

// Kanal adlarının kullanıcıya gösterilecek karşılığı. Geri dönüş noktaları
// listesinde "uretim:fireli" değil "Fireli üretim" yazsın diye.
const KANAL_ADLARI = {
  'sayim:onayla': 'Sayım onayı',
  'sayim:vegayaYaz': "Sayımı Vega'ya yazma",
  'sayim:vegadanGeriAl': 'Sayımı geri alma',
  'zayi:vegayaYaz': "Zayi fişini Vega'ya yazma",
  'zayi:vegadanGeriAl': 'Zayi fişini geri alma',
  'alisFatura:vegayaYaz': "Alış faturasını Vega'ya yazma",
  'alisFatura:vegadanGeriAl': 'Alış faturasını geri alma',
  'tutanak:kaydet': 'Tutanak kaydı',
  'tutanak:vegayaYaz': "Tutanağı Vega'ya yazma",
  'tutanak:vegadanGeriAl': 'Tutanağı geri alma',
  'uretim:sifiraKadar': 'Sıfıra kadar üretim',
  'uretim:hepsiniSifirla': 'Toplu sıfırlama üretimi',
  'uretim:fireli': 'Fireli üretim',
  'uretim:geriAl': 'Üretimi geri alma',
  'gider:sifirla': 'Gider stoğu sıfırlama',
  'gider:geriAl': 'Gider sıfırlamasını geri alma',
  'maliyet:yaz': 'Maliyet yazma',
  'maliyet:geriAl': 'Maliyeti geri alma',
  'third:vegayaYaz': "THIRD işaretini Vega'ya yazma",
  'recete:olustur': 'Reçete oluşturma',
  'recete:satirEkle': 'Reçeteye satır ekleme',
  'recete:satirGuncelle': 'Reçete satırı güncelleme',
  'recete:satirSil': 'Reçete satırı silme',
  'stok:pasifYap': 'Stok kartını pasife alma'
};

// İşlem öncesi yedek. Alınamazsa işlem HİÇ BAŞLAMIYOR.
//
// Bu bilinçli: güvenlik ağı yokken Vega'ya yazmak, yanlış bir işlemi geri
// dönülemez hâle getirir. Yedeksiz çalışmak isteyen kullanıcı ayarlardan
// `islemOncesiYedek` bayrağını kapatabiliyor.
async function islemOncesiYedekAl(kanal, kimlik) {
  const a = ayarlar.ayarOku();
  if (a.islemOncesiYedek === false) return null;
  // Yazma kapalıyken VEGADB'ye zaten tek satır gitmiyor; yedek de gereksiz.
  if (!yazma.yazmaAcikMi()) return null;

  try {
    return await yedek.islemOncesiYedek({
      islem: KANAL_ADLARI[kanal] || kanal,
      kullanici: kimlik.kullanici
    });
  } catch (e) {
    const hata = new Error(
      'İşlem öncesi yedek alınamadı, işlem yapılmadı: ' + (e.message || e) +
      ' — Yedekleme merkezinden sebebini görebilir, ya da Ayarlar ekranından ' +
      '"işlem öncesi yedek" seçeneğini kapatabilirsiniz (önerilmez).'
    );
    hata.kod = 'YEDEK_ALINAMADI';
    throw hata;
  }
}

function kayitEt(kanal, isFn) {
  ipcMain.handle(kanal, async (olay, girdi) => {
    try {
      let o;
      try {
        o = await oturum.oturumAl();
      } catch (e) {
        // Panel veritabanı okunamadı: kullanıcı tanımlı mı bilinemez.
        // Program kendini kilitlemesin.
        o = { rol: oturum.YONETICI, kullaniciAdi: null, yetkiler: {} };
      }

      const yoneticiMi = o.rol === oturum.YONETICI;
      if (!yoneticiMi && YONETICI_KANALLARI.has(kanal)) {
        return yetkisizCevap();
      }
      const gereken = YETKI_KANALLARI[kanal];
      if (!yoneticiMi && gereken && !(o.yetkiler && o.yetkiler[gereken])) {
        return yetkisizCevap(gereken);
      }

      // İşlem günlüğüne Windows kullanıcısı değil, giriş yapmış kişi düşsün.
      const kimlik = o.kullaniciAdi
        ? Object.assign({}, kim, { kullanici: o.kullaniciAdi, windows: kim.kullanici })
        : kim;

      // YETKİ DENETİMİNDEN SONRA, işten ÖNCE. Yetkisiz bir istek yüzünden
      // boşuna yedek alınmıyor; yetkili istek ise yedeksiz çalışmıyor.
      let yedekBilgisi = null;
      if (YAZAN_KANALLAR.has(kanal)) {
        yedekBilgisi = await islemOncesiYedekAl(kanal, kimlik);
      }

      const veri = await isFn(girdi || {}, kimlik, o);
      // Arayüz "geri dönebilirsiniz" diyebilsin diye yedek bilgisi yanıtta.
      if (yedekBilgisi && veri && typeof veri === 'object' && !Array.isArray(veri)) {
        veri.islemOncesiYedek = {
          dosya: yedekBilgisi.dosya,
          temelDosya: yedekBilgisi.temelDosya
        };
      }
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

const YETKI_ADLARI = {
  sayim: 'sayım',
  tamSayim: 'tam sayım',
  zayi: 'zayi girişi',
  uretim: 'üretim',
  stok: 'stok ve cari görüntüleme'
};

function yetkisizCevap(gereken) {
  return {
    tamam: false,
    mesaj: gereken
      ? `Bu iş için "${YETKI_ADLARI[gereken] || gereken}" yetkiniz yok. ` +
        'Yöneticinize başvurun ya da sağ üstten yönetici PIN\'iyle girin.'
      : 'Bunu görmek için yönetici girişi gerekiyor. Sağ üstteki "Giriş" düğmesini kullanın.',
    kod: 'YETKISIZ'
  };
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
  const tam = ayarlar.ayarOku();
  const a = Object.assign({}, tam);
  delete a.sifre; // şifre arayüze gönderilmez
  a.sifreVar = !!tam.sifre;
  a.dosyaYolu = ayarlar.ayarYolu();
  return a;
});

kayitEt('ayar:yaz', async (girdi) => {
  const yeni = Object.assign({}, girdi);
  if (yeni.sifre === '' || yeni.sifre == null) delete yeni.sifre; // boşsa mevcudu koru
  const sonuc = ayarlar.ayarYaz(yeni);
  await sql.havuzKapat();
  firma.onbellekTemizle();
  oturum.onbellekTemizle(); // başka bir panel veritabanına geçilmiş olabilir
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
// --- Yedekleme merkezi ---------------------------------------------------
//
// Yedek dosyası SUNUCUDA oluşur; BACKUP komutunu SQL Server servisi
// çalıştırır. Ayrıntı ve yetki: kurulum/sql-yedek-yetkisi-ver.sql
//
// 'yedek:geriYukle' YONETICI_KANALLARI içinde: veritabanını yedeğin alındığı
// ana döndürür, aradaki her şeyi siler.
kayitEt('yedek:durum', async () => yedek.durum());
kayitEt('yedek:liste', async (g) => yedek.liste(g));
kayitEt('yedek:hatirlatma', async () => yedek.hatirlatma());
// Geri dönüş noktaları: hangi işlemden önceye dönülebilir.
kayitEt('yedek:donusNoktalari', async (g) => yedek.donusNoktalari(g));
kayitEt('yedek:al', async (g, k) =>
  yedek.yedekAl(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('yedek:geriYukle', async (g, k) =>
  yedek.geriYukle(Object.assign({}, g, { kullanici: k.kullanici }))
);

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

// Üretim. İki yol:
//   sıfıra kadar — stoğu EKSİYE düşmüş, reçeteli ürün sıfıra çekilir.
//                  Zayi fişi kesmez; zayiat "Zayi / personel çıkışı"
//                  ekranında yazılır, burası yalnızca üretir.
//   fireli       — hammadde fire vermiştir ("10 kg ham somondan 3 kg somon").
//                  Fire varsa önce zayi fişi, sonra üretim.
//
// Zayiatlı üretim (zayi fişi + sıfıra çekme, tek düğmede) 25.08.2026'da
// kaldırıldı; iki ayrı iş tek düğmeye biniyordu. Otomatik üretim de
// 22.08.2026'da kaldırılmıştı, yerine bu sıfıra kadar üretim geldi.
kayitEt('uretim:sifirAdaylari', async (g) => uretim.sifirAdaylari(g));
kayitEt('uretim:urunAra', async (g) => uretim.urunAra(g));
kayitEt('uretim:sifiraKadar', async (g, k) =>
  uretim.sifiraKadarUret(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('uretim:hepsiniSifirla', async (g, k) =>
  uretim.hepsiniSifirla(Object.assign({}, g, { kullanici: k.kullanici }))
);

// Fireli üretim fire varsa zayi fişi DE kesiyor; iki yetki birden isteniyor.
// YETKI_KANALLARI tek anahtar taşıdığı için ikincisi burada denetleniyor.
function zayiYetkisiIste(o, isim) {
  if (o.rol !== oturum.YONETICI && !(o.yetkiler && o.yetkiler.zayi)) {
    const e = new Error(
      `${isim} zayi fişi de kesiyor; "zayi girişi" yetkiniz yok. ` +
      'Yöneticinize başvurun.'
    );
    e.kod = 'YETKISIZ';
    throw e;
  }
}

kayitEt('uretim:fireli', async (g, k, o) => {
  // Fire girilmemişse zayi fişi hiç kesilmiyor; yetki de yalnızca fire
  // varken isteniyor.
  const fireVar = (Array.isArray(g.hammaddeler) ? g.hammaddeler : []).some(
    (h) => Number(h && h.fire) > 0
  );
  if (fireVar) zayiYetkisiIste(o, 'Fireli üretim');
  return uretim.fireliUret(Object.assign({}, g, { kullanici: k.kullanici }));
});
kayitEt('uretim:gecmis', async (g) => uretim.gecmis(g));
kayitEt('uretim:geriAl', async (g, k) =>
  uretim.geriAl(Object.assign({}, g, { kullanici: k.kullanici }))
);

// Zayi / personel çıkışı
//
// Fatura gibi önce panelde taslak durur, Vega'ya yazma ayrı bir onayla olur.
// Vega karşılığı stok çıkış fişi (33) + seçilen carinin borç hareketi.
kayitEt('zayi:cariler', async (g) => zayi.cariler(g));
kayitEt('zayi:kaydet', async (g, k) =>
  zayi.taslakKaydet(Object.assign({}, g, { duzenleyen: g.duzenleyen || k.kullanici }))
);
kayitEt('zayi:liste', async (g) => zayi.liste(g));
// Ayrıntılı Excel için satır dökümü: her fişin her kalemi ayrı satır.
kayitEt('zayi:satirDokumu', async (g) => zayi.satirDokumu(g));
kayitEt('zayi:getir', async (g) => zayi.getir(g));
kayitEt('zayi:sil', async (g, k) =>
  zayi.sil(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('zayi:vegayaYaz', async (g, k) => {
  const z = await zayi.getir({ id: g.id });
  if (z.vegayaYazildi) throw new Error("Bu zayi fişi zaten Vega'ya yazılmış.");
  return yazma.zayiFisiYaz({
    firma: z.firma,
    donem: z.donem,
    depo: z.depo,
    zayiId: z.id,
    cariNo: z.cariNo,
    cariAdi: z.cariAdi,
    altHesap: z.altHesap,
    sebep: z.sebep,
    tarih: z.tarih,
    maliyetliMi: z.maliyetliMi,
    satirlar: z.satirlar,
    kullanici: k.kullanici
  });
});
kayitEt('zayi:vegadanGeriAl', async (g, k) => {
  const z = await zayi.getir({ id: g.id });
  if (!z.vegayaYazildi || !z.vegaBelgeInd) {
    throw new Error("Bu zayi fişi Vega'ya yazılmamış, geri alınacak belge yok.");
  }
  return yazma.zayiFisiGeriAl({
    firma: z.firma,
    donem: z.donem,
    zayiId: z.id,
    baslikInd: z.vegaBelgeInd,
    kullanici: k.kullanici
  });
});

// Stok kartını pasife alma (KOD8 = 'PASİF'). Firmanın kendi işareti;
// pasif kartlar listelerde ve sayım föylerinde görünmez.
kayitEt('stok:pasifYap', async (g, k) =>
  yazma.stokPasifYap(Object.assign({}, g, { kullanici: k.kullanici }))
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
// Sayım süzgeçlerinin seçenekleri (firmanın kendi TBLSTOKKODTAN tanımları).
kayitEt('sayim:kodListeleri', async (g) => vega.stokKodListeleri(g));
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
// Körleme sayım. Sayan kişi Vega'daki miktarı görürse çoğu zaman aynı sayıyı
// yazar ve sayım anlamını kaybeder. Bu yüzden teorik miktar ve birim maliyet
// yalnızca yönetici girişi yapılmışsa arayüze gönderilir; yoksa alanlar
// nesneden tamamen çıkarılır (gizlemek değil, göndermemek).
//
// Kapsam (hangi sınıflar sayılabilir) ARAYÜZDEN GELMEZ, oturumdan okunur.
// Aksi hâlde bar sayma yetkisi olan kişi isteği kurcalayıp mutfağı da
// listeleyebilirdi.
kayitEt('sayim:ekran', async (g, k, o) => {
  const yoneticiMi = o.rol === oturum.YONETICI;
  const tur = String(g.tur || 'ara') === 'tam' ? 'tam' : 'ara';
  if (tur === 'tam' && !yoneticiMi && !(o.yetkiler && o.yetkiler.tamSayim)) {
    const e = new Error('Tam sayım yetkiniz yok. Ara sayım yapabilirsiniz.');
    e.kod = 'YETKISIZ';
    throw e;
  }

  const siniflar = await oturum.kapsamAl();
  // Sınıflandırma süzgeçleri (kod1…kod10) arayüzden gelir ve yalnızca
  // listeyi DARALTIR. Kapsam (siniflar) oturumdan gelir ve süzgeç onu
  // genişletemez — ikisi AND'lenerek uygulanıyor.
  //
  // Stok durumu süzgeci (eksi / sıfır / dolu) Vega'daki miktara bakıyor;
  // körleme sayımda sayan kişiye açık olsaydı "eksileri göster" diyerek
  // gizlenen miktarı öğrenirdi. Yalnızca yöneticide çalışıyor.
  const istek = Object.assign({}, g, { tur, siniflar });
  if (!yoneticiMi) delete istek.stokDurumu;
  const liste = await sayim.sayimEkraniGetir(istek);
  if (yoneticiMi) return liste;
  return liste.map((s) => ({
    stokNo: s.stokNo,
    stokAdi: s.stokAdi,
    stokKodu: s.stokKodu,
    sinif: s.sinif,
    birim: s.birim
  }));
});
// Sayım kaydedilir kaydedilmez Vega'ya YAZILMAZ.
//
// Müşterinin isteği: sayımı çalışan yapar, yönetici bakar, doğruysa onaylar
// ve ancak o zaman fiş kesilir. Yanlış sayılmış bir kalem böylece Vega'nın
// stok zincirine hiç dokunmadan düzeltilebiliyor.
//
// Onaylama ucu: sayim:onayla (yalnızca yönetici).
kayitEt('sayim:kaydet', async (g, k, o) => {
  const yoneticiMi = o.rol === oturum.YONETICI;
  const tur = String(g.tur || 'ara') === 'tam' ? 'tam' : 'ara';
  if (tur === 'tam' && !yoneticiMi && !(o.yetkiler && o.yetkiler.tamSayim)) {
    const e = new Error('Tam sayım yetkiniz yok.');
    e.kod = 'YETKISIZ';
    throw e;
  }

  const siniflar = await oturum.kapsamAl();
  const sonuc = await sayim.sayimKaydet(
    Object.assign({}, g, { tur, siniflar, sayan: g.sayan || k.kullanici })
  );

  // Kayıttan SONRA çıkan fark özeti de sayımcıya gitmiyor; yoksa sayımcı
  // rastgele bir sayı yazıp "fark kaç çıktı" diye deneyerek teorik miktarı
  // aramalı olarak bulabilir.
  if (yoneticiMi) return sonuc;
  const suzulmus = Object.assign({}, sonuc);
  for (const alan of ['artan', 'azalan', 'farkliSatir', 'farkTutari']) {
    delete suzulmus[alan];
  }
  return suzulmus;
});

// Onay. Sayımı Vega'ya işleyen tek yer burası.
kayitEt('sayim:bekleyenler', async (g) => sayim.bekleyenler(g));
kayitEt('sayim:reddet', async (g, k) =>
  sayim.sayimReddet(Object.assign({}, g, { onaylayan: k.kullanici }))
);
kayitEt('sayim:onayla', async (g, k) => {
  await sayim.onayIsaretle({ sayimId: g.sayimId, onaylayan: k.kullanici });

  if (g.vegayaYaz === false || !yazma.yazmaAcikMi()) {
    return { tamam: true, onaylandi: true, vegayaYazildi: false };
  }

  try {
    const fis = await yazma.sayimFisiYaz({
      firma: g.firma,
      donem: g.donem,
      sayimId: g.sayimId,
      kullanici: k.kullanici
    });
    return {
      tamam: true,
      onaylandi: true,
      vegayaYazildi: !fis.yazilmadi,
      farkYok: !!fis.yazilmadi,
      belgeNo: fis.belgeNo || null,
      girisBelgeNo: fis.girisBelgeNo || null,
      cikisBelgeNo: fis.cikisBelgeNo || null,
      artan: fis.artan || 0,
      azalan: fis.azalan || 0
    };
  } catch (e) {
    // Onay duruyor, yalnızca fiş kesilemedi; yönetici listeden tekrar
    // deneyebilsin diye hata yutulmuyor.
    return {
      tamam: true,
      onaylandi: true,
      vegayaYazildi: false,
      yazmaHatasi: e.message || String(e)
    };
  }
});
kayitEt('sayim:vegayaYaz', async (g, k) =>
  yazma.sayimFisiYaz(Object.assign({}, g, { kullanici: k.kullanici }))
);
kayitEt('sayim:vegadanGeriAl', async (g, k) =>
  yazma.sayimFisiGeriAl(Object.assign({}, g, { kullanici: k.kullanici }))
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

// Oturum / yetki
//
// Giriş yalnızca PIN'le: kullanıcı isim seçmez, PIN'i kimse o kişi olarak
// girer. Windows kullanıcı adı sadece kayıt tutmak için kullanılıyor.
kayitEt('oturum:durum', async (g, k) => oturum.durumAl(k));
kayitEt('oturum:giris', async (g, k) => oturum.giris(g, k));
kayitEt('oturum:cikis', async (g, k) => oturum.cikis(g, k));
// Aşağıdakiler yönetici kanalı listesinde; yalnızca yönetici çağırabilir.
kayitEt('oturum:pinBelirle', async (g, k) => oturum.pinBelirle(g, k));
kayitEt('oturum:pinKaldir', async (g, k) => oturum.pinKaldir(g, k));

// Kullanıcı yönetimi (yönetici paneli)
kayitEt('kullanici:liste', async () => oturum.kullaniciListesi());
kayitEt('kullanici:kaydet', async (g, k) => oturum.kullaniciKaydet(g, k));
kayitEt('kullanici:sil', async (g, k) => oturum.kullaniciSil(g, k));

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
