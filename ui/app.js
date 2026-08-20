'use strict';

/* Galya Panel arayüzü.
   Kural: bir ekran = bir iş. Kullanıcı filtre kurmaz, hazır cevap görür. */

const durum = {
  firma: null,
  donem: null,
  depo: 1,
  firmalar: [],
  depolar: [],
  ekran: 'ana',
  yazmaAcik: false,
  // Yetki. Asıl engel ana süreçte; buradaki değerler yalnızca hangi düğmeyi
  // çizeceğimizi belirler. Hiç kullanıcı tanımlı değilse herkes yöneticidir.
  rol: 'yonetici',
  pinVar: false,
  kullaniciAdi: null,
  yetkiler: {},
  yetkiTanimlari: []
};

const icerik = document.getElementById('icerik');
const uyariSeridi = document.getElementById('uyariSeridi');
const durumRozet = document.getElementById('durumRozet');

// ---------- Yardımcılar ----------

async function cagir(kanal, girdi) {
  const cevap = await window.galya.cagir(kanal, Object.assign({
    firma: durum.firma,
    donem: durum.donem,
    depo: durum.depo
  }, girdi || {}));
  if (!cevap.tamam) {
    const hata = new Error(cevap.mesaj || 'Bilinmeyen hata');
    hata.kod = cevap.kod;
    throw hata;
  }
  return cevap.veri;
}

function el(etiket, ozellik, cocuklar) {
  const d = document.createElement(etiket);
  if (ozellik) {
    for (const k of Object.keys(ozellik)) {
      if (k === 'sinif') d.className = ozellik[k];
      else if (k === 'metin') d.textContent = ozellik[k];
      else if (k === 'tikla') d.addEventListener('click', ozellik[k]);
      else if (k === 'degisti') d.addEventListener('change', ozellik[k]);
      else if (k.startsWith('data-')) d.setAttribute(k, ozellik[k]);
      else d[k] = ozellik[k];
    }
  }
  if (cocuklar) {
    for (const c of [].concat(cocuklar)) {
      if (c == null || c === false) continue;
      d.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return d;
}

function bosalt(kap) {
  while (kap.firstChild) kap.removeChild(kap.firstChild);
}

function sayiYaz(deger, basamak) {
  if (deger == null || isNaN(deger)) return '—';
  return Number(deger).toLocaleString('tr-TR', {
    minimumFractionDigits: basamak == null ? 0 : basamak,
    maximumFractionDigits: basamak == null ? 2 : basamak
  });
}

function paraYaz(deger) {
  if (deger == null) return '—';
  return Number(deger).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function tarihYaz(deger) {
  if (!deger) return '—';
  const t = new Date(deger);
  if (isNaN(t)) return '—';
  return t.toLocaleDateString('tr-TR');
}

function saatliTarih(deger) {
  if (!deger) return '—';
  const t = new Date(deger);
  if (isNaN(t)) return '—';
  return t.toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

let bildirimZaman = null;
function bildir(mesaj, tur) {
  const b = document.getElementById('bildirim');
  b.textContent = mesaj;
  b.className = 'bildirim ' + (tur || 'bilgi');
  // Önceki bildirime bağlanmış tıklama işi yenisine sarkmasın.
  b.onclick = null;
  b.style.cursor = 'default';
  clearTimeout(bildirimZaman);
  bildirimZaman = setTimeout(() => b.classList.add('hidden'), tur === 'kotu' ? 9000 : 4500);
}

function hataGoster(e) {
  bildir(e.message || String(e), 'kotu');
  console.error(e);
}

function yukleniyorGoster(mesaj) {
  bosalt(icerik);
  icerik.appendChild(el('div', { sinif: 'yukleniyor', metin: mesaj || 'Yükleniyor…' }));
}

function ekranBasligi(baslik, sagDugmeler, geriVar) {
  const kap = el('div', { sinif: 'ekran-baslik' });
  if (geriVar !== false) {
    kap.appendChild(el('button', {
      sinif: 'geri',
      metin: '← Ana ekran',
      tikla: () => ekranAc('ana')
    }));
  }
  kap.appendChild(el('h2', { metin: baslik }));
  if (sagDugmeler && sagDugmeler.length) {
    kap.appendChild(el('div', { sinif: 'sag' }, sagDugmeler));
  }
  return kap;
}

// Ekranda gösterilecek en fazla satır. Müşteri veritabanında cari listesi
// 16 bin satıra çıkabiliyor; hepsini çizmek pencereyi saniyelerce kilitliyor.
// Ekranda ilk parça gösteriliyor, dışa aktarmada hepsi gidiyor.
const EKRAN_SATIR_SINIRI = 400;

function tabloYap(basliklar, satirlar, satirCiz, sinir) {
  if (!satirlar.length) {
    return el('div', { sinif: 'bos-mesaj', metin: 'Kayıt yok.' });
  }
  const enFazla = sinir || EKRAN_SATIR_SINIRI;
  const gosterilen = satirlar.length > enFazla ? satirlar.slice(0, enFazla) : satirlar;

  const thead = el('thead', null, [
    el('tr', null, basliklar.map((b) => el('th', { metin: b })))
  ]);
  const tbody = el('tbody', null, gosterilen.map(satirCiz));
  const kap = el('div', { sinif: 'tablo-sarmal' }, [el('table', null, [thead, tbody])]);

  if (satirlar.length > enFazla) {
    const sarmal = el('div');
    sarmal.appendChild(kap);
    sarmal.appendChild(el('div', { sinif: 'liste-notu' }, [
      `${sayiYaz(satirlar.length)} satırın ilk ${sayiYaz(enFazla)} tanesi gösteriliyor. ` +
      "Excel'e veya PDF'e aktardığınızda listenin tamamı gelir."
    ]));
    return sarmal;
  }
  return kap;
}

function hucre(metin, sinif) {
  return el('td', { sinif: sinif || '', metin: metin });
}

function katmanAc(baslik, icerikDugumu) {
  document.getElementById('katmanBaslik').textContent = baslik;
  const kap = document.getElementById('katmanIcerik');
  bosalt(kap);
  kap.appendChild(icerikDugumu);
  document.getElementById('kutuKatman').classList.remove('hidden');
}

function katmanKapat() {
  document.getElementById('kutuKatman').classList.add('hidden');
}

// ---------- Dışa aktarma ----------
//
// Her liste ekranı aynı üç düğmeyi alır: Excel, PDF, Yazdır. raporUret()
// çağrıldığı anda ekrandaki güncel (filtrelenmiş) satırları döndürmeli;
// böylece kullanıcı ne görüyorsa onu aktarır.

function firmaEtiketi() {
  const f = durum.firmalar.find((x) => x.kod === durum.firma);
  const depo = durum.depo ? 'Depo ' + durum.depo : 'Tüm depolar';
  return [
    f ? f.kisaAd : durum.firma,
    `${durum.firma}/${durum.donem}`,
    depo,
    new Date().toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  ].join(' · ');
}

async function raporAktar(kanal, raporUret, dugme) {
  const eskiMetin = dugme.textContent;
  try {
    const rapor = raporUret();
    if (!rapor.satirlar.length) {
      bildir('Aktarılacak satır yok.', 'kotu');
      return;
    }
    rapor.altBaslik = rapor.altBaslik || firmaEtiketi();
    dugme.disabled = true;
    dugme.textContent = 'Hazırlanıyor…';

    const sonuc = await cagir(kanal, rapor);
    if (sonuc.iptal) return;

    bildir(sonuc.tur + ' dosyası kaydedildi. Açmak için buraya tıklayın.', 'iyi');
    const b = document.getElementById('bildirim');
    b.style.cursor = 'pointer';
    b.onclick = () => {
      window.galya.cagir('rapor:ac', { yol: sonuc.yol });
      b.classList.add('hidden');
    };
    // Dosyayı açma fırsatı kaçmasın diye bu bildirim daha uzun kalıyor.
    clearTimeout(bildirimZaman);
    bildirimZaman = setTimeout(() => b.classList.add('hidden'), 15000);
  } catch (e) {
    hataGoster(e);
  } finally {
    dugme.disabled = false;
    dugme.textContent = eskiMetin;
  }
}

function disaAktarDugmeleri(raporUret) {
  const excel = el('button', { sinif: 'dugme-sade', metin: "Excel'e aktar" });
  excel.addEventListener('click', () => raporAktar('rapor:excel', raporUret, excel));

  const pdf = el('button', { sinif: 'dugme-sade', metin: 'PDF kaydet' });
  pdf.addEventListener('click', () => raporAktar('rapor:pdf', raporUret, pdf));

  const yazdir = el('button', {
    sinif: 'dugme-sade',
    metin: 'Yazdır',
    tikla: () => window.galya.cagir('sistem:yazdir')
  });

  return [excel, pdf, yazdir];
}

// ---------- Yetki ----------
//
// Giriş yalnızca PIN'le: kullanıcı listeden isim seçmez, PIN'ini yazar ve
// program PIN'in kime ait olduğunu bulur. Depoda tabletle çalışan için en
// hızlı yol bu.

function yonetici() {
  return durum.rol === 'yonetici';
}

// Ekranı çizmeden önce "bu düğmeyi göstereyim mi" sorusuna cevap.
// Asıl engel ana süreçte; burası sadece görünürlük.
function yetkiVar(anahtar) {
  if (yonetici()) return true;
  return !!(durum.yetkiler && durum.yetkiler[anahtar]);
}

async function oturumDurumuOku() {
  try {
    const o = await window.galya.cagir('oturum:durum');
    if (o && o.tamam) {
      durum.rol = o.veri.rol;
      durum.pinVar = !!o.veri.pinVar;
      durum.kullaniciAdi = o.veri.kullaniciAdi || null;
      durum.yetkiler = o.veri.yetkiler || {};
      durum.yetkiTanimlari = o.veri.yetkiTanimlari || [];
    }
  } catch (e) { /* okunamazsa yönetici varsayılır; kanal süzgeci yine çalışır */ }
  girisDugmesiniYaz();
}

function girisDugmesiniYaz() {
  const d = document.getElementById('girisDugme');
  // Kullanıcı tanımlanmamışsa kilit yoktur; düğmeyi göstermeye gerek yok.
  d.classList.toggle('hidden', !durum.pinVar);
  d.textContent = durum.kullaniciAdi ? `Çıkış (${durum.kullaniciAdi})` : 'Giriş';
  d.title = durum.kullaniciAdi
    ? `${durum.kullaniciAdi} olarak giriş yapıldı. Tıklayınca oturum kapanır.`
    : 'PIN ile giriş yapın';
}

async function oturumdanCik() {
  try {
    await window.galya.cagir('oturum:cikis');
    await oturumDurumuOku();
    bildir('Oturum kapatıldı.', 'iyi');
    await ekranAc('ana');
  } catch (e) { hataGoster(e); }
}

function girisPenceresi() {
  const kutu = el('input', { type: 'password', placeholder: 'PIN' });
  const uyari = el('div', { sinif: 'aciklama-kutu kritik hidden' });

  async function dene() {
    const cevap = await window.galya.cagir('oturum:giris', { pin: kutu.value });
    if (!cevap.tamam) {
      uyari.textContent = cevap.mesaj || 'PIN yanlış.';
      uyari.classList.remove('hidden');
      kutu.value = '';
      kutu.focus();
      return;
    }
    durum.rol = cevap.veri.rol;
    durum.pinVar = !!cevap.veri.pinVar;
    durum.kullaniciAdi = cevap.veri.kullaniciAdi || null;
    durum.yetkiler = cevap.veri.yetkiler || {};
    durum.yetkiTanimlari = cevap.veri.yetkiTanimlari || [];
    girisDugmesiniYaz();
    katmanKapat();
    bildir(
      (durum.kullaniciAdi ? durum.kullaniciAdi : 'Kullanıcı') + ' olarak giriş yapıldı.',
      'iyi'
    );
    await ekranAc('ana');
  }

  kutu.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') dene();
  });

  const kap = el('div', null, [
    el('div', { sinif: 'aciklama-kutu' }, [
      'PIN\'inizi yazın. Kullanıcı adı seçmenize gerek yok — program PIN\'in ' +
      'kime ait olduğunu kendisi bulur. Yaptığınız her iş adınıza kaydedilir.'
    ]),
    uyari,
    el('div', { sinif: 'form-satir' }, [
      el('div', null, [el('label', { metin: 'PIN' }), kutu])
    ]),
    el('div', { sinif: 'form-satir', style: 'margin-top:14px' }, [
      el('button', { sinif: 'dugme-ana', metin: 'Giriş yap', tikla: dene }),
      el('button', { sinif: 'dugme-sade', metin: 'Vazgeç', tikla: katmanKapat })
    ])
  ]);

  katmanAc('Giriş', kap);
  setTimeout(() => kutu.focus(), 50);
}

// ---------- Ekran yönlendirme ----------

const ekranlar = {};

async function ekranAc(ad, parametre) {
  durum.ekran = ad;
  const ciz = ekranlar[ad] || ekranlar.ana;
  yukleniyorGoster();
  try {
    await ciz(parametre || {});
  } catch (e) {
    bosalt(icerik);
    icerik.appendChild(ekranBasligi('Hata', null, ad !== 'ana'));
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu kritik', metin: e.message || String(e) }));
    console.error(e);
  }
}

// ---------- ANA EKRAN ----------

ekranlar.ana = async function () {
  const o = await cagir('ozet:anaEkran');
  bosalt(icerik);

  const kutular = el('div', { sinif: 'kutular' });
  for (const k of o.kutular) {
    const hataliMi = k.hata != null;
    const dugme = el('button', {
      sinif: 'kutu ' + (hataliMi ? 'hatali' : (k.deger ? k.renk : 'yesil')),
      tikla: () => ekranAc(k.ekran, k.parametre)
    }, [
      el('span', { sinif: 'baslik', metin: k.baslik }),
      el('span', { sinif: 'deger', metin: hataliMi ? 'Okunamadı' : sayiYaz(k.deger) }),
      el('span', { sinif: 'alt', metin: hataliMi ? k.hata : k.altBaslik })
    ]);
    kutular.appendChild(dugme);
  }
  icerik.appendChild(kutular);

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Diğer işlemler' }));
  // Yetkisi olmayan kullanıcıya düğme hiç çizilmiyor. Asıl engel ana
  // süreçte; buradaki gizleme sadece boşuna tıklamayı önlüyor.
  const islemler = el('div', { sinif: 'islem-dugmeleri' }, [
    yetkiVar('sayim') && islemDugmesi('Sayım', 'Ara ve tam sayım, onaya gönder', 'sayim'),
    yonetici() && islemDugmesi('Sayım onayı', "Bekleyen sayımları Vega'ya işle", 'sayimOnay'),
    yetkiVar('zayi') && islemDugmesi('Zayi / personel çıkışı', 'Bozulan ya da elde kalan malı düş', 'zayi'),
    yetkiVar('uretim') && islemDugmesi('Üretim', 'Zayiatlı, manuel ve otomatik üretim', 'uretim'),
    islemDugmesi('Reçete ağacı', 'Mamulün altındaki her şeyi gör', 'recete'),
    islemDugmesi('THIRD listesi', 'Üretim gerektiren stokları işaretle', 'third'),
    islemDugmesi('Ürün değişim tutanağı', 'Bir stoktan düş, diğerine ekle', 'tutanak'),
    islemDugmesi('Gider / hizmet stokları', 'Elektrik, su, nakliye kartlarını sıfırla', 'gider'),
    yetkiVar('stok') && islemDugmesi('Cari bakiye', 'Kime ne kadar borç var', 'cari'),
    islemDugmesi('Alış faturası', 'Gelen malı faturasıyla stoğa gir', 'alisFatura'),
    islemDugmesi('Maliyetlendirme', 'Son alış fiyatından maliyet hesapla', 'maliyetlendirme'),
    yonetici() && islemDugmesi('Kullanıcılar', 'Kim neyi yapabilir, kim neyi sayabilir', 'kullanicilar')
  ]);
  icerik.appendChild(islemler);

  const alt = el('div', { sinif: 'bolum-basligi', metin: 'Durum' });
  icerik.appendChild(alt);
  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    `Firma: ${o.firmaAdi} (${o.firma}/${o.donem}) · Vega'daki son hareket: ${tarihYaz(o.sonHareketTarihi)}` +
    (durum.yazmaAcik
      ? " · Vega'ya yazma AÇIK"
      : " · Vega'ya yazma kapalı, kayıtlar panel veritabanında tutuluyor")
  ]));
};

function islemDugmesi(ad, not, ekran, elleIs) {
  return el('button', {
    sinif: 'islem-dugme',
    tikla: elleIs || (() => ekranAc(ekran))
  }, [
    el('span', { sinif: 'ad', metin: ad }),
    el('span', { sinif: 'not', metin: not })
  ]);
}

// ---------- STOK KONTROL ----------
//
// Tek ekran, dört süzgeç. Teorik (Vega'daki) miktarın karşısında en son
// fiziki sayım ve fark duruyor; hepsi Excel ve PDF olarak dışarı aktarılabiliyor.

// Stok kartındaki sınıflandırma alanları. Eşleştirme firmanın Vega'dan aldığı
// "stokdeğer" raporuyla kart kart doğrulandı (486/486 satır birebir tuttu):
//
//   Tür = KOD1        Sınıf = KOD2       3-ÖK = KOD3     4-ÖK = KOD4
//   5-ÖK = KOD5       Sezon/Yıl = KOD6   Marka = KOD7    Renk = KOD9
//
// KOD8 ve KOD10 o raporda hiç yok ama firma ikisini de kullanıyor: KOD8 kartı
// "PASİF" diye işaretliyor, KOD10 sayım/üretim listesine girenleri.
const KOD_ETIKETLERI = [
  { alan: 'kod1', ad: 'Tür' },
  { alan: 'kod2', ad: 'Sınıf' },
  { alan: 'kod3', ad: '3-ÖK' },
  { alan: 'kod4', ad: '4-ÖK' },
  { alan: 'kod5', ad: '5-ÖK' },
  { alan: 'kod6', ad: 'Sezon/Yıl' },
  { alan: 'kod7', ad: 'Marka' },
  { alan: 'kod8', ad: '8. Kod' },
  { alan: 'kod9', ad: 'Renk' },
  { alan: 'kod10', ad: '10. Kod' }
];

const KOD_NUMARALARI = KOD_ETIKETLERI.map((k) => Number(k.alan.slice(3)));

const STOK_SUZGECLERI = [
  { anahtar: 'sorunlu', ad: 'Dikkat isteyenler', not: 'Eksi, biten ve azalan' },
  { anahtar: 'eksi', ad: 'Eksi stok', not: 'Miktarı sıfırın altında' },
  { anahtar: 'sifir', ad: 'Kalan 0', not: 'Miktarı tam sıfır' },
  { anahtar: 'aralik', ad: 'Kalan 1–5', not: 'Bir ile beş arası', alt: 1, ust: 5 },
  { anahtar: 'aralik', ad: 'Kalan 6–20', not: 'Altı ile yirmi arası', alt: 6, ust: 20 },
  { anahtar: 'azalan', ad: 'Azalanlar', not: 'Kritik seviyenin altı' },
  { anahtar: 'tumu', ad: 'Tüm ürünler', not: 'Hareket görmüş bütün kartlar' },
  { anahtar: 'tumu', ad: 'Bütün stok listesi', not: 'Hareketsiz kartlar ve gider kartları dahil, komple liste', tumKartlar: true, giderDahil: true }
];

function suzgecAnahtari(s) {
  return [s.anahtar, s.alt != null ? s.alt : '', s.ust != null ? s.ust : '', s.tumKartlar ? 'k' : '']
    .join('|');
}

const STOK_DURUM_ETIKETI = {
  eksi: { sinif: 'kirmizi', metin: 'Eksi stok' },
  sifir: { sinif: 'kirmizi', metin: 'Bitti' },
  azalan: { sinif: 'turuncu', metin: 'Azaldı' },
  normal: { sinif: 'yesil', metin: 'Normal' }
};

