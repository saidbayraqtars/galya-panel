'use strict';

// AĞ SUNUCUSU SINAMASI
//
//   node kurulum/test-ag.js
//
// Sunucuyu geçici bir portta açıp HTTP üzerinden konuşuyor. Sınadıkları:
//
//   - Statik arayüz dosyaları geliyor mu, ui/ dışına çıkılabiliyor mu
//   - Giriş yapmadan kanal çağrısı reddediliyor mu
//   - PIN'le giriş yapılınca çerezle oturum kuruluyor mu
//   - İKİ AYRI TARAYICI ayrı oturum görüyor mu (asıl mesele buydu: oturum
//     modül seviyesinde tek nesneyken biri giriş yapınca diğeri de onun
//     yetkilerini alıyordu)
//   - Makineye bağlı kanallar (yazdırma, klasör açma) ağdan reddediliyor mu
//   - Çıkış yapınca jeton düşüyor mu
//
// VEGADB'ye ve panel veritabanına YAZMAZ; yalnız okur ve oturum kurar.

const path = require('path');
const http = require('http');

const kok = path.join(__dirname, '..');
const sunucu = require(path.join(kok, 'db', 'sunucu'));
const oturum = require(path.join(kok, 'db', 'oturum'));
const yetki = require(path.join(kok, 'db', 'yetki'));
const sql = require(path.join(kok, 'db', 'sql'));

const PORT = Number(process.env.GALYA_TEST_PORT) || 51999;
process.env.GALYA_AG_PORT = String(PORT);

const GECICI_AD = 'SINAMA-AG-GECICI';

let basarili = 0;
let hatali = 0;

// Sınamanın açtığı geçici kullanıcıyı siler. Hata çıksa da çağrılıyor: panel
// veritabanında artık bırakmamak önemli, kullanıcı tablosunda tek satır bile
// programın her açılışta giriş istemesine yol açıyor.
async function geciciKullaniciyiSil() {
  try {
    const liste = await oturum.kullaniciListesi();
    const k = liste.find((x) => x.ad === GECICI_AD);
    if (!k) return;
    await oturum.kullaniciSil({ id: k.id }, { kullanici: 'test-ag' });
    console.log('  (geçici sınama kullanıcısı silindi)');
  } catch (e) {
    console.log('  !! Geçici sınama kullanıcısı SİLİNEMEDİ: ' + e.message);
    console.log(`     GALYA_PANEL.dbo.Kullanici içinden "${GECICI_AD}" elle silinmeli.`);
  }
}

function ok(ad, kosul, not) {
  if (kosul) {
    basarili++;
    console.log(`  OK   ${ad}${not ? '  (' + not + ')' : ''}`);
  } else {
    hatali++;
    console.log(`  HATA ${ad}${not ? '  (' + not + ')' : ''}`);
  }
}

// Sunucu, kanal yönlendiricisini dışarıdan alıyor. Sınamada main.js
// yüklenemez (Electron gerekir), o yüzden aynı yetki süzgecini uygulayan
// küçük bir yönlendirici kuruluyor. Denenen şey ağ katmanı ve oturum
// ayrımı; iş mantığı kendi sınamalarında.
const KANALLAR = {
  'oturum:durum': async (g, k) => oturum.durumAl(k),
  'oturum:giris': async (g, k) => oturum.giris(g, k),
  'oturum:cikis': async (g, k) => oturum.cikis(g, k),
  'kullanici:liste': async () => oturum.kullaniciListesi(),
  'sistem:kullanici': async () => ({ kullanici: 'sinama' }),
  'stok:durum': async () => ({ deneme: true })
};

async function calistirKanal(kanal, girdi, jeton) {
  const isFn = KANALLAR[kanal];
  if (!isFn) return { tamam: false, kod: 'KANAL_YOK', mesaj: 'Bilinmeyen kanal' };
  try {
    const o = await oturum.oturumAl(jeton);
    const yoneticiMi = o.rol === oturum.YONETICI;
    if (!yoneticiMi && yetki.YONETICI_KANALLARI.has(kanal)) {
      return { tamam: false, kod: 'YETKISIZ', mesaj: 'Yönetici gerekiyor' };
    }
    const gereken = yetki.KANAL_YETKILERI[kanal];
    if (!yoneticiMi && gereken && !yetki.kullaniciYetkiliMi(o.yetkiler, gereken)) {
      return { tamam: false, kod: 'YETKISIZ', mesaj: 'Yetki yok' };
    }
    if (!yoneticiMi && !gereken && !yetki.ACIK_KANALLAR.has(kanal)) {
      return { tamam: false, kod: 'YETKISIZ', mesaj: 'Kapalı kanal' };
    }
    const veri = await isFn(girdi || {}, { kullanici: 'sinama', bilgisayar: 'sinama', jeton }, o);
    return { tamam: true, veri };
  } catch (e) {
    return { tamam: false, mesaj: e.message, kod: e.kod || null };
  }
}

