'use strict';

const { kopyala } = require('./test-ortam');
const SECIM = { firma: 'F0102', donem: 'D0002', depo: 1 };
const KK = '[GALYA_TEST].dbo.F0102';
const DD = '[GALYA_TEST].dbo.F0102D0002';
const KARTLAR = ['TBLSTOKLAR', 'TBLBIRIMLEREX', 'TBLDEPOLAR', 'TBLCARI', 'TBLKDVGRUPLARI',
  'TBLURERECETELIST', 'TBLURERECETE', 'TBLURERECETECIKTI', 'TBLURERECETEPOZ', 'TBLURERECETEARAC'];
const BELGELER = ['TBLUREURETIMLIST', 'TBLUREURETIM', 'TBLUREURETIMCIKTI', 'TBLUREURETIMPOZ',
  'TBLUREURETIMARAC', 'TBLUREBELGE', 'TBLSHAREKET', 'TBLSTOKHAREKETLERI', 'TBLDEPOENVANTER',
  'TBLDEPOHARBASLIK', 'TBLDEPOHARHAREKET', 'TBLALFATBASLIK',
  'TBLSTKCIKBASLIK', 'TBLSTKCIKHAREKET', 'TBLCARIHAREKETLERI',
  'TBLCARGIRBASLIK', 'TBLCARGIRHAREKET', 'TBLCARCIKBASLIK', 'TBLCARCIKHAREKET',
  'TBLCARIGENELHAREKET', 'TBLKASA'];

async function hazirla(sql, kaynakVT) {
  if (require('../db/ayar').ayarOku().vegaVeritabani !== 'GALYA_TEST') throw new Error('Yazma hedefi GALYA_TEST olmalı.');
  // Önceden bu senaryodan kalmış fiş varsa gizlice silip geçme.
  for (const ad of BELGELER) {
    await kopyala(sql, kaynakVT, 'F0102D0002' + ad, 'F0102D0002' + ad, false);
    const say = await sql.sorgu(`SELECT COUNT(*) AS n FROM ${DD}${ad}`);
    if (Number(say[0].n)) throw new Error(`${ad}: önceki sınamadan kalıntı var; önce ilgili geri alma yolunu çalıştırın.`);
  }
  for (const ad of KARTLAR) await kopyala(sql, kaynakVT, 'F0102' + ad, 'F0102' + ad);
  const f = await sql.sorgu('SELECT IND FROM GALYA_TEST.dbo.TBLFIRMA WHERE IND=102');
  if (!f.length) {
    // TBLFIRMA test-yazma --kur tarafından oluşturulmuştur; yalnız eksik firma eklenir.
    await sql.calistir("SET IDENTITY_INSERT GALYA_TEST.dbo.TBLFIRMA ON; INSERT INTO GALYA_TEST.dbo.TBLFIRMA (IND,KOD,KISAAD,AD1) VALUES (102,'0102','GALYA TEST 0102','GALYA TEST'); SET IDENTITY_INSERT GALYA_TEST.dbo.TBLFIRMA OFF;");
  }
  await require('../db/firma').firmalariGetir(true);
}

module.exports = { hazirla, SECIM, KK, DD, BELGELER };
