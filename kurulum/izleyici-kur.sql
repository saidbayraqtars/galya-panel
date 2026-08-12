/* ============================================================
   VegaWinA5'in gerçekte hangi SQL'i çalıştırdığını yakalama
   ============================================================

   Kullanım:
     1. Bu betiği çalıştır  ->  izleyici başlar
        sqlcmd -S localhost -E -i kurulum\izleyici-kur.sql
     2. VegaWinA5'i aç, öğrenmek istediğin işlemi YAP
        (örn. Stok Yönetimi > Araçlar > Maliyetlendirme)
     3. kurulum\izleyici-oku.sql ile yakalananları oku
     4. Bitince kurulum\izleyici-kapat.sql ile kapat

   Not: Yalnız okuma yapar, hiçbir veriyi değiştirmez.
        Vega'nın client_app_name'i "Arctos|~|..." veya "vegawin..." biçimindedir;
        okuma betiği kendi programımızın (node-mssql) sorgularını ayıklar.
   ============================================================ */

IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = 'galya_vega_izleyici')
    DROP EVENT SESSION [galya_vega_izleyici] ON SERVER;
GO

CREATE EVENT SESSION [galya_vega_izleyici] ON SERVER
  ADD EVENT sqlserver.sql_statement_completed (
      ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
      WHERE sqlserver.database_name = N'VEGADB'
  ),
  ADD EVENT sqlserver.rpc_completed (
      ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
      WHERE sqlserver.database_name = N'VEGADB'
  ),
  ADD EVENT sqlserver.sql_batch_completed (
      ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
      WHERE sqlserver.database_name = N'VEGADB'
  )
  ADD TARGET package0.ring_buffer (SET max_memory = 32768)
  WITH (MAX_DISPATCH_LATENCY = 3 SECONDS, TRACK_CAUSALITY = ON, MAX_MEMORY = 32 MB);
GO

ALTER EVENT SESSION [galya_vega_izleyici] ON SERVER STATE = START;
GO

PRINT 'Izleyici basladi. Simdi VegaWinA5 uzerinde ogrenmek istedigin islemi yap.';
GO
