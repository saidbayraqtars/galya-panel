'use strict';

// Sayım. Kayıtlar GALYA_PANEL veritabanında tutulur; Vega'ya sayım fişi
// yazma işi db/yazma.js içindedir.
//
// İki tür sayım var:
//
//   ara — yalnızca sayım listesine konmuş ürünler (SayimListesi tablosu).
//         Günlük "şu iki kalemi say" işi.
//   tam — kapsamdaki BÜTÜN stok kartları. Dönem sonu envanteri.
//
// İkisinde de miktar yazılmayan satır sayıma girmez; tam sayımda da boş
// bırakılan ürünün stoğu sıfırlanmaz. Kullanıcının kararı buydu: "tam
// sayım" listeyi genişletir, davranışı değiştirmez.
//
// KAPSAM. Alt kullanıcıya yalnızca belirli sınıfları (stok kartındaki KOD2:
// BAR, MUTFAK…) sayma yetkisi verilebiliyor. Kapsam hem listeyi süzer hem
// de kaydetme anında yeniden denetlenir — arayüz kurcalansa bile kapsam
// dışındaki ürün sayıma giremez.
//
// ONAY. Sayım kaydedilince Vega'ya YAZILMAZ; 'bekliyor' durumunda durur.
// Yönetici onaylayınca fiş kesilir (main.js → sayim:onayla).

const { sorgu, calistir } = require('./sql');
const { ayarOku } = require('./ayar');
const { dogrula, kart, tablo } = require('./firma');
const panel = require('./panel');
const { kodSuzgeciKur, stokPasifHaric } = require('./vega');

function vt() {
  return ayarOku().vegaVeritabani;
}

