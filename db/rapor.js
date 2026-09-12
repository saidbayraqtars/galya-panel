'use strict';

// Rapor kaydetme: kullanıcıya "nereye kaydedeyim" penceresini açar, dosyayı
// yazar ve isterse hemen açar. PDF'i Electron'un kendi yazıcısı basıyor.

const fs = require('fs');
const path = require('path');
const { app, dialog, shell, BrowserWindow } = require('electron');

const disaAktar = require('./disaaktar');
const panel = require('./panel');

function varsayilanKlasor() {
  try {
    return app.getPath('desktop');
  } catch (e) {
    return app.getPath('documents');
  }
}

// Dosya adı raporun tanımıyla başlar. Kullanıcı aynı ekrandan "Tam sayım" ve
// "Zayi sayımı" diye iki çıktı alıyorsa masaüstünde hangisinin hangisi olduğu
// dosya adından anlaşılsın diye (müşterinin isteği).
function dosyaAdi(rapor, uzanti) {
  const tanim = (rapor && rapor.tanim ? String(rapor.tanim).trim() : '').slice(0, 40);
  const baslik = rapor && rapor.baslik ? rapor.baslik : 'rapor';
  return disaAktar.dosyaAdiUret(tanim ? tanim + '-' + baslik : baslik, uzanti);
}

async function kaydetYeriSor(anaPencere, dosyaAdiOnerisi, uzanti, tur) {
  const onerilen = path.join(varsayilanKlasor(), dosyaAdiOnerisi);
  const sonuc = await dialog.showSaveDialog(anaPencere, {
    title: 'Raporu kaydet',
    defaultPath: onerilen,
    filters: [{ name: tur, extensions: [uzanti] }]
  });
  return sonuc.canceled ? null : sonuc.filePath;
}

// rapor: { baslik, altBaslik, sayfaAdi, sutunlar, satirlar }
async function excelKaydet(anaPencere, rapor, kim) {
  if (!rapor || !rapor.sutunlar || !rapor.satirlar) throw new Error('Rapor içeriği eksik.');
  if (!rapor.satirlar.length) throw new Error('Aktarılacak satır yok.');

  const yol = await kaydetYeriSor(anaPencere, dosyaAdi(rapor, 'xlsx'), 'xlsx', 'Excel dosyası');
  if (!yol) return { iptal: true };

  disaAktar.excelDosyayaYaz(rapor, yol);
  await kayitDus(rapor, 'Excel', yol, kim);
  return { yol, tur: 'Excel' };
}

async function pdfKaydet(anaPencere, rapor, kim) {
  if (!rapor || !rapor.sutunlar || !rapor.satirlar) throw new Error('Rapor içeriği eksik.');
  if (!rapor.satirlar.length) throw new Error('Aktarılacak satır yok.');

  const yol = await kaydetYeriSor(anaPencere, dosyaAdi(rapor, 'pdf'), 'pdf', 'PDF dosyası');
  if (!yol) return { iptal: true };

  // Görünmez bir pencerede sayfayı basıp PDF alıyoruz. Pencere her durumda
  // kapatılıyor; yoksa program arka planda açık kalır.
  const gizli = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, images: false }
  });
  try {
    const html = disaAktar.pdfHtml(rapor);
    await gizli.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const veri = await gizli.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: rapor.sutunlar.length > 6,
      margins: { marginType: 'default' }
    });
    fs.mkdirSync(path.dirname(yol), { recursive: true });
    fs.writeFileSync(yol, veri);
  } finally {
    gizli.destroy();
  }

  await kayitDus(rapor, 'PDF', yol, kim);
  return { yol, tur: 'PDF' };
}


// --- Tutanak belgesi -------------------------------------------------------
//
// Liste raporundan farkı: tek bir tutanağın imzalanacak resmî çıktısı.
// Sayfa düzeni db/disaaktar.js → tutanakBelgeHtml() içinde.

async function belgeyiPdfeBas(html, yol) {
  // Görünmez bir pencerede basıyoruz. İmza kutuları sayfanın altına
  // yaslandığı için sayfa boyu sabit: A4 dikey.
  const gizli = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, images: false }
  });
  try {
    await gizli.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const veri = await gizli.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: false,
      margins: { marginType: 'default' }
    });
    fs.mkdirSync(path.dirname(yol), { recursive: true });
    fs.writeFileSync(yol, veri);
  } finally {
    gizli.destroy();
  }
}

