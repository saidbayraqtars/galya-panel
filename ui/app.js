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
  yazmaAcik: false
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
  const islemler = el('div', { sinif: 'islem-dugmeleri' }, [
    islemDugmesi('Ara sayım', 'Seçili ürünleri say, farkı gör', 'sayim'),
    islemDugmesi('Reçete ağacı', 'Mamulün altındaki her şeyi gör', 'recete'),
    islemDugmesi('THIRD listesi', 'Üretim gerektiren stokları işaretle', 'third'),
    islemDugmesi('Ürün değişim tutanağı', 'Bir stoktan düş, diğerine ekle', 'tutanak'),
    islemDugmesi('Gider / hizmet stokları', 'Elektrik, su, nakliye kartlarını sıfırla', 'gider'),
    islemDugmesi('Cari bakiye', 'Kime ne kadar borç var', 'cari'),
    islemDugmesi('Günlük satış', 'Bugün ne satıldı, ne tüketildi', 'satis'),
    islemDugmesi('Vega Sayım programı', "VegaWinA5'in sayım aracını aç", null, () => vegaProgramAc('sayim'))
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

const STOK_SUZGECLERI = [
  { anahtar: 'sorunlu', ad: 'Dikkat isteyenler', not: 'Eksi, biten ve azalan' },
  { anahtar: 'eksi', ad: 'Eksi stok', not: 'Miktarı sıfırın altında' },
  { anahtar: 'sifir', ad: 'Stoğu bitenler', not: 'Miktarı tam sıfır' },
  { anahtar: 'azalan', ad: 'Azalanlar', not: 'Kritik seviyenin altı' },
  { anahtar: 'tumu', ad: 'Tüm ürünler', not: 'Hareket görmüş bütün kartlar' }
];

const STOK_DURUM_ETIKETI = {
  eksi: { sinif: 'kirmizi', metin: 'Eksi stok' },
  sifir: { sinif: 'kirmizi', metin: 'Bitti' },
  azalan: { sinif: 'turuncu', metin: 'Azaldı' },
  normal: { sinif: 'yesil', metin: 'Normal' }
};

ekranlar.stok = async function (parametre) {
  const suzgec = parametre.suzgec || 'sorunlu';
  const satirlar = await cagir('stok:kontrol', { suzgec });
  const secili = STOK_SUZGECLERI.find((s) => s.anahtar === suzgec) || STOK_SUZGECLERI[0];

  const sayilanAdet = satirlar.filter((s) => s.sayilan != null).length;
  const toplamDeger = satirlar.reduce((t, s) => t + Number(s.deger || 0), 0);

  function raporUret() {
    return {
      baslik: 'Stok kontrol — ' + secili.ad,
      sayfaAdi: 'Stok kontrol',
      sutunlar: [
        { ad: 'Durum', alan: 'durumAdi', tur: 'metin', genislik: 14 },
        { ad: 'Ürün', alan: 'ad', tur: 'metin', genislik: 42 },
        { ad: 'Stok kodu', alan: 'kod', tur: 'metin', genislik: 16 },
        { ad: 'Birim', alan: 'birim', tur: 'metin', genislik: 10 },
        { ad: 'Teorik (Vega)', alan: 'teorik', tur: 'sayi', genislik: 15 },
        { ad: 'Fiziki sayım', alan: 'sayilan', tur: 'sayi', genislik: 15 },
        { ad: 'Fark', alan: 'fark', tur: 'sayi', genislik: 12 },
        { ad: 'Fark tutarı', alan: 'farkTutari', tur: 'para', genislik: 16 },
        { ad: 'Kritik seviye', alan: 'kritikSeviye', tur: 'sayi', genislik: 14 },
        { ad: 'Birim maliyet', alan: 'birimMaliyet', tur: 'para', genislik: 16 },
        { ad: 'Stok değeri', alan: 'deger', tur: 'para', genislik: 16 }
      ],
      satirlar: satirlar.map((s) =>
        Object.assign({}, s, {
          durumAdi: (STOK_DURUM_ETIKETI[s.durum] || {}).metin || s.durum
        })
      )
    };
  }

  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Stok kontrol', disaAktarDugmeleri(raporUret)));

  // Süzgeç şeridi
  const seritler = el('div', { sinif: 'suzgec-serit' });
  for (const s of STOK_SUZGECLERI) {
    seritler.appendChild(el('button', {
      sinif: 'suzgec' + (s.anahtar === suzgec ? ' etkin' : ''),
      title: s.not,
      tikla: () => ekranAc('stok', { suzgec: s.anahtar })
    }, [
      el('span', { sinif: 'suzgec-ad', metin: s.ad })
    ]));
  }
  icerik.appendChild(seritler);

  icerik.appendChild(el('div', { sinif: 'ozet-serit' }, [
    ozetKarti('Listedeki ürün', sayiYaz(satirlar.length)),
    ozetKarti('Fiziki sayımı olan', sayiYaz(sayilanAdet)),
    ozetKarti('Toplam stok değeri', paraYaz(toplamDeger) + ' TL')
  ]));

  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    secili.not + '. "Fiziki sayım" sütunu panelden yapılan en son ara sayımdan gelir; ' +
    'hiç sayılmamış ürünlerde boş kalır.'
  ]));

  icerik.appendChild(tabloYap(
    ['Durum', 'Ürün', 'Birim', 'Teorik', 'Fiziki sayım', 'Fark', 'Kritik', 'Değer', ''],
    satirlar,
    (s) => {
      const e = STOK_DURUM_ETIKETI[s.durum] || STOK_DURUM_ETIKETI.normal;
      return el('tr', null, [
        el('td', null, [el('span', { sinif: 'etiket ' + e.sinif, metin: e.metin })]),
        el('td', null, [
          el('div', { sinif: 'ad-satir', metin: s.ad }),
          s.sayimTarihi
            ? el('div', { sinif: 'alt-not', metin: 'Sayım: ' + tarihYaz(s.sayimTarihi) + (s.sayan ? ' · ' + s.sayan : '') })
            : null
        ]),
        hucre(s.birim || '—'),
        hucre(sayiYaz(s.teorik, 2), 'sayi ' + (s.teorik < 0 ? 'eksi' : '')),
        hucre(s.sayilan == null ? '—' : sayiYaz(s.sayilan, 2), 'sayi'),
        hucre(
          s.fark == null ? '—' : sayiYaz(s.fark, 2),
          'sayi ' + (s.fark < 0 ? 'eksi' : s.fark > 0 ? 'arti' : '')
        ),
        hucre(s.kritikSeviye ? sayiYaz(s.kritikSeviye) : '—', 'sayi'),
        hucre(paraYaz(s.deger), 'sayi'),
        el('td', null, [el('button', {
          sinif: 'dugme-kucuk',
          metin: 'Hareketler',
          tikla: () => stokHareketiGoster(s)
        })])
      ]);
    }
  ));
};

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

