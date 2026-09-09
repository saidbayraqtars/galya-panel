'use strict';

// Üretim. İki yolu var:
//
//   SIFIRA KADAR  sifirAdaylari() / sifiraKadarUret() / hepsiniSifirla()
//                 — Stoğu EKSİYE düşmüş, reçetesi olan ürünler sıfıra
//                   çekilir. Üretilecek miktarı program bulur (eksi kalanın
//                   kendisi), kullanıcı yazmaz. Zayi fişi KESİLMEZ; zayi
//                   girişi ayrı bir ekranın işi (db/zayi.js).
//   FİRELİ        fireliUret() — HAMMADDE fire vermiştir. "10 kg ham somondan
//   (manuel)        3 kg somon çıktı, 7 kg fire" işi: 7 kg hammadde zayi
//                   çıkış fişiyle düşer, kalan 3 kg tüketilip 3 kg mamul
//                   üretilir. Reçete gerekmez; hammaddeyi kullanıcı seçer.
//                   Fire varsa ÖNCE zayi fişi, SONRA üretim yazılır; üretim
//                   yazılamazsa fire fişi geri alınır — stoktan düşmüş ama
//                   üretilmemiş hammadde bırakılmaz.
//
// ZAYİATLI ÜRETİM 25.08.2026'da KALDIRILDI. Zayi fişini kesip ardından stoğu
// sıfıra çeken birleşik kip iki ayrı işi tek düğmeye bindiriyordu. Müşterinin
// kararı: zayi girişi "Zayi / personel çıkışı" ekranında yapılsın (çalışanın
// zayi ettiği ürün orada yazılır), eksiye düşen ürün de burada ayrıca sıfıra
// kadar üretilsin. Kaldırılan uçlar: `uretim.zayiatliUret`,
// `uretim.uretilebilirler` ve `uretim:zayiatli` / `uretim:uretilebilirler`
// kanalları.
//
// Üretim fişinin ve zayi fişinin kendisi db/yazma.js içindedir (yazma
// kilidine tabi).

const { sorgu } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, tablo, kart, tabloVarMi } = require('./firma');
const panel = require('./panel');
const yazma = require('./yazma');
const { stokPasifHaric } = require('./vega');

function vt() {
  return ayarOku().vegaVeritabani;
}

// Bir ürünün depodaki güncel kalanı. Üretim miktarını yazma anında buradan
// hesaplıyoruz; ekrandaki eski sayıyla üretmek stoğu yanlış yere oturturdu
// (Şefim aradaki saniyelerde satış işlemeye devam ediyor).
async function kalanMiktar(v, firma, donem, stokNo, depo) {
  const r = await sorgu(
    `SELECT ISNULL(SUM(E.ENVANTER), 0) AS kalan
     FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')} E
     WHERE E.STOKNO = @stokNo AND E.BELGETIPI <> 67
       AND (@depo = 0 OR E.DEPO = @depo)`,
    { stokNo: Number(stokNo), depo: Number(depo) || 0 }
  );
  return Number((r[0] && r[0].kalan) || 0);
}

// KENDİNİ TÜKETEN REÇETE.
//
// Bazı kartların reçetesinde mamulün KENDİSİ bileşen olarak duruyor —
// içkilerde şişeden kadeh üretimi böyle: "Tequila.Olmeca Blanco" üretmek
// için 0,07 birim "Tequila.Olmeca Blanco" tüketiliyor (F0102'de gerçek veri).
//
// Böyle bir kartta 1 birim üretim stoğu 1 değil (1 − oran) kadar artırır.
// Eksiği kapatmak için üretilecek miktar bu yüzden ölçekleniyor:
//
//     üretilecek = eksik / (1 − oran)
//
// Ölçeklenmezse tek geçişte sıfıra inilmiyor (canlıda denendi: −0,1575 olan
// Tequila, 0,1575 üretimden sonra −0,0110'da kaldı). Oran 1 veya üstündeyse
// üretim stoğu hiç artırmaz; o kart sıfıra çekilemez ve hata veriyoruz.
//
// Oran = (mamulün kendi reçetesindeki miktarı / verim) × (1 + fire/100).
// Bileşen çarpanının yazma tarafındaki karşılığı yazma.uretimHazirligi
// içinde; ikisi aynı formülü kullanıyor.
async function kendiTuketimOrani(v, firma, stokNo) {
  const r = await sorgu(
    `SELECT TOP 1
       ISNULL(L.MIKTAR, 1) AS verim,
       ISNULL((
         SELECT SUM(ISNULL(B.MIKTAR, 0) * (1 + ISNULL(B.FIREORANI, 0) / 100.0))
         FROM ${kart(v, firma, 'TBLURERECETE')} B
         WHERE B.EVRAKNO = L.IND AND B.STOKNO = @stokNo
       ), 0) AS kendiMiktar
     FROM ${kart(v, firma, 'TBLURERECETELIST')} L
     WHERE L.STOKNO = @stokNo
     ORDER BY L.IND`,
    { stokNo: Number(stokNo) }
  );
  if (!r.length) return 0;
  const verim = Number(r[0].verim) > 0 ? Number(r[0].verim) : 1;
  return Number(r[0].kendiMiktar || 0) / verim;
}

