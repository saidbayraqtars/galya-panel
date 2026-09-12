'use strict';

// GERİ YÜKLEME SINAMASI — yalnız GALYA_TEST üzerinde.
//
//   node kurulum/test-geri-yukleme.js
//
// Yedekleme merkezinin geri dönüşü olmayan tek işi geri yükleme. Canlı bir
// veritabanında denenemediği için bugüne kadar hiç çalıştırılmamıştı. Burada
// panelin kendi kodu (db/yedek.js) GALYA_TEST'i yedekliyor, değiştiriyor ve
// yedekten geri döndürüyor:
//
//   1. Tam yedek → değişiklik → geri yükleme. Değişiklik gitti mi, önce
//      güvenlik yedeği alındı mı, veritabanı çok kullanıcılı açıldı mı?
//   2. İşlem öncesi yedek (temel + diferansiyel) → değişiklik → zincirle
//      dönüş. Vega'ya yazan her işten önce alınan yedek gerçekten açılıyor mu?
//      1. adımdaki geri yüklemeden SONRA alınıyor; müşteride de sıra bu.
//   3. Kapılar: uzantısı .bak olmayan dosya, beyaz listede olmayan veritabanı
//      ve başka bir veritabanının yedeği hiçbir şey yapmadan reddediliyor mu?
//
// Vega ve panel veritabanı ayarda GALYA_TEST'e çevrilir; ayar başka bir yere
// yönelirse betik hiçbir şey yapmadan durur. Yanlış dosya sınaması için
// geçici bir veritabanı (GALYA_TEST_YABANCI) açılıp sonunda silinir. Sınamanın
// yedek dosyaları da sonunda silinir — yalnız adı GALYA_TEST ile başlayanlar
// ve yalnız SQL Server'ın yedek klasörü bu bilgisayardan görülebiliyorsa.

const HEDEF = 'GALYA_TEST';
const YABANCI = 'GALYA_TEST_YABANCI';
require('./test-ortam').ayarla({ vegaVeritabani: HEDEF, panelVeritabani: HEDEF });

const fs = require('fs');
const path = require('path');
const kok = path.join(__dirname, '..');
const { ayarOku } = require(path.join(kok, 'db', 'ayar'));
const sql = require(path.join(kok, 'db', 'sql'));
const panel = require(path.join(kok, 'db', 'panel'));
const yedek = require(path.join(kok, 'db', 'yedek'));

const ISARET = `[${HEDEF}].dbo.GeriYuklemeSinamasi`;
const KIM = 'test-geri-yukleme';

let basarili = 0;
let hatali = 0;
const dosyalar = new Set();

function ok(ad, kosul, not) {
  if (kosul) basarili++;
  else hatali++;
  console.log(`  ${kosul ? 'OK  ' : 'HATA'} ${ad}${not ? '  (' + not + ')' : ''}`);
}

async function isaret() {
  const r = await sql.sorgu(`SELECT Id AS id, Deger AS deger FROM ${ISARET} ORDER BY Id`);
  return r.map((x) => x.id + ':' + x.deger).join(',');
}

async function vtDurumu() {
  const r = await sql.sorgu(
    `SELECT state_desc AS durum, user_access_desc AS erisim FROM sys.databases WHERE name = @ad`,
    { ad: HEDEF }
  );
  return r[0] ? r[0].durum + ' / ' + r[0].erisim : 'yok';
}

async function reddedilmeli(ad, isFn, beklenen) {
  try {
    await isFn();
    ok(ad, false, 'reddedilmedi');
  } catch (e) {
    ok(ad, beklenen.test(e.message), e.message.slice(0, 110));
  }
}

async function yonetim(isFn) {
  const h = await sql.yonetimHavuzu();
  try {
    return await isFn(h);
  } finally {
    await h.close().catch(() => {});
  }
}

