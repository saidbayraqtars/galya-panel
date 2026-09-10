'use strict';

// VEGADB üzerinden yapılan bütün okumalar burada. Bu dosyada tek bir
// INSERT / UPDATE / DELETE yoktur — Vega'ya yazma işlemleri db/yazma.js içindedir.

const { sorgu } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, tablo, kart, tabloVarMi } = require('./firma');

function vt() {
  return ayarOku().vegaVeritabani;
}

// Üretim modülü hiç kullanılmamış firmalarda reçete tabloları oluşmamış olabilir.
async function receteVarMi(firma) {
  return (
    (await tabloVarMi(firma, null, 'TBLURERECETELIST')) &&
    (await tabloVarMi(firma, null, 'TBLURERECETE'))
  );
}

// Depo envanteri hareket başına delta tutuyor; güncel stok = deltaların toplamı.
// BELGETIPI 67 rezerv hareketi olduğu için mevcut Vega raporlarıyla uyumlu
// kalmak adına toplamdan çıkarılıyor.
function kalanAltSorgu(v, f, d) {
  return `
    SELECT E.STOKNO, SUM(E.ENVANTER) AS KALAN
    FROM ${tablo(v, f, d, 'TBLDEPOENVANTER')} E
    WHERE (@depo = 0 OR E.DEPO = @depo)
      AND E.BELGETIPI <> 67
    GROUP BY E.STOKNO
  `;
}

// Kullanımdan kalkmış kartlar listeyi boğmasın diye "aktif ürün" tanımı:
// son @aktifGun gün içinde en az bir stok hareketi görmüş kartlar.
function aktifAltSorgu(v, f, d) {
  return `
    SELECT DISTINCT H.STOKNO
    FROM ${tablo(v, f, d, 'TBLSTOKHAREKETLERI')} H
    WHERE H.TARIH >= DATEADD(day, -@aktifGun, CAST(GETDATE() AS date))
  `;
}

async function stokDurumu(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const a = ayarOku();
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : a.varsayilanDepo) || 0;
  const ust = Number(secim.kritikUst != null ? secim.kritikUst : a.kritikStokUst);

  const aktifGun = Number(secim.aktifGun != null ? secim.aktifGun : a.aktifGun) || 90;

  return sorgu(
    `
    WITH K AS (${kalanAltSorgu(v, firma, donem)}),
         A AS (${aktifAltSorgu(v, firma, donem)})
    SELECT
      S.IND            AS stokNo,
      S.MALINCINSI     AS ad,
      S.STOKKODU       AS kod,
      S.KOD1           AS grup,
      S.KOD11          AS kod11,
      S.STOKTIPI       AS stokTipi,
      ISNULL(K.KALAN, 0)      AS kalan,
      ISNULL(S.ALTSEVIYE, 0)  AS altSeviye,
      ISNULL(S.KRITIKSEVIYE, 0) AS kritikSeviye,
      ISNULL(S.MALIYET, 0)    AS maliyet,
      ISNULL(B.BIRIMADI, '')  AS birim,
      CASE
        WHEN ISNULL(K.KALAN, 0) < 0 THEN 'eksi'
        WHEN ISNULL(K.KALAN, 0) = 0 THEN 'sifir'
        WHEN ISNULL(K.KALAN, 0) <= CASE WHEN ISNULL(S.KRITIKSEVIYE,0) > 0
                                        THEN S.KRITIKSEVIYE ELSE @ust END THEN 'azalan'
        ELSE 'normal'
      END AS durum
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    JOIN A ON A.STOKNO = S.IND
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    WHERE ISNULL(S.DELETED, 0) = 0
      AND S.IND >= 100
      AND S.STOKTIPI NOT IN (3, 7, 9)
      AND ${stokPasifHaric()}
      AND (@sadeceSorunlu = 0 OR
           ISNULL(K.KALAN, 0) <= CASE WHEN ISNULL(S.KRITIKSEVIYE,0) > 0
                                      THEN S.KRITIKSEVIYE ELSE @ust END)
    ORDER BY ISNULL(K.KALAN, 0) ASC, S.MALINCINSI ASC
  `,
    { depo, ust, aktifGun, sadeceSorunlu: secim.sadeceSorunlu ? 1 : 0 }
  );
}

