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
  },
  sefim: {
    sabitYol: 'C:\\Program Files (x86)\\Vega\\Sefim\\Sef.exe',
    ad: 'Vega Şefim',
    aciklama: 'Vega Şefim programını Windows yöneticisi olarak açar',
    yoneticiOlarak: true
  }
};

function programYolu(anahtar) {
  const tanim = PROGRAMLAR[anahtar];
  if (!tanim) throw new Error('Tanımsız program: ' + anahtar);
  const kok = ayarOku().vegaKlasoru || 'C:\\VegaWinA5';
  // Şefim her bilgisayarda sabit yerde. Diğer Vega programları ayardaki
  // kökte veya Bin klasöründe aranır.
  const adaylar = tanim.sabitYol
    ? [tanim.sabitYol]
    : [path.join(kok, 'Bin', tanim.dosya), path.join(kok, tanim.dosya)];
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
  let surec;
  if (tanim.yoneticiOlarak) {
    // Sabit, beyaz listedeki yol dışında hiçbir metin PowerShell'e girmez.
    // -Verb RunAs Windows UAC penceresini açar.
    const kacisliYol = yol.replace(/'/g, "''");
    const kacisliKlasor = path.dirname(yol).replace(/'/g, "''");
    const komut =
      `Start-Process -FilePath '${kacisliYol}' ` +
      `-WorkingDirectory '${kacisliKlasor}' -Verb RunAs`;
    surec = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', komut], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
  } else {
    surec = spawn(yol, [], {
      cwd: path.dirname(yol),
      detached: true,
      stdio: 'ignore'
    });
  }
  surec.unref();

  await panel.kayit(
    'Vega Programı',
    tanim.ad + ' açıldı',
    { yol, yoneticiOlarak: !!tanim.yoneticiOlarak },
    kim && kim.kullanici,
    kim && kim.bilgisayar
  );
  return { tamam: true, ad: tanim.ad, yol };
}

module.exports = { ac, durum, PROGRAMLAR };
