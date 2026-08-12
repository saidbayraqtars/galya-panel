'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const kanallar = ['ayar:oku', 'baglan', 'baslat', 'durum', 'durdur', 'kaydet', 'dosyaGoster'];

contextBridge.exposeInMainWorld('izleyici', {
  cagir: (kanal, girdi) => {
    if (!kanallar.includes(kanal)) {
      return Promise.resolve({ tamam: false, mesaj: 'Bilinmeyen işlem: ' + kanal });
    }
    return ipcRenderer.invoke(kanal, girdi);
  },
  ilerleme: (isFn) => ipcRenderer.on('ilerleme', (olay, sayi) => isFn(sayi))
});