// Eksiği kapatmak için üretilecek miktar. Kendini tüketmeyen reçetede
// eksiğin kendisi, tüketende ölçeklenmiş hâli.
function sifirlamaMiktari(eksik, oran) {
  const o = Number(oran) || 0;
  if (o >= 1) return null;   // üretim stoğu artırmıyor, sıfıra çekilemez
  return eksik / (1 - o);
}

// Sıfıra çekilecek adaylar: stoğu EKSİYE düşmüş ve REÇETESİ OLAN ürünler.
// Reçete şart — üretim fişi tüketim satırlarını reçeteden okuyor.
//
// Eskiden (22.08 öncesi otomatik üretimde) bu liste yalnızca THIRD (KOD11)
// işaretli kartları getiriyordu. Müşterinin isteği "eksiye düşmüş ürünleri de
// sıfıra kadar üretebilelim" olduğu için artık eksideki bütün reçeteli
// kartlar geliyor; THIRD işareti listede sütun olarak duruyor ve
// `thirdSadece` ile eski dar listeye dönülebiliyor.
async function sifirAdaylari(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  const arama = (secim.arama || '').trim();
  const thirdSadece = secim.thirdSadece ? 1 : 0;

  const satirlar = await sorgu(
    `
    WITH K AS (
      SELECT E.STOKNO, SUM(E.ENVANTER) AS KALAN
      FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')} E
      WHERE (@depo = 0 OR E.DEPO = @depo) AND E.BELGETIPI <> 67
      GROUP BY E.STOKNO
    ),
    R AS (
      SELECT L.STOKNO, MIN(L.IND) AS receteNo
      FROM ${kart(v, firma, 'TBLURERECETELIST')} L
      GROUP BY L.STOKNO
    ),
    -- Mamulün kendi reçetesinde bileşen olarak geçen miktarı (şişeden kadeh
    -- üretimi böyle tanımlanmış). Üretilecek miktar buna göre ölçekleniyor.
    KENDI AS (
      SELECT B.EVRAKNO,
             SUM(ISNULL(B.MIKTAR, 0) * (1 + ISNULL(B.FIREORANI, 0) / 100.0)) AS miktar
      FROM ${kart(v, firma, 'TBLURERECETE')} B
      JOIN ${kart(v, firma, 'TBLURERECETELIST')} L2 ON L2.IND = B.EVRAKNO AND L2.STOKNO = B.STOKNO
      GROUP BY B.EVRAKNO
    )
    SELECT TOP 500
      S.IND                 AS stokNo,
      S.MALINCINSI          AS ad,
      ISNULL(S.STOKKODU,'') AS kod,
      ISNULL(S.KOD2, '')    AS sinif,
      ISNULL(S.KOD11, '')   AS kod11,
      ISNULL(B.BIRIMADI,'') AS birim,
      ISNULL(K.KALAN, 0)    AS kalan,
      -ISNULL(K.KALAN, 0)   AS eksik,
      ISNULL(S.MALIYET, 0)  AS birimMaliyet,
      R.receteNo,
      ISNULL(SS.satirSayisi, 0) AS receteSatiri,
      ISNULL(KENDI.miktar, 0) / CASE WHEN ISNULL(RL.MIKTAR, 1) > 0
                                     THEN ISNULL(RL.MIKTAR, 1) ELSE 1 END AS kendiOran,
      CASE WHEN I.StokNo IS NULL THEN 0 ELSE 1 END AS panelIsareti
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    JOIN R ON R.STOKNO = S.IND
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    LEFT JOIN (
      SELECT EVRAKNO, COUNT(*) AS satirSayisi
      FROM ${kart(v, firma, 'TBLURERECETE')}
      GROUP BY EVRAKNO
    ) SS ON SS.EVRAKNO = R.receteNo
    LEFT JOIN ${kart(v, firma, 'TBLURERECETELIST')} RL ON RL.IND = R.receteNo
    LEFT JOIN KENDI ON KENDI.EVRAKNO = R.receteNo
    LEFT JOIN [${panel.p()}].dbo.ThirdIsaret I
           ON I.Firma = @firma AND I.StokNo = S.IND AND I.Isaretli = 1
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      AND ISNULL(K.KALAN, 0) < 0
      AND ISNULL(SS.satirSayisi, 0) > 0
      AND ${stokPasifHaric()}
      AND (@thirdSadece = 0 OR S.KOD11 = 'THIRD' OR I.StokNo IS NOT NULL)
      AND (@arama = '' OR S.MALINCINSI LIKE @desen OR S.STOKKODU LIKE @desen)
    ORDER BY ISNULL(K.KALAN, 0) ASC
  `,
    { depo, firma, arama, desen: '%' + arama + '%', thirdSadece }
  );

  // Üretilecek miktar kendini tüketen reçetede ölçekleniyor; oran 1'i geçen
  // kart sıfıra çekilemiyor ve ekranda sebebiyle birlikte görünüyor.
  return satirlar.map((s) => {
    const oran = Number(s.kendiOran) || 0;
    const miktar = sifirlamaMiktari(Number(s.eksik), oran);
    return Object.assign({}, s, {
      kendiOran: oran,
      uretilecek: miktar,
      uretilemez: miktar == null
    });
  });
}

