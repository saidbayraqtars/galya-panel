'use strict';

// Yedekleme merkezi.
//
// Neden var: panel Vega'nın veritabanına yazıyor. Yazan her iş geri
// alınabiliyor ama geri alma da bir yazma işlemidir; bir şey ters giderse
// tek gerçek çıkış yolu yedek. Müşteri "işlemden önce yedek alsın, yedek
// almayı unutmayın diye uyarsın, geri de yükleyebilsin" dedi.
//
// ÖNEMLİ — yedek dosyası SUNUCUDA oluşur, bu bilgisayarda değil.
// BACKUP DATABASE komutunu çalıştıran SQL Server servisidir; verdiğimiz
// klasör yolu sunucunun kendi disklerinde aranır. Panelin kurulu olduğu PC
// ile SQL Server aynı makinede değilse yol sunucuya göre yazılmalı.
//
// Yetki: `galya_panel` kullanıcısı VEGADB üzerinde salt okunur kuruluyor.
// Yedek almak için ayrıca `db_backupoperator`, geri yüklemek için sunucu
// düzeyinde yetki gerekiyor — ikisi de kurulum/sql-yedek-yetkisi-ver.sql
// dosyasında. Yetki verilmeden bu ekran "yetkiniz yok" der ve hiçbir şey
// yapmaz; bu bilinçli, yedek yetkisi kendiliğinden açılmamalı.
//
// Bağlantı: yedek ve geri yükleme db/sql.js → yonetimHavuzu() ile master
// üzerinde AYRI bir bağlantı açar. Normal havuz VEGADB'nin içinde durduğu
// için o havuzla VEGADB geri yüklenemez ("veritabanı kullanımda").
//
// --- İŞLEM ÖNCESİ YEDEK ---------------------------------------------------
//
// Müşterinin isteği: "işlemden önce yedeği alacak, eğer işlemi yanlış
// yaparsa anında geri dönebilmeli."
//
// Vega'ya yazan her IPC kanalı çağrılmadan ÖNCE otomatik yedek alınıyor
// (main.js → YAZAN_KANALLAR). Her işlem için tam yedek almak mümkün değil:
// VEGADB 2,7 GB, tam yedeği 2,2 GB tutuyor ve günde onlarca işlem oluyor.
// Bunun yerine iki katmanlı çalışıyoruz:
//
//   TEMEL  tam yedek, günde bir (yedekTemelSaat). ~2,2 GB, ~2 saniye.
//   İŞLEM  diferansiyel yedek, her işlemden önce. Temelden bu yana değişen
//          sayfalar; küçük ve hızlı.
//
// Geri dönüş = temel (NORECOVERY) + o işlemin diferansiyeli (RECOVERY).
// Veritabanı o işlemin yapılmasından bir saniye öncesine döner.
//
// > VEGADB'nin kurtarma kipi SIMPLE. Bu yüzden işlem günlüğü yedeği ve
// > "istediğin saniyeye dön" mümkün değil; diferansiyel SIMPLE'da çalışıyor
// > ve elimizdeki en ince dilim bu.
//
// DİSK. Dosyalar döngüsel kullanılıyor: iki temel yuvası ve
// `yedekIslemSayisi` (varsayılan 20) işlem yuvası. Yeni yedek eskisinin
// ÜSTÜNE yazılıyor (WITH INIT), yani klasör sınırsız büyümüyor. Üstüne
// yazılan yedeğin panel kaydı `Gecerli = 0` oluyor ve listede görünmüyor.
//
// > İki temel yuvası şart. Tek yuva olsaydı yeni temel alınırken hâlâ
// > listede duran diferansiyellerin dayandığı dosya silinir, hepsi bir anda
// > geri yüklenemez hâle gelirdi.
//
// > Diferansiyelin temeli, sunucudaki EN SON copy-only olmayan tam yedektir.
// > Müşterinin kendi bakım planı araya bir tam yedek atarsa bizim
// > diferansiyelimiz onun üstüne oturur ve bizim temelimizle açılamaz.
// > `temelUyumluMu()` bunu msdb'den denetliyor; uymuyorsa yeni temel alınıp
// > diferansiyel bir kez daha çekiliyor.

const path = require('path');
const { sorgu, calistir, yonetimHavuzu } = require('./sql');
const { ayarOku } = require('./ayar');
const panel = require('./panel');

// Panel yalnızca bu iki veritabanına dokunuyor; yedek ve geri yükleme de
// bunlarla sınırlı. Ad doğrudan SQL metnine giriyor (veritabanı adı
// parametre olamaz), o yüzden her ad önce sys.databases'ten doğrulanıyor.
function veritabanlari() {
  const a = ayarOku();
  return [
    { ad: a.vegaVeritabani, etiket: 'Vega (asıl veri)', onemli: true },
    { ad: a.panelVeritabani, etiket: 'Panel (sayım, tutanak, kullanıcılar)', onemli: false }
  ];
}