(async () => {
  const a = ayarOku();
  if (a.vegaVeritabani !== HEDEF || a.panelVeritabani !== HEDEF || panel.p() !== HEDEF) {
    console.log(`Ayar ${HEDEF}'e yönelmedi; hiçbir şey yapılmadı.`);
    process.exit(1);
  }
  console.log(`Geri yükleme sınaması — ${HEDEF}\n`);

  try {
    await panel.kur();
    // Önceki çalıştırmaların dönüş noktaları: dosyaları silindiği için artık açılmaz.
    await sql.calistir(
      `UPDATE [${HEDEF}].dbo.Yedek SET Gecerli = 0 WHERE Veritabani = @vt AND Gecerli = 1`,
      { vt: HEDEF }
    );
    await sql.calistir(`
      IF OBJECT_ID(N'${ISARET}') IS NOT NULL DROP TABLE ${ISARET};
      CREATE TABLE ${ISARET} (Id INT PRIMARY KEY, Deger NVARCHAR(40));
      INSERT INTO ${ISARET} VALUES (1, N'once');
    `);

    // Müşteride işlem öncesi yedeğin temeli çoğu zaman zaten vardır; 2. adım
    // bu temelin geri yüklemeden sonra da işe yaradığını görsün diye önce
    // bir tane alınıyor.
    const n0 = await yedek.islemOncesiYedek({ kullanici: KIM, islem: 'sinama-hazirlik' });
    dosyalar.add(n0.dosya);
    dosyalar.add(n0.temelDosya);

    console.log('== 1. Tam yedekten geri yükleme ==');
    const al = await yedek.yedekAl({ veritabanlari: [HEDEF], kullanici: KIM, not: 'sınama' });
    const tamDosya = (al.sonuclar.find((s) => s.tamam) || {}).dosya;
    if (tamDosya) dosyalar.add(tamDosya);
    ok('Tam yedek alındı', !!tamDosya, tamDosya);

    await sql.calistir(
      `UPDATE ${ISARET} SET Deger = N'sonra' WHERE Id = 1; INSERT INTO ${ISARET} VALUES (2, N'fazla');`
    );
    ok('Yedekten sonra değişiklik yazıldı', (await isaret()) === '1:sonra,2:fazla');

    console.log('\n== Kapılar ==');
    await reddedilmeli(
      'Uzantısı .bak olmayan dosya reddediliyor',
      () => yedek.geriYukle({ veritabani: HEDEF, dosya: 'C:\\sinama\\yedek.txt', kullanici: KIM }),
      /yolu kullanılamaz/
    );
    await reddedilmeli(
      'Beyaz listede olmayan veritabanı reddediliyor',
      () => yedek.geriYukle({ veritabani: 'master', dosya: tamDosya, kullanici: KIM }),
      /yedekleyebileceği veritabanlarından değil/
    );

    // Başka bir veritabanının yedeği. Başlık denetimi CREATE DATABASE yetkisi
    // istiyor; yetki yoksa yedek.js denetimi atlıyor. O durumda bu dosyayla
    // denemek GALYA_TEST'i yabancı veritabanının üstüne yazardı — denenmez.
    const yabanciDosya = await yonetim(async (h) => {
      await h.request().query(`IF DB_ID(N'${YABANCI}') IS NULL CREATE DATABASE [${YABANCI}]`);
      const klasor = (await yedek.durum()).klasor;
      const yol = path.win32.join(klasor, `${YABANCI}.bak`);
      await h.request().input('yol', yol).query(
        `BACKUP DATABASE [${YABANCI}] TO DISK = @yol WITH COPY_ONLY, FORMAT, INIT`
      );
      dosyalar.add(yol);
      try {
        await h.request().input('yol', yol).query('RESTORE HEADERONLY FROM DISK = @yol');
        return yol;
      } catch (e) {
        return null;
      }
    });
    if (yabanciDosya) {
      await reddedilmeli(
        'Başka veritabanının yedeği reddediliyor',
        () => yedek.geriYukle({ veritabani: HEDEF, dosya: yabanciDosya, kullanici: KIM }),
        /Yanlış dosya/
      );
    } else {
      console.log('  ATLA Başlık okunamıyor (CREATE DATABASE yetkisi yok); yanlış dosya denenmedi');
    }
    ok('Reddedilen istekler veritabanına dokunmadı', (await isaret()) === '1:sonra,2:fazla');

    console.log('\n== Geri yükleme ==');
    const g1 = await yedek.geriYukle({ veritabani: HEDEF, dosya: tamDosya, kullanici: KIM });
    if (g1.guvenlikYedegi) dosyalar.add(g1.guvenlikYedegi);
    ok('Geri yükleme tamamlandı', g1.tamam === true);
    ok('Önce güvenlik yedeği alındı', !!g1.guvenlikYedegi, g1.guvenlikYedegi);
    // Aynı saniyede alınırsa ad çakışıyordu: güvenlik yedeği geri yüklenecek
    // dosyanın üstüne yazılıyor, geri yükleme o anki hâli yüklüyordu.
    ok('Güvenlik yedeği geri yüklenen dosyanın üstüne yazılmadı',
      !!g1.guvenlikYedegi && g1.guvenlikYedegi.toLowerCase() !== String(tamDosya).toLowerCase());
    const s1 = await isaret();
    ok('Veri yedeğin alındığı ana döndü', s1 === '1:once', s1);
    const d1 = await vtDurumu();
    ok('Veritabanı açık ve çok kullanıcılı', d1 === 'ONLINE / MULTI_USER', d1);

    console.log('\n== 2. İşlem öncesi yedekten dönüş (temel + diferansiyel) ==');
    const n = await yedek.islemOncesiYedek({ kullanici: KIM, islem: 'sinama' });
    dosyalar.add(n.dosya);
    dosyalar.add(n.temelDosya);
    ok('Geri yüklemeden sonra işlem öncesi yedek alınabiliyor', !!(n.dosya && n.temelDosya),
      path.basename(n.temelDosya) + ' + ' + path.basename(n.dosya) +
      (n.temelYeni ? ', yeni temel' : ''));

    await sql.calistir(`UPDATE ${ISARET} SET Deger = N'islem' WHERE Id = 1`);
    ok('İşlemin yaptığı değişiklik yazıldı', (await isaret()) === '1:islem');

    const g2 = await yedek.geriYukle({
      veritabani: HEDEF,
      dosya: n.dosya,
      temelDosya: n.temelDosya,
      kullanici: KIM,
      guvenlikYedegi: false
    });
    ok('Zincirle geri dönüş tamamlandı', g2.tamam === true);
    const s2 = await isaret();
    ok('Veri işlemden önceki hâline döndü', s2 === '1:once', s2);
    const d2 = await vtDurumu();
    ok('Veritabanı açık ve çok kullanıcılı', d2 === 'ONLINE / MULTI_USER', d2);
  } catch (e) {
    hatali++;
    console.log('  HATA Beklenmeyen: ' + e.message);
  } finally {
    await sql.calistir(`IF OBJECT_ID(N'${ISARET}') IS NOT NULL DROP TABLE ${ISARET}`).catch(() => {});
    await sql
      .calistir(`UPDATE [${HEDEF}].dbo.Yedek SET Gecerli = 0 WHERE Veritabani = @vt`, { vt: HEDEF })
      .catch(() => {});
    await yonetim((h) =>
      h.request().query(`
        IF DB_ID(N'${YABANCI}') IS NOT NULL
        BEGIN
          ALTER DATABASE [${YABANCI}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
          DROP DATABASE [${YABANCI}];
        END`)
    ).catch((e) => console.log('  NOT  Geçici veritabanı silinemedi: ' + e.message));

    let silinen = 0;
    const kalan = [];
    for (const f of dosyalar) {
      if (!f || !path.win32.basename(f).startsWith(HEDEF)) continue;
      try {
        if (fs.existsSync(f)) {
          fs.rmSync(f);
          silinen++;
        }
      } catch (e) {
        kalan.push(f);
      }
    }
    console.log(`\n  Sınama yedek dosyası: ${silinen} silindi` +
      (kalan.length ? `, ${kalan.length} silinemedi (sunucuda elle silin): ${kalan.join(', ')}` : ''));
  }

  console.log(`\nSonuç: ${basarili} başarılı, ${hatali} hatalı\n`);
  await sql.havuzKapat().catch(() => {});
  process.exit(hatali ? 1 : 0);
})();
