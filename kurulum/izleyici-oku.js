'use strict';

// VegaWinA5'in yakalanan SQL'lerini okur ve dosyaya yazar.
//   node kurulum/izleyici-oku.js                -> hepsi
//   node kurulum/izleyici-oku.js yazma          -> sadece INSERT/UPDATE/DELETE/MERGE
//   node kurulum/izleyici-oku.js maliyet        -> içinde "maliyet" geçenler
//
// Çıktı: kurulum/yakalanan/<zaman>.txt
//
// Olaylar C:\Users\Public\galya-izleyici\vega*.xel dosyalarında duruyor.
// Okumak sysadmin yetkisi ister; bu yüzden sorgu galya_panel ile değil,
// Windows girişiyle (sqlcmd -E) yapılır.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const kok = path.join(__dirname, '..');
const XEL = 'C:\\Users\\Public\\galya-izleyici\\vega*.xel';
const suzgec = (process.argv[2] || '').toLowerCase();

function xmlAl() {
  const gecici = path.join(os.tmpdir(), 'galya-izleyici-' + Date.now() + '.xml');
  const sorgu =
    "SET NOCOUNT ON; SELECT CAST(event_data AS NVARCHAR(MAX)) " +
    `FROM sys.fn_xe_file_target_read_file(N'${XEL}', NULL, NULL, NULL)`;
  execFileSync('sqlcmd', ['-S', 'localhost', '-E', '-y', '0', '-Q', sorgu, '-o', gecici], {
    stdio: ['ignore', 'ignore', 'inherit']
  });
  const xml = fs.readFileSync(gecici, 'utf8');
  try {
    fs.unlinkSync(gecici);
  } catch (e) {
    /* geçici dosya kalırsa sorun değil */
  }
  return xml;
}

function degerCoz(ham) {
  const cd = ham.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  const v = cd ? cd[1] : ham;
  return v
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x0D;/g, '\r')
    .replace(/&#x0A;/g, '\n')
    .replace(/&amp;/g, '&')
    .trim();
}

function ayikla(xml) {
  const olaylar = [];
  for (const p of xml.split('<event ').slice(1)) {
    const zaman = (p.match(/timestamp="([^"]+)"/) || [])[1] || '';
    const olayAdi = (p.match(/^name="([^"]+)"/) || [])[1] || '';
    const alan = (ad) => {
      const kalip = new RegExp(
        `name="${ad}"[^>]*>\\s*(?:<type[^>]*(?:\\/>|>\\s*<\\/type>)\\s*)?<value>([\\s\\S]*?)<\\/value>`
      );
      const m = p.match(kalip);
      return m ? degerCoz(m[1]) : '';
    };
    olaylar.push({
      zaman,
      olay: olayAdi,
      uygulama: alan('client_app_name'),
      kullanici: alan('username'),
      metin: alan('batch_text') || alan('statement') || alan('sql_text')
    });
  }
  return olaylar;
}

(function calis() {
  let xml;
  try {
    xml = xmlAl();
  } catch (e) {
    console.log('İzleyici dosyaları okunamadı. Önce kurulum/izleyici-kur.sql çalıştırılmış mı?');
    process.exit(1);
  }

  let olaylar = ayikla(xml).filter(
    (o) =>
      o.metin &&
      !/node-mssql|Management Studio|SQLCMD/i.test(o.uygulama) &&
      !/galya_vega_izleyici|dm_xe_session|fn_xe_file_target/i.test(o.metin)
  );

  const yazanlar = olaylar.filter((o) => /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(o.metin));
  console.log(`Toplam ${olaylar.length} ifade, bunlardan ${yazanlar.length} tanesi veri yazıyor.`);

  if (suzgec === 'yazma') olaylar = yazanlar;
  else if (suzgec) olaylar = olaylar.filter((o) => o.metin.toLowerCase().includes(suzgec));

  const klasor = path.join(__dirname, 'yakalanan');
  fs.mkdirSync(klasor, { recursive: true });
  const dosya = path.join(
    klasor,
    new Date().toISOString().replace(/[:.]/g, '-') + (suzgec ? '-' + suzgec : '') + '.txt'
  );

  fs.writeFileSync(
    dosya,
    olaylar
      .map((o, i) => `----- ${i + 1} ----- ${o.zaman} [${o.uygulama}] (${o.olay})\n${o.metin}\n`)
      .join('\n'),
    'utf8'
  );

  console.log(`Dosya: ${dosya}  (${olaylar.length} kayıt)`);

  if (!suzgec && yazanlar.length) {
    console.log('\nYazan ifadelerden ilk beşi:\n');
    for (const y of yazanlar.slice(0, 5)) {
      console.log('  ' + y.metin.replace(/\s+/g, ' ').slice(0, 220));
    }
  }
})();
