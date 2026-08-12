/* ============================================================
   VegaWinA5'in gerçekte hangi SQL'i çalıştırdığını yakalama
   ============================================================

   Kullanım:
     1. Bu betiği çalıştır  ->  izleyici başlar
        sqlcmd -S localhost -E -i kurulum\izleyici-kur.sql
     2. VegaWinA5'i aç, öğrenmek istediğin işlemi YAP
        (örn. Stok Yönetimi > Araçlar > Maliyetlendirme)
     3. node kurulum\izleyici-oku.js  ile yakalananları oku
     4. Bitince kurulum\izleyici-kapat.sql ile kapat

   Not: Yalnız okuma yapar, hiçbir veriyi değiştirmez.

   Neden dosya hedefi?
     Halka tampon (ring buffer) varsayılan olarak yalnız son 1000 olayı
     tutar. Maliyetlendirme tek seferde on binlerce ifade çalıştırdığı için
     baştaki asıl önemli kısım düşüyordu. Dosya hedefi hiç olay kaybetmez.

   sql_statement_completed olayı ALINMIYOR: her ifade zaten
   sql_batch_completed olarak da geliyor, ikisi bir arada dosyayı
   gereksiz yere iki katına çıkarıyor.
   ============================================================ */

IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = 'galya_vega_izleyici')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = 'galya_vega_izleyici')
        ALTER EVENT SESSION [galya_vega_izleyici] ON SERVER STATE = STOP;
    DROP EVENT SESSION [galya_vega_izleyici] ON SERVER;
END
GO

/* Kayıt klasörü yoksa oluştur. Eski .xel dosyalarını okuma betiği eler. */
EXEC xp_create_subdir N'C:\Users\Public\galya-izleyici';
GO

CREATE EVENT SESSION [galya_vega_izleyici] ON SERVER
  ADD EVENT sqlserver.rpc_completed (
      ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
      WHERE sqlserver.database_name = N'VEGADB'
  ),
  ADD EVENT sqlserver.sql_batch_completed (
      ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
      WHERE sqlserver.database_name = N'VEGADB'
  )
  ADD TARGET package0.event_file (
      SET filename = N'C:\Users\Public\galya-izleyici\vega.xel',
          max_file_size = 512,      -- MB
          max_rollover_files = 8
  )
  WITH (MAX_DISPATCH_LATENCY = 3 SECONDS, MAX_MEMORY = 64 MB,
        EVENT_RETENTION_MODE = NO_EVENT_LOSS, TRACK_CAUSALITY = ON);
GO

ALTER EVENT SESSION [galya_vega_izleyici] ON SERVER STATE = START;
GO

PRINT 'Izleyici basladi (dosya hedefi: C:\Users\Public\galya-izleyici\vega.xel).';
PRINT 'Simdi VegaWinA5 uzerinde ogrenmek istedigin islemi yap.';
GO
