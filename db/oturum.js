'use strict';

// Kullanıcı ve yetki katmanı.
//
// Giriş YALNIZCA PIN'ledir: kullanıcı listeden isim seçmez, PIN'ini yazar ve
// program PIN'in kime ait olduğunu bulur. Depoda tabletle sayım yapan kişi
// için en hızlı yol bu. Zorunlu sonucu: PIN'ler benzersiz olmak zorunda —
// pinKaydet() yeni PIN'i mevcutların hepsiyle karşılaştırıyor.
//
// İki rol var:
//
//   yonetici   — bütün ekranlar, onaylar, kullanıcı yönetimi
//   kullanici  — yalnızca yetki verilen işler; sayım kapsamı sınıfla sınırlı
//
// Rol ANA SÜREÇTE tutulur. Arayüz rolü yalnızca "hangi düğmeyi çizeyim" diye
// okur; asıl engel main.js'teki kanal süzgecidir. Arayüz kodu kurcalansa bile
// yasak kanal cevap vermez.
//
// HİÇ KULLANICI TANIMLI DEĞİLSE kilit yoktur: program bugüne kadar nasıl
// çalışıyorsa öyle çalışır ve herkes yöneticidir. Güncelleme kimseyi
// dışarıda bırakmasın diye böyle.

const crypto = require('crypto');
const { sorgu, calistir } = require('./sql');
const panel = require('./panel');
const { YETKILER } = require('./yetki');

const YONETICI = 'yonetici';
const KULLANICI = 'kullanici';
// Eski adı; dışarıdaki çağrılar kırılmasın diye duruyor.
const SAYIMCI = KULLANICI;

// Program açıkken geçerli tek oturum. Program kapanınca düşer.
const oturum = {
  rol: KULLANICI,
  kullaniciId: null,
  kullaniciAdi: null,
  yetkiler: bosYetki(),
  girisTarihi: null
};

// Kullanıcı listesi önbelleği. undefined = henüz okunmadı.
let kullaniciOnbellek;

const KILIT_DENEME = 5;
const KILIT_SANIYE = 30;
let hataSayisi = 0;
let kilitBitis = 0;

function bosYetki() {
  const y = { siniflar: [] };
  for (const k of YETKILER) y[k.anahtar] = false;
  return y;
}

function yetkiCoz(ham) {
  const y = bosYetki();
  let gelen = null;
  try {
    gelen = ham ? JSON.parse(ham) : null;
  } catch (e) {
    gelen = null;
  }
  if (!gelen || typeof gelen !== 'object') return y;
  for (const k of YETKILER) y[k.anahtar] = !!gelen[k.anahtar];
  y.siniflar = Array.isArray(gelen.siniflar)
    ? gelen.siniflar.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (y.tamSayim) y.sayim = true;
  if (y.yedekGeriYukle) y.yedek = true;
  return y;
}

function yetkiYaz(gelen) {
  const y = bosYetki();
  if (gelen && typeof gelen === 'object') {
    for (const k of YETKILER) y[k.anahtar] = !!gelen[k.anahtar];
    y.siniflar = Array.isArray(gelen.siniflar)
      ? gelen.siniflar.map((s) => String(s).trim()).filter(Boolean)
      : [];
  }
  // Alt yetki tek başına anlamsız kalmasın. Tam sayım ara/tam sayım ekranını,
  // geri yükleme de yedekleme merkezini kullanır.
  if (y.tamSayim) y.sayim = true;
  if (y.yedekGeriYukle) y.yedek = true;
  return JSON.stringify(y);
}

function ozetle(pin, tuz) {
  return crypto.scryptSync(String(pin), tuz, 32).toString('hex');
}

