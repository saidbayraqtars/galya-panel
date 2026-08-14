'use strict';

// İzleyicinin SQL tarafını Electron olmadan sınar.
//   node test-izleyici.js <sunucu> <kullanici> <sifre> <veritabani>
//
// Sınama: izleme aç → izlenen veritabanında bir işlem yap → yakalandı mı bak
// → kapat. Hiçbir veri değiştirilmez (yalnızca SELECT yapılır).

const mssql = require('mssql');

const [, , sunucu = 'localhost', kullanici, sifre, veritabani = 'VEGADB'] = process.argv;
if (!kullanici || !sifre) {
  console.log('Kullanım: node test-izleyici.js <sunucu> <kullanici> <sifre> [veritabani]');
  process.exit(1);
}

const OTURUM = 'galya_vega_izleyici';
const KLASOR = 'C:\\Users\\Public\\galya-izleyici';

let basarili = 0;
let basarisiz = 0;
function kontrol(ad, kosul, ayrinti) {
  if (kosul) { console.log('  OK   ' + ad); basarili++; }
  else { console.log('  HATA ' + ad + (ayrinti ? '  → ' + ayrinti : '')); basarisiz++; }
}

(async () => {
  const havuz = await new mssql.ConnectionPool({
    server: sunucu, port: 1433, user: kullanici, password: sifre, database: 'master',
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 300000
  }).connect();
  const calis = (m) => havuz.request().batch(m);

  console.log('\n== Yetki ==');
  const y = await calis("SELECT IS_SRVROLEMEMBER('sysadmin') AS s, @@SERVERNAME AS ad");
  kontrol('Kullanıcı sysadmin', y.recordset[0].s === 1);
  console.log('  Sunucu: ' + y.recordset[0].ad);

  console.log('\n== İzlemeyi başlat ==');
  await calis(`
    IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = '${OTURUM}')
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = '${OTURUM}')
        ALTER EVENT SESSION [${OTURUM}] ON SERVER STATE = STOP;
      DROP EVENT SESSION [${OTURUM}] ON SERVER;
    END`);
  await calis(`EXEC xp_create_subdir N'${KLASOR}';`);

  const damga = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const dosya = `${KLASOR}\\vega-${damga}`;

  await calis(`
    CREATE EVENT SESSION [${OTURUM}] ON SERVER
      ADD EVENT sqlserver.rpc_completed (
          ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
          WHERE sqlserver.database_name = N'${veritabani}'
      ),
      ADD EVENT sqlserver.sql_batch_completed (
          ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
          WHERE sqlserver.database_name = N'${veritabani}'
      )
      ADD TARGET package0.event_file (
          SET filename = N'${dosya}.xel', max_file_size = 512, max_rollover_files = 8
      )
      WITH (MAX_DISPATCH_LATENCY = 3 SECONDS, MAX_MEMORY = 64 MB,
            EVENT_RETENTION_MODE = NO_EVENT_LOSS, TRACK_CAUSALITY = ON);`);
  await calis(`ALTER EVENT SESSION [${OTURUM}] ON SERVER STATE = START;`);

  const acik = await calis(`SELECT COUNT(*) AS c FROM sys.dm_xe_sessions WHERE name='${OTURUM}'`);
  kontrol('Oturum çalışıyor', acik.recordset[0].c === 1);
  console.log('  Kayıt dosyası: ' + dosya + '.xel');

  console.log('\n== İzlenen veritabanında işlem ==');
  // Yakalanacak, kolay tanınan bir ifade.
  const isaret = 'GALYA_IZLEYICI_SINAMA_' + damga;
  await calis(`USE [${veritabani}]; SELECT '${isaret}' AS isaret;`);
  await new Promise((r) => setTimeout(r, 6000)); // dosyaya yazılmasını bekle

  console.log('\n== Yakalananları oku ==');
  const okuma = await calis(`
    SET NOCOUNT ON;
    SELECT CAST(event_data AS NVARCHAR(MAX)) AS veri
    FROM sys.fn_xe_file_target_read_file(N'${dosya}*.xel', NULL, NULL, NULL);`);
  const xml = (okuma.recordset || []).map((s) => s.veri).join('\n');
  kontrol('Kayıt dosyası okunabildi', xml.length > 0, 'uzunluk=' + xml.length);
  kontrol('Yapılan işlem yakalandı', xml.includes(isaret));

  const olaySayisi = xml.split('<event ').length - 1;
  console.log('  Yakalanan olay sayısı: ' + olaySayisi);
  kontrol('En az bir olay var', olaySayisi > 0);

  console.log('\n== Kapat ==');
  await calis(`
    IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = '${OTURUM}')
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = '${OTURUM}')
        ALTER EVENT SESSION [${OTURUM}] ON SERVER STATE = STOP;
      DROP EVENT SESSION [${OTURUM}] ON SERVER;
    END`);
  const kapali = await calis(`SELECT COUNT(*) AS c FROM sys.server_event_sessions WHERE name='${OTURUM}'`);
  kontrol('Oturum kaldırıldı', kapali.recordset[0].c === 0);

  console.log(`\nSonuç: ${basarili} başarılı, ${basarisiz} hatalı\n`);
  await havuz.close();
  process.exit(basarisiz ? 1 : 0);
})().catch((e) => {
  console.log('\nHATA: ' + e.message);
  process.exit(1);
});
