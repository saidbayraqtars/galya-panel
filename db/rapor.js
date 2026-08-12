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

async function kaydetYeriSor(anaPencere, baslik, uzanti, tur) {
  const onerilen = path.join(varsayilanKlasor(), disaAktar.dosyaAdiUret(baslik, uzanti));
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

  const yol = await kaydetYeriSor(anaPencere, rapor.baslik, 'xlsx', 'Excel dosyası');
  if (!yol) return { iptal: true };

  disaAktar.excelDosyayaYaz(rapor, yol);
  await kayitDus(rapor, 'Excel', yol, kim);
  return { yol, tur: 'Excel' };
}

async function pdfKaydet(anaPencere, rapor, kim) {
  if (!rapor || !rapor.sutunlar || !rapor.satirlar) throw new Error('Rapor içeriği eksik.');
  if (!rapor.satirlar.length) throw new Error('Aktarılacak satır yok.');

  const yol = await kaydetYeriSor(anaPencere, rapor.baslik, 'pdf', 'PDF dosyası');
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

module.exports = { excelKaydet, pdfKaydet, dosyaAc };