ekranlar.stok = async function (parametre) {
  const secili =
    STOK_SUZGECLERI.find((s) => suzgecAnahtari(s) === parametre.anahtar) ||
    STOK_SUZGECLERI.find((s) => s.anahtar === parametre.suzgec) ||
    STOK_SUZGECLERI[0];

  // Kullanıcının kendi yazdığı aralık, hazır şeritlerin yerine geçer.
  const elleAlt = parametre.alt;
  const elleUst = parametre.ust;
  const elleAralik = elleAlt !== undefined || elleUst !== undefined;

  // Firmanın kendi sınıflandırma kodları süzgeç olarak kullanılıyor.
  // Alan karşılıkları KOD_ETIKETLERI'nde. Bir alanda birden çok değer
  // seçilebiliyor (virgülle saklanıyor) ve "…Haric" bayrağı seçimi tersine
  // çeviriyor: işaretliyken seçilenler DIŞINDAKİLER gelir.
  const kodSecimi = {};   // { kod2: ['BAR', 'MUTFAK'] }
  const kodIstegi = {};   // { kod2: 'BAR,MUTFAK', kod2Haric: 1 }
  for (const n of KOD_NUMARALARI) {
    const ham = parametre['kod' + n];
    if (!ham) continue;
    const degerler = String(ham).split(',').map((d) => d.trim()).filter(Boolean);
    if (!degerler.length) continue;
    kodSecimi['kod' + n] = degerler;
    kodIstegi['kod' + n] = degerler.join(',');
    if (parametre['kod' + n + 'Haric']) kodIstegi['kod' + n + 'Haric'] = 1;
  }

  const istek = Object.assign(
    elleAralik
      ? { suzgec: 'aralik', alt: elleAlt, ust: elleUst, tumKartlar: parametre.tumKartlar ? 1 : 0 }
      : {
          suzgec: secili.anahtar,
          alt: secili.alt,
          ust: secili.ust,
          tumKartlar: secili.tumKartlar ? 1 : 0,
          giderDahil: secili.giderDahil ? 1 : 0
        },
    { pasifDahil: parametre.pasifDahil ? 1 : 0 },
    kodIstegi
  );

  const [tumSatirlar, kodListeleri] = await Promise.all([
    cagir('stok:kontrol', istek),
    cagir('stok:kodListeleri').catch(() => ({}))
  ]);

  // Ad/kod araması ekranda yapılıyor; sunucuya tekrar gitmeye gerek yok.
  const arananMetin = (parametre.arama || '').trim().toLocaleLowerCase('tr');
  const satirlar = arananMetin
    ? tumSatirlar.filter(
        (s) =>
          (s.ad || '').toLocaleLowerCase('tr').includes(arananMetin) ||
          (s.kod || '').toLocaleLowerCase('tr').includes(arananMetin)
      )
    : tumSatirlar;

  const baslikMetni = elleAralik
    ? `Kalan ${elleAlt != null && elleAlt !== '' ? elleAlt : '…'} – ${elleUst != null && elleUst !== '' ? elleUst : '…'}`
    : secili.ad;

  const sayilanAdet = satirlar.filter((s) => s.sayilan != null).length;
  const toplamDeger = satirlar.reduce((t, s) => t + Number(s.deger || 0), 0);

  function raporUret() {
    return {
      baslik: 'Stok kontrol — ' + baslikMetni,
      sayfaAdi: 'Stok kontrol',
      sutunlar: [
        { ad: 'Durum', alan: 'durumAdi', tur: 'metin', genislik: 14 },
        { ad: 'Ürün', alan: 'ad', tur: 'metin', genislik: 42 },
        { ad: 'Stok kodu', alan: 'kod', tur: 'metin', genislik: 16 },
        { ad: 'Tür', alan: 'tur', tur: 'metin', genislik: 14 },
        { ad: 'Sınıf', alan: 'sinif', tur: 'metin', genislik: 12 },
        { ad: '3-ÖK', alan: 'ok3', tur: 'metin', genislik: 10 },
        { ad: '4-ÖK', alan: 'ok4', tur: 'metin', genislik: 10 },
        { ad: '5-ÖK', alan: 'ok5', tur: 'metin', genislik: 10 },
        { ad: 'Marka', alan: 'marka', tur: 'metin', genislik: 10 },
        { ad: 'Renk', alan: 'renk', tur: 'metin', genislik: 10 },
        { ad: 'Sezon/Yıl', alan: 'sezon', tur: 'metin', genislik: 12 },
        { ad: '8. Kod', alan: 'ok8', tur: 'metin', genislik: 10 },
        { ad: '10. Kod', alan: 'ok10', tur: 'metin', genislik: 14 },
        { ad: 'Birim', alan: 'birim', tur: 'metin', genislik: 10 },
        { ad: 'Envanter', alan: 'teorik', tur: 'sayi', genislik: 15 },
        { ad: 'Fiziki sayım', alan: 'sayilan', tur: 'sayi', genislik: 15 },
        { ad: 'Fark', alan: 'fark', tur: 'sayi', genislik: 12 },
        { ad: 'Fark tutarı', alan: 'farkTutari', tur: 'para', genislik: 16 },
        { ad: 'Kritik seviye', alan: 'kritikSeviye', tur: 'sayi', genislik: 14 },
        { ad: 'Alış fiyatı', alan: 'alisFiyati', tur: 'para', genislik: 15 },
        { ad: 'Maliyet fiyatı', alan: 'birimMaliyet', tur: 'para', genislik: 16 },
        { ad: 'Maliyet tutarı', alan: 'deger', tur: 'para', genislik: 16 }
      ],
      satirlar: satirlar.map((s) =>
        Object.assign({}, s, {
          durumAdi: (STOK_DURUM_ETIKETI[s.durum] || {}).metin || s.durum
        })
      )
    };
  }

  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Stok kontrol', disaAktarDugmeleri(raporUret).concat([
    el('button', {
      sinif: 'dugme-sade',
      metin: 'Sayım listesi oluştur',
      tikla: () => sayimListesiOlustur(satirlar, baslikMetni)
    })
  ])));

  // Süzgeç şeridi
  const seritler = el('div', { sinif: 'suzgec-serit' });
  const seciliAnahtar = elleAralik ? '' : suzgecAnahtari(secili);
  for (const s of STOK_SUZGECLERI) {
    const anahtar = suzgecAnahtari(s);
    seritler.appendChild(el('button', {
      sinif: 'suzgec' + (anahtar === seciliAnahtar ? ' etkin' : ''),
      title: s.not,
      tikla: () => ekranAc('stok', { anahtar, arama: parametre.arama })
    }, [
      el('span', { sinif: 'suzgec-ad', metin: s.ad })
    ]));
  }
  icerik.appendChild(seritler);

  // Serbest aralık ve arama
  const altKutu = el('input', { type: 'number', sinif: 'miktar', placeholder: 'en az', value: elleAlt != null ? String(elleAlt) : '' });
  const ustKutu = el('input', { type: 'number', sinif: 'miktar', placeholder: 'en çok', value: elleUst != null ? String(elleUst) : '' });
  const aramaKutu = el('input', { type: 'text', placeholder: 'Ürün adı veya kodu…', value: parametre.arama || '' });

  function aralikUygula() {
    ekranAc('stok', {
      alt: altKutu.value === '' ? undefined : Number(altKutu.value),
      ust: ustKutu.value === '' ? undefined : Number(ustKutu.value),
      tumKartlar: secili.tumKartlar,
      arama: aramaKutu.value
    });
  }
  altKutu.addEventListener('keydown', (e) => { if (e.key === 'Enter') aralikUygula(); });
  ustKutu.addEventListener('keydown', (e) => { if (e.key === 'Enter') aralikUygula(); });

  let aramaZaman = null;
  aramaKutu.addEventListener('input', () => {
    clearTimeout(aramaZaman);
    aramaZaman = setTimeout(() => {
      ekranAc('stok', Object.assign({}, parametre, { arama: aramaKutu.value }));
    }, 350);
  });

  icerik.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', null, [el('label', { metin: 'Kalan en az' }), altKutu]),
    el('div', null, [el('label', { metin: 'Kalan en çok' }), ustKutu]),
    el('button', { sinif: 'dugme-sade', metin: 'Aralığı uygula', tikla: aralikUygula }),
    el('div', { style: 'flex:1' }, [el('label', { metin: 'Ara' }), aramaKutu])
  ]));

  // Sınıflandırma süzgeçleri: Vega stok kartındaki kod alanlarının aynısı.
  // Firma hangi kodu kullanıyorsa o kutu çıkıyor; boş olan gösterilmiyor.
  //
  // Listedeki değerler firmanın kendi tanım tablosundan (TBLSTOKKODTAN)
  // geliyor. Kartlara tanım tablosundan geçmeden yazılmış kodlar da var —
  // bunların büyük kısmı Şefim'den sızmış adisyon notu ("ULAŞ BEY", "S-15")
  // olduğu için ayrı bir grupta, en altta duruyor.
  // Her alan ÇOKLU seçim ve "hariç tut" kipini destekliyor. Müşterinin
  // istediği "bar-mutfak dışındakileri getirme" işi bu ikisiyle çıkıyor:
  // Sınıf alanında BAR ve MUTFAK'ı işaretleyip "hariç" kutusunu BOŞ
  // bırakınca yalnızca onlar gelir. Kutu işaretlenirse tam tersi olur.
  //
  // Kutucuk listesi <details> içinde duruyor; on alanın hepsi birden açık
  // olsaydı ekran süzgeçten görünmezdi.
  const kodKutulari = [];
  for (const bilgi of KOD_ETIKETLERI) {
    const secenekler = (kodListeleri && kodListeleri[bilgi.alan]) || [];
    if (!secenekler.length) continue;

    const secili = new Set(kodSecimi[bilgi.alan] || []);
    const haric = !!parametre[bilgi.alan + 'Haric'];

    function uygula(yeniSecili, yeniHaric) {
      const yeniParametre = Object.assign({}, parametre);
      const liste = Array.from(yeniSecili);
      yeniParametre[bilgi.alan] = liste.length ? liste.join(',') : undefined;
      yeniParametre[bilgi.alan + 'Haric'] = liste.length && yeniHaric ? 1 : undefined;
      ekranAc('stok', yeniParametre);
    }

    const kutucukYap = (o) => {
      const kutu = el('input', { type: 'checkbox' });
      kutu.checked = secili.has(o.deger);
      kutu.addEventListener('change', () => {
        const yeni = new Set(secili);
        if (kutu.checked) yeni.add(o.deger);
        else yeni.delete(o.deger);
        uygula(yeni, haric);
      });
      return el('label', { sinif: 'kod-secim' }, [kutu, ` ${o.deger} (${sayiYaz(o.adet)})`]);
    };

    const haricKutu = el('input', { type: 'checkbox' });
    haricKutu.checked = haric;
    haricKutu.disabled = !secili.size;
    haricKutu.addEventListener('change', () => uygula(secili, haricKutu.checked));

    const govde = el('div', { sinif: 'kod-govde' }, [
      el('div', { sinif: 'kod-satir' }, [
        el('label', { sinif: 'kod-secim' }, [
          haricKutu,
          ' Seçilenleri HARİÇ tut (işaretsizken: yalnızca seçilenler gelir)'
        ])
      ]),
      el('div', { sinif: 'kod-satir' },
        secenekler.filter((o) => o.tanimli).map(kutucukYap))
    ]);
    const serbest = secenekler.filter((o) => !o.tanimli);
    if (serbest.length) {
      govde.appendChild(el('div', { sinif: 'alt-not', metin: 'Kartlarda geçen diğer' }));
      govde.appendChild(el('div', { sinif: 'kod-satir' }, serbest.map(kutucukYap)));
    }

    const ozet = secili.size
      ? `${bilgi.ad}: ${haric ? 'hariç ' : ''}${Array.from(secili).join(', ')}`
      : `${bilgi.ad} — hepsi`;
    const kap = el('details', { sinif: 'kod-suzgec' }, [
      el('summary', { metin: ozet }),
      govde
    ]);
    if (secili.size) kap.open = true;
    kodKutulari.push(kap);
  }

  // Pasif kartlar (KOD8 = PASİF) varsayılan olarak listede yok.
  const pasifKutu = el('input', { type: 'checkbox' });
  pasifKutu.checked = !!parametre.pasifDahil;
  pasifKutu.addEventListener('change', () => {
    ekranAc('stok', Object.assign({}, parametre, {
      pasifDahil: pasifKutu.checked ? 1 : undefined
    }));
  });

  if (kodKutulari.length) {
    const seciliAlan = KOD_ETIKETLERI.filter((b) => parametre[b.alan]);
    icerik.appendChild(el('div', { sinif: 'form-satir' }, kodKutulari));
    icerik.appendChild(el('div', { sinif: 'form-satir' }, [
      el('label', { sinif: 'kod-secim' }, [pasifKutu, ' Pasife alınmış kartları da göster']),
      el('button', {
        sinif: 'dugme-sade',
        metin: 'Sınıf süzgeçlerini temizle',
        disabled: !seciliAlan.length,
        tikla: () => {
          const temiz = Object.assign({}, parametre);
          for (const b of KOD_ETIKETLERI) {
            delete temiz[b.alan];
            delete temiz[b.alan + 'Haric'];
          }
          ekranAc('stok', temiz);
        }
      })
    ]));
  }

  icerik.appendChild(el('div', { sinif: 'ozet-serit' }, [
    ozetKarti('Listedeki ürün', sayiYaz(satirlar.length)),
    ozetKarti('Fiziki sayımı olan', sayiYaz(sayilanAdet)),
    ozetKarti('Toplam stok değeri', paraYaz(toplamDeger) + ' TL')
  ]));

  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    (elleAralik ? 'Kalan miktarı verilen aralıkta olan ürünler' : secili.not) +
    '. "Fiziki sayım" sütunu panelden yapılan en son ara sayımdan gelir; ' +
    'hiç sayılmamış ürünlerde boş kalır.'
  ]));

  icerik.appendChild(tabloYap(
    ['Durum', 'Ürün', 'Tür / Sınıf', 'Birim', 'Envanter', 'Fiziki sayım', 'Fark', 'Maliyet tutarı', ''],
    satirlar,
    (s) => {
      const e = STOK_DURUM_ETIKETI[s.durum] || STOK_DURUM_ETIKETI.normal;
      return el('tr', null, [
        el('td', null, [el('span', { sinif: 'etiket ' + e.sinif, metin: e.metin })]),
        el('td', null, [
          el('div', { sinif: 'ad-satir', metin: s.ad }),
          s.pasif ? el('span', { sinif: 'etiket gri', metin: 'Pasif' }) : null,
          s.sayimTarihi
            ? el('div', { sinif: 'alt-not', metin: 'Sayım: ' + tarihYaz(s.sayimTarihi) + (s.sayan ? ' · ' + s.sayan : '') })
            : null
        ]),
        el('td', null, [
          el('div', { metin: s.tur || '—' }),
          el('div', {
            sinif: 'alt-not',
            metin: [s.sinif, s.ok4].filter(Boolean).join(' · ')
          })
        ]),
        hucre(s.birim || '—'),
        hucre(sayiYaz(s.teorik, 2), 'sayi ' + (s.teorik < 0 ? 'eksi' : '')),
        hucre(s.sayilan == null ? '—' : sayiYaz(s.sayilan, 2), 'sayi'),
        hucre(
          s.fark == null ? '—' : sayiYaz(s.fark, 2),
          'sayi ' + (s.fark < 0 ? 'eksi' : s.fark > 0 ? 'arti' : '')
        ),
        hucre(paraYaz(s.deger), 'sayi'),
        el('td', null, [
          el('button', {
            sinif: 'dugme-kucuk',
            metin: 'Hareketler',
            tikla: () => stokHareketiGoster(s)
          }),
          // Pasife alma yalnızca yöneticide; kart Vega'da da pasif görünür.
          yonetici()
            ? el('button', {
                sinif: 'dugme-kucuk',
                style: 'margin-left:6px',
                metin: s.pasif ? 'Pasiften çıkar' : 'Pasife al',
                disabled: !durum.yazmaAcik,
                title: durum.yazmaAcik
                  ? ''
                  : "Vega'ya yazma kapalı olduğu için değiştirilemez",
                tikla: () => stokPasifDegistir(s, parametre)
              })
            : null
        ])
      ]);
    },
    // Komple stok listesi istendiğinde ekran sınırı yükseliyor; kullanıcı
    // listenin tamamını görebilsin.
    2000
  ));
};

// Ekrandaki süzgeçten çıkan liste doğrudan sayım listesine aktarılır.
async function sayimListesiOlustur(satirlar, kaynakAdi) {
  if (!satirlar.length) {
    bildir('Listede ürün yok.', 'kotu');
    return;
  }
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: 'Sayım listesi oluştur',
    mesaj: `Ekrandaki ${satirlar.length} ürün sayım listesine eklenecek.`,
    detay:
      `Kaynak: ${kaynakAdi}. Listede zaten olan ürünler tekrarlanmaz. ` +
      'Ara sayım ekranında bu ürünlerin sayılan miktarını gireceksiniz.',
    evet: 'Ekle',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    const sonuc = await cagir('sayim:topluEkle', {
      urunler: satirlar.map((s) => ({ stokNo: s.stokNo, stokAdi: s.ad })),
      kaynak: kaynakAdi
    });
    bildir(`${sayiYaz(sonuc.eklenen)} ürün sayım listesine eklendi.`, 'iyi');
  } catch (e) { hataGoster(e); }
}

// Stok kartını pasife alır / pasiften çıkarır.
//
// İşaret Vega'nın kendi alanına (KOD8 = PASİF) yazılıyor; firma zaten 373
// kartı böyle işaretlemiş. Pasif kartlar stok listelerinde ve sayım
// föylerinde görünmez, ama hareketleri ve geçmişi olduğu gibi durur.
async function stokPasifDegistir(stok, parametre) {
  const pasifYap = !stok.pasif;
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: pasifYap ? 'Ürünü pasife al' : 'Ürünü pasiften çıkar',
    mesaj: `"${stok.ad}" ${pasifYap ? 'pasife alınacak' : 'yeniden aktif olacak'}.`,
    detay: pasifYap
      ? "Stok kartının PASİF alanı işaretlenir. Ürün stok listelerinde ve sayım " +
        'föylerinde görünmez olur; hareketleri ve geçmişi silinmez. Vega da ' +
        'kartı pasif görür. İstediğiniz zaman geri alabilirsiniz.'
      : 'Ürün yeniden listelerde ve sayım föylerinde görünür.',
    evet: pasifYap ? 'Pasife al' : 'Aktif et',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    await cagir('stok:pasifYap', { stokNolar: [stok.stokNo], pasif: pasifYap });
    bildir(pasifYap ? 'Ürün pasife alındı.' : 'Ürün aktif edildi.', 'iyi');
    ekranAc('stok', parametre);
  } catch (e) { hataGoster(e); }
}

function ozetKarti(baslik, deger) {
  return el('div', { sinif: 'ozet-kart' }, [
    el('span', { sinif: 'ozet-baslik', metin: baslik }),
    el('span', { sinif: 'ozet-deger', metin: deger })
  ]);
}

// ---------- GİDER / HİZMET STOKLARI ----------

ekranlar.gider = async function () {
  const liste = await cagir('gider:liste', { sadeceDolu: true });

  function raporUret() {
    return {
      baslik: 'Gider ve hizmet kartlarında kalan stok',
      sayfaAdi: 'Gider stok',
      sutunlar: [
        { ad: 'Kart', alan: 'ad', tur: 'metin', genislik: 44 },
        { ad: 'Stok kodu', alan: 'kod', tur: 'metin', genislik: 16 },
        { ad: 'Birim', alan: 'birim', tur: 'metin', genislik: 10 },
        { ad: 'Kalan miktar', alan: 'kalan', tur: 'sayi', genislik: 15 },
        { ad: 'Birim maliyet', alan: 'birimMaliyet', tur: 'para', genislik: 16 },
        { ad: 'Değer', alan: 'deger', tur: 'para', genislik: 16 }
      ],
      satirlar: liste
    };
  }

  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Gider / hizmet stokları', disaAktarDugmeleri(raporUret)));

  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Elektrik, su, nakliye, reklam gibi gider ve hizmet kartları (Vega stok tipi 3). ' +
    'Bu kartlarda stok miktarı olmaması gerekir; faturalardan birikmiş miktar burada görünür.'
  ]));

  if (!durum.yazmaAcik) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      "Vega'ya yazma kapalı olduğu için sıfırlama düğmeleri çalışmaz. " +
      'Ayarlar ekranından açabilirsiniz; açmadan önce VEGADB yedeğini alın.'
    ]));
  } else {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu kritik' }, [
      'Sıfırlama, depo envanterine kalanı kapatan bir denge satırı ekler. ' +
      'Stok hareketleri, maliyet ve cari etkilenmez. İşlem geri alınabilir ve ' +
      'kim yaptığı kayıt altına alınır. Bu yöntem henüz gerçek Vega kurulumunda ' +
      'doğrulanmadı — önce tek bir kartta deneyin.'
    ]));
  }

  if (!durum.depo) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      'Sıfırlama için üst çubuktan tek bir depo seçmelisiniz. "Tüm depolar" seçiliyken yapılamaz.'
    ]));
  }

  icerik.appendChild(tabloYap(
    ['Kart', 'Birim', 'Kalan miktar', 'Birim maliyet', 'Değer', ''],
    liste,
    (g) => el('tr', null, [
      el('td', null, [
        el('div', { sinif: 'ad-satir', metin: g.ad }),
        g.kod ? el('div', { sinif: 'alt-not', metin: g.kod }) : null
      ]),
      hucre(g.birim || '—'),
      hucre(sayiYaz(g.kalan, 2), 'sayi ' + (g.kalan < 0 ? 'eksi' : 'arti')),
      hucre(paraYaz(g.birimMaliyet), 'sayi'),
      hucre(paraYaz(g.deger), 'sayi'),
      el('td', null, [el('button', {
        sinif: 'dugme-kucuk' + (durum.yazmaAcik && durum.depo ? ' tehlike' : ''),
        metin: 'Sıfırla',
        disabled: !durum.yazmaAcik || !durum.depo,
        tikla: () => giderStokSifirla(g)
      })])
    ])
  ));
};

async function giderStokSifirla(kart) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: 'Gider stoğunu sıfırla',
    mesaj: `"${kart.ad}" kartının kalan ${sayiYaz(kart.kalan, 2)} ${kart.birim || ''} miktarı sıfırlanacak.`,
    detay:
      'Depo envanterine kalanı kapatan bir satır eklenir. Stok hareketleri, ' +
      'maliyet ve cari değişmez. İşlem kayıt altına alınır ve geri alınabilir.',
    evet: 'Sıfırla',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    const sonuc = await cagir('gider:sifirla', { stokNo: kart.stokNo });
    bildir(
      sonuc.degisiklik
        ? `"${kart.ad}" sıfırlandı (önceki kalan ${sayiYaz(sonuc.oncekiKalan, 2)}).`
        : 'Kart zaten sıfırdı, değişiklik yapılmadı.',
      'iyi'
    );
    ekranAc('gider');
  } catch (e) { hataGoster(e); }
}

async function stokHareketiGoster(stok) {
  try {
    const satirlar = await cagir('stok:hareket', { stokNo: stok.stokNo, gun: 60 });
    katmanAc(stok.ad + ' — son 60 gün', tabloYap(
      ['Tarih', 'İşlem', 'Giren', 'Çıkan', 'Cari', 'Belge'],
      satirlar,
      (h) => el('tr', null, [
        hucre(tarihYaz(h.tarih)),
        hucre(izahatAdi(h.izahat)),
        hucre(h.giren ? sayiYaz(h.giren, 2) : '', 'sayi arti'),
        hucre(h.cikan ? sayiYaz(h.cikan, 2) : '', 'sayi eksi'),
        hucre(h.cari || '—'),
        hucre(h.belgeNo || '—')
      ])
    ));
  } catch (e) { hataGoster(e); }
}

const IZAHAT = {
  20: 'Alış faturası', 22: 'Alış iadesi', 32: 'Stok girişi', 33: 'Stok çıkışı',
  90: 'Devir', 93: 'Sayım girişi', 94: 'Sayım çıkışı',
  96: 'Üretim çıktısı', 97: 'Üretim tüketimi'
};
function izahatAdi(kod) { return IZAHAT[kod] || ('Kod ' + kod); }

// ---------- SATIŞ AKTARIMI / EŞLEŞTİRME ----------

ekranlar.aktarim = async function () {
  const [d, liste] = await Promise.all([
    cagir('satis:aktarimDurumu'),
    cagir('satis:eslestirmeDurumu', { gun: 45 })
  ]);
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Satış aktarımı'));

  const eslesmeyen = liste.filter((s) => s.durum === 'eslesmedi');
  icerik.appendChild(el('div', {
    sinif: 'aciklama-kutu ' + (eslesmeyen.length ? 'kritik' : '')
  }, [
    `Şefim'de ${sayiYaz(d.aktarilmayan)} satış satırı Vega'ya işlenmemiş. ` +
    `Son 45 günde satılan ${liste.length} üründen ${eslesmeyen.length} tanesinin Vega karşılığı seçilmemiş. ` +
    'Aşağıdan her ürün için karşılığını bir kez seçin; seçim kalıcı olarak saklanır.'
  ]));

  icerik.appendChild(tabloYap(
    ['Durum', 'Şefim ürünü', 'Satış', 'Vega karşılığı', ''],
    liste,
    (s) => {
      const etiket = s.durum === 'eslesmedi'
        ? el('span', { sinif: 'etiket kirmizi', metin: 'Eşleşmedi' })
        : s.durum === 'yoksayildi'
          ? el('span', { sinif: 'etiket gri', metin: 'Yoksayıldı' })
          : s.durum === 'elle'
            ? el('span', { sinif: 'etiket yesil', metin: 'Eşleştirildi' })
            : el('span', { sinif: 'etiket mavi', metin: 'Otomatik' });
      return el('tr', null, [
        el('td', null, [etiket]),
        hucre(s.urun),
        hucre(sayiYaz(s.miktar, 2), 'sayi'),
        hucre(s.stokAdi || '—'),
        el('td', null, [el('button', {
          sinif: 'dugme-kucuk',
          metin: s.durum === 'eslesmedi' ? 'Eşleştir' : 'Değiştir',
          tikla: () => eslestirmePenceresi(s)
        })])
      ]);
    }
  ));
};

async function eslestirmePenceresi(satir) {
  try {
    const oneriler = await cagir('satis:oneri', { urun: satir.urun });
    const kap = el('div');
    kap.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
      `"${satir.urun}" satıldığında hangi Vega stok kartından düşülecek?`
    ]));

    const aramaKutusu = el('input', { type: 'text', placeholder: 'Ürün adıyla ara…' });
    const sonucKap = el('div');

    function listeCiz(kayitlar) {
      bosalt(sonucKap);
      if (!kayitlar.length) {
        sonucKap.appendChild(el('div', { sinif: 'bos-mesaj', metin: 'Eşleşen stok kartı bulunamadı.' }));
        return;
      }
      sonucKap.appendChild(tabloYap(
        ['Vega stok kartı', 'Kalan', ''],
        kayitlar,
        (k) => el('tr', null, [
          hucre(k.ad),
          hucre(k.kalan != null ? sayiYaz(k.kalan, 2) : '—', 'sayi'),
          el('td', null, [el('button', {
            sinif: 'dugme-kucuk',
            metin: 'Bunu seç',
            tikla: () => eslestirmeKaydet(satir, k)
          })])
        ])
      ));
    }
    listeCiz(oneriler);

    let zaman = null;
    aramaKutusu.addEventListener('input', () => {
      clearTimeout(zaman);
      zaman = setTimeout(async () => {
        const terim = aramaKutusu.value.trim();
        if (terim.length < 2) return listeCiz(oneriler);
        try {
          listeCiz(await cagir('stok:ara', { terim }));
        } catch (e) { hataGoster(e); }
      }, 300);
    });

    kap.appendChild(el('div', { sinif: 'form-satir' }, [aramaKutusu]));
    kap.appendChild(sonucKap);
    kap.appendChild(el('div', { sinif: 'form-satir', style: 'margin-top:16px' }, [
      el('button', {
        sinif: 'dugme-sade',
        metin: 'Bu ürünü yoksay (stoktan düşülmesin)',
        tikla: () => eslestirmeKaydet(satir, null, true)
      })
    ]));
    katmanAc('Ürün eşleştir', kap);
  } catch (e) { hataGoster(e); }
}

async function eslestirmeKaydet(satir, stok, yoksay) {
  try {
    await cagir('satis:eslestirmeKaydet', {
      urun: satir.urun,
      stokNo: stok ? stok.stokNo : null,
      stokAdi: stok ? stok.ad : null,
      yoksay: !!yoksay
    });
    katmanKapat();
    bildir(yoksay ? 'Ürün yoksayıldı.' : 'Eşleştirme kaydedildi.', 'iyi');
    ekranAc('aktarim');
  } catch (e) { hataGoster(e); }
}

