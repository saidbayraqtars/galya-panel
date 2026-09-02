'use strict';

// Vega kurulumundaki beyaz listeli programları panelden açmak için.

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
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
    // Önceki fire-and-forget çağrı PowerShell sonucunu beklemeden başarı
    // dönüyor, UAC iptalini ve başlatma hatasını tamamen yutuyordu.
    const kacisliYol = yol.replace(/'/g, "''");
    const kacisliKlasor = path.dirname(yol).replace(/'/g, "''");
    const komut =
      `$ErrorActionPreference='Stop'; ` +
      `$p=Start-Process -FilePath '${kacisliYol}' ` +
      `-WorkingDirectory '${kacisliKlasor}' -Verb RunAs -PassThru; ` +
      `[Console]::Out.Write($p.Id)`;
    const pid = await yoneticiOlarakBaslat(komut);
    surec = { pid };
  } else {
    surec = spawn(yol, [], {
      cwd: path.dirname(yol),
      detached: true,
      stdio: 'ignore'
    });
  }
  if (surec.unref) surec.unref();

  await panel.kayit(
    'Vega Programı',
    tanim.ad + ' açıldı',
    { yol, yoneticiOlarak: !!tanim.yoneticiOlarak, pid: surec.pid || null },
    kim && kim.kullanici,
    kim && kim.bilgisayar
  );
  return { tamam: true, ad: tanim.ad, yol, pid: surec.pid || null };
}

function yoneticiOlarakBaslat(komut) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', komut],
      { windowsHide: true, timeout: 120000 },
      (hata, stdout, stderr) => {
        if (hata) {
          const ayrinti = String(stderr || hata.message || '').trim();
          const iptal = /cancel|iptal|1223/i.test(ayrinti + ' ' + (hata.code || ''));
          const e = new Error(
            iptal
              ? 'Windows yönetici onayı verilmedi; Şefim açılmadı.'
              : 'Şefim yönetici olarak başlatılamadı: ' + (ayrinti || hata.message)
          );
          e.kod = iptal ? 'UAC_IPTAL' : 'PROGRAM_ACILAMADI';
          reject(e);
          return;
        }
        const pid = Number(String(stdout || '').trim());
        if (!pid) {
          const e = new Error('Windows Şefim işlemini başlattı ancak işlem kimliği alınamadı.');
          e.kod = 'PROGRAM_ACILAMADI';
          reject(e);
          return;
        }
        resolve(pid);
      }
    );
  });
}

module.exports = { ac, durum, PROGRAMLAR };
