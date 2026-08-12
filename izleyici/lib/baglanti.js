'use strict';

// İki türlü bağlantı kurabiliyoruz:
//
//   Windows girişi : sqlcmd -E ile. Kullanıcı adı/şifre sorulmaz, bilgisayara
//                    giriş yapmış kullanıcı kullanılır. sqlcmd'nin kurulu
//                    olması gerekir (SQL Server veya SQL araçları varsa vardır).
//   SQL kullanıcısı: node-mssql ile. Her makinede çalışır, sysadmin yetkili
//                    bir kullanıcı (genelde sa) ister.
//
// Dışarıya iki iş sunuyoruz: calistir (sonuç beklemeden) ve sorgu (satır döner).
// Büyük okumalar için satirlariAkit kullanılıyor; hepsi belleğe alınmıyor.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const sql = require('mssql');

let havuz = null;
let havuzAnahtari = null;

// --- sqlcmd var mı? --------------------------------------------------------

let sqlcmdYolu = null;
let sqlcmdArandi = false;

function sqlcmdBul() {
  if (sqlcmdArandi) return sqlcmdYolu;
  sqlcmdArandi = true;
  try {
    execFileSync('sqlcmd', ['-?'], { stdio: 'ignore' });
    sqlcmdYolu = 'sqlcmd';
    return sqlcmdYolu;
  } catch (e) {
    /* PATH'te yok, bilinen yerlere bakalım */
  }
  const kokler = [
    'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC',
    'C:\\Program Files (x86)\\Microsoft SQL Server\\Client SDK\\ODBC',
    'C:\\Program Files\\Microsoft SQL Server'
  ];
  for (const kok of kokler) {
    const bulunan = derinAra(kok, 'SQLCMD.EXE', 4);
    if (bulunan) {
      sqlcmdYolu = bulunan;
      return sqlcmdYolu;
    }
  }
  return null;
}

function derinAra(klasor, dosyaAdi, kalanDerinlik) {
  if (kalanDerinlik < 0) return null;
  let girdiler;
  try {
    girdiler = fs.readdirSync(klasor, { withFileTypes: true });
  } catch (e) {
    return null;
  }
  for (const g of girdiler) {
    const tam = path.join(klasor, g.name);
    if (g.isFile() && g.name.toUpperCase() === dosyaAdi) return tam;
  }
  for (const g of girdiler) {
    if (!g.isDirectory()) continue;
    const bulunan = derinAra(path.join(klasor, g.name), dosyaAdi, kalanDerinlik - 1);
    if (bulunan) return bulunan;
  }
  return null;
}

function windowsGirisiKullanilabilir() {
  return !!sqlcmdBul();
}

// --- Ortak yardımcılar -----------------------------------------------------

function windowsMi(ayar) {
  return !!ayar.windowsGirisi;
}

// "(local)", "." gibi takma adları Microsoft araçları anlar, tedious anlamaz.
// "MAKINE\SQLEXPRESS" biçimindeki örnek adı da ayrı verilmek zorunda.
function sunucuCoz(ham) {
  const metin = String(ham || '').trim();
  const parcalar = metin.split('\\');
  let makine = (parcalar[0] || '').trim();
  const ornek = parcalar.length > 1 ? parcalar.slice(1).join('\\').trim() : '';
  if (['', '.', '(local)', 'local', '(localhost)'].includes(makine.toLowerCase())) {
    makine = 'localhost';
  }
  return { makine, ornek };
}

function sunucuAdi(ayar) {
  // sqlcmd takma adları zaten anlıyor; kullanıcının yazdığını olduğu gibi ver.
  return (ayar.sunucu || 'localhost').trim();
}

function sqlcmdArgumanlari(ayar, ekstra) {
  return ['-S', sunucuAdi(ayar), '-E', '-b', '-l', '30'].concat(ekstra);
}

function sqlcmdCalistir(ayar, argumanlar, ciktiDosyasi) {
  return new Promise((coz, hata) => {
    execFile(
      sqlcmdBul(),
      sqlcmdArgumanlari(ayar, argumanlar),
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (e, cikti, hataCikti) => {
        if (e) {
          const m = (hataCikti || cikti || e.message || '').toString().trim();
          hata(new Error(m || e.message));
          return;
        }
        coz(ciktiDosyasi ? '' : (cikti || '').toString());
      }
    );
  });
}

// --- node-mssql tarafı -----------------------------------------------------

function anahtar(ayar) {
  return [ayar.windowsGirisi ? 'win' : 'sql', ayar.sunucu, ayar.port, ayar.kullanici, ayar.sifre].join('|');
}

