'use strict';

// Maliyetlendirme.
//
// Vega'nın kendi maliyetlendirme aracı çalışırken izleyiciyle dinlendi ve
// veritabanına tek satır yazmadığı görüldü (kurulum kaydı: 6468 okuma,
// 0 yazma). Yani deseni kopyalanacak bir belge yok; maliyeti kendimiz
// hesaplayıp stok kartına yazıyoruz.
//
// Kural — müşterinin isteği:
//   hammadde maliyeti = SON ALIŞ fiyatı (alış faturası hareketi, IZAHAT 20)
//   mamul maliyeti    = bileşen maliyeti toplamı × ana mamulün payı / verim
//
// "Ana mamulün payı" 08.09.2026'da eklendi. Bir üretimden birden fazla ürün
// çıkabiliyor ve reçete, maliyetin ne kadarının hangi çıktıya yazılacağını
// F{firma}TBLURERECETECIKTI.ORAN alanında tutuyor. Motor bu tabloyu
// bilmiyordu ve maliyetin TAMAMINI mamule yazıyordu; ana mamulün oranı
// 100'den küçük olan reçetede (F0102'de 4497 TAVUK BONFILE, %9,07) mamul
// maliyeti olduğundan yüksek çıkıyordu.
//
// Formül reçetenin kendi sakladığı çıktı fiyatıyla doğrulandı:
//   4497 TAVUK BONFILE  4845 × %9,07211558 / 190   = 2,31338947  ✔
//   4515 LEVREK         6296 × %100        / 3,624 = 1737,30684  ✔
//   4516 DANA ANTRIKOT   950 × %100        / 1     = 950         ✔
//
// Hesap alttan yukarı yürür: bir mamulün bileşeni de mamulse önce onun
// maliyeti bulunur. Döngü olursa (A, B'yi; B, A'yı içeriyorsa) zincir
// kırılır ve o kart "hesaplanamadı" olarak işaretlenir.

const { sorgu, calistir } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, kart, tabloVarMi } = require('./firma');
const vega = require('./vega');
const panel = require('./panel');
const yazma = require('./yazma');

function vt() {
  return ayarOku().vegaVeritabani;
}

// Reçete tanımlarını tek seferde okur; ağaç bellekte kurulur, her ürün için
// ayrı sorgu atılmaz (3.900 kartta binlerce sorgu demek olurdu).
async function receteHaritasi(v, firma) {
  const basliklar = await sorgu(`
    SELECT IND AS receteNo, STOKNO AS mamulNo, ISNULL(MIKTAR, 1) AS verim
    FROM ${kart(v, firma, 'TBLURERECETELIST')}
  `);
  const satirlar = await sorgu(`
    SELECT EVRAKNO AS receteNo, STOKNO AS stokNo,
           ISNULL(MIKTAR, 0) AS miktar, ISNULL(FIREORANI, 0) AS fireOrani
    FROM ${kart(v, firma, 'TBLURERECETE')}
  `);

  // Ana mamulün maliyet payı. Tablo her firmada yok (Vega üretim modülü
  // kullanılınca oluşturuyor); yoksa pay %100 sayılır ve motor eskisi gibi
  // çalışır.
  const oranHaritasi = new Map();
  if (await tabloVarMi(firma, '', 'TBLURERECETECIKTI')) {
    const oranlar = await sorgu(`
      SELECT EVRAKNO AS receteNo, ISNULL(ORAN, 0) AS oran
      FROM ${kart(v, firma, 'TBLURERECETECIKTI')}
      WHERE ISNULL(TUR, 0) = 0
    `);
    for (const o of oranlar) {
      const oran = Number(o.oran);
      // Oran 0 ya da eksi ise bilgi yok sayılıyor: mamule sıfır maliyet
      // yazmak, düzeltmekten çok bozardı.
      if (oran > 0) oranHaritasi.set(Number(o.receteNo), oran);
    }
  }

  const satirHaritasi = new Map();
  for (const s of satirlar) {
    const liste = satirHaritasi.get(Number(s.receteNo)) || [];
    liste.push(s);
    satirHaritasi.set(Number(s.receteNo), liste);
  }

  // Bir mamulün birden fazla reçete başlığı olabiliyor; ilkini (en küçük
  // IND) kullanıyoruz — panelin reçete ekranı da öyle davranıyor.
  const mamulHaritasi = new Map();
  for (const b of basliklar) {
    const no = Number(b.mamulNo);
    if (!no) continue;
    const eski = mamulHaritasi.get(no);
    if (!eski || Number(b.receteNo) < Number(eski.receteNo)) {
      mamulHaritasi.set(no, {
        receteNo: Number(b.receteNo),
        verim: Number(b.verim) > 0 ? Number(b.verim) : 1,
        anaOran: oranHaritasi.has(Number(b.receteNo))
          ? oranHaritasi.get(Number(b.receteNo))
          : 100,
        satirlar: satirHaritasi.get(Number(b.receteNo)) || []
      });
    }
  }
  return mamulHaritasi;
}

