'use strict';

const bul = (id) => document.getElementById(id);
const cagir = (kanal, girdi) => window.izleyici.cagir(kanal, girdi);

let sonDosya = null;
let sayacZamanlayici = null;

function yaz(el, metin, iyiMi) {
  el.textContent = metin;
  el.className = 'sonuc' + (iyiMi === true ? ' iyi' : iyiMi === false ? ' kotu' : '');
}

function ac(id) {
  bul(id).classList.remove('pasif');
}

// --- Giriş türü ------------------------------------------------------------
function windowsSecili() {
  return bul('girisWindows').checked;
}

function girisTuruDegisti() {
  const win = windowsSecili();
  for (const id of ['portAlan', 'kullaniciAlan', 'sifreAlan']) {
    bul(id).style.display = win ? 'none' : '';
  }
}

bul('girisWindows').addEventListener('change', girisTuruDegisti);
bul('girisSql').addEventListener('change', girisTuruDegisti);

// --- Başlangıç: kayıtlı ayarı yükle ---------------------------------------
(async () => {
  const c = await cagir('ayar:oku');
  if (!c.tamam) return;
  const a = c.veri;
  bul('sunucu').value = a.sunucu || 'localhost';
  bul('port').value = a.port || 1433;
  bul('kullanici').value = a.kullanici || 'sa';
  bul('veritabani').value = a.veritabani || 'VEGADB';
  if (a.sifreVar) bul('sifre').placeholder = 'kayıtlı — değiştirmek için yazın';

  // Windows girişi sqlcmd üzerinden yapılıyor; yoksa seçtirmeyelim.
  if (a.windowsKullanilabilir) {
    bul('windowsNot').textContent =
      'Bu bilgisayarın Windows kullanıcısıyla bağlanır. SQL Server’a Windows ' +
      'kullanıcınızın yetkisi varsa en kolay yol budur.';
    if (a.windowsGirisi) bul('girisWindows').checked = true;
  } else {
    bul('girisWindows').disabled = true;
    bul('windowsNot').textContent =
      'Windows girişi bu bilgisayarda kullanılamıyor (sqlcmd kurulu değil). ' +
      'SQL kullanıcısıyla girin.';
  }
  girisTuruDegisti();
})();

// --- 1. Bağlan -------------------------------------------------------------
bul('btnBaglan').addEventListener('click', async () => {
  const dugme = bul('btnBaglan');
  dugme.disabled = true;
  yaz(bul('baglantiSonuc'), 'Bağlanılıyor…');

  const c = await cagir('baglan', {
    windowsGirisi: windowsSecili(),
    sunucu: bul('sunucu').value.trim(),
    port: Number(bul('port').value) || 1433,
    kullanici: bul('kullanici').value.trim(),
    sifre: bul('sifre').value,
    veritabani: bul('veritabani').value.trim() || 'VEGADB'
  });

  dugme.disabled = false;

  if (!c.tamam) {
    yaz(bul('baglantiSonuc'), c.mesaj, false);
    return;
  }

  const v = c.veri;
  if (!v.sysadmin) {
    yaz(
      bul('baglantiSonuc'),
      'Bağlandı (' + (v.kim || '?') + ') ama bu kullanıcının sysadmin yetkisi yok. ' +
        'Kayıt alınamaz — sa ile veya sysadmin yetkili bir kullanıcıyla girin.',
      false
    );
    return;
  }
  if (!v.vegaVar) {
    yaz(bul('baglantiSonuc'), 'Bağlandı ama bu sunucuda VEGADB adlı veritabanı yok. Veritabanı adını kontrol edin.', false);
    return;
  }

  yaz(bul('baglantiSonuc'), 'Bağlantı hazır. Sunucu: ' + v.sunucu + '  —  Kullanıcı: ' + (v.kim || '?'), true);
  ac('adim2');
});

// --- 2. Başlat -------------------------------------------------------------
bul('btnBaslat').addEventListener('click', async () => {
  const dugme = bul('btnBaslat');
  dugme.disabled = true;
  yaz(bul('baslatSonuc'), 'Kayıt başlatılıyor…');

  const c = await cagir('baslat');
  dugme.disabled = false;

  if (!c.tamam) {
    yaz(bul('baslatSonuc'), c.mesaj, false);
    return;
  }

  yaz(bul('baslatSonuc'), 'Kayıt açık. Artık VegaWinA5’te işlemi yapabilirsiniz.', true);
  ac('adim3');
  sayacBaslat();
});

function sayacBaslat() {
  if (sayacZamanlayici) clearInterval(sayacZamanlayici);
  const guncelle = async () => {
    const c = await cagir('durum');
    if (c.tamam) {
      bul('sayac').textContent =
        'Kaydedilen komut: ' + c.veri.olay.toLocaleString('tr-TR') + (c.veri.calisiyor ? '' : '  (kayıt durdu)');
    }
  };
  guncelle();
  sayacZamanlayici = setInterval(guncelle, 4000);
}

// --- 3. Bitir --------------------------------------------------------------
window.izleyici.ilerleme((sayi) => {
  bul('sayac').textContent = 'Okunuyor… ' + sayi.toLocaleString('tr-TR') + ' komut';
});

bul('btnBitir').addEventListener('click', async () => {
  const dugme = bul('btnBitir');
  dugme.disabled = true;
  if (sayacZamanlayici) clearInterval(sayacZamanlayici);
  yaz(bul('bitirSonuc'), 'Kayıt durduruluyor ve dosyaya yazılıyor. Bu biraz sürebilir…');

  const durdur = await cagir('durdur');
  if (!durdur.tamam) {
    yaz(bul('bitirSonuc'), durdur.mesaj, false);
    dugme.disabled = false;
    return;
  }

  const c = await cagir('kaydet', { etiket: bul('etiket').value });
  dugme.disabled = false;

  if (!c.tamam) {
    yaz(bul('bitirSonuc'), c.mesaj, false);
    return;
  }

  sonDosya = c.veri.dosya;
  yaz(
    bul('bitirSonuc'),
    'Bitti.\n' +
      c.veri.yazilan.toLocaleString('tr-TR') +
      ' komut kaydedildi.\nDosya masaüstünüzde:\n' +
      c.veri.dosya +
      '\n\nBu dosyayı bana gönderin.',
    true
  );
  bul('btnGoster').classList.remove('gizli');
  bul('sayac').textContent = 'Kayıt tamamlandı.';
});

bul('btnGoster').addEventListener('click', () => {
  if (sonDosya) cagir('dosyaGoster', { dosya: sonDosya });
});

bul('uyari').textContent =
  'Bu program yalnızca okuma yapar; VegaWinA5 verisine dokunmaz. ' +
  'Kayıt SQL Server üzerinde tutulur ve “Bitir” denince kapatılır.';