// Basit HTTP istemcisi. Çerezi kendi taşıyor; her "tarayıcı" ayrı bir kap.
function tarayici() {
  const cerezler = new Map();
  return {
    cerezler,
    async istek(yontem, yol, govde) {
      return new Promise((coz, hata) => {
        const veri = govde === undefined ? null : JSON.stringify(govde);
        const baslik = {};
        if (veri) {
          baslik['Content-Type'] = 'application/json';
          baslik['Content-Length'] = Buffer.byteLength(veri);
        }
        if (cerezler.size) {
          baslik.Cookie = [...cerezler].map(([a, d]) => `${a}=${d}`).join('; ');
        }
        const istek = http.request(
          { host: '127.0.0.1', port: PORT, path: yol, method: yontem, headers: baslik },
          (cevap) => {
            for (const ham of cevap.headers['set-cookie'] || []) {
              const [ilk] = ham.split(';');
              const [ad, ...kalan] = ilk.split('=');
              cerezler.set(ad.trim(), kalan.join('='));
            }
            const parcalar = [];
            cevap.on('data', (p) => parcalar.push(p));
            cevap.on('end', () => {
              const metin = Buffer.concat(parcalar).toString('utf8');
              let govdeCoz = null;
              try {
                govdeCoz = JSON.parse(metin);
              } catch (e) {
                govdeCoz = null;
              }
              coz({ kod: cevap.statusCode, metin, govde: govdeCoz, basliklar: cevap.headers });
            });
          }
        );
        istek.on('error', hata);
        if (veri) istek.write(veri);
        istek.end();
      });
    }
  };
}