// Veritabanı adını beyaz listeye ve sunucudaki gerçek listeye karşı doğrular.
// İkisini de geçmeyen ad SQL metnine hiç girmiyor.
async function adDogrula(havuz, ad) {
  const istenen = String(ad || '').trim();
  const izinli = veritabanlari().map((d) => d.ad);
  if (!izinli.includes(istenen)) {
    throw new Error(
      `"${istenen}" bu panelin yedekleyebileceği veritabanlarından değil ` +
      `(${izinli.join(', ')}).`
    );
  }
  const r = await havuz.request().input('ad', istenen).query(
    'SELECT name FROM sys.databases WHERE name = @ad'
  );
  if (!r.recordset.length) {
    throw new Error(`Sunucuda "${istenen}" adında bir veritabanı yok.`);
  }
  return istenen;
}

// Dosya adında yol ayracı, tırnak ya da komut kırıcı karakter olmasın.
// Yol parametre olarak gidiyor ama klasör ayarı elle yazılıyor; yine de
// dosya adını biz üretiyoruz ve geri yüklemede gelen yolu denetliyoruz.
function yolGuvenliMi(yol) {
  const m = String(yol || '');
  if (!m) return false;
  if (m.includes("'") || m.includes('"') || m.includes(';') || m.includes('\n')) return false;
  return /\.(bak|trn)$/i.test(m);
}

function damga(t) {
  const iki = (n) => String(n).padStart(2, '0');
  return (
    t.getFullYear() +
    iki(t.getMonth() + 1) +
    iki(t.getDate()) +
    '-' +
    iki(t.getHours()) +
    iki(t.getMinutes()) +
    iki(t.getSeconds())
  );
}

// --- Durum ----------------------------------------------------------------

// Ekran açılırken sorulan tek soru: yedek alabiliyor muyuz, klasör neresi,
// son yedek ne zaman alındı.
async function durum() {
  const a = ayarOku();
  const havuz = await yonetimHavuzu();
  try {
    const r = await havuz.request().query(`
      SELECT
        CAST(ISNULL(IS_SRVROLEMEMBER('sysadmin'), 0) AS INT)  AS sysadmin,
        CAST(ISNULL(IS_SRVROLEMEMBER('dbcreator'), 0) AS INT) AS dbcreator,
        CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS NVARCHAR(400)) AS varsayilanKlasor,
        CAST(SERVERPROPERTY('MachineName') AS NVARCHAR(200)) AS sunucu,
        CAST(SERVERPROPERTY('Edition') AS NVARCHAR(200)) AS surum
    `);
    const s = r.recordset[0] || {};

    // Yedek yetkisi veritabanı düzeyinde. IS_ROLEMEMBER bağlı olunan
    // veritabanına bakar ve master'dayken yanıltır; HAS_PERMS_BY_NAME
    // istenen veritabanını adıyla sorabiliyor, doğru araç bu.
    const yetkiler = [];
    for (const d of veritabanlari()) {
      try {
        const y = await havuz
          .request()
          .input('vt', d.ad)
          .query(`
            SELECT
              CAST(ISNULL(HAS_PERMS_BY_NAME(QUOTENAME(@vt), 'DATABASE', 'BACKUP DATABASE'), 0) AS INT) AS yedek,
              CASE WHEN DB_ID(@vt) IS NULL THEN 0 ELSE 1 END AS var
          `);
        const r = y.recordset[0] || {};
        yetkiler.push({
          ad: d.ad,
          etiket: d.etiket,
          onemli: d.onemli,
          var: !!Number(r.var),
          yedekYetkisi: !!Number(r.yedek)
        });
      } catch (e) {
        yetkiler.push({
          ad: d.ad, etiket: d.etiket, onemli: d.onemli,
          var: false, yedekYetkisi: false, hata: e.message
        });
      }
    }

    const klasor = (a.yedekKlasoru || '').trim() || (s.varsayilanKlasor || '').trim();

    return {
      sunucu: s.sunucu || a.sunucu,
      surum: s.surum || '',
      sysadmin: !!Number(s.sysadmin),
      dbcreator: !!Number(s.dbcreator),
      varsayilanKlasor: s.varsayilanKlasor || '',
      klasor,
      klasorAyarli: !!(a.yedekKlasoru || '').trim(),
      uyariSaat: Number(a.yedekUyariSaat) || 24,
      islemOncesiYedek: a.islemOncesiYedek !== false,
      islemSayisi: Math.max(2, Number(a.yedekIslemSayisi) || 20),
      temelSaat: Number(a.yedekTemelSaat) || 24,
      veritabanlari: yetkiler,
      sonYedek: await sonYedek()
    };
  } finally {
    try { await havuz.close(); } catch (e) { /* yoksay */ }
  }
}

// --- Yedek alma -----------------------------------------------------------

