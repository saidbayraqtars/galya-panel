'use strict';

// AĞ SUNUCUSU — paneli aynı ağdaki başka bilgisayarlardan açmak için.
//
//   http://192.168.1.50:51234
//
// Aynı arayüz, aynı kanallar, aynı yetki süzgeci. Tek fark oturumun nasıl
// çözüldüğü: masaüstünde tek kişi var, ağda her tarayıcının kendi oturumu var
// (db/oturum.js → jetonlu oturumlar).
//
// NEDEN DIŞ BAĞIMLILIK YOK
// ------------------------
// Node'un kendi `http` modülü yetiyor. Panel müşteri sunucusunda çalışıyor;
// güncelleme yükü ve saldırı yüzeyi olan bir web çatısı eklemek bu iş için
// kazanç değil.
//
// GÜVENLİK SINIRI — OKUNMADAN AÇILMAMALI
// --------------------------------------
// 1. Trafik ŞİFRESİZ (düz HTTP). PIN ağ üzerinden açık geçer. Bu yüzden
//    sunucu yalnız YEREL ağa açılmalı; internete port yönlendirmesi
//    yapılmamalı. Kablosuz ağ paylaşılıyorsa (misafir wifi) açmayın.
// 2. En az bir AKTİF YÖNETİCİ tanımlı değilse sunucu hiç açılmıyor. Panel,
//    kullanıcı tanımlı olmayan kurulumda herkesi yönetici sayıyor; bu kural
//    masaüstü için makul, ağ için felaket olurdu.
// 3. Makineye bağlı işler (yazdırma, klasör açma, Vega programını başlatma,
//    güncelleme) ağdan çağrılamıyor — sunucunun bilgisayarında çalışırlardı,
//    isteyen kişinin değil.
// 4. Oturum çerezi HttpOnly + SameSite=Strict. Arayüz JavaScript'i çereze
//    dokunmuyor, başka sitelerden gelen istekler çerezi taşımıyor.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ayarOku } = require('./ayar');
const oturum = require('./oturum');
const panel = require('./panel');

const UI = path.join(__dirname, '..', 'ui');
const CEREZ = 'galya_oturum';
const EN_BUYUK_GOVDE = 8 * 1024 * 1024;

// Sunucunun bilgisayarında iş yapan kanallar. Ağdan çağrılırsa yanlış
// makinede çalışırlar; istekte bulunan kişi sonucu göremez.
const SUNUCU_DISI_KANALLAR = new Set([
  // Onay kutusu Electron'un işletim sistemi penceresini açıyor; ağdan
  // çağrılsa SUNUCUNUN ekranında açılır ve kimse görmeden orada beklerdi.
  // Arayüz tarayıcıda sayfa içi onay kutusuna düşüyor.
  'sistem:onay',
  'rapor:ac',
  'sistem:yazdir',
  'sistem:klasorAc',
  'vegaprogram:ac',
  'vegaprogram:durum',
  'guncelleme:kontrol',
  'guncelleme:durum'
]);

const TURLER = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

let sunucu = null;
let calisiyor = null;

function cerezOku(istek) {
  const ham = istek.headers.cookie || '';
  for (const parca of ham.split(';')) {
    const [ad, ...kalan] = parca.trim().split('=');
    if (ad === CEREZ) return decodeURIComponent(kalan.join('='));
  }
  return null;
}

function govdeOku(istek) {
  return new Promise((coz, hata) => {
    let boy = 0;
    const parcalar = [];
    istek.on('data', (p) => {
      boy += p.length;
      if (boy > EN_BUYUK_GOVDE) {
        hata(new Error('İstek gövdesi çok büyük.'));
        istek.destroy();
        return;
      }
      parcalar.push(p);
    });
    istek.on('end', () => {
      if (!parcalar.length) return coz({});
      try {
        coz(JSON.parse(Buffer.concat(parcalar).toString('utf8')));
      } catch (e) {
        hata(new Error('İstek gövdesi okunamadı (geçersiz JSON).'));
      }
    });
    istek.on('error', hata);
  });
}

function json(cevap, kod, govde, ekBaslik) {
  const metin = JSON.stringify(govde);
  cevap.writeHead(
    kod,
    Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(metin),
        // Arayüz kendi kaynağından geliyor; dış kaynak yüklenmiyor.
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store'
      },
      ekBaslik || {}
    )
  );
  cevap.end(metin);
}

// ui/ klasörünün dışına çıkılamaz: '../' içeren yol çözüldükten sonra
// klasörün altında kalmıyorsa istek reddediliyor.
function dosyaVer(cevap, istenen) {
  const temiz = decodeURIComponent((istenen || '/').split('?')[0]);
  const yol = path.normalize(path.join(UI, temiz === '/' ? 'index.html' : temiz));
  if (yol !== UI && !yol.startsWith(UI + path.sep)) {
    cevap.writeHead(403).end('Yasak');
    return;
  }
  fs.readFile(yol, (hata, icerik) => {
    if (hata) {
      cevap.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bulunamadı');
      return;
    }
    cevap.writeHead(200, {
      'Content-Type': TURLER[path.extname(yol).toLowerCase()] || 'application/octet-stream',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store'
    });
    cevap.end(icerik);
  });
}

