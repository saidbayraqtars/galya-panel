'use strict';

// Kaynak Vega yalnız okunur. Gerçek 4516 reçetesi GALYA_TEST'e kopyalanır.
const kaynak = require('./test-ortam').ayarla({ vegaVeritabani: 'GALYA_TEST',
  varsayilanFirma: 'F0102', varsayilanDonem: 'D0002', belgeOneki: 'GP', vegayaYazmaAktif: true });
const assert = require('assert/strict');
const sql = require('../db/sql');
const yazma = require('../db/yazma');
const uretim = require('../db/uretim');
const ayar = require('../db/ayar');
const panel = require('../db/panel');
const { hazirla, SECIM, KK, DD, BELGELER } = require('./uretim-sinama-verisi');
let adet = 0;
const bekleyen = new Set();
const say = async (tablo, kosul = '1=1', p = {}) => Number((await sql.sorgu(`SELECT COUNT(*) AS n FROM ${DD}${tablo} WHERE ${kosul}`, p))[0].n);
function ok(ad, kosul) { assert.ok(kosul, ad); console.log('  OK   ' + ad); adet++; }
const yakin = (a,b) => Math.abs(Number(a)-Number(b)) < 0.001;

async function denetle(fis, emir, referans) {
  const i = fis.uretimInd;
  const p = { i };
  const baslik = await sql.sorgu(`SELECT * FROM ${DD}TBLUREURETIMLIST WHERE IND=@i`, p);
  ok('Başlık tek ve GP serisinde', baslik.length === 1 && /^GP\d{7}$/.test(baslik[0].FISNO));
  const girdiler = await sql.sorgu(`SELECT * FROM ${DD}TBLUREURETIM WHERE EVRAKNO=@i`, p);
  ok('Tüketim satır sayısı reçeteyle aynı', girdiler.length === emir.girdiler.length);
  ok('Tüketim maliyeti miktar × fiyat toplamı', yakin(girdiler.reduce((t,g)=>t+Number(g.MIKTAR)*Number(g.FIYAT),0), fis.toplamMaliyet));
  const ciktilar = await sql.sorgu(`SELECT * FROM ${DD}TBLUREURETIMCIKTI WHERE EVRAKNO=@i`, p);
  ok('Çıktı sayısı reçeteyle aynı', ciktilar.length === emir.ciktilar.length);
  ok('RECETENO yalnız TUR=0 satırında başlık IND', ciktilar.every((c)=>Number(c.TUR) === 0 ? Number(c.RECETENO) === i : c.RECETENO === null));
  ok('25 kg girdi 18 + 3 + 3 + 1 olarak dağıtıldı', ciktilar.reduce((t,c)=>t+Number(c.MIKTAR),0) === 25);
  const poz = await sql.sorgu(`SELECT * FROM ${DD}TBLUREURETIMPOZ WHERE EVRAKNO=@i ORDER BY SIRANO`, p);
  ok('Pozisyon sayısı reçeteyle aynı', poz.length === emir.pozlar.length);
  ok('Pozisyon depoları ve üretim yerleri birebir', poz.every((p,n) =>
    Number(p.DEPONO) === Number(emir.pozlar[n].depoNo) && Number(p.URETIMYERINO) === Number(emir.pozlar[n].yerNo)));
  const arac = await sql.sorgu(`SELECT * FROM ${DD}TBLUREURETIMARAC WHERE EVRAKNO=@i ORDER BY SIRANO`, p);
  const recArac = await sql.sorgu(`SELECT * FROM ${KK}TBLURERECETEARAC WHERE EVRAKNO=@r ORDER BY SIRANO`, { r: emir.receteNo });
  ok('Araç sayısı ve alanları reçeteyle aynı', arac.length === recArac.length && arac.every((r,n) =>
    ['ARACNO','ARACKODU','CALISMAUSULU','POZISYONNO','MIKTAR','BIRIMMIKTAR','SIRANO'].every((k)=>r[k]===recArac[n][k])));
  const belgeler = await sql.sorgu(`SELECT * FROM ${DD}TBLUREBELGE WHERE EIND=@i`, p);
  ok('Belge dizini 38+38+97+96', belgeler.map((b)=>Number(b.IZAHAT)).sort().join(',') === '38,38,96,97');
  // 96/97 ve 38 Vega'nın otomatik Z serisinin devamıdır (F0102'de 154.187
  // adet 96/97 satırının ve 415 transfer fişinin hepsi Z). GP yalnız FISNO'da.
  ok('Doğan belgeler Vega\'nın Z serisinde', belgeler.every((b)=>/^Z\d{7}$/.test(b.EVRAKNO)));
  for (const b of belgeler) {
    const no = Number(b.BELGENO), tip = Number(b.IZAHAT);
    if (tip === 38) {
      const bas = (await sql.sorgu(`SELECT * FROM ${DD}TBLDEPOHARBASLIK WHERE IND=@no`, { no }))[0];
      const yon = Number(b.POZISYON) === 1;
      ok(`Transfer ${b.POZISYON}: depo yönü`, Number(bas.DEPO)===(yon?100:1) && Number(bas.HAREKETDEPOSU)===(yon?1:100));
      const gercek = referans.find((x)=>Number(x.POZISYON)===Number(b.POZISYON));
      for (const k of ['BELGETIPI','GIRIS','STOKHAREKETEYAZ','CARIHAREKETEYAZ','ENVANTERUPDATE']) {
        ok(`Transfer ${b.POZISYON}: ${k} Vega ile aynı`, bas[k] === gercek[k]);
      }
      const sat = await sql.sorgu(`SELECT * FROM ${DD}TBLDEPOHARHAREKET WHERE EVRAKNO=@no`, { no });
      ok(`Transfer ${b.POZISYON}: her girdi için satır ve GK`, sat.length === girdiler.length && sat.every((s)=>Number.isInteger(s.GK)));
      for (const r of sat) {
        const env = await sql.sorgu(`SELECT * FROM ${DD}TBLDEPOENVANTER WHERE BELGEIND=@no AND BELGETIPI=38 AND HAREKETIND=@ln`, { no, ln:r.IND });
        ok('Transfer envanteri kaynak eksi/hedef artı', env.length===2 && env.some((e)=>Number(e.DEPO)===Number(bas.DEPO)&&yakin(e.ENVANTER,r.MIKTAR)) &&
          env.some((e)=>Number(e.DEPO)===Number(bas.HAREKETDEPOSU)&&yakin(e.ENVANTER,-r.MIKTAR)));
      }
    } else {
      const hareket = await sql.sorgu(`SELECT * FROM ${DD}TBLSTOKHAREKETLERI WHERE BELGENO=@no AND IZAHAT=@tip`, { no,tip });
      ok(`${tip}: hareket sayısı`, hareket.length===(tip===96?ciktilar.length:girdiler.length));
      for (const h of hareket) {
        const sha = await sql.sorgu(`SELECT * FROM ${DD}TBLSHAREKET WHERE IND=@ln AND EVRAKNO=@no`, { ln:h.LN,no });
        const env = await sql.sorgu(`SELECT * FROM ${DD}TBLDEPOENVANTER WHERE HAREKETIND=@ln AND BELGEIND=@no AND BELGETIPI=@tip`, { ln:h.LN,no,tip });
        ok(`${tip}: LN → SHAREKET → envanter`, sha.length===1 && env.length===1 && sha[0].STOKNO===h.STOKNO && env[0].STOKNO===h.STOKNO && Number(h.DEPO)===1);
        if (tip===96 && h.STOKNO===371) ok('MAMULSATIRI ana mamulün LN değeri', b.MAMULSATIRI===h.LN);
      }
    }
  }
}