// Fireli üretimde mamul ve hammadde seçimi: reçetesi olsun olmasın BÜTÜN
// aktif stok kartları. "Somon" mamulünün reçetesi yok, "ham somon" da bir
// mamul değil — ikisi de bu listeden seçiliyor.
//
// Ayrı bir uç olmasının sebebi yetki: stok ekranı `stok` yetkisine bağlı ve
// sayımcıya o yetki verilmiyor. Bu liste `uretim` yetkisiyle açılıyor ve
// yalnızca kart bilgisi döndürüyor.
async function urunAra(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  const arama = (secim.arama || '').trim();

  return sorgu(
    `
    WITH K AS (
      SELECT E.STOKNO, SUM(E.ENVANTER) AS KALAN
      FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')} E
      WHERE (@depo = 0 OR E.DEPO = @depo) AND E.BELGETIPI <> 67
      GROUP BY E.STOKNO
    )
    SELECT TOP 300
      S.IND                 AS stokNo,
      S.MALINCINSI          AS ad,
      ISNULL(S.STOKKODU,'') AS kod,
      ISNULL(S.KOD2, '')    AS sinif,
      ISNULL(B.BIRIMADI,'') AS birim,
      ISNULL(S.MALIYET, 0)  AS birimMaliyet,
      ISNULL(K.KALAN, 0)    AS kalan
    FROM ${kart(v, firma, 'TBLSTOKLAR')} S
    LEFT JOIN K ON K.STOKNO = S.IND
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
           ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
    WHERE ISNULL(S.DELETED, 0) = 0 AND S.IND >= 100
      AND S.STOKTIPI NOT IN (3, 7, 9, 11, 26)
      AND ${stokPasifHaric()}
      AND (@arama = '' OR S.MALINCINSI LIKE @desen OR S.STOKKODU LIKE @desen)
    ORDER BY S.MALINCINSI
  `,
    { depo, arama, desen: '%' + arama + '%' }
  );
}