// Stok kontrol listesi: teorik stok + kritik seviye + değer.
// Fiziki sayım karşılıkları panel veritabanından geldiği için burada değil,
// db/sayim.js içindeki fizikiSayimlar() ile birleştiriliyor.
//
// suzgec: 'tumu' | 'eksi' | 'sifir' | 'azalan' | 'sorunlu' | 'aralik'
//
// 'aralik' süzgecinde kalan miktarın alt ve üst sınırı verilir: 0 ile 0
// arasını isteyen "stoğu bitenleri", 1 ile 5 arasını isteyen "az kalanları"
// görür. Sayım listesi bu süzgeçten üretiliyor.
//
// tumKartlar = true iken hareket görme şartı kalkar; kartın tamamı listelenir.
// Stok kartındaki sınıflandırma alanları. Adlandırma Vega'nın stok değer
// raporundaki sütun başlıklarından geliyor; eşleştirme firmanın kendi
// "stokdeğer" raporuyla satır satır doğrulandı (486/486 kart birebir):
//
//   KOD1 = Tür      KOD2 = Sınıf    KOD3 = 3-ÖK    KOD4 = 4-ÖK
//   KOD5 = 5-ÖK     KOD6 = Sezon/Yıl   KOD7 = Marka   KOD9 = Renk
//
// KOD8 ve KOD10 raporda görünmüyor ama firma kullanıyor: KOD8 kartı "PASİF"
// diye işaretliyor, KOD10 sayım/üretim listesine dahil olanları işaretliyor.
// Bu ikisi rapordaki adları olmadığı için numarasıyla anılıyor.
const KOD_ALANLARI = [
  { no: 1, ad: 'Tür' },
  { no: 2, ad: 'Sınıf' },
  { no: 3, ad: '3-ÖK' },
  { no: 4, ad: '4-ÖK' },
  { no: 5, ad: '5-ÖK' },
  { no: 6, ad: 'Sezon/Yıl' },
  { no: 7, ad: 'Marka' },
  { no: 8, ad: '8. Kod' },
  { no: 9, ad: 'Renk' },
  { no: 10, ad: '10. Kod' }
];

// Pasif kart işareti. Pasifler listelerde varsayılan olarak GÖRÜNMEZ.
//
// İşaret İKİ ayrı yerde duruyor ve ikisi tam örtüşmüyor:
//
//   1. Vega'nın kendi alanı : STATUS = 2   (stok kartında da, cari kartında da)
//   2. Firmanın el işareti  : KOD8 = 'PASİF'  (yalnızca stokta)
//
// 04.09.2026 sayımı (F0102): 617 stok kartı STATUS = 2, bunların 360'ında
// KOD8 de 'PASİF'. Yani 257 kart YALNIZCA Vega'da pasif, 13 kart yalnızca
// KOD8 ile işaretli. Panel bir süre sadece KOD8'e baktığı için Vega'da
// pasife alınmış 257 kart listelere ve ana ekran sayılarına sızıyordu.
// Bu yüzden süzgeç ikisini birden sorar.
//
// Cari tarafında KOD alanlarının hepsi boş; orada tek ölçüt STATUS = 2
// (F0102'de 39/106 kart, F0101'de 26/99).
const PASIF_KODU = 'PASİF';
const PASIF_ALANI = 'KOD8';
const PASIF_DURUMU = 2;

// Kart pasif mi? Listelerde gösterilen 1/0 sütunu.
function pasifIfadesi(t) {
  const takma = t || 'S';
  return `CASE WHEN ISNULL(${takma}.STATUS, 1) = ${PASIF_DURUMU}
                 OR LTRIM(RTRIM(ISNULL(${takma}.${PASIF_ALANI}, ''))) = N'${PASIF_KODU}'
              THEN 1 ELSE 0 END`;
}

// WHERE'e eklenen "pasifleri getirme" koşulu.
function stokPasifHaric(t) {
  const takma = t || 'S';
  return `ISNULL(${takma}.STATUS, 1) <> ${PASIF_DURUMU}
      AND LTRIM(RTRIM(ISNULL(${takma}.${PASIF_ALANI}, ''))) <> N'${PASIF_KODU}'`;
}

function cariPasifHaric(t) {
  const takma = t || 'C';
  return `ISNULL(${takma}.STATUS, 1) <> ${PASIF_DURUMU}`;
}

// Sınıflandırma süzgeci.
//
// İki kip var: seçilenleri getir, ya da seçilenler HARİÇ getir. İkincisi
// müşterinin istediği "bar-mutfak dışındakileri getirme" işi için: sınıf
// alanında BAR ve MUTFAK'ın yanında Şefim'den sızmış otuz küsur adisyon
// notu duruyor (`x`, `Kahvesi Sade`, `MARLBORO TOUCH BLUE`…) ve bunlar
// listeyi kirletiyor.
//
// Değer birden çok olabilir: arayüz virgülle ayrılmış gönderir
// ("BAR,MUTFAK") ya da dizi verir.
function kodDegerleri(ham) {
  if (ham == null || ham === '') return [];
  const liste = Array.isArray(ham) ? ham : String(ham).split(',');
  return liste.map((d) => String(d).trim()).filter(Boolean);
}

function kodSuzgeciKur(secim) {
  const kosullar = [];
  const parametreler = {};
  for (const k of KOD_ALANLARI) {
    const degerler = kodDegerleri(secim['kod' + k.no]);
    if (!degerler.length) continue;
    const haric = !!secim['kod' + k.no + 'Haric'];
    const adlar = degerler.map((deger, i) => {
      const ad = `kod${k.no}_${i}`;
      parametreler[ad] = deger;
      return '@' + ad;
    });
    kosullar.push(
      `LTRIM(RTRIM(ISNULL(S.KOD${k.no}, ''))) ${haric ? 'NOT IN' : 'IN'} (${adlar.join(', ')})`
    );
  }
  return { kosullar, parametreler };
}

