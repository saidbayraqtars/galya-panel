'use strict';

// KOLON DENETİMİ — "Vega belgeyi açmıyor" sorununun önüne geçmek için.
//
//   node kurulum/test-yazma.js --kur      (bir kez, test veritabanı için)
//   node kurulum/test-kolon-denetimi.js
//
// Neden var: Vega bir belgeyi okurken satırdaki bütün alanları bekliyor.
// Panel bir kolonu NULL bıraktığında satır tabloya girer, stok da doğru
// hareket eder — ama Vega'nın kendi ekranı belgeyi açamaz. "Hızlı belge
// doldurucu" işinde tam olarak bu yaşandı; hata ancak yüzlerce belge
// yazıldıktan sonra ortaya çıktı.
//
// Ne yapıyor:
//
//   1. GERÇEK veritabanında (VEGADB, canlı firma) Vega'nın kendi yazdığı
//      satırlara bakıp her kolonun DOLULUK ORANINI ölçüyor. Örnek:
//      "TBLALFATHAREKET.GK 3323 satırın 3323'ünde dolu" = %100.
//   2. GALYA_TEST üzerinde panelin bütün belge tiplerini yazdırıyor.
//   3. Vega'nın %100 doldurduğu bir kolonu panel NULL bırakmışsa RİSK
//      olarak raporluyor.
//   4. Yazdığı her şeyi geri alıyor.
//
// Eşik neden %100: Vega bir kolonu bazen dolduruyorsa (%40, %90) o alan
// belgenin okunması için şart değildir — kullanıcı girmiş ya da girmemiştir.
// Ama HER satırda dolduruyorsa o alan belgenin bir parçasıdır.
//
// VEGADB'ye TEK SATIR YAZMAZ; oradan yalnızca okur.

const path = require('path');
const fs = require('fs');
const os = require('os');

const kok = path.join(__dirname, '..');

const gercekAyar = JSON.parse(
  fs.readFileSync(path.join(kok, 'ayarlar.json'), 'utf8').replace(/^﻿/, '')
);

// Panel tarafı GALYA_TEST'e yönlendiriliyor (gerçek ayarlara dokunulmaz).
const testAyar = path.join(os.tmpdir(), 'galya-kolon-denetimi-ayarlar.json');
fs.writeFileSync(
  testAyar,
  JSON.stringify(
    Object.assign({}, gercekAyar, {
      vegaVeritabani: 'GALYA_TEST',
      varsayilanFirma: 'F0103',
      varsayilanDonem: 'D0015',
      varsayilanDepo: 1,
      vegayaYazmaAktif: true,
      islemOncesiYedek: false
    }),
    null,
    2
  ),
  'utf8'
);
process.env.GALYA_AYAR_DOSYASI = testAyar;

const mssql = require(path.join(kok, 'node_modules', 'mssql'));
const sql = require(path.join(kok, 'db', 'sql'));
const yazma = require(path.join(kok, 'db', 'yazma'));
const panelDb = require(path.join(kok, 'db', 'panel'));

const SECIM = { firma: 'F0103', donem: 'D0015', depo: 1 };
const PT = '[GALYA_TEST].dbo.F0103';        // panelin yazdığı kart tabloları
const PD = '[GALYA_TEST].dbo.F0103D0015';   // panelin yazdığı dönem tabloları

// Karşılaştırma kaynağı: Vega'nın kendi yazdığı satırlar.
//
// Varsayılan olarak ayarlardaki veritabanı/firma/dönem kullanılıyor. Başka
// bir Vega kurulumuna karşı da denemek için ortam değişkenleriyle
// değiştirilebilir — desen kurulumlar arasında tutuyor mu, ancak böyle
// görülüyor:
//
//   GALYA_KAYNAK_VT=VEGADBozdemirkaya GALYA_KAYNAK_FIRMA=F0101 //   GALYA_KAYNAK_DONEM=D0017 node kurulum/test-kolon-denetimi.js
const VF = process.env.GALYA_KAYNAK_FIRMA || gercekAyar.varsayilanFirma || 'F0102';
const VD = VF + (process.env.GALYA_KAYNAK_DONEM || gercekAyar.varsayilanDonem || 'D0002');
const VVT = process.env.GALYA_KAYNAK_VT || gercekAyar.vegaVeritabani || 'VEGADB';