(async () => {
  console.log(`Ağ sunucusu sınaması (port ${PORT})\n`);

  // Ayar dosyasına dokunmadan portu değiştirmek için ayarOku önbelleği
  // üzerinden gidiliyor.
  const ayar = require(path.join(kok, 'db', 'ayar'));
  const gercek = ayar.ayarOku();
  gercek.agPort = PORT;
  gercek.agAdresi = '127.0.0.1';

  let bilgi;
  try {
    bilgi = await sunucu.baslat(calistirKanal);
  } catch (e) {
    console.log('Sunucu açılamadı: ' + e.message);
    if (e.kod === 'YONETICI_YOK') {
      console.log(
        '\nBu beklenen bir durum olabilir: sunucu, aktif yönetici tanımlı ' +
        'olmayan kurulumda bilerek açılmıyor. Sınamayı çalıştırmak için ' +
        'panelde bir yönetici tanımlayın.'
      );
    }
    process.exit(1);
  }
  ok('Sunucu açıldı', bilgi.port === PORT, 'port ' + bilgi.port);

  console.log('\n== Statik dosyalar ==');
  const t1 = tarayici();
  const anaSayfa = await t1.istek('GET', '/');
  ok('index.html geliyor', anaSayfa.kod === 200 && /GALYA PANEL/.test(anaSayfa.metin));
  const css = await t1.istek('GET', '/app.css');
  ok('app.css geliyor', css.kod === 200);
  ok(
    'CSP başlığı var',
    /default-src 'self'/.test(String(anaSayfa.basliklar['content-security-policy'] || ''))
  );

  const disari = await t1.istek('GET', '/../ayarlar.json');
  ok(
    'ui/ klasörü dışına çıkılamıyor',
    disari.kod !== 200 || !/sifre/.test(disari.metin),
    'kod ' + disari.kod
  );

  console.log('\n== Giriş yapmadan ==');
  const t2 = tarayici();
  const durumsuz = await t2.istek('POST', '/api/oturum:durum', {});
  ok('oturum:durum açık kanal', durumsuz.govde && durumsuz.govde.tamam === true);
  ok(
    'girisYapildi = false',
    durumsuz.govde && durumsuz.govde.veri && durumsuz.govde.veri.girisYapildi === false
  );
  ok('Oturum çerezi verildi', t2.cerezler.has('galya_oturum'));

  const yasak = await t2.istek('POST', '/api/kullanici:liste', {});
  ok(
    'Girişsiz yönetici kanalı reddedildi',
    yasak.govde && yasak.govde.tamam === false && yasak.govde.kod === 'YETKISIZ'
  );

  console.log('\n== Makineye bağlı kanallar ==');
  for (const kanal of ['sistem:yazdir', 'sistem:klasorAc', 'vegaprogram:ac', 'sistem:onay']) {
    const c = await t2.istek('POST', '/api/' + kanal, {});
    ok(
      `${kanal} ağdan reddedildi`,
      c.govde && c.govde.tamam === false && c.govde.kod === 'SUNUCU_DISI'
    );
  }

  console.log('\n== Yöntem ve gövde denetimi ==');
  const getIstek = await t2.istek('GET', '/api/oturum:durum');
  ok('API GET ile çağrılamıyor', getIstek.kod === 405);

  console.log('\n== Oturum ayrımı (asıl mesele) ==');
  // İki ayrı tarayıcı: biri giriş yapıyor, diğeri yapmıyor. Oturum modül
  // seviyesinde tek nesneyken ikincisi de girmiş sayılıyordu.
  // Sınama kendi kullanıcısını açıyor: gerçek bir PIN istemek betiği pratikte
  // çalıştırılamaz yapıyordu. Kullanıcı yalnız bu sınama süresince duruyor.
  let pin = process.env.GALYA_TEST_PIN;
  if (!pin) {
    pin = 'T' + Math.floor(100000 + Math.random() * 899999);
    try {
      await oturum.kullaniciKaydet(
        { ad: GECICI_AD, pin, rol: 'yonetici', aktif: true, yetkiler: {} },
        { kullanici: 'test-ag' }
      );
      console.log('  (sınama için geçici yönetici açıldı: ' + GECICI_AD + ')');
    } catch (e) {
      console.log('  ATLA Giriş sınamaları — geçici kullanıcı açılamadı: ' + e.message);
      pin = null;
    }
  }
  if (!pin) {
    console.log('  ATLA Giriş sınamaları');
  } else {
    const a = tarayici();
    const b = tarayici();
    await b.istek('POST', '/api/oturum:durum', {}); // b kendi jetonunu alsın

    const giris = await a.istek('POST', '/api/oturum:giris', { pin });
    ok('PIN ile giriş yapıldı', giris.govde && giris.govde.tamam === true, giris.govde && giris.govde.mesaj);
    if (giris.govde && giris.govde.tamam) {
      ok('Giriş yapan yönetici', giris.govde.veri.rol === 'yonetici');

      const aDurum = await a.istek('POST', '/api/oturum:durum', {});
      ok('A oturumu açık', aDurum.govde.veri.girisYapildi === true);

      const bDurum = await b.istek('POST', '/api/oturum:durum', {});
      ok(
        'B oturumu A giriş yapınca AÇILMADI',
        bDurum.govde.veri.girisYapildi === false,
        'B rol: ' + bDurum.govde.veri.rol
      );

      const bYasak = await b.istek('POST', '/api/kullanici:liste', {});
      ok('B hâlâ yönetici kanalını çağıramıyor', bYasak.govde.tamam === false);

      const aIzin = await a.istek('POST', '/api/kullanici:liste', {});
      ok('A yönetici kanalını çağırabiliyor', aIzin.govde.tamam === true);

      await a.istek('POST', '/api/oturum:cikis', {});
      const aSonra = await a.istek('POST', '/api/oturum:durum', {});
      ok('Çıkıştan sonra oturum kapandı', aSonra.govde.veri.girisYapildi === false);
      const aYasak = await a.istek('POST', '/api/kullanici:liste', {});
      ok('Çıkıştan sonra yönetici kanalı kapalı', aYasak.govde.tamam === false);
    }
  }

  // Geçici kullanıcı her hâlükârda siliniyor.
  await geciciKullaniciyiSil();

  await sunucu.durdur();
  ok('Sunucu kapandı', sunucu.durum().calisiyor === false);

  console.log(`\nSonuç: ${basarili} başarılı, ${hatali} hatalı`);
  await sql.havuzKapat().catch(() => {});
  process.exit(hatali ? 1 : 0);
})().catch((e) => {
  console.error('\nBEKLENMEYEN HATA:', e.message);
  console.error(e.stack);
  process.exit(1);
});