// Bir mamulün reçetesindeki ÇIKTI satırları.
//
// Bir üretimden birden fazla ürün çıkabiliyor: "DANA ANTRIKOT" reçetesinde
// ana mamulün yanında DANA KUŞBAŞI, DANA KIYMA ve FİRE de var. Vega'nın İş
// Emri ekranındaki "Üretim Çıktıları" sekmesi bu satırları gösteriyor ve
// miktarları kullanıcı yazıyor (25 kg ham et → 18 antrikot + 3 kuşbaşı +
// 3 kıyma + 1 fire). Panel bu tabloyu 08.09.2026'ya kadar hiç okumadı ve
// her üretimde yalnız ana mamulü yazdı.
//
// Arayüz mamul seçilir seçilmez burayı çağırıp satırları ekrana koyuyor.
// Tek satır dönerse (433 reçetenin 479'u böyle) ekran değişmiyor.
//
// ORAN, çıktının toplam maliyetten aldığı yüzdedir. Toplamı 100 olmak
// zorunda değil — DANA ANTRIKOT reçetesinde 200 ve Vega bunu uyarmadan
// uyguluyor, yani 23.750 TL hammadde 47.500 TL mamule dönüyor. Panel de
// aynısını yazıyor (yoksa sayılar Vega'nınkiyle tutmaz) ama ekranda uyarı
// gösteriyor: oranToplami alanı bunun için var.
async function receteCiktilari(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const mamulStokNo = Number(secim.mamulStokNo);
  if (!mamulStokNo) throw new Error('Ürün seçilmeli.');

  // Tablo her firmada yok (Vega üretim modülü kullanılınca oluşturuyor).
  if (!(await tabloVarMi(firma, '', 'TBLURERECETECIKTI'))) {
    return { receteNo: 0, satirlar: [], oranToplami: 0 };
  }

  const basliklar = await sorgu(
    `SELECT TOP 1 IND AS receteNo FROM ${kart(v, firma, 'TBLURERECETELIST')}
     WHERE STOKNO = @stokNo ORDER BY IND`,
    { stokNo: mamulStokNo }
  );
  if (!basliklar.length) return { receteNo: 0, satirlar: [], oranToplami: 0 };
  const receteNo = Number(basliklar[0].receteNo);

  const satirlar = (await sorgu(
    `SELECT C.STOKNO AS stokNo, ISNULL(C.TUR, 0) AS tur, ISNULL(C.ORAN, 0) AS oran,
            S.MALINCINSI AS ad, ISNULL(S.STOKKODU,'') AS kod,
            ISNULL(B.BIRIMADI, '') AS birim
     FROM ${kart(v, firma, 'TBLURERECETECIKTI')} C
     JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = C.STOKNO
     LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
            ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
     WHERE C.EVRAKNO = @receteNo
     ORDER BY C.TUR, C.IND`,
    { receteNo }
  )).map((c) => ({
    stokNo: Number(c.stokNo),
    ad: c.ad,
    kod: c.kod,
    birim: c.birim,
    tur: Number(c.tur),
    oran: Number(c.oran),
    anaMamul: Number(c.tur) === 0 && Number(c.stokNo) === mamulStokNo
  }));

  return {
    receteNo,
    satirlar,
    oranToplami: satirlar.reduce((t, s) => t + s.oran, 0)
  };
}

