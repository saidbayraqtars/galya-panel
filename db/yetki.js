'use strict';

// Tek yetki kataloğu. Kullanıcı ekranındaki kutular ve ana süreçteki IPC
// denetimi aynı anahtarları kullanır; biri güncellenip diğeri unutulmasın.
const YETKILER = [
  { anahtar: 'stok', ad: 'Stok kontrolü ve stok kartı işlemleri' },
  { anahtar: 'cari', ad: 'Cari bakiye görüntüleme' },
  { anahtar: 'sayim', ad: 'Ara sayım yapma' },
  { anahtar: 'tamSayim', ad: 'Tam sayım yapma' },
  { anahtar: 'sayimOnay', ad: "Sayımı onaylama ve Vega'ya işleme" },
  { anahtar: 'zayi', ad: 'Zayi / personel çıkışı' },
  { anahtar: 'uretim', ad: 'Üretim işlemleri' },
  { anahtar: 'sefim', ad: "Şefim'i yönetici olarak başlatma" },
  { anahtar: 'recete', ad: 'Reçete görüntüleme ve düzenleme' },
  { anahtar: 'third', ad: 'THIRD listesi ve işaretleme' },
  { anahtar: 'tutanak', ad: 'Ürün değişim tutanağı' },
  { anahtar: 'gider', ad: 'Gider / hizmet stokları' },
  { anahtar: 'alisFatura', ad: 'Alış faturası hazırlama' },
  { anahtar: 'alisFaturaOnay', ad: "Alış faturasını onaylama ve Vega'ya işleme" },
  { anahtar: 'maliyet', ad: 'Maliyetlendirme' },
  { anahtar: 'aktarim', ad: 'Şefim satış aktarımı ve eşleştirme' },
  { anahtar: 'yedek', ad: 'Yedekleme merkezi ve yedek alma' },
  { anahtar: 'yedekGeriYukle', ad: 'Yedekten geri yükleme (kritik)' },
  { anahtar: 'ayarlar', ad: 'Program ayarlarını değiştirme' }
];

// Kullanıcı rolüne hiçbir koşulda devredilmeyen işler. Kullanıcı yönetimini
// devretmek kişinin kendisini yönetici yapabilmesine yol açar.
const YONETICI_KANALLARI = new Set([
  'kullanici:liste',
  'kullanici:kaydet',
  'kullanici:sil',
  'oturum:pinBelirle',
  'oturum:pinKaldir'
]);

// Uygulamanın açılması, oturum kurulması ve ortak çıktı işlemleri için gereken
// kanallar. Bunun, yönetici listesinin veya modül haritasının dışında kalan
// yeni bir kanal kullanıcı rolünde varsayılan olarak kapalıdır.
const ACIK_KANALLAR = new Set([
  'ayar:oku',
  'baglanti:test',
  'panel:kur',
  'firma:liste',
  'depo:liste',
  'ozet:anaEkran',
  'yedek:hatirlatma',
  'rapor:excel',
  'rapor:pdf',
  'rapor:ac',
  'yazma:durum',
  'guncelleme:kontrol',
  'guncelleme:durum',
  'oturum:durum',
  'oturum:giris',
  'oturum:cikis',
  'sistem:kullanici',
  'sistem:surum',
  'sistem:yazdir',
  'sistem:onay'
]);

