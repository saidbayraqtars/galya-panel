'use strict';

const fs = require('fs');
const path = require('path');

const VARSAYILAN = {
  sunucu: 'localhost',
  port: 1433,
  windowsGirisi: false,
  kullanici: 'galya_panel',
  sifre: '',
  vegaVeritabani: 'VEGADB',
  sefimVeritabani: 'sefim',
  panelVeritabani: 'GALYA_PANEL',
  varsayilanFirma: 'F0102',
  varsayilanDonem: 'D0002',
  varsayilanDepo: 1,
  kritikStokAlt: 1,
  kritikStokUst: 5,
  aktifGun: 90,
  maliyetEskimeGun: 30,
  vegayaYazmaAktif: false
};

// Ayar dosyası nerede duruyor?
//   Kurulu programda : %APPDATA%\Galya Panel\ayarlar.json   (her bilgisayarın kendi ayarı)
//   Geliştirmede     : proje kökündeki ayarlar.json
// Kurulu programda dosya yoksa, kurulumla gelen ayarlar.ornek.json'dan kopyalanır.
let yolOnbellek = null;

function ayarYolu() {
  if (yolOnbellek) return yolOnbellek;

  let elektron = null;
  try {
    elektron = require('electron');
  } catch (e) {
    elektron = null;
  }

  const paketli = elektron && elektron.app && elektron.app.isPackaged;

  if (paketli) {
    const klasor = elektron.app.getPath('userData');
    const hedef = path.join(klasor, 'ayarlar.json');
    if (!fs.existsSync(hedef)) {
      try {
        fs.mkdirSync(klasor, { recursive: true });
        const ornek = path.join(process.resourcesPath, 'ayarlar.ornek.json');
        if (fs.existsSync(ornek)) fs.copyFileSync(ornek, hedef);
        else fs.writeFileSync(hedef, JSON.stringify(VARSAYILAN, null, 2), 'utf8');
      } catch (e) {
        // Yazılamazsa aşağıdaki okuma varsayılanlara düşer.
      }
    }
    yolOnbellek = hedef;
    return yolOnbellek;
  }

  yolOnbellek = path.join(__dirname, '..', 'ayarlar.json');
  return yolOnbellek;
}

let onbellek = null;

function ayarOku() {
  if (onbellek) return onbellek;
  let dosya = {};
  try {
    dosya = JSON.parse(fs.readFileSync(ayarYolu(), 'utf8'));
  } catch (e) {
    dosya = {};
  }
  onbellek = Object.assign({}, VARSAYILAN, dosya);
  return onbellek;
}

function ayarYaz(yeni) {
  const birlesik = Object.assign({}, ayarOku(), yeni);
  birlesik._aciklama =
    'Bu dosya bu bilgisayara özeldir. Programın Ayarlar ekranından da değiştirilebilir.';
  fs.writeFileSync(ayarYolu(), JSON.stringify(birlesik, null, 2), 'utf8');
  onbellek = birlesik;
  return birlesik;
}

module.exports = { ayarOku, ayarYaz, ayarYolu, VARSAYILAN };