async function stokKontrolListesi(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const a = ayarOku();
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : a.varsayilanDepo) || 0;
  const ust = Number(secim.kritikUst != null ? secim.kritikUst : a.kritikStokUst);
  const aktifGun = Number(secim.aktifGun != null ? secim.aktifGun : a.aktifGun) || 90;
  const suzgec = secim.suzgec || 'sorunlu';
  const tumKartlar = secim.tumKartlar ? 1 : 0;
  // Gider/hizmet kartları (STOKTIPI 3) normalde bu listede yok; kendi ekranları
  // var. Vega'nın stok değer raporu onları da bastığı için "Bütün stok listesi"
  // seçildiğinde rapora birebir uysun diye dahil ediliyor.
  const giderDahil = secim.giderDahil ? 1 : 0;
  const alt = secim.alt != null && secim.alt !== '' ? Number(secim.alt) : null;
  const ustSinir = secim.ust != null && secim.ust !== '' ? Number(secim.ust) : null;

  // Firmanın sınıflandırması. Alan karşılıkları KOD_ALANLARI'nda; hangi
  // kodun kullanıldığını firma TBLSTOKKODTAN'da tanımlıyor. Her alan çoklu
  // seçim ve "hariç tut" kipini destekliyor (bkz. kodSuzgeciKur).
  const kod = kodSuzgeciKur(secim);

  // Pasif kartlar varsayılan olarak listeye girmez; "pasifleri de göster"
  // kutusu işaretlenince gelir. KOD8'e elle süzgeç konmuşsa kullanıcının
  // dediği geçerlidir, üstüne ikinci bir koşul eklenmez.
  const pasifSecili = kodDegerleri(secim.kod8).length > 0;
  const pasifGizle = !secim.pasifDahil && !pasifSecili;

  // Eşik: karta özel kritik seviye varsa o, yoksa ayarlardaki genel üst sınır.
  const esik = `CASE WHEN ISNULL(S.KRITIKSEVIYE,0) > 0 THEN S.KRITIKSEVIYE ELSE @ust END`;
  const kalan = `ISNULL(K.KALAN, 0)`;

  const aralik = [
    alt != null ? `${kalan} >= @alt` : null,
    ustSinir != null ? `${kalan} <= @ustSinir` : null
  ].filter(Boolean).join(' AND ') || '1 = 1';

  const suzgecler = {
    tumu: '1 = 1',
    eksi: `${kalan} < 0`,
    sifir: `${kalan} = 0`,
    azalan: `${kalan} > 0 AND ${kalan} <= ${esik}`,
    sorunlu: `${kalan} <= ${esik}`,
    aralik
  };

  return sorgu(
    `
    WITH K AS (${kalanAltSorgu(v, firma, donem)}),
         A AS (${aktifAltSorgu(v, firma, donem)})
    SELECT
      S.IND                     AS stokNo,
      S.MALINCINSI              AS ad,
      ISNULL(S.STOKKODU, '')    AS kod,
      ISNULL(S.KOD1, '')        AS grup,
      ISNULL(S.KOD1, '')        AS tur,
      ISNULL(S.KOD2, '')        AS sinif,
      ISNULL(S.KOD3, '')        AS ok3,
      ISNULL(S.KOD4, '')        AS ok4,
      ISNULL(S.KOD5, '')        AS ok5,
      ISNULL(S.KOD6, '')        AS sezon,
      ISNULL(S.KOD7, '')        AS marka,
      ISNULL(S.KOD8, '')        AS ok8,
      ISNULL(S.KOD9, '')        AS renk,
      ISNULL(S.KOD10, '')       AS ok10,
      ISNULL(S.ALISFIYATI, 0)   AS alisFiyati,
      S.STOKTIPI                AS stokTipi,
      ISNULL(B.BIRIMADI, '')    AS birim,
      ${kalan}                  AS teorik,
      ISNULL(S.KRITIKSEVIYE, 0) AS kritikSeviye,
      ISNULL(S.MALIYET, 0)      AS birimMaliyet,
      ${kalan} * ISNULL(S.MALIYET, 0) AS deger,
      ${pasifIfadesi()} AS pasif,
      CASE
        WHEN ${kalan} < 0 THEN 'eksi'
        WHEN ${kalan} = 0 THEN 'sifir'
        WHEN ${kalan} <= ${esik} THEN 'azalan'
        ELSE 'normal'
      END AS durum
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    ${tumKartlar ? 'LEFT JOIN' : 'JOIN'} A ON A.STOKNO = S.IND
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    WHERE ISNULL(S.DELETED, 0) = 0
      AND S.IND >= 100
      AND S.STOKTIPI NOT IN (${giderDahil ? '7, 9' : '3, 7, 9'})
      AND (${suzgecler[suzgec] || suzgecler.sorunlu})
      ${pasifGizle ? `AND ${stokPasifHaric()}` : ''}
      ${kod.kosullar.length ? 'AND ' + kod.kosullar.join(' AND ') : ''}
    ORDER BY ${kalan} ASC, S.MALINCINSI ASC
  `,
    Object.assign(
      { depo, ust, aktifGun, alt: alt != null ? alt : 0, ustSinir: ustSinir != null ? ustSinir : 0 },
      kod.parametreler
    )
  );
}

