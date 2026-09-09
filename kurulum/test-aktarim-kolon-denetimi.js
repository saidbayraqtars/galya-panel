'use strict';

// ŞEFİM AKTARIMI — KOLON DENETİMİ
//
//   node kurulum/test-aktarim-kolon-denetimi.js
//
// Neden ayrı bir betik: `test-kolon-denetimi.js` panelin belgelerini
// GALYA_TEST'e YAZIP karşılaştırıyor. Şefim aktarımı yazabilmek için Şefim
// veritabanındaki bir iş gününün satışına ihtiyaç duyar; test veritabanında
// öyle bir gün yok. Bu betik onun yerine panelin INSERT listelerini KAYNAK
// KODDAN okuyup Vega'nın gerçek belgeleriyle karşılaştırıyor. Hiçbir yere
// yazmaz, yalnızca okur.
//
// Ölçüt aynı: Vega bir kolonu kendi Şefim belgelerinin HEPSİNDE dolduruyorsa
// (%100) panel de doldurmalı. Boş bırakılan kolon satırı tabloya sokar ve
// stok doğru hareket eder, ama Vega'nın kendi ekranı belgeyi açmayabilir.
//
// Vega'nın kendi Şefim belgeleri `OZELKOD4 = 'SEFIM'` ile işaretli; örneklem
// bunlardan alınıyor. Başka bir kuruluma yöneltmek için:
//
//   GALYA_KAYNAK_VT=VEGADB GALYA_KAYNAK_FIRMA=F0102 GALYA_KAYNAK_DONEM=D0002 \
//     node kurulum/test-aktarim-kolon-denetimi.js

const path = require('path');
const fs = require('fs');

const kok = path.join(__dirname, '..');
const { ayarOku } = require(path.join(kok, 'db', 'ayar'));
const sql = require(path.join(kok, 'db', 'sql'));

const a = ayarOku();
const VVT = process.env.GALYA_KAYNAK_VT || a.vegaVeritabani || 'VEGADB';
const VF = process.env.GALYA_KAYNAK_FIRMA || a.varsayilanFirma || 'F0102';
const VD = process.env.GALYA_KAYNAK_DONEM || a.varsayilanDonem || 'D0002';
const ON = VF + VD;
const P = `[${VVT}].dbo.${ON}`;
const ESIK = 1.0;
const ORNEK = 5000;

// Vega'nın kendi Şefim belgelerini bulan süzgeçler.
const SUZGEC = {
  TBLSTKCIKBASLIK: "OZELKOD4 = 'SEFIM' AND BELGETIPI = 33",
  TBLSTKCIKHAREKET: `EVRAKNO IN (SELECT IND FROM ${P}TBLSTKCIKBASLIK WHERE OZELKOD4 = 'SEFIM')`,
  TBLCARGIRBASLIK: "OZELKOD4 = 'SEFIM'",
  TBLCARGIRHAREKET: `EVRAKNO IN (SELECT IND FROM ${P}TBLCARGIRBASLIK WHERE OZELKOD4 = 'SEFIM')`,
  TBLCARCIKBASLIK: "OZELKOD4 = 'SEFIM'",
  TBLCARCIKHAREKET: `EVRAKNO IN (SELECT IND FROM ${P}TBLCARCIKBASLIK WHERE OZELKOD4 = 'SEFIM')`,
  TBLCARIGENELHAREKET:
    `BELGEIZAHAT IN (11, 13) AND BELGEIND IN (` +
    `SELECT IND FROM ${P}TBLCARGIRBASLIK WHERE OZELKOD4 = 'SEFIM' UNION ALL ` +
    `SELECT IND FROM ${P}TBLCARCIKBASLIK WHERE OZELKOD4 = 'SEFIM')`,
  TBLKASA:
    `BELGEIZAHAT IN (11, 13) AND BELGELINK IN (` +
    `SELECT IND FROM ${P}TBLCARGIRBASLIK WHERE OZELKOD4 = 'SEFIM' UNION ALL ` +
    `SELECT IND FROM ${P}TBLCARCIKBASLIK WHERE OZELKOD4 = 'SEFIM')`,
  TBLSTOKHAREKETLERI:
    `IZAHAT = 33 AND BELGENO IN (SELECT IND FROM ${P}TBLSTKCIKBASLIK WHERE OZELKOD4 = 'SEFIM')`,
  TBLDEPOENVANTER:
    `BELGETIPI = 33 AND BELGEIND IN (SELECT IND FROM ${P}TBLSTKCIKBASLIK WHERE OZELKOD4 = 'SEFIM')`,
  TBLCARIHAREKETLERI:
    `IZAHAT = '33' AND LN IN (SELECT IND FROM ${P}TBLSTKCIKBASLIK WHERE OZELKOD4 = 'SEFIM')`
};