const ESIK = 1.0;        // %100
const ORNEK_SATIR = 5000;

let riskler = [];
let denetlenen = 0;
let atlanan = [];

let vegaHavuz = null;

async function vegaSorgu(s) {
  const r = await vegaHavuz.request().query(s);
  return r.recordset;
}

function bos(v) {
  return v === null || v === undefined;
}

function yaz(v) {
  if (bos(v)) return 'NULL';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v === '' ? "''" : `'${v.slice(0, 20)}'`;
  if (typeof v === 'boolean') return String(v);
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 1e4) / 1e4) : String(v);
}

// Bir tablo/belge tipi için: Vega'nın doluluk oranları + örnek satır.
async function vegaProfili(tablo, kosul) {
  const kolonlar = await vegaSorgu(`
    SELECT COLUMN_NAME AS k FROM [${VVT}].INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${tablo}' ORDER BY ORDINAL_POSITION`);
  if (!kolonlar.length) return null;

  const secim = kolonlar
    .map((c) => `SUM(CASE WHEN [${c.k}] IS NULL THEN 0 ELSE 1 END) AS [${c.k}]`)
    .join(', ');
  const r = await vegaSorgu(`
    SELECT COUNT(*) AS satir, ${secim}
    FROM (SELECT TOP ${ORNEK_SATIR} * FROM [${VVT}].dbo.${tablo} WHERE ${kosul} ORDER BY 1 DESC) X`);
  const satir = Number(r[0].satir);
  if (!satir) return null;

  const ornek = await vegaSorgu(
    `SELECT TOP 1 * FROM [${VVT}].dbo.${tablo} WHERE ${kosul} ORDER BY 1 DESC`);

  const oran = {};
  for (const c of kolonlar) oran[c.k] = Number(r[0][c.k]) / satir;
  return { satir, oran, ornek: ornek[0] || {} };
}

// Panelin yazdığı satırı Vega profiliyle karşılaştırır.
async function denetle(ad, vegaTablo, vegaKosul, panelSorgusu, p) {
  const profil = await vegaProfili(vegaTablo, vegaKosul);
  if (!profil) {
    atlanan.push(`${ad} — Vega tarafında örnek satır yok (${vegaTablo})`);
    console.log(`  ATLA  ${ad}  (Vega'da örnek yok)`);
    return;
  }

  const satirlar = await sql.sorgu(panelSorgusu, p);
  if (!satirlar.length) {
    atlanan.push(`${ad} — panel satırı bulunamadı`);
    console.log(`  ATLA  ${ad}  (panel satırı yok)`);
    return;
  }
  const satir = satirlar[0];

  const zorunlu = Object.keys(profil.oran).filter(
    (k) => profil.oran[k] >= ESIK && k in satir
  );
  const eksik = zorunlu.filter((k) => bos(satir[k]));
  denetlenen += zorunlu.length;

  if (eksik.length) {
    console.log(`  RİSK  ${ad}  —  ${zorunlu.length} zorunlu kolonun ${eksik.length} tanesi NULL`);
    for (const k of eksik) {
      console.log(`          ${k.padEnd(24)} Vega hep dolu, örnek: ${yaz(profil.ornek[k])}`);
      riskler.push({ ad, tablo: vegaTablo, kolon: k, ornek: yaz(profil.ornek[k]) });
    }
  } else {
    console.log(`  OK    ${ad}  —  ${zorunlu.length} zorunlu kolonun hepsi dolu ` +
      `(Vega örneklemi ${profil.satir} satır)`);
  }
}

