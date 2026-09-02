'use strict';

// Ana süreçte kayıtlı her IPC kanalı yetki bakımından açıkça sınıflanmalı.
// Yeni kanal eklenip haritaya unutulursa bu test kırılır.
const fs = require('fs');
const path = require('path');
const {
  YETKILER,
  YONETICI_KANALLARI,
  ACIK_KANALLAR,
  KANAL_YETKILERI,
  kullaniciYetkiliMi
} = require('../db/yetki');

const anahtarlar = new Set(YETKILER.map((y) => y.anahtar));
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const kanallar = [...main.matchAll(/kayitEt\('([^']+)'/g)].map((m) => m[1]);
let hata = 0;

function kontrol(ad, kosul, ayrinti) {
  if (kosul) {
    console.log('  OK   ' + ad);
  } else {
    hata++;
    console.log('  HATA ' + ad + (ayrinti ? ' -> ' + ayrinti : ''));
  }
}

const sinifsiz = kanallar.filter(
  (k) => !KANAL_YETKILERI[k] && !YONETICI_KANALLARI.has(k) && !ACIK_KANALLAR.has(k)
);
kontrol('Bütün IPC kanalları sınıflandırılmış', sinifsiz.length === 0, sinifsiz.join(', '));

const olmayan = Object.entries(KANAL_YETKILERI).flatMap(([kanal, gereken]) =>
  (Array.isArray(gereken) ? gereken : [gereken])
    .filter((anahtar) => !anahtarlar.has(anahtar))
    .map((anahtar) => kanal + ': ' + anahtar)
);
kontrol('Kanal haritasındaki bütün yetkiler tanımlı', olmayan.length === 0, olmayan.join(', '));

const fazla = Object.keys(KANAL_YETKILERI).filter((k) => !kanallar.includes(k));
kontrol('Haritada artık var olmayan kanal yok', fazla.length === 0, fazla.join(', '));

kontrol('Tek yetki kabul ediliyor', kullaniciYetkiliMi({ stok: true }, 'stok'));
kontrol('Eksik tek yetki reddediliyor', !kullaniciYetkiliMi({}, 'stok'));
kontrol(
  'Ortak kanalda yetkilerden biri yeterli',
  kullaniciYetkiliMi({ tutanak: true }, ['stok', 'tutanak'])
);
kontrol(
  'Ortak kanalda bütün yetkiler eksikse reddediliyor',
  !kullaniciYetkiliMi({ cari: true }, ['stok', 'tutanak'])
);

console.log(`\nSonuç: ${hata ? hata + ' hatalı' : 'tüm kontroller başarılı'}\n`);
process.exit(hata ? 1 : 0);