// ---------- GÜNLÜK SATIŞ ----------

ekranlar.satis = async function () {
  const [satislar, tuketim] = await Promise.all([
    cagir('satis:ozet', { gun: 1 }),
    cagir('satis:tuketim', { gun: 1 })
  ]);
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Bugünkü satış', disaAktarDugmeleri(() => ({
    baslik: 'Reçetelere göre hammadde tüketimi',
    sayfaAdi: 'Tüketim',
    sutunlar: [
      { ad: 'Hammadde', alan: 'hammadde', tur: 'metin', genislik: 44 },
      { ad: 'Tüketim', alan: 'tuketim', tur: 'sayi', genislik: 14 },
      { ad: 'Birim', alan: 'birim', tur: 'metin', genislik: 10 },
      { ad: 'Birim maliyet', alan: 'birimMaliyet', tur: 'para', genislik: 16 },
      { ad: 'Tahmini tutar', alan: 'tutar', tur: 'para', genislik: 16 }
    ],
    satirlar: tuketim.map((t) => Object.assign({}, t, {
      tutar: Number(t.tuketim || 0) * Number(t.birimMaliyet || 0)
    }))
  }))));

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Satılan ürünler' }));
  icerik.appendChild(tabloYap(
    ['Ürün', 'Miktar', 'Tutar', 'İkram', 'Zayi'],
    satislar,
    (s) => el('tr', null, [
      hucre(s.urun),
      hucre(sayiYaz(s.miktar, 2), 'sayi'),
      hucre(paraYaz(s.tutar), 'sayi'),
      hucre(s.ikram ? sayiYaz(s.ikram, 2) : '', 'sayi'),
      hucre(s.zayi ? sayiYaz(s.zayi, 2) : '', 'sayi eksi')
    ])
  ));

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Reçetelere göre hammadde tüketimi' }));
  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Bu hesap sadece ekranda gösterilir, hiçbir yere yazılmaz. Eşleştirilmemiş ürünler hesaba katılmaz.'
  ]));
  icerik.appendChild(tabloYap(
    ['Hammadde', 'Tüketim', 'Birim', 'Tahmini tutar'],
    tuketim,
    (t) => el('tr', null, [
      hucre(t.hammadde),
      hucre(sayiYaz(t.tuketim, 3), 'sayi'),
      hucre(t.birim || '—'),
      hucre(paraYaz(t.tuketim * t.birimMaliyet), 'sayi')
    ])
  ));
};