// GALYA_TEST'in hareket tablolarını boşaltır. Hedef veritabanı adı
// GALYA_TEST değilse hiçbir şey yapmaz — yanlış veritabanını boşaltmak
// geri dönüşü olmayan bir iştir.
async function temizle() {
  const hedef = (JSON.parse(fs.readFileSync(testAyar, 'utf8')).vegaVeritabani || '');
  if (hedef !== 'GALYA_TEST') {
    throw new Error(
      `Temizlik yalnızca GALYA_TEST üzerinde yapılır; hedef "${hedef}". Durduruldu.`
    );
  }

  const donemTablolari = [
    'TBLSTOKHAREKETLERI', 'TBLDEPOENVANTER', 'TBLCARIHAREKETLERI', 'TBLSHAREKET',
    'TBLSTKCIKHAREKET', 'TBLSTKCIKBASLIK', 'TBLSTKGIRHAREKET', 'TBLSTKGIRBASLIK',
    'TBLALFATHAREKET', 'TBLALFATBASLIK',
    'TBLDEPOHARHAREKET', 'TBLDEPOHARBASLIK',
    'TBLSAYIMGIRISHAREKET', 'TBLSAYIMGIRISBASLIK',
    'TBLSAYIMCIKISHAREKET', 'TBLSAYIMCIKISBASLIK',
    'TBLUREBELGE', 'TBLUREURETIMARAC', 'TBLUREURETIMPOZ', 'TBLUREURETIMCIKTI',
    'TBLUREURETIM', 'TBLUREURETIMLIST'
  ];
  for (const t of donemTablolari) {
    await sql.calistir(`DELETE FROM ${PD}${t}`).catch(() => {});
  }
  const kartTablolari = ['TBLURERECETECIKTI', 'TBLURERECETEPOZ', 'TBLURERECETEARAC',
    'TBLURERECETE', 'TBLURERECETELIST'];
  for (const t of kartTablolari) {
    await sql.calistir(`DELETE FROM ${PT}${t}`).catch(() => {});
  }
}

