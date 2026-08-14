'use strict';

// Galya İzleyici — VegaWinA5'in gerçekte hangi SQL'i çalıştırdığını yakalar.
//
// Taşınabilir tek dosyadır: kurulum istemez, bilgisayara hiçbir şey yazmaz.
// Yalnızca SQL Server'da bir Extended Events oturumu açar ve yakalananları
// masaüstüne metin dosyası olarak kaydeder. Veri değiştirmez.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const mssql = require('mssql');

const OTURUM = 'galya_vega_izleyici';
const KAYIT_KLASORU = 'C:\\Users\\Public\\galya-izleyici';

let pencere = null;
let havuz = null;
let sonAyar = null;

// Her izleme kendi dosyasına yazar. Böylece eski kayıtlar yenisine karışmaz
// ve dosya silmek için xp_cmdshell gibi bir şeye gerek kalmaz.
let kayitDosyasi = null;

function xelDeseni() {
  // Extended Events dosya adının sonuna kendi sayacını ekler; yıldızla okunur.
  return (kayitDosyasi || KAYIT_KLASORU + '\\vega') + '*.xel';
}

function pencereAc() {
  pencere = new BrowserWindow({
    width: 1060,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#f1f3f5',
    title: 'Galya İzleyici',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  pencere.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

app.whenReady().then(pencereAc);
app.on('window-all-closed', async () => {
  if (havuz) { try { await havuz.close(); } catch (e) { /* yoksay */ } }
  app.quit();
});

// --- SQL bağlantısı -------------------------------------------------------

async function baglan(ayar) {
  const anahtar = JSON.stringify([ayar.sunucu, ayar.port, ayar.kullanici]);
  if (havuz && havuz.connected && JSON.stringify(sonAyar) === anahtar) return havuz;
  if (havuz) { try { await havuz.close(); } catch (e) { /* yoksay */ } }

  havuz = await new mssql.ConnectionPool({
    server: ayar.sunucu,
    port: Number(ayar.port) || 1433,
    user: ayar.kullanici,
    password: ayar.sifre,
    database: 'master',
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 300000
  }).connect();
  sonAyar = anahtar;
  return havuz;
}

async function sorgu(ayar, metin) {
  const h = await baglan(ayar);
  const sonuc = await h.request().batch(metin);
  return sonuc.recordset || [];
}

function anlasilirHata(e) {
  const m = (e && e.message) || String(e);
  if (/Login failed/i.test(m)) {
    return 'SQL kullanıcı adı veya şifre hatalı.';
  }
  if (/ESOCKET|ECONNREFUSED|getaddrinfo|failed to connect/i.test(m)) {
    return 'SQL sunucusuna ulaşılamadı. Sunucu adını ve ağ bağlantısını kontrol edin. ' +
           'Sunucu adı için: bilgisayar adı veya BILGISAYAR\\SQLEXPRESS.';
  }
  if (/ALTER ANY EVENT SESSION|VIEW SERVER STATE|permission/i.test(m)) {
    return 'Bu kullanıcının yetkisi yetmiyor. İzleyici sysadmin yetkisi ister; ' +
           'sa kullanıcısıyla veya sysadmin yetkili bir kullanıcıyla deneyin.';
  }
  return m;
}

function kayitEt(kanal, isFn) {
  ipcMain.handle(kanal, async (olay, girdi) => {
    try {
      return { tamam: true, veri: await isFn(girdi || {}) };
    } catch (e) {
      return { tamam: false, mesaj: anlasilirHata(e) };
    }
  });
}

// --- İşlemler -------------------------------------------------------------

kayitEt('durum', async (g) => {
  const r = await sorgu(g, `
    SELECT
      (SELECT COUNT(*) FROM sys.server_event_sessions WHERE name = '${OTURUM}') AS kurulu,
      (SELECT COUNT(*) FROM sys.dm_xe_sessions WHERE name = '${OTURUM}') AS calisiyor,
      IS_SRVROLEMEMBER('sysadmin') AS yetkili,
      @@SERVERNAME AS sunucu
  `);
  const d = r[0] || {};
  const veritabanlari = await sorgu(g, `
    SELECT name FROM sys.databases
    WHERE database_id > 4 AND state = 0
    ORDER BY name
  `);
  return {
    kurulu: !!d.kurulu,
    calisiyor: !!d.calisiyor,
    yetkili: d.yetkili === 1,
    sunucu: d.sunucu,
    veritabanlari: veritabanlari.map((v) => v.name),
    kayitKlasoru: KAYIT_KLASORU
  };
});

kayitEt('baslat', async (g) => {
  const vt = String(g.veritabani || '').replace(/[^\w\-.]/g, '');
  if (!vt) throw new Error('İzlenecek veritabanını seçin.');

  await sorgu(g, `
    IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = '${OTURUM}')
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = '${OTURUM}')
        ALTER EVENT SESSION [${OTURUM}] ON SERVER STATE = STOP;
      DROP EVENT SESSION [${OTURUM}] ON SERVER;
    END
  `);

  await sorgu(g, `EXEC xp_create_subdir N'${KAYIT_KLASORU}';`);

  const damga = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  kayitDosyasi = `${KAYIT_KLASORU}\\vega-${damga}`;

  await sorgu(g, `
    CREATE EVENT SESSION [${OTURUM}] ON SERVER
      ADD EVENT sqlserver.rpc_completed (
          ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
          WHERE sqlserver.database_name = N'${vt}'
      ),
      ADD EVENT sqlserver.sql_batch_completed (
          ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
          WHERE sqlserver.database_name = N'${vt}'
      )
      ADD TARGET package0.event_file (
          SET filename = N'${kayitDosyasi}.xel',
              max_file_size = 512,
              max_rollover_files = 8
      )
      WITH (MAX_DISPATCH_LATENCY = 3 SECONDS, MAX_MEMORY = 64 MB,
            EVENT_RETENTION_MODE = NO_EVENT_LOSS, TRACK_CAUSALITY = ON);
  `);

  await sorgu(g, `ALTER EVENT SESSION [${OTURUM}] ON SERVER STATE = START;`);
  return { tamam: true, veritabani: vt };
});

kayitEt('durdur', async (g) => {
  await sorgu(g, `
    IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = '${OTURUM}')
      ALTER EVENT SESSION [${OTURUM}] ON SERVER STATE = STOP;
  `);
  return { tamam: true };
});

kayitEt('kaldir', async (g) => {
  await sorgu(g, `
    IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = '${OTURUM}')
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = '${OTURUM}')
        ALTER EVENT SESSION [${OTURUM}] ON SERVER STATE = STOP;
      DROP EVENT SESSION [${OTURUM}] ON SERVER;
    END
  `);
  return { tamam: true };
});

// --- Yakalananları okuma --------------------------------------------------

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

const YAZAN = /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i;

kayitEt('oku', async (g) => {
  const satirlar = await sorgu(g, `
    SET NOCOUNT ON;
    SELECT CAST(event_data AS NVARCHAR(MAX)) AS veri
    FROM sys.fn_xe_file_target_read_file(N'${xelDeseni()}', NULL, NULL, NULL);
  `);
  const xml = satirlar.map((s) => s.veri).join('\n');

  const hepsi = ayikla(xml).filter(
    (o) =>
      o.metin &&
      !/node-mssql|Management Studio|SQLCMD|Galya/i.test(o.uygulama) &&
      !new RegExp(OTURUM + '|dm_xe_session|fn_xe_file_target', 'i').test(o.metin)
  );

  const yazanlar = hepsi.filter((o) => YAZAN.test(o.metin));

  // Hangi tablolara yazılmış? Desen çıkarırken en çok işe yarayan özet bu.
  const tablolar = {};
  for (const y of yazanlar) {
    const m = y.metin.match(/\b(?:INTO|UPDATE|FROM)\s+\[?([A-Za-z0-9_]+)\]?/i);
    if (m) tablolar[m[1]] = (tablolar[m[1]] || 0) + 1;
  }

  return {
    toplam: hepsi.length,
    yazan: yazanlar.length,
    tablolar: Object.keys(tablolar)
      .map((ad) => ({ ad, adet: tablolar[ad] }))
      .sort((a, b) => b.adet - a.adet)
      .slice(0, 40),
    ornekler: yazanlar.slice(0, 30).map((y) => ({
      zaman: y.zaman,
      uygulama: y.uygulama,
      metin: y.metin.length > 4000 ? y.metin.slice(0, 4000) + '\n… (kısaltıldı)' : y.metin
    }))
  };
});

kayitEt('kaydet', async (g) => {
  const satirlar = await sorgu(g, `
    SET NOCOUNT ON;
    SELECT CAST(event_data AS NVARCHAR(MAX)) AS veri
    FROM sys.fn_xe_file_target_read_file(N'${xelDeseni()}', NULL, NULL, NULL);
  `);
  const xml = satirlar.map((s) => s.veri).join('\n');

  let olaylar = ayikla(xml).filter(
    (o) =>
      o.metin &&
      !/node-mssql|Management Studio|SQLCMD|Galya/i.test(o.uygulama) &&
      !new RegExp(OTURUM + '|dm_xe_session|fn_xe_file_target', 'i').test(o.metin)
  );

  const suzgec = String(g.suzgec || '').toLowerCase();
  if (suzgec === 'yazma') olaylar = olaylar.filter((o) => YAZAN.test(o.metin));
  else if (suzgec) olaylar = olaylar.filter((o) => o.metin.toLowerCase().includes(suzgec));

  const klasor = path.join(os.homedir(), 'Desktop', 'Galya-Izleyici-Kayitlari');
  fs.mkdirSync(klasor, { recursive: true });
  const dosya = path.join(
    klasor,
    new Date().toISOString().replace(/[:.]/g, '-') + (suzgec ? '-' + suzgec : '') + '.txt'
  );

  fs.writeFileSync(
    dosya,
    `Galya İzleyici kaydı\nSunucu: ${g.sunucu}\nVeritabanı: ${g.veritabani || '-'}\n` +
      `Kayıt sayısı: ${olaylar.length}\n\n` +
      olaylar
        .map((o, i) => `----- ${i + 1} ----- ${o.zaman} [${o.uygulama}] (${o.olay})\n${o.metin}\n`)
        .join('\n'),
    'utf8'
  );

  return { dosya, adet: olaylar.length };
});

kayitEt('dosyaAc', async (g) => {
  if (g.yol) shell.showItemInFolder(g.yol);
  return { tamam: true };
});

kayitEt('onay', async (g) => {
  const s = await dialog.showMessageBox(pencere, {
    type: 'question',
    buttons: [g.evet || 'Evet', g.hayir || 'Vazgeç'],
    defaultId: 1,
    cancelId: 1,
    title: g.baslik || 'Onay',
    message: g.mesaj || '',
    detail: g.detay || ''
  });
  return { onay: s.response === 0 };
});