// Vega'nın İŞ EMRİ ekranının panel karşılığı: bir mamul seçildiğinde ekranın
// ihtiyacı olan HER ŞEY tek çağrıda dönüyor.
//
// Vega'da kullanıcı mamulü seçtiği anda İş Emri ekranı reçeteden iki sekmeyi
// birden dolduruyor: "Üretim Girdileri" (ne tüketilecek) ve "Üretim Çıktıları"
// (ne çıkacak, hangi maliyet oranıyla). Kullanıcı yalnız MİKTARLARI yazıyor.
// 08.09.2026 ekran kaydında yapılan iş bu: DANA ANTRIKOT reçetesi açıldı,
// girdi 1 → 25 KG yapıldı, dört çıktıya 18 / 3 / 3 / 1 yazıldı.
//
// Panel bunu iki ayrı uçtan (urunAra + receteCiktilari) toplayıp ekranda
// birleştiriyordu; girdiler hiç okunmuyordu, kullanıcı hammaddeyi her seferinde
// elle arıyordu. Tek uç hem ekranı Vega'nınkine benzetiyor hem de birim
// maliyetleri getiriyor — ekran artık tutarları Vega'nın yazacağı sayıyla
// birebir gösterebiliyor.
//
// Reçetesi olmayan mamulde receteNo 0 döner; girdiler ve çıktılar boştur.
// Ekran o zaman reçetesiz manuel üretime düşüyor (hammaddeyi kullanıcı seçer,
// fire zayi fişine yazılır) — o akış korunuyor.
async function isEmri(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  const mamulStokNo = Number(secim.mamulStokNo);
  if (!mamulStokNo) throw new Error('Ürün seçilmeli.');

  const kartlar = await sorgu(
    `SELECT S.IND AS stokNo, S.MALINCINSI AS ad, ISNULL(S.STOKKODU,'') AS kod,
            ISNULL(S.MALIYET, 0) AS birimMaliyet, ISNULL(B.BIRIMADI,'') AS birim
     FROM ${kart(v, firma, 'TBLSTOKLAR')} S
     LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
            ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
     WHERE S.IND = @stokNo`,
    { stokNo: mamulStokNo }
  );
  if (!kartlar.length) throw new Error('Üretilecek mamulün stok kartı bulunamadı.');
  const mamul = {
    stokNo: mamulStokNo,
    ad: kartlar[0].ad,
    kod: kartlar[0].kod,
    birim: kartlar[0].birim,
    birimMaliyet: Number(kartlar[0].birimMaliyet),
    kalan: await kalanMiktar(v, firma, donem, mamulStokNo, depo)
  };

  const basliklar = await sorgu(
    `SELECT TOP 1 IND AS receteNo, ISNULL(MIKTAR, 1) AS verim
     FROM ${kart(v, firma, 'TBLURERECETELIST')}
     WHERE STOKNO = @stokNo ORDER BY IND`,
    { stokNo: mamulStokNo }
  );
  if (!basliklar.length) {
    return { mamul, receteNo: 0, verim: 1, girdiler: [], ciktilar: [], oranToplami: 0 };
  }
  const receteNo = Number(basliklar[0].receteNo);
  const verim = Number(basliklar[0].verim) > 0 ? Number(basliklar[0].verim) : 1;

  // Reçetenin bileşenleri = Vega'nın "Üretim Girdileri" sekmesi. FIREORANI
  // yüzde: %5 fire, 100 birimlik reçetede 105 birim tüketim demek. Ekran
  // miktarı buradan başlatıp kullanıcıya bırakıyor.
  const girdiler = (await sorgu(
    `SELECT R.STOKNO AS stokNo, ISNULL(R.MIKTAR, 0) AS receteMiktari,
            ISNULL(R.FIREORANI, 0) AS fireOrani,
            S.MALINCINSI AS ad, ISNULL(S.STOKKODU,'') AS kod,
            ISNULL(S.MALIYET, 0) AS birimMaliyet,
            ISNULL(B.BIRIMADI,'') AS birim,
            ISNULL(E.KALAN, 0) AS kalan
     FROM ${kart(v, firma, 'TBLURERECETE')} R
     JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = R.STOKNO
     LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
            ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
     OUTER APPLY (
       SELECT SUM(D.ENVANTER) AS KALAN
       FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')} D
       WHERE D.STOKNO = R.STOKNO AND D.BELGETIPI <> 67
         AND (@depo = 0 OR D.DEPO = @depo)
     ) E
     WHERE R.EVRAKNO = @receteNo
     ORDER BY R.DETAY`,
    { receteNo, depo }
  )).map((g) => ({
    stokNo: Number(g.stokNo),
    ad: g.ad,
    kod: g.kod,
    birim: g.birim,
    kalan: Number(g.kalan),
    birimMaliyet: Number(g.birimMaliyet),
    receteMiktari: Number(g.receteMiktari),
    fireOrani: Number(g.fireOrani)
  }));

  const cikti = await receteCiktilari(secim);
  return {
    mamul,
    receteNo,
    verim,
    girdiler,
    ciktilar: cikti.satirlar,
    oranToplami: cikti.oranToplami
  };
}

// Sayaç yarışında (Şefim entegrasyonu aynı 96/97 numarasını alırsa) işlem
// geri alınıp yeniden deneniyor.
async function denemeliYaz(istek) {
  let sonHata = null;
  for (let deneme = 1; deneme <= 3; deneme++) {
    try {
      return await yazma.uretimFisiYaz(istek);
    } catch (e) {
      if (e && e.kod === 'SAYAC_CAKISMASI') {
        sonHata = e;
        continue;
      }
      throw e;
    }
  }
  throw sonHata || new Error('Üretim fişi yazılamadı.');
}

