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

function anahtarUret(a) {
  return [a.sunucu, a.port, a.windowsGirisi ? 'win' : a.kullanici, a.vegaVeritabani].join('|');
}

function baglantiAyari(a) {
  if (a.windowsGirisi && mssqlWindows) {
    return {
      surucu: mssqlWindows,
      config: {
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
  return {
    surucu: mssql,
    config: {
      server: a.sunucu,
      port: Number(a.port) || 1433,
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
    }
  };
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
  havuzAnahtari = anahtar;
  return havuz;
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

module.exports = { mssql, sorgu, sorguCoklu, calistir, havuzAl, havuzKapat, baglantiTesti };