// Tek ürünün maliyeti. gorulen = döngü koruması, o an hesaplanmakta olan
// kartların kümesi.
function maliyetHesapla(stokNo, kartlar, receteler, onbellek, gorulen) {
  const no = Number(stokNo);
  if (onbellek.has(no)) return onbellek.get(no);

  const k = kartlar.get(no);
  const recete = receteler.get(no);

  // Reçetesi yoksa (ya da döngüye girdiysek) son alış fiyatı geçerli.
  function alistan() {
    if (!k) return { deger: null, kaynak: 'yok' };
    if (Number(k.sonAlisFiyati) > 0) {
      return { deger: Number(k.sonAlisFiyati), kaynak: 'alis' };
    }
    if (Number(k.kartAlisFiyati) > 0) {
      return { deger: Number(k.kartAlisFiyati), kaynak: 'kartAlis' };
    }
    return { deger: null, kaynak: 'yok' };
  }

  if (!recete || !recete.satirlar.length) {
    const s = alistan();
    onbellek.set(no, s);
    return s;
  }

  if (gorulen.has(no)) {
    // Döngü: bu kartın maliyetini reçeteden çıkaramayız.
    return { deger: null, kaynak: 'dongu' };
  }
  gorulen.add(no);

  let toplam = 0;
  let eksikBilesen = 0;
  for (const satir of recete.satirlar) {
    const alt = maliyetHesapla(satir.stokNo, kartlar, receteler, onbellek, gorulen);
    if (alt.deger == null) {
      eksikBilesen++;
      continue;
    }
    // Fire oranı yüzde: 5 fire, 100 birimlik reçetede 105 birim tüketim.
    const miktar = Number(satir.miktar) * (1 + Number(satir.fireOrani || 0) / 100);
    toplam += alt.deger * miktar;
  }
  gorulen.delete(no);

  // Maliyetin yalnız ana mamule düşen payı yazılıyor; gerisi yan mamullerin.
  const anaOran = Number(recete.anaOran) > 0 ? Number(recete.anaOran) : 100;
  const sonuc = toplam > 0
    ? {
        deger: toplam * anaOran / 100 / recete.verim,
        kaynak: 'recete',
        eksikBilesen,
        anaOran
      }
    : alistan();

  onbellek.set(no, sonuc);
  return sonuc;
}

const KAYNAK_ADI = {
  alis: 'Son alış fiyatı',
  kartAlis: 'Kart alış fiyatı',
  recete: 'Reçeteden hesaplandı',
  dongu: 'Reçete döngüsü',
  yok: 'Fiyat bulunamadı'
};