// SIFIRA KADAR ÜRET — tek ürün.
//
// Miktar verilmezse stoğu sıfıra getirecek kadar üretilir. Kalan, yazma
// anında Vega'dan YENİDEN okunuyor; ekrandaki sayı kullanılsaydı aradaki
// satışlar üretim miktarını yanlış çıkarırdı.
//
// Zayi fişi kesilmiyor. Zayiat varsa önce "Zayi / personel çıkışı"
// ekranından yazılır, stok eksiye düşer, sonra burası sıfıra çeker.
async function sifiraKadarUret(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  const stokNo = Number(secim.stokNo);
  if (!stokNo) throw new Error('Ürün seçilmeli.');

  const kartlar = await sorgu(
    `SELECT IND AS stokNo, MALINCINSI AS ad FROM ${kart(v, firma, 'TBLSTOKLAR')} WHERE IND = @stokNo`,
    { stokNo }
  );
  if (!kartlar.length) throw new Error('Stok kartı bulunamadı.');
  const ad = kartlar[0].ad;

  const kalan = await kalanMiktar(v, firma, donem, stokNo, depo);
  const oran = await kendiTuketimOrani(v, firma, stokNo);
  let miktar = Number(secim.miktar || 0);
  if (!(miktar > 0)) {
    if (kalan >= -0.0001) {
      throw new Error(`"${ad}" stoğu eksi değil (kalan ${kalan}), üretilecek miktar yok.`);
    }
    // Kendini tüketen reçetede eksiğin kendisi kadar üretmek yetmiyor;
    // üretimin bir kısmı yine aynı karttan düşüyor.
    miktar = sifirlamaMiktari(-kalan, oran);
    if (miktar == null) {
      throw new Error(
        `"${ad}" reçetesi kendi kendini ${oran} oranında tüketiyor; üretim stoğu ` +
        'artırmıyor, sıfıra çekilemez. Reçeteyi düzeltin.'
      );
    }
  }

  const fis = await denemeliYaz({
    firma,
    donem,
    depo,
    mamulStokNo: stokNo,
    miktar,
    aciklama: secim.aciklama || 'Stok sıfırlama üretimi',
    kullanici: secim.kullanici,
    userNo: secim.userNo
  });

  await panel.kayit(
    'Üretim',
    'Sıfıra kadar üretim',
    { firma, donem, depo, stokNo, ad, kalan, miktar, kendiOran: oran, uretimFisNo: fis.fisNo },
    secim.kullanici
  );

  return {
    tamam: true,
    uretildi: true,
    mamulAdi: ad,
    oncekiKalan: kalan,
    uretilenMiktar: miktar,
    kendiOran: oran,
    fisNo: fis.fisNo,
    uretimInd: fis.uretimInd
  };
}

// SIFIRA KADAR ÜRET — toplu. Verilen ürünler (verilmezse eksideki bütün
// adaylar) tek tek sıfıra çekilir.
//
// Bir ürün hata verirse diğerleri yazılmaya devam eder; sonuç listesinde
// hangisinin neden yazılamadığı görünür. Yarıda kesilseydi kullanıcı hangi
// ürünün yazıldığını bilemezdi.
async function hepsiniSifirla(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;

  const tumAdaylar = await sifirAdaylari({ firma, donem, depo });
  const istenen = (Array.isArray(secim.stokNolar) ? secim.stokNolar : [])
    .map(Number)
    .filter(Boolean);
  const liste = (istenen.length
    ? tumAdaylar.filter((a) => istenen.includes(Number(a.stokNo)))
    : tumAdaylar
  ).filter((a) => !a.uretilemez);   // sıfıra çekilemeyen kart boşuna denenmiyor

  if (!liste.length) return { tamam: true, yazilan: 0, hatali: 0, sonuclar: [] };

  const sonuclar = [];
  for (const aday of liste) {
    try {
      const s = await sifiraKadarUret({
        firma,
        donem,
        depo,
        stokNo: Number(aday.stokNo),
        aciklama: 'Stok sıfırlama üretimi',
        kullanici: secim.kullanici,
        userNo: secim.userNo
      });
      sonuclar.push({
        stokNo: Number(aday.stokNo), ad: aday.ad, miktar: s.uretilenMiktar,
        tamam: true, fisNo: s.fisNo
      });
    } catch (e) {
      sonuclar.push({
        stokNo: Number(aday.stokNo), ad: aday.ad, miktar: Number(aday.uretilecek),
        tamam: false, mesaj: e.message || String(e)
      });
    }
  }

  const yazilan = sonuclar.filter((s) => s.tamam).length;
  await panel.kayit(
    'Üretim',
    'Toplu sıfırlama üretimi',
    { firma, donem, aday: liste.length, yazilan },
    secim.kullanici
  );

  return { tamam: true, yazilan, hatali: sonuclar.length - yazilan, sonuclar };
}