// Kapsam süzgeci. Boş dizi = sınırsız (yönetici ya da sınıf verilmemiş
// kullanıcı). Değerler stok kartındaki KOD2 alanıyla karşılaştırılır.
function kapsamSuzgeci(siniflar, alan) {
  const liste = (Array.isArray(siniflar) ? siniflar : [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (!liste.length) return { kosul: '', parametreler: {} };
  const parametreler = {};
  const adlar = liste.map((deger, i) => {
    parametreler['kapsam' + i] = deger;
    return '@kapsam' + i;
  });
  return {
    kosul: `LTRIM(RTRIM(ISNULL(${alan}, ''))) IN (${adlar.join(', ')})`,
    parametreler
  };
}

// --- Sayım listesi (hangi ürünler sayılacak) ------------------------------

async function listeGetir(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  return sorgu(
    `
    SELECT Id AS id, StokNo AS stokNo, StokAdi AS stokAdi, Sira AS sira
    FROM [${p}].dbo.SayimListesi
    WHERE Firma = @firma AND Aktif = 1
    ORDER BY Sira, StokAdi
  `,
    { firma }
  );
}

async function listeyeEkle(kayit) {
  await panel.kur();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const p = panel.p();
  await calistir(
    `
    MERGE [${p}].dbo.SayimListesi AS H
    USING (SELECT @firma AS Firma, @stokNo AS StokNo) AS Y
       ON H.Firma = Y.Firma AND H.StokNo = Y.StokNo
    WHEN MATCHED THEN UPDATE SET Aktif = 1, StokAdi = @stokAdi
    WHEN NOT MATCHED THEN INSERT (Firma, StokNo, StokAdi, Sira, Aktif)
      VALUES (@firma, @stokNo, @stokAdi, 0, 1);
  `,
    { firma, stokNo: Number(kayit.stokNo), stokAdi: kayit.stokAdi || '' }
  );
  await panel.kayit('Ara Sayım', 'Listeye ürün eklendi', kayit, kayit.kullanici);
  return { tamam: true };
}

// Stok ekranındaki süzgeçten çıkan listeyi tek seferde sayım listesine
// aktarır. "Stoğu sıfır olanlar" ya da "1–5 arası kalanlar" süzgecinden
// doğrudan sayım föyü üretilebilsin diye.
async function topluEkle(kayit) {
  await panel.kur();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const p = panel.p();
  const urunler = Array.isArray(kayit.urunler) ? kayit.urunler : [];
  if (!urunler.length) throw new Error('Listeye eklenecek ürün yok.');

  let eklenen = 0;
  for (const u of urunler) {
    if (!Number(u.stokNo)) continue;
    await calistir(
      `
      MERGE [${p}].dbo.SayimListesi AS H
      USING (SELECT @firma AS Firma, @stokNo AS StokNo) AS Y
         ON H.Firma = Y.Firma AND H.StokNo = Y.StokNo
      WHEN MATCHED THEN UPDATE SET Aktif = 1, StokAdi = @stokAdi
      WHEN NOT MATCHED THEN INSERT (Firma, StokNo, StokAdi, Sira, Aktif)
        VALUES (@firma, @stokNo, @stokAdi, 0, 1);
    `,
      { firma, stokNo: Number(u.stokNo), stokAdi: u.stokAdi || u.ad || '' }
    );
    eklenen++;
  }

  await panel.kayit(
    'Ara Sayım',
    'Sayım listesi süzgeçten oluşturuldu',
    { firma, eklenen, kaynak: kayit.kaynak || null },
    kayit.kullanici
  );
  return { tamam: true, eklenen };
}

async function listeyiBosalt(kayit) {
  await panel.kur();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const p = panel.p();
  const etkilenen = await calistir(
    `UPDATE [${p}].dbo.SayimListesi SET Aktif = 0 WHERE Firma = @firma AND Aktif = 1`,
    { firma }
  );
  await panel.kayit('Ara Sayım', 'Sayım listesi boşaltıldı', { firma }, kayit.kullanici);
  return { tamam: true, cikarilan: etkilenen[0] || 0 };
}

async function listedenCikar(kayit) {
  await panel.kur();
  const { firma } = await dogrula(kayit.firma, kayit.donem);
  const p = panel.p();
  await calistir(
    `UPDATE [${p}].dbo.SayimListesi SET Aktif = 0
     WHERE Firma = @firma AND StokNo = @stokNo`,
    { firma, stokNo: Number(kayit.stokNo) }
  );
  return { tamam: true };
}

// --- Yeni sayım -----------------------------------------------------------

// Sayım ekranını açarken teorik (Vega'daki) miktarları da getiriyoruz.
//
// tur = 'ara'  → sayım listesindeki ürünler
// tur = 'tam'  → kapsamdaki bütün stok kartları (pasifler hariç)
//
// SÜZGEÇ. Tam sayımda liste 900 kartı geçebiliyor; müşterinin isteğiyle stok
// ekranındaki sınıflandırma süzgeçlerinin (KOD1…KOD10, "özel kod") aynısı
// buraya da kondu. Süzgeç YALNIZCA listeyi daraltır — kapsam (kullanıcının
// sayabileceği sınıflar) ayrı bir şeydir ve oturumdan gelir; ikisi birlikte
// uygulanır, süzgeç kapsamı genişletemez.
//
// sayimKaydet bu süzgeçleri BİLEREK geçirmiyor: kaydetme anındaki denetim
// listesi süzgeçsiz okunur, yani süzgecin üst kümesidir. Kullanıcı süzgeci
// değiştirse bile kaydettiği satırlar reddedilmez.
//
// STOK DURUMU SÜZGECİ (`stokDurumu`: eksi / sifir / dolu). Vega'daki miktara
// bakar, yani körleme sayımda sayan kişiye sızdırılmamalı: "eksi olanları
// göster" diyebilen kişi hangi ürünün eksi olduğunu öğrenirdi. Bu yüzden
// main.js → sayim:ekran alanı yönetici olmayandan siliyor; buradaki kod
// gelen değeri olduğu gibi uygular.
function stokDurumuKosulu(deger) {
  const d = String(deger || '').trim();
  if (d === 'eksi') return 'ISNULL(K.KALAN, 0) < 0';
  if (d === 'sifir') return 'ISNULL(K.KALAN, 0) = 0';
  if (d === 'dolu') return 'ISNULL(K.KALAN, 0) > 0';
  if (d === 'eksiSifir') return 'ISNULL(K.KALAN, 0) <= 0';
  return '';
}

async function sayimEkraniGetir(secim) {
  await panel.kur();
  const { firma, donem } = await dogrula(secim.firma, secim.donem);
  const v = vt();
  const p = panel.p();
  const depo = Number(secim.depo != null ? secim.depo : ayarOku().varsayilanDepo) || 0;
  const tam = String(secim.tur || 'ara') === 'tam';
  const kapsam = kapsamSuzgeci(secim.siniflar, 'S.KOD2');
  const kod = kodSuzgeciKur(secim);
  const durumKosulu = stokDurumuKosulu(secim.stokDurumu);

  const envanter = `
    WITH K AS (
      SELECT E.STOKNO, SUM(E.ENVANTER) AS KALAN
      FROM ${tablo(v, firma, donem, 'TBLDEPOENVANTER')} E
      WHERE (@depo = 0 OR E.DEPO = @depo) AND E.BELGETIPI <> 67
      GROUP BY E.STOKNO
    )`;

  if (tam) {
    // Tam sayım. Pasif kartlar listeye alınmaz — sayım föyünde görünmeleri
    // sayan kişiyi boş yere oyalar. Pasif ölçütü db/vega.js'de: Vega'nın
    // STATUS = 2 alanı ya da firmanın KOD8 = 'PASİF' işareti.
    return sorgu(
      `
      ${envanter}
      SELECT
        S.IND                  AS stokNo,
        S.MALINCINSI           AS stokAdi,
        ISNULL(S.STOKKODU,'')  AS stokKodu,
        ISNULL(S.KOD2, '')     AS sinif,
        ISNULL(B.BIRIMADI, '') AS birim,
        ISNULL(K.KALAN, 0)     AS teorik,
        ISNULL(S.MALIYET, 0)   AS birimMaliyet
      FROM ${kart(v, firma, 'TBLSTOKLAR')} S
      LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B
             ON B.STOKNO = S.IND AND B.VARSAYILAN = 1
      LEFT JOIN K ON K.STOKNO = S.IND
      WHERE ISNULL(S.DELETED, 0) = 0
        AND S.IND >= 100
        AND S.STOKTIPI NOT IN (3, 7, 9)
        AND ${stokPasifHaric()}
        ${kapsam.kosul ? 'AND ' + kapsam.kosul : ''}
        ${kod.kosullar.length ? 'AND ' + kod.kosullar.join(' AND ') : ''}
        ${durumKosulu ? 'AND ' + durumKosulu : ''}
      ORDER BY ISNULL(S.KOD2, ''), S.MALINCINSI
    `,
      Object.assign({ depo }, kapsam.parametreler, kod.parametreler)
    );
  }

  return sorgu(
    `
    ${envanter}
    SELECT
      L.StokNo AS stokNo,
      ISNULL(S.MALINCINSI, L.StokAdi) AS stokAdi,
      ISNULL(S.STOKKODU,'') AS stokKodu,
      ISNULL(S.KOD2, '')    AS sinif,
      ISNULL(B.BIRIMADI, '') AS birim,
      ISNULL(K.KALAN, 0)     AS teorik,
      ISNULL(S.MALIYET, 0)   AS birimMaliyet
    FROM [${p}].dbo.SayimListesi L
    LEFT JOIN ${kart(v, firma, 'TBLSTOKLAR')} S ON S.IND = L.StokNo
    LEFT JOIN ${kart(v, firma, 'TBLBIRIMLEREX')} B ON B.STOKNO = L.StokNo AND B.VARSAYILAN = 1
    LEFT JOIN K ON K.STOKNO = L.StokNo
    WHERE L.Firma = @firma AND L.Aktif = 1
      ${kapsam.kosul ? 'AND ' + kapsam.kosul : ''}
      ${kod.kosullar.length ? 'AND ' + kod.kosullar.join(' AND ') : ''}
      ${durumKosulu ? 'AND ' + durumKosulu : ''}
    ORDER BY L.Sira, ISNULL(S.MALINCINSI, L.StokAdi)
  `,
    Object.assign({ firma, depo }, kapsam.parametreler, kod.parametreler)
  );
}

async function sayimKaydet(kayit) {
  await panel.kur();
  const { firma, donem } = await dogrula(kayit.firma, kayit.donem);
  const p = panel.p();
  const depo = Number(kayit.depo != null ? kayit.depo : ayarOku().varsayilanDepo) || 0;
  const satirlar = Array.isArray(kayit.satirlar) ? kayit.satirlar : [];
  if (!satirlar.length) throw new Error('Sayım satırı yok. En az bir ürün girin.');

  const tur = String(kayit.tur || 'ara') === 'tam' ? 'tam' : 'ara';
  const siniflar = (Array.isArray(kayit.siniflar) ? kayit.siniflar : [])
    .map((s) => String(s).trim())
    .filter(Boolean);

  // Körleme sayım: teorik miktar ve birim maliyet arayüze hiç gönderilmiyor,
  // dolayısıyla arayüzden de gelmiyor. Kaydetme anında Vega'dan yeniden
  // okunuyor. Yan faydası: arayüz kurcalansa bile fark uydurulamaz.
  //
  // Aynı okuma kapsam denetimini de yapıyor: liste kullanıcının sınıflarıyla
  // süzülerek geldiği için, kapsam dışındaki bir ürün haritada bulunmaz ve
  // aşağıda reddedilir.
  const guncel = await sayimEkraniGetir({
    firma: kayit.firma,
    donem: kayit.donem,
    depo: kayit.depo,
    tur,
    siniflar
  });
  const harita = new Map(guncel.map((g) => [Number(g.stokNo), g]));

  const kapsamDisi = satirlar.filter((s) => !harita.has(Number(s.stokNo)));
  if (kapsamDisi.length) {
    throw new Error(
      `${kapsamDisi.length} ürün sayım kapsamınızın dışında ` +
      `(${kapsamDisi.slice(0, 3).map((s) => s.stokAdi || s.stokNo).join(', ')}` +
      `${kapsamDisi.length > 3 ? '…' : ''}). Sayım kaydedilmedi.`
    );
  }

  const basliklar = await sorgu(
    `
    INSERT INTO [${p}].dbo.AraSayim
      (Firma, Donem, Depo, Sayan, Aciklama, Tur, Kapsam, Durum)
    OUTPUT INSERTED.Id AS id
    VALUES (@firma, @donem, @depo, @sayan, @aciklama, @tur, @kapsam, 'bekliyor')
  `,
    {
      firma,
      donem,
      depo,
      sayan: kayit.sayan || null,
      aciklama: kayit.aciklama || null,
      tur,
      kapsam: siniflar.length ? siniflar.join(', ').substring(0, 400) : null
    }
  );
  const sayimId = basliklar[0].id;

  let artan = 0;
  let azalan = 0;
  let farkTutari = 0;

  for (const s of satirlar) {
    const stokNo = Number(s.stokNo);
    const g = harita.get(stokNo) || {};
    const teorik = Number(g.teorik || 0);
    const maliyet = Number(g.birimMaliyet || 0);
    const sayilan = Number(s.sayilan || 0);
    const fark = sayilan - teorik;
    if (fark > 0.0001) artan++;
    else if (fark < -0.0001) azalan++;
    farkTutari += fark * maliyet;

    await calistir(
      `
      INSERT INTO [${p}].dbo.AraSayimSatir
        (SayimId, StokNo, StokAdi, Birim, TeorikMiktar, SayilanMiktar, BirimMaliyet)
      VALUES (@sayimId, @stokNo, @stokAdi, @birim, @teorik, @sayilan, @maliyet)
    `,
      {
        sayimId,
        stokNo,
        stokAdi: g.stokAdi || s.stokAdi || '',
        birim: g.birim || s.birim || '',
        teorik,
        sayilan,
        maliyet
      }
    );
  }

  await panel.kayit(
    'Sayım',
    (tur === 'tam' ? 'Tam' : 'Ara') + ' sayım kaydedildi, onay bekliyor',
    { sayimId, tur, satir: satirlar.length, kapsam: siniflar },
    kayit.sayan
  );
  return {
    tamam: true,
    sayimId,
    tur,
    durum: 'bekliyor',
    satirSayisi: satirlar.length,
    artan,
    azalan,
    farkliSatir: artan + azalan,
    farkTutari
  };
}

// --- Onay akışı -----------------------------------------------------------
//
// Sayım kaydedilir kaydedilmez Vega'ya gitmiyor. Yönetici onaylayınca fiş
// kesiliyor (fişi kesen yer main.js → sayim:onayla, yazma.sayimFisiYaz).
// Buradaki iki fonksiyon yalnızca durumu yürütüyor.

async function onayIsaretle(kayit) {
  await panel.kur();
  const p = panel.p();
  const etkilenen = await calistir(
    `UPDATE [${p}].dbo.AraSayim
     SET Durum = 'onaylandi', Onaylayan = @onaylayan, OnayTarihi = GETDATE(), RedSebebi = NULL
     WHERE Id = @id AND Iptal = 0`,
    { id: Number(kayit.sayimId), onaylayan: kayit.onaylayan || null }
  );
  if (!etkilenen[0]) throw new Error('Sayım bulunamadı.');
  return { tamam: true };
}

async function sayimReddet(kayit) {
  await panel.kur();
  const p = panel.p();
  const mevcut = await sorgu(
    `SELECT VegayaYazildi AS yazildi FROM [${p}].dbo.AraSayim WHERE Id = @id`,
    { id: Number(kayit.sayimId) }
  );
  if (!mevcut.length) throw new Error('Sayım bulunamadı.');
  if (mevcut[0].yazildi) {
    throw new Error("Bu sayım Vega'ya yazılmış. Reddetmek için önce Vega'dan geri alın.");
  }

  await calistir(
    `UPDATE [${p}].dbo.AraSayim
     SET Durum = 'reddedildi', Onaylayan = @onaylayan, OnayTarihi = GETDATE(), RedSebebi = @sebep
     WHERE Id = @id`,
    {
      id: Number(kayit.sayimId),
      onaylayan: kayit.onaylayan || null,
      sebep: (kayit.sebep || '').substring(0, 300) || null
    }
  );
  await panel.kayit(
    'Sayım',
    'Sayım reddedildi',
    { sayimId: kayit.sayimId, sebep: kayit.sebep || null },
    kayit.onaylayan
  );
  return { tamam: true };
}

// Yöneticinin onay kuyruğu. Ana ekrandaki "onay bekleyen sayım" kutusu ve
// yönetici panelindeki liste bunu okuyor.
async function bekleyenler(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  return sorgu(
    `
    SELECT
      S.Id AS id, S.SayimTarihi AS tarih, S.Sayan AS sayan, S.Tur AS tur,
      S.Kapsam AS kapsam, S.Aciklama AS aciklama, S.Depo AS depo,
      COUNT(D.Id) AS satirSayisi,
      SUM(CASE WHEN D.Fark <> 0 THEN 1 ELSE 0 END) AS farkliSatir,
      ISNULL(SUM(D.Fark * D.BirimMaliyet), 0) AS farkTutari
    FROM [${p}].dbo.AraSayim S
    LEFT JOIN [${p}].dbo.AraSayimSatir D ON D.SayimId = S.Id
    WHERE S.Firma = @firma AND S.Iptal = 0 AND S.Durum = 'bekliyor'
    GROUP BY S.Id, S.SayimTarihi, S.Sayan, S.Tur, S.Kapsam, S.Aciklama, S.Depo
    ORDER BY S.SayimTarihi
  `,
    { firma }
  );
}

async function sayimListesi(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  return sorgu(
    `
    SELECT TOP 100
      S.Id AS id,
      S.SayimTarihi AS tarih,
      S.Sayan AS sayan,
      S.Aciklama AS aciklama,
      S.Tur AS tur,
      S.Durum AS durum,
      S.Kapsam AS kapsam,
      S.Onaylayan AS onaylayan,
      S.OnayTarihi AS onayTarihi,
      S.RedSebebi AS redSebebi,
      S.VegayaYazildi AS vegayaYazildi,
      S.VegaBelgeNo AS vegaBelgeNo,
      COUNT(D.Id) AS satirSayisi,
      SUM(CASE WHEN D.Fark <> 0 THEN 1 ELSE 0 END) AS farkliSatir,
      ISNULL(SUM(D.Fark * D.BirimMaliyet), 0) AS farkTutari
    FROM [${p}].dbo.AraSayim S
    LEFT JOIN [${p}].dbo.AraSayimSatir D ON D.SayimId = S.Id
    WHERE S.Firma = @firma AND S.Iptal = 0
    GROUP BY S.Id, S.SayimTarihi, S.Sayan, S.Aciklama, S.Tur, S.Durum, S.Kapsam,
             S.Onaylayan, S.OnayTarihi, S.RedSebebi, S.VegayaYazildi, S.VegaBelgeNo
    ORDER BY S.SayimTarihi DESC
  `,
    { firma }
  );
}

async function sayimDetayi(secim) {
  await panel.kur();
  const p = panel.p();
  return sorgu(
    `
    SELECT
      StokNo AS stokNo,
      StokAdi AS stokAdi,
      Birim AS birim,
      TeorikMiktar AS teorik,
      SayilanMiktar AS sayilan,
      Fark AS fark,
      BirimMaliyet AS birimMaliyet,
      Fark * BirimMaliyet AS farkTutari
    FROM [${p}].dbo.AraSayimSatir
    WHERE SayimId = @sayimId
    ORDER BY ABS(Fark) DESC, StokAdi
  `,
    { sayimId: Number(secim.sayimId) }
  );
}

async function sonSayimFarki(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  const r = await sorgu(
    `
    SELECT TOP 1
      S.Id AS sayimId,
      S.SayimTarihi AS tarih,
      SUM(CASE WHEN D.Fark <> 0 THEN 1 ELSE 0 END) AS farkliSatir,
      ISNULL(SUM(D.Fark * D.BirimMaliyet), 0) AS farkTutari
    FROM [${p}].dbo.AraSayim S
    LEFT JOIN [${p}].dbo.AraSayimSatir D ON D.SayimId = S.Id
    WHERE S.Firma = @firma AND S.Iptal = 0
    GROUP BY S.Id, S.SayimTarihi
    ORDER BY S.SayimTarihi DESC
  `,
    { firma }
  );
  return r[0] || { sayimId: null, tarih: null, farkliSatir: 0, farkTutari: 0 };
}

// Her stok için EN SON yapılan fiziki sayım. Stok kontrol ekranında teorik
// miktarın karşısına bunu yazıyoruz. İptal edilmiş sayımlar hesaba katılmaz.
async function fizikiSayimlar(secim) {
  await panel.kur();
  const { firma } = await dogrula(secim.firma, secim.donem);
  const p = panel.p();
  return sorgu(
    `
    SELECT
      D.StokNo         AS stokNo,
      D.SayilanMiktar  AS sayilan,
      S.SayimTarihi    AS sayimTarihi,
      S.Sayan          AS sayan
    FROM [${p}].dbo.AraSayimSatir D
    JOIN [${p}].dbo.AraSayim S ON S.Id = D.SayimId
    JOIN (
      SELECT D2.StokNo, MAX(S2.Id) AS SonId
      FROM [${p}].dbo.AraSayimSatir D2
      JOIN [${p}].dbo.AraSayim S2 ON S2.Id = D2.SayimId
      WHERE S2.Firma = @firma AND S2.Iptal = 0
      GROUP BY D2.StokNo
    ) SON ON SON.StokNo = D.StokNo AND SON.SonId = S.Id
    WHERE S.Firma = @firma AND S.Iptal = 0
  `,
    { firma }
  );
}

async function sayimIptal(kayit) {
  await panel.kur();
  const p = panel.p();
  await calistir(`UPDATE [${p}].dbo.AraSayim SET Iptal = 1 WHERE Id = @id`, {
    id: Number(kayit.sayimId)
  });
  await panel.kayit('Ara Sayım', 'Sayım geri alındı', kayit, kayit.kullanici);
  return { tamam: true };
}

module.exports = {
  listeGetir,
  listeyeEkle,
  topluEkle,
  listeyiBosalt,
  listedenCikar,
  sayimEkraniGetir,
  sayimKaydet,
  sayimListesi,
  sayimDetayi,
  sonSayimFarki,
  fizikiSayimlar,
  sayimIptal,
  onayIsaretle,
  sayimReddet,
  bekleyenler,
  kapsamSuzgeci
};