// Bütün kartların maliyetini hesaplar ve kart maliyetiyle karşılaştırır.
// Hiçbir şey yazmaz; ekranda gösterilen liste budur.
async function hesapla(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();

  const [kartListesi, receteler] = await Promise.all([
    vega.sonAlisFiyatlari({ firma, donem }),
    receteHaritasi(v, firma)
  ]);

  const kartlar = new Map();
  for (const k of kartListesi) kartlar.set(Number(k.stokNo), k);

  const onbellek = new Map();
  const satirlar = [];
  for (const k of kartListesi) {
    // Pasif kartlar hesabın İÇİNDE kalır (17'si hâlâ aktif reçetelerde
    // bileşen; çıkarılırsa üst mamulün maliyeti eksik çıkar) ama listeye
    // ve yazılacak kümeye girmez.
    if (k.pasif) continue;
    const h = maliyetHesapla(k.stokNo, kartlar, receteler, onbellek, new Set());
    const kartMaliyeti = Number(k.kartMaliyeti || 0);
    const yeni = h.deger;
    const fark = yeni == null ? null : yeni - kartMaliyeti;
    satirlar.push({
      stokNo: Number(k.stokNo),
      ad: k.ad,
      kod: k.kod,
      birim: k.birim,
      stokTipi: k.stokTipi,
      mamulMu: receteler.has(Number(k.stokNo)) ? 1 : 0,
      kartMaliyeti,
      sonAlisFiyati: k.sonAlisFiyati == null ? null : Number(k.sonAlisFiyati),
      sonAlisTarihi: k.sonAlisTarihi || null,
      yeniMaliyet: yeni,
      fark,
      farkYuzde: yeni == null || kartMaliyeti === 0 ? null : (fark / kartMaliyeti) * 100,
      kaynak: h.kaynak,
      kaynakAdi: KAYNAK_ADI[h.kaynak] || h.kaynak
    });
  }

  // Önce en çok sapan kartlar: kullanıcı listenin başında işi görsün.
  satirlar.sort((a, b) => {
    const fa = a.fark == null ? -1 : Math.abs(a.fark);
    const fb = b.fark == null ? -1 : Math.abs(b.fark);
    return fb - fa;
  });

  const degisecek = satirlar.filter(
    (s) => s.yeniMaliyet != null && Math.abs(s.fark) > 0.005
  ).length;

  return { firma, donem, satirlar, degisecek };
}

// Hesaplanan maliyeti stok kartına yazar (TBLSTOKLAR.MALIYET).
// Önceki değerler MaliyetYazma tablosuna kaydedilir; geri alma bunu kullanır.
async function yaz(secim) {
  yazma.kilitKontrol();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();

  const hepsi = await hesapla(secim);
  const secilen = Array.isArray(secim.stokNolar) && secim.stokNolar.length
    ? new Set(secim.stokNolar.map(Number))
    : null;

  const yazilacak = hepsi.satirlar.filter((s) => {
    if (s.yeniMaliyet == null) return false;
    if (Math.abs(s.fark) <= 0.005) return false;
    return !secilen || secilen.has(s.stokNo);
  });

  if (!yazilacak.length) {
    return { tamam: true, yazilan: 0, mesaj: 'Güncellenecek maliyet bulunamadı.' };
  }

  const detay = yazilacak.map((s) => ({
    stokNo: s.stokNo,
    ad: s.ad,
    oncekiMaliyet: s.kartMaliyeti,
    yeniMaliyet: Number(s.yeniMaliyet.toFixed(6)),
    kaynak: s.kaynak
  }));

  const kayit = await sorgu(
    `INSERT INTO [${panel.p()}].dbo.MaliyetYazma (Firma, Kullanici, UrunSayisi, Detay)
     OUTPUT INSERTED.Id AS id
     VALUES (@firma, @kullanici, @adet, @detay)`,
    {
      firma,
      kullanici: secim.kullanici || null,
      adet: detay.length,
      detay: JSON.stringify(detay)
    }
  );

  // Tek tek güncelleniyor; toplu yazma denendiğinde hangi kartta hata
  // olduğu kaybolur ve yarım kalan bir liste geri alınamaz hale gelir.
  let yazilan = 0;
  for (const d of detay) {
    await calistir(
      `UPDATE ${kart(v, firma, 'TBLSTOKLAR')}
       SET MALIYET = @maliyet, GUNCELLEMETARIHI = GETDATE()
       WHERE IND = @stokNo`,
      { maliyet: d.yeniMaliyet, stokNo: d.stokNo }
    );
    yazilan++;
  }

  await panel.kayit(
    'Maliyet',
    'Maliyetlendirme yapıldı',
    { firma, kayitId: kayit[0].id, urunSayisi: yazilan },
    secim.kullanici
  );

  return { tamam: true, yazilan, kayitId: kayit[0].id };
}