// ---------- ARA SAYIM ----------

ekranlar.sayim = async function () {
  const [liste, gecmis] = await Promise.all([
    cagir('sayim:ekran'),
    cagir('sayim:gecmis')
  ]);
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Ara sayım', [
    el('button', { sinif: 'dugme-sade', metin: 'Sayılacak ürünleri düzenle', tikla: sayimListesiDuzenle }),
    el('button', { sinif: 'dugme-sade', metin: "Vega Sayım programını aç", tikla: () => vegaProgramAc('sayim') })
  ]));

  if (!liste.length) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      'Sayım listesi boş. Önce "Sayılacak ürünleri düzenle" düğmesinden ürün ekleyin ' +
      '(örneğin Kızartmalık Yağ ve Çay).'
    ]));
  } else {
    const girdiler = {};
    const gövde = el('tbody', null, liste.map((s) => {
      const kutu = el('input', { type: 'number', sinif: 'miktar', step: '0.01', min: '0' });
      girdiler[s.stokNo] = kutu;
      return el('tr', null, [
        hucre(s.stokAdi),
        hucre(s.birim || '—'),
        hucre(sayiYaz(s.teorik, 2), 'sayi'),
        el('td', null, [kutu])
      ]);
    }));

    icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
      'Her ürünün sayılan miktarını yazın, sonra tek düğmeye basın. ' +
      'Kaydettikten sonra fark listesi açılır.'
    ]));
    icerik.appendChild(el('div', { sinif: 'tablo-sarmal' }, [
      el('table', null, [
        el('thead', null, [el('tr', null, [
          el('th', { metin: 'Ürün' }),
          el('th', { metin: 'Birim' }),
          el('th', { metin: 'Vega\'da görünen' }),
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
        satirlar.push({
          stokNo: s.stokNo,
          stokAdi: s.stokAdi,
          birim: s.birim,
          teorik: s.teorik,
          sayilan: Number(deger),
          birimMaliyet: s.birimMaliyet
        });
      }
      if (!satirlar.length) {
        bildir('En az bir ürüne miktar yazın.', 'kotu');
        return;
      }
      const onay = await window.galya.cagir('sistem:onay', {
        baslik: 'Sayımı kaydet',
        mesaj: `${satirlar.length} ürün kaydedilecek.`,
        detay: 'Kayıt panel veritabanına yazılır, Vega değişmez. İstenirse listeden geri alınabilir.',
        evet: 'Kaydet',
        hayir: 'Vazgeç'
      });
      if (!onay.veri || !onay.veri.onay) return;
      try {
        kaydetDugme.disabled = true;
        const sonuc = await cagir('sayim:kaydet', { satirlar });
        bildir('Sayım kaydedildi.', 'iyi');
        sayimDetayGoster(sonuc.sayimId);
        ekranAc('sayim');
      } catch (e) {
        hataGoster(e);
        kaydetDugme.disabled = false;
      }
    });
    icerik.appendChild(el('div', { sinif: 'form-satir', style: 'margin-top:18px' }, [kaydetDugme]));
  }

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Geçmiş sayımlar' }));
  icerik.appendChild(tabloYap(
    ['Tarih', 'Sayan', 'Ürün', 'Farklı', 'Fark tutarı', ''],
    gecmis,
    (g) => el('tr', null, [
      hucre(saatliTarih(g.tarih)),
      hucre(g.sayan || '—'),
      hucre(sayiYaz(g.satirSayisi), 'sayi'),
      hucre(sayiYaz(g.farkliSatir), 'sayi ' + (g.farkliSatir ? 'eksi' : '')),
      hucre(paraYaz(g.farkTutari), 'sayi'),
      el('td', null, [
        el('button', { sinif: 'dugme-kucuk', metin: 'Farkları gör', tikla: () => sayimDetayGoster(g.id) }),
        el('button', {
          sinif: 'dugme-kucuk',
          metin: 'Geri al',
          style: 'margin-left:6px',
          tikla: () => sayimGeriAl(g.id)
        })
      ])
    ])
  ));
};

async function vegaProgramAc(anahtar) {
  try {
    const sonuc = await cagir('vegaprogram:ac', { program: anahtar });
    bildir(sonuc.ad + ' açılıyor…', 'iyi');
  } catch (e) { hataGoster(e); }
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

async function receteAgaciGoster(mamul) {
  try {
    const agac = await cagir('recete:agac', { receteNo: mamul.receteNo });
    const kap = el('div', { sinif: 'agac-kutu' });
    function yaz(satirlar) {
      for (const s of satirlar) {
        const girinti = 16 * (s.seviye || 0);
        kap.appendChild(el('div', {
          sinif: 'agac-satir',
          style: 'padding-left:' + girinti + 'px'
        }, [
          el('span', { sinif: 'ad', metin: (s.altRecetesiVar ? '▸ ' : '· ') + s.ad }),
          el('span', {
            sinif: 'mik',
            metin: sayiYaz(s.miktar, 3) + ' ' + (s.birim || '') +
              (s.fireOrani ? '  (fire %' + sayiYaz(s.fireOrani, 1) + ')' : '')
          })
        ]));
        if (s.alt && s.alt.length) yaz(s.alt);
      }
    }
    if (!agac.length) {
      kap.appendChild(el('div', { sinif: 'bos-mesaj', metin: 'Bu reçetede satır yok.' }));
    } else {
      yaz(agac);
    }
    katmanAc(mamul.mamulAdi || ('Reçete ' + mamul.receteNo), kap);
  } catch (e) { hataGoster(e); }
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
      detay: 'Kayıt panel veritabanına yazılır, Vega değişmez.',
      evet: 'Kaydet', hayir: 'Vazgeç'
    });
    if (!onay.veri || !onay.veri.onay) return;
    try {
      await cagir('tutanak:kaydet', {
        dusenStokNo: dusen.stokNo, dusenStokAdi: dusen.ad, dusenMiktar: dusenMiktar.value,
        artanStokNo: artan.stokNo, artanStokAdi: artan.ad, artanMiktar: artanMiktar.value,
        sebep: sebep.value
      });
      katmanKapat();
      bildir('Tutanak kaydedildi.', 'iyi');
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

// ---------- CARİ ----------

ekranlar.cari = async function () {
  const liste = await cagir('cari:bakiye');
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Cari bakiye', disaAktarDugmeleri(() => ({
    baslik: 'Cari bakiye listesi',
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
  const toplam = liste.reduce((t, c) => t + Number(c.bakiye || 0), 0);
  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    `${liste.length} carinin bakiyesi var. Toplam net bakiye: ${paraYaz(toplam)} TL ` +
    '(artı = bizim alacağımız, eksi = bizim borcumuz).'
  ]));
  icerik.appendChild(tabloYap(
    ['Cari', 'Borç', 'Alacak', 'Bakiye'],
    liste,
    (c) => el('tr', null, [
      hucre(c.ad || c.kod),
      hucre(paraYaz(c.borc), 'sayi'),
      hucre(paraYaz(c.alacak), 'sayi'),
      hucre(paraYaz(c.bakiye), 'sayi ' + (c.bakiye < 0 ? 'eksi' : 'arti'))
    ])
  ));
};

// ---------- AYARLAR ----------

ekranlar.ayarlar = async function () {
  const a = await cagir('ayar:oku');
  bosalt(icerik);
  icerik.appendChild(ekranBasligi('Ayarlar'));

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
document.getElementById('katmanKapat').addEventListener('click', katmanKapat);
document.getElementById('kutuKatman').addEventListener('click', (e) => {
  if (e.target.id === 'kutuKatman') katmanKapat();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') katmanKapat();
  if (e.key === 'F5') { e.preventDefault(); ekranAc(durum.ekran); }
});

baslat();
