'use strict';

// VegaWinA5 kurulumundaki yardımcı programları panelden açmak için.
// Şimdilik sayım programı kullanılıyor; liste ihtiyaca göre büyütülebilir.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ayarOku } = require('./ayar');
const panel = require('./panel');

// Panelden açılmasına izin verilen programlar. Buraya yazılmayan hiçbir şey
// çalıştırılmaz — arayüzden gelen serbest metin asla komut olarak kullanılmaz.
const PROGRAMLAR = {
  sayim: {
    dosya: 'sayim.exe',
    ad: 'Vega Sayım',
    aciklama: 'VegaWinA5 ile gelen sayım programı'
  },
  stokSorgula: {
    dosya: 'StokSorgula.exe',
    ad: 'Stok Sorgulama',
    aciklama: 'VegaWinA5 stok sorgulama'
  },
  vegawin: {
    dosya: 'vegawinA5.exe',
    ad: 'VegaWinA5',
    aciklama: 'Ana Vega programı'
  }
};

function programYolu(anahtar) {
  const tanim = PROGRAMLAR[anahtar];
  if (!tanim) throw new Error('Tanımsız program: ' + anahtar);
  const kok = ayarOku().vegaKlasoru || 'C:\\VegaWinA5';
  // Ana program kökte, yardımcılar Bin klasöründe durur.
  const adaylar = [path.join(kok, 'Bin', tanim.dosya), path.join(kok, tanim.dosya)];
  for (const y of adaylar) {
    if (fs.existsSync(y)) return { yol: y, tanim };
  }
  return { yol: null, tanim, aranan: adaylar };
}

function durum() {
  const sonuc = {};
  for (const anahtar of Object.keys(PROGRAMLAR)) {
    const { yol, tanim } = programYolu(anahtar);
    sonuc[anahtar] = { ad: tanim.ad, aciklama: tanim.aciklama, var: !!yol, yol: yol || null };
  }
  return sonuc;
}

async function ac(anahtar, kim) {
  const { yol, tanim, aranan } = programYolu(anahtar);
  if (!yol) {
    throw new Error(
      `${tanim.ad} bulunamadı. Aranan yerler: ${(aranan || []).join(' , ')}. ` +
      'Vega klasörü farklıysa Ayarlar ekranından düzeltin.'
    );
  }
  const surec = spawn(yol, [], {
    cwd: path.dirname(yol),
    detached: true,
    stdio: 'ignore'
  });
  surec.unref();

  await panel.kayit(
    'Vega Programı',
    tanim.ad + ' açıldı',
    { yol },
    kim && kim.kullanici,
    kim && kim.bilgisayar
  );
  return { tamam: true, ad: tanim.ad, yol };
}

module.exports = { ac, durum, PROGRAMLAR };