// FİRELİ ÜRETİM (manuel) — "10 kg ham somondan 3 kg somon, 7 kg fire".
//
// Kullanıcı üç şeyi giriyor: ne üretilecek (mamul), neyden üretilecek
// (hammadde satırları, girilen miktar ve fire miktarıyla) ve kaç birim mamul
// çıktı. Program iki belge kesiyor:
//
//   1. Zayi çıkış fişi (33) — hammaddenin FİRE kısmı, seçilen cariye.
//   2. Üretim fişi          — kalan hammadde tüketilir, mamul stoğa girer.
//
// Fire sıfırsa zayi fişi hiç kesilmez, yalnızca üretim yazılır.
//
// Sıra bilinçli: önce zayi. Üretim adımı hata verirse zayi fişi geri alınır,
// yarım iş kalmaz. Tersi sırada üretim yazılıp zayi yazılamasaydı stokta
// olmayan hammadde tüketilmiş görünürdü.
//
// Reçete GEREKMEZ. Bileşenleri kullanıcı seçtiği için üretim fişi
// yazma.uretimHazirligi'na elle bileşen listesiyle gidiyor.
//
// ÇOK ÇIKTILI KİP (08.09.2026). Mamulün reçetesinde birden fazla çıktı
// varsa (DANA ANTRIKOT → antrikot + kuşbaşı + kıyma + fire) arayüz
// `ciktilar` gönderiyor ve iş kökten değişiyor:
//
//   - Hammaddenin TAMAMI tüketilir; "giren − fire" hesabı yapılmaz.
//   - Fire ayrı bir zayi çıkış fişine YAZILMAZ; reçetedeki FİRE kartına
//     üretim çıktısı (96) olarak girer. Vega'nın yaptığı budur; ikisi bir
//     arada yapılsaydı fire iki kez düşerdi.
//   - Cari hareketi oluşmaz.
//
// Tek çıktılı reçetelerde ve reçetesiz üretimde eski akış aynen sürüyor:
// fire → zayi fişi (müşterinin 22.08.2026'daki isteği).
async function fireliUret(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  const mamulStokNo = Number(secim.mamulStokNo);
  const uretilenMiktar = Number(secim.uretilenMiktar);

  if (!mamulStokNo) throw new Error('Üretilecek ürün seçilmeli.');
  if (!(uretilenMiktar > 0)) throw new Error('Üretilen miktar sıfırdan büyük olmalı.');

  const hammaddeler = (Array.isArray(secim.hammaddeler) ? secim.hammaddeler : [])
    .map((h) => ({
      stokNo: Number(h.stokNo),
      miktar: Number(h.miktar || 0),
      fire: Number(h.fire || 0)
    }))
    .filter((h) => h.stokNo);

  if (!hammaddeler.length) throw new Error('En az bir hammadde satırı girilmeli.');
  for (const h of hammaddeler) {
    if (!(h.miktar > 0)) throw new Error('Her hammadde satırının giren miktarı sıfırdan büyük olmalı.');
    if (h.fire < 0) throw new Error('Fire miktarı eksi olamaz.');
    if (h.fire > h.miktar + 0.0001) {
      throw new Error('Fire, giren hammadde miktarından fazla olamaz.');
    }
  }

  const ciktilar = (Array.isArray(secim.ciktilar) ? secim.ciktilar : [])
    .map((c) => ({ stokNo: Number(c.stokNo), miktar: Number(c.miktar || 0) }))
    .filter((c) => c.stokNo && c.miktar > 0.0001);
  const cokCiktili = ciktilar.length > 1;

  if (cokCiktili && !ciktilar.some((c) => c.stokNo === mamulStokNo)) {
    throw new Error('Çıktı satırlarında üretilen ürünün miktarı yazılmamış.');
  }

  const fireSatirlari = cokCiktili ? [] : hammaddeler.filter((h) => h.fire > 0.0001);
  if (fireSatirlari.length && !Number(secim.cariNo)) {
    throw new Error('Fire yazılacak cari seçilmeli (ZAYİ, FİRE ya da personel).');
  }

  // Tüketilecek miktar. Çok çıktılı kipte hammaddenin tamamı tüketilir
  // (fire bir çıktı satırıdır); tek çıktılı kipte giren − fire.
  const bilesenler = hammaddeler
    .map((h) => ({ stokNo: h.stokNo, miktar: cokCiktili ? h.miktar : h.miktar - h.fire }))
    .filter((b) => b.miktar > 0.0001);
  if (!bilesenler.length) {
    throw new Error(
      'Bütün hammadde fire olarak girilmiş; tüketilecek bir şey kalmıyor. ' +
      'Yalnızca fire yazmak istiyorsanız Zayi ekranını kullanın.'
    );
  }

  const mamuller = await sorgu(
    `SELECT IND AS stokNo, MALINCINSI AS ad FROM ${kart(v, firma, 'TBLSTOKLAR')} WHERE IND = @stokNo`,
    { stokNo: mamulStokNo }
  );
  if (!mamuller.length) throw new Error('Üretilecek ürünün stok kartı bulunamadı.');
  const mamulAdi = mamuller[0].ad;

  // 1. adım — fire zayi fişi
  let zayiFisi = null;
  if (fireSatirlari.length) {
    zayiFisi = await yazma.zayiFisiYaz({
      firma,
      donem,
      depo,
      cariNo: Number(secim.cariNo),
      cariAdi: secim.cariAdi || null,
      altHesap: secim.altHesap || 'FİRE',
      sebep: secim.sebep || `Fireli üretim - ${mamulAdi}`,
      maliyetliMi: !!secim.maliyetliMi,
      satirlar: fireSatirlari.map((h) => ({ stokNo: h.stokNo, miktar: h.fire })),
      kullanici: secim.kullanici,
      userNo: secim.userNo
    });
  }

  // 2. adım — üretim fişi
  try {
    const fis = await denemeliYaz({
      firma,
      donem,
      depo,
      mamulStokNo,
      miktar: uretilenMiktar,
      bilesenler,
      ciktilar: cokCiktili ? ciktilar : null,
      aciklama: secim.aciklama || (cokCiktili ? 'Reçeteli üretim' : 'Fireli üretim'),
      kullanici: secim.kullanici,
      userNo: secim.userNo
    });

    const fireToplami = fireSatirlari.reduce((t, h) => t + h.fire, 0);
    await panel.kayit(
      'Üretim',
      cokCiktili ? 'Çok çıktılı üretim yapıldı' : 'Fireli üretim yapıldı',
      {
        firma, donem, depo, mamulStokNo, mamulAdi, uretilenMiktar,
        hammaddeler, fireToplami, cokCiktili,
        ciktilar: fis.ciktilar || null,
        zayiBelgeNo: zayiFisi ? zayiFisi.belgeNo : null,
        uretimFisNo: fis.fisNo
      },
      secim.kullanici
    );

    return {
      tamam: true,
      zayiBelgeNo: zayiFisi ? zayiFisi.belgeNo : null,
      zayiBaslikInd: zayiFisi ? zayiFisi.baslikInd : null,
      fireToplami,
      uretildi: true,
      uretilenMiktar,
      fisNo: fis.fisNo,
      uretimInd: fis.uretimInd,
      mamulAdi,
      cokCiktili,
      ciktilar: fis.ciktilar || null,
      toplamMaliyet: fis.toplamMaliyet,
      dagitilanMaliyet: fis.dagitilanMaliyet
    };
  } catch (e) {
    if (!zayiFisi) throw e;

    // Üretim yazılamadı: fire fişini geri alıp stoğu eski hâline döndürüyoruz.
    let geriAlindi = false;
    try {
      await yazma.zayiFisiGeriAl({
        firma,
        donem,
        baslikInd: zayiFisi.baslikInd,
        kullanici: secim.kullanici
      });
      geriAlindi = true;
    } catch (e2) {
      // Geri alma da başarısızsa kullanıcıya belge numarası söylenmeli;
      // elle düzeltmesi gerekecek.
    }
    const hata = new Error(
      `Üretim fişi yazılamadı: ${e.message || e}. ` +
      (geriAlindi
        ? `Fire fişi (${zayiFisi.belgeNo}) geri alındı, stok değişmedi.`
        : `DİKKAT: fire fişi ${zayiFisi.belgeNo} Vega'da kaldı ve geri alınamadı, elle silin.`)
    );
    hata.kod = e && e.kod ? e.kod : null;
    throw hata;
  }
}

