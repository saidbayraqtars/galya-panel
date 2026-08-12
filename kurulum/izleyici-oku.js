'use strict';

// VegaWinA5'in yakalanan SQL'lerini okur ve dosyaya yazar.
//   node kurulum/izleyici-oku.js                -> son 300 ifade
//   node kurulum/izleyici-oku.js yazma          -> sadece INSERT/UPDATE/DELETE/EXEC
//   node kurulum/izleyici-oku.js maliyet        -> içinde "maliyet" geçenler
//
// Çıktı: kurulum/yakalanan/<zaman>.txt

const fs = require('fs');
const path = require('path');
const kok = path.join(__dirname, '..');
const sql = require(path.join(kok, 'db', 'sql'));

const suzgec = (process.argv[2] || '').toLowerCase();

function ayikla(xml) {
  const olaylar = [];
  const parcalar = xml.split('<event ');
  for (const p of parcalar.slice(1)) {
    const zaman = (p.match(/timestamp="([^"]+)"/) || [])[1] || '';
    const alan = (ad) => {
      const kalip = new RegExp(
        `name="${ad}"[^>]*>\\s*(?:<type[^>]*\\/>\\s*)?<value>([\\s\\S]*?)<\\/value>`
      );
      const m = p.match(kalip);
      return m ? m[1] : '';
    };
    const metin = alan('statement') || alan('batch_text') || alan('sql_text');
    olaylar.push({
      zaman,
      uygulama: alan('client_app_name'),
      kullanici: alan('username'),
      metin: metin
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x0D;/g, '\r')
        .replace(/&#x0A;/g, '\n')
        .trim()
    });
  }
  return olaylar;
}

(async () => {
  const satirlar = await sql.sorgu(`
    SELECT CAST(t.target_data AS NVARCHAR(MAX)) AS veri
    FROM sys.dm_xe_sessions s
    JOIN sys.dm_xe_session_targets t ON t.event_session_address = s.address
    WHERE s.name = 'galya_vega_izleyici' AND t.target_name = 'ring_buffer'
  `);

  if (!satirlar.length) {
    console.log('İzleyici çalışmıyor. Önce kurulum/izleyici-kur.sql betiğini çalıştırın.');
    await sql.havuzKapat();
    process.exit(1);
  }

  let olaylar = ayikla(satirlar[0].veri);

  // Kendi programımızın sorgularını ve izleyicinin kendi okumasını ayıkla
  olaylar = olaylar.filter(
    (o) =>
      o.metin &&
      !/node-mssql|Microsoft SQL Server Management Studio/i.test(o.uygulama) &&
      !/galya_vega_izleyici|dm_xe_session/i.test(o.metin)
  );

  if (suzgec === 'yazma') {
    olaylar = olaylar.filter((o) => /^\s*(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i.test(o.metin));
  } else if (suzgec) {
    olaylar = olaylar.filter((o) => o.metin.toLowerCase().includes(suzgec));
  }

  const klasor = path.join(__dirname, 'yakalanan');
  fs.mkdirSync(klasor, { recursive: true });
  const dosya = path.join(
    klasor,
    new Date().toISOString().replace(/[:.]/g, '-') + (suzgec ? '-' + suzgec : '') + '.txt'
  );

  const metin = olaylar
    .map((o, i) => `----- ${i + 1} ----- ${o.zaman}  [${o.uygulama}]\n${o.metin}\n`)
    .join('\n');

  fs.writeFileSync(dosya, metin, 'utf8');

  console.log(`${olaylar.length} ifade yakalandı.`);
  console.log('Dosya: ' + dosya);

  const yazanlar = olaylar.filter((o) => /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(o.metin));
  if (yazanlar.length) {
    console.log(`\nBunlardan ${yazanlar.length} tanesi veri yazıyor. İlk beşi:\n`);
    for (const y of yazanlar.slice(0, 5)) {
      console.log('  ' + y.metin.replace(/\s+/g, ' ').slice(0, 220));
    }
  }

  await sql.havuzKapat();
})().catch(async (e) => {
  console.error('Hata: ' + e.message);
  await sql.havuzKapat();
  process.exit(1);
});
