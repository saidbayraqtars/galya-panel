/* ============================================================
   Galya Panel — SQL kullanıcısı oluşturma
   ============================================================

   Bu betiği SQL Server'ın kurulu olduğu makinede, yönetici yetkisi olan
   bir hesapla BİR KEZ çalıştırın:

     sqlcmd -S localhost -E -i sql-kullanici-olustur.sql

   Ne yapar:
     - galya_panel adında bir SQL kullanıcısı oluşturur
     - VEGADB ve sefim veritabanlarında SADECE OKUMA yetkisi verir
     - Panelin kendi veritabanı GALYA_PANEL'i oluşturur ve bu veritabanında
       tam yetki verir

   Panel programı VEGADB'ye yazamaz; yazma yetkisi bilerek verilmemiştir.
   İleride Vega'ya yazma açılacaksa bu dosyanın en altındaki bölüm
   yorumdan çıkarılır.

   ÖNEMLİ: Aşağıdaki şifreyi değiştirin ve programın ayarlar.json
   dosyasına aynı şifreyi yazın.
   ============================================================ */

DECLARE @sifre NVARCHAR(100) = N'Galya!Panel2026';   -- <<< BURAYI DEĞİŞTİRİN

/* --- 1. Giriş (login) --- */
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'galya_panel')
BEGIN
    DECLARE @sql NVARCHAR(MAX) =
      N'CREATE LOGIN [galya_panel] WITH PASSWORD = N''' + REPLACE(@sifre, '''', '''''') + N''', ' +
      N'CHECK_POLICY = OFF, DEFAULT_DATABASE = [master];';
    EXEC sp_executesql @sql;
    PRINT 'galya_panel girişi oluşturuldu.';
END
ELSE
    PRINT 'galya_panel girişi zaten var.';
GO

/* --- 2. Panelin kendi veritabanı --- */
IF DB_ID(N'GALYA_PANEL') IS NULL
BEGIN
    CREATE DATABASE [GALYA_PANEL];
    PRINT 'GALYA_PANEL veritabanı oluşturuldu.';
END
GO

USE [GALYA_PANEL];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'galya_panel')
    CREATE USER [galya_panel] FOR LOGIN [galya_panel];
ALTER ROLE db_owner ADD MEMBER [galya_panel];
PRINT 'GALYA_PANEL üzerinde tam yetki verildi.';
GO

/* --- 3. VEGADB: sadece okuma --- */
USE [VEGADB];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'galya_panel')
    CREATE USER [galya_panel] FOR LOGIN [galya_panel];
ALTER ROLE db_datareader ADD MEMBER [galya_panel];
PRINT 'VEGADB üzerinde okuma yetkisi verildi.';
GO

/* --- 4. sefim: sadece okuma --- */
USE [sefim];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'galya_panel')
    CREATE USER [galya_panel] FOR LOGIN [galya_panel];
ALTER ROLE db_datareader ADD MEMBER [galya_panel];
PRINT 'sefim üzerinde okuma yetkisi verildi.';
GO

/* ============================================================
   AŞAĞISI KAPALI — Vega'ya yazma açılacağı zaman kullanılır.
   Açmadan önce VEGADB yedeğini alın ve önce DEMO firmasında deneyin.
   ============================================================

USE [VEGADB];
ALTER ROLE db_datawriter ADD MEMBER [galya_panel];
GRANT EXECUTE ON SCHEMA::dbo TO [galya_panel];

============================================================ */
