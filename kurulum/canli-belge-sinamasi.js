'use strict';

// CANLI BELGE SINAMASI — "Vega bu belgeyi açıyor mu?"
//
//   node kurulum/canli-belge-sinamasi.js --vt VEGADBozdemirkaya --firma F0101 --donem D0017
//   node kurulum/canli-belge-sinamasi.js --vt VEGADBozdemirkaya --geri-al
//
// NEDEN VAR
//
// `test-kolon-denetimi.js` panelin doldurduğu kolonları Vega'nınkilerle
// karşılaştırıyor ve "eksik alan yok" diyebiliyor. Ama bunun TEK gerçek
// kanıtı belgenin Vega'nın kendi ekranında açılmasıdır. Belge doldurucu
// işinde satırlar tabloya girmişti, stok da doğru hareket etmişti; sorun
// ancak Vega belgeyi açmaya çalıştığında görüldü.
//
// Bu betik LİSANSLI bir Vega veritabanına her belge tipinden birer tane
// yazar, numaralarını söyler; siz Vega A5'i o veritabanıyla açıp belgeleri
// görürsünüz. Sonra `--geri-al` ile hepsi silinir.
//
// NE YAZAR
//
//   tutanak         stok çıkış (33) + stok giriş (32)
//   zayi            stok çıkış (33) + cari hareketi — FİYATSIZ (borç 0)
//   alış faturası   fatura (20) + cari hareketi — 1 adet × 1 TL
//   sayım           sayım girişi (93) + sayım çıkışı (94)
//
// ÜRETİM: varsayılan olarak YAZILMAZ. `--uretim` verilirse dört çıktılı bir
// reçete kurup üretim fişi de yazar (38 + 38 + 97 + 96 + TBLSHAREKET).
//
// Neden varsayılan kapalı: üretim 96/97 sayacını kullanıyor ve o sayaç
// müşterinin kurulumunda Şefim entegrasyonuyla paylaşılıyor (günde 250-600
// belge). Müşterinin CANLI veritabanında sınama amaçlı ilerletmek doğru
// değil.
//
// Nerede açılmalı: Şefim'in dokunmadığı bir sınama kopyasında. Bu makinede
// `VEGADB_cazgır` öyle — üretim modülü canlı kullanılmış (F0118D0001'de 380
// üretim fişi) ve müşteri verisi değil:
//
//   node kurulum/canli-belge-sinamasi.js --vt VEGADB_cazgır \
//        --firma F0118 --donem D0001 --uretim
//
// Panelin üretim tarafı yeniden yazıldıktan sonra Vega'nın Üretim Giriş /
// Çıkış Fişi ekranında HİÇ açılmadı; bu bayrak onun içindir.
//
// GÜVENLİK
//
//   - Miktarlar 1 adet, fatura tutarı 1 TL, zayi fiyatsız (cari borcu 0).
//   - Belge numaraları panelin kendi serisinden gelir (ayarlardaki
//     `belgeOneki`, varsayılan GP). Vega'nın kendi A ve Z serileriyle
//     çakışmaz — belgeler numarasından tanınır.
//   - Yazılan her kimlik `kurulum/yakalanan/canli-belgeler.json` dosyasına
//     düşer. Bu dosya durdukça `--geri-al` her şeyi geri alabilir; oturum
//     kapansa bile.
//   - Açıklamalara "Galya Panel sınama - silinecek" yazılır.
//
// ÖNCE: hedef veritabanının yedeğini alın ya da gerçekten atılabilir bir
// kopya olduğundan emin olun.

const path = require('path');
const fs = require('fs');
const os = require('os');

const kok = path.join(__dirname, '..');

function arg(ad, varsayilan) {
  const i = process.argv.indexOf('--' + ad);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : varsayilan;
}

const gercek = JSON.parse(
  fs.readFileSync(path.join(kok, 'ayarlar.json'), 'utf8').replace(/^﻿/, '')
);