(async () => {
  console.log('== Kolon denetimi ==');
  console.log(`  Gerçek veritabanı (salt okuma): ${VVT} · ${VD}`);
  console.log(`  Panelin yazdığı              : GALYA_TEST · F0103D0015`);
  console.log(`  Eşik                         : Vega'nın %${ESIK * 100} doldurduğu kolonlar\n`);

  vegaHavuz = await new mssql.ConnectionPool({
    server: gercekAyar.sunucu === 'localhost' ? 'localhost' : gercekAyar.sunucu,
    port: gercekAyar.port || 1433,
    database: VVT,
    user: gercekAyar.kullanici,
    password: gercekAyar.sifre,
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 300000
  }).connect();

  await panelDb.kur();
  const pAd = panelDb.p();

  // Deterministik başlangıç.
  //
  // Betik her belge tipini yazıp geri alıyor, ama ortada bir hata olursa
  // (bağlantı kopması, sınama kodunun kendi hatası) yazılanlar kalır ve
  // SONRAKİ çalıştırmaları bozar: stok eksiye kayar, "zayi fişinde satır
  // yok" gibi alakasız hatalar çıkar. Bir kez böyle oldu.
  //
  // GALYA_TEST'in içinde gerçek veri YOKTUR — tabloları VEGADB'den
  // `SELECT * INTO … WHERE 1=0` ile kopyalanmıştır, yani yalnızca yapıdır.
  // O yüzden hareket tabloları her çalıştırmada boşaltılıyor. Kart tabloları
  // (stok, cari) korunuyor; sınamanın malzemesi onlar.
  await temizle();

  const stoklar = await sql.sorgu(
    `SELECT TOP 5 IND AS stokNo, MALINCINSI AS ad FROM ${PT}TBLSTOKLAR ORDER BY IND`);
  if (stoklar.length < 5) {
    console.log('Test veritabanında 5 stok kartı yok. Önce: node kurulum/test-yazma.js --kur');
    process.exit(1);
  }
  const cariler = await sql.sorgu(
    `SELECT TOP 1 IND AS cariNo, UNVAN AS ad FROM ${PT}TBLCARI ORDER BY IND`);
  if (!cariler.length) {
    console.log('Test veritabanında cari kartı yok.');
    process.exit(1);
  }
  const cari = cariler[0];

  // ---------------------------------------------------------------- tutanak
  console.log('\n-- Tutanak (stok çıkış 33 + stok giriş 32) --');
  const tutanak = await yazma.tutanakFisiYaz(Object.assign({}, SECIM, {
    dusenStokNo: stoklar[0].stokNo, dusenMiktar: 1,
    artanStokNo: stoklar[1].stokNo, artanMiktar: 1,
    sebep: 'kolon denetimi', kullanici: 'kolon-denetimi'
  }));
  const cikisInd = tutanak.fisler[0].baslikInd;
  const girisInd = tutanak.fisler[1].baslikInd;

  await denetle('Stok çıkış başlığı (33)', `${VD}TBLSTKCIKBASLIK`, 'BELGETIPI = 33',
    `SELECT * FROM ${PD}TBLSTKCIKBASLIK WHERE IND = @i`, { i: cikisInd });
  await denetle('Stok çıkış satırı (33)', `${VD}TBLSTKCIKHAREKET`,
    `EVRAKNO IN (SELECT IND FROM [${VVT}].dbo.${VD}TBLSTKCIKBASLIK WHERE BELGETIPI = 33)`,
    `SELECT * FROM ${PD}TBLSTKCIKHAREKET WHERE EVRAKNO = @i`, { i: cikisInd });
  await denetle('Stok giriş başlığı (32)', `${VD}TBLSTKGIRBASLIK`, 'BELGETIPI = 32',
    `SELECT * FROM ${PD}TBLSTKGIRBASLIK WHERE IND = @i`, { i: girisInd });
  await denetle('Stok giriş satırı (32)', `${VD}TBLSTKGIRHAREKET`,
    `EVRAKNO IN (SELECT IND FROM [${VVT}].dbo.${VD}TBLSTKGIRBASLIK WHERE BELGETIPI = 32)`,
    `SELECT * FROM ${PD}TBLSTKGIRHAREKET WHERE EVRAKNO = @i`, { i: girisInd });
  await denetle('Stok hareketi (33 çıkış)', `${VD}TBLSTOKHAREKETLERI`, 'IZAHAT = 33',
    `SELECT * FROM ${PD}TBLSTOKHAREKETLERI WHERE BELGENO = @i AND IZAHAT = 33`, { i: cikisInd });
  await denetle('Stok hareketi (32 giriş)', `${VD}TBLSTOKHAREKETLERI`, 'IZAHAT = 32',
    `SELECT * FROM ${PD}TBLSTOKHAREKETLERI WHERE BELGENO = @i AND IZAHAT = 32`, { i: girisInd });
  await denetle('Depo envanteri (33)', `${VD}TBLDEPOENVANTER`, 'BELGETIPI = 33',
    `SELECT * FROM ${PD}TBLDEPOENVANTER WHERE BELGEIND = @i AND BELGETIPI = 33`, { i: cikisInd });

  await yazma.tutanakFisiGeriAl(Object.assign({}, SECIM, {
    fisler: tutanak.fisler, kullanici: 'kolon-denetimi'
  }));

  // ------------------------------------------------------------------- zayi
  console.log('\n-- Zayi / personel çıkışı (33 + cari) --');
  const zayi = await yazma.zayiFisiYaz(Object.assign({}, SECIM, {
    cariNo: cari.cariNo, cariAdi: cari.ad, altHesap: 'FİRE',
    sebep: 'kolon denetimi', maliyetliMi: true,
    satirlar: [{ stokNo: stoklar[0].stokNo, miktar: 1 }],
    kullanici: 'kolon-denetimi', userNo: 0
  }));
  await denetle('Zayi başlığı (33)', `${VD}TBLSTKCIKBASLIK`, 'BELGETIPI = 33',
    `SELECT * FROM ${PD}TBLSTKCIKBASLIK WHERE IND = @i`, { i: zayi.baslikInd });
  await denetle('Zayi satırı (33)', `${VD}TBLSTKCIKHAREKET`,
    `EVRAKNO IN (SELECT IND FROM [${VVT}].dbo.${VD}TBLSTKCIKBASLIK WHERE BELGETIPI = 33)`,
    `SELECT * FROM ${PD}TBLSTKCIKHAREKET WHERE EVRAKNO = @i`, { i: zayi.baslikInd });
  await denetle('Cari hareketi (33)', `${VD}TBLCARIHAREKETLERI`, 'IZAHAT = 33',
    `SELECT * FROM ${PD}TBLCARIHAREKETLERI WHERE LN = @i AND IZAHAT = 33`,
    { i: zayi.baslikInd });
  await yazma.zayiFisiGeriAl(Object.assign({}, SECIM, {
    baslikInd: zayi.baslikInd, kullanici: 'kolon-denetimi'
  }));

  // --------------------------------------------------------- alış faturası
  console.log('\n-- Alış faturası (20 + cari) --');
  const fatura = await yazma.alisFaturasiYaz(Object.assign({}, SECIM, {
    cariNo: cari.cariNo, cariAdi: cari.ad, belgeNo: null,
    tarih: new Date(),
    satirlar: [{
      stokNo: stoklar[0].stokNo, stokAdi: stoklar[0].ad,
      miktar: 2, birimFiyat: 100, kdvOrani: 20
    }],
    kullanici: 'kolon-denetimi', userNo: 0
  }));
  await denetle('Fatura başlığı (20)', `${VD}TBLALFATBASLIK`, 'BELGETIPI = 20',
    `SELECT * FROM ${PD}TBLALFATBASLIK WHERE IND = @i`, { i: fatura.baslikInd });
  await denetle('Fatura satırı (20)', `${VD}TBLALFATHAREKET`,
    `EVRAKNO IN (SELECT IND FROM [${VVT}].dbo.${VD}TBLALFATBASLIK WHERE BELGETIPI = 20)`,
    `SELECT * FROM ${PD}TBLALFATHAREKET WHERE EVRAKNO = @i`, { i: fatura.baslikInd });
  await denetle('Stok hareketi (20)', `${VD}TBLSTOKHAREKETLERI`, 'IZAHAT = 20',
    `SELECT * FROM ${PD}TBLSTOKHAREKETLERI WHERE BELGENO = @i AND IZAHAT = 20`,
    { i: fatura.baslikInd });
  await denetle('Cari hareketi (20)', `${VD}TBLCARIHAREKETLERI`, 'IZAHAT = 20',
    `SELECT * FROM ${PD}TBLCARIHAREKETLERI WHERE LN = @i AND IZAHAT = 20`,
    { i: fatura.baslikInd });
  await denetle('Depo envanteri (20)', `${VD}TBLDEPOENVANTER`, 'BELGETIPI = 20',
    `SELECT * FROM ${PD}TBLDEPOENVANTER WHERE BELGEIND = @i AND BELGETIPI = 20`,
    { i: fatura.baslikInd });
  await yazma.alisFaturasiGeriAl(Object.assign({}, SECIM, {
    baslikInd: fatura.baslikInd, kullanici: 'kolon-denetimi'
  }));

  // ------------------------------------------------------------ sayım fişi
  console.log('\n-- Sayım fişi (93 / 94) --');
  const sayimBaslik = await sql.sorgu(
    `INSERT INTO [${pAd}].dbo.AraSayim (Firma, Donem, Depo, Sayan, Aciklama)
     OUTPUT INSERTED.Id AS id VALUES ('F0103', 'D0015', 1, 'kolon', 'kolon denetimi')`);
  const sayimId = sayimBaslik[0].id;
  const kalanS = async (s) => {
    const r = await sql.sorgu(
      `SELECT ISNULL(SUM(ENVANTER),0) AS k FROM ${PD}TBLDEPOENVANTER
       WHERE STOKNO = @s AND BELGETIPI <> 67`, { s });
    return Number(r[0].k);
  };
  for (const [stokNo, fark] of [[stoklar[0].stokNo, 4], [stoklar[1].stokNo, -2]]) {
    await sql.calistir(
      `INSERT INTO [${pAd}].dbo.AraSayimSatir
         (SayimId, StokNo, StokAdi, Birim, TeorikMiktar, SayilanMiktar, BirimMaliyet)
       VALUES (@sayimId, @stokNo, 'kolon', 'ADET', 0, @sayilan, 10)`,
      { sayimId, stokNo, sayilan: (await kalanS(stokNo)) + fark }
    );
  }
  await yazma.sayimFisiYaz(Object.assign({}, SECIM, { sayimId, kullanici: 'kolon-denetimi' }));
  const sGiris = await sql.sorgu(
    `SELECT TOP 1 IND FROM ${PD}TBLSAYIMGIRISBASLIK ORDER BY IND DESC`);
  const sCikis = await sql.sorgu(
    `SELECT TOP 1 IND FROM ${PD}TBLSAYIMCIKISBASLIK ORDER BY IND DESC`);

  await denetle('Sayım giriş başlığı (93)', `${VD}TBLSAYIMGIRISBASLIK`, '1=1',
    `SELECT * FROM ${PD}TBLSAYIMGIRISBASLIK WHERE IND = @i`, { i: sGiris[0].IND });
  await denetle('Sayım giriş satırı (93)', `${VD}TBLSAYIMGIRISHAREKET`, '1=1',
    `SELECT * FROM ${PD}TBLSAYIMGIRISHAREKET WHERE EVRAKNO = @i`, { i: sGiris[0].IND });
  await denetle('Sayım çıkış başlığı (94)', `${VD}TBLSAYIMCIKISBASLIK`, '1=1',
    `SELECT * FROM ${PD}TBLSAYIMCIKISBASLIK WHERE IND = @i`, { i: sCikis[0].IND });
  await denetle('Sayım çıkış satırı (94)', `${VD}TBLSAYIMCIKISHAREKET`, '1=1',
    `SELECT * FROM ${PD}TBLSAYIMCIKISHAREKET WHERE EVRAKNO = @i`, { i: sCikis[0].IND });
  await denetle('Stok hareketi (93)', `${VD}TBLSTOKHAREKETLERI`, 'IZAHAT = 93',
    `SELECT * FROM ${PD}TBLSTOKHAREKETLERI WHERE BELGENO = @i AND IZAHAT = 93`,
    { i: sGiris[0].IND });
  await denetle('Stok hareketi (94)', `${VD}TBLSTOKHAREKETLERI`, 'IZAHAT = 94',
    `SELECT * FROM ${PD}TBLSTOKHAREKETLERI WHERE BELGENO = @i AND IZAHAT = 94`,
    { i: sCikis[0].IND });

  await yazma.sayimFisiGeriAl(Object.assign({}, SECIM, { sayimId, kullanici: 'kolon-denetimi' }));
  await sql.calistir(`DELETE FROM [${pAd}].dbo.AraSayimSatir WHERE SayimId = @i`, { i: sayimId });
  await sql.calistir(`DELETE FROM [${pAd}].dbo.AraSayim WHERE Id = @i`, { i: sayimId });

  // ----------------------------------------------------------- üretim fişi
  console.log('\n-- Üretim fişi (38 + 38 + 97 + 96) --');
  const [HAM, MAMUL, YAN1, YAN2, FIRE] = stoklar.map((s) => s.stokNo);
  for (const no of [HAM, MAMUL, YAN1, YAN2, FIRE]) {
    await sql.calistir(
      `DELETE C FROM ${PT}TBLURERECETECIKTI C
         JOIN ${PT}TBLURERECETELIST L ON L.IND = C.EVRAKNO WHERE L.STOKNO = @m;
       DELETE Z FROM ${PT}TBLURERECETEPOZ Z
         JOIN ${PT}TBLURERECETELIST L ON L.IND = Z.EVRAKNO WHERE L.STOKNO = @m;
       DELETE R FROM ${PT}TBLURERECETE R
         JOIN ${PT}TBLURERECETELIST L ON L.IND = R.EVRAKNO WHERE L.STOKNO = @m;
       DELETE FROM ${PT}TBLURERECETELIST WHERE STOKNO = @m;`,
      { m: no }
    );
  }
  await sql.calistir(`UPDATE ${PT}TBLSTOKLAR SET MALIYET = 950 WHERE IND = @s`, { s: HAM });
  await yazma.receteOlustur(
    Object.assign({}, SECIM, { mamulNo: MAMUL, verim: 1, kullanici: 'kolon-denetimi' }));
  const receteNo = (await sql.sorgu(
    `SELECT IND FROM ${PT}TBLURERECETELIST WHERE STOKNO = @s`, { s: MAMUL }))[0].IND;
  await yazma.receteSatiriEkle(
    Object.assign({}, SECIM, { receteNo, stokNo: HAM, miktar: 1, kullanici: 'kolon-denetimi' }));

  // Panelin kendi yazdığı ana mamul çıktı satırı (TUR 0). Yan mamul satırları
  // Vega'nın reçete ekranının işi; denetim onları aşağıda elle kuruyor, ama
  // önce panelinkini denetlemek gerekiyor — yoksa elle yazılan satırlar
  // panelin eksiğini örter (08.09.2026'ya kadar tam olarak bu oldu).
  await denetle('Reçete ana mamul çıktısı', `${VF}TBLURERECETECIKTI`, 'TUR = 0',
    `SELECT * FROM ${PT}TBLURERECETECIKTI WHERE EVRAKNO = @i AND TUR = 0`,
    { i: receteNo });
  await sql.calistir(
    `DELETE FROM ${PT}TBLURERECETECIKTI WHERE EVRAKNO = @i`, { i: receteNo });

  for (const c of [[MAMUL, 0, 100], [YAN1, 2, 0], [YAN2, 2, 100], [FIRE, 2, 0]]) {
    await sql.calistir(
      `INSERT INTO ${PT}TBLURERECETECIKTI
         (EVRAKNO, STOKNO, STOKKODU, MALINCINSI, MIKTAR, BIRIM, BIRIMMIKTAR,
          KDV, FIYAT, ISLEMTARIHI, ORAN, TUR, TUTAR, POZISYONNO, KALANMIKTAR)
       VALUES (@r, @s, '', '', 1, '', 1, 0, 0, GETDATE(), @o, @t, 0, 2, 1)`,
      { r: receteNo, s: c[0], t: c[1], o: c[2] });
  }

  await denetle('Reçete başlığı', `${VF}TBLURERECETELIST`, '1=1',
    `SELECT * FROM ${PT}TBLURERECETELIST WHERE IND = @i`, { i: receteNo });
  await denetle('Reçete bileşeni', `${VF}TBLURERECETE`, '1=1',
    `SELECT * FROM ${PT}TBLURERECETE WHERE EVRAKNO = @i`, { i: receteNo });

  const uFis = await yazma.uretimFisiYaz(Object.assign({}, SECIM, {
    mamulStokNo: MAMUL, miktar: 18,
    bilesenler: [{ stokNo: HAM, miktar: 25 }],
    ciktilar: [
      { stokNo: MAMUL, miktar: 18 }, { stokNo: YAN1, miktar: 3 },
      { stokNo: YAN2, miktar: 3 }, { stokNo: FIRE, miktar: 1 }
    ],
    aciklama: 'Kolon denetimi', kullanici: 'kolon-denetimi'
  }));
  const I = uFis.uretimInd;
  const belge = await sql.sorgu(
    `SELECT BELGENO AS belgeNo, IZAHAT AS izahat, EVRAKNO AS evrakNo, POZISYON AS poz
     FROM ${PD}TBLUREBELGE WHERE EIND = @i`, { i: I });
  const no = (t, poz) => belge.find(
    (b) => Number(b.izahat) === t && (poz == null || Number(b.poz) === poz)).belgeNo;

  await denetle('Üretim başlığı', `${VD}TBLUREURETIMLIST`, '1=1',
    `SELECT * FROM ${PD}TBLUREURETIMLIST WHERE IND = @i`, { i: I });
  await denetle('Üretim tüketim satırı', `${VD}TBLUREURETIM`, '1=1',
    `SELECT * FROM ${PD}TBLUREURETIM WHERE EVRAKNO = @i`, { i: I });
  await denetle('Üretim çıktısı (ana mamul)', `${VD}TBLUREURETIMCIKTI`, 'TUR = 0',
    `SELECT * FROM ${PD}TBLUREURETIMCIKTI WHERE EVRAKNO = @i AND TUR = 0`, { i: I });
  await denetle('Üretim çıktısı (yan mamul)', `${VD}TBLUREURETIMCIKTI`, 'TUR = 2',
    `SELECT * FROM ${PD}TBLUREURETIMCIKTI WHERE EVRAKNO = @i AND TUR = 2`, { i: I });
  await denetle('Üretim pozisyonu', `${VD}TBLUREURETIMPOZ`, '1=1',
    `SELECT * FROM ${PD}TBLUREURETIMPOZ WHERE EVRAKNO = @i AND SIRANO = 1`, { i: I });
  await denetle('Üretim belge dizini', `${VD}TBLUREBELGE`, '1=1',
    `SELECT * FROM ${PD}TBLUREBELGE WHERE EIND = @i AND IZAHAT = 96`, { i: I });
  await denetle('Depo transfer başlığı (38)', `${VD}TBLDEPOHARBASLIK`, 'BELGETIPI = 38',
    `SELECT * FROM ${PD}TBLDEPOHARBASLIK WHERE IND = @i`, { i: no(38, 1) });
  await denetle('Depo transfer satırı (38)', `${VD}TBLDEPOHARHAREKET`,
    `EVRAKNO IN (SELECT IND FROM [${VVT}].dbo.${VD}TBLDEPOHARBASLIK WHERE BELGETIPI = 38)`,
    `SELECT * FROM ${PD}TBLDEPOHARHAREKET WHERE EVRAKNO = @i`, { i: no(38, 1) });
  await denetle('Depo envanteri (38)', `${VD}TBLDEPOENVANTER`, 'BELGETIPI = 38',
    `SELECT * FROM ${PD}TBLDEPOENVANTER WHERE BELGEIND = @i AND BELGETIPI = 38`, { i: no(38, 1) });
  await denetle('SHAREKET (97 tüketim)',
    `${VD}TBLSHAREKET`,
    `EVRAKNO IN (SELECT BELGENO FROM [${VVT}].dbo.${VD}TBLUREBELGE WHERE IZAHAT = 97)`,
    `SELECT * FROM ${PD}TBLSHAREKET WHERE EVRAKNO = @i`, { i: no(97) });
  await denetle('SHAREKET (96 çıktı)',
    `${VD}TBLSHAREKET`,
    `EVRAKNO IN (SELECT BELGENO FROM [${VVT}].dbo.${VD}TBLUREBELGE WHERE IZAHAT = 96)`,
    `SELECT * FROM ${PD}TBLSHAREKET WHERE EVRAKNO = @i`, { i: no(96) });
  await denetle('Stok hareketi (97)', `${VD}TBLSTOKHAREKETLERI`, 'IZAHAT = 97',
    `SELECT * FROM ${PD}TBLSTOKHAREKETLERI WHERE BELGENO = @i AND IZAHAT = 97`, { i: no(97) });
  await denetle('Stok hareketi (96)', `${VD}TBLSTOKHAREKETLERI`, 'IZAHAT = 96',
    `SELECT * FROM ${PD}TBLSTOKHAREKETLERI WHERE BELGENO = @i AND IZAHAT = 96`, { i: no(96) });
  await denetle('Depo envanteri (96)', `${VD}TBLDEPOENVANTER`, 'BELGETIPI = 96',
    `SELECT * FROM ${PD}TBLDEPOENVANTER WHERE BELGEIND = @i AND BELGETIPI = 96`, { i: no(96) });
  await denetle('Depo envanteri (97)', `${VD}TBLDEPOENVANTER`, 'BELGETIPI = 97',
    `SELECT * FROM ${PD}TBLDEPOENVANTER WHERE BELGEIND = @i AND BELGETIPI = 97`, { i: no(97) });

  await yazma.uretimFisiGeriAl(Object.assign({}, SECIM, {
    uretimInd: I,
    belgeler: belge.map((b) => ({ belgeNo: b.belgeNo, izahat: b.izahat, evrakNo: b.evrakNo })),
    kullanici: 'kolon-denetimi'
  }));
  for (const n of [HAM, MAMUL, YAN1, YAN2, FIRE]) {
    await sql.calistir(
      `DELETE C FROM ${PT}TBLURERECETECIKTI C
         JOIN ${PT}TBLURERECETELIST L ON L.IND = C.EVRAKNO WHERE L.STOKNO = @m;
       DELETE R FROM ${PT}TBLURERECETE R
         JOIN ${PT}TBLURERECETELIST L ON L.IND = R.EVRAKNO WHERE L.STOKNO = @m;
       DELETE FROM ${PT}TBLURERECETELIST WHERE STOKNO = @m;`,
      { m: n });
  }

  // ------------------------------------------------------------------ özet
  console.log('\n=========== ÖZET ===========');
  console.log(`  Denetlenen zorunlu kolon : ${denetlenen}`);
  console.log(`  NULL bırakılan (RİSK)    : ${riskler.length}`);
  if (atlanan.length) {
    console.log(`  Atlanan denetim          : ${atlanan.length}`);
    for (const a of atlanan) console.log('     - ' + a);
  }

  if (riskler.length) {
    const gruplu = {};
    for (const r of riskler) (gruplu[r.tablo] = gruplu[r.tablo] || []).push(r);
    console.log('\n  !! Vega HER satırda dolduruyor, panel NULL bırakıyor:');
    for (const t of Object.keys(gruplu).sort()) {
      console.log(`\n     ${t}`);
      const gorulen = new Set();
      for (const r of gruplu[t]) {
        if (gorulen.has(r.kolon)) continue;
        gorulen.add(r.kolon);
        console.log(`       ${r.kolon.padEnd(24)} örnek: ${r.ornek}`);
      }
    }
  }

  await vegaHavuz.close();
  console.log(`\nSonuç: ${riskler.length ? riskler.length + ' riskli kolon' : 'temiz'}`);
  process.exit(riskler.length ? 1 : 0);
})().catch((e) => {
  console.error('\nBEKLENMEYEN HATA:', e.message);
  console.error(e.stack);
  process.exit(1);
});