// Stok ekranındaki sınıflandırma süzgeçlerinin seçenekleri.
//
// Kaynak firmanın kendi tanım tablosu: TBLSTOKKODTAN, CATEGORY sütunu kaçıncı
// KOD alanı olduğunu söylüyor (CATEGORY = 1 -> KOD1). Vega'nın stok kartındaki
// açılır listeler de buradan besleniyor, dolayısıyla program kullanıcıya
// Vega'nın gösterdiğiyle birebir aynı seçenekleri gösteriyor.
//
// Kartlardaki dağılım ayrıca sayılıyor: tanımlı ama hiç kullanılmamış kodlar
// listede "0" ile görünür, tanım tablosuna girilmeden karta yazılmış kodlar da
// kaybolmasın diye listeye eklenir.
async function stokKodListeleri(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();

  const tanimlar = await sorgu(`
    SELECT CATEGORY AS kategori, LTRIM(RTRIM(KOD)) AS deger
    FROM ${kart(v, firma, 'TBLSTOKKODTAN')}
    WHERE LTRIM(RTRIM(ISNULL(KOD, ''))) <> ''
    ORDER BY CATEGORY, KOD
  `);

  const sonuc = {};
  for (const k of KOD_ALANLARI) {
    const kullanim = await sorgu(`
      SELECT LTRIM(RTRIM(S.KOD${k.no})) AS deger, COUNT(*) AS adet
      FROM ${kart(v, firma, 'TBLSTOKLAR')} S
      WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
        AND S.STOKTIPI NOT IN (3, 7, 9)
        AND LTRIM(RTRIM(ISNULL(S.KOD${k.no}, ''))) <> ''
      GROUP BY LTRIM(RTRIM(S.KOD${k.no}))
    `);
    const sayac = new Map(kullanim.map((r) => [r.deger, r.adet]));

    const liste = [];
    const eklenen = new Set();
    for (const t of tanimlar) {
      if (t.kategori !== k.no || eklenen.has(t.deger)) continue;
      eklenen.add(t.deger);
      liste.push({ deger: t.deger, adet: sayac.get(t.deger) || 0, tanimli: true });
    }
    for (const [deger, adet] of sayac) {
      if (eklenen.has(deger)) continue;
      liste.push({ deger, adet, tanimli: false });
    }

    // Kullanılanlar önce, sonra alfabetik.
    liste.sort((a, b) => (b.adet - a.adet) || a.deger.localeCompare(b.deger, 'tr'));
    sonuc['kod' + k.no] = liste;
  }

  sonuc.alanlar = KOD_ALANLARI.map((k) => ({
    no: k.no,
    ad: k.ad,
    kullanilan: sonuc['kod' + k.no].some((x) => x.adet > 0)
  }));
  return sonuc;
}

// Gider ve hizmet kartları (STOKTIPI = 3): elektrik, su, nakliye, reklam gibi.
// Bunların stok miktarı olmaması gerekir; Vega bu kartlarda miktarı elle
// sıfırlatmadığı için birikmiş bakiye kalıyor.
//
// 22.08.2026 — müşteri isteği: bu ekrana "bar ve mutfak dışında olan tüm
// ürünler" gelsin. Sınıf (KOD2) alanı BAR ya da MUTFAK olmayan her kart
// listeye giriyor; gider/hizmet kartlarının çoğunun sınıfı zaten boş ya da
// GİDER olduğu için eski liste bunun içinde kalıyor.
//
//   kapsam = 'disi'  (varsayılan) bar-mutfak dışındaki bütün ürünler
//   kapsam = 'gider'              yalnızca STOKTIPI 3 kartları (eski liste)
//
// Mutfak ve barın kendi ürünleri buraya HİÇ girmiyor: bu ekranın sıfırlama
// düğmesi stoğu tek tuşla siliyor, gerçek mutfak stoğunun yanlışlıkla
// sıfırlanması geri dönüşü zor bir iş olurdu.
const SAYIM_SINIFLARI = ['BAR', 'MUTFAK'];

