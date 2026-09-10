'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Gerçek ayarı değiştirmez. Panel tabloları da daima sınama veritabanında.
function ayarla(ek = {}) {
  const kaynak = JSON.parse(fs.readFileSync(process.env.GALYA_AYAR_DOSYASI ||
    path.join(__dirname, '..', 'ayarlar.json'), 'utf8').replace(/^\uFEFF/, ''));
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'galya-sinama-'));
  const dosya = path.join(klasor, 'ayarlar.json');
  fs.writeFileSync(dosya, JSON.stringify({ ...kaynak, panelVeritabani: 'GALYA_TEST',
    vegayaYazmaAktif: false, islemOncesiYedek: false, agErisimiAktif: false, ...ek }));
  process.env.GALYA_AYAR_DOSYASI = dosya;
  process.on('exit', () => { fs.rmSync(dosya, { force: true }); fs.rmdirSync(klasor); });
  return kaynak;
}

// Yalnız GALYA_TEST'e kopyalar. Veri kaynağında yalnız SELECT çalışır.
async function kopyala(sql, kaynakVT, kaynakTablo, hedefTablo, veri = true) {
  for (const ad of [kaynakVT, kaynakTablo, hedefTablo]) {
    if (!/^[\p{L}\p{N}_]+$/u.test(ad)) throw new Error('Geçersiz tablo/veritabanı adı.');
  }
  const hedef = `[GALYA_TEST].dbo.[${hedefTablo}]`;
  const kaynak = `[${kaynakVT}].dbo.[${kaynakTablo}]`;
  const varMi = await sql.sorgu(`SELECT 1 AS var FROM GALYA_TEST.INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME=@ad`, { ad: hedefTablo });
  if (!varMi.length) await sql.calistir(`SELECT * INTO ${hedef} FROM ${kaynak} WHERE 1=0`);
  if (!veri) return;
  const kolonlar = await sql.sorgu(
    `SELECT C.COLUMN_NAME AS ad,
      COLUMNPROPERTY(OBJECT_ID(N'GALYA_TEST.dbo.${hedefTablo}'), C.COLUMN_NAME, 'IsIdentity') AS kimlik
     FROM GALYA_TEST.INFORMATION_SCHEMA.COLUMNS C
     WHERE C.TABLE_NAME=@hedef AND C.DATA_TYPE <> 'timestamp'
       AND C.COLUMN_NAME IN (SELECT COLUMN_NAME FROM [${kaynakVT}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=@kaynak)
     ORDER BY C.ORDINAL_POSITION`, { hedef: hedefTablo, kaynak: kaynakTablo }
  );
  const alanlar = kolonlar.map((c) => `[${c.ad}]`).join(',');
  const kimlik = kolonlar.some((c) => c.kimlik);
  await sql.islem(async (t) => {
    await t.calistir(`DELETE FROM ${hedef}`);
    await t.calistir(`${kimlik ? `SET IDENTITY_INSERT ${hedef} ON;` : ''}
      INSERT INTO ${hedef} (${alanlar}) SELECT ${alanlar} FROM ${kaynak};
      ${kimlik ? `SET IDENTITY_INSERT ${hedef} OFF;` : ''}`);
  });
}

module.exports = { ayarla, kopyala };