(async()=>{
  await panel.kur();
  await hazirla(sql, kaynak.vegaVeritabani);
  const source = `[${kaynak.vegaVeritabani}].dbo.F0102D0002`;
  let ref = await sql.sorgu(`SELECT IND FROM ${source}TBLUREURETIMLIST WHERE IND=1410 AND RECETENO=4516`);
  if (!ref.length) {
    ref = await sql.sorgu(`SELECT TOP 1 L.IND FROM ${source}TBLUREURETIMLIST L
      WHERE RECETENO=4516 AND (SELECT COUNT(*) FROM ${source}TBLUREBELGE B WHERE B.EIND=L.IND AND B.IZAHAT=38)=2 ORDER BY L.IND DESC`);
    console.log('  REFERANS FARKI: 1410 kaynakta yok; gerçek Vega fişi ' + ref[0]?.IND + ' kullanılıyor.');
  }
  assert.ok(ref.length, 'Gerçek Vega karşılaştırma fişi bulunmalı');
  const referans = await sql.sorgu(`SELECT H.*,B.POZISYON FROM ${source}TBLUREBELGE B JOIN ${source}TBLDEPOHARBASLIK H ON H.IND=B.BELGENO
    WHERE B.EIND=@i AND B.IZAHAT=38`, { i:ref[0].IND });
  assert.equal(referans.length,2);
  const emir = await uretim.isEmri({ ...SECIM,mamulStokNo:371 });
  assert.equal(emir.receteNo,4516);
  // Varsayılan depo ve istemci deposu reçeteyi geçersiz kılamaz.
  for (const depo of [100,102]) {
    ayar.ayarYaz({ varsayilanDepo: depo });
    const fis = await yazma.uretimFisiYaz({ ...SECIM, depo, mamulStokNo:371, miktar:18,
      bilesenler:[{stokNo:4568,miktar:25}], ciktilar:[{stokNo:371,miktar:18},{stokNo:4459,miktar:3},{stokNo:914,miktar:3},{stokNo:4569,miktar:1}], kullanici:'belge-zinciri' });
    bekleyen.add(fis.uretimInd);
    await denetle(fis,emir,referans);
    await yazma.uretimFisiGeriAl({ ...SECIM,uretimInd:fis.uretimInd,kullanici:'belge-zinciri' });
    bekleyen.delete(fis.uretimInd);
    for (const ad of BELGELER) ok(`Geri alma: ${ad} kalıntısız`,await say(ad)===0);
  }
  await assert.rejects(()=>uretim.sifiraKadarUret({...SECIM,stokNo:371}),{kod:'IS_EMRI_GEREKLI'});
  ok('Çok çıktılı ürün tek tıklama üretimden engellendi',true);
  await assert.rejects(()=>yazma.uretimFisiYaz({...SECIM,mamulStokNo:371,miktar:1}),{kod:'IS_EMRI_GEREKLI'});
  ok('Çıktı listesiz doğrudan yazma da engellendi',true);
  console.log(`\nSonuç: ${adet} başarılı, 0 hatalı. 1410 referansının bu kaynakta yokluğu ayrıca raporlandı.`);
})().catch((e)=>{ console.error(e.stack); process.exitCode=1; }).finally(async()=>{
  for (const i of bekleyen) await yazma.uretimFisiGeriAl({...SECIM,uretimInd:i}).catch((e)=>{console.error('Temizlik başarısız: '+e.message);process.exitCode=1;});
  await sql.havuzKapat();
});