// Not: "Bugünkü satış" ekranı kaldırıldı. Şefim satışları Vega'ya
// aktarılmadığı sürece o ekran gerçek durumu göstermiyordu; aktarım
// durumu "Satış aktarımı" ekranında zaten duruyor.

// ---------- SAYIM ----------
//
// İki tür: ara sayım (sayım listesindeki ürünler) ve tam sayım (kapsamdaki
// bütün kartlar). İkisinde de miktar yazılmayan satır sayıma girmez.
//
// Sayım kaydedilince Vega'ya YAZILMAZ; yönetici onayına düşer. Onay ekranı
// ayrı (ekranlar.sayimOnay).

ekranlar.sayim = async function (parametre) {
  const yetkili = yonetici();
  const tur = parametre && parametre.tur === 'tam' ? 'tam' : 'ara';
  const tamYetkisi = yetkiVar('tamSayim');

  const [liste, gecmis] = await Promise.all([
    cagir('sayim:ekran', { tur }),
    yetkili ? cagir('sayim:gecmis') : Promise.resolve([])
  ]);
  bosalt(icerik);
  // Not: burada eskiden "const durum" tanımlıydı ve genel durum nesnesini
  // gölgeliyordu; yazma açıkken bile ekran kapalı gibi davranıyordu.
  const yazmaDurum = await cagir('yazma:durum').catch(() => ({ acik: durum.yazmaAcik }));
  durum.yazmaAcik = !!yazmaDurum.acik;

  icerik.appendChild(ekranBasligi('Sayım', [
    tur === 'ara'
      ? el('button', {
          sinif: 'dugme-sade',
          metin: 'Sayılacak ürünleri düzenle',
          tikla: sayimListesiDuzenle
        })
      : null
  ].filter(Boolean)));

  // Tür şeridi. Tam sayım ayrı bir yetki; yoksa düğme çizilmiyor.
  const turSerit = el('div', { sinif: 'suzgec-serit' }, [
    el('button', {
      sinif: 'suzgec' + (tur === 'ara' ? ' etkin' : ''),
      title: 'Yalnızca sayım listesine konmuş ürünler',
      tikla: () => ekranAc('sayim', { tur: 'ara' })
    }, [el('span', { sinif: 'suzgec-ad', metin: 'Ara sayım' })]),
    tamYetkisi
      ? el('button', {
          sinif: 'suzgec' + (tur === 'tam' ? ' etkin' : ''),
          title: 'Kapsamınızdaki bütün stok kartları',
          tikla: () => ekranAc('sayim', { tur: 'tam' })
        }, [el('span', { sinif: 'suzgec-ad', metin: 'Tam sayım' })])
      : null
  ].filter(Boolean));
  icerik.appendChild(turSerit);

  // Kapsam bilgisi: kullanıcıya hangi sınıfı sayabildiğini söylüyoruz,
  // yoksa listede beklediği ürünü bulamayınca program bozuk sanılır.
  const siniflar = (durum.yetkiler && durum.yetkiler.siniflar) || [];
  if (!yetkili && siniflar.length) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
      `Sayım kapsamınız: ${siniflar.join(', ')}. Listede yalnızca bu sınıftaki ` +
      'ürünler var; başka sınıftan ürün sayamazsınız.'
    ]));
  }

  if (!liste.length) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      tur === 'tam'
        ? 'Kapsamınızda sayılacak stok kartı bulunamadı.'
        : 'Sayım listesi boş. Önce "Sayılacak ürünleri düzenle" düğmesinden ürün ekleyin ' +
          '(örneğin Kızartmalık Yağ ve Çay).'
    ]));
  } else {
    const girdiler = {};
    const satirDugumleri = [];
    const gövde = el('tbody', null, liste.map((s) => {
      const kutu = el('input', { type: 'number', sinif: 'miktar', step: '0.01', min: '0' });
      girdiler[s.stokNo] = kutu;
      const satir = el('tr', null, [
        el('td', null, [
          el('div', { sinif: 'ad-satir', metin: s.stokAdi }),
          s.stokKodu ? el('div', { sinif: 'alt-not', metin: s.stokKodu }) : null
        ]),
        hucre(s.sinif || '—'),
        hucre(s.birim || '—'),
        // Teorik miktar yalnızca yönetici girişinden sonra geliyor.
        yetkili ? hucre(sayiYaz(s.teorik, 2), 'sayi') : null,
        el('td', null, [kutu])
      ]);
      satirDugumleri.push({ satir, ad: (s.stokAdi || '').toLocaleLowerCase('tr'),
                            kod: (s.stokKodu || '').toLocaleLowerCase('tr') });
      return satir;
    }));

    // Körleme sayım: yönetici girişi yapılmadıkça Vega'daki miktar ekranda
    // yok. Görünseydi sayan kişi çoğu zaman aynı sayıyı yazar, sayım
    // anlamını kaybederdi.
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
      (tur === 'tam'
        ? `Tam sayım: kapsamdaki ${sayiYaz(liste.length)} kartın hepsi listede. `
        : 'Ara sayım: yalnızca sayım listesindeki ürünler. ') +
      'Her ürünü sayın ve bulduğunuz miktarı yazın, sonra tek düğmeye basın. ' +
      (yetkili
        ? "Vega'daki miktar yanında yazıyor. "
        : "Vega'daki miktar gösterilmiyor; ne saydıysanız onu yazın. ") +
      'Miktar yazılmayan ürünler sayıma HİÇ girmez, stokları değişmez. ' +
      "Kaydettiğinizde sayım Vega'ya yazılmaz; yönetici onayına düşer."
    ]));

    // Tam sayımda liste uzun; ürün aramadan bulmak zor.
    if (liste.length > 30) {
      const araKutu = el('input', { type: 'text', placeholder: 'Listede ara: ürün adı veya kodu…' });
      araKutu.addEventListener('input', () => {
        const aranan = araKutu.value.trim().toLocaleLowerCase('tr');
        for (const d of satirDugumleri) {
          const uyar = !aranan || d.ad.includes(aranan) || d.kod.includes(aranan);
          d.satir.classList.toggle('hidden', !uyar);
        }
      });
      icerik.appendChild(el('div', { sinif: 'form-satir' }, [
        el('div', { style: 'flex:1' }, [el('label', { metin: 'Ara' }), araKutu])
      ]));
    }

    icerik.appendChild(el('div', { sinif: 'tablo-sarmal' }, [
      el('table', null, [
        el('thead', null, [el('tr', null, [
          el('th', { metin: 'Ürün' }),
          el('th', { metin: 'Sınıf' }),
          el('th', { metin: 'Birim' }),
          yetkili ? el('th', { metin: 'Vega\'da görünen' }) : null,
          el('th', { metin: 'Sayılan miktar' })
        ])]),
        gövde
      ])
    ]));

    const kaydetDugme = el('button', { sinif: 'dugme-ana', metin: 'Sayımı kaydet' });
    kaydetDugme.addEventListener('click', async () => {
      const satirlar = [];
      for (const s of liste) {
        const deger = girdiler[s.stokNo].value;
        if (deger === '') continue;
        // Teorik miktar ve maliyet arayüzde yok; kaydetme anında ana süreç
        // Vega'dan yeniden okuyor.
        satirlar.push({
          stokNo: s.stokNo,
          stokAdi: s.stokAdi,
          birim: s.birim,
          sayilan: Number(deger)
        });
      }
      if (!satirlar.length) {
        bildir('En az bir ürüne miktar yazın.', 'kotu');
        return;
      }

      // Fark önizlemesi ancak teorik miktar elimizdeyse (yönetici) yapılabilir.
      let mesaj = `${satirlar.length} ürünün sayımı kaydedilecek.`;
      if (yetkili) {
        const teorikler = new Map(liste.map((s) => [Number(s.stokNo), Number(s.teorik || 0)]));
        const farkli = satirlar.filter(
          (s) => Math.abs(s.sayilan - teorikler.get(Number(s.stokNo))) >= 0.0001
        );
        mesaj = `${satirlar.length} ürün sayıldı, ${farkli.length} üründe fark var.`;
      }

      const onay = await window.galya.cagir('sistem:onay', {
        baslik: (tur === 'tam' ? 'Tam' : 'Ara') + ' sayımı kaydet',
        mesaj,
        detay:
          'Sayım kaydedilip YÖNETİCİ ONAYINA gönderilecek. Vega\'ya ancak ' +
          'yönetici onayladıktan sonra işlenir; o zamana kadar stok değişmez. ' +
          'Miktar yazılmayan ürünler sayıma girmez.',
        evet: 'Kaydet ve onaya gönder',
        hayir: 'Vazgeç'
      });
      if (!onay.veri || !onay.veri.onay) return;
      try {
        kaydetDugme.disabled = true;
        const sonuc = await cagir('sayim:kaydet', { satirlar, tur });
        bildir(
          `Sayım kaydedildi (${satirlar.length} ürün) ve yönetici onayına gönderildi.`,
          'iyi'
        );
        // Fark dökümü yalnızca yöneticiye açılır.
        if (yetkili) sayimDetayGoster(sonuc.sayimId);
        ekranAc('sayim', { tur });
      } catch (e) {
        hataGoster(e);
        kaydetDugme.disabled = false;
      }
    });
    icerik.appendChild(el('div', { sinif: 'form-satir', style: 'margin-top:18px' }, [kaydetDugme]));
  }

  // Geçmiş sayımlar fark tutarını ve teorik miktarı içerir; yönetici girişi
  // yapılmadan gösterilmez, yoksa sayan kişi kaydedip farkı okuyarak Vega'daki
  // miktarı geri hesaplayabilir.
  if (!yetkili) {
    icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Geçmiş sayımlar' }));
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
      'Geçmiş sayımlar ve farklar için yöneticiye başvurun.'
    ]));
    return;
  }

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Geçmiş sayımlar' }));
  icerik.appendChild(tabloYap(
    ['Tarih', 'Tür', 'Sayan', 'Ürün', 'Farklı', 'Fark tutarı', 'Durum', 'Vega', ''],
    gecmis,
    (g) => {
      const dugmeler = [
        el('button', { sinif: 'dugme-kucuk', metin: 'Farkları gör', tikla: () => sayimDetayGoster(g.id) })
      ];
      if (g.durum === 'bekliyor') {
        dugmeler.push(el('button', {
          sinif: 'dugme-kucuk tehlike',
          metin: 'Onayla',
          style: 'margin-left:6px',
          tikla: () => sayimOnayla(g)
        }));
      }
      // Onaylanmış ama yazılamamışsa tekrar yazma, yazılmışsa geri alma.
      if (durum.yazmaAcik && g.durum === 'onaylandi' && !g.vegayaYazildi) {
        dugmeler.push(el('button', {
          sinif: 'dugme-kucuk',
          metin: "Vega'ya yaz",
          style: 'margin-left:6px',
          tikla: () => sayimVegayaYaz(g)
        }));
      }
      if (durum.yazmaAcik && g.vegayaYazildi) {
        dugmeler.push(el('button', {
          sinif: 'dugme-kucuk',
          metin: "Vega'dan geri al",
          style: 'margin-left:6px',
          tikla: () => sayimVegadanGeriAl(g)
        }));
      }
      dugmeler.push(el('button', {
        sinif: 'dugme-kucuk',
        metin: 'Listeden sil',
        style: 'margin-left:6px',
        tikla: () => sayimGeriAl(g.id)
      }));
      const d = SAYIM_DURUMU[g.durum] || SAYIM_DURUMU.bekliyor;
      return el('tr', null, [
        hucre(saatliTarih(g.tarih)),
        el('td', null, [
          el('div', { metin: g.tur === 'tam' ? 'Tam' : 'Ara' }),
          g.kapsam ? el('div', { sinif: 'alt-not', metin: g.kapsam }) : null
        ]),
        hucre(g.sayan || '—'),
        hucre(sayiYaz(g.satirSayisi), 'sayi'),
        hucre(sayiYaz(g.farkliSatir), 'sayi ' + (g.farkliSatir ? 'eksi' : '')),
        hucre(paraYaz(g.farkTutari), 'sayi'),
        el('td', null, [
          el('span', { sinif: 'etiket ' + d.sinif, metin: d.metin }),
          g.onaylayan
            ? el('div', { sinif: 'alt-not', metin: g.onaylayan })
            : null,
          g.redSebebi ? el('div', { sinif: 'alt-not', metin: g.redSebebi }) : null
        ]),
        hucre(g.vegayaYazildi ? (g.vegaBelgeNo || 'Yazıldı') : 'Yazılmadı'),
        el('td', null, dugmeler)
      ]);
    }
  ));
};

const SAYIM_DURUMU = {
  bekliyor: { sinif: 'turuncu', metin: 'Onay bekliyor' },
  onaylandi: { sinif: 'yesil', metin: 'Onaylandı' },
  reddedildi: { sinif: 'kirmizi', metin: 'Reddedildi' }
};

// ---------- SAYIM ONAYI (yönetici) ----------
//
// Bekleyen sayımların kuyruğu. Onaylandığı anda Vega'ya sayım fişi kesilir;
// bu, sayımın stoğu değiştirdiği tek nokta.

ekranlar.sayimOnay = async function () {
  const [bekleyen, yazmaDurum] = await Promise.all([
    cagir('sayim:bekleyenler'),
    cagir('yazma:durum').catch(() => ({ acik: durum.yazmaAcik }))
  ]);
  durum.yazmaAcik = !!yazmaDurum.acik;

  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Sayım onayı', null, true));

  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Çalışanların kaydettiği sayımlar burada bekler. "Farkları gör" ile ne ' +
    "sayıldığını inceleyin; onaylayınca program farkı hesaplayıp Vega'ya sayım " +
    'fişini keser ve stok sayılan miktara oturur. Fark, fişin kesildiği andaki ' +
    'güncel stoğa göre yeniden hesaplanır.'
  ]));

  if (!durum.yazmaAcik) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      "Vega'ya yazma kapalı. Onaylayabilirsiniz ama fiş kesilmez; yazma " +
      'açıldığında geçmiş listesinden yazabilirsiniz.'
    ]));
  }

  if (!bekleyen.length) {
    icerik.appendChild(el('div', { sinif: 'bos-mesaj', metin: 'Onay bekleyen sayım yok.' }));
    return;
  }

  icerik.appendChild(tabloYap(
    ['Tarih', 'Sayan', 'Tür / Kapsam', 'Ürün', 'Farklı', 'Fark tutarı', ''],
    bekleyen,
    (b) => el('tr', null, [
      hucre(saatliTarih(b.tarih)),
      hucre(b.sayan || '—'),
      el('td', null, [
        el('div', { metin: b.tur === 'tam' ? 'Tam sayım' : 'Ara sayım' }),
        b.kapsam ? el('div', { sinif: 'alt-not', metin: b.kapsam }) : null
      ]),
      hucre(sayiYaz(b.satirSayisi), 'sayi'),
      hucre(sayiYaz(b.farkliSatir), 'sayi ' + (b.farkliSatir ? 'eksi' : '')),
      hucre(paraYaz(b.farkTutari), 'sayi'),
      el('td', null, [
        el('button', {
          sinif: 'dugme-kucuk',
          metin: 'Farkları gör',
          tikla: () => sayimDetayGoster(b.id)
        }),
        el('button', {
          sinif: 'dugme-kucuk tehlike',
          metin: 'Onayla',
          style: 'margin-left:6px',
          tikla: () => sayimOnayla(b, 'sayimOnay')
        }),
        el('button', {
          sinif: 'dugme-kucuk',
          metin: 'Reddet',
          style: 'margin-left:6px',
          tikla: () => sayimReddet(b, 'sayimOnay')
        })
      ])
    ])
  ));
};

// Onay: sayımın Vega'ya işlendiği tek yer.
async function sayimOnayla(g, donulecekEkran) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: 'Sayımı onayla',
    mesaj:
      `${saatliTarih(g.tarih)} tarihli sayım (${g.sayan || 'bilinmiyor'}) onaylanacak.`,
    detay: durum.yazmaAcik
      ? "Onaylanınca Vega'ya sayım fişi kesilir ve stok sayılan miktara oturur. " +
        'Artı farklar için sayım giriş, eksi farklar için sayım çıkış fişi yazılır. ' +
        'Yanlışlık olursa geçmiş listesinden geri alabilirsiniz.'
      : "Vega'ya yazma kapalı; sayım yalnızca onaylı işaretlenir, fiş kesilmez.",
    evet: durum.yazmaAcik ? "Onayla ve Vega'ya yaz" : 'Onayla',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    const s = await cagir('sayim:onayla', { sayimId: g.id });
    if (s.yazmaHatasi) {
      bildir("Sayım onaylandı ama Vega'ya yazılamadı: " + s.yazmaHatasi, 'kotu');
    } else if (s.farkYok) {
      bildir('Sayım onaylandı. Fark çıkmadığı için fiş kesilmedi.', 'iyi');
    } else if (s.vegayaYazildi) {
      bildir("Sayım onaylandı ve Vega'ya yazıldı. Belge: " + s.belgeNo, 'iyi');
    } else {
      bildir('Sayım onaylandı.', 'iyi');
    }
    ekranAc(donulecekEkran || 'sayim');
  } catch (e) { hataGoster(e); }
}

async function sayimReddet(g, donulecekEkran) {
  const sebepKutu = el('input', { type: 'text', placeholder: 'Örn. Bar rafı sayılmamış' });
  const kap = el('div', null, [
    el('div', { sinif: 'aciklama-kutu' }, [
      `${saatliTarih(g.tarih)} tarihli sayım reddedilecek. Vega'ya hiçbir şey ` +
      'yazılmaz; sayan kişi yeniden sayıp kaydedebilir.'
    ]),
    el('div', { sinif: 'form-satir' }, [
      el('div', { style: 'flex:1' }, [el('label', { metin: 'Red sebebi' }), sebepKutu])
    ]),
    el('div', { sinif: 'form-satir', style: 'margin-top:14px' }, [
      el('button', {
        sinif: 'dugme-ana',
        metin: 'Reddet',
        tikla: async () => {
          try {
            await cagir('sayim:reddet', { sayimId: g.id, sebep: sebepKutu.value });
            katmanKapat();
            bildir('Sayım reddedildi.', 'iyi');
            ekranAc(donulecekEkran || 'sayim');
          } catch (e) { hataGoster(e); }
        }
      }),
      el('button', { sinif: 'dugme-sade', metin: 'Vazgeç', tikla: katmanKapat })
    ])
  ]);
  katmanAc('Sayımı reddet', kap);
  setTimeout(() => sebepKutu.focus(), 50);
}

// Panelde duran bir sayımı sonradan Vega'ya işler.
async function sayimVegayaYaz(g) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: "Sayımı Vega'ya yaz",
    mesaj: `${saatliTarih(g.tarih)} tarihli sayım Vega'ya yazılacak.`,
    detay:
      'Fark, fişin kesildiği andaki güncel stoğa göre yeniden hesaplanır; ' +
      'artı farklar için sayım giriş, eksi farklar için sayım çıkış fişi kesilir.',
    evet: 'Yaz',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    const sonuc = await cagir('sayim:vegayaYaz', { sayimId: g.id });
    if (sonuc.yazilmadi) bildir(sonuc.mesaj, 'iyi');
    else bildir('Sayım yazıldı. Belge: ' + sonuc.belgeNo, 'iyi');
    ekranAc('sayim');
  } catch (e) {
    hataGoster(e);
  }
}

// Yanlış kesilen sayım fişini Vega'dan siler; stok fiş öncesine döner.
async function sayimVegadanGeriAl(g) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: "Sayım fişini geri al",
    mesaj: (g.vegaBelgeNo || 'Sayım fişi') + " Vega'dan silinecek.",
    detay:
      'Fişin dört tablodaki bütün satırları silinir ve stok fiş kesilmeden ' +
      'önceki miktarına döner. Sayım kaydı panelde kalır.',
    evet: 'Geri al',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    const sonuc = await cagir('sayim:vegadanGeriAl', { sayimId: g.id });
    bildir('Geri alındı: ' + sonuc.geriAlinan, 'iyi');
    ekranAc('sayim');
  } catch (e) {
    hataGoster(e);
  }
}

async function sayimDetayGoster(sayimId) {
  try {
    const satirlar = await cagir('sayim:detay', { sayimId });
    const kap = el('div');
    kap.appendChild(el('div', { sinif: 'form-satir' }, disaAktarDugmeleri(() => ({
      baslik: 'Sayım farkları',
      sayfaAdi: 'Sayım',
      sutunlar: [
        { ad: 'Ürün', alan: 'stokAdi', tur: 'metin', genislik: 44 },
        { ad: 'Birim', alan: 'birim', tur: 'metin', genislik: 10 },
        { ad: 'Teorik (Vega)', alan: 'teorik', tur: 'sayi', genislik: 15 },
        { ad: 'Sayılan', alan: 'sayilan', tur: 'sayi', genislik: 14 },
        { ad: 'Fark', alan: 'fark', tur: 'sayi', genislik: 12 },
        { ad: 'Birim maliyet', alan: 'birimMaliyet', tur: 'para', genislik: 16 },
        { ad: 'Fark tutarı', alan: 'farkTutari', tur: 'para', genislik: 16 }
      ],
      satirlar
    }))));
    kap.appendChild(tabloYap(
      ['Ürün', 'Vega\'da', 'Sayılan', 'Fark', 'Fark tutarı'],
      satirlar,
      (s) => el('tr', null, [
        hucre(s.stokAdi),
        hucre(sayiYaz(s.teorik, 2), 'sayi'),
        hucre(sayiYaz(s.sayilan, 2), 'sayi'),
        hucre(sayiYaz(s.fark, 2), 'sayi ' + (s.fark < 0 ? 'eksi' : s.fark > 0 ? 'arti' : '')),
        hucre(paraYaz(s.farkTutari), 'sayi')
      ])
    ));
    katmanAc('Sayım farkları', kap);
  } catch (e) { hataGoster(e); }
}

async function sayimGeriAl(sayimId) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: 'Sayımı geri al',
    mesaj: 'Bu sayım kaydı listeden kaldırılacak.',
    detay: 'Vega verisi zaten değişmemişti, sadece panel kaydı iptal edilir.',
    evet: 'Geri al',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    await cagir('sayim:iptal', { sayimId });
    bildir('Sayım geri alındı.', 'iyi');
    ekranAc('sayim');
  } catch (e) { hataGoster(e); }
}

async function sayimListesiDuzenle() {
  try {
    const mevcut = await cagir('sayim:liste');
    const kap = el('div');
    kap.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
      'Burada seçtiğiniz ürünler her sayım ekranında karşınıza çıkar.'
    ]));

    const mevcutKap = el('div');
    function mevcutCiz(kayitlar) {
      bosalt(mevcutKap);
      mevcutKap.appendChild(tabloYap(['Ürün', ''], kayitlar, (m) => el('tr', null, [
        hucre(m.stokAdi),
        el('td', null, [el('button', {
          sinif: 'dugme-kucuk',
          metin: 'Çıkar',
          tikla: async () => {
            try {
              await cagir('sayim:listedenCikar', { stokNo: m.stokNo });
              mevcutCiz(await cagir('sayim:liste'));
              bildir('Ürün listeden çıkarıldı.', 'iyi');
            } catch (e) { hataGoster(e); }
          }
        })])
      ])));
    }
    mevcutCiz(mevcut);

    const arama = el('input', { type: 'text', placeholder: 'Eklemek için ürün ara…' });
    const sonuc = el('div');
    let zaman = null;
    arama.addEventListener('input', () => {
      clearTimeout(zaman);
      zaman = setTimeout(async () => {
        const terim = arama.value.trim();
        if (terim.length < 2) { bosalt(sonuc); return; }
        try {
          const bulunan = await cagir('stok:ara', { terim });
          bosalt(sonuc);
          sonuc.appendChild(tabloYap(['Ürün', 'Kalan', ''], bulunan, (b) => el('tr', null, [
            hucre(b.ad),
            hucre(sayiYaz(b.kalan, 2), 'sayi'),
            el('td', null, [el('button', {
              sinif: 'dugme-kucuk',
              metin: 'Listeye ekle',
              tikla: async () => {
                try {
                  await cagir('sayim:listeyeEkle', { stokNo: b.stokNo, stokAdi: b.ad });
                  mevcutCiz(await cagir('sayim:liste'));
                  bildir('Ürün listeye eklendi.', 'iyi');
                } catch (e) { hataGoster(e); }
              }
            })])
          ])));
        } catch (e) { hataGoster(e); }
      }, 300);
    });

    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Listedeki ürünler' }));
    kap.appendChild(el('div', { sinif: 'form-satir' }, [
      el('button', {
        sinif: 'dugme-sade',
        metin: 'Listeyi boşalt',
        tikla: async () => {
          const onay = await window.galya.cagir('sistem:onay', {
            baslik: 'Sayım listesini boşalt',
            mesaj: 'Listedeki bütün ürünler çıkarılacak.',
            detay: 'Yapılmış sayım kayıtları silinmez, yalnızca sayılacaklar listesi boşalır.',
            evet: 'Boşalt', hayir: 'Vazgeç'
          });
          if (!onay.veri || !onay.veri.onay) return;
          try {
            const s = await cagir('sayim:listeyiBosalt');
            mevcutCiz(await cagir('sayim:liste'));
            bildir(`${sayiYaz(s.cikarilan)} ürün listeden çıkarıldı.`, 'iyi');
          } catch (e) { hataGoster(e); }
        }
      })
    ]));
    kap.appendChild(mevcutKap);
    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Ürün ekle' }));
    kap.appendChild(el('div', { sinif: 'form-satir' }, [arama]));
    kap.appendChild(sonuc);
    katmanAc('Sayılacak ürünler', kap);
  } catch (e) { hataGoster(e); }
}

