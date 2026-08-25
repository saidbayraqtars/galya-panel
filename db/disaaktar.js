'use strict';

// Rapor dışa aktarma: gerçek Excel (.xlsx) ve PDF üretir.
//
// Neden hazır kütüphane yok?
//   Program kurulumu 86 MB; her ek paket bunu büyütüyor ve güncelleme
//   indirmesini yavaşlatıyor. .xlsx aslında içinde birkaç XML dosyası olan bir
//   ZIP; onu elle üretmek yüz satır tutuyor. PDF'i de Electron'un kendi
//   yazıcısı üretiyor, dışarıdan bir şey gerekmiyor.
//
// CSV bilerek kullanılmadı: Excel CSV'yi Türkçe karakterlerde ve ondalık
// ayracında yanlış açabiliyor, kullanıcıya "bozuk geldi" diye dönüyor.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- ZIP (xlsx kabı) -------------------------------------------------------

let crcTablosu = null;
function crc32(veri) {
  if (!crcTablosu) {
    crcTablosu = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTablosu[i] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < veri.length; i++) c = crcTablosu[(c ^ veri[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zipYaz(girdiler) {
  const yerel = [];
  const merkez = [];
  let konum = 0;

  for (const g of girdiler) {
    const ad = Buffer.from(g.ad, 'utf8');
    const ham = Buffer.from(g.icerik, 'utf8');
    const sikistirilmis = zlib.deflateRawSync(ham, { level: 6 });
    const kontrol = crc32(ham);

    const yerelBaslik = Buffer.alloc(30);
    yerelBaslik.writeUInt32LE(0x04034b50, 0);
    yerelBaslik.writeUInt16LE(20, 4); // gereken sürüm
    yerelBaslik.writeUInt16LE(0x0800, 6); // UTF-8 ad bayrağı
    yerelBaslik.writeUInt16LE(8, 8); // deflate
    yerelBaslik.writeUInt16LE(0, 10); // saat
    yerelBaslik.writeUInt16LE(0x21, 12); // tarih (1980-01-01)
    yerelBaslik.writeUInt32LE(kontrol, 14);
    yerelBaslik.writeUInt32LE(sikistirilmis.length, 18);
    yerelBaslik.writeUInt32LE(ham.length, 22);
    yerelBaslik.writeUInt16LE(ad.length, 26);
    yerelBaslik.writeUInt16LE(0, 28);

    yerel.push(yerelBaslik, ad, sikistirilmis);

    const merkezBaslik = Buffer.alloc(46);
    merkezBaslik.writeUInt32LE(0x02014b50, 0);
    merkezBaslik.writeUInt16LE(20, 4);
    merkezBaslik.writeUInt16LE(20, 6);
    merkezBaslik.writeUInt16LE(0x0800, 8);
    merkezBaslik.writeUInt16LE(8, 10);
    merkezBaslik.writeUInt16LE(0, 12);
    merkezBaslik.writeUInt16LE(0x21, 14);
    merkezBaslik.writeUInt32LE(kontrol, 16);
    merkezBaslik.writeUInt32LE(sikistirilmis.length, 20);
    merkezBaslik.writeUInt32LE(ham.length, 24);
    merkezBaslik.writeUInt16LE(ad.length, 28);
    merkezBaslik.writeUInt32LE(konum, 42);

    merkez.push(merkezBaslik, ad);
    konum += yerelBaslik.length + ad.length + sikistirilmis.length;
  }

  const merkezVeri = Buffer.concat(merkez);
  const son = Buffer.alloc(22);
  son.writeUInt32LE(0x06054b50, 0);
  son.writeUInt16LE(girdiler.length, 8);
  son.writeUInt16LE(girdiler.length, 10);
  son.writeUInt32LE(merkezVeri.length, 12);
  son.writeUInt32LE(konum, 16);

  return Buffer.concat([Buffer.concat(yerel), merkezVeri, son]);
}

// --- XML kaçışları ---------------------------------------------------------

function xmlKacir(metin) {
  return String(metin == null ? '' : metin)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Excel denetim karakterlerini kabul etmiyor, dosyayı bozuk sayıyor.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function sutunHarfi(indis) {
  let s = '';
  let n = indis + 1;
  while (n > 0) {
    const kalan = (n - 1) % 26;
    s = String.fromCharCode(65 + kalan) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// --- Excel -----------------------------------------------------------------
//
// sutunlar: [{ ad, alan, tur: 'metin'|'sayi'|'para'|'tarih', genislik }]

function hucreXml(satirNo, sutunNo, deger, tur) {
  const ref = sutunHarfi(sutunNo) + satirNo;
  const sayisalMi = tur === 'sayi' || tur === 'para';

  if (sayisalMi) {
    const s = Number(deger);
    if (deger == null || deger === '' || isNaN(s)) return `<c r="${ref}" s="${tur === 'para' ? 3 : 2}"/>`;
    return `<c r="${ref}" s="${tur === 'para' ? 3 : 2}"><v>${s}</v></c>`;
  }
  return `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${xmlKacir(deger)}</t></is></c>`;
}

function sayfaXml(sutunlar, satirlar, baslik, altBaslik, tanim) {
  const parcalar = [];
  let satirNo = 1;

  // Başlık bloğu — raporun neyi, hangi firmayı ve hangi anı gösterdiği
  // dosyaya bakan kişi için kaybolmasın diye ilk satırlara yazılıyor.
  //
  // `tanim` kullanıcının o çıktıya elle verdiği ad ("Tam sayım", "Zayi",
  // "Dönem sonu envanteri"). Müşterinin isteği: aynı ekrandan alınan iki
  // çıktı dosyaya bakınca ayırt edilebilsin. Başlığın yanına yazılıyor,
  // dosya adına da giriyor (db/rapor.js).
  const anaBaslik = tanim ? `${tanim} — ${baslik}` : baslik;
  parcalar.push(`<row r="${satirNo}"><c r="A${satirNo}" s="4" t="inlineStr"><is><t>${xmlKacir(anaBaslik)}</t></is></c></row>`);
  satirNo++;
  if (altBaslik) {
    parcalar.push(`<row r="${satirNo}"><c r="A${satirNo}" s="5" t="inlineStr"><is><t>${xmlKacir(altBaslik)}</t></is></c></row>`);
    satirNo++;
  }
  satirNo++; // boş satır

  const baslikSatiri = satirNo;
  parcalar.push(
    `<row r="${satirNo}">` +
      sutunlar
        .map(
          (s, i) =>
            `<c r="${sutunHarfi(i)}${satirNo}" s="6" t="inlineStr"><is><t>${xmlKacir(s.ad)}</t></is></c>`
        )
        .join('') +
      '</row>'
  );
  satirNo++;

  for (const satir of satirlar) {
    parcalar.push(
      `<row r="${satirNo}">` +
        sutunlar.map((s, i) => hucreXml(satirNo, i, satir[s.alan], s.tur)).join('') +
        '</row>'
    );
    satirNo++;
  }

  const sutunGenislikleri = sutunlar
    .map((s, i) => `<col min="${i + 1}" max="${i + 1}" width="${s.genislik || 18}" customWidth="1"/>`)
    .join('');

  const sonSutun = sutunHarfi(sutunlar.length - 1);

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetPr><outlinePr/></sheetPr>` +
    `<sheetViews><sheetView workbookViewId="0" tabSelected="1">` +
    `<pane ySplit="${baslikSatiri}" topLeftCell="A${baslikSatiri + 1}" activePane="bottomLeft" state="frozen"/>` +
    '</sheetView></sheetViews>' +
    `<cols>${sutunGenislikleri}</cols>` +
    `<sheetData>${parcalar.join('')}</sheetData>` +
    `<autoFilter ref="A${baslikSatiri}:${sonSutun}${satirNo - 1}"/>` +
    '</worksheet>'
  );
}

const STIL_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2">' +
  '<numFmt numFmtId="200" formatCode="#,##0.00"/>' +
  '<numFmt numFmtId="201" formatCode="#,##0.00\\ &quot;TL&quot;"/>' +
  '</numFmts>' +
  '<fonts count="4">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>' +
  '<font><b/><sz val="16"/><name val="Calibri"/><color rgb="FF1C3D5A"/></font>' +
  '<font><sz val="10"/><name val="Calibri"/><color rgb="FF6C757D"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1C3D5A"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left style="thin"><color rgb="FFDEE2E6"/></left><right style="thin"><color rgb="FFDEE2E6"/></right>' +
  '<top style="thin"><color rgb="FFDEE2E6"/></top><bottom style="thin"><color rgb="FFDEE2E6"/></bottom><diagonal/></border>' +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="7">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                   // 0 genel
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +                    // 1 metin
  '<xf numFmtId="200" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' + // 2 sayı
  '<xf numFmtId="201" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' + // 3 para
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                      // 4 başlık
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                      // 5 alt başlık
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' + // 6 sütun başlığı
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function excelUret(rapor) {
  const sayfaAdi = (rapor.sayfaAdi || 'Rapor').slice(0, 28).replace(/[\\/:*?[\]]/g, ' ');

  return zipYaz([
    {
      ad: '[Content_Types].xml',
      icerik:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'
    },
    {
      ad: '_rels/.rels',
      icerik:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    },
    {
      ad: 'xl/workbook.xml',
      icerik:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${xmlKacir(sayfaAdi)}" sheetId="1" r:id="rId1"/></sheets>` +
        '</workbook>'
    },
    {
      ad: 'xl/_rels/workbook.xml.rels',
      icerik:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'
    },
    { ad: 'xl/styles.xml', icerik: STIL_XML },
    {
      ad: 'xl/worksheets/sheet1.xml',
      icerik: sayfaXml(rapor.sutunlar, rapor.satirlar, rapor.baslik, rapor.altBaslik, rapor.tanim)
    }
  ]);
}

// --- PDF için HTML ---------------------------------------------------------
//
// PDF'i Electron'un printToPDF'i basıyor; burada ona verilecek sayfayı
// hazırlıyoruz. Yazı tipleri sistemden geldiği için dosyaya gömme derdi yok.

function sayiBicimle(deger, tur) {
  if (deger == null || deger === '') return '';
  if (tur === 'sayi' || tur === 'para') {
    const s = Number(deger);
    if (isNaN(s)) return String(deger);
    return s.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(deger);
}

function pdfHtml(rapor) {
  const sutunlar = rapor.sutunlar;
  const basliklar = sutunlar
    .map((s) => `<th class="${s.tur === 'sayi' || s.tur === 'para' ? 'sag' : ''}">${xmlKacir(s.ad)}</th>`)
    .join('');

  const satirlar = rapor.satirlar
    .map((satir) => {
      const hucreler = sutunlar
        .map((s) => {
          const ham = satir[s.alan];
          const sagMi = s.tur === 'sayi' || s.tur === 'para';
          const eksiMi = sagMi && Number(ham) < 0;
          return `<td class="${sagMi ? 'sag' : ''}${eksiMi ? ' eksi' : ''}">${xmlKacir(sayiBicimle(ham, s.tur))}</td>`;
        })
        .join('');
      return `<tr>${hucreler}</tr>`;
    })
    .join('');

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
    @page { margin: 14mm 10mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; color: #212529; margin: 0; }
    h1 { font-size: 17px; margin: 0 0 3px; color: #1c3d5a; }
    .alt { color: #6c757d; font-size: 10px; margin: 0 0 12px; }
    table { border-collapse: collapse; width: 100%; }
    thead { display: table-header-group; }
    th { background: #1c3d5a; color: #fff; text-align: left; padding: 6px 7px; font-weight: 600; font-size: 10px; }
    td { padding: 5px 7px; border-bottom: 1px solid #e9ecef; }
    tr:nth-child(even) td { background: #f8f9fa; }
    tr { page-break-inside: avoid; }
    .sag { text-align: right; font-variant-numeric: tabular-nums; }
    .eksi { color: #c92a2a; font-weight: 600; }
    .dip { margin-top: 10px; color: #868e96; font-size: 9px; }
  </style></head><body>
    <h1>${xmlKacir(rapor.tanim ? rapor.tanim + ' — ' + rapor.baslik : rapor.baslik)}</h1>
    <p class="alt">${xmlKacir(rapor.altBaslik || '')}</p>
    <table><thead><tr>${basliklar}</tr></thead><tbody>${satirlar}</tbody></table>
    <p class="dip">${xmlKacir(rapor.satirlar.length + ' satır · Galya Panel')}</p>
  </body></html>`;
}


// --- Ürün değişim tutanağı belgesi -----------------------------------------
//
// Liste raporlarından ayrı bir şey: tek bir tutanağın ıslak imzayla
// dosyalanacak resmî çıktısı. A4 dikey, tek sayfa, altında imza alanları.
//
// Tasarım kuralları:
//   - Tek sayfaya sığar; imza bloğu her zaman sayfanın altına yaslanır.
//   - Düşen ve artan ürün yan yana, biri kırmızı biri yeşil şeritli;
//     hangi üründen düşüldüğü bir bakışta görünsün.
//   - Vega'ya yazılmamışsa bu belgede açıkça yazar; imzalayan kişi stok
//     kaydının henüz oluşmadığını bilerek imzalasın.

function belgeTarihi(deger) {
  if (!deger) return '—';
  const t = new Date(deger);
  if (isNaN(t)) return '—';
  const iki = (n) => String(n).padStart(2, '0');
  return `${iki(t.getDate())}.${iki(t.getMonth() + 1)}.${t.getFullYear()}`;
}

function belgeSaatliTarih(deger) {
  if (!deger) return '—';
  const t = new Date(deger);
  if (isNaN(t)) return '—';
  const iki = (n) => String(n).padStart(2, '0');
  return `${iki(t.getDate())}.${iki(t.getMonth() + 1)}.${t.getFullYear()} ${iki(t.getHours())}:${iki(t.getMinutes())}`;
}

function belgeMiktar(deger, birim) {
  const s = Number(deger);
  if (isNaN(s)) return String(deger || '');
  return (
    s.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) +
    (birim ? ' ' + birim : '')
  );
}

const VARSAYILAN_IMZALAR = ['Düzenleyen', 'Depo Sorumlusu', 'Muhasebe', 'Onaylayan'];

// t: {
//   id, tarih, firmaAdi, firma, donem, depo, depoAdi, duzenleyen, sebep,
//   dusenAd, dusenKod, dusenMiktar, dusenBirim, dusenMaliyet,
//   artanAd, artanKod, artanMiktar, artanBirim, artanMaliyet,
//   vegayaYazildi, vegaBelgeNo, imzalar
// }
function tutanakBelgeHtml(t) {
  const imzalar = (Array.isArray(t.imzalar) && t.imzalar.length ? t.imzalar : VARSAYILAN_IMZALAR)
    .slice(0, 4);

  const dusenTutar = Number(t.dusenMiktar || 0) * Number(t.dusenMaliyet || 0);
  const artanTutar = Number(t.artanMiktar || 0) * Number(t.artanMaliyet || 0);

  const imzaHucreleri = imzalar
    .map(
      (ad) => `
      <td class="imza-hucre">
        <div class="imza-unvan">${xmlKacir(ad)}</div>
        <div class="imza-satir">
          <span class="imza-etiket">Adı Soyadı</span>
          <span class="imza-cizgi"></span>
        </div>
        <div class="imza-satir">
          <span class="imza-etiket">Tarih</span>
          <span class="imza-cizgi"></span>
        </div>
        <div class="imza-alan"><span class="imza-etiket">İmza</span></div>
      </td>`
    )
    .join('');

  const vegaRozeti = t.vegayaYazildi
    ? `<span class="rozet rozet-yesil">Vega'ya işlendi${t.vegaBelgeNo ? ' · ' + xmlKacir(t.vegaBelgeNo) : ''}</span>`
    : '<span class="rozet rozet-gri">Vega\'ya işlenmedi</span>';

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
    @page { size: A4 portrait; margin: 16mm 15mm; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 11px; color: #212529; margin: 0;
      display: flex; flex-direction: column; min-height: 100%;
    }

    .ust { border-bottom: 2.5px solid #1c3d5a; padding-bottom: 10px; margin-bottom: 16px; }
    .ust-satir { display: flex; justify-content: space-between; align-items: flex-end; }
    .kurum { font-size: 15px; font-weight: 700; color: #1c3d5a; letter-spacing: .2px; }
    .kurum-alt { font-size: 10px; color: #6c757d; margin-top: 2px; }
    .belge-no { text-align: right; font-size: 10px; color: #495057; line-height: 1.7; }
    .belge-no b { color: #1c3d5a; font-size: 12px; }
    h1 {
      font-size: 16px; font-weight: 700; color: #1c3d5a; margin: 14px 0 0;
      text-align: center; letter-spacing: 1.5px; text-transform: uppercase;
    }

    .kunye { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    .kunye td { padding: 5px 8px; border: 1px solid #dee2e6; }
    .kunye .etiket { background: #f1f3f5; color: #495057; width: 17%; font-weight: 600; }

    .urunler { display: flex; gap: 10px; margin-bottom: 14px; }
    .urun { flex: 1; border: 1px solid #dee2e6; border-top-width: 3px; padding: 9px 11px; }
    .urun.dusen { border-top-color: #c92a2a; }
    .urun.artan { border-top-color: #2b8a3e; }
    .urun-baslik {
      font-size: 9px; font-weight: 700; letter-spacing: .8px;
      text-transform: uppercase; margin-bottom: 6px;
    }
    .urun.dusen .urun-baslik { color: #c92a2a; }
    .urun.artan .urun-baslik { color: #2b8a3e; }
    .urun-ad { font-size: 12px; font-weight: 600; line-height: 1.35; margin-bottom: 2px; }
    .urun-kod { font-size: 9px; color: #868e96; margin-bottom: 8px; min-height: 11px; }
    .urun-satir {
      display: flex; justify-content: space-between;
      padding: 3px 0; border-top: 1px solid #f1f3f5; font-size: 10px;
    }
    .urun-satir .deger { font-weight: 600; font-variant-numeric: tabular-nums; }
    .miktar { font-size: 14px; font-weight: 700; }
    .urun.dusen .miktar { color: #c92a2a; }
    .urun.artan .miktar { color: #2b8a3e; }

    .bolum-baslik {
      font-size: 9px; font-weight: 700; color: #1c3d5a; letter-spacing: .8px;
      text-transform: uppercase; margin: 0 0 5px;
    }
    .sebep {
      border: 1px solid #dee2e6; padding: 9px 11px; min-height: 46px;
      font-size: 11px; line-height: 1.5; margin-bottom: 14px;
    }
    .beyan {
      background: #f8f9fa; border-left: 3px solid #1c3d5a;
      padding: 9px 12px; font-size: 10px; line-height: 1.6;
    }

    .alt { margin-top: auto; padding-top: 16px; }
    .imzalar { width: 100%; border-collapse: separate; border-spacing: 8px 0; }
    .imza-hucre { width: 25%; border: 1px solid #ced4da; padding: 8px 10px 6px; vertical-align: top; }
    .imza-unvan {
      font-size: 10px; font-weight: 700; color: #1c3d5a; text-align: center;
      padding-bottom: 6px; margin-bottom: 8px; border-bottom: 1px solid #e9ecef;
    }
    .imza-satir { display: flex; align-items: flex-end; gap: 5px; margin-bottom: 9px; }
    .imza-etiket { font-size: 8px; color: #868e96; white-space: nowrap; }
    .imza-cizgi { flex: 1; border-bottom: 1px dotted #adb5bd; height: 11px; }
    .imza-alan { height: 42px; border-bottom: 1px solid #adb5bd; position: relative; }
    .imza-alan .imza-etiket { position: absolute; bottom: 2px; left: 0; }

    .dip {
      margin-top: 10px; padding-top: 7px; border-top: 1px solid #e9ecef;
      display: flex; justify-content: space-between; font-size: 8px; color: #adb5bd;
    }
    .rozet { display: inline-block; padding: 2px 7px; border-radius: 9px; font-size: 9px; font-weight: 600; }
    .rozet-yesil { background: #d3f9d8; color: #2b8a3e; }
    .rozet-gri { background: #f1f3f5; color: #868e96; }
  </style></head><body>

    <div class="ust">
      <div class="ust-satir">
        <div>
          <div class="kurum">${xmlKacir(t.firmaAdi || 'GALYA')}</div>
          <div class="kurum-alt">${xmlKacir([t.firma, t.donem].filter(Boolean).join(' / '))}${t.depoAdi ? ' · ' + xmlKacir(t.depoAdi) : ''}</div>
        </div>
        <div class="belge-no">
          Tutanak No <b>${xmlKacir(String(t.id || '—'))}</b><br>
          Tarih ${xmlKacir(belgeTarihi(t.tarih))}
        </div>
      </div>
      <h1>Ürün Değişim Tutanağı</h1>
    </div>

    <table class="kunye">
      <tr>
        <td class="etiket">Düzenleyen</td>
        <td>${xmlKacir(t.duzenleyen || '—')}</td>
        <td class="etiket">Depo</td>
        <td>${xmlKacir(t.depoAdi || String(t.depo || '—'))}</td>
      </tr>
      <tr>
        <td class="etiket">Kayıt zamanı</td>
        <td>${xmlKacir(belgeSaatliTarih(t.tarih))}</td>
        <td class="etiket">Stok kaydı</td>
        <td>${vegaRozeti}</td>
      </tr>
    </table>

    <div class="urunler">
      <div class="urun dusen">
        <div class="urun-baslik">Stoktan düşülen ürün</div>
        <div class="urun-ad">${xmlKacir(t.dusenAd || '—')}</div>
        <div class="urun-kod">${xmlKacir(t.dusenKod || '')}</div>
        <div class="urun-satir"><span>Miktar</span><span class="deger miktar">− ${xmlKacir(belgeMiktar(t.dusenMiktar, t.dusenBirim))}</span></div>
        <div class="urun-satir"><span>Birim maliyet</span><span class="deger">${xmlKacir(sayiBicimle(t.dusenMaliyet, 'para'))} TL</span></div>
        <div class="urun-satir"><span>Tutar</span><span class="deger">${xmlKacir(sayiBicimle(dusenTutar, 'para'))} TL</span></div>
      </div>
      <div class="urun artan">
        <div class="urun-baslik">Stoğa eklenen ürün</div>
        <div class="urun-ad">${xmlKacir(t.artanAd || '—')}</div>
        <div class="urun-kod">${xmlKacir(t.artanKod || '')}</div>
        <div class="urun-satir"><span>Miktar</span><span class="deger miktar">+ ${xmlKacir(belgeMiktar(t.artanMiktar, t.artanBirim))}</span></div>
        <div class="urun-satir"><span>Birim maliyet</span><span class="deger">${xmlKacir(sayiBicimle(t.artanMaliyet, 'para'))} TL</span></div>
        <div class="urun-satir"><span>Tutar</span><span class="deger">${xmlKacir(sayiBicimle(artanTutar, 'para'))} TL</span></div>
      </div>
    </div>

    <div class="bolum-baslik">Değişim gerekçesi</div>
    <div class="sebep">${xmlKacir(t.sebep || '')}</div>

    <div class="beyan">
      Yukarıda belirtilen ürün değişimi işletme stoklarında fiilen
      gerçekleşmiştir. Düşülen ve eklenen miktarlar yerinde tespit edilmiş
      olup, bu tutanak taraflarca okunarak imza altına alınmıştır.
    </div>

    <div class="alt">
      <table class="imzalar"><tr>${imzaHucreleri}</tr></table>
      <div class="dip">
        <span>Galya Panel · ${xmlKacir(belgeSaatliTarih(new Date()))} tarihinde oluşturuldu</span>
        <span>Belge kimliği: TUT-${xmlKacir(String(t.id || '0').padStart(6, '0'))}</span>
      </div>
    </div>

  </body></html>`;
}

// --- Dosya adı -------------------------------------------------------------

function dosyaAdiUret(baslik, uzanti) {
  const t = new Date();
  const iki = (n) => String(n).padStart(2, '0');
  const damga = `${t.getFullYear()}-${iki(t.getMonth() + 1)}-${iki(t.getDate())}_${iki(t.getHours())}${iki(t.getMinutes())}`;
  const temiz = String(baslik || 'rapor')
    .replace(/[ğ]/g, 'g').replace(/[Ğ]/g, 'G')
    .replace(/[ü]/g, 'u').replace(/[Ü]/g, 'U')
    .replace(/[ş]/g, 's').replace(/[Ş]/g, 'S')
    .replace(/[ı]/g, 'i').replace(/[İ]/g, 'I')
    .replace(/[ö]/g, 'o').replace(/[Ö]/g, 'O')
    .replace(/[ç]/g, 'c').replace(/[Ç]/g, 'C')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${temiz || 'rapor'}_${damga}.${uzanti}`;
}

function excelDosyayaYaz(rapor, hedefYol) {
  fs.mkdirSync(path.dirname(hedefYol), { recursive: true });
  fs.writeFileSync(hedefYol, excelUret(rapor));
  return hedefYol;
}

module.exports = {
  excelUret,
  excelDosyayaYaz,
  pdfHtml,
  tutanakBelgeHtml,
  dosyaAdiUret,
  xmlKacir
};
