'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const kanallar = [
  'ayar:oku',
  'ayar:yaz',
  'baglanti:test',
  'panel:kur',
  'firma:liste',
  'depo:liste',
  'ozet:anaEkran',
  'stok:durum',
  'stok:kontrol',
  'stok:ara',
  'stok:kodListeleri',
  'stok:hareket',
  'gider:liste',
  'gider:sifirla',
  'gider:geriAl',
  'rapor:excel',
  'rapor:pdf',
  'rapor:ac',
  'recete:mamuller',
  'recete:agac',
  'recete:satirlar',
  'recete:olustur',
  'recete:satirEkle',
  'recete:satirGuncelle',
  'recete:satirSil',
  'third:adaylar',
  'third:isaretliler',
  'third:isaretle',
  'third:vegayaYaz',
  'maliyet:eskiyenler',
  'maliyet:hesapla',
  'maliyet:yaz',
  'maliyet:gecmis',
  'maliyet:geriAl',
  'maliyet:mamul',
  'uretim:adaylar',
  'uretim:uretilebilirler',
  'uretim:uret',
  'uretim:zayiatli',
  'uretim:hepsiniUret',
  'uretim:gecmis',
  'uretim:geriAl',
  'zayi:cariler',
  'zayi:kaydet',
  'zayi:liste',
  'zayi:getir',
  'zayi:sil',
  'zayi:vegayaYaz',
  'zayi:vegadanGeriAl',
  'stok:pasifYap',
  'cari:bakiye',
  'cari:ara',
  'fatura:bekleyen',
  'fatura:eslesmeler',
  'alisFatura:kaydet',
  'alisFatura:liste',
  'alisFatura:getir',
  'alisFatura:sil',
  'alisFatura:vegayaYaz',
  'alisFatura:vegadanGeriAl',
  'satis:aktarimDurumu',
  'satis:eslestirmeDurumu',
  'satis:eslestirmeKaydet',
  'satis:oneri',
  'sayim:liste',
  'sayim:listeyeEkle',
  'sayim:topluEkle',
  'sayim:listedenCikar',
  'sayim:listeyiBosalt',
  'sayim:ekran',
  'sayim:kaydet',
  'sayim:vegayaYaz',
  'sayim:vegadanGeriAl',
  'sayim:gecmis',
  'sayim:detay',
  'sayim:iptal',
  'sayim:bekleyenler',
  'sayim:onayla',
  'sayim:reddet',
  'tutanak:kaydet',
  'tutanak:liste',
  'tutanak:vegayaYaz',
  'tutanak:vegadanGeriAl',
  'tutanak:iptal',
  'tutanak:belgePdf',
  'tutanak:belgeYazdir',
  'yazma:durum',
  'vegaprogram:durum',
  'vegaprogram:ac',
  'guncelleme:kontrol',
  'guncelleme:durum',
  'oturum:durum',
  'oturum:giris',
  'oturum:cikis',
  'oturum:pinBelirle',
  'oturum:pinKaldir',
  'kullanici:liste',
  'kullanici:kaydet',
  'kullanici:sil',
  'sistem:kullanici',
  'sistem:surum',
  'sistem:yazdir',
  'sistem:klasorAc',
  'sistem:onay'
];

const api = {};
for (const kanal of kanallar) {
  api[kanal] = (girdi) => ipcRenderer.invoke(kanal, girdi);
}

// Ana süreçten arayüze gönderilen bildirimler
const dinlenebilir = ['guncelleme:durum'];

contextBridge.exposeInMainWorld('galya', {
  cagir: (kanal, girdi) => {
    if (!kanallar.includes(kanal)) {
      return Promise.resolve({ tamam: false, mesaj: 'Bilinmeyen işlem: ' + kanal });
    }
    return ipcRenderer.invoke(kanal, girdi);
  },
  dinle: (kanal, isFn) => {
    if (!dinlenebilir.includes(kanal)) return;
    ipcRenderer.on(kanal, (olay, veri) => isFn(veri));
  }
});
