'use strict';

/* Galya İzleyici arayüzü. Üç adım: bağlan → yakala → kaydet. */

const durum = {
  baglanti: null,   // { sunucu, port, kullanici, sifre }
  bilgi: null,      // sunucudan gelen durum
  veritabani: '',
  izliyor: false,
  sonSonuc: null
};

const icerik = document.getElementById('icerik');
const durumRozet = document.getElementById('durumRozet');

// ---------- Yardımcılar ----------

async function cagir(kanal, girdi) {
  const cevap = await window.izleyici.cagir(
    kanal,
    Object.assign({}, durum.baglanti, { veritabani: durum.veritabani }, girdi || {})
  );
  if (!cevap.tamam) throw new Error(cevap.mesaj || 'Bilinmeyen hata');
  return cevap.veri;
}

function el(etiket, ozellik, cocuklar) {
  const d = document.createElement(etiket);
  if (ozellik) {
    for (const k of Object.keys(ozellik)) {
      if (k === 'sinif') d.className = ozellik[k];
      else if (k === 'metin') d.textContent = ozellik[k];
      else if (k === 'tikla') d.addEventListener('click', ozellik[k]);
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

function bosalt(kap) { while (kap.firstChild) kap.removeChild(kap.firstChild); }

let bildirimZaman = null;
function bildir(mesaj, tur) {
  const b = document.getElementById('bildirim');
  b.textContent = mesaj;
  b.className = 'bildirim ' + (tur || 'bilgi');
  clearTimeout(bildirimZaman);
  bildirimZaman = setTimeout(() => b.classList.add('hidden'), tur === 'kotu' ? 10000 : 5000);
}

function hataGoster(e) { bildir(e.message || String(e), 'kotu'); }

function rozetYaz(metin, tur) {
  durumRozet.textContent = metin;
  durumRozet.className = 'rozet rozet-' + tur;
}

// ---------- 1. Bağlantı ekranı ----------

function baglantiEkrani(hataMesaji) {
  bosalt(icerik);
  icerik.appendChild(el('h2', { metin: 'SQL Server bağlantısı' }));
  icerik.appendChild(el('div', { sinif: 'aciklama-kutu' }, [
    'Bu araç VegaWinA5\'in veritabanına hangi SQL\'i gönderdiğini kaydeder. ' +
    'Veri değiştirmez, yalnızca dinler. Bilgisayara kurulum yapmaz.'
  ]));
  if (hataMesaji) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu kritik', metin: hataMesaji }));
  }

  const sunucu = el('input', { type: 'text', value: 'localhost', placeholder: 'localhost' });
  const port = el('input', { type: 'number', value: '1433' });
  const kullanici = el('input', { type: 'text', value: 'sa' });
  const sifre = el('input', { type: 'password' });

  const kutu = el('div', { sinif: 'kutu' }, [
    el('div', { sinif: 'aciklama-kutu uyari' }, [
      'İzleme açmak SQL Server\'da sysadmin yetkisi ister. Genelde "sa" kullanıcısı ' +
      'kullanılır. Sunucu adı olarak bilgisayar adı veya BILGISAYAR\\SQLEXPRESS yazın.'
    ]),
    el('div', { sinif: 'form-satir' }, [
      el('div', null, [el('label', { metin: 'Sunucu' }), sunucu]),
      el('div', null, [el('label', { metin: 'Port' }), port])
    ]),
    el('div', { sinif: 'form-satir' }, [
      el('div', null, [el('label', { metin: 'Kullanıcı' }), kullanici]),
      el('div', null, [el('label', { metin: 'Şifre' }), sifre])
    ])
  ]);

  const dugme = el('button', { sinif: 'dugme-ana', metin: 'Bağlan' });
  dugme.addEventListener('click', async () => {
    dugme.disabled = true;
    rozetYaz('Bağlanıyor…', 'bekle');
    durum.baglanti = {
      sunucu: sunucu.value.trim(),
      port: Number(port.value) || 1433,
      kullanici: kullanici.value.trim(),
      sifre: sifre.value
    };
    try {
      durum.bilgi = await cagir('durum');
      durum.izliyor = durum.bilgi.calisiyor;
      rozetYaz('Bağlı: ' + durum.bilgi.sunucu, 'iyi');
      anaEkran();
    } catch (e) {
      rozetYaz('Bağlanmadı', 'kotu');
      baglantiEkrani(e.message);
    }
  });

  kutu.appendChild(el('div', { sinif: 'form-satir' }, [dugme]));
  icerik.appendChild(kutu);
  sifre.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') dugme.click(); });
}

// ---------- 2. Ana ekran ----------

function anaEkran() {
  bosalt(icerik);
  icerik.appendChild(el('h2', { metin: 'Ne yapılacak' }));

  if (!durum.bilgi.yetkili) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu kritik' }, [
      'Bu kullanıcı sysadmin değil. İzleme açılamaz. sa kullanıcısıyla veya ' +
      'sysadmin yetkili bir kullanıcıyla yeniden bağlanın.'
    ]));
  }

  const liste = el('ol', { sinif: 'adimlar' });

  // --- Adım 1: veritabanı seç ve izlemeyi başlat
  const vtSecici = el('select');
  for (const v of durum.bilgi.veritabanlari) {
    vtSecici.appendChild(el('option', { value: v, metin: v }));
  }
  const vegaOlan = durum.bilgi.veritabanlari.find((v) => /vega/i.test(v));
  vtSecici.value = durum.veritabani || vegaOlan || durum.bilgi.veritabanlari[0] || '';
  durum.veritabani = vtSecici.value;
  vtSecici.addEventListener('change', () => { durum.veritabani = vtSecici.value; });

  const baslatDugme = el('button', {
    sinif: durum.izliyor ? 'dugme-sade' : 'dugme-ana',
    metin: durum.izliyor ? 'Yeniden başlat (eski kayıtları siler)' : 'İzlemeyi başlat'
  });
  baslatDugme.disabled = !durum.bilgi.yetkili;
  baslatDugme.addEventListener('click', async () => {
    baslatDugme.disabled = true;
    try {
      await cagir('baslat');
      durum.izliyor = true;
      durum.sonSonuc = null;
      bildir('İzleme başladı. Şimdi VegaWinA5\'te işlemi yapın.', 'iyi');
      anaEkran();
    } catch (e) {
      hataGoster(e);
      baslatDugme.disabled = false;
    }
  });

  liste.appendChild(el('li', { sinif: durum.izliyor ? 'tamam' : '' }, [
    el('h3', { metin: 'İzlemeyi başlat' }),
    el('p', { metin: 'Hangi veritabanının izleneceğini seçin. Vega\'nın veritabanı genelde VEGADB adını taşır.' }),
    el('div', { sinif: 'form-satir' }, [
      el('div', null, [el('label', { metin: 'İzlenecek veritabanı' }), vtSecici]),
      baslatDugme
    ])
  ]));

  // --- Adım 2: Vega'da işlemi yap
  liste.appendChild(el('li', null, [
    el('h3', { metin: "VegaWinA5'te öğrenmek istediğiniz işlemi yapın" }),
    el('p', {
      metin:
        'Örnek: Stok Yönetimi → Araçlar → Maliyetlendirme. İşlem bitene kadar bekleyin. ' +
        'Tek bir işlem yapın; ne kadar az başka şey yaparsanız kayıt o kadar temiz olur.'
    }),
    durum.izliyor
      ? el('div', { sinif: 'aciklama-kutu iyi', metin: 'İzleme açık, kayıt alınıyor.' })
      : el('div', { sinif: 'aciklama-kutu uyari', metin: 'Önce yukarıdan izlemeyi başlatın.' })
  ]));

  // --- Adım 3: sonucu al
  const okuDugme = el('button', { sinif: 'dugme-ana', metin: 'Yakalananları göster' });
  okuDugme.disabled = !durum.izliyor;
  okuDugme.addEventListener('click', async () => {
    okuDugme.disabled = true;
    okuDugme.textContent = 'Okunuyor…';
    try {
      durum.sonSonuc = await cagir('oku');
      anaEkran();
      bildir(`${durum.sonSonuc.toplam} ifade yakalandı, ${durum.sonSonuc.yazan} tanesi veri yazıyor.`, 'iyi');
    } catch (e) {
      hataGoster(e);
      okuDugme.disabled = false;
      okuDugme.textContent = 'Yakalananları göster';
    }
  });

  const kaydetDugme = el('button', { sinif: 'dugme-sade', metin: 'Hepsini dosyaya kaydet' });
  kaydetDugme.disabled = !durum.izliyor;
  kaydetDugme.addEventListener('click', () => dosyayaKaydet(''));

  const yazmaDugme = el('button', { sinif: 'dugme-sade', metin: 'Sadece yazanları kaydet' });
  yazmaDugme.disabled = !durum.izliyor;
  yazmaDugme.addEventListener('click', () => dosyayaKaydet('yazma'));

  liste.appendChild(el('li', null, [
    el('h3', { metin: 'Sonucu alın' }),
    el('p', { metin: 'Kaydedilen dosyayı bana gönderin; Vega\'nın ne yaptığını oradan çıkarıp programa ekleyeceğim.' }),
    el('div', { sinif: 'form-satir' }, [okuDugme, kaydetDugme, yazmaDugme])
  ]));

  // --- Adım 4: kapat
  const kaldirDugme = el('button', { sinif: 'dugme-sade', metin: 'İzlemeyi kapat' });
  kaldirDugme.disabled = !durum.izliyor;
  kaldirDugme.addEventListener('click', async () => {
    const onay = await window.izleyici.cagir('onay', {
      baslik: 'İzlemeyi kapat',
      mesaj: 'İzleme oturumu kapatılıp kaldırılacak.',
      detay: 'Kaydettiğiniz dosyalar masaüstünde kalır.',
      evet: 'Kapat', hayir: 'Vazgeç'
    });
    if (!onay.veri || !onay.veri.onay) return;
    try {
      await cagir('kaldir');
      durum.izliyor = false;
      bildir('İzleme kapatıldı.', 'iyi');
      anaEkran();
    } catch (e) { hataGoster(e); }
  });

  liste.appendChild(el('li', null, [
    el('h3', { metin: 'Bitince izlemeyi kapatın' }),
    el('p', { metin: 'İşiniz bitince kapatın; açık kalırsa sunucuda gereksiz kayıt dosyası büyür.' }),
    el('div', { sinif: 'form-satir' }, [kaldirDugme])
  ]));

  icerik.appendChild(liste);

  if (durum.sonSonuc) sonucGoster(durum.sonSonuc);
}