// Panelin INSERT listeleri kaynak koddan okunuyor; elle kopyalanan bir liste
// koddan bağımsız eskir ve denetim sessizce yalan söylemeye başlar.
function panelKolonlari() {
  const kaynak = fs.readFileSync(path.join(kok, 'db', 'yazma.js'), 'utf8');
  const bas = kaynak.indexOf('// --- Şefim günlük satış aktarımı');
  if (bas < 0) throw new Error('yazma.js içinde Şefim aktarımı bölümü bulunamadı.');
  const son = kaynak.indexOf('\nmodule.exports', bas);
  const bolum = kaynak.slice(bas, son < 0 ? undefined : son);

  const harita = {};
  const desen = /INSERT INTO \$\{[^}]*'(TBL[A-Z]+)'\)\}\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g;
  let m;
  while ((m = desen.exec(bolum)) !== null) {
    const tablo = m[1];
    const kolonlar = m[2]
      .replace(/\$\{[^}]*\}/g, '')
      .split(',')
      .map((x) => x.trim())
      .filter((x) => /^[A-Z0-9_]+$/.test(x));
    harita[tablo] = new Set([...(harita[tablo] || []), ...kolonlar]);
  }
  // Değişken tablo adıyla yazılan iki fonksiyon (cariFisiYaz giriş/çıkış).
  const degisken =
    /INSERT INTO \$\{(?:baslikTablosu|hareketTablosu)\}\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g;
  const genel = [];
  while ((m = degisken.exec(bolum)) !== null) {
    genel.push(
      m[1].replace(/\$\{[^}]*\}/g, '').split(',').map((x) => x.trim())
        .filter((x) => /^[A-Z0-9_]+$/.test(x))
    );
  }
  // İlk çift cari başlık/hareket (13 ve 11 aynı kolon kümesi), üçüncüsü stok
  // çıkış başlığı, dördüncüsü stok çıkış hareketi.
  const eslesme = [
    ['TBLCARGIRBASLIK', 'TBLCARCIKBASLIK'],
    ['TBLCARGIRHAREKET', 'TBLCARCIKHAREKET'],
    ['TBLSTKCIKBASLIK'],
    ['TBLSTKCIKHAREKET']
  ];
  genel.forEach((kolonlar, i) => {
    for (const t of eslesme[i] || []) {
      harita[t] = new Set([...(harita[t] || []), ...kolonlar]);
    }
  });
  return harita;
}

(async () => {
  console.log(`Kaynak: ${VVT} / ${VF} / ${VD}\n`);
  const panel = panelKolonlari();
  const eksikTablo = Object.keys(SUZGEC).filter((t) => !panel[t]);
  if (eksikTablo.length) {
    console.log('!! Kaynak koddan kolon listesi çıkarılamayan tablo: ' + eksikTablo.join(', '));
  }

  let denetlenen = 0;
  const riskler = [];
  const atlanan = [];

  for (const t of Object.keys(SUZGEC)) {
    const tam = `${P}${t}`;
    const kolonlar = (
      await sql.sorgu(
        `SELECT COLUMN_NAME AS k FROM [${VVT}].INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME = @t ORDER BY ORDINAL_POSITION`,
        { t: ON + t }
      )
    ).map((x) => x.k).filter((k) => k !== 'IND');

    if (!kolonlar.length) {
      atlanan.push(`${t} — tablo yok`);
      continue;
    }
    const say = Number(
      (await sql.sorgu(`SELECT COUNT(*) AS a FROM ${tam} WHERE ${SUZGEC[t]}`))[0].a
    );
    if (!say) {
      atlanan.push(`${t} — Vega tarafında Şefim belgesi yok`);
      console.log(`  ATLA  ${t}`);
      continue;
    }

    const secim = kolonlar
      .map((k) => `SUM(CASE WHEN [${k}] IS NULL THEN 0 ELSE 1 END) AS [${k}]`)
      .join(', ');
    const r = (
      await sql.sorgu(
        `SELECT COUNT(*) AS satir, ${secim}
         FROM (SELECT TOP ${ORNEK} * FROM ${tam} WHERE ${SUZGEC[t]}) X`
      )
    )[0];
    const ornek = (await sql.sorgu(`SELECT TOP 1 * FROM ${tam} WHERE ${SUZGEC[t]} ORDER BY IND DESC`))[0] || {};
    const toplam = Number(r.satir);

    const yazilan = panel[t] || new Set();
    const zorunlu = kolonlar.filter((k) => Number(r[k]) / toplam >= ESIK);
    const eksik = zorunlu.filter((k) => !yazilan.has(k));
    denetlenen += zorunlu.length;

    if (eksik.length) {
      console.log(`  RİSK  ${t}  —  ${zorunlu.length} zorunlu kolonun ${eksik.length} tanesi yazılmıyor`);
      for (const k of eksik) {
        const v = ornek[k];
        console.log(`          ${k.padEnd(24)} örnek: ${JSON.stringify(v === undefined ? null : v)}`);
        riskler.push({ tablo: t, kolon: k });
      }
    } else {
      console.log(`  OK    ${t}  —  ${zorunlu.length} zorunlu kolonun hepsi yazılıyor (örneklem ${toplam})`);
    }

    // Ters yön: panel var olmayan bir kolona yazmaya çalışıyorsa INSERT patlar.
    const olmayan = [...yazilan].filter((k) => !kolonlar.includes(k));
    if (olmayan.length) {
      console.log(`  HATA  ${t}  —  panel yazıyor ama kolon yok: ${olmayan.join(', ')}`);
      olmayan.forEach((k) => riskler.push({ tablo: t, kolon: k, yok: true }));
    }
  }

  console.log('\n=========== ÖZET ===========');
  console.log(`  Denetlenen zorunlu kolon : ${denetlenen}`);
  console.log(`  Sorunlu                  : ${riskler.length}`);
  for (const x of atlanan) console.log('     - atlandı: ' + x);
  console.log(`\nSonuç: ${riskler.length ? riskler.length + ' sorunlu kolon' : 'temiz'}`);
  await sql.havuzKapat().catch(() => {});
  process.exit(riskler.length ? 1 : 0);
})().catch((e) => {
  console.error('\nBEKLENMEYEN HATA:', e.message);
  console.error(e.stack);
  process.exit(1);
});