// ---------- REÇETE ----------

ekranlar.recete = async function () {
  const mamuller = await cagir('recete:mamuller');
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Reçete ağacı',
    durum.yazmaAcik
      ? [el('button', { sinif: 'dugme-sade', metin: 'Yeni reçete', tikla: yeniRecetePenceresi })]
      : null
  ));
  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    `${mamuller.length} mamulün reçetesi var. Bir mamule tıklayın, altındaki bütün ` +
    'yarı mamul ve hammaddeler açılsın.' +
    (durum.yazmaAcik
      ? ' Reçeteyi buradan düzenleyebilirsiniz; değişiklik doğrudan Vega\'ya yazılır.'
      : ' Vega\'ya yazma kapalı olduğu için reçeteler şimdilik yalnızca görüntüleniyor.')
  ]));

  const arama = el('input', { type: 'text', placeholder: 'Mamul ara…' });
  const listeKap = el('div');
  function ciz(kayitlar) {
    bosalt(listeKap);
    listeKap.appendChild(tabloYap(
      ['Mamul', 'Satır', ''],
      kayitlar,
      (m) => el('tr', null, [
        hucre(m.mamulAdi || ('Reçete ' + m.receteNo)),
        hucre(sayiYaz(m.satirSayisi), 'sayi'),
        el('td', null, [
          el('button', {
            sinif: 'dugme-kucuk',
            metin: 'Ağacı aç',
            tikla: () => receteAgaciGoster(m)
          }),
          durum.yazmaAcik
            ? el('button', {
                sinif: 'dugme-kucuk',
                metin: 'Düzenle',
                style: 'margin-left:6px',
                tikla: () => receteDuzenle(m)
              })
            : null
        ])
      ])
    ));
  }
  ciz(mamuller.slice(0, 100));
  arama.addEventListener('input', () => {
    const t = arama.value.trim().toLocaleLowerCase('tr');
    const suz = t
      ? mamuller.filter((m) => (m.mamulAdi || '').toLocaleLowerCase('tr').includes(t))
      : mamuller;
    ciz(suz.slice(0, 100));
  });

  icerik.appendChild(el('div', { sinif: 'form-satir' }, [arama]));
  icerik.appendChild(listeKap);
};

// Reçete düzenleme: satır ekle / miktar değiştir / satır sil.
// Her işlem doğrudan Vega'daki reçete tablosuna yazılır.
async function receteDuzenle(mamul) {
  try {
    const kap = el('div');
    const baslik = mamul.mamulAdi || ('Reçete ' + mamul.receteNo);
    const satirKap = el('div');

    async function tazele() {
      const satirlar = await cagir('recete:satirlar', { receteNo: mamul.receteNo });
      bosalt(satirKap);
      if (!satirlar.length) {
        satirKap.appendChild(el('div', { sinif: 'bos-mesaj', metin: 'Reçetede henüz bileşen yok.' }));
        return;
      }
      satirKap.appendChild(tabloYap(
        ['Bileşen', 'Miktar', 'Birim', 'Fire %', ''],
        satirlar,
        (s) => {
          const miktarKutu = el('input', {
            type: 'number', sinif: 'miktar', step: '0.001', min: '0', value: String(s.miktar)
          });
          const fireKutu = el('input', {
            type: 'number', sinif: 'miktar', step: '0.1', min: '0', value: String(s.fireOrani || 0)
          });
          return el('tr', null, [
            hucre(s.ad),
            el('td', null, [miktarKutu]),
            hucre(s.birim || '—'),
            el('td', null, [fireKutu]),
            el('td', null, [
              el('button', {
                sinif: 'dugme-kucuk',
                metin: 'Kaydet',
                tikla: async () => {
                  try {
                    await cagir('recete:satirGuncelle', {
                      ind: s.ind,
                      miktar: Number(miktarKutu.value),
                      birim: s.birim,
                      fireOrani: Number(fireKutu.value)
                    });
                    bildir('Satır güncellendi.', 'iyi');
                    await tazele();
                  } catch (e) { hataGoster(e); }
                }
              }),
              el('button', {
                sinif: 'dugme-kucuk',
                metin: 'Sil',
                style: 'margin-left:6px',
                tikla: async () => {
                  const onay = await window.galya.cagir('sistem:onay', {
                    baslik: 'Bileşeni sil',
                    mesaj: `"${s.ad}" reçeteden çıkarılacak.`,
                    detay: 'Değişiklik doğrudan Vega reçetesine yazılır.',
                    evet: 'Sil', hayir: 'Vazgeç'
                  });
                  if (!onay.veri || !onay.veri.onay) return;
                  try {
                    await cagir('recete:satirSil', { ind: s.ind });
                    bildir('Bileşen silindi.', 'iyi');
                    await tazele();
                  } catch (e) { hataGoster(e); }
                }
              })
            ])
          ]);
        }
      ));
    }

    kap.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
      `"${baslik}" mamulünün reçetesi. Miktar veya fire oranını değiştirip Kaydet'e basın.`
    ]));
    kap.appendChild(satirKap);

    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Bileşen ekle' }));
    const miktarKutu = el('input', { type: 'number', sinif: 'miktar', step: '0.001', min: '0', value: '1' });
    const fireKutu = el('input', { type: 'number', sinif: 'miktar', step: '0.1', min: '0', value: '0' });
    let secilen = null;
    kap.appendChild(urunSecici('Eklenecek bileşen', (b) => { secilen = b; }));
    kap.appendChild(el('div', { sinif: 'form-satir' }, [
      el('div', null, [el('label', { metin: 'Miktar' }), miktarKutu]),
      el('div', null, [el('label', { metin: 'Fire %' }), fireKutu]),
      el('button', {
        sinif: 'dugme-ana',
        metin: 'Reçeteye ekle',
        tikla: async () => {
          if (!secilen) { bildir('Önce bileşen seçin.', 'kotu'); return; }
          try {
            await cagir('recete:satirEkle', {
              receteNo: mamul.receteNo,
              stokNo: secilen.stokNo,
              miktar: Number(miktarKutu.value),
              fireOrani: Number(fireKutu.value)
            });
            bildir('Bileşen eklendi.', 'iyi');
            await tazele();
          } catch (e) { hataGoster(e); }
        }
      })
    ]));

    await tazele();
    katmanAc(baslik + ' — reçete düzenle', kap);
  } catch (e) { hataGoster(e); }
}

// Mamul seçilince reçete başlığı oluşturulur, sonra bileşen ekleme açılır.
// Seçilen mamulün reçetesi zaten varsa mevcut reçete açılır.
function yeniRecetePenceresi() {
  const kap = el('div');
  kap.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Üretilecek mamulü seçin. Reçete başlığı oluşturulup bileşen ekleme ekranı açılır.'
  ]));
  kap.appendChild(urunSecici('Mamul', async (b) => {
    try {
      const s = await cagir('recete:olustur', { mamulNo: b.stokNo });
      katmanKapat();
      bildir(s.yeni ? 'Reçete oluşturuldu.' : 'Bu mamulün reçetesi zaten vardı, açıldı.', 'iyi');
      receteDuzenle({ receteNo: s.receteNo, mamulAdi: b.ad });
    } catch (e) { hataGoster(e); }
  }));
  katmanAc('Yeni reçete', kap);
}

// Reçete ağacı: her bileşenin güncel maliyeti ve mamulün alttan yukarı
// hesaplanan toplam maliyeti gösterilir. Yazma açıkken satırlar ağacın
// içinden düzenlenebilir; ayrı pencere açmaya gerek kalmaz.
async function receteAgaciGoster(mamul) {
  const kap = el('div');

  async function ciz() {
    const [agac, maliyet] = await Promise.all([
      cagir('recete:agac', { receteNo: mamul.receteNo }),
      mamul.mamulStokNo
        ? cagir('maliyet:mamul', { stokNo: mamul.mamulStokNo }).catch(() => null)
        : Promise.resolve(null)
    ]);

    // Maliyet dökümü yalnızca ilk seviye bileşenler için geliyor; alt
    // seviyelerin tutarı zaten üst satırın içinde toplanmış oluyor.
    const maliyetHaritasi = new Map();
    if (maliyet) {
      for (const b of maliyet.bilesenler) maliyetHaritasi.set(Number(b.stokNo), b);
    }

    bosalt(kap);

    if (maliyet) {
      kap.appendChild(el('div', { sinif: 'ozet-serit' }, [
        ozetKarti('Kart maliyeti', paraYaz(maliyet.kartMaliyeti) + ' TL'),
        ozetKarti(
          'Reçeteden hesaplanan',
          maliyet.yeniMaliyet == null ? '—' : paraYaz(maliyet.yeniMaliyet) + ' TL'
        ),
        ozetKarti('Verim', sayiYaz(maliyet.verim, 2))
      ]));
      kap.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
        'Bileşen maliyetleri son alış fiyatından gelir; alt reçetesi olan ' +
        'bileşenler kendi reçetelerinden hesaplanır. Kaynak: ' + maliyet.kaynakAdi + '.'
      ]));
    }

    if (!agac.length) {
      kap.appendChild(el('div', { sinif: 'bos-mesaj', metin: 'Bu reçetede satır yok.' }));
    } else {
      const agacKutu = el('div', { sinif: 'agac-kutu' });
      agacSatirlariYaz(agacKutu, agac, maliyetHaritasi, ciz);
      kap.appendChild(agacKutu);
    }

    if (durum.yazmaAcik) {
      kap.appendChild(bilesenEklemeFormu(mamul.receteNo, ciz));
    }
  }

  try {
    await ciz();
    katmanAc((mamul.mamulAdi || ('Reçete ' + mamul.receteNo)) + ' — reçete ağacı', kap);
  } catch (e) { hataGoster(e); }
}

function agacSatirlariYaz(kutu, satirlar, maliyetHaritasi, tazele) {
  for (const s of satirlar) {
    const m = (s.seviye || 0) === 0 ? maliyetHaritasi.get(Number(s.stokNo)) : null;

    const satirKutusu = el('div', {
      sinif: 'agac-satir',
      style: 'padding-left:' + (16 * (s.seviye || 0)) + 'px'
    }, [
      el('span', { sinif: 'ad', metin: (s.altRecetesiVar ? '▸ ' : '· ') + s.ad }),
      el('span', {
        sinif: 'mik',
        metin:
          sayiYaz(s.miktar, 3) + ' ' + (s.birim || '') +
          (s.fireOrani ? '  (fire %' + sayiYaz(s.fireOrani, 1) + ')' : '') +
          (m && m.tutar != null ? '   ' + paraYaz(m.tutar) + ' TL' : '')
      })
    ]);

    if (durum.yazmaAcik) {
      // Düzenleme satırın altında açılıyor; ağaç kapanmıyor.
      const duzenKutusu = el('div', {
        sinif: 'form-satir',
        style: 'padding-left:' + (16 * (s.seviye || 0) + 24) + 'px'
      });
      duzenKutusu.classList.add('hidden');

      const miktarKutu = el('input', {
        type: 'number', sinif: 'miktar', step: '0.001', min: '0', value: String(s.miktar)
      });
      const fireKutu = el('input', {
        type: 'number', sinif: 'miktar', step: '0.1', min: '0', value: String(s.fireOrani || 0)
      });

      duzenKutusu.appendChild(el('div', null, [el('label', { metin: 'Miktar' }), miktarKutu]));
      duzenKutusu.appendChild(el('div', null, [el('label', { metin: 'Fire %' }), fireKutu]));
      duzenKutusu.appendChild(el('button', {
        sinif: 'dugme-kucuk',
        metin: 'Kaydet',
        tikla: async () => {
          try {
            await cagir('recete:satirGuncelle', {
              ind: s.ind,
              miktar: Number(miktarKutu.value),
              birim: s.birim,
              fireOrani: Number(fireKutu.value)
            });
            bildir('Satır güncellendi.', 'iyi');
            await tazele();
          } catch (e) { hataGoster(e); }
        }
      }));
      duzenKutusu.appendChild(el('button', {
        sinif: 'dugme-kucuk',
        metin: 'Sil',
        tikla: async () => {
          const onay = await window.galya.cagir('sistem:onay', {
            baslik: 'Bileşeni sil',
            mesaj: `"${s.ad}" reçeteden çıkarılacak.`,
            detay: 'Değişiklik doğrudan Vega reçetesine yazılır.',
            evet: 'Sil', hayir: 'Vazgeç'
          });
          if (!onay.veri || !onay.veri.onay) return;
          try {
            await cagir('recete:satirSil', { ind: s.ind });
            bildir('Bileşen silindi.', 'iyi');
            await tazele();
          } catch (e) { hataGoster(e); }
        }
      }));

      satirKutusu.appendChild(el('button', {
        sinif: 'dugme-kucuk',
        style: 'margin-left:10px',
        metin: 'Düzenle',
        tikla: () => duzenKutusu.classList.toggle('hidden')
      }));

      kutu.appendChild(satirKutusu);
      kutu.appendChild(duzenKutusu);
    } else {
      kutu.appendChild(satirKutusu);
    }

    if (s.alt && s.alt.length) agacSatirlariYaz(kutu, s.alt, maliyetHaritasi, tazele);
  }
}

function bilesenEklemeFormu(receteNo, tazele) {
  const kap = el('div');
  kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Bileşen ekle' }));

  const miktarKutu = el('input', { type: 'number', sinif: 'miktar', step: '0.001', min: '0', value: '1' });
  const fireKutu = el('input', { type: 'number', sinif: 'miktar', step: '0.1', min: '0', value: '0' });
  let secilen = null;

  kap.appendChild(urunSecici('Eklenecek bileşen', (b) => { secilen = b; }));
  kap.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', null, [el('label', { metin: 'Miktar' }), miktarKutu]),
    el('div', null, [el('label', { metin: 'Fire %' }), fireKutu]),
    el('button', {
      sinif: 'dugme-ana',
      metin: 'Reçeteye ekle',
      tikla: async () => {
        if (!secilen) { bildir('Önce bileşen seçin.', 'kotu'); return; }
        try {
          await cagir('recete:satirEkle', {
            receteNo,
            stokNo: secilen.stokNo,
            miktar: Number(miktarKutu.value),
            fireOrani: Number(fireKutu.value)
          });
          bildir('Bileşen eklendi.', 'iyi');
          await tazele();
        } catch (e) { hataGoster(e); }
      }
    })
  ]));
  return kap;
}

// ---------- THIRD ----------

ekranlar.third = async function () {
  const [adaylar, isaretliler] = await Promise.all([
    cagir('third:adaylar'),
    cagir('third:isaretliler')
  ]);
  const isaretHaritasi = {};
  for (const i of isaretliler) isaretHaritasi[i.stokNo] = i;

  bosalt(icerik);
  icerik.appendChild(ekranBasligi('THIRD listesi', disaAktarDugmeleri(() => ({
    baslik: 'THIRD adayları (üretim gerektiren stoklar)',
    sayfaAdi: 'THIRD',
    sutunlar: [
      { ad: 'Ürün', alan: 'ad', tur: 'metin', genislik: 44 },
      { ad: 'Kalan', alan: 'kalan', tur: 'sayi', genislik: 13 },
      { ad: 'Reçete satırı', alan: 'receteSatiri', tur: 'sayi', genislik: 14 },
      { ad: 'Vega KOD11', alan: 'kod11', tur: 'metin', genislik: 14 },
      { ad: 'Panelde işaretli', alan: 'isaretDurumu', tur: 'metin', genislik: 16 }
    ],
    satirlar: adaylar.map((a) => Object.assign({}, a, {
      isaretDurumu: isaretHaritasi[a.stokNo] && isaretHaritasi[a.stokNo].isaretli ? 'THIRD' : ''
    }))
  }))));
  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Kendi reçetesi olan, yani üretim gerektiren stoklar. İşaretlediğiniz ürünler ' +
    'panel veritabanında saklanır. Vega kartındaki Özel Kod 11 alanına yazma işlemi ' +
    (durum.yazmaAcik ? 'açık.' : 'kapalı olduğu için şimdilik sadece işaretleme yapılır.')
  ]));

  icerik.appendChild(tabloYap(
    ['Ürün', 'Kalan', 'Reçete satırı', 'Vega KOD11', 'İşaret', ''],
    adaylar,
    (a) => {
      const isaret = isaretHaritasi[a.stokNo];
      const dugmeler = [el('button', {
        sinif: 'dugme-kucuk',
        metin: isaret && isaret.isaretli ? 'İşareti kaldır' : 'THIRD olarak işaretle',
        tikla: async () => {
          try {
            await cagir('third:isaretle', {
              stokNo: a.stokNo,
              stokAdi: a.ad,
              isaretli: !(isaret && isaret.isaretli)
            });
            bildir('Kaydedildi.', 'iyi');
            ekranAc('third');
          } catch (e) { hataGoster(e); }
        }
      })];
      if (durum.yazmaAcik && isaret && isaret.isaretli && !a.kod11) {
        dugmeler.push(el('button', {
          sinif: 'dugme-kucuk',
          metin: 'Vega\'ya yaz',
          style: 'margin-left:6px',
          tikla: () => thirdVegayaYaz(a)
        }));
      }
      // Stoğu eksideyse buradan da sıfıra çekilebilsin; kullanıcı Üretim
      // ekranına gitmek zorunda kalmasın.
      if (durum.yazmaAcik && Number(a.kalan) < 0 && Number(a.receteSatiri) > 0) {
        dugmeler.push(el('button', {
          sinif: 'dugme-kucuk tehlike',
          metin: 'Sıfıra kadar üret',
          style: 'margin-left:6px',
          tikla: () => tekUret({
            stokNo: a.stokNo,
            ad: a.ad,
            birim: a.birim,
            uretilecek: -Number(a.kalan)
          })
        }));
      }
      return el('tr', null, [
        hucre(a.ad),
        hucre(sayiYaz(a.kalan, 2), 'sayi ' + (a.kalan < 0 ? 'eksi' : '')),
        hucre(sayiYaz(a.receteSatiri), 'sayi'),
        hucre(a.kod11 || '—'),
        el('td', null, [
          isaret && isaret.isaretli
            ? el('span', { sinif: 'etiket yesil', metin: 'THIRD' })
            : el('span', { sinif: 'etiket gri', metin: '—' })
        ]),
        el('td', null, dugmeler)
      ]);
    }
  ));
};

async function thirdVegayaYaz(stok) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: 'Vega kartına yaz',
    mesaj: `"${stok.ad}" kartının Özel Kod 11 alanına THIRD yazılacak.`,
    detay: 'Bu işlem Vega stok kartını değiştirir. Stok hareketi veya maliyet etkilenmez.',
    evet: 'Yaz',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    await cagir('third:vegayaYaz', { stokNo: stok.stokNo, deger: 'THIRD' });
    bildir('Vega kartına yazıldı.', 'iyi');
    ekranAc('third');
  } catch (e) { hataGoster(e); }
}

// ---------- TUTANAK ----------

ekranlar.tutanak = async function () {
  const liste = await cagir('tutanak:liste');
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Ürün değişim tutanağı', [
    el('button', { sinif: 'dugme-sade', metin: 'Yeni tutanak', tikla: tutanakPenceresi })
  ]));
  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    durum.yazmaAcik
      ? 'Bir stoktan miktar düşülüp başka bir stoğa eklenen işlemler burada kayıt altına alınır. ' +
        '"Vega\'ya yaz" düğmesi çıkış ve giriş fişi çiftini Vega\'da oluşturur.'
      : 'Bir stoktan miktar düşülüp başka bir stoğa eklenen işlemler burada kayıt altına alınır. ' +
        'Vega\'ya yazma kapalı olduğu için kayıtlar şimdilik yalnızca panelde tutuluyor.'
  ]));
  icerik.appendChild(tabloYap(
    ['Tarih', 'Düşülen', 'Miktar', 'Artan', 'Miktar', 'Sebep', 'Düzenleyen', 'Vega', ''],
    liste,
    (t) => el('tr', null, [
      hucre(saatliTarih(t.tarih)),
      hucre(t.dusenAd),
      hucre(sayiYaz(t.dusenMiktar, 2), 'sayi eksi'),
      hucre(t.artanAd),
      hucre(sayiYaz(t.artanMiktar, 2), 'sayi arti'),
      hucre(t.sebep || '—'),
      hucre(t.duzenleyen || '—'),
      el('td', null, [
        t.vegayaYazildi
          ? el('span', { sinif: 'etiket yesil', metin: t.vegaBelgeNo || 'Yazıldı' })
          : el('span', { sinif: 'etiket gri', metin: 'Yazılmadı' })
      ]),
      el('td', null, tutanakDugmeleri(t))
    ])
  ));
};

function tutanakDugmeleri(t) {
  const dugmeler = [];

  // İmzalanacak resmî çıktı. Vega'ya yazılmış olsun olmasın basılabilir;
  // belgenin üstünde stok kaydının oluşup oluşmadığı yazıyor.
  dugmeler.push(el('button', {
    sinif: 'dugme-kucuk',
    metin: 'Belge',
    title: 'İmza alanlı tutanak belgesini PDF olarak kaydet',
    tikla: async () => {
      try {
        const s = await cagir('tutanak:belgePdf', { id: t.id });
        if (s.iptal) return;
        bildir('Tutanak belgesi kaydedildi. Açmak için buraya tıklayın.', 'iyi');
        const b = document.getElementById('bildirim');
        b.style.cursor = 'pointer';
        b.onclick = () => {
          window.galya.cagir('rapor:ac', { yol: s.yol });
          b.classList.add('hidden');
        };
        clearTimeout(bildirimZaman);
        bildirimZaman = setTimeout(() => b.classList.add('hidden'), 15000);
      } catch (e) { hataGoster(e); }
    }
  }));

  dugmeler.push(el('button', {
    sinif: 'dugme-kucuk',
    style: 'margin-left:6px',
    metin: 'Yazdır',
    title: 'Tutanak belgesini yazıcıya gönder',
    tikla: async () => {
      try {
        await cagir('tutanak:belgeYazdir', { id: t.id });
      } catch (e) { hataGoster(e); }
    }
  }));

  if (durum.yazmaAcik && !t.vegayaYazildi) {
    dugmeler.push(el('button', {
      sinif: 'dugme-kucuk',
      metin: "Vega'ya yaz",
      tikla: async () => {
        const onay = await window.galya.cagir('sistem:onay', {
          baslik: "Tutanağı Vega'ya yaz",
          mesaj: `${t.dusenAd} → ${sayiYaz(t.dusenMiktar, 2)} düşülecek, ` +
                 `${t.artanAd} → ${sayiYaz(t.artanMiktar, 2)} eklenecek.`,
          detay: "Vega'da bir stok çıkış ve bir stok giriş fişi oluşur. " +
                 'İşlem tek seferde yazılır ve buradan geri alınabilir.',
          evet: 'Yaz', hayir: 'Vazgeç'
        });
        if (!onay.veri || !onay.veri.onay) return;
        try {
          const s = await cagir('tutanak:vegayaYaz', { id: t.id });
          bildir(`Vega'ya yazıldı. Çıkış ${s.cikisBelgeNo}, giriş ${s.girisBelgeNo}.`, 'iyi');
          ekranAc('tutanak');
        } catch (e) { hataGoster(e); }
      }
    }));
  }

  if (durum.yazmaAcik && t.vegayaYazildi) {
    dugmeler.push(el('button', {
      sinif: 'dugme-kucuk',
      metin: "Vega'dan sil",
      tikla: async () => {
        const onay = await window.galya.cagir('sistem:onay', {
          baslik: "Vega'daki fişleri sil",
          mesaj: 'Bu tutanak için Vega\'da oluşturulan fiş çifti silinecek.',
          detay: 'Stok miktarları işlem öncesindeki hâline döner. Panel kaydı kalır.',
          evet: 'Sil', hayir: 'Vazgeç'
        });
        if (!onay.veri || !onay.veri.onay) return;
        try {
          await cagir('tutanak:vegadanGeriAl', { id: t.id });
          bildir("Vega'daki fişler silindi.", 'iyi');
          ekranAc('tutanak');
        } catch (e) { hataGoster(e); }
      }
    }));
  }

  dugmeler.push(el('button', {
    sinif: 'dugme-kucuk',
    metin: 'Kaydı sil',
    tikla: async () => {
      if (t.vegayaYazildi) {
        bildir("Önce Vega'daki fişleri silin.", 'kotu');
        return;
      }
      const onay = await window.galya.cagir('sistem:onay', {
        baslik: 'Tutanağı geri al',
        mesaj: 'Bu tutanak iptal edilecek.',
        evet: 'Geri al', hayir: 'Vazgeç'
      });
      if (!onay.veri || !onay.veri.onay) return;
      try {
        await cagir('tutanak:iptal', { id: t.id });
        bildir('Tutanak geri alındı.', 'iyi');
        ekranAc('tutanak');
      } catch (e) { hataGoster(e); }
    }
  }));

  return dugmeler;
}