const HEDEF_VT = arg('vt', gercek.vegaVeritabani);
const FIRMA = arg('firma', gercek.varsayilanFirma);
const DONEM = arg('donem', gercek.varsayilanDonem);
const DEPO = Number(arg('depo', gercek.varsayilanDepo || 1));
const GERI_AL = process.argv.includes('--geri-al');
const URETIM = process.argv.includes('--uretim');

const gunlukKlasoru = path.join(__dirname, 'yakalanan');
const GUNLUK = path.join(gunlukKlasoru, 'canli-belgeler.json');

const ayarDosyasi = path.join(os.tmpdir(), 'galya-canli-sinama-ayarlar.json');
fs.writeFileSync(
  ayarDosyasi,
  JSON.stringify(
    Object.assign({}, gercek, {
      vegaVeritabani: HEDEF_VT,
      varsayilanFirma: FIRMA,
      varsayilanDonem: DONEM,
      varsayilanDepo: DEPO,
      vegayaYazmaAktif: true,
      // Hedef veritabanı çok büyük olabiliyor (Özdemirkaya 19,7 GB);
      // her belge için yedek almak pratik değil. Geri alma panelin kendi
      // geriAl uçlarıyla yapılıyor ve günlüğe yazılıyor.
      islemOncesiYedek: false
    }),
    null,
    2
  ),
  'utf8'
);
process.env.GALYA_AYAR_DOSYASI = ayarDosyasi;

const sql = require(path.join(kok, 'db', 'sql'));
const yazma = require(path.join(kok, 'db', 'yazma'));
const panelDb = require(path.join(kok, 'db', 'panel'));

const SECIM = { firma: FIRMA, donem: DONEM, depo: DEPO };
const T = `[${HEDEF_VT}].dbo.${FIRMA}`;
const TD = `[${HEDEF_VT}].dbo.${FIRMA}${DONEM}`;
const KULLANICI = 'galya-sinama';
const ACIKLAMA = 'Galya Panel sınama - silinecek';

function gunlukOku() {
  try { return JSON.parse(fs.readFileSync(GUNLUK, 'utf8')); } catch (e) { return []; }
}
function ekle(kayit) {
  if (!fs.existsSync(gunlukKlasoru)) fs.mkdirSync(gunlukKlasoru, { recursive: true });
  const g = gunlukOku();
  g.push(Object.assign({ zaman: new Date().toISOString(), vt: HEDEF_VT, firma: FIRMA, donem: DONEM }, kayit));
  fs.writeFileSync(GUNLUK, JSON.stringify(g, null, 2), 'utf8');
}

async function depodakiKalan(stokNo) {
  const r = await sql.sorgu(
    `SELECT ISNULL(SUM(ENVANTER), 0) AS k FROM ${TD}TBLDEPOENVANTER
     WHERE STOKNO = @s AND DEPO = @d AND BELGETIPI <> 67`,
    { s: stokNo, d: DEPO }
  );
  return Number(r[0].k);
}