// Bir dizi verilirse listedeki yetkilerden herhangi biri yeterlidir. Ortak
// ürün/cari aramaları böylece ilgili iş ekranlarında çalışır; tek başına ayrı
// bir ekran yetkisi kazandırmaz.
const KANAL_YETKILERI = {
  'stok:durum': 'stok',
  'stok:kontrol': 'stok',
  'stok:kodListeleri': 'stok',
  'stok:hareket': 'stok',
  'stok:pasifYap': 'stok',
  'stok:ara': ['stok', 'sayim', 'aktarim', 'recete', 'third', 'tutanak', 'alisFatura', 'zayi', 'uretim'],

  'cari:bakiye': 'cari',
  'cari:ara': ['cari', 'alisFatura', 'zayi'],

  'sayim:liste': 'sayim',
  'sayim:kodListeleri': 'sayim',
  'sayim:listeyeEkle': 'sayim',
  'sayim:topluEkle': 'sayim',
  'sayim:listedenCikar': 'sayim',
  'sayim:listeyiBosalt': 'sayim',
  'sayim:ekran': 'sayim',
  'sayim:kaydet': 'sayim',
  'sayim:bekleyenler': 'sayimOnay',
  'sayim:reddet': 'sayimOnay',
  'sayim:onayla': 'sayimOnay',
  'sayim:vegayaYaz': 'sayimOnay',
  'sayim:vegadanGeriAl': 'sayimOnay',
  'sayim:gecmis': 'sayimOnay',
  'sayim:detay': 'sayimOnay',
  'sayim:iptal': 'sayimOnay',

  'zayi:cariler': 'zayi',
  'zayi:kaydet': 'zayi',
  'zayi:liste': 'zayi',
  'zayi:satirDokumu': 'zayi',
  'zayi:getir': 'zayi',
  'zayi:sil': 'zayi',
  'zayi:vegayaYaz': 'zayi',
  'zayi:vegadanGeriAl': 'zayi',

  'uretim:sifirAdaylari': 'uretim',
  'uretim:urunAra': 'uretim',
  'uretim:receteCiktilari': 'uretim',
  'uretim:isEmri': 'uretim',
  'uretim:sifiraKadar': 'uretim',
  'uretim:hepsiniSifirla': 'uretim',
  'uretim:fireli': 'uretim',
  'uretim:gecmis': 'uretim',
  'uretim:geriAl': 'uretim',

  'vegaprogram:durum': 'sefim',
  'vegaprogram:ac': 'sefim',

  'recete:mamuller': 'recete',
  'recete:agac': 'recete',
  'recete:satirlar': 'recete',
  'recete:olustur': 'recete',
  'recete:satirEkle': 'recete',
  'recete:satirGuncelle': 'recete',
  'recete:satirSil': 'recete',

  'third:adaylar': 'third',
  'third:isaretliler': 'third',
  'third:isaretle': 'third',
  'third:vegayaYaz': 'third',

  'tutanak:kaydet': 'tutanak',
  'tutanak:liste': 'tutanak',
  'tutanak:vegayaYaz': 'tutanak',
  'tutanak:vegadanGeriAl': 'tutanak',
  'tutanak:iptal': 'tutanak',
  'tutanak:belgePdf': 'tutanak',
  'tutanak:belgeYazdir': 'tutanak',

  'gider:liste': 'gider',
  'gider:sifirla': 'gider',
  'gider:geriAl': 'gider',

  'fatura:bekleyen': 'alisFatura',
  'fatura:eslesmeler': 'alisFatura',
  'alisFatura:kaydet': 'alisFatura',
  'alisFatura:liste': ['alisFatura', 'alisFaturaOnay'],
  'alisFatura:getir': ['alisFatura', 'alisFaturaOnay'],
  'alisFatura:sil': 'alisFatura',
  'alisFatura:vegayaYaz': 'alisFaturaOnay',
  'alisFatura:vegadanGeriAl': 'alisFaturaOnay',

  'maliyet:eskiyenler': 'maliyet',
  'maliyet:hesapla': 'maliyet',
  'maliyet:yaz': 'maliyet',
  'maliyet:gecmis': 'maliyet',
  'maliyet:geriAl': 'maliyet',
  'maliyet:mamul': ['maliyet', 'recete'],

  'satis:aktarimDurumu': 'aktarim',
  'satis:eslestirmeDurumu': 'aktarim',
  'satis:eslestirmeKaydet': 'aktarim',
  'satis:oneri': 'aktarim',

  'yedek:durum': 'yedek',
  'yedek:liste': 'yedek',
  'yedek:donusNoktalari': 'yedek',
  'yedek:al': 'yedek',
  'yedek:geriYukle': 'yedekGeriYukle',

  'ayar:yaz': 'ayarlar',
  'sistem:klasorAc': 'ayarlar'
};

function kullaniciYetkiliMi(yetkiler, gereken) {
  const anahtarlar = Array.isArray(gereken) ? gereken : [gereken];
  return anahtarlar.some((anahtar) => !!(yetkiler && yetkiler[anahtar]));
}

function yetkiAdi(anahtar) {
  const tanim = YETKILER.find((y) => y.anahtar === anahtar);
  return tanim ? tanim.ad : anahtar;
}

module.exports = {
  YETKILER,
  YONETICI_KANALLARI,
  ACIK_KANALLAR,
  KANAL_YETKILERI,
  kullaniciYetkiliMi,
  yetkiAdi
};
