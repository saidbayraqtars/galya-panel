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

// OTURUMLAR
//
// Masaüstü programında tek pencere, tek kişi var; oturum uzun süre modül
// seviyesinde tek bir nesneydi. Panel ağdan da açılabildiği için (bkz.
// db/sunucu.js) bu yetmiyor: iki kişi aynı anda bağlanırsa tek nesneyi
// paylaşır, biri giriş yapınca diğeri de onun yetkilerini alırdı. Artık
// oturumlar JETONLA ayrılıyor.
//
//   'yerel'  → Electron penceresinin oturumu (programda tek kişi var)
//   <jeton>  → ağdan bağlanan her tarayıcının kendi oturumu
//
// Jeton, tarayıcıya HttpOnly çerezle veriliyor; sunucu her istekte
// jetonCoz() ile kimin konuştuğunu buradan çözüyor.
const YEREL = 'yerel';
const OTURUM_OMRU_DK = 12 * 60;

function yeniOturum() {
  return {
    rol: KULLANICI,
    kullaniciId: null,
    kullaniciAdi: null,
    yetkiler: bosYetki(),
    girisTarihi: null,
    sonErisim: Date.now()
  };
}

const oturumlar = new Map([[YEREL, yeniOturum()]]);

// Masaüstü tarafındaki eski çağrıları bozmamak için 'yerel' oturum bu adla
// duruyor; jeton verilmeyen her çağrı onu kullanıyor.
function oturumNesnesi(jeton) {
  const anahtar = jeton || YEREL;
  let o = oturumlar.get(anahtar);
  if (!o) {
    o = yeniOturum();
    oturumlar.set(anahtar, o);
  }
  o.sonErisim = Date.now();
  return o;
}

// Uzun süre dokunulmayan ağ oturumları düşer. Yerel oturum hiç düşmez —
// programı açık bırakan kişiyi durduk yere dışarı atmak faydasız.
function eskiOturumlariTemizle() {
  const sinir = Date.now() - OTURUM_OMRU_DK * 60 * 1000;
  for (const [anahtar, o] of oturumlar) {
    if (anahtar !== YEREL && o.sonErisim < sinir) oturumlar.delete(anahtar);
  }
}

function jetonUret() {
  return crypto.randomBytes(32).toString('hex');
}

// Sunucunun her istekte çağırdığı çözücü: jeton geçerliyse oturumu tazeler.
function jetonGecerliMi(jeton) {
  eskiOturumlariTemizle();
  return !!(jeton && jeton !== YEREL && oturumlar.has(jeton));
}

function jetonDus(jeton) {
  if (jeton && jeton !== YEREL) oturumlar.delete(jeton);
}

// Bir kullanıcının AÇIK OLAN BÜTÜN oturumları. Yetkisi değişen ya da silinen
// kişi ağdan da bağlanmış olabilir; tek bir "geçerli oturum" varsayımı artık
// doğru değil.
function kullanicininOturumlari(kullaniciId) {
  const sonuc = [];
  for (const [jeton, o] of oturumlar) {
    if (o.kullaniciId != null && Number(o.kullaniciId) === Number(kullaniciId)) {
      sonuc.push({ jeton, o });
    }
  }
  return sonuc;
}

function oturumuKapat(o) {
  o.rol = KULLANICI;
  o.kullaniciId = null;
  o.kullaniciAdi = null;
  o.yetkiler = bosYetki();
  o.girisTarihi = null;
}

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

async function rolAl(jeton) {
  if (!(await kilitVarMi())) return YONETICI;
  return oturumNesnesi(jeton).rol;
}

// Kanal süzgecinin kullandığı hâl: rol + yetkiler bir arada.
async function oturumAl(jeton) {
  // HİÇ KULLANICI YOKSA kilit yoktur — ama bu YALNIZ masaüstü penceresi için
  // geçerli. Ağdan bağlanan biri için geçerli olsaydı, kullanıcı tanımlanmamış
  // bir kurulumda ağdaki herkes yönetici olurdu. Sunucu zaten en az bir
  // yönetici tanımlı değilse hiç açılmıyor (db/sunucu.js), bu ikinci emniyet.
  if (!(await kilitVarMi())) {
    if (jeton && jeton !== YEREL) {
      return { rol: KULLANICI, kullaniciId: null, kullaniciAdi: null, yetkiler: bosYetki() };
    }
    const y = bosYetki();
    for (const k of YETKILER) y[k.anahtar] = true;
    return { rol: YONETICI, kullaniciId: null, kullaniciAdi: null, yetkiler: y };
  }
  const o = oturumNesnesi(jeton);
  return {
    rol: o.rol,
    kullaniciId: o.kullaniciId,
    kullaniciAdi: o.kullaniciAdi,
    yetkiler: o.yetkiler
  };
}