async function yazmaKipi() {
  console.log('== Canlı belge sınaması ==');
  console.log(`   Hedef : ${HEDEF_VT} · ${FIRMA} · ${DONEM} · depo ${DEPO}`);
  console.log(`   Günlük: ${GUNLUK}\n`);

  await panelDb.kur();
  const pAd = panelDb.p();

  // Seçilen depoda en az 3 adet stoğu olan iki kart.
  const adaylar = await sql.sorgu(`
    SELECT TOP 40 S.IND AS stokNo, ISNULL(S.STOKKODU,'') AS kod, S.MALINCINSI AS ad
    FROM ${T}TBLSTOKLAR S
    WHERE ISNULL(S.DELETED,0) = 0 AND S.IND >= 100
      AND EXISTS (SELECT 1 FROM ${TD}TBLDEPOENVANTER E
                  WHERE E.STOKNO = S.IND AND E.DEPO = ${DEPO} AND E.BELGETIPI <> 67
                  GROUP BY E.STOKNO HAVING SUM(E.ENVANTER) >= 3)
    ORDER BY S.IND
  `);
  if (adaylar.length < 2) {
    console.log(`Depo ${DEPO} içinde yeterli stoğu olan iki kart bulunamadı.`);
    process.exit(1);
  }
  const A = adaylar[0];
  const B = adaylar[1];
  console.log(`   Kart A: #${A.stokNo} ${A.ad} (kalan ${await depodakiKalan(A.stokNo)})`);
  console.log(`   Kart B: #${B.stokNo} ${B.ad} (kalan ${await depodakiKalan(B.stokNo)})`);

  // Zayi/fatura carisi: bu firmada 33 belgelerinde en çok kullanılan cari.
  const cariler = await sql.sorgu(`
    SELECT TOP 1 B.FIRMANO AS cariNo, ISNULL(C.FIRMAADI,'') AS ad
    FROM ${TD}TBLSTKCIKBASLIK B
    LEFT JOIN ${T}TBLCARI C ON C.IND = B.FIRMANO
    WHERE B.BELGETIPI = 33 AND B.FIRMANO > 0
    GROUP BY B.FIRMANO, C.FIRMAADI ORDER BY COUNT(*) DESC
  `);
  if (!cariler.length) { console.log('Uygun cari bulunamadı.'); process.exit(1); }
  const cari = cariler[0];
  console.log(`   Cari  : #${cari.cariNo} ${cari.ad}\n`);

  const tutanak = await yazma.tutanakFisiYaz(Object.assign({}, SECIM, {
    dusenStokNo: A.stokNo, dusenMiktar: 1,
    artanStokNo: B.stokNo, artanMiktar: 1,
    sebep: ACIKLAMA, kullanici: KULLANICI
  }));
  ekle({ tur: 'tutanak', fisler: tutanak.fisler });
  console.log(`   TUTANAK  çıkış ${tutanak.cikisBelgeNo} (33) · giriş ${tutanak.girisBelgeNo} (32)`);

  const zayi = await yazma.zayiFisiYaz(Object.assign({}, SECIM, {
    cariNo: cari.cariNo, cariAdi: cari.ad, altHesap: 'ZAYİ',
    sebep: ACIKLAMA, maliyetliMi: false,
    satirlar: [{ stokNo: A.stokNo, miktar: 1 }],
    kullanici: KULLANICI, userNo: 0
  }));
  ekle({ tur: 'zayi', belgeNo: zayi.belgeNo, baslikInd: zayi.baslikInd });
  console.log(`   ZAYİ     ${zayi.belgeNo} (33) · cari borcu 0 (fiyatsız)`);

  const fatura = await yazma.alisFaturasiYaz(Object.assign({}, SECIM, {
    cariNo: cari.cariNo, cariAdi: cari.ad, belgeNo: null, tarih: new Date(),
    satirlar: [{ stokNo: A.stokNo, stokAdi: A.ad, miktar: 1, birimFiyat: 1, kdvOrani: 20 }],
    kullanici: KULLANICI, userNo: 0
  }));
  ekle({ tur: 'fatura', belgeNo: fatura.belgeNo, baslikInd: fatura.baslikInd });
  console.log(`   FATURA   ${fatura.belgeNo} (20) · 1 adet × 1 TL`);

  const sb = await sql.sorgu(
    `INSERT INTO [${pAd}].dbo.AraSayim (Firma, Donem, Depo, Sayan, Aciklama)
     OUTPUT INSERTED.Id AS id VALUES (@f, @d, @dp, @s, @a)`,
    { f: FIRMA, d: DONEM, dp: DEPO, s: KULLANICI, a: ACIKLAMA }
  );
  const sayimId = sb[0].id;
  for (const [stokNo, fark] of [[A.stokNo, 1], [B.stokNo, -1]]) {
    await sql.calistir(
      `INSERT INTO [${pAd}].dbo.AraSayimSatir
         (SayimId, StokNo, StokAdi, Birim, TeorikMiktar, SayilanMiktar, BirimMaliyet)
       VALUES (@sayimId, @stokNo, 'sınama', 'ADET', 0, @sayilan, 1)`,
      { sayimId, stokNo, sayilan: (await depodakiKalan(stokNo)) + fark }
    );
  }
  const sayim = await yazma.sayimFisiYaz(
    Object.assign({}, SECIM, { sayimId, kullanici: KULLANICI })
  );
  ekle({ tur: 'sayim', sayimId, belgeNo: sayim.belgeNo });
  console.log(`   SAYIM    giriş ${sayim.girisBelgeNo} (93) · çıkış ${sayim.cikisBelgeNo} (94)`);

  if (URETIM) await uretimYaz(A, B, adaylar);
  else console.log('   ÜRETİM     atlandı (--uretim ile açılır)');

  console.log('\n   Şimdi Vega A5 ile bu veritabanını açıp belgeleri görün.');
  console.log('   Hepsini silmek için:');
  console.log(`     node kurulum/canli-belge-sinamasi.js --vt ${HEDEF_VT} --geri-al`);
}

