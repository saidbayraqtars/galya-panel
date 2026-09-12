/* ============================================================
   Galya Panel — restore sonrası yetki tazeleme
   ============================================================

   NE ZAMAN GEREKİR:
   VEGADB veya sefim veritabanı yedekten geri yüklendiğinde (restore),
   veritabanının içindeki kullanıcı listesi de yedekten gelir. Yedek başka
   bir sunucudan geldiği için `galya_panel` kullanıcısı ya hiç yoktur ya da
   sunucudaki giriş (login) ile SID'i tutmaz — "öksüz kullanıcı" olur.
   Panel o anda şu hatayı verir:

     Login failed for user 'galya_panel'.

   Giriş aslında sunucuda durur; başarısız olan, VEGADB'yi açmaktır.

   NASIL ÇALIŞTIRILIR (yönetici yetkisi olan bir hesapla):

     sqlcmd -S localhost -E -C -i kurulum/sql-yetki-tazele.sql

   Bu betik SADECE OKUMA yetkisi verir. VEGADB'ye yazma yetkisi bilerek
   verilmez; onu açmak için sql-kullanici-olustur.sql dosyasının en altındaki
   bölüm kullanılır.
   ============================================================ */

USE [VEGADB];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'galya_panel')
    CREATE USER [galya_panel] FOR LOGIN [galya_panel];
ELSE
    ALTER USER [galya_panel] WITH LOGIN = [galya_panel];   /* öksüz kalmışsa SID'i tazeler */
ALTER ROLE db_datareader ADD MEMBER [galya_panel];
PRINT 'VEGADB: okuma yetkisi verildi.';
GO

USE [sefim];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'galya_panel')
    CREATE USER [galya_panel] FOR LOGIN [galya_panel];
ELSE
    ALTER USER [galya_panel] WITH LOGIN = [galya_panel];
ALTER ROLE db_datareader ADD MEMBER [galya_panel];
PRINT 'sefim: okuma yetkisi verildi.';
GO

/* Otomatik kapanma (AUTO_CLOSE) yedekle birlikte gelir: Galya'nın sefim ve
   VEGADB yedeklerinde AÇIK. Açıkken veritabanı her sorgudan sonra kapanıp
   bir sonrakinde yeniden açılıyor; 12.09.2026'da sefim 8 saniyede 12 kez
   açıldı, aktarım ekranı "Yükleniyor…"da kaldı. Veriye dokunmaz. */
ALTER DATABASE [VEGADB] SET AUTO_CLOSE OFF;
ALTER DATABASE [sefim] SET AUTO_CLOSE OFF;
PRINT 'VEGADB, sefim: otomatik kapanma kapatıldı.';
GO

/* Panelin kendi veritabanı restore edilmez, ama tamlık olsun diye burada. */
USE [GALYA_PANEL];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'galya_panel')
    CREATE USER [galya_panel] FOR LOGIN [galya_panel];
ELSE
    ALTER USER [galya_panel] WITH LOGIN = [galya_panel];
ALTER ROLE db_owner ADD MEMBER [galya_panel];
PRINT 'GALYA_PANEL: tam yetki verildi.';
GO