function urunSecici(etiket, secildi) {
  const kap = el('div');
  const secilenYazi = el('div', { sinif: 'aciklama-kutu', metin: etiket + ': henüz seçilmedi' });
  const arama = el('input', { type: 'text', placeholder: 'Ürün ara…' });
  const sonuc = el('div');
  let zaman = null;
  arama.addEventListener('input', () => {
    clearTimeout(zaman);
    zaman = setTimeout(async () => {
      const terim = arama.value.trim();
      if (terim.length < 2) { bosalt(sonuc); return; }
      try {
        const bulunan = await cagir('stok:ara', { terim });
        bosalt(sonuc);
        sonuc.appendChild(tabloYap(['Ürün', 'Kalan', ''], bulunan, (b) => el('tr', null, [
          hucre(b.ad),
          hucre(sayiYaz(b.kalan, 2), 'sayi'),
          el('td', null, [el('button', {
            sinif: 'dugme-kucuk',
            metin: 'Seç',
            tikla: () => {
              secilenYazi.textContent = etiket + ': ' + b.ad;
              bosalt(sonuc);
              arama.value = '';
              secildi(b);
            }
          })])
        ])));
      } catch (e) { hataGoster(e); }
    }, 300);
  });
  kap.appendChild(secilenYazi);
  kap.appendChild(el('div', { sinif: 'form-satir' }, [arama]));
  kap.appendChild(sonuc);
  return kap;
}

function tutanakPenceresi() {
  let dusen = null;
  let artan = null;
  const dusenMiktar = el('input', { type: 'number', sinif: 'miktar', step: '0.01', min: '0' });
  const artanMiktar = el('input', { type: 'number', sinif: 'miktar', step: '0.01', min: '0' });
  const sebep = el('input', { type: 'text', placeholder: 'Sebep (örn. bozulan ürün yerine kullanıldı)' });

  const kap = el('div');
  kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: '1. Hangi üründen düşülecek' }));
  kap.appendChild(urunSecici('Düşülecek ürün', (b) => { dusen = b; }));
  kap.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', null, [el('label', { metin: 'Düşülecek miktar' }), dusenMiktar])
  ]));

  kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: '2. Hangi ürüne eklenecek' }));
  kap.appendChild(urunSecici('Artırılacak ürün', (b) => { artan = b; }));
  kap.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', null, [el('label', { metin: 'Eklenecek miktar' }), artanMiktar])
  ]));

  kap.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', { style: 'flex:1' }, [el('label', { metin: 'Sebep' }), sebep])
  ]));

  const kaydet = el('button', { sinif: 'dugme-ana', metin: 'Tutanağı kaydet' });
  kaydet.addEventListener('click', async () => {
    if (!dusen || !artan) { bildir('İki ürünü de seçin.', 'kotu'); return; }
    if (!dusenMiktar.value || !artanMiktar.value) { bildir('İki miktarı da yazın.', 'kotu'); return; }
    const onay = await window.galya.cagir('sistem:onay', {
      baslik: 'Tutanağı kaydet',
      mesaj: `${dusen.ad} → ${sayiYaz(dusenMiktar.value, 2)} düşülecek, ` +
             `${artan.ad} → ${sayiYaz(artanMiktar.value, 2)} eklenecek.`,
      detay: durum.yazmaAcik
        ? "Kayıt panele yazılır ve aynı anda Vega'da bir çıkış (−) ve bir " +
          'giriş (+) fişi oluşur; stok miktarları hemen değişir. İşlem geri alınabilir.'
        : "Kayıt panel veritabanına yazılır. Vega'ya yazma kapalı olduğu için " +
          'stok miktarları şimdilik değişmez.',
      evet: 'Kaydet', hayir: 'Vazgeç'
    });
    if (!onay.veri || !onay.veri.onay) return;
    try {
      const s = await cagir('tutanak:kaydet', {
        dusenStokNo: dusen.stokNo, dusenStokAdi: dusen.ad, dusenMiktar: dusenMiktar.value,
        artanStokNo: artan.stokNo, artanStokAdi: artan.ad, artanMiktar: artanMiktar.value,
        sebep: sebep.value
      });
      katmanKapat();
      if (s.vegayaYazildi) {
        bildir(`Tutanak kaydedildi ve Vega'ya yazıldı. Çıkış ${s.cikisBelgeNo}, giriş ${s.girisBelgeNo}.`, 'iyi');
      } else if (s.yazmaHatasi) {
        bildir("Tutanak kaydedildi ama Vega'ya yazılamadı: " + s.yazmaHatasi, 'kotu');
      } else {
        bildir('Tutanak kaydedildi.', 'iyi');
      }
      ekranAc('tutanak');
    } catch (e) { hataGoster(e); }
  });
  kap.appendChild(el('div', { sinif: 'form-satir' }, [kaydet]));
  katmanAc('Yeni tutanak', kap);
}

// ---------- E-FATURA ----------

ekranlar.fatura = async function () {
  const [bekleyen, eslesmeler] = await Promise.all([
    cagir('fatura:bekleyen'),
    cagir('fatura:eslesmeler')
  ]);
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Bekleyen e-faturalar', disaAktarDugmeleri(() => ({
    baslik: 'Bekleyen e-faturalar',
    sayfaAdi: 'E-Fatura',
    sutunlar: [
      { ad: 'Tarih', alan: 'tarihYazi', tur: 'metin', genislik: 13 },
      { ad: 'Tedarikçi', alan: 'tedarikci', tur: 'metin', genislik: 40 },
      { ad: 'VKN', alan: 'vkn', tur: 'metin', genislik: 14 },
      { ad: 'Evrak no', alan: 'evrakNo', tur: 'metin', genislik: 20 },
      { ad: 'Tutar', alan: 'tutar', tur: 'para', genislik: 16 },
      { ad: 'Para birimi', alan: 'paraBirimi', tur: 'metin', genislik: 12 },
      { ad: 'Senaryo', alan: 'senaryo', tur: 'metin', genislik: 20 }
    ],
    satirlar: bekleyen.map((f) => Object.assign({}, f, { tarihYazi: tarihYaz(f.tarih) }))
  }))));
  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Gelen kutusunda olup Vega\'ya aktarılmamış faturalar. Faturanın kabulü Vega ' +
    'programından yapılır; burada hangi faturaların beklediği ve kurulu ürün ' +
    'eşleşmeleri görünür.'
  ]));
  icerik.appendChild(tabloYap(
    ['Tarih', 'Tedarikçi', 'VKN', 'Evrak no', 'Tutar', 'Senaryo'],
    bekleyen,
    (f) => el('tr', null, [
      hucre(tarihYaz(f.tarih)),
      hucre(f.tedarikci || '—'),
      hucre(f.vkn || '—'),
      hucre(f.evrakNo || '—'),
      hucre(paraYaz(f.tutar) + ' ' + (f.paraBirimi || ''), 'sayi'),
      hucre(f.senaryo || '—')
    ])
  ));

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Kurulu ürün eşleşmeleri' }));
  icerik.appendChild(tabloYap(
    ['Tedarikçi', 'Tedarikçi ürün kodu', 'Vega stok kartı'],
    eslesmeler,
    (m) => el('tr', null, [
      hucre(m.tedarikci || '—'),
      hucre(m.tedarikciKodu || '—'),
      hucre(m.stokAdi || '—')
    ])
  ));
};

// ---------- MALİYET ----------

ekranlar.maliyet = async function () {
  const liste = await cagir('maliyet:eskiyenler');
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Maliyeti eskimiş ürünler', disaAktarDugmeleri(() => ({
    baslik: 'Maliyeti eskimiş ürünler',
    sayfaAdi: 'Maliyet',
    sutunlar: [
      { ad: 'Ürün', alan: 'ad', tur: 'metin', genislik: 44 },
      { ad: 'Alış fiyatı', alan: 'alisFiyati', tur: 'para', genislik: 16 },
      { ad: 'Eski alış fiyatı', alan: 'eskiAlisFiyati', tur: 'para', genislik: 17 },
      { ad: 'Kart maliyeti', alan: 'maliyet', tur: 'para', genislik: 16 },
      { ad: 'Sebep', alan: 'sebep', tur: 'metin', genislik: 46 }
    ],
    satirlar: liste
  }))));
  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Alış fiyatı ile kart maliyeti arasında %10\'dan fazla fark olan veya maliyeti ' +
    'hiç hesaplanmamış ürünler. Bu listedeki ürünler için Vega\'da maliyetlendirme çalıştırın.'
  ]));
  icerik.appendChild(tabloYap(
    ['Ürün', 'Alış fiyatı', 'Kart maliyeti', 'Fiyat değişme', 'Son alış', 'Sebep'],
    liste,
    (m) => el('tr', null, [
      hucre(m.ad),
      hucre(paraYaz(m.alisFiyati), 'sayi'),
      hucre(paraYaz(m.maliyet), 'sayi ' + (m.maliyet === 0 ? 'eksi' : '')),
      hucre(tarihYaz(m.fiyatDegismeTarihi)),
      hucre(tarihYaz(m.sonAlisTarihi)),
      hucre(m.sebep)
    ])
  ));
};

// ---------- ALIŞ FATURASI ----------
//
// Fatura önce panelde taslak olarak hazırlanır. "Vega'ya yaz" düğmesi
// bastığında stok girişi, depo envanteri ve cari borç birlikte oluşur.
// Yanlış girilen taslak Vega'ya hiç dokunmaz.

ekranlar.alisFatura = async function () {
  const liste = await cagir('alisFatura:liste');
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Alış faturası', [
    el('button', { sinif: 'dugme-ana', metin: 'Yeni fatura', tikla: () => alisFaturaPenceresi(null) })
  ]));

  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Tedarikçiden gelen malı buradan stoğa girebilirsiniz. Fatura önce taslak ' +
    'olarak kaydedilir; ' +
    (durum.yazmaAcik
      ? "\"Vega'ya yaz\" dediğinizde stok girişi ve tedarikçiye borç birlikte oluşur."
      : "Vega'ya yazma kapalı olduğu için şimdilik yalnızca taslak tutulabilir.")
  ]));

  if (!durum.depo) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      'Fatura girmek için üst çubuktan tek bir depo seçmelisiniz.'
    ]));
  }

  icerik.appendChild(tabloYap(
    ['Tarih', 'Tedarikçi', 'Belge no', 'Satır', 'Ara toplam', 'KDV', 'Genel toplam', 'Vega', ''],
    liste,
    (f) => el('tr', null, [
      hucre(tarihYaz(f.tarih)),
      hucre(f.cariAdi),
      hucre(f.belgeNo || '—'),
      hucre(sayiYaz(f.satirSayisi), 'sayi'),
      hucre(paraYaz(f.araToplam), 'sayi'),
      hucre(paraYaz(f.kdvToplam), 'sayi'),
      hucre(paraYaz(f.genelToplam), 'sayi'),
      el('td', null, [
        f.vegayaYazildi
          ? el('span', { sinif: 'etiket yesil', metin: f.vegaBelgeNo || 'Yazıldı' })
          : el('span', { sinif: 'etiket gri', metin: 'Taslak' })
      ]),
      el('td', null, alisFaturaDugmeleri(f))
    ])
  ));
};

function alisFaturaDugmeleri(f) {
  const dugmeler = [];

  if (!f.vegayaYazildi) {
    dugmeler.push(el('button', {
      sinif: 'dugme-kucuk',
      metin: 'Düzenle',
      tikla: () => alisFaturaPenceresi(f.id)
    }));
  }

  if (durum.yazmaAcik && !f.vegayaYazildi) {
    dugmeler.push(el('button', {
      sinif: 'dugme-kucuk tehlike',
      style: 'margin-left:6px',
      metin: "Vega'ya yaz",
      tikla: async () => {
        const onay = await window.galya.cagir('sistem:onay', {
          baslik: "Faturayı Vega'ya yaz",
          mesaj: `${f.cariAdi} — ${paraYaz(f.genelToplam)} TL tutarında fatura yazılacak.`,
          detay:
            'Ürünler stoğa girer, depo envanteri artar ve tedarikçiye bu tutar ' +
            'kadar borç yazılır. İşlem tek seferde yapılır ve buradan geri alınabilir.',
          evet: 'Yaz', hayir: 'Vazgeç'
        });
        if (!onay.veri || !onay.veri.onay) return;
        try {
          const s = await cagir('alisFatura:vegayaYaz', { id: f.id });
          bildir(`Fatura Vega'ya yazıldı. Belge no ${s.belgeNo}.`, 'iyi');
          ekranAc('alisFatura');
        } catch (e) { hataGoster(e); }
      }
    }));
  }

  if (durum.yazmaAcik && f.vegayaYazildi) {
    dugmeler.push(el('button', {
      sinif: 'dugme-kucuk',
      metin: "Vega'dan sil",
      tikla: async () => {
        const onay = await window.galya.cagir('sistem:onay', {
          baslik: "Vega'daki faturayı sil",
          mesaj: 'Bu fatura için Vega\'da oluşturulan belge silinecek.',
          detay: 'Stok miktarı ve cari bakiye fatura öncesindeki hâline döner. Taslak panelde kalır.',
          evet: 'Sil', hayir: 'Vazgeç'
        });
        if (!onay.veri || !onay.veri.onay) return;
        try {
          await cagir('alisFatura:vegadanGeriAl', { id: f.id });
          bildir("Vega'daki fatura silindi.", 'iyi');
          ekranAc('alisFatura');
        } catch (e) { hataGoster(e); }
      }
    }));
  }

  if (!f.vegayaYazildi) {
    dugmeler.push(el('button', {
      sinif: 'dugme-kucuk',
      style: 'margin-left:6px',
      metin: 'Sil',
      tikla: async () => {
        const onay = await window.galya.cagir('sistem:onay', {
          baslik: 'Taslağı sil',
          mesaj: 'Bu fatura taslağı silinecek.',
          evet: 'Sil', hayir: 'Vazgeç'
        });
        if (!onay.veri || !onay.veri.onay) return;
        try {
          await cagir('alisFatura:sil', { id: f.id });
          bildir('Taslak silindi.', 'iyi');
          ekranAc('alisFatura');
        } catch (e) { hataGoster(e); }
      }
    }));
  }

  return dugmeler;
}

async function alisFaturaPenceresi(faturaId) {
  try {
    const mevcut = faturaId ? await cagir('alisFatura:getir', { id: faturaId }) : null;

    let cari = mevcut ? { cariNo: mevcut.cariNo, ad: mevcut.cariAdi } : null;
    const satirlar = mevcut ? mevcut.satirlar.map((s) => Object.assign({}, s)) : [];

    const kap = el('div');
    const bugun = new Date().toISOString().slice(0, 10);

    const belgeNoKutu = el('input', { type: 'text', placeholder: 'Boş bırakılırsa A serisinden verilir', value: mevcut && mevcut.belgeNo ? mevcut.belgeNo : '' });
    const tarihKutu = el('input', { type: 'date', value: mevcut && mevcut.tarih ? String(mevcut.tarih).slice(0, 10) : bugun });
    const vadeKutu = el('input', { type: 'date', value: mevcut && mevcut.vadeTarihi ? String(mevcut.vadeTarihi).slice(0, 10) : bugun });
    const aciklamaKutu = el('input', { type: 'text', placeholder: 'Açıklama (isteğe bağlı)', value: mevcut && mevcut.aciklama ? mevcut.aciklama : '' });

    // Tedarikçi seçimi
    const cariYazi = el('div', { sinif: 'aciklama-kutu', metin: cari ? 'Tedarikçi: ' + cari.ad : 'Tedarikçi: henüz seçilmedi' });
    const cariArama = el('input', { type: 'text', placeholder: 'Tedarikçi ara…' });
    const cariSonuc = el('div');
    let cariZaman = null;
    cariArama.addEventListener('input', () => {
      clearTimeout(cariZaman);
      cariZaman = setTimeout(async () => {
        const terim = cariArama.value.trim();
        if (terim.length < 2) { bosalt(cariSonuc); return; }
        try {
          const bulunan = await cagir('cari:ara', { terim });
          bosalt(cariSonuc);
          cariSonuc.appendChild(tabloYap(['Tedarikçi', 'Kod', ''], bulunan, (c) => el('tr', null, [
            hucre(c.ad),
            hucre(c.kod || '—'),
            el('td', null, [el('button', {
              sinif: 'dugme-kucuk',
              metin: 'Seç',
              tikla: () => {
                cari = { cariNo: c.cariNo, ad: c.ad };
                cariYazi.textContent = 'Tedarikçi: ' + c.ad;
                bosalt(cariSonuc);
                cariArama.value = '';
              }
            })])
          ])));
        } catch (e) { hataGoster(e); }
      }, 300);
    });

    // Satırlar
    const satirKap = el('div');
    const toplamYazi = el('div', { sinif: 'aciklama-kutu' });

    function toplamlariYaz() {
      let ara = 0;
      let kdv = 0;
      for (const s of satirlar) {
        const tutar = Number(s.miktar || 0) * Number(s.birimFiyat || 0);
        ara += tutar;
        kdv += tutar * (Number(s.kdvOrani || 0) / 100);
      }
      toplamYazi.textContent =
        `Ara toplam ${paraYaz(ara)} TL · KDV ${paraYaz(kdv)} TL · ` +
        `Genel toplam ${paraYaz(ara + kdv)} TL`;
    }

    function satirlariCiz() {
      bosalt(satirKap);
      if (!satirlar.length) {
        satirKap.appendChild(el('div', { sinif: 'bos-mesaj', metin: 'Faturaya henüz ürün eklenmedi.' }));
        toplamlariYaz();
        return;
      }
      satirKap.appendChild(tabloYap(
        ['Ürün', 'Miktar', 'Birim', 'Birim fiyat', 'KDV %', 'Tutar', ''],
        satirlar,
        (s, i) => {
          const miktarKutu = el('input', { type: 'number', sinif: 'miktar', step: '0.001', min: '0', value: String(s.miktar) });
          const fiyatKutu = el('input', { type: 'number', sinif: 'miktar', step: '0.01', min: '0', value: String(s.birimFiyat) });
          const kdvKutu = el('input', { type: 'number', sinif: 'miktar', step: '1', min: '0', value: String(s.kdvOrani || 0) });
          const tutarHucresi = hucre(paraYaz(Number(s.miktar) * Number(s.birimFiyat)), 'sayi');

          function guncelle() {
            s.miktar = Number(miktarKutu.value) || 0;
            s.birimFiyat = Number(fiyatKutu.value) || 0;
            s.kdvOrani = Number(kdvKutu.value) || 0;
            tutarHucresi.textContent = paraYaz(s.miktar * s.birimFiyat);
            toplamlariYaz();
          }
          miktarKutu.addEventListener('input', guncelle);
          fiyatKutu.addEventListener('input', guncelle);
          kdvKutu.addEventListener('input', guncelle);

          return el('tr', null, [
            hucre(s.stokAdi),
            el('td', null, [miktarKutu]),
            hucre(s.birim || '—'),
            el('td', null, [fiyatKutu]),
            el('td', null, [kdvKutu]),
            tutarHucresi,
            el('td', null, [el('button', {
              sinif: 'dugme-kucuk',
              metin: 'Çıkar',
              tikla: () => {
                const yeri = satirlar.indexOf(s);
                if (yeri >= 0) satirlar.splice(yeri, 1);
                satirlariCiz();
              }
            })])
          ]);
        }
      ));
      toplamlariYaz();
    }

    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: '1. Tedarikçi' }));
    kap.appendChild(cariYazi);
    kap.appendChild(el('div', { sinif: 'form-satir' }, [cariArama]));
    kap.appendChild(cariSonuc);

    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: '2. Fatura bilgisi' }));
    kap.appendChild(el('div', { sinif: 'form-satir' }, [
      el('div', null, [el('label', { metin: 'Fatura no' }), belgeNoKutu]),
      el('div', null, [el('label', { metin: 'Tarih' }), tarihKutu]),
      el('div', null, [el('label', { metin: 'Vade' }), vadeKutu])
    ]));
    kap.appendChild(el('div', { sinif: 'form-satir' }, [
      el('div', { style: 'flex:1' }, [el('label', { metin: 'Açıklama' }), aciklamaKutu])
    ]));

    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: '3. Ürünler' }));
    kap.appendChild(satirKap);
    kap.appendChild(toplamYazi);

    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Ürün ekle' }));
    const yeniMiktar = el('input', { type: 'number', sinif: 'miktar', step: '0.001', min: '0', value: '1' });
    const yeniFiyat = el('input', { type: 'number', sinif: 'miktar', step: '0.01', min: '0', value: '0' });
    const yeniKdv = el('input', { type: 'number', sinif: 'miktar', step: '1', min: '0', value: '10' });
    let secilenUrun = null;
    kap.appendChild(urunSecici('Eklenecek ürün', (b) => { secilenUrun = b; }));
    kap.appendChild(el('div', { sinif: 'form-satir' }, [
      el('div', null, [el('label', { metin: 'Miktar' }), yeniMiktar]),
      el('div', null, [el('label', { metin: 'Birim fiyat' }), yeniFiyat]),
      el('div', null, [el('label', { metin: 'KDV %' }), yeniKdv]),
      el('button', {
        sinif: 'dugme-sade',
        metin: 'Faturaya ekle',
        tikla: () => {
          if (!secilenUrun) { bildir('Önce ürün seçin.', 'kotu'); return; }
          if (!(Number(yeniMiktar.value) > 0)) { bildir('Miktar sıfırdan büyük olmalı.', 'kotu'); return; }
          satirlar.push({
            stokNo: secilenUrun.stokNo,
            stokAdi: secilenUrun.ad,
            stokKodu: secilenUrun.kod,
            birim: secilenUrun.birim,
            miktar: Number(yeniMiktar.value),
            birimFiyat: Number(yeniFiyat.value),
            kdvOrani: Number(yeniKdv.value)
          });
          secilenUrun = null;
          yeniMiktar.value = '1';
          yeniFiyat.value = '0';
          satirlariCiz();
        }
      })
    ]));

    const kaydet = el('button', { sinif: 'dugme-ana', metin: 'Taslağı kaydet' });
    kaydet.addEventListener('click', async () => {
      if (!cari) { bildir('Tedarikçi seçin.', 'kotu'); return; }
      if (!satirlar.length) { bildir('En az bir ürün ekleyin.', 'kotu'); return; }
      if (!durum.depo) { bildir('Üst çubuktan bir depo seçin.', 'kotu'); return; }
      try {
        await cagir('alisFatura:kaydet', {
          id: faturaId || 0,
          cariNo: cari.cariNo,
          cariAdi: cari.ad,
          belgeNo: belgeNoKutu.value.trim(),
          tarih: tarihKutu.value,
          vadeTarihi: vadeKutu.value,
          aciklama: aciklamaKutu.value.trim(),
          satirlar
        });
        katmanKapat();
        bildir('Fatura taslağı kaydedildi.', 'iyi');
        ekranAc('alisFatura');
      } catch (e) { hataGoster(e); }
    });
    kap.appendChild(el('div', { sinif: 'form-satir', style: 'margin-top:16px' }, [kaydet]));

    satirlariCiz();
    katmanAc(faturaId ? 'Fatura düzenle' : 'Yeni alış faturası', kap);
  } catch (e) { hataGoster(e); }
}