// Bu makinenin ağdaki adresleri — kullanıcıya "şu adresi yazın" diyebilmek için.
function agAdresleri(port) {
  const sonuc = [];
  const arayuzler = os.networkInterfaces();
  for (const ad of Object.keys(arayuzler)) {
    for (const a of arayuzler[ad] || []) {
      if (a.family === 'IPv4' && !a.internal) sonuc.push(`http://${a.address}:${port}`);
    }
  }
  return sonuc;
}

async function yoneticiVarMi() {
  const liste = await oturum.kullaniciListesi();
  return liste.some((k) => k.aktif && k.rol === oturum.YONETICI);
}

// calistirKanal: main.js'teki yönlendirici. Sunucu onu dışarıdan alıyor ki
// kanal listesi ve yetki süzgeci tek yerde kalsın.
async function baslat(calistirKanal) {
  if (calisiyor) return calisiyor;

  const a = ayarOku();
  const port = Number(a.agPort) || 51234;
  const adres = a.agAdresi || '0.0.0.0';

  await panel.kur();
  if (!(await yoneticiVarMi())) {
    const e = new Error(
      'Ağ erişimi açılamadı: bu kurulumda aktif bir yönetici kullanıcı yok. ' +
        'Panel, kullanıcı tanımlı olmayan kurulumda herkesi yönetici sayar; ' +
        'ağa böyle açılırsa ağdaki herkes her şeyi yapabilir. Önce Ayarlar → ' +
        'Kullanıcılar ekranından bir yönetici tanımlayın.'
    );
    e.kod = 'YONETICI_YOK';
    throw e;
  }

  sunucu = http.createServer(async (istek, cevap) => {
    try {
      const yol = (istek.url || '/').split('?')[0];

      if (!yol.startsWith('/api/')) {
        if (istek.method !== 'GET') {
          cevap.writeHead(405).end('Yöntem desteklenmiyor');
          return;
        }
        dosyaVer(cevap, yol);
        return;
      }

      if (istek.method !== 'POST') {
        json(cevap, 405, { tamam: false, mesaj: 'Kanal çağrıları POST ile yapılır.' });
        return;
      }

      const kanal = decodeURIComponent(yol.slice('/api/'.length));
      if (SUNUCU_DISI_KANALLAR.has(kanal)) {
        json(cevap, 400, {
          tamam: false,
          kod: 'SUNUCU_DISI',
          mesaj:
            'Bu iş panelin kurulu olduğu bilgisayarda yapılıyor (yazdırma, ' +
            'klasör açma, program başlatma). Ağdan çalıştırılamaz.'
        });
        return;
      }

      // Jeton yoksa yenisi veriliyor: oturumu olmayan ziyaretçi de
      // 'oturum:durum' ve 'oturum:giris' çağırabilmeli.
      let jeton = cerezOku(istek);
      let ekBaslik = {};
      if (!jeton || !oturum.jetonGecerliMi(jeton)) {
        jeton = oturum.jetonUret();
        ekBaslik = {
          'Set-Cookie':
            `${CEREZ}=${jeton}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 60 * 60}`
        };
      }

      const girdi = await govdeOku(istek);
      const sonuc = await calistirKanal(kanal, girdi, jeton);
      json(cevap, 200, sonuc, ekBaslik);
    } catch (e) {
      json(cevap, 400, { tamam: false, mesaj: e.message || String(e) });
    }
  });

  calisiyor = await new Promise((coz, hata) => {
    sunucu.once('error', (e) => {
      calisiyor = null;
      sunucu = null;
      hata(
        e && e.code === 'EADDRINUSE'
          ? new Error(`${port} portu başka bir program tarafından kullanılıyor. Ayarlardan başka bir port seçin.`)
          : e
      );
    });
    sunucu.listen(port, adres, () => {
      coz({ port, adres, adresler: agAdresleri(port) });
    });
  });

  await panel.kayit('Ağ Erişimi', 'Ağ sunucusu açıldı', calisiyor, null, os.hostname());
  return calisiyor;
}

async function durdur() {
  if (!sunucu) return { tamam: true, calisiyor: false };
  await new Promise((coz) => sunucu.close(coz));
  sunucu = null;
  calisiyor = null;
  await panel.kayit('Ağ Erişimi', 'Ağ sunucusu kapatıldı', null, null, os.hostname());
  return { tamam: true, calisiyor: false };
}

function durum() {
  const a = ayarOku();
  const port = Number(a.agPort) || 51234;
  return {
    calisiyor: !!calisiyor,
    port,
    adres: a.agAdresi || '0.0.0.0',
    otomatikAcilsin: !!a.agErisimiAktif,
    adresler: calisiyor ? calisiyor.adresler : agAdresleri(port)
  };
}

module.exports = { baslat, durdur, durum, SUNUCU_DISI_KANALLAR };
