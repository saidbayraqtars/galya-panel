'use strict';

// Ana ekrandaki altı kutunun sayıları. Her kutu tek bir soruya cevap verir.

const { sorgu } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, tablo, kart } = require('./firma');
const sefim = require('./sefim');
const sayim = require('./sayim');
const vega = require('./vega');
const alisFatura = require('./fatura');

function vt() {
  return ayarOku().vegaVeritabani;
}

async function stokSayilari(firma, donem, depo, ust, aktifGun) {
  const v = vt();
  const r = await sorgu(
    `
    WITH K AS (
      SELECT E.STOKNO, SUM(E.ENVANTER) AS KALAN
      FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')} E
      WHERE (@depo = 0 OR E.DEPO = @depo) AND E.BELGETIPI <> 67
      GROUP BY E.STOKNO
    ),
    A AS (
      SELECT DISTINCT H.STOKNO
      FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')} H
      WHERE H.TARIH >= DATEADD(day, -@aktifGun, CAST(GETDATE() AS date))
    )
    SELECT
      SUM(CASE WHEN ISNULL(K.KALAN, 0) <= 0 THEN 1 ELSE 0 END) AS biten,
      SUM(CASE WHEN ISNULL(K.KALAN, 0) > 0
                AND ISNULL(K.KALAN, 0) <= CASE WHEN ISNULL(S.KRITIKSEVIYE,0) > 0
                                               THEN S.KRITIKSEVIYE ELSE @ust END
               THEN 1 ELSE 0 END) AS azalan
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    JOIN A ON A.STOKNO = S.IND
    LEFT JOIN K ON K.STOKNO = S.IND
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100 AND S.STOKTIPI NOT IN (3, 7, 9)
  `,
    { depo, ust, aktifGun }
  );
  return r[0] || { biten: 0, azalan: 0 };
}

async function maliyetSayisi(firma) {
  const v = vt();
  const r = await sorgu(`
    SELECT COUNT(*) AS adet
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      AND S.STOKTIPI NOT IN (3, 7, 9)
      AND ISNULL(S.ALISFIYATI, 0) > 0
      AND (ISNULL(S.MALIYET, 0) = 0
           OR ABS(ISNULL(S.MALIYET,0) - S.ALISFIYATI) / S.ALISFIYATI > 0.10)
  `);
  return r[0] ? r[0].adet : 0;
}

async function eslesmeyenUrunSayisi(secim) {
  const liste = await sefim.eslestirmeDurumu({
    firma: secim.firma,
    donem: secim.donem,
    gun: 45
  });
  return liste.filter((s) => s.durum === 'eslesmedi').length;
}

// Bir kutu hata verirse diğerleri yine de görünsün.
async function guvenli(isim, isFn) {
  try {
    return { deger: await isFn(), hata: null };
  } catch (e) {
    return { deger: null, hata: e.message || String(e) };
  }
}

async function anaEkran(secim) {
  const { firma, donem, ad } = await dogrula(secim.firma, secim.donem);
  const a = ayarOku();
  const depo = Number(secim.depo != null ? secim.depo : a.varsayilanDepo) || 0;
  const ust = Number(a.kritikStokUst);
  const aktifGun = Number(a.aktifGun) || 90;

  const [stok, aktarim, sayimFark, fatura, maliyet, eslesmeyen, sonTarih, bekleyen] =
    await Promise.all([
      guvenli('stok', () => stokSayilari(firma, donem, depo, ust, aktifGun)),
      guvenli('aktarim', () => sefim.aktarimDurumu()),
      guvenli('sayim', () => sayim.sonSayimFarki({ firma, donem })),
      guvenli('fatura', () => alisFatura.bekleyenSayisi({ firma, donem })),
      guvenli('maliyet', () => maliyetSayisi(firma)),
      guvenli('eslesmeyen', () => eslesmeyenUrunSayisi({ firma, donem })),
      guvenli('sonTarih', () => vega.sonHareketTarihi({ firma, donem })),
      guvenli('bekleyen', async () => (await sayim.bekleyenler({ firma, donem })).length)
    ]);

  return {
    firma,
    donem,
    firmaAdi: ad,
    depo,
    sonHareketTarihi: sonTarih.deger,
    kutular: [
      {
        anahtar: 'biten',
        baslik: 'Stoğu biten ürün',
        deger: stok.deger ? stok.deger.biten : null,
        altBaslik: 'Eksi veya sıfır',
        renk: 'kirmizi',
        ekran: 'stok',
        parametre: { suzgec: 'sifir' },
        hata: stok.hata
      },
      {
        anahtar: 'azalan',
        baslik: 'Azalan ürün',
        deger: stok.deger ? stok.deger.azalan : null,
        altBaslik: `1–${ust} arası kaldı`,
        renk: 'turuncu',
        ekran: 'stok',
        parametre: { suzgec: 'azalan' },
        hata: stok.hata
      },
      {
        anahtar: 'aktarim',
        baslik: "Vega'ya işlenmemiş satış",
        deger: aktarim.deger ? aktarim.deger.aktarilmayan : null,
        altBaslik: eslesmeyen.deger != null
          ? `${eslesmeyen.deger} ürün eşleştirilmemiş`
          : 'Şefim satırı bekliyor',
        renk: 'kirmizi',
        ekran: 'aktarim',
        hata: aktarim.hata
      },
      {
        anahtar: 'sayim',
        baslik: 'Sayım farkı olan ürün',
        deger: sayimFark.deger ? sayimFark.deger.farkliSatir : 0,
        altBaslik: sayimFark.deger && sayimFark.deger.tarih
          ? 'Son sayım: ' + new Date(sayimFark.deger.tarih).toLocaleDateString('tr-TR')
          : 'Henüz sayım yapılmamış',
        renk: 'turuncu',
        ekran: 'sayim',
        hata: sayimFark.hata
      },
      // Sayım artık kaydedilir kaydedilmez Vega'ya gitmiyor; yönetici
      // onaylayana kadar burada bekliyor.
      {
        anahtar: 'sayimOnay',
        baslik: 'Onay bekleyen sayım',
        deger: bekleyen.deger,
        altBaslik: "Onaylanınca Vega'ya işlenir",
        renk: 'mavi',
        ekran: 'sayimOnay',
        hata: bekleyen.hata
      },
      {
        anahtar: 'fatura',
        baslik: 'Onay bekleyen alış faturası',
        deger: fatura.deger,
        altBaslik: "Yönetici onayıyla Vega'ya işlenir",
        renk: 'mavi',
        ekran: 'alisFatura',
        yoneticiSadece: true,
        hata: fatura.hata
      },
      {
        anahtar: 'maliyet',
        baslik: 'Maliyeti eskimiş ürün',
        deger: maliyet.deger,
        altBaslik: 'Fiyat değişti, maliyet değişmedi',
        renk: 'turuncu',
        ekran: 'maliyet',
        hata: maliyet.hata
      }
    ]
  };
}

module.exports = { anaEkran };