// ---------- ZAYİ / PERSONEL ÇIKIŞI ----------
//
// Bozulan, kırılan, dökülen mal ile çalışanın elinde kalan mal aynı belgeyle
// düşülüyor: stok çıkış fişi (belge tipi 33). Aradaki tek fark seçilen cari —
// gerçek zayide ZAYİ kartı, personelde kalan malda kişinin kendi cari kartı.
// Vega'da elle yapılırken de aynı ekran kullanılıyor.
//
// Fatura gibi önce panelde taslak durur; "Vega'ya yaz" ayrı bir onaydır.

ekranlar.zayi = async function () {
  const liste = await cagir('zayi:liste');
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Zayi / personel çıkışı', [
    el('button', { sinif: 'dugme-ana', metin: 'Yeni zayi', tikla: () => zayiPenceresi(null) })
  ]));

  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Bozulan, kırılan ya da çalışanın elinde kalan malı buradan düşün. ' +
    'Kayıt önce taslak olarak durur; ' +
    (durum.yazmaAcik
      ? "\"Vega'ya yaz\" dediğinizde stok düşer ve seçtiğiniz cariye borç yazılır."
      : "Vega'ya yazma kapalı olduğu için şimdilik yalnızca taslak tutulabilir.")
  ]));

  if (!durum.depo) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      'Zayi girmek için üst çubuktan tek bir depo seçmelisiniz.'
    ]));
  }

  icerik.appendChild(tabloYap(
    ['Tarih', 'Cari', 'Alt hesap', 'Sebep', 'Satır', 'Tutar', 'Giren', 'Vega', ''],
    liste,
    (z) => el('tr', null, [
      hucre(tarihYaz(z.tarih)),
      hucre(z.cariAdi),
      hucre(z.altHesap || '—'),
      hucre(z.sebep || '—'),
      hucre(sayiYaz(z.satirSayisi), 'sayi'),
      hucre(z.maliyetliMi ? paraYaz(z.toplam) : 'Tutarsız', 'sayi'),
      hucre(z.duzenleyen || '—'),
      el('td', null, [
        z.vegayaYazildi
          ? el('span', { sinif: 'etiket yesil', metin: z.vegaBelgeNo || 'Yazıldı' })
          : el('span', { sinif: 'etiket gri', metin: 'Taslak' })
      ]),
      el('td', null, zayiDugmeleri(z))
    ])
  ));
};

function zayiDugmeleri(z) {
  const dugmeler = [];

  if (!z.vegayaYazildi) {
    dugmeler.push(el('button', {
      sinif: 'dugme-kucuk',
      metin: 'Düzenle',
      tikla: () => zayiPenceresi(z.id)
    }));
  }

  if (durum.yazmaAcik && !z.vegayaYazildi) {
    dugmeler.push(el('button', {
      sinif: 'dugme-kucuk tehlike',
      style: 'margin-left:6px',
      metin: "Vega'ya yaz",
      tikla: async () => {
        const onay = await window.galya.cagir('sistem:onay', {
          baslik: "Zayi fişini Vega'ya yaz",
          mesaj: `${z.cariAdi} — ${sayiYaz(z.satirSayisi)} satırlık zayi fişi yazılacak.`,
          detay:
            'Ürünler stoktan düşer ve seçilen cariye ' +
            (z.maliyetliMi ? paraYaz(z.toplam) + ' TL borç yazılır.' : 'tutarsız borç satırı düşer.') +
            ' İşlem tek seferde yapılır ve buradan geri alınabilir.',
          evet: 'Yaz', hayir: 'Vazgeç'
        });
        if (!onay.veri || !onay.veri.onay) return;
        try {
          const s = await cagir('zayi:vegayaYaz', { id: z.id });
          bildir(`Zayi fişi Vega'ya yazıldı. Belge no ${s.belgeNo}.`, 'iyi');
          ekranAc('zayi');
        } catch (e) { hataGoster(e); }
      }
    }));
  }

  if (durum.yazmaAcik && z.vegayaYazildi) {
    dugmeler.push(el('button', {
      sinif: 'dugme-kucuk',
      metin: "Vega'dan sil",
      tikla: async () => {
        const onay = await window.galya.cagir('sistem:onay', {
          baslik: "Vega'daki zayi fişini sil",
          mesaj: (z.vegaBelgeNo || 'Zayi fişi') + " Vega'dan silinecek.",
          detay:
            'Stok miktarı ve cari bakiye fiş kesilmeden önceki hâline döner. ' +
            'Taslak panelde kalır.',
          evet: 'Sil', hayir: 'Vazgeç'
        });
        if (!onay.veri || !onay.veri.onay) return;
        try {
          await cagir('zayi:vegadanGeriAl', { id: z.id });
          bildir("Vega'daki zayi fişi silindi.", 'iyi');
          ekranAc('zayi');
        } catch (e) { hataGoster(e); }
      }
    }));
  }

  if (!z.vegayaYazildi) {
    dugmeler.push(el('button', {
      sinif: 'dugme-kucuk',
      style: 'margin-left:6px',
      metin: 'Sil',
      tikla: async () => {
        const onay = await window.galya.cagir('sistem:onay', {
          baslik: 'Taslağı sil',
          mesaj: 'Bu zayi taslağı silinecek.',
          evet: 'Sil', hayir: 'Vazgeç'
        });
        if (!onay.veri || !onay.veri.onay) return;
        try {
          await cagir('zayi:sil', { id: z.id });
          bildir('Taslak silindi.', 'iyi');
          ekranAc('zayi');
        } catch (e) { hataGoster(e); }
      }
    }));
  }

  return dugmeler;
}

// Zayi carisi seçici. Liste geçmiş çıkış fişlerinde kullanılmış carilerden
// geliyor (ZAYİ, FİRE, personel kartları); aranınca bütün cariler taranır.
function zayiCariSecici(baslangic, secildi) {
  const kap = el('div');
  const secilenYazi = el('div', {
    sinif: 'aciklama-kutu',
    metin: baslangic ? 'Cari: ' + baslangic.ad : 'Cari: henüz seçilmedi'
  });
  const sonuc = el('div');
  const arama = el('input', { type: 'text', placeholder: 'Başka bir cari ara…' });

  function listeCiz(cariler) {
    bosalt(sonuc);
    sonuc.appendChild(tabloYap(['Cari', 'Kod', 'Kullanım', ''], cariler, (c) => el('tr', null, [
      hucre(c.ad),
      hucre(c.kod || '—'),
      hucre(c.kullanim ? sayiYaz(c.kullanim) + ' fiş' : '—', 'sayi'),
      el('td', null, [el('button', {
        sinif: 'dugme-kucuk',
        metin: 'Seç',
        tikla: () => {
          secilenYazi.textContent = 'Cari: ' + c.ad;
          secildi({ cariNo: c.cariNo, ad: c.ad, kod: c.kod });
        }
      })])
    ])));
  }

  cagir('zayi:cariler', {}).then(listeCiz).catch(hataGoster);

  let zaman = null;
  arama.addEventListener('input', () => {
    clearTimeout(zaman);
    zaman = setTimeout(async () => {
      try {
        listeCiz(await cagir('zayi:cariler', { arama: arama.value.trim() }));
      } catch (e) { hataGoster(e); }
    }, 300);
  });

  kap.appendChild(secilenYazi);
  kap.appendChild(el('div', { sinif: 'form-satir' }, [arama]));
  kap.appendChild(sonuc);
  return kap;
}

async function zayiPenceresi(zayiId) {
  try {
    const mevcut = zayiId ? await cagir('zayi:getir', { id: zayiId }) : null;

    let cari = mevcut ? { cariNo: mevcut.cariNo, ad: mevcut.cariAdi } : null;
    const satirlar = mevcut ? mevcut.satirlar.map((s) => Object.assign({}, s)) : [];

    const kap = el('div');
    const bugun = new Date().toISOString().slice(0, 10);

    const tarihKutu = el('input', {
      type: 'date',
      value: mevcut && mevcut.tarih ? String(mevcut.tarih).slice(0, 10) : bugun
    });
    const altHesapKutu = el('input', {
      type: 'text',
      placeholder: 'ZAYİ',
      value: mevcut && mevcut.altHesap ? mevcut.altHesap : 'ZAYİ'
    });
    const sebepKutu = el('input', {
      type: 'text',
      placeholder: 'Örn. buzdolabı bozuldu, ürünler döküldü',
      value: mevcut && mevcut.sebep ? mevcut.sebep : ''
    });
    // Vega'nın kendi zayi fişlerinde 945 satırın 801'i sıfır fiyatlı; bu
    // yüzden varsayılan kapalı. İşaretlenirse tutar cari borcuna yazılır.
    const maliyetKutu = el('input', { type: 'checkbox' });
    maliyetKutu.checked = !!(mevcut && mevcut.maliyetliMi);

    const satirKap = el('div');
    const toplamYazi = el('div', { sinif: 'aciklama-kutu' });

    function toplamlariYaz() {
      const toplam = satirlar.reduce(
        (t, s) => t + Number(s.miktar || 0) * Number(s.birimMaliyet || 0),
        0
      );
      toplamYazi.textContent = maliyetKutu.checked
        ? `${satirlar.length} satır · Maliyet toplamı ${paraYaz(toplam)} TL — bu tutar cariye borç yazılır.`
        : `${satirlar.length} satır · Tutarsız zayi: yalnızca miktar düşer, cari borcu 0 olur ` +
          `(maliyet karşılığı ${paraYaz(toplam)} TL).`;
    }
    maliyetKutu.addEventListener('change', toplamlariYaz);

    function satirlariCiz() {
      bosalt(satirKap);
      if (!satirlar.length) {
        satirKap.appendChild(el('div', { sinif: 'bos-mesaj', metin: 'Henüz ürün eklenmedi.' }));
        toplamlariYaz();
        return;
      }
      satirKap.appendChild(tabloYap(
        ['Ürün', 'Miktar', 'Birim', 'Birim maliyet', 'Karşılığı', ''],
        satirlar,
        (s) => {
          const miktarKutu = el('input', {
            type: 'number', sinif: 'miktar', step: '0.001', min: '0', value: String(s.miktar)
          });
          const tutarHucresi = hucre(
            paraYaz(Number(s.miktar) * Number(s.birimMaliyet || 0)), 'sayi'
          );
          miktarKutu.addEventListener('input', () => {
            s.miktar = Number(miktarKutu.value) || 0;
            tutarHucresi.textContent = paraYaz(s.miktar * Number(s.birimMaliyet || 0));
            toplamlariYaz();
          });
          return el('tr', null, [
            el('td', null, [
              el('div', { sinif: 'ad-satir', metin: s.stokAdi }),
              s.stokKodu ? el('div', { sinif: 'alt-not', metin: s.stokKodu }) : null
            ]),
            el('td', null, [miktarKutu]),
            hucre(s.birim || '—'),
            hucre(paraYaz(s.birimMaliyet), 'sayi'),
            tutarHucresi,
            el('td', null, [el('button', {
              sinif: 'dugme-kucuk',
              metin: 'Çıkar',
              tikla: () => {
                const yeri = satirlar.indexOf(s);
                if (yeri >= 0) satirlar.splice(yeri, 1);
                satirlariCiz();
              }
            })])
          ]);
        }
      ));
      toplamlariYaz();
    }

    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: '1. Kime yazılacak' }));
    kap.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
      'Gerçek zayi için ZAYİ kartını, malın üstünde kaldığı çalışan için o ' +
      'kişinin cari kartını seçin. Listede en çok kullanılan cariler üstte.'
    ]));
    kap.appendChild(zayiCariSecici(cari, (c) => { cari = c; }));

    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: '2. Fiş bilgisi' }));
    kap.appendChild(el('div', { sinif: 'form-satir' }, [
      el('div', null, [el('label', { metin: 'Tarih' }), tarihKutu]),
      el('div', null, [el('label', { metin: 'Alt hesap' }), altHesapKutu]),
      el('div', { style: 'flex:1' }, [el('label', { metin: 'Sebep' }), sebepKutu])
    ]));
    kap.appendChild(el('div', { sinif: 'form-satir' }, [
      el('label', null, [maliyetKutu, ' Maliyetle yaz (cariye tutar borcu çıksın)'])
    ]));

    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: '3. Ürünler' }));
    kap.appendChild(satirKap);
    kap.appendChild(toplamYazi);

    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Ürün ekle' }));
    const yeniMiktar = el('input', {
      type: 'number', sinif: 'miktar', step: '0.001', min: '0', value: '1'
    });
    let secilenUrun = null;
    kap.appendChild(urunSecici('Eklenecek ürün', (b) => { secilenUrun = b; }));
    kap.appendChild(el('div', { sinif: 'form-satir' }, [
      el('div', null, [el('label', { metin: 'Miktar' }), yeniMiktar]),
      el('button', {
        sinif: 'dugme-sade',
        metin: 'Fişe ekle',
        tikla: () => {
          if (!secilenUrun) { bildir('Önce ürün seçin.', 'kotu'); return; }
          if (!(Number(yeniMiktar.value) > 0)) { bildir('Miktar sıfırdan büyük olmalı.', 'kotu'); return; }
          satirlar.push({
            stokNo: secilenUrun.stokNo,
            stokAdi: secilenUrun.ad,
            stokKodu: secilenUrun.kod,
            birim: secilenUrun.birim,
            miktar: Number(yeniMiktar.value),
            // Gerçek maliyet kaydetme anında karttan okunuyor; buradaki
            // değer yalnızca ekrandaki önizleme için (stok:ara "maliyet"
            // adıyla döndürüyor).
            birimMaliyet: Number(secilenUrun.maliyet || 0)
          });
          secilenUrun = null;
          yeniMiktar.value = '1';
          satirlariCiz();
        }
      })
    ]));

    const kaydet = el('button', { sinif: 'dugme-ana', metin: 'Taslağı kaydet' });
    kaydet.addEventListener('click', async () => {
      if (!cari) { bildir('Cari seçin (ZAYİ, FİRE ya da personel).', 'kotu'); return; }
      if (!satirlar.length) { bildir('En az bir ürün ekleyin.', 'kotu'); return; }
      if (!durum.depo) { bildir('Üst çubuktan bir depo seçin.', 'kotu'); return; }
      try {
        await cagir('zayi:kaydet', {
          id: zayiId || 0,
          cariNo: cari.cariNo,
          cariAdi: cari.ad,
          altHesap: altHesapKutu.value.trim(),
          sebep: sebepKutu.value.trim(),
          tarih: tarihKutu.value,
          maliyetliMi: maliyetKutu.checked,
          satirlar
        });
        katmanKapat();
        bildir('Zayi taslağı kaydedildi.', 'iyi');
        ekranAc('zayi');
      } catch (e) { hataGoster(e); }
    });

    kap.appendChild(el('div', { sinif: 'form-satir', style: 'margin-top:16px' }, [
      kaydet,
      el('button', { sinif: 'dugme-sade', metin: 'Vazgeç', tikla: katmanKapat })
    ]));

    satirlariCiz();
    katmanAc(zayiId ? 'Zayi kaydını düzenle' : 'Yeni zayi', kap);
  } catch (e) { hataGoster(e); }
}

// ---------- ÜRETİM ----------
//
// Üç yol, üçü de aynı üretim fişini yazar:
//
//   Zayiatlı — Vega'da elle yapılan işin tamamı: önce zayi çıkış fişi
//              (cari ZAYİ), stok eksiye düşer, sonra eksik kadar üretim.
//              Belge deseni `galya döküman/zaiyatlı manuel üretim .md`
//              izleyici kaydından çıkarıldı.
//   Manuel   — reçetesi olan herhangi bir ürün, istenen miktarda.
//   Otomatik — THIRD işaretli, stoğu eksiye düşmüş bütün ürünleri tek
//              tuşla sıfıra çeker.

// Zayiatlı üretim zayi fişi de kesiyor; "zayi" yetkisi olmayana o şerit
// hiç çizilmiyor (ana süreç de ayrıca reddediyor).
const URETIM_KIPLERI = [
  {
    anahtar: 'zayiatli',
    ad: 'Zayiatlı üretim',
    not: 'Zayi fişi + üretim, tek işlemde',
    yetki: 'zayi'
  },
  { anahtar: 'manuel', ad: 'Manuel üretim', not: 'İstediğin ürünü istediğin kadar üret' },
  { anahtar: 'otomatik', ad: 'Otomatik üretim', not: 'Eksiye düşenleri sıfıra çek' }
];

ekranlar.uretim = async function (parametre) {
  const kipler = URETIM_KIPLERI.filter((k) => !k.yetki || yetkiVar(k.yetki));
  const istenen = (parametre && parametre.kip) || kipler[0].anahtar;
  const kip = kipler.some((k) => k.anahtar === istenen) ? istenen : kipler[0].anahtar;

  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Üretim', null, true));

  const serit = el('div', { sinif: 'suzgec-serit' });
  for (const k of kipler) {
    serit.appendChild(el('button', {
      sinif: 'suzgec' + (k.anahtar === kip ? ' etkin' : ''),
      title: k.not,
      tikla: () => ekranAc('uretim', { kip: k.anahtar })
    }, [el('span', { sinif: 'suzgec-ad', metin: k.ad })]));
  }
  icerik.appendChild(serit);

  if (!durum.yazmaAcik) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      "Vega'ya yazma kapalı olduğu için üretim düğmeleri çalışmaz."
    ]));
  }

  if (kip === 'zayiatli') await uretimZayiatliBolumu();
  else if (kip === 'manuel') await uretimManuelBolumu();
  else await uretimOtomatikBolumu();

  await uretimGecmisiBolumu();
};

// --- Zayiatlı üretim -------------------------------------------------------
//
// Kullanıcı ürünü ve zayi miktarını yazıyor; program zayi fişini kesiyor,
// ardından stoğu sıfıra çekecek kadar üretim yapıyor. Üretim yazılamazsa
// zayi fişi geri alınıyor (ana süreçte), yarım iş kalmıyor.
async function uretimZayiatliBolumu() {
  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Vega\'da elle yaptığınız işin aynısı: önce zayi çıkış fişi kesilir ' +
    '(seçtiğiniz cariye, genelde ZAYİ), ürünün stoğu düşer; stok eksiye ' +
    'düşerse eksik miktar kadar üretim fişi yazılıp stok sıfıra çekilir. ' +
    'İki adım tek işlemdir — üretim yazılamazsa zayi fişi de geri alınır.'
  ]));

  const [urunler, cariler] = await Promise.all([
    cagir('uretim:uretilebilirler'),
    cagir('zayi:cariler').catch(() => [])
  ]);

  if (!urunler.length) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      'Reçetesi olan ürün bulunamadı. Zayiatlı üretim için ürünün reçetesi olmalı.'
    ]));
    return;
  }

  let secilen = null;
  const secilenYazi = el('div', { sinif: 'aciklama-kutu', metin: 'Ürün: henüz seçilmedi' });
  const miktarKutu = el('input', { type: 'number', sinif: 'miktar', step: '0.001', min: '0', value: '1' });
  const sebepKutu = el('input', { type: 'text', placeholder: 'Örn. dökülme, bozulma' });
  const altHesapKutu = el('input', { type: 'text', value: 'ZAYİ' });
  const maliyetKutu = el('input', { type: 'checkbox' });

  // Cari kutusu: varsayılan olarak adı ZAYİ olan kart seçili gelsin.
  const cariKutu = el('select', { sinif: 'form' },
    cariler.map((c) => el('option', { value: String(c.cariNo), metin: `${c.kod || c.ad}` }))
  );
  const zayiKarti = cariler.find((c) => /^ZAY/i.test(c.kod || '') || /^ZAY/i.test(c.ad || ''));
  if (zayiKarti) cariKutu.value = String(zayiKarti.cariNo);

  const uretDugme = el('button', { sinif: 'dugme-ana tehlike', metin: 'Zayi yaz ve üret' });
  uretDugme.disabled = !durum.yazmaAcik;

  uretDugme.addEventListener('click', async () => {
    if (!secilen) { bildir('Önce ürün seçin.', 'kotu'); return; }
    const miktar = Number(miktarKutu.value);
    if (!(miktar > 0)) { bildir('Zayi miktarı sıfırdan büyük olmalı.', 'kotu'); return; }
    if (!cariKutu.value) { bildir('Zayi carisi seçin.', 'kotu'); return; }

    const secilenCari = cariler.find((c) => String(c.cariNo) === cariKutu.value);
    const onay = await window.galya.cagir('sistem:onay', {
      baslik: 'Zayiatlı üretim',
      mesaj:
        `"${secilen.ad}" için ${sayiYaz(miktar, 3)} ${secilen.birim || ''} zayi yazılacak, ` +
        'ardından stok sıfıra çekilene kadar üretim yapılacak.',
      detay:
        `Zayi ${(secilenCari && (secilenCari.kod || secilenCari.ad)) || 'seçilen cari'} kartına ` +
        'stok çıkış fişiyle işlenir. Sonra reçetedeki bileşenler stoktan düşer, ' +
        'mamul stoğa girer. İki adım da geri alınabilir.',
      evet: 'Yaz ve üret',
      hayir: 'Vazgeç'
    });
    if (!onay.veri || !onay.veri.onay) return;

    try {
      uretDugme.disabled = true;
      const s = await cagir('uretim:zayiatli', {
        stokNo: secilen.stokNo,
        zayiMiktar: miktar,
        cariNo: Number(cariKutu.value),
        cariAdi: secilenCari ? secilenCari.ad : null,
        altHesap: altHesapKutu.value.trim(),
        sebep: sebepKutu.value.trim(),
        maliyetliMi: maliyetKutu.checked
      });
      if (s.uretildi) {
        bildir(
          `Zayi fişi ${s.zayiBelgeNo} kesildi, ${sayiYaz(s.uretilenMiktar, 3)} ` +
          `${secilen.birim || ''} üretildi (fiş ${s.fisNo}).`,
          'iyi'
        );
      } else {
        bildir(s.mesaj || `Zayi fişi ${s.zayiBelgeNo} kesildi.`, 'iyi');
      }
      ekranAc('uretim', { kip: 'zayiatli' });
    } catch (e) {
      hataGoster(e);
      uretDugme.disabled = false;
    }
  });

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: '1. Zayi olan ürün' }));
  icerik.appendChild(secilenYazi);
  icerik.appendChild(uretilebilirSecici(urunler, (u) => {
    secilen = u;
    secilenYazi.textContent =
      `Ürün: ${u.ad} · şu anki kalan ${sayiYaz(u.kalan, 2)} ${u.birim || ''}`;
  }));

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: '2. Zayi bilgisi' }));
  icerik.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', null, [el('label', { metin: 'Zayi miktarı' }), miktarKutu]),
    el('div', null, [el('label', { metin: 'Cari' }), cariKutu]),
    el('div', null, [el('label', { metin: 'Alt hesap' }), altHesapKutu]),
    el('div', { style: 'flex:1' }, [el('label', { metin: 'Sebep' }), sebepKutu])
  ]));
  icerik.appendChild(el('div', { sinif: 'form-satir' }, [
    el('label', null, [maliyetKutu, ' Maliyetle yaz (cariye tutar borcu çıksın)'])
  ]));
  icerik.appendChild(el('div', { sinif: 'form-satir', style: 'margin-top:16px' }, [uretDugme]));
}