// Seçilen veritabanlarının tam yedeğini alır. Her veritabanı ayrı dosyaya
// yazılır; WITH INIT yok — eski yedeğin üstüne yazmıyoruz, yeni dosya
// açıyoruz ki bir öncekine dönme imkânı kalsın.
async function yedekAl(kayit) {
  await panel.kur();
  const a = ayarOku();
  const istenen = Array.isArray(kayit.veritabanlari) && kayit.veritabanlari.length
    ? kayit.veritabanlari
    : veritabanlari().map((d) => d.ad);

  const havuz = await yonetimHavuzu();
  const sonuclar = [];
  try {
    const kr = await havuz
      .request()
      .query(
        "SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS NVARCHAR(400)) AS k"
      );
    const klasor =
      (a.yedekKlasoru || '').trim() || String((kr.recordset[0] || {}).k || '').trim();
    if (!klasor) {
      throw new Error(
        'Yedek klasörü belirlenemedi. Ayarlar ekranından sunucudaki bir klasör yolu yazın ' +
        '(örn. D:\\SQLYedek). Klasör SUNUCUDA olmalı, bu bilgisayarda değil.'
      );
    }

    const zaman = new Date();
    for (const ham of istenen) {
      const ad = await adDogrula(havuz, ham);
      const dosyaAdi = `${ad}-${damga(zaman)}.bak`;
      const yol = path.win32.join(klasor, dosyaAdi);
      if (!yolGuvenliMi(yol)) {
        throw new Error(`Yedek yolu kullanılamaz: ${yol}`);
      }

      const baslangic = Date.now();
      try {
        // COPY_ONLY şart: elle alınan yedek, işlem öncesi diferansiyellerin
        // dayandığı temeli DEĞİŞTİRMEMELİ. Copy-only olmayan bir tam yedek
        // sunucudaki diferansiyel tabanını sıfırlar ve sonraki
        // diferansiyeller bizim temelimizle açılamaz hâle gelirdi.
        // Copy-only yedek kendi başına eksiksiz geri yüklenebilir.
        await havuz
          .request()
          .input('yol', yol)
          .input('adi', `${ad} - Galya Panel yedegi`)
          .query(
            `BACKUP DATABASE [${ad}] TO DISK = @yol
             WITH COPY_ONLY, FORMAT, INIT, NAME = @adi, SKIP, NOREWIND, NOUNLOAD, CHECKSUM`
          );
      } catch (e) {
        sonuclar.push({ veritabani: ad, tamam: false, mesaj: yedekHatasi(e) });
        continue;
      }

      const boyut = await dosyaBoyutu(havuz, ad, yol);
      sonuclar.push({
        veritabani: ad,
        tamam: true,
        dosya: yol,
        boyut,
        saniye: Math.round((Date.now() - baslangic) / 1000)
      });

      await calistir(
        `INSERT INTO [${panel.p()}].dbo.Yedek
           (Veritabani, Dosya, Boyut, Tur, Kullanici, Aciklama)
         VALUES (@vt, @dosya, @boyut, 'yedek', @kullanici, @not)`,
        {
          vt: ad,
          dosya: yol,
          boyut: boyut || 0,
          kullanici: kayit.kullanici || null,
          not: (kayit.not || '').substring(0, 300) || null
        }
      );
    }
  } finally {
    try { await havuz.close(); } catch (e) { /* yoksay */ }
  }

  const basarili = sonuclar.filter((s) => s.tamam);
  await panel.kayit(
    'Yedek',
    'Yedek alındı',
    { istenen, basarili: basarili.length, sonuclar },
    kayit.kullanici
  );

  if (!basarili.length) {
    const ilk = sonuclar[0];
    throw new Error(ilk ? ilk.mesaj : 'Yedek alınamadı.');
  }
  return { tamam: true, sonuclar, alinan: basarili.length };
}

// mssql sürücüsü BACKUP/RESTORE hatalarında yalnızca son satırı `message`
// alanına koyuyor: "BACKUP DATABASE is terminating abnormally." Asıl sebep
// ("BACKUP DATABASE permission denied in database 'VEGADB'.") bir önceki
// hatada, `precedingErrors` dizisinde duruyor. İkisini birleştirmezsek
// kullanıcı neden başarısız olduğunu hiç öğrenemiyor.
function hataMetni(e) {
  if (!e) return 'Bilinmeyen hata.';
  const parcalar = [];
  for (const onceki of e.precedingErrors || []) {
    if (onceki && onceki.message) parcalar.push(String(onceki.message));
  }
  const son = String(e.message || e);
  if (!parcalar.includes(son)) parcalar.push(son);
  return parcalar.join(' ');
}

