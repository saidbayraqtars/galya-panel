-- ===========================================================================
-- Öksüz 96/97 satırları: TBLSHAREKET onarımı
-- ===========================================================================
--
-- SORUN
-- -----
-- Panel 09.09.2026'dan önce üretim fişi yazarken TBLSHAREKET satırını hiç
-- yazmıyordu; yalnız TBLSTOKHAREKETLERI'ye yazıp LN'yi kendi uydurduğu bir
-- sayıdan veriyordu. İki sonucu var:
--
--   1. Belge Vega'nın Üretim Giriş / Çıkış Fişi ekranında SATIRSIZ görünür.
--   2. TBLSHAREKET IDENTITY'si hiç ilerlemediği için Vega'nın yazacağı
--      SONRAKİ satırlar bu uydurma LN'lerle ÇAKIŞIR. O anda eski öksüz
--      hareket, yeni belgenin satırı gibi görünmeye başlar.
--
-- (2) sessiz bir veri bozulmasıdır ve kullanmaya başlamadan ÖNCE
-- kapatılmalıdır.
--
-- Galya'nın VEGADB'sinde 25.08.2026 tarihli iki fiş (A0000290, A0000291)
-- 10 öksüz satır bırakmış. IDENT_CURRENT 176422; öksüz LN'ler 176423-176432.
-- Yani Vega'nın yazacağı ilk 10 satır tam bu aralığa düşecek.
--
-- NE YAPAR
-- --------
-- Belgeleri SİLMEZ. Eksik TBLSHAREKET satırlarını hareketten üreterek aynı
-- IND ile geri koyar (IDENTITY_INSERT). Böylece hem belgeler Vega'da
-- açılır hem de IDENTITY 176432'nin ötesine geçtiği için çakışma kalmaz.
--
-- NASIL ÇALIŞTIRILIR
-- ------------------
--   1. Önce YEDEK alın. Bu canlı veritabanı.
--   2. @firma / @donem / @vt değerlerini kontrol edin.
--   3. Önce ADIM 1'i (sadece SELECT) çalıştırıp listeyi görün.
--   4. Liste beklediğiniz gibiyse ADIM 2'yi çalıştırın.
--   5. ADIM 3 doğrulamasında "onarilacak = 0" görmelisiniz.
-- ===========================================================================

USE VEGADB;
GO

-- Tablo adları F0102 / D0002 içindir. Başka firma/dönemde çalıştıracaksanız
-- her F0102D0002... ve F0102... adını kendi firma/dönem kodunuzla değiştirin.

-- --------------------------------------------------------------- ADIM 1
-- Öksüz satırları listele. Hiçbir şey değiştirmez.

SELECT H.BELGENO, H.IZAHAT, H.LN, H.TARIH, H.STOKNO, H.DEPO,
       H.GIREN, H.CIKAN, H.BIRIMFIYAT, H.TUTAR
FROM F0102D0002TBLSTOKHAREKETLERI H
WHERE H.IZAHAT IN (96, 97)
  AND NOT EXISTS (SELECT 1 FROM F0102D0002TBLSHAREKET S WHERE S.IND = H.LN)
ORDER BY H.LN;

SELECT IDENT_CURRENT('F0102D0002TBLSHAREKET') AS shareket_ident_current;
GO

-- --------------------------------------------------------------- ADIM 2
-- Eksik satırları aynı IND ile geri koy.

BEGIN TRAN;

SET IDENTITY_INSERT F0102D0002TBLSHAREKET ON;

INSERT INTO F0102D0002TBLSHAREKET
  (IND, TARIH, DETAY, SELECTED, EVRAKNO, FIRMANO, STOKNO, MALINCINSI, STOKKODU,
   STOKTIPI, MIKTAR, BIRIMMIKTAR, BIRIM, BIRIMEX, KDV, AFIYATI, FIYATI,
   GERCEKTOPLAM, DEPO, SERIMIKTAR, ENVANTER, TERMIN, PARABIRIMI, KUR,
   GK, ACIKLAMA,
   KDVTUTARI, ISK1, ISK2, ISK3, ISK4, PERSONEL, PIRIM, OPSIYON,
   PROMOSYON, SATISKOSULU, KARSISTOKKODU, KARSIBARKOD, TAKSIT, BARKOD,
   PESINAT, MASRAF, MASRAFKDV, OIV, INDIRIM, OTV, GRUPMIKTAR)
SELECT
   H.LN, H.TARIH, 0, 0, H.BELGENO, 0, H.STOKNO,
   ISNULL(K.MALINCINSI, ''), ISNULL(K.STOKKODU, ''),
   ISNULL(H.STOKTIPI, ISNULL(K.STOKTIPI, 0)),
   H.GIREN + H.CIKAN, 1, ISNULL(B.BIRIMADI, ''), ISNULL(H.BIRIMEX, 0),
   0, H.BIRIMFIYAT, H.BIRIMFIYAT,
   H.TUTAR, H.DEPO, 1, H.GIREN + H.CIKAN, '1899-12-30', 'TL', 1,
   ABS(CHECKSUM(NEWID())) % 2147483647 - 1073741823, '',
   0, 0, 0, 0, 0, 0, 0, 0,
   0, 0, '', '', 0, '',
   0, 0, 0, 0, 0, 0, 1
FROM F0102D0002TBLSTOKHAREKETLERI H
LEFT JOIN F0102TBLSTOKLAR K ON K.IND = H.STOKNO
LEFT JOIN F0102TBLBIRIMLEREX B ON B.STOKNO = H.STOKNO AND B.VARSAYILAN = 1
WHERE H.IZAHAT IN (96, 97)
  AND NOT EXISTS (SELECT 1 FROM F0102D0002TBLSHAREKET S WHERE S.IND = H.LN);

SET IDENTITY_INSERT F0102D0002TBLSHAREKET OFF;

-- Beklenen: 10 satır. Farklıysa ROLLBACK yapın.
SELECT @@ROWCOUNT AS eklenen;

COMMIT;
GO

-- --------------------------------------------------------------- ADIM 3
-- Doğrulama: onarilacak 0, ident_current en büyük LN'den küçük olmamalı.

SELECT COUNT(*) AS onarilacak
FROM F0102D0002TBLSTOKHAREKETLERI H
WHERE H.IZAHAT IN (96, 97)
  AND NOT EXISTS (SELECT 1 FROM F0102D0002TBLSHAREKET S WHERE S.IND = H.LN);

SELECT IDENT_CURRENT('F0102D0002TBLSHAREKET') AS shareket_ident_current,
       MAX(IND) AS en_buyuk_ind
FROM F0102D0002TBLSHAREKET;
GO
