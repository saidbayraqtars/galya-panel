'use strict';

const { sorgu } = require('./sql');
const { kart, tabloVarMi } = require('./firma');

// Üretim yeri kimliği depo kimliği değildir. Pozisyon verisi okunamıyorsa
// varsayılan depoya sessizce düşmeyiz; yalnız bulunmayan tablo boş sayılır.
async function pozisyonlariOku(v, firma, receteNo) {
  if (!receteNo || !(await tabloVarMi(firma, '', 'TBLURERECETEPOZ'))) return [];
  return sorgu(
    `SELECT SIRANO AS sira, KOD AS kod, ISNULL(ACIKLAMA,'') AS aciklama,
            POZISYONNO AS pozisyonNo, URETIMYERINO AS yerNo,
            ISNULL(URETIMYERIKODU,'') AS yerKodu,
            ISNULL(DEPONO,0) AS depoNo, ISNULL(DEPOKODU,'') AS depoKodu
     FROM ${kart(v, firma, 'TBLURERECETEPOZ')}
     WHERE EVRAKNO = @receteNo ORDER BY SIRANO`, { receteNo }
  );
}

// BAŞLA / BİTİR adımı SIRANO ile değil KOD ile bulunur. F0102'de üç reçetede
// üç adım var ve sıralar tutarsız: 4481 KUZU KULAĞI MİX ile 4529 Sushi Tavuk
// Salata'da BİTİR 3. sırada; 1153 Rakı.Beylerbeyi'nde BİTİR 2. sırada, 3.
// sırada deposu boş ikinci bir BAŞLA duruyor. "sira === 2" kuralı 4481/4529'da
// BİTİR deposunu hiç görmüyor ve mamulü seçilen depoya yazıyordu.
function adimBul(pozlar, kod, sonuncu) {
  const norm = (k) => String(k || '').trim().toLocaleUpperCase('tr');
  const eslesen = pozlar.filter((p) => norm(p.kod) === kod);
  if (eslesen.length) {
    // Birden fazla varsa deposu dolu olan kazanır (1153'teki boş BAŞLA gibi).
    const dolu = eslesen.filter((p) => Number(p.depoNo) > 0);
    const aday = dolu.length ? dolu : eslesen;
    return sonuncu ? aday[aday.length - 1] : aday[0];
  }
  if (!pozlar.length) return null;
  return sonuncu ? pozlar[pozlar.length - 1] : pozlar[0];
}

function depoSecimi(pozlar, istenen, varsayilan) {
  const bitir = adimBul(pozlar, 'BİTİR', true);
  const basla = adimBul(pozlar, 'BAŞLA', false);
  const mamulDeposu = Number((bitir && bitir.depoNo) || istenen || varsayilan || 1);
  const uretimDeposu = Number((basla && basla.depoNo) || mamulDeposu);
  if (![mamulDeposu, uretimDeposu].every((d) => Number.isInteger(d) && d > 0)) {
    throw new Error('Üretim için geçerli bir depo seçilmeli.');
  }
  return {
    mamulDeposu, uretimDeposu,
    // Reçete mamul deposunu kendisi belirliyorsa ekran depo seçicisini kilitler.
    receteDeposu: !!(bitir && Number(bitir.depoNo) > 0),
    depoUyarisi: bitir && Number(bitir.depoNo) > 0 && Number(istenen || varsayilan) !== mamulDeposu
      ? `Reçetenin BİTİR deposu kullanılacak: ${bitir.depoKodu || mamulDeposu}. Seçilen depo reçeteyi değiştirmez.`
      : ''
  };
}

module.exports = { pozisyonlariOku, depoSecimi, adimBul };