// BACKUP hataları kullanıcıya olduğu gibi gösterilince anlaşılmıyor;
// en sık çıkan üçünü çevirip yönlendiriyoruz.
function yedekHatasi(e) {
  const m = hataMetni(e);
  if (/permission|izin|denied/i.test(m)) {
    return (
      'Yedek alma yetkisi yok. Sunucuda kurulum/sql-yedek-yetkisi-ver.sql ' +
      'dosyasını çalıştırın (SSMS ile, yönetici olarak). Ayrıntı: ' + m
    );
  }
  if (/Operating system error|cannot open backup device|access is denied/i.test(m)) {
    return (
      'SQL Server bu klasöre yazamıyor. Klasör SUNUCUDA olmalı ve SQL Server ' +
      'servis hesabının yazma izni bulunmalı. Ayrıntı: ' + m
    );
  }
  return m;
}

async function dosyaBoyutu(havuz, ad, yol) {
  try {
    const r = await havuz
      .request()
      .input('vt', ad)
      .input('yol', yol)
      .query(`
        SELECT TOP 1 CAST(B.backup_size AS BIGINT) AS boyut
        FROM msdb.dbo.backupset B
        JOIN msdb.dbo.backupmediafamily M ON M.media_set_id = B.media_set_id
        WHERE B.database_name = @vt AND M.physical_device_name = @yol
        ORDER BY B.backup_finish_date DESC
      `);
    return Number((r.recordset[0] || {}).boyut || 0);
  } catch (e) {
    // msdb okunamıyorsa boyut bilinmez; yedek yine de alındı.
    return 0;
  }
}

// --- İşlem öncesi yedek ---------------------------------------------------

// Döngüsel dosya adları. Zaman damgası YOK: aynı dosyanın üstüne yazılıyor.
function temelDosyaAdi(vt, slot) {
  return `${vt}-temel-${slot}.bak`;
}
function islemDosyaAdi(vt, slot) {
  return `${vt}-islem-${String(slot).padStart(2, '0')}.bak`;
}

// Yedek klasörünü bir kez çözer. Ayarda yoksa SQL Server'ın varsayılanı.
async function klasorCoz(havuz) {
  const a = ayarOku();
  const elle = (a.yedekKlasoru || '').trim();
  if (elle) return elle;
  const r = await havuz
    .request()
    .query("SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS NVARCHAR(400)) AS k");
  const k = String((r.recordset[0] || {}).k || '').trim();
  if (!k) {
    throw new Error(
      'Yedek klasörü belirlenemedi. Ayarlar ekranından sunucudaki bir klasör yolu yazın.'
    );
  }
  return k;
}

// Alınan diferansiyel gerçekten bizim temelimize mi dayanıyor?
// msdb okunamıyorsa denetleyemiyoruz; o durumda "uyumlu" sayıp devam
// ediyoruz — yedek yine alındı, yalnızca doğrulanamadı.
async function temelUyumluMu(havuz, vt, temelYol, islemYol) {
  try {
    const r = await havuz
      .request()
      .input('vt', vt)
      .input('temel', temelYol)
      .input('islem', islemYol)
      .query(`
        SELECT
          (SELECT TOP 1 B.backup_set_uuid
             FROM msdb.dbo.backupset B
             JOIN msdb.dbo.backupmediafamily M ON M.media_set_id = B.media_set_id
            WHERE B.database_name = @vt AND B.type = 'D'
              AND M.physical_device_name = @temel
            ORDER BY B.backup_finish_date DESC) AS temelGuid,
          (SELECT TOP 1 B.differential_base_guid
             FROM msdb.dbo.backupset B
             JOIN msdb.dbo.backupmediafamily M ON M.media_set_id = B.media_set_id
            WHERE B.database_name = @vt AND B.type = 'I'
              AND M.physical_device_name = @islem
            ORDER BY B.backup_finish_date DESC) AS islemTemelGuid
      `);
    const x = r.recordset[0] || {};
    if (!x.temelGuid || !x.islemTemelGuid) return true; // denetlenemedi
    return String(x.temelGuid).toLowerCase() === String(x.islemTemelGuid).toLowerCase();
  } catch (e) {
    return true;
  }
}