async function gecmis(secim) {
  const { firma } = await dogrula(secim.firma, secim.donem);
  return sorgu(
    `SELECT TOP 50 Id AS id, Tarih AS tarih, Kullanici AS kullanici,
            UrunSayisi AS urunSayisi, GeriAlindi AS geriAlindi
     FROM [${panel.p()}].dbo.MaliyetYazma
     WHERE Firma = @firma
     ORDER BY Id DESC`,
    { firma }
  );
}

// Bir maliyetlendirmeyi geri alır: kartlara önceki maliyet değerleri yazılır.
async function geriAl(secim) {
  yazma.kilitKontrol();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const v = vt();

  const kayitlar = await sorgu(
    `SELECT Id AS id, Detay AS detay, GeriAlindi AS geriAlindi
     FROM [${panel.p()}].dbo.MaliyetYazma WHERE Id = @id AND Firma = @firma`,
    { id: Number(secim.kayitId), firma }
  );
  if (!kayitlar.length) throw new Error('Maliyetlendirme kaydı bulunamadı.');
  if (kayitlar[0].geriAlindi) throw new Error('Bu maliyetlendirme zaten geri alınmış.');

  const detay = JSON.parse(kayitlar[0].detay || '[]');
  for (const d of detay) {
    await calistir(
      `UPDATE ${kart(v, firma, 'TBLSTOKLAR')}
       SET MALIYET = @maliyet WHERE IND = @stokNo`,
      { maliyet: Number(d.oncekiMaliyet || 0), stokNo: Number(d.stokNo) }
    );
  }

  await calistir(
    `UPDATE [${panel.p()}].dbo.MaliyetYazma SET GeriAlindi = 1 WHERE Id = @id`,
    { id: Number(secim.kayitId) }
  );

  await panel.kayit(
    'Maliyet',
    'Maliyetlendirme geri alındı',
    { firma, kayitId: Number(secim.kayitId), urunSayisi: detay.length },
    secim.kullanici
  );

  return { tamam: true, geriAlinan: detay.length };
}

// Tek bir mamulün reçete maliyeti — reçete ağacı ekranında kullanılıyor.
async function mamulMaliyeti(secim) {
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const [kartListesi, receteler] = await Promise.all([
    vega.sonAlisFiyatlari({ firma, donem }),
    receteHaritasi(v, firma)
  ]);
  const kartlar = new Map();
  for (const k of kartListesi) kartlar.set(Number(k.stokNo), k);
  const onbellek = new Map();

  const stokNo = Number(secim.stokNo);
  const h = maliyetHesapla(stokNo, kartlar, receteler, onbellek, new Set());
  const recete = receteler.get(stokNo);

  // Bileşen bazında döküm: hangi satır maliyetin ne kadarını getiriyor.
  const bilesenler = [];
  if (recete) {
    for (const s of recete.satirlar) {
      const alt = maliyetHesapla(s.stokNo, kartlar, receteler, onbellek, new Set());
      const k = kartlar.get(Number(s.stokNo));
      const miktar = Number(s.miktar) * (1 + Number(s.fireOrani || 0) / 100);
      bilesenler.push({
        stokNo: Number(s.stokNo),
        ad: k ? k.ad : '(kart yok)',
        miktar: Number(s.miktar),
        fireOrani: Number(s.fireOrani || 0),
        birim: k ? k.birim : '',
        birimMaliyet: alt.deger,
        tutar: alt.deger == null ? null : alt.deger * miktar,
        kaynakAdi: KAYNAK_ADI[alt.kaynak] || alt.kaynak
      });
    }
  }

  const k = kartlar.get(stokNo);
  return {
    stokNo,
    ad: k ? k.ad : '',
    verim: recete ? recete.verim : 1,
    anaOran: recete ? recete.anaOran : 100,
    kartMaliyeti: k ? Number(k.kartMaliyeti || 0) : 0,
    yeniMaliyet: h.deger,
    kaynakAdi: KAYNAK_ADI[h.kaynak] || h.kaynak,
    bilesenler
  };
}

module.exports = { hesapla, yaz, gecmis, geriAl, mamulMaliyeti };
