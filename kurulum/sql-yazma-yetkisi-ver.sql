/* ============================================================
   Galya Panel — VEGADB yazma yetkisi
   ============================================================

   NE ZAMAN GEREKİR:
   Programdaki "Vega'ya yazma" bayrağı açık olsa bile, SQL kullanıcısı
   VEGADB üzerinde salt okunur kurulduğu için yazma işlemleri şu hatayla
   düşer:

     The INSERT permission was denied on the object '...'

   Bu betik galya_panel kullanıcısına VEGADB üzerinde yazma yetkisi verir.
   Yani programın ikinci emniyet kilidini kaldırır.

   ÖNCE:
     1. VEGADB'nin YEDEĞİNİ ALIN. Bu betikten sonra program gerçek veriye
        yazabilir hale gelir.
     2. Yazma işlemlerinin GALYA_TEST üzerinde geçtiğini görün:
          node kurulum/test-yazma.js --kur
          node kurulum/test-yazma.js

   NASIL ÇALIŞTIRILIR (yönetici yetkisi olan bir hesapla):

     sqlcmd -S localhost -E -C -i kurulum/sql-yazma-yetkisi-ver.sql

   GERİ ALMAK İÇİN en alttaki bölüm kullanılır.
   ============================================================ */

USE [VEGADB];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'galya_panel')
    CREATE USER [galya_panel] FOR LOGIN [galya_panel];
ALTER ROLE db_datareader ADD MEMBER [galya_panel];
ALTER ROLE db_datawriter ADD MEMBER [galya_panel];
PRINT 'VEGADB: okuma + yazma yetkisi verildi.';
GO

/* Üretim fişi 96/97 numarasını kilitli okurken tablo üzerinde UPDLOCK
   alıyor; db_datawriter bunun için yeterlidir, ek yetki gerekmez. */

/* ------------------------------------------------------------
   GERİ ALMA — yazma yetkisini kaldırır, okuma kalır:

   USE [VEGADB];
   ALTER ROLE db_datawriter DROP MEMBER [galya_panel];
   PRINT 'VEGADB: yazma yetkisi kaldırıldı.';
   ------------------------------------------------------------ */