// Yeni bir temel (tam yedek) alır ve boşta olan yuvayı kullanır.
// Üstüne yazılan yuvaya dayanan işlem yedekleri geçersizleşir.
async function temelAl(havuz, vt, klasor, kullanici) {
  await panel.kur();
  const p = panel.p();

  const mevcut = await sorgu(
    `SELECT TOP 1 Slot AS slot FROM [${p}].dbo.Yedek
     WHERE Veritabani = @vt AND Tur = 'temel' AND Gecerli = 1
     ORDER BY Id DESC`,
    { vt }
  );
  // İki yuva dönüşümlü. Böylece yeni temel, hâlâ listede duran
  // diferansiyellerin dayandığı dosyayı silmiyor.
  const slot = mevcut.length && Number(mevcut[0].slot) === 1 ? 2 : 1;
  const yol = path.win32.join(klasor, temelDosyaAdi(vt, slot));

  try {
    await havuz
      .request()
      .input('yol', yol)
      .input('adi', `${vt} - Galya Panel islem oncesi temel`)
      .query(
        `BACKUP DATABASE [${vt}] TO DISK = @yol
         WITH FORMAT, INIT, NAME = @adi, SKIP, CHECKSUM`
      );
  } catch (e) {
    throw new Error(yedekHatasi(e));
  }

  // Bu dosyanın üstüne yazdık: ona dayanan her şey artık açılamaz.
  await calistir(
    `UPDATE [${p}].dbo.Yedek SET Gecerli = 0
     WHERE Veritabani = @vt AND Gecerli = 1
       AND (Dosya = @yol OR TemelDosya = @yol)`,
    { vt, yol }
  );

  const boyut = await dosyaBoyutu(havuz, vt, yol);
  await calistir(
    `INSERT INTO [${p}].dbo.Yedek
       (Veritabani, Dosya, Boyut, Tur, Kullanici, Aciklama, Slot, Gecerli)
     VALUES (@vt, @yol, @boyut, 'temel', @kullanici, @aciklama, @slot, 1)`,
    {
      vt,
      yol,
      boyut: boyut || 0,
      kullanici: kullanici || null,
      aciklama: 'İşlem öncesi yedeklerin temeli',
      slot
    }
  );

  return { yol, slot, boyut };
}

// Geçerli temeli bulur; yoksa ya da eskiyse yenisini alır.
async function temelHazirla(havuz, vt, klasor, kullanici, zorla) {
  await panel.kur();
  const a = ayarOku();
  const p = panel.p();
  const esik = Number(a.yedekTemelSaat) || 24;

  if (!zorla) {
    const r = await sorgu(
      `SELECT TOP 1 Dosya AS dosya, Slot AS slot, Tarih AS tarih
       FROM [${p}].dbo.Yedek
       WHERE Veritabani = @vt AND Tur = 'temel' AND Gecerli = 1
       ORDER BY Id DESC`,
      { vt }
    );
    if (r.length) {
      const yas = (Date.now() - new Date(r[0].tarih).getTime()) / 3600000;
      if (yas < esik) return { yol: r[0].dosya, slot: Number(r[0].slot), yeni: false };
    }
  }

  const yeni = await temelAl(havuz, vt, klasor, kullanici);
  return { yol: yeni.yol, slot: yeni.slot, yeni: true };
}

// Sıradaki işlem yuvası. Dolan yuvanın üstüne yazılıyor; o yuvadaki eski
// kayıt geçersizleşiyor.
async function siradakiIslemSlotu(vt) {
  const a = ayarOku();
  const p = panel.p();
  const adet = Math.max(2, Number(a.yedekIslemSayisi) || 20);
  const r = await sorgu(
    `SELECT TOP 1 Slot AS slot FROM [${p}].dbo.Yedek
     WHERE Veritabani = @vt AND Tur = 'islem'
     ORDER BY Id DESC`,
    { vt }
  );
  const son = r.length ? Number(r[0].slot) : 0;
  return (son % adet) + 1;
}

// İŞLEM ÖNCESİ YEDEK — Vega'ya yazan her kanaldan önce çağrılıyor.
//
// Dönüşü `{ tamam, dosya, temelDosya, saniye }`. Hata FIRLATIR: yedek
// alınamadıysa işlem hiç başlamamalı, güvenlik ağı olmadan Vega'ya
// yazılmamalı. Bu davranış ayarlardan (islemOncesiYedek) kapatılabiliyor.
async function islemOncesiYedek(kayit) {
  await panel.kur();
  const a = ayarOku();
  const vt = a.vegaVeritabani;
  const p = panel.p();
  const baslangic = Date.now();

  const havuz = await yonetimHavuzu();
  try {
    const klasor = await klasorCoz(havuz);
    let temel = await temelHazirla(havuz, vt, klasor, kayit.kullanici, false);

    const slot = await siradakiIslemSlotu(vt);
    const yol = path.win32.join(klasor, islemDosyaAdi(vt, slot));

    async function diferansiyelAl() {
      try {
        await havuz
          .request()
          .input('yol', yol)
          .input('adi', `${vt} - islem oncesi`)
          .query(
            `BACKUP DATABASE [${vt}] TO DISK = @yol
             WITH DIFFERENTIAL, FORMAT, INIT, NAME = @adi, SKIP, CHECKSUM`
          );
      } catch (e) {
        throw new Error(yedekHatasi(e));
      }
    }

    await diferansiyelAl();

    // Araya başka bir tam yedek girdiyse diferansiyel bizim temelimize
    // dayanmıyordur; yeni temel alıp bir kez daha çekiyoruz.
    if (!(await temelUyumluMu(havuz, vt, temel.yol, yol))) {
      temel = await temelHazirla(havuz, vt, klasor, kayit.kullanici, true);
      await diferansiyelAl();
    }

    // Bu yuvanın üstüne yazdık: eski kaydı listeden düşür.
    await calistir(
      `UPDATE [${p}].dbo.Yedek SET Gecerli = 0
       WHERE Veritabani = @vt AND Tur = 'islem' AND Dosya = @yol AND Gecerli = 1`,
      { vt, yol }
    );

    const boyut = await dosyaBoyutu(havuz, vt, yol);
    await calistir(
      `INSERT INTO [${p}].dbo.Yedek
         (Veritabani, Dosya, Boyut, Tur, Kullanici, Aciklama, TemelDosya, Islem, Slot, Gecerli)
       VALUES (@vt, @yol, @boyut, 'islem', @kullanici, @aciklama, @temel, @islem, @slot, 1)`,
      {
        vt,
        yol,
        boyut: boyut || 0,
        kullanici: kayit.kullanici || null,
        aciklama: kayit.aciklama || null,
        temel: temel.yol,
        islem: (kayit.islem || '').substring(0, 200) || null,
        slot
      }
    );

    return {
      tamam: true,
      dosya: yol,
      temelDosya: temel.yol,
      temelYeni: temel.yeni,
      boyut,
      saniye: Math.round((Date.now() - baslangic) / 1000)
    };
  } finally {
    try { await havuz.close(); } catch (e) { /* yoksay */ }
  }
}