async function giderHizmetStoklari(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  const sadeceGider = String(secim.kapsam || 'disi') === 'gider';

  const sinifParametreleri = {};
  const sinifAdlari = SAYIM_SINIFLARI.map((deger, i) => {
    sinifParametreleri['sinif' + i] = deger;
    return '@sinif' + i;
  });

  // Pasif kartlar listeye girmiyor; kullanımdan kalkmış kartın sıfırlanacak
  // bir şeyi yok.
  const kapsamKosulu = sadeceGider
    ? 'S.STOKTIPI = 3'
    : `(S.STOKTIPI = 3 OR LTRIM(RTRIM(ISNULL(S.KOD2, ''))) NOT IN (${sinifAdlari.join(', ')}))`;

  return sorgu(
    `
    WITH K AS (${kalanAltSorgu(v, firma, donem)})
    SELECT
      S.IND                  AS stokNo,
      S.MALINCINSI           AS ad,
      ISNULL(S.STOKKODU, '') AS kod,
      S.STOKTIPI             AS stokTipi,
      ISNULL(S.KOD1, '')     AS tur,
      ISNULL(S.KOD2, '')     AS sinif,
      ISNULL(B.BIRIMADI, '') AS birim,
      ISNULL(K.KALAN, 0)     AS kalan,
      ISNULL(S.MALIYET, 0)   AS birimMaliyet,
      ISNULL(K.KALAN, 0) * ISNULL(S.MALIYET, 0) AS deger
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    WHERE ISNULL(S.DELETED, 0) = 0
      AND S.IND >= 100
      AND ${kapsamKosulu}
      AND ${stokPasifHaric()}
      AND (@sadeceDolu = 0 OR ISNULL(K.KALAN, 0) <> 0)
    ORDER BY ABS(ISNULL(K.KALAN, 0)) DESC, S.MALINCINSI
  `,
    Object.assign(
      { depo, sadeceDolu: secim.sadeceDolu === false ? 0 : 1 },
      sinifParametreleri
    )
  );
}

async function stokAra(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  const terim = '%' + String(secim.terim || '').trim() + '%';

  return sorgu(
    `
    WITH K AS (${kalanAltSorgu(v, firma, donem)})
    SELECT TOP 200
      S.IND AS stokNo,
      S.MALINCINSI AS ad,
      S.STOKKODU AS kod,
      S.KOD1 AS grup,
      ISNULL(K.KALAN, 0) AS kalan,
      ISNULL(S.MALIYET, 0) AS maliyet,
      ISNULL(B.BIRIMADI, '') AS birim
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      AND ${stokPasifHaric()}
      AND (S.MALINCINSI LIKE @terim OR S.STOKKODU LIKE @terim)
    ORDER BY S.MALINCINSI
  `,
    { depo, terim }
  );
}

async function stokHareketleri(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const gun = Number(secim.gun || 30);

  return sorgu(
    `
    SELECT TOP 300
      H.TARIH        AS tarih,
      H.IZAHAT       AS izahat,
      H.BELGENO      AS belgeNo,
      ISNULL(H.GIREN, 0)  AS giren,
      ISNULL(H.CIKAN, 0)  AS cikan,
      ISNULL(H.BIRIMFIYAT, 0) AS birimFiyat,
      ISNULL(H.ACIKLAMA, '')  AS aciklama,
      ISNULL(C.FIRMAADI, '')  AS cari
    FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')} H
    LEFT JOIN ${kart(v, firma, 'TBLCARI')} C ON C.IND = H.FIRMANO
    WHERE H.STOKNO = @stokNo
      AND H.TARIH >= DATEADD(day, -@gun, CAST(GETDATE() AS date))
    ORDER BY H.TARIH DESC, H.IND DESC
  `,
    { stokNo: Number(secim.stokNo), gun }
  );
}

// --- Reçete ---------------------------------------------------------------
//
// Vega'da reçete iki tablodan oluşuyor:
//   TBLURERECETELIST : reçete başlığı. IND = reçete numarası,
//                      STOKNO = üretilen mamul, MIKTAR = reçetenin verdiği miktar
//   TBLURERECETE     : reçete satırları. EVRAKNO = başlığın IND'i (stok no DEĞİL),
//                      STOKNO = kullanılan hammadde/yarı mamul
// Alt reçete bağı satırın STOKNO'su üzerinden kurulur: o stoğun kendi
// başlığı varsa ağaç bir seviye daha derinleşir.

async function receteliMamuller(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  if (!(await receteVarMi(firma))) return [];
  return sorgu(`
    SELECT
      L.IND                       AS receteNo,
      L.STOKNO                    AS mamulStokNo,
      ISNULL(S.MALINCINSI, L.MALINCINSI) AS mamulAdi,
      ISNULL(L.MIKTAR, 1)         AS verim,
      ISNULL(L.BIRIM, '')         AS birim,
      ISNULL(L.ACIKLAMA, '')      AS aciklama,
      ${pasifIfadesi()}           AS pasif,
      ISNULL(R.satirSayisi, 0)    AS satirSayisi
    FROM ${kart(v, firma, 'TBLURERECETELIST')} L
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = L.STOKNO
    LEFT JOIN (
      SELECT EVRAKNO, COUNT(*) AS satirSayisi
      FROM ${kart(v, firma, 'TBLURERECETE')}
      GROUP BY EVRAKNO
    ) R ON R.EVRAKNO = L.IND
    WHERE L.IND = (SELECT MIN(L2.IND) FROM ${kart(v, firma, 'TBLURERECETELIST')} L2
                   WHERE L2.STOKNO = L.STOKNO)
    ORDER BY ISNULL(S.MALINCINSI, L.MALINCINSI)
  `);
}

