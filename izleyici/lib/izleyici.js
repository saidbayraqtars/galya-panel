'use strict';

// VegaWinA5'in veritabanına gönderdiği SQL'i Extended Events ile kaydeder.
//
// Neden dosya hedefi (event_file)?
//   Halka tampon varsayılan olarak son 1000 olayı tutar. Maliyetlendirme tek
//   seferde on binlerce ifade çalıştırıyor, işin başındaki asıl önemli kısım
//   düşüyor. Dosya hedefi hiçbir olayı kaybetmez.
//
// Dosyalar SQL Server'ın çalıştığı makinede oluşur; okuma da sunucu üzerinde
// yapıldığı için bu programın o makinede olması gerekmez.

const baglanti = require('./baglanti');

const OTURUM = 'galya_vega_izleyici';
const KLASOR = 'C:\\Users\\Public\\galya-izleyici';
const DOSYA = KLASOR + '\\vega.xel';
const DESEN = KLASOR + '\\vega*.xel';

// Bağlantıyı ve yetkileri sınar. Yakalama sysadmin ister.
async function baglantiTesti(ayar) {
  const satirlar = await baglanti.sorgu(
    ayar,
    `SELECT @@SERVERNAME AS sunucu,
            IS_SRVROLEMEMBER('sysadmin') AS sysadmin,
            SUSER_SNAME() AS kim,
            (SELECT COUNT(*) FROM sys.databases WHERE name = '${(ayar.veritabani || 'VEGADB').replace(/'/g, "''")}') AS vegaVar`
  );
  const s = satirlar[0] || {};
  return {
    sunucu: s.sunucu,
    kim: s.kim,
    sysadmin: Number(s.sysadmin) === 1,
    vegaVar: Number(s.vegaVar) > 0
  };
}

async function durdurVeSil(ayar) {
  await baglanti.calistir(
    ayar,
    `IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = '${OTURUM}')
        ALTER EVENT SESSION [${OTURUM}] ON SERVER STATE = STOP;
     IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = '${OTURUM}')
        DROP EVENT SESSION [${OTURUM}] ON SERVER;`
  );
}

async function baslat(ayar) {
  const vt = (ayar.veritabani || 'VEGADB').replace(/'/g, "''");
  await durdurVeSil(ayar);
  await baglanti.calistir(ayar, `EXEC xp_create_subdir N'${KLASOR}';`);
  await eskiDosyalariSil(ayar);
  await baglanti.calistir(
    ayar,
    `CREATE EVENT SESSION [${OTURUM}] ON SERVER
       ADD EVENT sqlserver.rpc_completed (
           ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
           WHERE sqlserver.database_name = N'${vt}'
       ),
       ADD EVENT sqlserver.sql_batch_completed (
           ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
           WHERE sqlserver.database_name = N'${vt}'
       )
       ADD TARGET package0.event_file (
           SET filename = N'${DOSYA}', max_file_size = 512, max_rollover_files = 8
       )
       WITH (MAX_DISPATCH_LATENCY = 3 SECONDS, MAX_MEMORY = 64 MB,
             EVENT_RETENTION_MODE = NO_EVENT_LOSS, TRACK_CAUSALITY = ON);`
  );
  await baglanti.calistir(ayar, `ALTER EVENT SESSION [${OTURUM}] ON SERVER STATE = START;`);
  return { tamam: true };
}

// xp_cmdshell çoğu kurulumda kapalı olduğu için dosya silmeyi denemekle
// yetiniyoruz; başarısız olursa yeni yakalama yine de yeni dosyaya yazar.
async function eskiDosyalariSil(ayar) {
  try {
    await baglanti.calistir(
      ayar,
      `IF (SELECT CAST(value_in_use AS INT) FROM sys.configurations WHERE name = 'xp_cmdshell') = 1
         EXEC xp_cmdshell 'del /q "${DESEN}"', NO_OUTPUT;`
    );
  } catch (e) {
    /* silinemezse okuma yine de çalışır */
  }
}

async function durum(ayar) {
  const satirlar = await baglanti.sorgu(
    ayar,
    `SELECT
       (SELECT COUNT(*) FROM sys.dm_xe_sessions WHERE name = '${OTURUM}') AS calisiyor,
       (SELECT COUNT_BIG(*)
          FROM sys.fn_xe_file_target_read_file(N'${DESEN}', NULL, NULL, NULL)) AS olay`
  );
  const s = satirlar[0] || {};
  return { calisiyor: Number(s.calisiyor) > 0, olay: Number(s.olay || 0) };
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

function olayCoz(xml) {
  const zaman = (xml.match(/timestamp="([^"]+)"/) || [])[1] || '';
  const alan = (ad) => {
    const kalip = new RegExp(
      `name="${ad}"[^>]*>\\s*(?:<type[^>]*(?:\\/>|>\\s*<\\/type>)\\s*)?<value>([\\s\\S]*?)<\\/value>`
    );
    const m = xml.match(kalip);
    return m ? degerCoz(m[1]) : '';
  };
  return {
    zaman,
    uygulama: alan('client_app_name'),
    kullanici: alan('username'),
    metin: alan('batch_text') || alan('statement') || alan('sql_text')
  };
}

// Yakalananları tek tek okur; hepsi birden belleğe alınmaz.
async function oku(ayar, yazIsFn, ilerlemeIsFn) {
  let toplam = 0;
  let yazilan = 0;
  let atlanan = 0;

  await baglanti.satirlariAkit(
    ayar,
    `SELECT CAST(event_data AS NVARCHAR(MAX)) AS event_data
       FROM sys.fn_xe_file_target_read_file(N'${DESEN}', NULL, NULL, NULL)`,
    'event_data',
    (xml) => {
      toplam++;
      const o = olayCoz(xml);
      const kendimizMi =
        /node-mssql|Management Studio|SQLCMD|Galya/i.test(o.uygulama) ||
        /galya_vega_izleyici|dm_xe_session|fn_xe_file_target|xp_create_subdir/i.test(o.metin);
      if (!o.metin || kendimizMi) {
        atlanan++;
      } else {
        yazilan++;
        yazIsFn(o, yazilan);
      }
      if (ilerlemeIsFn && toplam % 2000 === 0) ilerlemeIsFn(toplam);
    }
  );

  return { toplam, yazilan, atlanan };
}

module.exports = {
  baglantiTesti,
  baslat,
  durdurVeSil,
  durum,
  oku,
  kapat: baglanti.kapat,
  windowsGirisiKullanilabilir: baglanti.windowsGirisiKullanilabilir,
  OTURUM,
  KLASOR,
  DESEN
};