// Geri dönüş noktaları: hangi işlemden önceye dönülebilir.
async function donusNoktalari(secim) {
  await panel.kur();
  const a = ayarOku();
  const p = panel.p();
  const sinir = Number(secim && secim.sinir) || 50;
  return sorgu(
    `SELECT TOP ${sinir}
       Id AS id, Tarih AS tarih, Veritabani AS veritabani, Dosya AS dosya,
       TemelDosya AS temelDosya, Boyut AS boyut, Islem AS islem,
       Kullanici AS kullanici, Slot AS slot
     FROM [${p}].dbo.Yedek
     WHERE Veritabani = @vt AND Tur = 'islem' AND Gecerli = 1
     ORDER BY Id DESC`,
    { vt: a.vegaVeritabani }
  );
}

// --- Yedek listesi --------------------------------------------------------

// Liste iki kaynaktan geliyor:
//   msdb.dbo.backupset  — sunucudaki BÜTÜN yedekler (SSMS, bakım planı,
//                         başka bir programla alınanlar dahil)
//   GALYA_PANEL.dbo.Yedek — panelin kendi aldıkları
// msdb okunabiliyorsa o esas alınır; okunamazsa panel tablosu gösterilir.
async function liste(secim) {
  await panel.kur();
  const adlar = veritabanlari().map((d) => d.ad);
  const sinir = Number(secim && secim.sinir) || 50;

  let sunucudakiler = [];
  let msdbOkundu = false;
  const havuz = await yonetimHavuzu();
  try {
    const parametreler = {};
    const yerTutucular = adlar.map((ad, i) => {
      parametreler['vt' + i] = ad;
      return '@vt' + i;
    });
    const istek = havuz.request();
    for (const k of Object.keys(parametreler)) istek.input(k, parametreler[k]);
    const r = await istek.query(`
      SELECT TOP ${sinir}
        B.database_name              AS veritabani,
        B.backup_finish_date         AS tarih,
        CAST(B.backup_size AS BIGINT) AS boyut,
        B.type                       AS tur,
        B.user_name                  AS sqlKullanici,
        M.physical_device_name       AS dosya
      FROM msdb.dbo.backupset B
      JOIN msdb.dbo.backupmediafamily M ON M.media_set_id = B.media_set_id
      WHERE B.database_name IN (${yerTutucular.join(', ')})
        AND B.type = 'D'
      ORDER BY B.backup_finish_date DESC
    `);
    sunucudakiler = r.recordset || [];
    msdbOkundu = true;
  } catch (e) {
    sunucudakiler = [];
  } finally {
    try { await havuz.close(); } catch (e) { /* yoksay */ }
  }

  const panelKayitlari = await sorgu(
    `SELECT TOP ${sinir}
       Id AS id, Tarih AS tarih, Veritabani AS veritabani, Dosya AS dosya,
       Boyut AS boyut, Tur AS tur, Kullanici AS kullanici, Aciklama AS aciklama
     FROM [${panel.p()}].dbo.Yedek
     ORDER BY Id DESC`
  );

  // Panelin kendi kaydı varsa "kim aldı" bilgisi oradan tamamlanıyor.
  const kimHaritasi = new Map(
    panelKayitlari.filter((k) => k.dosya).map((k) => [String(k.dosya).toLowerCase(), k])
  );

  return {
    msdbOkundu,
    yedekler: msdbOkundu
      ? sunucudakiler.map((y) => {
          const k = kimHaritasi.get(String(y.dosya || '').toLowerCase());
          return {
            tarih: y.tarih,
            veritabani: y.veritabani,
            dosya: y.dosya,
            boyut: Number(y.boyut || 0),
            kullanici: k ? k.kullanici : null,
            aciklama: k ? k.aciklama : null,
            panelinAldigi: !!k
          };
        })
      : panelKayitlari.map((k) => ({
          tarih: k.tarih,
          veritabani: k.veritabani,
          dosya: k.dosya,
          boyut: Number(k.boyut || 0),
          kullanici: k.kullanici,
          aciklama: k.aciklama,
          panelinAldigi: true
        })),
    gecmis: panelKayitlari
  };
}