async function receteSatirlari(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  if (!(await receteVarMi(firma))) return [];
  return sorgu(
    `
    SELECT
      R.IND           AS ind,
      R.DETAY         AS sira,
      R.STOKNO        AS stokNo,
      ISNULL(S.MALINCINSI, R.MALINCINSI) AS ad,
      ISNULL(R.MIKTAR, 0)     AS miktar,
      ISNULL(R.BIRIM, '')     AS birim,
      ISNULL(R.FIREORANI, 0)  AS fireOrani,
      ISNULL(R.RANDIMAN, 0)   AS randiman,
      ISNULL(S.MALIYET, 0)    AS maliyet,
      ISNULL(S.STOKTIPI, 0)   AS stokTipi,
      AL.IND                  AS altReceteNo
    FROM ${kart(v, firma, 'TBLURERECETE')} R
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = R.STOKNO
    OUTER APPLY (
      SELECT TOP 1 L2.IND
      FROM ${kart(v, firma, 'TBLURERECETELIST')} L2
      WHERE L2.STOKNO = R.STOKNO
      ORDER BY L2.IND
    ) AL
    WHERE R.EVRAKNO = @receteNo
    ORDER BY R.DETAY
  `,
    { receteNo: Number(secim.receteNo) }
  );
}

// Çok seviyeli ağaç: mamul → yarı mamul → yarı mamul
async function receteAgaci(secim, seviye, gorulen) {
  seviye = seviye || 0;
  gorulen = gorulen || new Set();
  if (seviye > 6) return [];
  const anahtar = String(secim.receteNo);
  if (gorulen.has(anahtar)) return [];
  gorulen.add(anahtar);

  const satirlar = await receteSatirlari(secim);
  for (const s of satirlar) {
    s.seviye = seviye;
    s.altRecetesiVar = s.altReceteNo != null ? 1 : 0;
    if (s.altReceteNo != null) {
      s.alt = await receteAgaci(
        { firma: secim.firma, donem: secim.donem, receteNo: s.altReceteNo },
        seviye + 1,
        gorulen
      );
    }
  }
  return satirlar;
}

// --- THIRD (Özel Kod 11) --------------------------------------------------

async function thirdAdaylari(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  if (!(await receteVarMi(firma))) return [];

  // Aday: kendi reçetesi olan (yani üretim gerektiren) stoklar.
  // Reçete bağı TBLURERECETELIST.STOKNO üzerinden kurulur.
  return sorgu(
    `
    WITH K AS (${kalanAltSorgu(v, firma, donem)})
    SELECT
      S.IND                AS stokNo,
      S.MALINCINSI         AS ad,
      ISNULL(S.KOD11, '')  AS kod11,
      ISNULL(K.KALAN, 0)   AS kalan,
      ISNULL(S.KRITIKSEVIYE, 0) AS kritikSeviye,
      R.receteNo,
      ISNULL(R.satirSayisi, 0) AS receteSatiri
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    JOIN (
      SELECT
        L.STOKNO,
        MIN(L.IND) AS receteNo,
        SUM(ISNULL(A.satirSayisi, 0)) AS satirSayisi
      FROM ${kart(v, firma, 'TBLURERECETELIST')} L
      LEFT JOIN (
        SELECT EVRAKNO, COUNT(*) AS satirSayisi
        FROM ${kart(v, firma, 'TBLURERECETE')}
        GROUP BY EVRAKNO
      ) A ON A.EVRAKNO = L.IND
      GROUP BY L.STOKNO
    ) R ON R.STOKNO = S.IND
    LEFT JOIN K ON K.STOKNO = S.IND
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      AND ${stokPasifHaric()}
    ORDER BY ISNULL(K.KALAN, 0) ASC, S.MALINCINSI
  `,
    { depo }
  );
}

// --- Maliyet --------------------------------------------------------------