// --- Manuel üretim ---------------------------------------------------------
async function uretimManuelBolumu() {
  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Reçetesi olan herhangi bir ürünü istediğiniz miktarda üretin. Reçetedeki ' +
    'bileşenler stoktan düşer, mamul stoğa girer. Miktarı boş bırakırsanız ' +
    'stoğu sıfıra getirecek kadar üretilir (stok eksideyse).'
  ]));

  const urunler = await cagir('uretim:uretilebilirler');
  if (!urunler.length) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      'Reçetesi olan ürün bulunamadı.'
    ]));
    return;
  }

  let secilen = null;
  const secilenYazi = el('div', { sinif: 'aciklama-kutu', metin: 'Ürün: henüz seçilmedi' });
  const miktarKutu = el('input', {
    type: 'number', sinif: 'miktar', step: '0.001', min: '0',
    placeholder: 'Boş = sıfıra kadar'
  });
  const uretDugme = el('button', { sinif: 'dugme-ana tehlike', metin: 'Üret' });
  uretDugme.disabled = !durum.yazmaAcik;

  uretDugme.addEventListener('click', async () => {
    if (!secilen) { bildir('Önce ürün seçin.', 'kotu'); return; }
    const miktar = miktarKutu.value === '' ? 0 : Number(miktarKutu.value);
    if (miktarKutu.value !== '' && !(miktar > 0)) {
      bildir('Miktar sıfırdan büyük olmalı.', 'kotu');
      return;
    }
    const onay = await window.galya.cagir('sistem:onay', {
      baslik: 'Üretim fişi yaz',
      mesaj: miktar
        ? `"${secilen.ad}" için ${sayiYaz(miktar, 3)} ${secilen.birim || ''} üretim fişi yazılacak.`
        : `"${secilen.ad}" stoğu sıfıra gelene kadar üretilecek (şu an ${sayiYaz(secilen.kalan, 2)}).`,
      detay:
        "Reçetedeki bileşenler stoktan düşer, mamul stoğa girer. Vega'da bir " +
        'üretim fişi ve buna bağlı belgeler oluşur. İşlem geri alınabilir.',
      evet: 'Üret',
      hayir: 'Vazgeç'
    });
    if (!onay.veri || !onay.veri.onay) return;
    try {
      uretDugme.disabled = true;
      const s = await cagir('uretim:uret', { stokNo: secilen.stokNo, miktar });
      bildir(`Üretim fişi yazıldı: ${s.fisNo} · ${s.mamulAdi} ${sayiYaz(s.miktar, 3)}`, 'iyi');
      ekranAc('uretim', { kip: 'manuel' });
    } catch (e) {
      hataGoster(e);
      uretDugme.disabled = false;
    }
  });

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: '1. Üretilecek ürün' }));
  icerik.appendChild(secilenYazi);
  icerik.appendChild(uretilebilirSecici(urunler, (u) => {
    secilen = u;
    secilenYazi.textContent =
      `Ürün: ${u.ad} · şu anki kalan ${sayiYaz(u.kalan, 2)} ${u.birim || ''} · ` +
      `${sayiYaz(u.receteSatiri)} bileşen`;
  }));

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: '2. Miktar' }));
  icerik.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', null, [el('label', { metin: 'Üretilecek miktar' }), miktarKutu]),
    uretDugme
  ]));
}

// --- Otomatik üretim -------------------------------------------------------
async function uretimOtomatikBolumu() {
  const adaylar = await cagir('uretim:adaylar');

  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'THIRD işaretli, reçetesi olan ve stoğu eksiye düşmüş ürünler. Üretim ' +
    'fişi yazıldığında reçetedeki bileşenler stoktan düşer, mamul stoğa girer ' +
    've kalan sıfıra gelir.'
  ]));

  if (durum.yazmaAcik) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu kritik' }, [
      "Üretim fişi Vega'da altı tabloya birden yazar (üretim fişi, iki depo " +
      'transferi, tüketim ve çıktı hareketleri). Üretim belge numarası Şefim ' +
      'entegrasyonuyla paylaşılan bir sayaçtan alınır; numara işlem içinde ' +
      'kilitlenerek verilir. Yoğun saatlerde tek tek üretmek daha güvenlidir.'
    ]));
  }

  if (durum.yazmaAcik && adaylar.length) {
    icerik.appendChild(el('div', { sinif: 'form-satir' }, [
      el('button', {
        sinif: 'dugme-ana',
        metin: `Hepsini sıfıra kadar üret (${adaylar.length} ürün)`,
        tikla: () => hepsiniUret(adaylar)
      })
    ]));
  }

  icerik.appendChild(tabloYap(
    ['Ürün', 'Birim', 'Kalan', 'Üretilecek', 'Reçete satırı', ''],
    adaylar,
    (a) => el('tr', null, [
      el('td', null, [
        el('div', { sinif: 'ad-satir', metin: a.ad }),
        a.kod ? el('div', { sinif: 'alt-not', metin: a.kod }) : null
      ]),
      hucre(a.birim || '—'),
      hucre(sayiYaz(a.kalan, 2), 'sayi eksi'),
      hucre(sayiYaz(a.uretilecek, 2), 'sayi arti'),
      hucre(sayiYaz(a.receteSatiri), 'sayi'),
      el('td', null, [el('button', {
        sinif: 'dugme-kucuk' + (durum.yazmaAcik ? ' tehlike' : ''),
        metin: 'Sıfıra kadar üret',
        disabled: !durum.yazmaAcik,
        tikla: () => tekUret(a)
      })])
    ])
  ));
}

async function uretimGecmisiBolumu() {
  const gecmis = await cagir('uretim:gecmis');
  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Yazılan üretim fişleri' }));
  icerik.appendChild(tabloYap(
    ['Tarih', 'Mamul', 'Miktar', 'Fiş no', 'Yapan', 'Durum', ''],
    gecmis,
    (g) => el('tr', null, [
      hucre(saatliTarih(g.tarih)),
      hucre(g.mamulAdi),
      hucre(sayiYaz(g.miktar, 2), 'sayi'),
      hucre(g.fisNo || '—'),
      hucre(g.kullanici || '—'),
      el('td', null, [
        g.geriAlindi
          ? el('span', { sinif: 'etiket gri', metin: 'Geri alındı' })
          : el('span', { sinif: 'etiket yesil', metin: 'Yazıldı' })
      ]),
      el('td', null, [
        g.geriAlindi || !durum.yazmaAcik
          ? null
          : el('button', {
              sinif: 'dugme-kucuk',
              metin: 'Geri al',
              tikla: () => uretimGeriAl(g)
            })
      ])
    ])
  ));
}

// Reçeteli ürünler arasından seçim. Liste 500 satıra kadar çıkabildiği için
// arama kutusundan süzülüyor.
function uretilebilirSecici(urunler, secildi) {
  const kap = el('div');
  const arama = el('input', { type: 'text', placeholder: 'Ürün adı veya kodu…' });
  const sonuc = el('div');

  function ciz(liste) {
    bosalt(sonuc);
    sonuc.appendChild(tabloYap(
      ['Ürün', 'Sınıf', 'Kalan', 'Bileşen', ''],
      liste,
      (u) => el('tr', null, [
        el('td', null, [
          el('div', { sinif: 'ad-satir', metin: u.ad }),
          u.kod ? el('div', { sinif: 'alt-not', metin: u.kod }) : null
        ]),
        hucre(u.sinif || '—'),
        hucre(sayiYaz(u.kalan, 2), 'sayi ' + (u.kalan < 0 ? 'eksi' : '')),
        hucre(sayiYaz(u.receteSatiri), 'sayi'),
        el('td', null, [el('button', {
          sinif: 'dugme-kucuk',
          metin: 'Seç',
          tikla: () => secildi(u)
        })])
      ]),
      50
    ));
  }

  arama.addEventListener('input', () => {
    const aranan = arama.value.trim().toLocaleLowerCase('tr');
    ciz(
      aranan
        ? urunler.filter(
            (u) =>
              (u.ad || '').toLocaleLowerCase('tr').includes(aranan) ||
              (u.kod || '').toLocaleLowerCase('tr').includes(aranan)
          )
        : urunler
    );
  });

  kap.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', { style: 'flex:1' }, [el('label', { metin: 'Ürün ara' }), arama])
  ]));
  kap.appendChild(sonuc);
  ciz(urunler);
  return kap;
}

async function tekUret(aday) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: 'Stoğu sıfıra kadar üret',
    mesaj: `"${aday.ad}" için ${sayiYaz(aday.uretilecek, 2)} ${aday.birim || ''} üretim fişi yazılacak.`,
    detay:
      "Reçetedeki bileşenler stoktan düşer, mamul stoğa girer. Vega'da bir " +
      'üretim fişi ve buna bağlı belgeler oluşur. İşlem geri alınabilir.',
    evet: 'Üret',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    const s = await cagir('uretim:uret', { stokNo: aday.stokNo });
    bildir(`Üretim fişi yazıldı: ${s.fisNo} · ${s.mamulAdi} ${sayiYaz(s.miktar, 2)}`, 'iyi');
    ekranAc('uretim', { kip: 'otomatik' });
  } catch (e) { hataGoster(e); }
}

async function hepsiniUret(adaylar) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: 'Hepsini sıfıra kadar üret',
    mesaj: `${adaylar.length} ürün için üretim fişi yazılacak.`,
    detay:
      'Her ürün için ayrı bir üretim fişi oluşur. Bir üründe hata çıkarsa ' +
      'diğerleri yazılmaya devam eder; sonuçta hangisinin yazılamadığı görünür.',
    evet: 'Hepsini üret',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    const s = await cagir('uretim:hepsiniUret');
    const hatalilar = s.sonuclar.filter((x) => !x.tamam);
    bildir(
      `${sayiYaz(s.yazilan)} üretim fişi yazıldı` +
      (s.hatali ? `, ${sayiYaz(s.hatali)} tanesi yazılamadı.` : '.'),
      s.hatali ? 'kotu' : 'iyi'
    );
    if (hatalilar.length) {
      katmanAc('Yazılamayan üretimler', tabloYap(
        ['Ürün', 'Miktar', 'Sebep'],
        hatalilar,
        (h) => el('tr', null, [
          hucre(h.ad),
          hucre(sayiYaz(h.miktar, 2), 'sayi'),
          hucre(h.mesaj || '')
        ])
      ));
    } else {
      ekranAc('uretim', { kip: 'otomatik' });
    }
  } catch (e) { hataGoster(e); }
}

async function uretimGeriAl(kayit) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: 'Üretim fişini geri al',
    mesaj: `${kayit.mamulAdi} — ${sayiYaz(kayit.miktar, 2)} üretimi silinecek.`,
    detay: 'Fişten doğan bütün belgeler silinir; stok miktarları üretim öncesine döner.',
    evet: 'Geri al',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    await cagir('uretim:geriAl', { id: kayit.id });
    bildir('Üretim fişi geri alındı.', 'iyi');
    ekranAc('uretim');
  } catch (e) { hataGoster(e); }
}


// ---------- MALİYETLENDİRME ----------
//
// Hammaddenin maliyeti son alış fiyatından, mamulünki reçeteden hesaplanır.
// "Karta yaz" TBLSTOKLAR.MALIYET alanını günceller — Vega'nın kendi
// maliyetlendirmesinin yaptığı iş de budur. İşlem geri alınabilir.

ekranlar.maliyetlendirme = async function (parametre) {
  const [sonuc, gecmis] = await Promise.all([
    cagir('maliyet:hesapla'),
    cagir('maliyet:gecmis')
  ]);

  const sadeceDegisen = parametre.tumu ? false : true;
  const arananMetin = (parametre.arama || '').trim().toLocaleLowerCase('tr');

  const liste = sonuc.satirlar.filter((s) => {
    if (sadeceDegisen && (s.yeniMaliyet == null || Math.abs(s.fark) <= 0.005)) return false;
    if (arananMetin && !(s.ad || '').toLocaleLowerCase('tr').includes(arananMetin)) return false;
    return true;
  });

  const secilenler = new Set();

  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Maliyetlendirme', disaAktarDugmeleri(() => ({
    baslik: 'Maliyetlendirme — son alış fiyatına göre',
    sayfaAdi: 'Maliyet',
    sutunlar: [
      { ad: 'Ürün', alan: 'ad', tur: 'metin', genislik: 42 },
      { ad: 'Stok kodu', alan: 'kod', tur: 'metin', genislik: 16 },
      { ad: 'Birim', alan: 'birim', tur: 'metin', genislik: 10 },
      { ad: 'Kart maliyeti', alan: 'kartMaliyeti', tur: 'para', genislik: 16 },
      { ad: 'Son alış fiyatı', alan: 'sonAlisFiyati', tur: 'para', genislik: 16 },
      { ad: 'Hesaplanan', alan: 'yeniMaliyet', tur: 'para', genislik: 16 },
      { ad: 'Fark', alan: 'fark', tur: 'para', genislik: 14 },
      { ad: 'Kaynak', alan: 'kaynakAdi', tur: 'metin', genislik: 24 }
    ],
    satirlar: liste
  }))));

  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Hammaddenin maliyeti son alış faturasındaki birim fiyattan, mamulünki ' +
    'reçetesindeki bileşenlerin maliyet toplamından hesaplanır. ' +
    (durum.yazmaAcik
      ? 'Yazma açık: hesaplanan maliyet stok kartına işlenebilir, işlem geri alınabilir.'
      : "Vega'ya yazma kapalı olduğu için şimdilik yalnızca hesap gösteriliyor.")
  ]));

  icerik.appendChild(el('div', { sinif: 'ozet-serit' }, [
    ozetKarti('Hesaplanan ürün', sayiYaz(sonuc.satirlar.length)),
    ozetKarti('Maliyeti değişecek', sayiYaz(sonuc.degisecek)),
    ozetKarti('Listede görünen', sayiYaz(liste.length))
  ]));

  const aramaKutu = el('input', { type: 'text', placeholder: 'Ürün ara…', value: parametre.arama || '' });
  let zaman = null;
  aramaKutu.addEventListener('input', () => {
    clearTimeout(zaman);
    zaman = setTimeout(() => {
      ekranAc('maliyetlendirme', Object.assign({}, parametre, { arama: aramaKutu.value }));
    }, 350);
  });

  icerik.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', { style: 'flex:1' }, [el('label', { metin: 'Ara' }), aramaKutu]),
    el('button', {
      sinif: 'dugme-sade',
      metin: sadeceDegisen ? 'Bütün ürünleri göster' : 'Sadece değişecekleri göster',
      tikla: () => ekranAc('maliyetlendirme', Object.assign({}, parametre, { tumu: sadeceDegisen }))
    })
  ]));

  if (durum.yazmaAcik) {
    icerik.appendChild(el('div', { sinif: 'form-satir' }, [
      el('button', {
        sinif: 'dugme-ana',
        metin: 'Listedekilerin maliyetini karta yaz',
        tikla: () => maliyetYaz(liste.map((s) => s.stokNo), liste.length)
      }),
      el('button', {
        sinif: 'dugme-sade',
        metin: 'Sadece işaretlediklerimi yaz',
        tikla: () => {
          if (!secilenler.size) { bildir('Önce satır işaretleyin.', 'kotu'); return; }
          maliyetYaz([...secilenler], secilenler.size);
        }
      })
    ]));
  }

  icerik.appendChild(tabloYap(
    ['', 'Ürün', 'Birim', 'Kart maliyeti', 'Son alış', 'Hesaplanan', 'Fark', 'Kaynak'],
    liste,
    (s) => {
      const kutu = el('input', { type: 'checkbox' });
      kutu.addEventListener('change', () => {
        if (kutu.checked) secilenler.add(s.stokNo);
        else secilenler.delete(s.stokNo);
      });
      return el('tr', null, [
        el('td', null, [durum.yazmaAcik ? kutu : el('span', { metin: '' })]),
        el('td', null, [
          el('div', { sinif: 'ad-satir', metin: s.ad }),
          s.mamulMu ? el('div', { sinif: 'alt-not', metin: 'Mamul — reçeteden' }) : null
        ]),
        hucre(s.birim || '—'),
        hucre(paraYaz(s.kartMaliyeti), 'sayi'),
        hucre(s.sonAlisFiyati == null ? '—' : paraYaz(s.sonAlisFiyati), 'sayi'),
        hucre(s.yeniMaliyet == null ? '—' : paraYaz(s.yeniMaliyet), 'sayi'),
        hucre(
          s.fark == null ? '—' : paraYaz(s.fark),
          'sayi ' + (s.fark < 0 ? 'eksi' : s.fark > 0 ? 'arti' : '')
        ),
        hucre(s.kaynakAdi)
      ]);
    },
    1000
  ));

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Geçmiş maliyetlendirmeler' }));
  icerik.appendChild(tabloYap(
    ['Tarih', 'Yapan', 'Ürün', 'Durum', ''],
    gecmis,
    (g) => el('tr', null, [
      hucre(saatliTarih(g.tarih)),
      hucre(g.kullanici || '—'),
      hucre(sayiYaz(g.urunSayisi), 'sayi'),
      el('td', null, [
        g.geriAlindi
          ? el('span', { sinif: 'etiket gri', metin: 'Geri alındı' })
          : el('span', { sinif: 'etiket yesil', metin: 'Yazıldı' })
      ]),
      el('td', null, [
        g.geriAlindi || !durum.yazmaAcik
          ? null
          : el('button', {
              sinif: 'dugme-kucuk',
              metin: 'Geri al',
              tikla: () => maliyetGeriAl(g)
            })
      ])
    ])
  ));
};

async function maliyetYaz(stokNolar, adet) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: 'Maliyeti karta yaz',
    mesaj: `${adet} ürünün maliyeti stok kartına yazılacak.`,
    detay:
      'Stok kartındaki MALIYET alanı güncellenir (Vega maliyetlendirmesinin ' +
      'yaptığı işlemin aynısı). Stok hareketi, envanter ve cari değişmez. ' +
      'İşlem tek tuşla geri alınabilir.',
    evet: 'Yaz',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    const s = await cagir('maliyet:yaz', { stokNolar });
    bildir(s.yazilan ? `${sayiYaz(s.yazilan)} ürünün maliyeti güncellendi.` : s.mesaj, 'iyi');
    ekranAc('maliyetlendirme');
  } catch (e) { hataGoster(e); }
}

async function maliyetGeriAl(kayit) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: 'Maliyetlendirmeyi geri al',
    mesaj: `${kayit.urunSayisi} ürünün maliyeti eski değerine döndürülecek.`,
    evet: 'Geri al',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    await cagir('maliyet:geriAl', { kayitId: kayit.id });
    bildir('Maliyetlendirme geri alındı.', 'iyi');
    ekranAc('maliyetlendirme');
  } catch (e) { hataGoster(e); }
}

// ---------- CARİ ----------

const CARI_SUZGECLERI = [
  { anahtar: 'tumu', ad: 'Bakiyesi olanlar', not: 'Sıfır olmayan bütün cariler' },
  { anahtar: 'borclu', ad: 'Bize borçlu', not: 'Bakiyesi artı olanlar' },
  { anahtar: 'alacakli', ad: 'Bizim borcumuz', not: 'Bakiyesi eksi olanlar' },
  { anahtar: 'hepsi', ad: 'Bütün cariler', not: 'Bakiyesi sıfır olanlar dahil', hepsi: true }
];

ekranlar.cari = async function (parametre) {
  const suzgec = parametre.suzgec || 'tumu';
  const secili = CARI_SUZGECLERI.find((s) => s.anahtar === suzgec) || CARI_SUZGECLERI[0];
  const ham = await cagir('cari:bakiye', { hepsi: secili.hepsi ? 1 : 0 });

  const arananMetin = (parametre.arama || '').trim().toLocaleLowerCase('tr');
  const enAz = parametre.enAz != null && parametre.enAz !== '' ? Number(parametre.enAz) : null;

  const liste = ham.filter((c) => {
    if (suzgec === 'borclu' && !(Number(c.bakiye) > 0)) return false;
    if (suzgec === 'alacakli' && !(Number(c.bakiye) < 0)) return false;
    if (enAz != null && Math.abs(Number(c.bakiye)) < enAz) return false;
    if (arananMetin) {
      const ad = (c.ad || '').toLocaleLowerCase('tr');
      const kod = (c.kod || '').toLocaleLowerCase('tr');
      if (!ad.includes(arananMetin) && !kod.includes(arananMetin)) return false;
    }
    return true;
  });

  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Cari bakiye', disaAktarDugmeleri(() => ({
    baslik: 'Cari bakiye listesi — ' + secili.ad,
    sayfaAdi: 'Cari',
    sutunlar: [
      { ad: 'Cari kodu', alan: 'kod', tur: 'metin', genislik: 16 },
      { ad: 'Cari', alan: 'ad', tur: 'metin', genislik: 46 },
      { ad: 'Borç', alan: 'borc', tur: 'para', genislik: 16 },
      { ad: 'Alacak', alan: 'alacak', tur: 'para', genislik: 16 },
      { ad: 'Bakiye', alan: 'bakiye', tur: 'para', genislik: 16 }
    ],
    satirlar: liste
  }))));

  const seritler = el('div', { sinif: 'suzgec-serit' });
  for (const s of CARI_SUZGECLERI) {
    seritler.appendChild(el('button', {
      sinif: 'suzgec' + (s.anahtar === suzgec ? ' etkin' : ''),
      title: s.not,
      tikla: () => ekranAc('cari', { suzgec: s.anahtar, arama: parametre.arama, enAz: parametre.enAz })
    }, [el('span', { sinif: 'suzgec-ad', metin: s.ad })]));
  }
  icerik.appendChild(seritler);

  const aramaKutu = el('input', { type: 'text', placeholder: 'Cari adı veya kodu…', value: parametre.arama || '' });
  const enAzKutu = el('input', { type: 'number', sinif: 'miktar', placeholder: '0', value: parametre.enAz != null ? String(parametre.enAz) : '' });

  let zaman = null;
  function tazele() {
    ekranAc('cari', {
      suzgec,
      arama: aramaKutu.value,
      enAz: enAzKutu.value === '' ? undefined : Number(enAzKutu.value)
    });
  }
  aramaKutu.addEventListener('input', () => {
    clearTimeout(zaman);
    zaman = setTimeout(tazele, 350);
  });
  enAzKutu.addEventListener('keydown', (e) => { if (e.key === 'Enter') tazele(); });

  icerik.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', { style: 'flex:1' }, [el('label', { metin: 'Ara' }), aramaKutu]),
    el('div', null, [el('label', { metin: 'Bakiyesi en az (TL)' }), enAzKutu]),
    el('button', { sinif: 'dugme-sade', metin: 'Uygula', tikla: tazele })
  ]));

  const toplam = liste.reduce((t, c) => t + Number(c.bakiye || 0), 0);
  const borclu = liste.filter((c) => Number(c.bakiye) > 0).length;
  icerik.appendChild(el('div', { sinif: 'ozet-serit' }, [
    ozetKarti('Listedeki cari', sayiYaz(liste.length)),
    ozetKarti('Bize borçlu', sayiYaz(borclu)),
    ozetKarti('Net bakiye', paraYaz(toplam) + ' TL')
  ]));

  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Artı bakiye bizim alacağımız, eksi bakiye bizim borcumuzdur.'
  ]));

  icerik.appendChild(tabloYap(
    ['Cari kodu', 'Cari', 'Borç', 'Alacak', 'Bakiye'],
    liste,
    (c) => el('tr', null, [
      hucre(c.kod || '—'),
      hucre(c.ad || c.kod),
      hucre(paraYaz(c.borc), 'sayi'),
      hucre(paraYaz(c.alacak), 'sayi'),
      hucre(paraYaz(c.bakiye), 'sayi ' + (c.bakiye < 0 ? 'eksi' : 'arti'))
    ]),
    1000
  ));
};

// ---------- KULLANICILAR (yönetici paneli) ----------
//
// Giriş yalnızca PIN'le olduğu için PIN'ler benzersiz olmak zorunda; aynı
// PIN'i ikinci bir kullanıcıya verirseniz ana süreç reddeder.
//
// Sayım kapsamı stok kartındaki Sınıf (KOD2) alanına dayanıyor: "BAR"
// seçilen kullanıcı yalnızca bar ürünlerini görür ve sayabilir. Kapsam boş
// bırakılırsa sınırsızdır.

