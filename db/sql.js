'use strict';

const mssql = require('mssql');
const { ayarOku } = require('./ayar');

// Windows oturumuyla bağlanmak isteyen kurulumlar için isteğe bağlı sürücü.
// Kurulu değilse program SQL kullanıcısıyla çalışmaya devam eder.
let mssqlWindows = null;
try {
  mssqlWindows = require('mssql/msnodesqlv8');
} catch (e) {
  mssqlWindows = null;
}

let havuz = null;
let havuzAnahtari = '';
let aktifSurucu = mssql;

// Sunucu adını sürücünün anlayacağı hale getirir.
//
// Microsoft'un kendi araçları (SSMS, Vega, sqlcmd) "(local)", "." ve
// "(local)\SQLEXPRESS" gibi takma adları kabul eder; bizim kullandığımız
// tedious sürücüsü etmez, gerçek makine adı ister. Kullanıcı ayar ekranına
// bunlardan birini yazdığında bağlantı "sunucuya ulaşılamadı" diye
// başarısız oluyordu.
//
// Ayrıca "MAKINE\SQLEXPRESS" biçimindeki adlandırılmış örnekler ayrı bir
// alanla (instanceName) verilmek zorunda; port yerine SQL Browser üzerinden
// bulunuyor.
function sunucuCoz(ham) {
  const metin = String(ham || '').trim();
  const parcalar = metin.split('\\');
  let makine = (parcalar[0] || '').trim();
  const ornek = parcalar.length > 1 ? parcalar.slice(1).join('\\').trim() : '';

  const yerelTakmaAdlar = ['', '.', '(local)', 'local', '(localhost)'];
  if (yerelTakmaAdlar.includes(makine.toLowerCase())) makine = 'localhost';

  return { makine, ornek };
}

function anahtarUret(a) {
  return [a.sunucu, a.port, a.windowsGirisi ? 'win' : a.kullanici, a.vegaVeritabani].join('|');
}

function baglantiAyari(a) {
  const { makine, ornek } = sunucuCoz(a.sunucu);

  if (a.windowsGirisi && mssqlWindows) {
    return {
      surucu: mssqlWindows,
      config: {
        // msnodesqlv8 takma adları zaten anlıyor; kullanıcının yazdığını
        // olduğu gibi veriyoruz.
        server: a.sunucu,
        database: a.vegaVeritabani,
        driver: 'msnodesqlv8',
        options: {
          trustedConnection: true,
          trustServerCertificate: true
        },
        pool: { max: 8, min: 0, idleTimeoutMillis: 30000 },
        requestTimeout: 120000
      }
    };
  }
  const config = {
    server: makine,
    user: a.kullanici,
    password: a.sifre,
    database: a.vegaVeritabani,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true
    },
    pool: { max: 8, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 120000
  };

  if (ornek) {
    // Adlandırılmış örnekte portu SQL Browser bulur; ikisi birden verilemez.
    config.options.instanceName = ornek;
  } else {
    config.port = Number(a.port) || 1433;
  }

  return { surucu: mssql, config };
}

async function havuzAl() {
  const a = ayarOku();
  const anahtar = anahtarUret(a);
  if (havuz && havuzAnahtari === anahtar && havuz.connected) return havuz;
  if (havuz) {
    try { await havuz.close(); } catch (e) { /* kapalıysa sorun değil */ }
    havuz = null;
  }
  if (a.windowsGirisi && !mssqlWindows) {
    throw new Error(
      'Windows oturumuyla bağlanma seçili ama gerekli sürücü kurulu değil. ' +
      'Ayarlar ekranından SQL kullanıcı adı ve şifresi girin.'
    );
  }
  const { surucu, config } = baglantiAyari(a);
  havuz = await new surucu.ConnectionPool(config).connect();
  aktifSurucu = surucu;
  havuzAnahtari = anahtar;
  return havuz;
}