async function maliyetiEskimisler(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const gun = Number(secim.gun != null ? secim.gun : ayarOku().maliyetEskimeGun);

  // Alış fiyatı değişmiş ama kart maliyeti hâlâ eski/boş kalan stoklar.
  return sorgu(
    `
    SELECT
      S.IND AS stokNo,
      S.MALINCINSI AS ad,
      ISNULL(S.ALISFIYATI, 0)     AS alisFiyati,
      ISNULL(S.ESKIALISFIYATI, 0) AS eskiAlisFiyati,
      ISNULL(S.MALIYET, 0)        AS maliyet,
      S.ALISFIYATIDEGISMETARIHI   AS fiyatDegismeTarihi,
      S.SONALISTARIHI             AS sonAlisTarihi,
      CASE
        WHEN ISNULL(S.MALIYET, 0) = 0 THEN 'Maliyet hiç hesaplanmamış'
        WHEN ISNULL(S.ALISFIYATI, 0) > 0
         AND ABS(ISNULL(S.MALIYET,0) - S.ALISFIYATI) / S.ALISFIYATI > 0.10
             THEN 'Maliyet ile alış fiyatı arasında %10''dan fazla fark var'
        ELSE 'Alış fiyatı değişmiş'
      END AS sebep
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      AND S.STOKTIPI NOT IN (3, 7, 9)
      AND ${stokPasifHaric()}
      AND ISNULL(S.ALISFIYATI, 0) > 0
      AND (
            ISNULL(S.MALIYET, 0) = 0
         OR ABS(ISNULL(S.MALIYET,0) - S.ALISFIYATI) / S.ALISFIYATI > 0.10
         OR (S.ALISFIYATIDEGISMETARIHI IS NOT NULL
             AND S.ALISFIYATIDEGISMETARIHI >= DATEADD(day, -@gun, GETDATE()))
      )
    ORDER BY S.ALISFIYATIDEGISMETARIHI DESC
  `,
    { gun }
  );
}

// Her stok kartının SON ALIŞ fiyatı: alış faturası (IZAHAT 20) hareketleri
// içinde en yeni tarihli satırın birim fiyatı. Hiç alış görmemiş kartlarda
// stok kartındaki ALISFIYATI'na düşülür.
//
// Maliyetlendirme bunun üzerine kuruluyor: hammaddenin maliyeti = son alış
// fiyatı, mamulün maliyeti = reçetesindeki bileşenlerin maliyet toplamı.
async function sonAlisFiyatlari(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  return sorgu(`
    SELECT
      S.IND                    AS stokNo,
      S.MALINCINSI             AS ad,
      ISNULL(S.STOKKODU, '')   AS kod,
      S.STOKTIPI               AS stokTipi,
      ISNULL(B.BIRIMADI, '')   AS birim,
      ISNULL(S.MALIYET, 0)     AS kartMaliyeti,
      ISNULL(S.ALISFIYATI, 0)  AS kartAlisFiyati,
      A.birimFiyat             AS sonAlisFiyati,
      A.tarih                  AS sonAlisTarihi,
      -- Pasif kartlar burada SÜZÜLMÜYOR: 17 pasif kart hâlâ aktif reçetelerde
      -- bileşen olarak duruyor, süzülürse üst mamulün maliyeti eksik çıkar.
      -- Yalnızca işaretleniyor; listeden/yazmadan çıkarmak db/maliyet.js'in işi.
      ${pasifIfadesi()}        AS pasif
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    OUTER APPLY (
      SELECT TOP 1 H.BIRIMFIYAT AS birimFiyat, H.TARIH AS tarih
      FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')} H
      WHERE H.STOKNO = S.IND AND H.IZAHAT = 20
        AND ISNULL(H.BIRIMFIYAT, 0) > 0
      ORDER BY H.TARIH DESC, H.IND DESC
    ) A
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      -- 3 = gider/hizmet, 11 = grup kartı (STOK, MUTFAK, ALKOL…),
      -- 26 = hizmet. Bunların birim maliyeti olmaz; alış fiyatı alanlarında
      -- fatura toplamı gibi anlamsız değerler duruyor.
      AND S.STOKTIPI NOT IN (3, 7, 9, 11, 26)
  `);
}

// --- Cari -----------------------------------------------------------------

// hepsi = true iken bakiyesi sıfır olan cariler de gelir; cari listesini
// ada göre arayan kullanıcı bakiyesi kapanmış firmayı da bulabilsin diye.
async function cariBakiye(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const hepsi = secim.hepsi ? 1 : 0;
  return sorgu(
    `
    SELECT
      C.IND       AS cariNo,
      C.FIRMAKODU AS kod,
      C.FIRMAADI  AS ad,
      ISNULL(SUM(H.BORC), 0)   AS borc,
      ISNULL(SUM(H.ALACAK), 0) AS alacak,
      ISNULL(SUM(H.BORC - H.ALACAK), 0) AS bakiye,
      MAX(H.TARIH) AS sonHareket
    FROM ${kart(v, firma, 'TBLCARI')} C
    LEFT JOIN ${tablo(v, firma, donem, 'TBLCARIHAREKETLERI')} H
           ON H.FIRMANO = C.IND
          AND H.IZAHAT NOT IN (18, 19, 30, 31)
    WHERE ISNULL(C.DELETED, 0) = 0 AND C.IND >= 100
      AND C.FIRMATIPI NOT IN (11, 12)
      AND ${cariPasifHaric()}
    GROUP BY C.IND, C.FIRMAKODU, C.FIRMAADI
    HAVING @hepsi = 1 OR ISNULL(SUM(H.BORC - H.ALACAK), 0) <> 0
    ORDER BY ISNULL(SUM(H.BORC - H.ALACAK), 0) DESC
  `,
    { hepsi }
  );
}