async function dosyayaKaydet(suzgec) {
  try {
    const s = await cagir('kaydet', { suzgec });
    bildir(`${s.adet} kayıt masaüstüne kaydedildi.`, 'iyi');
    const kutu = el('div', { sinif: 'aciklama-kutu iyi' }, [
      'Dosya: ' + s.dosya + '  ',
      el('button', {
        sinif: 'dugme-sade',
        metin: 'Klasörü aç',
        tikla: () => window.izleyici.cagir('dosyaAc', { yol: s.dosya })
      })
    ]);
    icerik.appendChild(kutu);
    kutu.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { hataGoster(e); }
}

function sonucGoster(s) {
  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Yakalananlar' }));

  icerik.appendChild(el('div', { sinif: 'kutu' }, [
    el('div', { sinif: 'sayilar' }, [
      el('div', null, [
        el('span', { sinif: 'n vurgu', metin: String(s.toplam) }),
        el('span', { sinif: 'l', metin: 'toplam ifade' })
      ]),
      el('div', null, [
        el('span', { sinif: 'n iyi', metin: String(s.yazan) }),
        el('span', { sinif: 'l', metin: 'veri yazan ifade' })
      ]),
      el('div', null, [
        el('span', { sinif: 'n', metin: String(s.tablolar.length) }),
        el('span', { sinif: 'l', metin: 'yazılan tablo' })
      ])
    ])
  ]));

  if (!s.yazan) {
    icerik.appendChild(el('div', { sinif: 'aciklama-kutu uyari' }, [
      'Veri yazan ifade yakalanmadı. İşlemi izleme başladıktan sonra yaptığınızdan ' +
      've doğru veritabanını seçtiğinizden emin olun.'
    ]));
    return;
  }

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Hangi tablolara yazılmış' }));
  const govde = el('tbody', null, s.tablolar.map((t) => el('tr', null, [
    el('td', { metin: t.ad }),
    el('td', { sinif: 'sayi', metin: String(t.adet) })
  ])));
  icerik.appendChild(el('div', { sinif: 'tablo-sarmal' }, [
    el('table', null, [
      el('thead', null, [el('tr', null, [
        el('th', { metin: 'Tablo' }),
        el('th', { metin: 'İfade sayısı' })
      ])]),
      govde
    ])
  ]));

  icerik.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'İlk yazan ifadeler' }));
  for (const o of s.ornekler) {
    icerik.appendChild(el('div', { sinif: 'ornek-bas', metin: `${o.zaman}  [${o.uygulama}]` }));
    icerik.appendChild(el('pre', { sinif: 'sql', metin: o.metin }));
  }
}

baglantiEkrani();
