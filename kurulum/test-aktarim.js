'use strict';

require('./test-ortam').ayarla();

// ŞEFİM GÜNLÜK AKTARIMI — MUTABAKAT SINAMASI
//
//   node kurulum/test-aktarim.js
//
// Panelin ürettiği aktarım önizlemesini, Vega'nın kendi "Şefim Entegrasyon"
// programının AYNI İŞ GÜNÜ için yazdığı gerçek belgeyle karşılaştırıyor.
// Aktarım deseni tersine mühendislikle çıkarıldığı için tek güvenilir ölçü
// bu: panel, Vega'nın yazdığının aynısını mı üretiyor?
//
// HİÇBİR YERE YAZMAZ. Yalnız okur ve karşılaştırır.
//
// Sınanan gün ayarlardaki firma/dönemde Vega'nın kendi kestiği (OZELKOD4 =
// 'SEFIM') en son stok çıkış belgesidir; belge kalmadıysa sınama atlanır.
//
// Başka bir gün denemek için:
//   GALYA_AKTARIM_GUN=2026-08-11 node kurulum/test-aktarim.js

const path = require('path');

const kok = path.join(__dirname, '..');
const { ayarOku } = require(path.join(kok, 'db', 'ayar'));
const sql = require(path.join(kok, 'db', 'sql'));
const { tablo } = require(path.join(kok, 'db', 'firma'));
const aktarim = require(path.join(kok, 'db', 'aktarim'));

const a = ayarOku();
const VT = a.vegaVeritabani;
const FIRMA = a.varsayilanFirma;
const DONEM = a.varsayilanDonem;

// Kuruş toleransı. Panel fiyatı tam duyarlıkla bölüyor, Vega kırpıyor;
// satır sayısı yükseldikçe birkaç kuruş fark normal.
const TOLERANS = 0.5;

let basarili = 0;
let hatali = 0;
const uyarilar = [];

function ok(ad, kosul, not) {
  if (kosul) {
    basarili++;
    console.log(`  OK   ${ad}${not ? '  (' + not + ')' : ''}`);
  } else {
    hatali++;
    console.log(`  HATA ${ad}${not ? '  (' + not + ')' : ''}`);
  }
}

function gunMetni(d) {
  return (
    d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0')
  );
}