// Alış faturası ekranında tedarikçi seçmek için ad/kod araması.
async function cariAra(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const terim = '%' + String(secim.terim || '').trim() + '%';
  return sorgu(
    `
    SELECT TOP 100
      C.IND       AS cariNo,
      C.FIRMAKODU AS kod,
      C.FIRMAADI  AS ad,
      ISNULL(C.VERGINO, '') AS vergiNo
    FROM ${kart(v, firma, 'TBLCARI')} C
    WHERE ISNULL(C.DELETED, 0) = 0 AND C.IND >= 100
      AND ${cariPasifHaric()}
      AND (C.FIRMAADI LIKE @terim OR C.FIRMAKODU LIKE @terim)
    ORDER BY C.FIRMAADI
  `,
    { terim }
  );
}

// --- E-Fatura -------------------------------------------------------------

async function bekleyenFaturalar(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  if (!(await tabloVarMi(firma, donem, 'TBLEFAINBOX'))) return [];
  return sorgu(`
    SELECT
      IND        AS id,
      Evrakno    AS evrakNo,
      Tarih      AS tarih,
      FirmaAdi   AS tedarikci,
      VKN        AS vkn,
      ISNULL(Tutar, 0) AS tutar,
      ISNULL(PB, 'TL') AS paraBirimi,
      ISNULL(Senaryo, '') AS senaryo,
      ISNULL(IMPORTSTATUS, 0) AS durum,
      KabulTarihi AS kabulTarihi
    FROM ${tablo(v, firma, donem, 'TBLEFAINBOX')}
    WHERE ISNULL(IMPORTSTATUS, 0) = 0
    ORDER BY Tarih DESC
  `);
}

async function faturaUrunEslesmeleri(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  if (!(await tabloVarMi(firma, null, 'TBLEFAPRODUCTMATCH'))) return [];
  return sorgu(`
    SELECT
      M.IND       AS id,
      M.STOKKODU  AS tedarikciKodu,
      M.STOKNO    AS stokNo,
      ISNULL(S.MALINCINSI, '') AS stokAdi,
      ISNULL(C.FIRMAADI, '')   AS tedarikci
    FROM ${kart(v, firma, 'TBLEFAPRODUCTMATCH')} M
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = M.STOKNO
    LEFT JOIN ${kart(v, firma, 'TBLCARI')} C ON C.IND = M.CARINO
    ORDER BY ISNULL(C.FIRMAADI, ''), M.STOKKODU
  `);
}

// --- Günlük hareket özeti -------------------------------------------------

const IZAHAT_ADLARI = {
  20: 'Alış faturası',
  22: 'Alış iadesi',
  32: 'Stok giriş fişi',
  33: 'Stok çıkış fişi',
  90: 'Devir girişi',
  93: 'Sayım girişi',
  94: 'Sayım çıkışı',
  96: 'Üretim çıktısı',
  97: 'Üretim tüketimi'
};

async function gunlukHareket(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const gun = Number(secim.gun || 1);
  const satirlar = await sorgu(
    `
    SELECT
      H.IZAHAT AS izahat,
      COUNT(*) AS adet,
      ISNULL(SUM(H.GIREN), 0) AS giren,
      ISNULL(SUM(H.CIKAN), 0) AS cikan,
      ISNULL(SUM(H.TUTAR), 0) AS tutar
    FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')} H
    WHERE H.TARIH >= DATEADD(day, -@gun, CAST(GETDATE() AS date))
    GROUP BY H.IZAHAT
    ORDER BY COUNT(*) DESC
  `,
    { gun }
  );
  for (const s of satirlar) s.ad = IZAHAT_ADLARI[s.izahat] || ('Kod ' + s.izahat);
  return satirlar;
}

async function sonHareketTarihi(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const r = await sorgu(`
    SELECT MAX(TARIH) AS sonTarih
    FROM ${tablo(v, firma, donem, 'TBLSTOKHAREKETLERI')}
  `);
  return r[0] ? r[0].sonTarih : null;
}

module.exports = {
  stokDurumu,
  stokKontrolListesi,
  stokKodListeleri,
  giderHizmetStoklari,
  stokAra,
  stokHareketleri,
  receteliMamuller,
  receteSatirlari,
  receteAgaci,
  thirdAdaylari,
  maliyetiEskimisler,
  sonAlisFiyatlari,
  cariBakiye,
  cariAra,
  bekleyenFaturalar,
  faturaUrunEslesmeleri,
  gunlukHareket,
  sonHareketTarihi,
  IZAHAT_ADLARI,
  KOD_ALANLARI,
  kodSuzgeciKur,
  PASIF_KODU,
  PASIF_ALANI,
  PASIF_DURUMU,
  pasifIfadesi,
  stokPasifHaric,
  cariPasifHaric
};