async function tutanakBelgesiKaydet(anaPencere, tutanak, kim) {
  if (!tutanak || !tutanak.id) throw new Error('Tutanak bilgisi eksik.');

  const baslik = 'Tutanak-' + String(tutanak.id).padStart(6, '0');
  const yol = await kaydetYeriSor(anaPencere, disaAktar.dosyaAdiUret(baslik, 'pdf'), 'pdf', 'PDF dosyası');
  if (!yol) return { iptal: true };

  await belgeyiPdfeBas(disaAktar.tutanakBelgeHtml(tutanak), yol);

  try {
    await panel.kayit(
      'Tutanak',
      'Tutanak belgesi PDF olarak kaydedildi',
      { tutanakId: tutanak.id, dosya: yol },
      kim && kim.kullanici,
      kim && kim.bilgisayar
    );
  } catch (e) {
    // Günlük yazılamazsa belge yine de kullanıcıda.
  }

  return { yol, tur: 'PDF' };
}

// Doğrudan yazıcıya gönderir; kullanıcı yazıcı seçme penceresini görür.
async function htmlYazdir(html) {
  const gizli = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false }
  });
  try {
    await gizli.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((coz, ret) => {
      gizli.webContents.print(
        { silent: false, printBackground: true, pageSize: 'A4' },
        (basarili, hataSebebi) => {
          // Kullanıcı vazgeçtiyse hata değil.
          if (!basarili && hataSebebi && hataSebebi !== 'cancelled') {
            ret(new Error('Yazdırma başarısız: ' + hataSebebi));
          } else {
            coz();
          }
        }
      );
    });
  } finally {
    gizli.destroy();
  }
}

// Günlük yazılamazsa belge yine de kullanıcıda; işlem bozulmuyor.
async function belgeGunlugu(kategori, islem, ayrinti, kim) {
  try {
    await panel.kayit(kategori, islem, ayrinti, kim && kim.kullanici, kim && kim.bilgisayar);
  } catch (e) {
    // yoksay
  }
}

async function tutanakBelgesiYazdir(tutanak, kim) {
  if (!tutanak || !tutanak.id) throw new Error('Tutanak bilgisi eksik.');
  await htmlYazdir(disaAktar.tutanakBelgeHtml(tutanak));
  await belgeGunlugu('Tutanak', 'Tutanak belgesi yazdırıldı', { tutanakId: tutanak.id }, kim);
  return { tamam: true };
}

// --- Zayi belgesi ----------------------------------------------------------
//
// Zayi eden kişiye imzalatılacak çıktı (12.09.2026, müşteri isteği). Sayfa
// düzeni db/disaaktar.js → zayiBelgeHtml(); iskelet tutanakla aynı.

async function zayiBelgesiKaydet(anaPencere, zayi, kim) {
  if (!zayi || !zayi.id) throw new Error('Zayi bilgisi eksik.');

  const baslik = 'Zayi-' + (zayi.vegaBelgeNo || String(zayi.id).padStart(6, '0'));
  const yol = await kaydetYeriSor(anaPencere, disaAktar.dosyaAdiUret(baslik, 'pdf'), 'pdf', 'PDF dosyası');
  if (!yol) return { iptal: true };

  await belgeyiPdfeBas(disaAktar.zayiBelgeHtml(zayi), yol);
  await belgeGunlugu('Zayi', 'Zayi belgesi PDF olarak kaydedildi', { zayiId: zayi.id, dosya: yol }, kim);
  return { yol, tur: 'PDF' };
}

async function zayiBelgesiYazdir(zayi, kim) {
  if (!zayi || !zayi.id) throw new Error('Zayi bilgisi eksik.');
  await htmlYazdir(disaAktar.zayiBelgeHtml(zayi));
  await belgeGunlugu('Zayi', 'Zayi belgesi yazdırıldı', { zayiId: zayi.id }, kim);
  return { tamam: true };
}

async function kayitDus(rapor, tur, yol, kim) {
  try {
    await panel.kayit(
      'Rapor',
      tur + ' dışa aktarıldı',
      { baslik: rapor.baslik, satir: rapor.satirlar.length, dosya: yol },
      kim && kim.kullanici,
      kim && kim.bilgisayar
    );
  } catch (e) {
    // Günlük yazılamazsa rapor yine de kullanıcıda; işlemi bozmuyoruz.
  }
}

function dosyaAc(yol) {
  if (yol) shell.openPath(yol);
  return { tamam: true };
}

module.exports = {
  excelKaydet,
  pdfKaydet,
  tutanakBelgesiKaydet,
  tutanakBelgesiYazdir,
  zayiBelgesiKaydet,
  zayiBelgesiYazdir,
  dosyaAc
};