// Dört çıktılı bir reçete kurup üretim fişi yazar. Reçete de günlüğe
// düşüyor; geri almada silinsin diye.
async function uretimYaz(A, B, adaylar) {
  if (adaylar.length < 5) {
    console.log('   ÜRETİM     atlandı (dört çıktı için 5 stok kartı gerekiyor)');
    return;
  }
  const [HAM, MAMUL, YAN1, YAN2, FIRE] = adaylar.slice(0, 5).map((x) => x.stokNo);

  const mevcut = await sql.sorgu(
    `SELECT IND FROM ${T}TBLURERECETELIST WHERE STOKNO = @s`, { s: MAMUL });
  if (mevcut.length) {
    console.log(`   ÜRETİM     atlandı (#${MAMUL} kartının reçetesi zaten var, dokunulmadı)`);
    return;
  }

  await yazma.receteOlustur(
    Object.assign({}, SECIM, { mamulNo: MAMUL, verim: 1, kullanici: KULLANICI }));
  const receteNo = (await sql.sorgu(
    `SELECT IND FROM ${T}TBLURERECETELIST WHERE STOKNO = @s`, { s: MAMUL }))[0].IND;
  await yazma.receteSatiriEkle(
    Object.assign({}, SECIM, { receteNo, stokNo: HAM, miktar: 1, kullanici: KULLANICI }));

  // Videodaki DANA ANTRIKOT reçetesinin aynısı: dört çıktı, oran toplamı 200.
  for (const c of [[MAMUL, 0, 100], [YAN1, 2, 0], [YAN2, 2, 100], [FIRE, 2, 0]]) {
    await sql.calistir(
      `INSERT INTO ${T}TBLURERECETECIKTI
         (EVRAKNO, STOKNO, STOKKODU, MALINCINSI, MIKTAR, BIRIM, BIRIMMIKTAR,
          KDV, FIYAT, ISLEMTARIHI, ORAN, TUR, TUTAR, POZISYONNO, KALANMIKTAR)
       VALUES (@r, @s, '', '', 1, '', 1, 0, 0, GETDATE(), @o, @t, 0, 2, 1)`,
      { r: receteNo, s: c[0], t: c[1], o: c[2] });
  }
  ekle({ tur: 'recete', receteNo, mamulStokNo: MAMUL });

  const fis = await yazma.uretimFisiYaz(Object.assign({}, SECIM, {
    mamulStokNo: MAMUL, miktar: 2,
    bilesenler: [{ stokNo: HAM, miktar: 3 }],
    ciktilar: [
      { stokNo: MAMUL, miktar: 2 }, { stokNo: YAN1, miktar: 0.5 },
      { stokNo: YAN2, miktar: 0.3 }, { stokNo: FIRE, miktar: 0.2 }
    ],
    aciklama: ACIKLAMA, kullanici: KULLANICI
  }));
  const belgeler = await sql.sorgu(
    `SELECT BELGENO AS belgeNo, IZAHAT AS izahat, EVRAKNO AS evrakNo
     FROM ${TD}TBLUREBELGE WHERE EIND = @i`, { i: fis.uretimInd });
  ekle({ tur: 'uretim', fisNo: fis.fisNo, uretimInd: fis.uretimInd, belgeler });

  const d = belgeler.filter((b) => Number(b.izahat) === 38).map((b) => b.evrakNo).join(' + ');
  const u97 = belgeler.find((b) => Number(b.izahat) === 97);
  const u96 = belgeler.find((b) => Number(b.izahat) === 96);
  console.log(`   ÜRETİM   fiş ${fis.fisNo} · dört çıktı`);
  console.log(`              depo transferi ${d}`);
  console.log(`              tüketim ${u97 && u97.evrakNo} (97) · çıktı ${u96 && u96.evrakNo} (96)`);
}

