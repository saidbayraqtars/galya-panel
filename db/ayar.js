'use strict';

const fs = require('fs');
const path = require('path');

const VARSAYILAN = {
  sunucu: 'localhost',
  port: 1433,
  windowsGirisi: false,
  kullanici: 'galya_panel',
  sifre: '',
  vegaVeritabani: 'VEGADB',
  sefimVeritabani: 'sefim',
  panelVeritabani: 'GALYA_PANEL',
  varsayilanFirma: 'F0102',
  varsayilanDonem: 'D0002',
  varsayilanDepo: 1,
  kritikStokAlt: 1,
  kritikStokUst: 5,
  aktifGun: 90,
  maliyetEskimeGun: 30,
  vegaKlasoru: 'C:\\VegaWinA5',
  // Yedekleme. Klasör SUNUCUDA olmalı — BACKUP komutunu SQL Server servisi
  // çalıştırır, yol onun disklerinde aranır. Boş bırakılırsa SQL Server'ın
  // kendi varsayılan yedek klasörü kullanılır.
  yedekKlasoru: '',
  // Son yedek bundan eskiyse ekranda "yedek almayı unutmayın" uyarısı çıkar.
  yedekUyariSaat: 24,
  // Vega'ya yazan HER işlemden önce otomatik yedek alınsın mı?
  // Açıkken işlem, yedek alınamazsa hiç başlamıyor — güvenlik ağı olmadan
  // yazmamak bilinçli bir tercih.
  islemOncesiYedek: true,
  // İşlem öncesi yedekler diferansiyeldir; dayandıkları tam yedek ("temel")
  // bu saatten eskiyse yenisi alınır.
  yedekTemelSaat: 24,
  // Kaç işlemlik geri dönüş noktası saklansın. Dosyalar döngüsel kullanılıyor
  // (üstüne yazılıyor), böylece disk sınırsız büyümüyor.
  yedekIslemSayisi: 20,
  // Geliştirme ve deneme aşamasında açık. Kapatmak Ayarlar ekranından.
  // Not: SQL tarafında galya_panel kullanıcısı VEGADB üzerinde salt okunur;
  // bu bayrak açık olsa da yetki verilmeden Vega'ya satır gitmez.
  vegayaYazmaAktif: true,

  // --- Şefim günlük satış aktarımı -----------------------------------------
  //
  // İş günü kesim saati. Restoran gece yarısını geçiyor: 11.08 iş gününün
  // adisyonları 12.08 saat 00:06'ya kadar sürüyor. Vega'nın kendi
  // "Şefim Entegrasyon" programı 11.08 belgesine 12.08 04:00'a kadarki
  // kayıtları koyuyor; 11 kasa hareketi / 12.675,00 TL bu kesimle birebir
  // tuttu (kesim 00:00 alındığında 7 hareket / 7.425,00 TL çıkıyordu).
  sefimGunKesimSaati: 4,
  // Satış hasılatının yazıldığı cari kartın kodu.
  sefimSatisCarisi: 'ŞEFSATIŞ',
  // Şefim'de girilen kasa giriş/çıkışlarının yazıldığı cari kartın kodu.
  sefimKasaCarisi: 'ŞEFİMKASA',
  // Aktarımın hangi depodan düşeceği. Boşsa varsayilanDepo kullanılır.
  sefimDepo: 0,

  // --- Ağ erişimi (db/sunucu.js) -------------------------------------------
  //
  // Açıkken panel aynı ağdaki başka bilgisayarlardan tarayıcıyla açılabilir:
  //   http://192.168.1.50:51234
  //
  // Trafik ŞİFRESİZDİR; PIN ağ üzerinden açık geçer. Yalnız güvenilen yerel
  // ağda açın, internete port yönlendirmesi YAPMAYIN. Sunucu, aktif bir
  // yönetici kullanıcı tanımlı değilse hiç açılmaz.
  agErisimiAktif: false,
  agPort: 51234,
  // '0.0.0.0' bütün ağ arayüzleri. Tek bir arayüze bağlamak için o kartın
  // IP'si yazılır ('192.168.1.50' gibi).
  agAdresi: '0.0.0.0'
};

// Ayar dosyası nerede duruyor?
//   Kurulu programda : %APPDATA%\Galya Panel\ayarlar.json   (her bilgisayarın kendi ayarı)
//   Geliştirmede     : proje kökündeki ayarlar.json
// Kurulu programda dosya yoksa, kurulumla gelen ayarlar.ornek.json'dan kopyalanır.
let yolOnbellek = null;

function ayarYolu() {
  if (yolOnbellek) return yolOnbellek;

  // Sınama ve destek için başka bir ayar dosyası gösterilebilir:
  //   set GALYA_AYAR_DOSYASI=C:\yol\test-ayarlar.json
  if (process.env.GALYA_AYAR_DOSYASI) {
    yolOnbellek = process.env.GALYA_AYAR_DOSYASI;
    return yolOnbellek;
  }

  let elektron = null;
  try {
    elektron = require('electron');
  } catch (e) {
    elektron = null;
  }

  const paketli = elektron && elektron.app && elektron.app.isPackaged;

  if (paketli) {
    const klasor = elektron.app.getPath('userData');
    const hedef = path.join(klasor, 'ayarlar.json');
    if (!fs.existsSync(hedef)) {
      try {
        fs.mkdirSync(klasor, { recursive: true });
        const ornek = path.join(process.resourcesPath, 'ayarlar.ornek.json');
        if (fs.existsSync(ornek)) fs.copyFileSync(ornek, hedef);
        else fs.writeFileSync(hedef, JSON.stringify(VARSAYILAN, null, 2), 'utf8');
      } catch (e) {
        // Yazılamazsa aşağıdaki okuma varsayılanlara düşer.
      }
    }
    yolOnbellek = hedef;
    return yolOnbellek;
  }

  yolOnbellek = path.join(__dirname, '..', 'ayarlar.json');
  return yolOnbellek;
}

let onbellek = null;

function ayarOku() {
  if (onbellek) return onbellek;
  let dosya = {};
  try {
    // Not Defteri ile kaydedilen dosyalar başta BOM taşır; JSON.parse onu
    // kabul etmediği için temizliyoruz.
    const ham = fs.readFileSync(ayarYolu(), 'utf8').replace(/^﻿/, '');
    dosya = JSON.parse(ham);
  } catch (e) {
    dosya = {};
  }
  onbellek = Object.assign({}, VARSAYILAN, dosya);
  return onbellek;
}

function ayarYaz(yeni) {
  const birlesik = Object.assign({}, ayarOku(), yeni);
  birlesik._aciklama =
    'Bu dosya bu bilgisayara özeldir. Programın Ayarlar ekranından da değiştirilebilir.';
  fs.writeFileSync(ayarYolu(), JSON.stringify(birlesik, null, 2), 'utf8');
  onbellek = birlesik;
  return birlesik;
}

module.exports = { ayarOku, ayarYaz, ayarYolu, VARSAYILAN };
