/*
  Galya Panel — yedekleme ve geri yükleme yetkisi

  Panelin "Yedekleme merkezi" ekranı çalışsın diye galya_panel kullanıcısına
  yedek alma (ve istenirse geri yükleme) yetkisi verir.

  ÇALIŞTIRMA
    sqlcmd -S localhost -E -C -i kurulum/sql-yedek-yetkisi-ver.sql
  ya da SSMS'te yönetici (sysadmin) olarak açıp çalıştırın.

  NEDEN AYRI BİR DOSYA
    galya_panel kullanıcısı VEGADB üzerinde salt okunur kuruluyor
    (kurulum/sql-kullanici-olustur.sql). Yedek yetkisi kendiliğinden
    açılmıyor; bu dosya bilinçli olarak elle çalıştırılmak zorunda.

  YEDEK DOSYASI NEREYE DÜŞER
    BACKUP komutunu SQL Server SERVİSİ çalıştırır. Verdiğiniz klasör
    SUNUCUNUN diskinde aranır, panelin kurulu olduğu bilgisayarda değil.
    Ayrıca SQL Server servis hesabının o klasöre YAZMA izni olmalı.
    Klasörü panelin Ayarlar ekranından yazıyorsunuz; boş bırakılırsa
    SQL Server'ın kendi varsayılan yedek klasörü kullanılır.
*/

USE master;
GO

DECLARE @kullanici SYSNAME = N'galya_panel';

-- Ayarlarınızda başka veritabanı adları varsa burayı düzeltin.
DECLARE @vega  SYSNAME = N'VEGADB';
DECLARE @panel SYSNAME = N'GALYA_PANEL';

DECLARE @sql NVARCHAR(MAX);

-------------------------------------------------------------------------
-- 1. YEDEK ALMA
--
-- db_backupoperator rolü tam yedek, fark yedeği ve günlük yedeği almaya
-- yeter. Veri OKUMA yetkisi vermez; salt okunur kurulum bozulmaz.
-------------------------------------------------------------------------

IF DB_ID(@vega) IS NOT NULL
BEGIN
  SET @sql = N'USE ' + QUOTENAME(@vega) + N';
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @k)
      CREATE USER ' + QUOTENAME(@kullanici) + N' FOR LOGIN ' + QUOTENAME(@kullanici) + N';
    ALTER ROLE db_backupoperator ADD MEMBER ' + QUOTENAME(@kullanici) + N';';
  EXEC sp_executesql @sql, N'@k SYSNAME', @kullanici;
  PRINT N'Yedek yetkisi verildi: ' + @vega;
END
ELSE
  PRINT N'ATLANDI - veritabani bulunamadi: ' + @vega;

IF DB_ID(@panel) IS NOT NULL
BEGIN
  SET @sql = N'USE ' + QUOTENAME(@panel) + N';
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @k)
      CREATE USER ' + QUOTENAME(@kullanici) + N' FOR LOGIN ' + QUOTENAME(@kullanici) + N';
    ALTER ROLE db_backupoperator ADD MEMBER ' + QUOTENAME(@kullanici) + N';';
  EXEC sp_executesql @sql, N'@k SYSNAME', @kullanici;
  PRINT N'Yedek yetkisi verildi: ' + @panel;
END
ELSE
  PRINT N'ATLANDI - veritabani bulunamadi: ' + @panel;

-------------------------------------------------------------------------
-- 2. YEDEK LİSTESİ
--
-- Panel "sunucudaki yedekler" listesini msdb.dbo.backupset tablosundan
-- okuyor. Bu olmadan da çalışır — o zaman yalnızca panelin kendi aldığı
-- yedekler görünür.
-------------------------------------------------------------------------

SET @sql = N'USE msdb;
  IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @k)
    CREATE USER ' + QUOTENAME(@kullanici) + N' FOR LOGIN ' + QUOTENAME(@kullanici) + N';
  GRANT SELECT ON dbo.backupset TO ' + QUOTENAME(@kullanici) + N';
  GRANT SELECT ON dbo.backupmediafamily TO ' + QUOTENAME(@kullanici) + N';';
EXEC sp_executesql @sql, N'@k SYSNAME', @kullanici;
PRINT N'Yedek listesi okuma yetkisi verildi (msdb).';
GO

-------------------------------------------------------------------------
-- 3. GERİ YÜKLEME
--
-- Müşterinin isteği: "işlemi yanlış yaparsa anında geri dönebilmeli."
-- Panelin Yedekleme merkezi bunu yapabilsin diye galya_panel'in geri
-- yükleyebilmesi gerekiyor.
--
-- NEDEN dbcreator
--   RESTORE, var olan bir veritabanının üstüne yapılıyorsa sysadmin,
--   dbcreator ya da o veritabanının SAHİBİ (dbo) olmayı ister. Ayrıca
--   panel geri yüklemeden önce dosyanın doğru veritabanına ait olduğunu
--   RESTORE HEADERONLY ile denetliyor ve o komut CREATE DATABASE yetkisi
--   istiyor. VEGADB'nin sahipliğini değiştirmek (ALTER AUTHORIZATION) canlı
--   bir ERP'de sahiplik zincirini etkileyebildiği için dbcreator seçildi.
--
-- BUNUN BEDELİ
--   dbcreator, galya_panel'e bu sunucudaki HERHANGİ bir veritabanını
--   oluşturma, değiştirme ve SİLME yetkisi verir. galya_panel'in şifresi
--   ayarlar.json içinde DÜZ METİN duruyor; o dosyayı okuyabilen biri bu
--   yetkiyi de eline geçirir.
--
--   Bunu istemiyorsanız aşağıdaki satırı yoruma alın. Panel yedek ALMAYA
--   devam eder, yalnızca geri yükleme çalışmaz; gerektiği gün SSMS'ten bir
--   yönetici yedeği geri yükler. Geri almak için:
--       ALTER SERVER ROLE dbcreator DROP MEMBER [galya_panel];
-------------------------------------------------------------------------

ALTER SERVER ROLE dbcreator ADD MEMBER [galya_panel];
PRINT N'Geri yukleme yetkisi verildi (dbcreator).';
GO

-------------------------------------------------------------------------
-- Denetim: yetki gerçekten geçti mi?
-------------------------------------------------------------------------
EXECUTE AS LOGIN = N'galya_panel';
SELECT
  N'VEGADB yedek alabilir'  AS Kontrol,
  HAS_PERMS_BY_NAME(N'[VEGADB]', N'DATABASE', N'BACKUP DATABASE') AS Sonuc
UNION ALL
SELECT
  N'GALYA_PANEL yedek alabilir',
  HAS_PERMS_BY_NAME(N'[GALYA_PANEL]', N'DATABASE', N'BACKUP DATABASE')
UNION ALL
SELECT
  N'Geri yukleme yetkisi (dbcreator)',
  CAST(IS_SRVROLEMEMBER(N'dbcreator') AS INT);
REVERT;
GO