ekranlar.kullanicilar = async function () {
  const [liste, kodListeleri] = await Promise.all([
    cagir('kullanici:liste'),
    cagir('stok:kodListeleri').catch(() => ({}))
  ]);
  const siniflar = ((kodListeleri && kodListeleri.kod2) || []).filter((s) => s.adet > 0);

  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Kullanıcılar', [
    el('button', {
      sinif: 'dugme-ana',
      metin: 'Yeni kullanıcı',
      tikla: () => kullaniciPenceresi(null, siniflar)
    })
  ], true));

  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Çalışan PIN\'ini yazarak giriş yapar; kullanıcı adı seçmesi gerekmez. ' +
    'Her PIN farklı olmalı. Yaptığı her iş adına kaydedilir. ' +
    'Sayım kapsamı verirseniz kullanıcı yalnızca o sınıftaki ürünleri görür ' +
    've sayabilir.'
  ]));

  if (!liste.length) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      'Henüz kullanıcı tanımlanmamış. Kullanıcı yokken program eskisi gibi ' +
      'herkese açıktır: giriş sorulmaz, her ekran görünür. İlk kullanıcıyı ' +
      'YÖNETİCİ olarak ekleyin, yoksa kendinizi dışarıda bırakırsınız.'
    ]));
  }

  icerik.appendChild(tabloYap(
    ['Ad', 'Rol', 'Yetkiler', 'Sayım kapsamı', 'Durum', ''],
    liste,
    (k) => el('tr', null, [
      el('td', null, [
        el('div', { sinif: 'ad-satir', metin: k.ad }),
        k.acikOturum ? el('div', { sinif: 'alt-not', metin: 'Bu bilgisayarda açık' }) : null
      ]),
      el('td', null, [
        el('span', {
          sinif: 'etiket ' + (k.rol === 'yonetici' ? 'mavi' : 'gri'),
          metin: k.rol === 'yonetici' ? 'Yönetici' : 'Kullanıcı'
        })
      ]),
      hucre(
        k.rol === 'yonetici'
          ? 'Hepsi'
          : (durum.yetkiTanimlari || [])
              .filter((y) => k.yetkiler[y.anahtar])
              .map((y) => y.ad)
              .join(', ') || '—'
      ),
      hucre(
        k.rol === 'yonetici'
          ? 'Sınırsız'
          : (k.yetkiler.siniflar || []).join(', ') || 'Sınırsız'
      ),
      el('td', null, [
        k.aktif
          ? el('span', { sinif: 'etiket yesil', metin: 'Aktif' })
          : el('span', { sinif: 'etiket gri', metin: 'Kapalı' })
      ]),
      el('td', null, [
        el('button', {
          sinif: 'dugme-kucuk',
          metin: 'Düzenle',
          tikla: () => kullaniciPenceresi(k, siniflar)
        }),
        el('button', {
          sinif: 'dugme-kucuk',
          style: 'margin-left:6px',
          metin: 'Sil',
          tikla: () => kullaniciSil(k)
        })
      ])
    ])
  ));

  if (liste.length) {
    icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Kilidi kaldır' }));
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      'Bütün kullanıcıları silip programı herkese açık hâline döndürür. ' +
      'Giriş sorulmaz, her ekran görünür, sayımda Vega miktarı herkese açılır.'
    ]));
    icerik.appendChild(el('div', { sinif: 'form-satir' }, [
      el('button', {
        sinif: 'dugme-sade',
        metin: 'Kullanıcı sistemini tamamen kaldır',
        tikla: async () => {
          const onay = await window.galya.cagir('sistem:onay', {
            baslik: 'Kullanıcı sistemini kaldır',
            mesaj: `${liste.length} kullanıcının hepsi silinecek.`,
            detay:
              'Program giriş sormayan eski hâline döner ve sayımda Vega\'daki ' +
              'miktar herkese görünür. Geri almak için kullanıcıları yeniden ' +
              'tanımlamanız gerekir.',
            evet: 'Kaldır',
            hayir: 'Vazgeç'
          });
          if (!onay.veri || !onay.veri.onay) return;
          try {
            await cagir('oturum:pinKaldir', {});
            await oturumDurumuOku();
            bildir('Kullanıcı sistemi kaldırıldı.', 'iyi');
            ekranAc('ana');
          } catch (e) { hataGoster(e); }
        }
      })
    ]));
  }
};

async function kullaniciSil(k) {
  const onay = await window.galya.cagir('sistem:onay', {
    baslik: 'Kullanıcıyı sil',
    mesaj: `"${k.ad}" silinecek.`,
    detay:
      'Geçmiş kayıtlarda adı durmaya devam eder; yalnızca bundan sonra giriş ' +
      'yapamaz. Son yöneticiyi silemezsiniz.',
    evet: 'Sil',
    hayir: 'Vazgeç'
  });
  if (!onay.veri || !onay.veri.onay) return;
  try {
    await cagir('kullanici:sil', { id: k.id });
    bildir('Kullanıcı silindi.', 'iyi');
    await oturumDurumuOku();
    ekranAc('kullanicilar');
  } catch (e) { hataGoster(e); }
}

function kullaniciPenceresi(mevcut, siniflar) {
  const kap = el('div');
  const adKutu = el('input', { type: 'text', value: mevcut ? mevcut.ad : '' });
  const pinKutu = el('input', {
    type: 'password',
    placeholder: mevcut ? 'Değiştirmek istemiyorsanız boş bırakın' : 'PIN'
  });
  const rolKutu = el('select', { sinif: 'form' }, [
    el('option', { value: 'kullanici', metin: 'Kullanıcı — yalnızca verilen yetkiler' }),
    el('option', { value: 'yonetici', metin: 'Yönetici — her şey, onay ve kullanıcı yönetimi' })
  ]);
  rolKutu.value = mevcut ? mevcut.rol : 'kullanici';

  const aktifKutu = el('input', { type: 'checkbox' });
  aktifKutu.checked = mevcut ? !!mevcut.aktif : true;

  // Yetki kutuları
  const yetkiKutulari = {};
  const yetkiSatirlari = (durum.yetkiTanimlari || []).map((y) => {
    const kutu = el('input', { type: 'checkbox' });
    kutu.checked = !!(mevcut && mevcut.yetkiler && mevcut.yetkiler[y.anahtar]);
    yetkiKutulari[y.anahtar] = kutu;
    return el('div', null, [el('label', null, [kutu, ' ' + y.ad])]);
  });

  // Sayım kapsamı: stok kartındaki Sınıf (KOD2) değerleri.
  const secilenSiniflar = new Set(
    (mevcut && mevcut.yetkiler && mevcut.yetkiler.siniflar) || []
  );
  const sinifKutulari = {};
  const sinifSatirlari = siniflar.map((s) => {
    const kutu = el('input', { type: 'checkbox' });
    kutu.checked = secilenSiniflar.has(s.deger);
    sinifKutulari[s.deger] = kutu;
    return el('div', null, [
      el('label', null, [kutu, ` ${s.deger} (${sayiYaz(s.adet)} ürün)`])
    ]);
  });

  // Rol yönetici seçilince yetki ve kapsam kutuları anlamsızlaşıyor.
  const yetkiBolumu = el('div');
  const kapsamBolumu = el('div');
  function rolDegisti() {
    const yoneticiMi = rolKutu.value === 'yonetici';
    yetkiBolumu.classList.toggle('hidden', yoneticiMi);
    kapsamBolumu.classList.toggle('hidden', yoneticiMi);
  }
  rolKutu.addEventListener('change', rolDegisti);

  kap.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', { style: 'flex:1' }, [el('label', { metin: 'Ad' }), adKutu]),
    el('div', null, [el('label', { metin: 'PIN' }), pinKutu])
  ]));
  kap.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', { style: 'flex:1' }, [el('label', { metin: 'Rol' }), rolKutu]),
    el('label', null, [aktifKutu, ' Aktif'])
  ]));

  yetkiBolumu.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Yetkiler' }));
  yetkiBolumu.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'İşaretlenmeyen iş için kullanıcı düğmeyi göremez; görse de ana süreç ' +
    'isteği reddeder.'
  ]));
  yetkiBolumu.appendChild(el('div', { sinif: 'form-satir' }, yetkiSatirlari));
  kap.appendChild(yetkiBolumu);

  kapsamBolumu.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Sayım kapsamı' }));
  kapsamBolumu.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Stok kartındaki Sınıf alanı. Örneğin yalnızca BAR işaretlerseniz, bu ' +
    'kullanıcı sayım ekranında sadece bar ürünlerini görür ve yalnızca ' +
    'onları sayabilir. Hiçbiri işaretlenmezse kapsam sınırsızdır.'
  ]));
  kapsamBolumu.appendChild(
    sinifSatirlari.length
      ? el('div', { sinif: 'form-satir' }, sinifSatirlari)
      : el('div', { sinif: 'bos-mesaj', metin: 'Stok kartlarında sınıf tanımlı değil.' })
  );
  kap.appendChild(kapsamBolumu);

  const kaydet = el('button', { sinif: 'dugme-ana', metin: 'Kaydet' });
  kaydet.addEventListener('click', async () => {
    const ad = adKutu.value.trim();
    if (!ad) { bildir('Ad boş olamaz.', 'kotu'); return; }
    if (!mevcut && !pinKutu.value.trim()) {
      bildir('Yeni kullanıcı için PIN belirleyin.', 'kotu');
      return;
    }
    const yetkiler = { siniflar: [] };
    for (const anahtar of Object.keys(yetkiKutulari)) {
      yetkiler[anahtar] = yetkiKutulari[anahtar].checked;
    }
    for (const deger of Object.keys(sinifKutulari)) {
      if (sinifKutulari[deger].checked) yetkiler.siniflar.push(deger);
    }
    try {
      await cagir('kullanici:kaydet', {
        id: mevcut ? mevcut.id : 0,
        ad,
        pin: pinKutu.value.trim(),
        rol: rolKutu.value,
        aktif: aktifKutu.checked,
        yetkiler
      });
      katmanKapat();
      bildir(mevcut ? 'Kullanıcı güncellendi.' : 'Kullanıcı eklendi.', 'iyi');
      await oturumDurumuOku();
      ekranAc('kullanicilar');
    } catch (e) { hataGoster(e); }
  });

  kap.appendChild(el('div', { sinif: 'form-satir', style: 'margin-top:16px' }, [
    kaydet,
    el('button', { sinif: 'dugme-sade', metin: 'Vazgeç', tikla: katmanKapat })
  ]));

  rolDegisti();
  katmanAc(mevcut ? 'Kullanıcıyı düzenle' : 'Yeni kullanıcı', kap);
  setTimeout(() => adKutu.focus(), 50);
}

// ---------- AYARLAR ----------

// Ayarlar ekranındaki PIN bölümü.
//
// PIN yalnızca SAYIM ekranındaki teorik miktarı, farkı ve geçmiş sayımları
// kilitler. Programın geri kalanı eskisi gibi herkese açıktır.
function pinBolumu() {
  const kap = el('div');
  const yeni = el('input', { type: 'password', placeholder: 'PIN' });

  // Tek yönetici PIN'i yerini kullanıcı listesine bıraktı. Bu bölüm artık
  // yalnızca İLK yöneticiyi açmak için duruyor; gerisi Kullanıcılar ekranında.
  if (durum.pinVar) {
    kap.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
      'Kullanıcı sistemi açık. Kim neyi yapabilir, kim neyi sayabilir — hepsi ' +
      '"Kullanıcılar" ekranından yönetiliyor. Program kapanınca oturum ' +
      'kendiliğinden kapanır.'
    ]));
    kap.appendChild(el('div', { sinif: 'form-satir' }, [
      el('button', {
        sinif: 'dugme-ana',
        metin: 'Kullanıcılar ekranını aç',
        tikla: () => ekranAc('kullanicilar')
      })
    ]));
    kap.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
      "PIN uzunluk sınırı yoktur; tek hane de yazılabilir. Kısa PIN'de art arda " +
      'beş yanlış denemeden sonra program 30 saniye bekletir. Not: PIN ekranı ' +
      'kilitler, veritabanını kilitlemez — bilgisayara erişimi olan biri ayar ' +
      'dosyasındaki SQL şifresiyle veriye başka programlardan ulaşabilir.'
    ]));
    return kap;
  }

  kap.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
    'Kullanıcı tanımlı DEĞİL. Program şu anda herkese açık: giriş sorulmuyor, ' +
    "sayım ekranını açan herkes Vega'daki miktarı görüyor. Aşağıdan bir " +
    "yönetici PIN'i belirleyin; sonrasında alt kullanıcıları \"Kullanıcılar\" " +
    'ekranından ekleyebilirsiniz.'
  ]));

  kap.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', null, [el('label', { metin: "Yönetici PIN'i" }), yeni])
  ]));

  const kaydet = el('button', { sinif: 'dugme-ana', metin: 'Yöneticiyi oluştur' });
  kaydet.addEventListener('click', async () => {
    const deger = yeni.value.trim();
    if (!deger) {
      bildir('PIN boş olamaz.', 'kotu');
      return;
    }
    try {
      await cagir('oturum:pinBelirle', { pin: deger });
      await oturumDurumuOku();
      bildir('Yönetici oluşturuldu. Alt kullanıcıları Kullanıcılar ekranından ekleyin.', 'iyi');
      ekranAc('kullanicilar');
    } catch (e) { hataGoster(e); }
  });

  kap.appendChild(el('div', { sinif: 'form-satir' }, [kaydet]));
  return kap;
}

ekranlar.ayarlar = async function () {
  const a = await cagir('ayar:oku');
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Ayarlar'));

  // Ayar yazma yönetici kanalı. Düğmeler duruyor ama basılınca ana süreç
  // reddeder; kullanıcı sebebini baştan bilsin.
  if (!yonetici()) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      'Ayarları yalnızca yönetici değiştirebilir. Buradaki bilgileri ' +
      'görebilirsiniz ama kaydedemezsiniz.'
    ]));
  }

  const sunucu = el('input', { type: 'text', value: a.sunucu || '' });
  const port = el('input', { type: 'number', value: a.port || 1433 });
  const kullanici = el('input', { type: 'text', value: a.kullanici || '' });
  const sifre = el('input', { type: 'password', placeholder: a.sifreVar ? '(kayıtlı, değiştirmek için yazın)' : '' });
  const windowsGirisi = el('select', { sinif: 'form' }, [
    el('option', { value: 'hayir', metin: 'SQL kullanıcı adı ve şifresi' }),
    el('option', { value: 'evet', metin: 'Windows oturumu' })
  ]);
  windowsGirisi.value = a.windowsGirisi ? 'evet' : 'hayir';

  const kritikUst = el('input', { type: 'number', value: a.kritikStokUst });

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'SQL bağlantısı' }));
  icerik.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', null, [el('label', { metin: 'Sunucu adı veya IP' }), sunucu]),
    el('div', null, [el('label', { metin: 'Port' }), port]),
    el('div', null, [el('label', { metin: 'Giriş şekli' }), windowsGirisi])
  ]));
  icerik.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', null, [el('label', { metin: 'SQL kullanıcı adı' }), kullanici]),
    el('div', null, [el('label', { metin: 'SQL şifresi' }), sifre])
  ]));

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Uyarı eşiği' }));
  icerik.appendChild(el('div', { sinif: 'form-satir' }, [
    el('div', null, [el('label', { metin: 'Kaç adedin altı "azalan" sayılsın' }), kritikUst])
  ]));

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Yönetici PIN\'i' }));
  icerik.appendChild(pinBolumu());

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: "Vega'ya yazma" }));
  icerik.appendChild(el('div', {
    sinif: 'aciklama-kutu ' + (a.vegayaYazmaAktif ? 'kritik' : '')
  }, [
    a.vegayaYazmaAktif
      ? "AÇIK — program Vega veritabanına kayıt yazabilir. Yedeğinizin güncel olduğundan emin olun."
      : "KAPALI — program Vega veritabanına hiçbir şey yazmaz. Sayım, tutanak ve eşleştirme " +
        "kayıtları panelin kendi veritabanında tutulur. Açmadan önce Vega yetkilisiyle " +
        "belge yazma yöntemini teyit edin ve VEGADB yedeği alın."
  ]));

  const yazmaDugme = el('button', {
    sinif: 'dugme-sade',
    metin: a.vegayaYazmaAktif ? "Vega'ya yazmayı kapat" : "Vega'ya yazmayı aç"
  });
  yazmaDugme.addEventListener('click', async () => {
    const acilacak = !a.vegayaYazmaAktif;
    if (acilacak) {
      const onay = await window.galya.cagir('sistem:onay', {
        baslik: "Vega'ya yazmayı aç",
        mesaj: 'Program bundan sonra Vega veritabanına kayıt yazabilecek.',
        detay: 'Önce VEGADB yedeğini aldığınızdan ve işlemi test firmasında denediğinizden emin olun.',
        evet: 'Açmayı onaylıyorum',
        hayir: 'Vazgeç'
      });
      if (!onay.veri || !onay.veri.onay) return;
    }
    try {
      await cagir('ayar:yaz', { vegayaYazmaAktif: acilacak });
      durum.yazmaAcik = acilacak;
      bildir(acilacak ? "Vega'ya yazma açıldı." : "Vega'ya yazma kapatıldı.", 'iyi');
      ekranAc('ayarlar');
      uyariSeridiGuncelle();
    } catch (e) { hataGoster(e); }
  });
  icerik.appendChild(el('div', { sinif: 'form-satir' }, [yazmaDugme]));

  const kaydet = el('button', { sinif: 'dugme-ana', metin: 'Ayarları kaydet' });
  kaydet.addEventListener('click', async () => {
    try {
      await cagir('ayar:yaz', {
        sunucu: sunucu.value.trim(),
        port: Number(port.value) || 1433,
        windowsGirisi: windowsGirisi.value === 'evet',
        kullanici: kullanici.value.trim(),
        sifre: sifre.value,
        kritikStokUst: Number(kritikUst.value) || 5
      });
      bildir('Ayarlar kaydedildi. Bağlantı yenileniyor…', 'iyi');
      await baslat();
    } catch (e) { hataGoster(e); }
  });

  const test = el('button', { sinif: 'dugme-sade', metin: 'Bağlantıyı dene' });
  test.addEventListener('click', async () => {
    try {
      const s = await cagir('baglanti:test');
      bildir(`Bağlantı başarılı: ${s.sunucu} / ${s.veritabani}`, 'iyi');
    } catch (e) { hataGoster(e); }
  });

  icerik.appendChild(el('div', { sinif: 'form-satir', style: 'margin-top:20px' }, [kaydet, test,
    el('button', {
      sinif: 'dugme-sade',
      metin: 'Ayar dosyasını göster',
      tikla: () => window.galya.cagir('sistem:klasorAc')
    })
  ]));

  icerik.appendChild(el('div', { sinif: 'aciklama-kutu', style: 'margin-top:20px' }, [
    'Ayar dosyası: ' + (a.dosyaYolu || '')
  ]));
};

// ---------- Üst bar ----------

function uyariSeridiGuncelle() {
  if (durum.yazmaAcik) {
    uyariSeridi.textContent =
      "Vega'ya yazma AÇIK — bu bilgisayardan yapılan işlemler Vega veritabanını değiştirebilir.";
    uyariSeridi.className = 'kritik';
    uyariSeridi.classList.remove('hidden');
  } else {
    uyariSeridi.classList.add('hidden');
  }
}

function firmaSeciciDoldur() {
  const fs = document.getElementById('firmaSecici');
  const ds = document.getElementById('donemSecici');
  bosalt(fs);
  for (const f of durum.firmalar) {
    fs.appendChild(el('option', { value: f.kod, metin: f.kisaAd }));
  }
  fs.value = durum.firma;

  function donemDoldur() {
    const f = durum.firmalar.find((x) => x.kod === fs.value);
    bosalt(ds);
    if (!f) return;
    for (const b of f.donemBilgi) {
      const etiket = b.sonTarih
        ? `${b.donem} — son ${tarihYaz(b.sonTarih)}`
        : `${b.donem} — hareket yok`;
      ds.appendChild(el('option', { value: b.donem, metin: etiket }));
    }
    ds.value = durum.donem && f.donemler.includes(durum.donem) ? durum.donem : f.varsayilanDonem;
  }
  donemDoldur();

  fs.onchange = () => {
    durum.firma = fs.value;
    const f = durum.firmalar.find((x) => x.kod === fs.value);
    durum.donem = f ? f.varsayilanDonem : null;
    donemDoldur();
    ekranAc('ana');
  };
  ds.onchange = () => {
    durum.donem = ds.value;
    ekranAc(durum.ekran);
  };
}

function depoSeciciDoldur() {
  const s = document.getElementById('depoSecici');
  bosalt(s);
  s.appendChild(el('option', { value: '0', metin: 'Tüm depolar' }));
  for (const d of durum.depolar) {
    s.appendChild(el('option', { value: String(d.no), metin: d.ad || ('Depo ' + d.no) }));
  }
  s.value = String(durum.depo);
  s.onchange = () => {
    durum.depo = Number(s.value);
    ekranAc(durum.ekran);
  };
}

// ---------- Başlangıç ----------

async function baslat() {
  durumRozet.textContent = 'Bağlanıyor…';
  durumRozet.className = 'rozet rozet-bekle';
  yukleniyorGoster('Veritabanına bağlanılıyor…');

  try {
    await cagir('baglanti:test');
  } catch (e) {
    durumRozet.textContent = 'Bağlantı yok';
    durumRozet.className = 'rozet rozet-kotu';
    bosalt(icerik);
    icerik.appendChild(ekranBasligi('Bağlantı kurulamadı', null, false));
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu kritik', metin: e.message }));
    icerik.appendChild(el('div', { sinif: 'form-satir' }, [
      el('button', { sinif: 'dugme-ana', metin: 'Ayarları aç', tikla: () => ekranAc('ayarlar') })
    ]));
    return;
  }

  try {
    await cagir('panel:kur');
  } catch (e) {
    bildir('Panel veritabanı hazırlanamadı: ' + e.message, 'kotu');
  }

  // Rol, firma/depo listelerinden ÖNCE okunmalı: ekranlar buna göre çiziliyor.
  await oturumDurumuOku();

  try {
    const [firmalar, depolar, ayar, yazmaDurum] = await Promise.all([
      cagir('firma:liste', { yenile: true }),
      cagir('depo:liste'),
      cagir('ayar:oku'),
      cagir('yazma:durum')
    ]);
    durum.firmalar = firmalar;
    durum.depolar = depolar;
    durum.yazmaAcik = !!yazmaDurum.acik;

    const varsayilan = firmalar.find((f) => f.kod === ayar.varsayilanFirma) || firmalar[0];
    if (!varsayilan) throw new Error('Vega veritabanında firma bulunamadı.');
    durum.firma = varsayilan.kod;
    durum.donem = varsayilan.donemler.includes(ayar.varsayilanDonem)
      ? ayar.varsayilanDonem
      : varsayilan.varsayilanDonem;
    durum.depo = Number(ayar.varsayilanDepo) || 0;

    firmaSeciciDoldur();
    depoSeciciDoldur();
    uyariSeridiGuncelle();

    durumRozet.textContent = 'Bağlı';
    durumRozet.className = 'rozet rozet-iyi';
    await ekranAc('ana');
  } catch (e) {
    hataGoster(e);
    bosalt(icerik);
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu kritik', metin: e.message }));
  }
}

// ---------- Sürüm ve güncelleme ----------

function guncellemeRozetiYaz(d) {
  const rozet = document.getElementById('guncellemeRozet');
  if (!d || d.durum === 'guncel' || d.durum === 'bilinmiyor' || d.durum === 'kapali') {
    rozet.classList.add('hidden');
    return;
  }
  rozet.textContent = d.mesaj || '';
  rozet.classList.remove('hidden');
}

window.galya.dinle('guncelleme:durum', guncellemeRozetiYaz);

(async () => {
  try {
    const cevap = await window.galya.cagir('sistem:surum');
    if (cevap.tamam) {
      document.getElementById('surumYazi').textContent = 'v' + cevap.veri.surum;
    }
  } catch (e) { /* sürüm gösterilemezse sorun değil */ }
})();

document.getElementById('yenileDugme').addEventListener('click', () => ekranAc(durum.ekran));
document.getElementById('ayarDugme').addEventListener('click', () => ekranAc('ayarlar'));
document.getElementById('girisDugme').addEventListener('click', () => {
  // Giriş yapılmışsa çıkış, yapılmamışsa giriş. Kullanıcı tanımlı değilken
  // düğme zaten gizli.
  if (durum.kullaniciAdi) oturumdanCik();
  else girisPenceresi();
});
document.getElementById('katmanKapat').addEventListener('click', katmanKapat);
document.getElementById('kutuKatman').addEventListener('click', (e) => {
  if (e.target.id === 'kutuKatman') katmanKapat();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') katmanKapat();
  if (e.key === 'F5') { e.preventDefault(); ekranAc(durum.ekran); }
});

baslat();
