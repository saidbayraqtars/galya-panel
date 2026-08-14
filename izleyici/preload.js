'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const kanallar = [
  'durum',
  'baslat',
  'durdur',
  'kaldir',
  'oku',
  'kaydet',
  'dosyaAc',
  'onay'
];

contextBridge.exposeInMainWorld('izleyici', {
  cagir: (kanal, girdi) => {
    if (!kanallar.includes(kanal)) {
      return Promise.resolve({ tamam: false, mesaj: 'Bilinmeyen işlem: ' + kanal });
    }
    return ipcRenderer.invoke(kanal, girdi);
  }
});