function esitMi(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function kullanicilariOku() {
  if (kullaniciOnbellek !== undefined) return kullaniciOnbellek;
  await panel.kur();
  const p = panel.p();
  kullaniciOnbellek = await sorgu(
    `SELECT Id AS id, Ad AS ad, PinTuz AS tuz, PinOzet AS ozet, Rol AS rol,
            Yetkiler AS yetkiler, Aktif AS aktif
     FROM [${p}].dbo.Kullanici
     ORDER BY Rol DESC, Ad`
  );
  return kullaniciOnbellek;
}

// Hiç kullanıcı yoksa (ya da hepsi pasifse) kilit yoktur.
async function kilitVarMi() {
  const liste = await kullanicilariOku();
  return liste.some((k) => k.aktif);
}

async function rolAl() {
  if (!(await kilitVarMi())) return YONETICI;
  return oturum.rol;
}

// Kanal süzgecinin kullandığı hâl: rol + yetkiler bir arada.
async function oturumAl() {
  if (!(await kilitVarMi())) {
    const y = bosYetki();
    for (const k of YETKILER) y[k.anahtar] = true;
    return { rol: YONETICI, kullaniciId: null, kullaniciAdi: null, yetkiler: y };
  }
  return {
    rol: oturum.rol,
    kullaniciId: oturum.kullaniciId,
    kullaniciAdi: oturum.kullaniciAdi,
    yetkiler: oturum.yetkiler
  };
}

// Sayım kapsamı: kullanıcının sayabileceği KOD2 sınıfları. Boş dizi =
// sınırsız. Yönetici her zaman sınırsızdır.
async function kapsamAl() {
  const o = await oturumAl();
  if (o.rol === YONETICI) return [];
  return (o.yetkiler && o.yetkiler.siniflar) || [];
}

async function yetkiVarMi(anahtar) {
  const o = await oturumAl();
  if (o.rol === YONETICI) return true;
  return !!(o.yetkiler && o.yetkiler[anahtar]);
}

async function durumAl(kim) {
  const kilit = await kilitVarMi();
  const o = await oturumAl();
  return {
    rol: o.rol,
    // Arayüz "Yönetici girişi" düğmesini buna bakarak çiziyor.
    pinVar: kilit,
    kullaniciId: o.kullaniciId,
    kullaniciAdi: o.kullaniciAdi,
    yetkiler: o.yetkiler,
    yetkiTanimlari: YETKILER,
    girisTarihi: oturum.girisTarihi,
    kullanici: kim ? kim.kullanici : null
  };
}

// --- Giriş / çıkış ---------------------------------------------------------

async function giris(girdi, kim) {
  const simdi = Date.now();
  if (simdi < kilitBitis) {
    const kalan = Math.ceil((kilitBitis - simdi) / 1000);
    const e = new Error(`Çok fazla yanlış deneme. ${kalan} saniye bekleyin.`);
    e.kod = 'KILITLI';
    throw e;
  }

  const liste = (await kullanicilariOku()).filter((k) => k.aktif);
  if (!liste.length) {
    // Kullanıcı hiç tanımlanmamış; zaten herkes yönetici.
    oturum.rol = YONETICI;
    return durumAl(kim);
  }

  const gelen = girdi && girdi.pin != null ? String(girdi.pin) : '';

  // PIN kime ait? Her kullanıcının kendi tuzu olduğu için hepsi tek tek
  // denenmek zorunda. Eşleşme bulunsa bile döngü kırılmıyor; böylece geçen
  // süre PIN'in listenin başında mı sonunda mı olduğunu ele vermiyor.
  let bulunan = null;
  for (const k of liste) {
    if (esitMi(ozetle(gelen, k.tuz), k.ozet) && !bulunan) bulunan = k;
  }

  if (!bulunan) {
    hataSayisi++;
    if (hataSayisi >= KILIT_DENEME) {
      kilitBitis = simdi + KILIT_SANIYE * 1000;
      hataSayisi = 0;
    }
    await panel
      .kayit('Güvenlik', 'Giriş başarısız', null, kim && kim.kullanici, kim && kim.bilgisayar)
      .catch(() => {});
    const e = new Error('PIN yanlış.');
    e.kod = 'PIN_YANLIS';
    throw e;
  }

  hataSayisi = 0;
  oturum.rol = bulunan.rol === YONETICI ? YONETICI : KULLANICI;
  oturum.kullaniciId = bulunan.id;
  oturum.kullaniciAdi = bulunan.ad;
  oturum.yetkiler = yetkiCoz(bulunan.yetkiler);
  oturum.girisTarihi = new Date();

  await panel
    .kayit(
      'Güvenlik',
      'Giriş yapıldı',
      { kullaniciId: bulunan.id, ad: bulunan.ad, rol: oturum.rol },
      kim && kim.kullanici,
      kim && kim.bilgisayar
    )
    .catch(() => {});
  return durumAl(kim);
}

async function cikis(girdi, kim) {
  const oncekiAd = oturum.kullaniciAdi;
  oturum.rol = KULLANICI;
  oturum.kullaniciId = null;
  oturum.kullaniciAdi = null;
  oturum.yetkiler = bosYetki();
  oturum.girisTarihi = null;
  await panel
    .kayit('Güvenlik', 'Oturum kapatıldı', { ad: oncekiAd }, kim && kim.kullanici, kim && kim.bilgisayar)
    .catch(() => {});
  return durumAl(kim);
}

// --- Kullanıcı yönetimi (yönetici kanalları) -------------------------------

async function kullaniciListesi() {
  await panel.kur();
  const p = panel.p();
  const liste = await sorgu(
    `SELECT Id AS id, Ad AS ad, Rol AS rol, Yetkiler AS yetkiler, Aktif AS aktif,
            Olusturan AS olusturan, KayitTarihi AS kayitTarihi, DegisimTarihi AS degisimTarihi
     FROM [${p}].dbo.Kullanici ORDER BY Rol DESC, Ad`
  );
  return liste.map((k) => ({
    id: k.id,
    ad: k.ad,
    rol: k.rol,
    aktif: !!k.aktif,
    olusturan: k.olusturan,
    kayitTarihi: k.kayitTarihi,
    degisimTarihi: k.degisimTarihi,
    yetkiler: yetkiCoz(k.yetkiler),
    // Şu an bu bilgisayarda giriş yapmış kişi mi?
    acikOturum: oturum.kullaniciId === k.id
  }));
}

// PIN benzersiz olmalı: giriş ekranı isim sormadığı için aynı PIN iki kişide
// olursa hangisinin girdiği belirsizleşir.
async function pinCakisiyorMu(pin, hariçId) {
  const liste = await kullanicilariOku();
  for (const k of liste) {
    if (hariçId && Number(k.id) === Number(hariçId)) continue;
    if (esitMi(ozetle(pin, k.tuz), k.ozet)) return k.ad;
  }
  return null;
}

async function kullaniciKaydet(girdi, kim) {
  await panel.kur();
  const p = panel.p();
  const id = girdi.id ? Number(girdi.id) : null;
  const ad = String(girdi.ad || '').trim();
  if (!ad) throw new Error('Kullanıcı adı boş olamaz.');

  const rol = girdi.rol === YONETICI ? YONETICI : KULLANICI;
  const yetkiler = yetkiYaz(girdi.yetkiler);
  const aktif = girdi.aktif === false ? 0 : 1;
  const pin = girdi.pin != null ? String(girdi.pin).trim() : '';

  if (!id && !pin) throw new Error('Yeni kullanıcı için PIN belirlemelisiniz.');
  if (pin) {
    const cakisan = await pinCakisiyorMu(pin, id);
    if (cakisan) {
      throw new Error(
        `Bu PIN zaten "${cakisan}" kullanıcısında. Giriş ekranı isim sormadığı ` +
        'için her kullanıcının PIN\'i farklı olmalı.'
      );
    }
  }

  const tuz = pin ? crypto.randomBytes(16).toString('hex') : null;
  const ozet = pin ? ozetle(pin, tuz) : null;

  let sonucId = id;
  if (id) {
    await calistir(
      `UPDATE [${p}].dbo.Kullanici
       SET Ad = @ad, Rol = @rol, Yetkiler = @yetkiler, Aktif = @aktif,
           PinTuz = ISNULL(@tuz, PinTuz), PinOzet = ISNULL(@ozet, PinOzet),
           DegisimTarihi = GETDATE()
       WHERE Id = @id`,
      { id, ad, rol, yetkiler, aktif, tuz, ozet }
    );
  } else {
    const r = await sorgu(
      `INSERT INTO [${p}].dbo.Kullanici (Ad, PinTuz, PinOzet, Rol, Yetkiler, Aktif, Olusturan)
       OUTPUT INSERTED.Id AS id
       VALUES (@ad, @tuz, @ozet, @rol, @yetkiler, @aktif, @olusturan)`,
      { ad, tuz, ozet, rol, yetkiler, aktif, olusturan: (kim && kim.kullanici) || null }
    );
    sonucId = r[0].id;
  }

  onbellekTemizle();
  // Giriş yapmış kişinin kendi yetkisi değiştiyse oturumu da tazele; yoksa
  // ekran yeni yetkiyi ancak yeniden girişte görür.
  if (oturum.kullaniciId && Number(oturum.kullaniciId) === Number(sonucId)) {
    oturum.rol = rol;
    oturum.kullaniciAdi = ad;
    oturum.yetkiler = yetkiCoz(yetkiler);
    if (!aktif) await cikis({}, kim);
  }

  await panel
    .kayit(
      'Kullanıcılar',
      id ? 'Kullanıcı güncellendi' : 'Kullanıcı eklendi',
      { id: sonucId, ad, rol, pinDegisti: !!pin, aktif: !!aktif },
      kim && kim.kullanici,
      kim && kim.bilgisayar
    )
    .catch(() => {});

  return { tamam: true, id: sonucId };
}

async function kullaniciSil(girdi, kim) {
  await panel.kur();
  const p = panel.p();
  const id = Number(girdi.id);
  if (!id) throw new Error('Silinecek kullanıcı seçilmedi.');

  const liste = await kullanicilariOku();
  const kayit = liste.find((k) => Number(k.id) === id);
  if (!kayit) throw new Error('Kullanıcı bulunamadı.');

  // Son yöneticiyi silmek programı kilitler: kimse onay veremez, kullanıcı
  // yönetimi de açılmaz.
  const kalanYonetici = liste.filter(
    (k) => k.aktif && k.rol === YONETICI && Number(k.id) !== id
  ).length;
  if (kayit.rol === YONETICI && kalanYonetici === 0) {
    throw new Error(
      'Son yönetici silinemez. Önce başka bir kullanıcıyı yönetici yapın.'
    );
  }

  await calistir(`DELETE FROM [${p}].dbo.Kullanici WHERE Id = @id`, { id });
  onbellekTemizle();
  if (oturum.kullaniciId === id) await cikis({}, kim);

  await panel
    .kayit('Kullanıcılar', 'Kullanıcı silindi', { id, ad: kayit.ad }, kim && kim.kullanici, kim && kim.bilgisayar)
    .catch(() => {});
  return { tamam: true };
}

// --- Eski tek PIN uçları ---------------------------------------------------
//
// Ayarlar ekranındaki "yönetici PIN'i" kutusu artık kullanıcı yönetimine
// yönlendiriyor; bu iki uç, hiç kullanıcı yokken ilk yöneticiyi açmak için
// duruyor.

async function pinBelirle(girdi, kim) {
  const yeni = girdi && girdi.pin != null ? String(girdi.pin).trim() : '';
  if (!yeni) throw new Error('PIN boş olamaz.');

  const liste = await kullanicilariOku();
  const yonetici = liste.find((k) => k.rol === YONETICI);
  await kullaniciKaydet(
    {
      id: yonetici ? yonetici.id : null,
      ad: yonetici ? yonetici.ad : 'Yönetici',
      rol: YONETICI,
      pin: yeni,
      aktif: true
    },
    kim
  );

  // PIN'i belirleyen kişi yönetici kalsın, kendi kendini kilitlemesin.
  const tazelenmis = (await kullanicilariOku()).find((k) => k.rol === YONETICI);
  if (tazelenmis) {
    oturum.rol = YONETICI;
    oturum.kullaniciId = tazelenmis.id;
    oturum.kullaniciAdi = tazelenmis.ad;
    oturum.yetkiler = yetkiCoz(tazelenmis.yetkiler);
    oturum.girisTarihi = oturum.girisTarihi || new Date();
  }
  return durumAl(kim);
}

// Bütün kilidi kaldırır: kullanıcılar silinir, program herkese açık hâline
// döner.
async function pinKaldir(girdi, kim) {
  await panel.kur();
  const p = panel.p();
  await calistir(`DELETE FROM [${p}].dbo.Kullanici`);
  await calistir(
    `UPDATE [${p}].dbo.Guvenlik SET PinTuz = NULL, PinOzet = NULL,
       Degistiren = @kullanici, DegisimTarihi = GETDATE() WHERE Id = 1`,
    { kullanici: (kim && kim.kullanici) || null }
  );
  onbellekTemizle();
  oturum.rol = YONETICI;
  oturum.kullaniciId = null;
  oturum.kullaniciAdi = null;
  oturum.yetkiler = bosYetki();
  await panel
    .kayit('Güvenlik', 'Kullanıcı kilidi kaldırıldı', null, kim && kim.kullanici, kim && kim.bilgisayar)
    .catch(() => {});
  return durumAl(kim);
}

async function pinVarMi() {
  return kilitVarMi();
}

// Ayar dosyası değişip başka bir panel veritabanına geçilirse kullanıcılar
// yeniden okunmalı.
function onbellekTemizle() {
  kullaniciOnbellek = undefined;
}

module.exports = {
  YONETICI,
  KULLANICI,
  SAYIMCI,
  YETKILER,
  rolAl,
  oturumAl,
  kapsamAl,
  yetkiVarMi,
  durumAl,
  giris,
  cikis,
  kullaniciListesi,
  kullaniciKaydet,
  kullaniciSil,
  pinBelirle,
  pinKaldir,
  pinVarMi,
  onbellekTemizle
};