async function havuzAl(ayar) {
  const a = anahtar(ayar);
  if (havuz && havuzAnahtari === a) return havuz;
  await kapat();
  const { makine, ornek } = sunucuCoz(ayar.sunucu);
  const config = {
    server: makine,
    user: ayar.kullanici,
    password: ayar.sifre,
    database: 'master',
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 600000,
    connectionTimeout: 20000
  };
  // Adlandırılmış örnekte portu SQL Browser bulur; ikisi birden verilemez.
  if (ornek) config.options.instanceName = ornek;
  else config.port = Number(ayar.port) || 1433;

  havuz = await new sql.ConnectionPool(config).connect();
  havuzAnahtari = a;
  return havuz;
}

async function kapat() {
  if (havuz) {
    try {
      await havuz.close();
    } catch (e) {
      /* zaten kapalıysa sorun değil */
    }
  }
  havuz = null;
  havuzAnahtari = null;
}

// --- Dışarıya açılan iki iş ------------------------------------------------

// Sonucu önemsemeyen komutlar (CREATE/ALTER/DROP EVENT SESSION vb.)
async function calistir(ayar, metin) {
  if (windowsMi(ayar)) {
    await sqlcmdCalistir(ayar, ['-Q', metin]);
    return;
  }
  const h = await havuzAl(ayar);
  await h.request().batch(metin);
}

// Az sayıda satır döndüren sorgular. Sonuç: nesne dizisi.
// Windows girişinde sqlcmd'nin çıktısını ayırmak için | ayracı kullanıyoruz.
async function sorgu(ayar, metin) {
  if (!windowsMi(ayar)) {
    const h = await havuzAl(ayar);
    const s = await h.request().query(metin);
    return s.recordset || [];
  }

  const cikti = await sqlcmdCalistir(ayar, ['-W', '-s', '|', '-Q', 'SET NOCOUNT ON; ' + metin]);
  const satirlar = cikti
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length);
  if (satirlar.length < 3) return [];
  const basliklar = satirlar[0].split('|').map((s) => s.trim());
  const sonuc = [];
  for (const satir of satirlar.slice(2)) {
    if (/^\(\d+ rows? affected\)$/i.test(satir)) continue;
    const parcalar = satir.split('|');
    const nesne = {};
    basliklar.forEach((b, i) => {
      const ham = (parcalar[i] || '').trim();
      nesne[b] = ham === 'NULL' ? null : ham;
    });
    sonuc.push(nesne);
  }
  return sonuc;
}

// Çok satır döndüren okumalar. Her satır için isFn çağrılır.
// Windows girişinde sqlcmd çıktısı geçici dosyaya yazılır, oradan okunur;
// böylece milyonlarca satır belleğe sığmak zorunda kalmaz.
async function satirlariAkit(ayar, metin, sutun, isFn) {
  if (!windowsMi(ayar)) {
    const h = await havuzAl(ayar);
    const istek = h.request();
    istek.stream = true;
    return new Promise((coz, hata) => {
      let sayi = 0;
      istek.on('row', (satir) => {
        const deger = satir[sutun] != null ? satir[sutun] : satir[Object.keys(satir)[0]];
        if (deger) {
          sayi++;
          isFn(String(deger));
        }
      });
      istek.on('error', hata);
      istek.on('done', () => coz(sayi));
      istek.query(metin);
    });
  }

  const gecici = path.join(os.tmpdir(), 'galya-izleyici-' + Date.now() + '.txt');
  // -y 0 sütunu kırpmasın diye; -h ile birlikte kullanılamıyor, başlık satırı
  // zaten aşağıdaki <event ...> ayrıştırmasında kendiliğinden eleniyor.
  await sqlcmdCalistir(ayar, ['-y', '0', '-Q', 'SET NOCOUNT ON; ' + metin, '-o', gecici], true);
  const ham = fs.readFileSync(gecici, 'utf8');
  try {
    fs.unlinkSync(gecici);
  } catch (e) {
    /* geçici dosya kalırsa sorun değil */
  }
  // Her olay tek bir <event ...>...</event> bloğu; satır sonlarına güvenmiyoruz.
  let sayi = 0;
  for (const parca of ham.split('<event ').slice(1)) {
    sayi++;
    isFn('<event ' + parca);
  }
  return sayi;
}

module.exports = {
  calistir,
  sorgu,
  satirlariAkit,
  kapat,
  windowsGirisiKullanilabilir,
  sqlcmdBul
};
