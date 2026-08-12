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
  'stok:ara',
  'stok:hareket',
  'recete:mamuller',
  'recete:agac',
  'third:adaylar',
  'third:isaretliler',
  'third:isaretle',
  'third:vegayaYaz',
  'maliyet:eskiyenler',
  'cari:bakiye',
  'fatura:bekleyen',
  'fatura:eslesmeler',
  'satis:aktarimDurumu',
  'satis:ozet',
  'satis:eslestirmeDurumu',
  'satis:eslestirmeKaydet',
  'satis:oneri',
  'satis:tuketim',
  'sayim:liste',
  'sayim:listeyeEkle',
  'sayim:listedenCikar',
  'sayim:ekran',
  'sayim:kaydet',
  'sayim:gecmis',
  'sayim:detay',
  'sayim:iptal',
  'tutanak:kaydet',
  'tutanak:liste',
  'tutanak:iptal',
  'yazma:durum',
  'guncelleme:kontrol',
  'guncelleme:durum',
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