// En son alınan yedeğin zamanı. "Yedek almayı unutmayın" uyarısı buna bakıyor.
async function sonYedek() {
  await panel.kur();
  const a = ayarOku();
  // İşlem öncesi yedekler de birer yedektir; "yedek almayı unutmayın"
  // uyarısı onlar alınırken çıkmamalı.
  const r = await sorgu(
    `SELECT TOP 1 Tarih AS tarih, Veritabani AS veritabani, Dosya AS dosya, Kullanici AS kullanici
     FROM [${panel.p()}].dbo.Yedek
     WHERE Tur IN ('yedek', 'temel', 'islem') AND Veritabani = @vt
     ORDER BY Id DESC`,
    { vt: a.vegaVeritabani }
  );
  if (!r.length) return null;
  const y = r[0];
  return {
    tarih: y.tarih,
    veritabani: y.veritabani,
    dosya: y.dosya,
    kullanici: y.kullanici,
    saatOnce: (Date.now() - new Date(y.tarih).getTime()) / 3600000
  };
}

// Uyarı: Vega'ya yazan bir işe girmeden önce ekranda gösterilen bilgi.
// Yedek hiç alınmamışsa ya da ayarlardaki saatten eskiyse `gerekli` döner.
async function hatirlatma() {
  const a = ayarOku();
  const esik = Number(a.yedekUyariSaat) || 24;
  let son = null;
  try {
    son = await sonYedek();
  } catch (e) {
    // Panel veritabanı okunamıyorsa uyarıyı gösterelim, saklamayalım.
    return { gerekli: true, son: null, esik, mesaj: 'Son yedek bilgisi okunamadı.' };
  }
  if (!son) {
    return {
      gerekli: true,
      son: null,
      esik,
      mesaj: "Bu panelden hiç yedek alınmamış. Vega'ya yazmadan önce yedek alın."
    };
  }
  const gerekli = son.saatOnce >= esik;
  return {
    gerekli,
    son,
    esik,
    mesaj: gerekli
      ? `Son yedek ${Math.floor(son.saatOnce)} saat önce alındı. Yedek almayı unutmayın.`
      : `Son yedek ${Math.floor(son.saatOnce)} saat önce alındı.`
  };
}

// --- Geri yükleme ---------------------------------------------------------