async function geriAlKipi() {
  const g = gunlukOku();
  if (!g.length) { console.log('Günlük boş; geri alınacak belge yok.'); return; }
  console.log(`== ${g.length} kayıt geri alınıyor ==\n`);

  const kalan = [];
  for (const k of g.slice().reverse()) {
    const s = { firma: k.firma || FIRMA, donem: k.donem || DONEM, depo: DEPO };
    try {
      if (k.tur === 'tutanak') {
        await yazma.tutanakFisiGeriAl(Object.assign({}, s, { fisler: k.fisler, kullanici: KULLANICI }));
        console.log('   OK  tutanak');
      } else if (k.tur === 'zayi') {
        await yazma.zayiFisiGeriAl(Object.assign({}, s, { baslikInd: k.baslikInd, kullanici: KULLANICI }));
        console.log('   OK  zayi ' + k.belgeNo);
      } else if (k.tur === 'fatura') {
        await yazma.alisFaturasiGeriAl(Object.assign({}, s, { baslikInd: k.baslikInd, kullanici: KULLANICI }));
        console.log('   OK  fatura ' + k.belgeNo);
      } else if (k.tur === 'uretim') {
        await yazma.uretimFisiGeriAl(Object.assign({}, s, {
          uretimInd: k.uretimInd, belgeler: k.belgeler, kullanici: KULLANICI
        }));
        console.log('   OK  üretim ' + k.fisNo);
      } else if (k.tur === 'recete') {
        await sql.calistir(
          `DELETE C FROM ${T}TBLURERECETECIKTI C
             JOIN ${T}TBLURERECETELIST L ON L.IND = C.EVRAKNO WHERE L.IND = @r;
           DELETE FROM ${T}TBLURERECETE WHERE EVRAKNO = @r;
           DELETE FROM ${T}TBLURERECETELIST WHERE IND = @r;`,
          { r: k.receteNo });
        console.log('   OK  reçete ' + k.receteNo);
      } else if (k.tur === 'sayim') {
        await yazma.sayimFisiGeriAl(Object.assign({}, s, { sayimId: k.sayimId, kullanici: KULLANICI }));
        const pAd = panelDb.p();
        await sql.calistir(`DELETE FROM [${pAd}].dbo.AraSayimSatir WHERE SayimId = @i`, { i: k.sayimId });
        await sql.calistir(`DELETE FROM [${pAd}].dbo.AraSayim WHERE Id = @i`, { i: k.sayimId });
        console.log('   OK  sayım ' + k.belgeNo);
      }
    } catch (e) {
      console.log(`   HATA ${k.tur} (${k.belgeNo || ''}): ${e.message}`);
      kalan.push(k);   // silinemeyen kayıt günlükte kalsın
    }
  }
  fs.writeFileSync(GUNLUK, JSON.stringify(kalan, null, 2), 'utf8');
  console.log(kalan.length
    ? `\n${kalan.length} kayıt geri alınamadı, günlükte duruyor.`
    : '\nHepsi geri alındı, günlük temizlendi.');
}

(async () => {
  if (GERI_AL) await geriAlKipi();
  else await yazmaKipi();
  process.exit(0);
})().catch((e) => {
  console.error('\nHATA:', e.message);
  console.error(e.stack);
  process.exit(1);
});