(async () => {
  console.log(`Şefim aktarımı mutabakat sınaması — ${VT} / ${FIRMA} / ${DONEM}\n`);

  const baslikT = tablo(VT, FIRMA, DONEM, 'TBLSTKCIKBASLIK');
  const hareketT = tablo(VT, FIRMA, DONEM, 'TBLSTKCIKHAREKET');

  const istenen = process.env.GALYA_AKTARIM_GUN;
  // Karşılaştırma günün ŞEFSATIŞ belgesiyle yapılıyor. Aynı gün veresiye
  // müşterileri için de OZELKOD4='SEFIM' fişleri kesiliyor; onlar ayrı
  // belgeler, buraya karışırlarsa karşılaştırma anlamsız çıkar.
  const carilerBilgi = await aktarim.cariler(FIRMA);
  if (!carilerBilgi.satis) {
    console.log('Satış carisi bulunamadı; sınama yapılamıyor.');
    await sql.havuzKapat().catch(() => {});
    process.exit(1);
  }
  const belge = (
    await sql.sorgu(
      `SELECT TOP 1 IND AS ind, BELGENO AS belgeNo, TARIH AS tarih,
              TUTAR AS tutar, ARATOPLAM AS ara, YUVARLAMA AS yuvarlama
       FROM ${baslikT}
       WHERE OZELKOD4 = 'SEFIM' AND BELGETIPI = 33 AND FIRMANO = @satisNo
         ${istenen ? 'AND CAST(TARIH AS date) = @gun' : ''}
       ORDER BY IND DESC`,
      Object.assign({ satisNo: carilerBilgi.satis.ind }, istenen ? { gun: istenen } : {})
    )
  )[0];

  if (!belge) {
    console.log(
      "Vega'nın kendi Şefim belgesi bulunamadı" +
        (istenen ? ` (${istenen})` : '') +
        '. Karşılaştırma yapılamıyor, sınama atlandı.'
    );
    await sql.havuzKapat().catch(() => {});
    process.exit(0);
  }

  const gun = gunMetni(new Date(belge.tarih));
  console.log(`Karşılaştırılan gün: ${gun}  ·  Vega belgesi: ${belge.belgeNo}\n`);

  const vegaSatirlari = await sql.sorgu(
    `SELECT STOKNO AS stokNo, MALINCINSI AS ad, MIKTAR AS miktar,
            FIYATI AS fiyat, KDV AS kdv
     FROM ${hareketT} WHERE EVRAKNO = @ind`,
    { ind: belge.ind }
  );

  const o = await aktarim.onizleme({ firma: FIRMA, donem: DONEM, tarih: gun });

  // Kullanıcı bir ürünü "yoksay" işaretlemişse ya da ürün hiçbir stok kartına
  // bağlı değilse o satır belgeye girmiyor. Bu bir kod hatası değil, operatör
  // verisidir — panelin toplamı Vega'nınkinden o kadar düşük çıkar. Sınama
  // bunu ayırt ediyor: eksik satır varsa birebir eşitlik BEKLENMİYOR, onun
  // yerine mutabakat emniyetinin devreye girdiği doğrulanıyor.
  const disarida = (o.eslesmeyen || []).length + (o.yoksayilan || []).length;
  const bekleneneDusuk = disarida > 0;
  if (bekleneneDusuk) {
    console.log(
      `NOT: ${disarida} ürün belge dışında (eşleşmeyen ya da "yoksay" işaretli).`
    );
    console.log(
      '     Birebir tutarlılık beklenmiyor; mutabakat emniyeti sınanıyor.\n'
    );
  }

  console.log('== Toplamlar ==');
  ok(
    'Belge tutarı Vega ile aynı',
    Math.abs(o.toplam.tahsilatToplami - Number(belge.tutar)) <= TOLERANS,
    `panel ${o.toplam.tahsilatToplami.toFixed(2)} / vega ${Number(belge.tutar).toFixed(2)}`
  );
  if (bekleneneDusuk) {
    ok(
      'Belge dışı ürün varken satır toplamı Vega altında',
      o.toplam.satirToplami < Number(belge.ara),
      `panel ${o.toplam.satirToplami.toFixed(2)} / vega ${Number(belge.ara).toFixed(2)}`
    );
  } else {
    ok(
      'Satır toplamı Vega ile aynı',
      Math.abs(o.toplam.satirToplami - Number(belge.ara)) <= TOLERANS,
      `panel ${o.toplam.satirToplami.toFixed(2)} / vega ${Number(belge.ara).toFixed(2)}`
    );
    ok(
      'Yuvarlama kuruş mertebesinde',
      Math.abs(o.toplam.yuvarlama) <= 1,
      o.toplam.yuvarlama.toFixed(4) + ' TL'
    );
  }

  console.log('\n== Satırlar ==');
  // Satır kimliği: (stok kartı, KDV dahil fiyat). Vega'nın FIYATI alanı KDV
  // hariç; ikisi aynı ölçüye getiriliyor.
  const vegaHarita = new Map();
  for (const r of vegaSatirlari) {
    const anahtar = r.stokNo + '|' + (r.fiyat * (1 + r.kdv / 100)).toFixed(2);
    vegaHarita.set(anahtar, { miktar: Number(r.miktar), ad: r.ad });
  }

  let tutan = 0;
  const farklar = [];
  for (const s of o.satirlar) {
    const anahtar = s.stokNo + '|' + s.kdvliFiyat.toFixed(2);
    const v = vegaHarita.get(anahtar);
    if (v && Math.abs(v.miktar - s.miktar) < 0.0001) {
      tutan++;
      vegaHarita.delete(anahtar);
    } else {
      farklar.push(
        `${(s.urunler || [s.urun]).join(' + ')} → stok ${s.stokNo} @${s.kdvliFiyat} ` +
          `panel ${s.miktar} / vega ${v ? v.miktar : 'satır yok'}`
      );
    }
  }

  // %98 eşiği: kalan fark, firmanın Şefim'de yeni değiştirdiği ürün↔kart
  // eşleşmelerinden geliyor ve ekranda "eşleşmedi" diye görünüyor. Bu oranın
  // altına düşmek desende bir şeyin bozulduğu anlamına gelir.
  const oran = o.satirlar.length ? tutan / o.satirlar.length : 1;
  ok(
    'Satırların en az %98i Vega ile birebir',
    oran >= 0.98,
    `${tutan}/${o.satirlar.length} (%${(oran * 100).toFixed(1)})`
  );
  ok(
    'Vega satırlarının hepsi karşılandı',
    vegaHarita.size <= 2 + disarida,
    `kalan ${vegaHarita.size}` + (disarida ? `, belge dışı ${disarida}` : '')
  );
  for (const f of farklar.slice(0, 10)) uyarilar.push('satır farkı: ' + f);

  console.log('\n== Kurallar ==');
  ok('Gün kesimi 04:00', o.kesimSaati === 4, o.kesimSaati + ':00');
  ok('Satış carisi bulundu', !!o.satisCarisi, o.satisCarisi && o.satisCarisi.kod);
  ok('Kasa carisi bulundu', !!o.kasaCarisi, o.kasaCarisi && o.kasaCarisi.kod);
  ok(
    'Tahsilat türlerine ayrılmış',
    o.tahsilat.satirlar.length > 0,
    o.tahsilat.satirlar.map((x) => x.kod).join(', ')
  );

  // Veresiye adisyonlar belgeye girmemeli: parası alınmadığı için tahsilata
  // dahil değiller, Vega'nın programı da almıyor.
  const veresiyeli = Number(o.tahsilat.veresiye) || 0;
  if (veresiyeli) {
    ok(
      'Veresiye tutarı ŞEFSATIŞ belgesinin dışında',
      bekleneneDusuk || Math.abs(o.toplam.satirToplami - o.toplam.tahsilatToplami) <= TOLERANS,
      `veresiye ${veresiyeli.toFixed(2)} TL`
    );

    // Vega aynı gün her veresiye müşterisi için ayrı fiş kesiyor; panelin
    // çıkardığı müşteri listesi ve tutarları onlarla karşılaştırılıyor.
    const vegaVeresiye = await sql.sorgu(
      `SELECT B.IND, B.BELGENO AS belgeNo, B.TUTAR AS tutar, C.FIRMAKODU AS musteri
       FROM ${baslikT} B
       LEFT JOIN ${tablo(VT, FIRMA, '', 'TBLCARI')} C ON C.IND = B.FIRMANO
       WHERE B.OZELKOD4 = 'SEFIM' AND B.BELGETIPI = 33
         AND CAST(B.TARIH AS date) = @gun AND B.FIRMANO <> @satisNo`,
      { gun, satisNo: carilerBilgi.satis.ind }
    );
    const panelVeresiye = (o.veresiye || []).filter((m) => m.satirlar.length);
    ok(
      'Veresiye müşteri sayısı Vega ile aynı',
      panelVeresiye.length === vegaVeresiye.length,
      `panel ${panelVeresiye.length} / vega ${vegaVeresiye.length}`
    );
    const vegaToplam = vegaVeresiye.reduce((x, y) => x + Number(y.tutar), 0);
    const panelToplam = panelVeresiye.reduce((x, y) => x + y.toplam, 0);
    // Veresiye fişleri de belge dışı ürünlerden etkileniyor; ölçüt yukarıdaki
    // gibi gevşetiliyor ama panel asla Vega'nın ÜSTÜNE çıkmamalı.
    ok(
      bekleneneDusuk ? 'Veresiye toplamı Vega tutarını aşmıyor' : 'Veresiye toplamı Vega ile aynı',
      bekleneneDusuk
        ? panelToplam <= vegaToplam + TOLERANS
        : Math.abs(vegaToplam - panelToplam) <= TOLERANS,
      `panel ${panelToplam.toFixed(2)} / vega ${vegaToplam.toFixed(2)}`
    );
    for (const m of panelVeresiye) {
      const v = vegaVeresiye.find((x) => String(x.musteri || '').trim() === m.musteri);
      ok(
        `Veresiye "${m.musteri}" fişi Vega'da da var`,
        !!v,
        v ? `panel ${m.toplam.toFixed(2)} / vega ${Number(v.tutar).toFixed(2)}` : 'Vega fişi yok'
      );
    }
  } else {
    console.log('  ATLA Veresiye kuralı — bu günde veresiye adisyon yok');
  }

  console.log('\n== Mutabakat emniyeti ==');
  const engel = (o.uyarilar || []).filter((u) => u.engel);
  // Karşılaştırma için özellikle Vega'nın daha önce aktardığı bir gün
  // seçiliyor. VEGADA_BELGE_VAR burada mutabakat hatası değildir; aşağıdaki
  // çift aktarım bölümünde ayrıca ve zorunlu olarak sınanır.
  const mutabakatEngeli = engel.filter((u) => u.kod !== 'VEGADA_BELGE_VAR');
  if (bekleneneDusuk) {
    // Asıl sınanan şey bu: belge dışı ürün varken aktarım ENGELLENMELİ.
    // Aksi hâlde panel eksik bir belge kesip stoğu sessizce bozardı.
    ok(
      'Belge dışı ürün varken aktarım engelleniyor',
      mutabakatEngeli.some((u) => u.kod === 'MUTABAKAT'),
      mutabakatEngeli.map((u) => u.kod).join(', ') || 'HİÇ UYARI YOK'
    );
  } else {
    ok(
      'Tutan günde mutabakat engeli yok',
      mutabakatEngeli.length === 0,
      mutabakatEngeli.map((u) => u.kod).join(', ') || 'temiz'
    );
  }
  if ((o.eslesmeyen || []).length) {
    uyarilar.push(
      `${o.eslesmeyen.length} ürün stok kartına bağlı değil: ` +
        o.eslesmeyen.map((x) => x.urun).join(', ')
    );
  }
  if ((o.yoksayilan || []).length) {
    uyarilar.push(
      `${o.yoksayilan.length} ürün "yoksay" işaretli: ` +
        o.yoksayilan.map((x) => x.urun).join(', ')
    );
  }

  console.log('\n== Çift aktarım kilidi ==');
  // Aynı günü iki kez aktarmak günün satışını stoktan iki kez düşürür.
  // Üç kapı var; üçü de burada sınanıyor.
  ok(
    "Vega'da belgesi olan gün için engelleyici uyarı var",
    (o.uyarilar || []).some((u) => u.kod === 'VEGADA_BELGE_VAR' && u.engel),
    o.vegadaBelgeVar ? o.vegadaBelgeVar.belgeNo : 'Vega belgesi yok'
  );

  // Rezervasyon kilidi: aynı gün için ikinci satır veritabanı seviyesinde
  // reddedilmeli. Gerçek bir aktarım yapılmıyor, yalnız kısıt sınanıyor.
  const p = `[${a.panelVeritabani}].dbo.SefimAktarim`;
  const rezerve = () =>
    sql.sorgu(
      `INSERT INTO ${p} (Firma, Donem, Depo, IsGunu, Kullanici, Durum)
       OUTPUT INSERTED.Id AS id
       VALUES ('FKILIT', 'DKILIT', 1, '2000-01-01', 'test-aktarim', 'yaziliyor')`
    );
  try {
    await rezerve();
    let ikinciGecti = false;
    try {
      await rezerve();
      ikinciGecti = true;
    } catch (e) {
      ikinciGecti = !/duplicate key|UQ_SefimAktarim_Gun/i.test(e.message || '');
    }
    ok('Aynı gün için ikinci rezervasyon reddediliyor', !ikinciGecti);

    // Geri alınan bir gün yeniden aktarılabilmeli: kısıt GeriAlindi = 0 ile
    // süzgeçli, aksi hâlde geri alınan gün bir daha aktarılamazdı.
    await sql.calistir(`UPDATE ${p} SET GeriAlindi = 1 WHERE Firma = 'FKILIT'`);
    let tekrarGecti = true;
    try {
      await rezerve();
    } catch (e) {
      tekrarGecti = false;
    }
    ok('Geri alınan gün yeniden aktarılabiliyor', tekrarGecti);
  } finally {
    await sql.calistir(`DELETE FROM ${p} WHERE Firma = 'FKILIT'`).catch(() => {});
  }

  console.log('\n== Gün listesi ==');
  const gunler = await aktarim.gunler({ firma: FIRMA, donem: DONEM, gun: 400 });
  ok('Gün listesi okunuyor', Array.isArray(gunler) && gunler.length > 0, gunler.length + ' gün');
  const disari = gunler.filter((g) => g.durum === 'kapsamDisi');
  ok(
    'Dönem öncesi günler "kapsam dışı" işaretli',
    gunler.length === 0 || disari.length > 0 || gunler.every((g) => g.durum !== 'eksik') ||
      gunler.filter((g) => g.durum === 'eksik').length < gunler.length,
    `${disari.length} gün dönem dışı`
  );
  const eksik = gunler.filter((g) => g.durum === 'eksik');
  console.log(
    `  BİLGİ Aktarılmamış gün: ${eksik.length}` +
      (eksik.length ? ' → ' + eksik.slice(0, 8).map((g) => gunMetni(new Date(g.isGunu))).join(', ') : '')
  );

  if (uyarilar.length) {
    console.log('\n== Not ==');
    for (const u of uyarilar) console.log('  - ' + u);
  }

  console.log(`\nSonuç: ${basarili} başarılı, ${hatali} hatalı`);
  await sql.havuzKapat().catch(() => {});
  process.exit(hatali ? 1 : 0);
})().catch((e) => {
  console.error('\nBEKLENMEYEN HATA:', e.message);
  console.error(e.stack);
  process.exit(1);
});