// Yedekleme ve geri yükleme için AYRI, kısa ömürlü bağlantı.
//
// Havuz `vegaVeritabani` içinde açılıyor; VEGADB'yi geri yüklemek için o
// veritabanına bağlı OLMAMAK gerekiyor (SQL Server "veritabanı kullanımda"
// diye reddeder). Bu yüzden yedek işleri master üzerinde kendi bağlantısını
// açıyor ve işi bitince kapatıyor. Havuza hiç dokunmuyor.
//
// Çağıran kapatmakla yükümlü:  const h = await yonetimHavuzu(); try { … }
//                              finally { await h.close(); }
async function yonetimHavuzu() {
  const a = ayarOku();
  if (a.windowsGirisi && !mssqlWindows) {
    throw new Error(
      'Windows oturumuyla bağlanma seçili ama gerekli sürücü kurulu değil.'
    );
  }
  const { surucu, config } = baglantiAyari(a);
  const yonetimConfig = Object.assign({}, config, {
    database: 'master',
    pool: { max: 1, min: 0, idleTimeoutMillis: 5000 },
    // Yedek/geri yükleme dakikalarca sürebilir.
    requestTimeout: 0
  });
  return new surucu.ConnectionPool(yonetimConfig).connect();
}

async function havuzKapat() {
  if (havuz) {
    try { await havuz.close(); } catch (e) { /* yoksay */ }
    havuz = null;
    havuzAnahtari = '';
  }
}

// Parametreli sorgu. parametreler: { ad: deger } veya { ad: { tip, deger } }
async function sorgu(metin, parametreler) {
  const h = await havuzAl();
  const istek = h.request();
  if (parametreler) {
    for (const ad of Object.keys(parametreler)) {
      const p = parametreler[ad];
      if (p && typeof p === 'object' && 'tip' in p) {
        istek.input(ad, p.tip, p.deger);
      } else {
        istek.input(ad, p);
      }
    }
  }
  const sonuc = await istek.query(metin);
  return sonuc.recordset || [];
}

// Birden fazla sonuç kümesi döndüren sorgular için
async function sorguCoklu(metin, parametreler) {
  const h = await havuzAl();
  const istek = h.request();
  if (parametreler) {
    for (const ad of Object.keys(parametreler)) istek.input(ad, parametreler[ad]);
  }
  const sonuc = await istek.query(metin);
  return sonuc.recordsets || [];
}

async function calistir(metin, parametreler) {
  const h = await havuzAl();
  const istek = h.request();
  if (parametreler) {
    for (const ad of Object.keys(parametreler)) {
      const p = parametreler[ad];
      if (p && typeof p === 'object' && 'tip' in p) istek.input(ad, p.tip, p.deger);
      else istek.input(ad, p);
    }
  }
  const sonuc = await istek.query(metin);
  return sonuc.rowsAffected || [];
}

// Birden fazla tabloya yazan işlemler için. İş parçası hata verirse hiçbir
// satır kalmaz; yarım belge oluşmaz.
//
//   await islem(async (t) => {
//     const r = await t.sorgu('INSERT ... OUTPUT INSERTED.IND AS ind ...', {...});
//     await t.calistir('INSERT ...', { ind: r[0].ind });
//   });
async function islem(isFn) {
  const h = await havuzAl();
  const islem = new aktifSurucu.Transaction(h);
  await islem.begin();

  function istekHazirla(parametreler) {
    const istek = new aktifSurucu.Request(islem);
    if (parametreler) {
      for (const ad of Object.keys(parametreler)) {
        const p = parametreler[ad];
        if (p && typeof p === 'object' && 'tip' in p) istek.input(ad, p.tip, p.deger);
        else istek.input(ad, p);
      }
    }
    return istek;
  }

  const araclar = {
    sorgu: async (metin, p) => (await istekHazirla(p).query(metin)).recordset || [],
    calistir: async (metin, p) => (await istekHazirla(p).query(metin)).rowsAffected || []
  };

  let tamamlandi = false;
  try {
    const sonuc = await isFn(araclar);
    await islem.commit();
    tamamlandi = true;
    return sonuc;
  } finally {
    if (!tamamlandi) {
      try { await islem.rollback(); } catch (e) { /* zaten geri alınmışsa yoksay */ }
    }
  }
}

async function baglantiTesti() {
  const a = ayarOku();
  const satirlar = await sorgu('SELECT @@VERSION AS surum, DB_NAME() AS veritabani');
  return {
    tamam: true,
    sunucu: a.sunucu,
    veritabani: satirlar[0] ? satirlar[0].veritabani : a.vegaVeritabani,
    surum: satirlar[0] ? String(satirlar[0].surum).split('\n')[0] : ''
  };
}

module.exports = {
  mssql,
  sorgu,
  sorguCoklu,
  calistir,
  islem,
  havuzAl,
  havuzKapat,
  yonetimHavuzu,
  baglantiTesti
};