// Sayım kapsamı: kullanıcının sayabileceği KOD2 sınıfları. Boş dizi =
// sınırsız. Yönetici her zaman sınırsızdır.
async function kapsamAl(jeton) {
  const o = await oturumAl(jeton);
  if (o.rol === YONETICI) return [];
  return (o.yetkiler && o.yetkiler.siniflar) || [];
}

async function yetkiVarMi(anahtar, jeton) {
  const o = await oturumAl(jeton);
  if (o.rol === YONETICI) return true;
  return !!(o.yetkiler && o.yetkiler[anahtar]);
}

async function durumAl(kim) {
  const jeton = kim && kim.jeton;
  const kilit = await kilitVarMi();
  const o = await oturumAl(jeton);
  const ham = oturumNesnesi(jeton);
  return {
    rol: o.rol,
    // Arayüz "Yönetici girişi" düğmesini buna bakarak çiziyor.
    pinVar: kilit,
    // Giriş yapılmış mı? Zorunlu giriş ekranı buna bakıyor: kilit varken
    // girişsiz hiçbir ekran çizilmiyor.
    girisYapildi: !kilit || !!o.kullaniciId,
    // Hiç kullanıcı tanımlı değilse ilk yöneticinin açılabilmesi gerekiyor;
    // arayüz giriş ekranında bunu söylüyor.
    kullaniciYok: !kilit,
    kullaniciId: o.kullaniciId,
    kullaniciAdi: o.kullaniciAdi,
    yetkiler: o.yetkiler,
    yetkiTanimlari: YETKILER,
    girisTarihi: ham.girisTarihi,
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

  const jeton = kim && kim.jeton;
  const oturum = oturumNesnesi(jeton);

  const liste = (await kullanicilariOku()).filter((k) => k.aktif);
  if (!liste.length) {
    // Kullanıcı hiç tanımlanmamış. Masaüstünde zaten herkes yönetici; ağdan
    // bağlanan için böyle bir kapı açılmıyor.
    if (jeton && jeton !== YEREL) {
      const e = new Error(
        'Bu kurulumda hiç kullanıcı tanımlı değil. Ağdan giriş yapabilmek için ' +
        'önce programın kurulu olduğu bilgisayarda bir yönetici tanımlanmalı.'
      );
      e.kod = 'KULLANICI_YOK';
      throw e;
    }
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
  const jeton = kim && kim.jeton;
  const oturum = oturumNesnesi(jeton);
  const oncekiAd = oturum.kullaniciAdi;
  oturum.rol = KULLANICI;
  oturum.kullaniciId = null;
  oturum.kullaniciAdi = null;
  oturum.yetkiler = bosYetki();
  oturum.girisTarihi = null;
  await panel
    .kayit('Güvenlik', 'Oturum kapatıldı', { ad: oncekiAd }, kim && kim.kullanici, kim && kim.bilgisayar)
    .catch(() => {});
  const cevap = await durumAl(kim);
  // Ağ oturumunun jetonu artık geçersiz; çerez kalsa da tanınmıyor.
  jetonDus(jeton);
  return cevap;
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
    // Şu anda açık bir oturumu var mı (bu bilgisayarda ya da ağdan)?
    acikOturum: kullanicininOturumlari(k.id).length > 0
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
  // Ağdan bağlı ikinci bir oturumu olabilir; hepsi tazeleniyor. Pasife
  // alındıysa hepsi kapanıyor — yetkisi alınan kişi açık sekmesiyle çalışmaya
  // devam etmemeli.
  for (const { jeton, o } of kullanicininOturumlari(sonucId)) {
    o.rol = rol;
    o.kullaniciAdi = ad;
    o.yetkiler = yetkiCoz(yetkiler);
    if (!aktif) {
      oturumuKapat(o);
      jetonDus(jeton);
    }
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
  for (const { jeton, o } of kullanicininOturumlari(id)) {
    oturumuKapat(o);
    jetonDus(jeton);
  }

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
    const oturum = oturumNesnesi(kim && kim.jeton);
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
  // Kilit kalktı: bütün ağ oturumları düşüyor (artık kimin ne yetkisi olduğu
  // tanımsız), yerel oturum yöneticiye dönüyor.
  for (const jeton of [...oturumlar.keys()]) {
    if (jeton !== YEREL) oturumlar.delete(jeton);
  }
  const yerel = oturumNesnesi(YEREL);
  yerel.rol = YONETICI;
  yerel.kullaniciId = null;
  yerel.kullaniciAdi = null;
  yerel.yetkiler = bosYetki();
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
  YEREL,
  jetonUret,
  jetonGecerliMi,
  jetonDus,
  kilitVarMi,
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