// GERİ YÜKLEME HER ŞEYİ SİLER. Veritabanı yedeğin alındığı ana döner;
// arada yapılan bütün satışlar, faturalar, sayımlar gider. Ayrıca
// SINGLE_USER'a alındığı için Vega ve Şefim dahil bağlı olan HERKES atılır.
//
// Bu yüzden:
//   - yalnızca yönetici veya yedekGeriYukle yetkili kullanıcı çağırabiliyor,
//   - arayüz veritabanı adını elle yazdırıyor,
//   - geri yüklemeden ÖNCE otomatik bir güvenlik yedeği alınıyor
//     (yanlış dosyayı seçen kişi bugüne dönebilsin diye).
async function geriYukle(kayit) {
  await panel.kur();
  const dosya = String(kayit.dosya || '').trim();
  if (!yolGuvenliMi(dosya)) {
    throw new Error('Geri yüklenecek yedek dosyası seçilmedi ya da yolu kullanılamaz.');
  }

  // Diferansiyel yedekten dönüş: önce temel (NORECOVERY), sonra
  // diferansiyel (RECOVERY). Temel dosyası panel kaydından geliyor.
  const temelDosya = String(kayit.temelDosya || '').trim();
  if (temelDosya && !yolGuvenliMi(temelDosya)) {
    throw new Error('Yedeğin dayandığı tam yedek dosyası kullanılamaz: ' + temelDosya);
  }

  const havuz = await yonetimHavuzu();
  let ad = null;
  let guvenlikYedegi = null;
  try {
    ad = await adDogrula(havuz, kayit.veritabani);

    // Dosya gerçekten bu veritabanının yedeği mi? Yanlış dosyayla geri
    // yükleme veritabanını bambaşka bir verinin üstüne yazardı.
    // Zincirdeki her dosya gerçekten bu veritabanının yedeği mi? Yanlış
    // dosyayla geri yükleme veritabanını bambaşka bir verinin üstüne yazardı.
    //
    // RESTORE HEADERONLY, dosyayı yalnızca OKUduğu hâlde CREATE DATABASE
    // yetkisi istiyor. Bu yetki verilmemiş kurulumlarda denetim yapılamıyor;
    // o durumda geri yüklemeyi engellemek yerine denetimi atlıyoruz —
    // engelleseydik yetki eksikliği yüzünden geri dönüş hiç çalışmazdı.
    // (RESTORE'un kendisi veritabanının sahibi için yeterlidir.)
    async function basligiDogrula(yol) {
      let basliklar;
      try {
        basliklar = await havuz
          .request()
          .input('yol', yol)
          .query('RESTORE HEADERONLY FROM DISK = @yol');
      } catch (e) {
        const m = hataMetni(e);
        if (/permission denied|izin/i.test(m)) return null; // denetlenemedi
        throw new Error('Yedek dosyası okunamadı: ' + m);
      }
      const baslik = (basliklar.recordset || [])[0];
      if (!baslik) throw new Error('Yedek dosyası okunamadı ya da boş: ' + yol);
      if (String(baslik.DatabaseName || '').trim() !== ad) {
        throw new Error(
          `Bu dosya "${baslik.DatabaseName}" veritabanının yedeği, "${ad}" değil. ` +
          'Yanlış dosya seçilmiş.'
        );
      }
      return baslik;
    }

    if (temelDosya) await basligiDogrula(temelDosya);
    await basligiDogrula(dosya);

    // Güvenlik yedeği: geri yüklemeden önceki hâl.
    if (kayit.guvenlikYedegi !== false) {
      try {
        const sonuc = await yedekAl({
          veritabanlari: [ad],
          kullanici: kayit.kullanici,
          not: 'Geri yükleme öncesi otomatik güvenlik yedeği'
        });
        guvenlikYedegi = (sonuc.sonuclar.find((s) => s.tamam) || {}).dosya || null;
      } catch (e) {
        throw new Error(
          'Geri yükleme öncesi güvenlik yedeği alınamadı, işlem durduruldu: ' +
          (e.message || e) +
          ' — yedeksiz geri yükleme yapılmadı.'
        );
      }
    }

    // Tek kullanıcıya al, geri yükle, çok kullanıcıya döndür. Hata çıksa
    // bile veritabanını SINGLE_USER'da bırakmıyoruz; öyle kalsaydı Vega ve
    // Şefim hiç bağlanamazdı.
    await havuz.request().query(
      `ALTER DATABASE [${ad}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`
    );
    try {
      if (temelDosya) {
        // Diferansiyel zinciri: temel açılıp KAPATILMADAN bırakılıyor,
        // üstüne diferansiyel bindirilip veritabanı öyle açılıyor.
        await havuz
          .request()
          .input('yol', temelDosya)
          .query(`RESTORE DATABASE [${ad}] FROM DISK = @yol WITH REPLACE, NORECOVERY`);
        await havuz
          .request()
          .input('yol', dosya)
          .query(`RESTORE DATABASE [${ad}] FROM DISK = @yol WITH RECOVERY`);
      } else {
        await havuz
          .request()
          .input('yol', dosya)
          .query(`RESTORE DATABASE [${ad}] FROM DISK = @yol WITH REPLACE, RECOVERY`);
      }
    } catch (e) {
      const hata = new Error('Geri yükleme başarısız: ' + hataMetni(e));
      hata.kod = 'GERI_YUKLEME';
      throw hata;
    } finally {
      try {
        await havuz.request().query(`ALTER DATABASE [${ad}] SET MULTI_USER`);
      } catch (e) {
        // Geri yükleme başarılıysa veritabanı zaten MULTI_USER açılır.
      }
    }
  } finally {
    try { await havuz.close(); } catch (e) { /* yoksay */ }
  }

  await calistir(
    `INSERT INTO [${panel.p()}].dbo.Yedek (Veritabani, Dosya, Boyut, Tur, Kullanici, Aciklama)
     VALUES (@vt, @dosya, 0, 'geriyukleme', @kullanici, @not)`,
    {
      vt: ad,
      dosya,
      kullanici: kayit.kullanici || null,
      not: guvenlikYedegi ? 'Güvenlik yedeği: ' + guvenlikYedegi : null
    }
  ).catch(() => {
    // Panel veritabanı geri yüklenmişse bu tablo eski hâline dönmüş olabilir;
    // kaydın tutulamaması işlemi bozmaz.
  });

  await panel.kayit(
    'Yedek',
    'Yedekten geri yüklendi',
    { veritabani: ad, dosya, guvenlikYedegi },
    kayit.kullanici
  );

  return { tamam: true, veritabani: ad, dosya, guvenlikYedegi };
}

module.exports = {
  durum,
  yedekAl,
  islemOncesiYedek,
  donusNoktalari,
  liste,
  sonYedek,
  hatirlatma,
  geriYukle,
  veritabanlari
};