async function gecmis(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  return sorgu(
    `SELECT TOP 100
       Id AS id, Tarih AS tarih, MamulStokNo AS stokNo, MamulAdi AS mamulAdi,
       Miktar AS miktar, FisNo AS fisNo, UretimInd AS uretimInd,
       Kullanici AS kullanici, GeriAlindi AS geriAlindi, Belgeler AS belgeler
     FROM [${panel.p()}].dbo.UretimFisi
     WHERE Firma = @firma AND Donem = @donem
     ORDER BY Id DESC`,
    { firma, donem }
  );
}

async function geriAl(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const kayitlar = await sorgu(
    `SELECT UretimInd AS uretimInd, Belgeler AS belgeler, GeriAlindi AS geriAlindi
     FROM [${panel.p()}].dbo.UretimFisi WHERE Id = @id AND Firma = @firma`,
    { id: Number(secim.id), firma }
  );
  if (!kayitlar.length) throw new Error('Üretim kaydı bulunamadı.');
  if (kayitlar[0].geriAlindi) throw new Error('Bu üretim zaten geri alınmış.');

  return yazma.uretimFisiGeriAl({
    firma,
    donem,
    uretimInd: kayitlar[0].uretimInd,
    belgeler: JSON.parse(kayitlar[0].belgeler || '[]'),
    kullanici: secim.kullanici
  });
}

module.exports = {
  sifirAdaylari,
  sifiraKadarUret,
  hepsiniSifirla,
  urunAra,
  receteCiktilari,
  isEmri,
  fireliUret,
  gecmis,
  geriAl
};
