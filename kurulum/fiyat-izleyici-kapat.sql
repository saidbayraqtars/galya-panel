/* Fiyat izleyicisini kapatır ve siler (kayıt dosyaları diskte kalır).
   sqlcmd -S localhost -E -C -i kurulum\fiyat-izleyici-kapat.sql            */

IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = 'vega_fiyat_izleyici')
    ALTER EVENT SESSION [vega_fiyat_izleyici] ON SERVER STATE = STOP;
GO

IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = 'vega_fiyat_izleyici')
    DROP EVENT SESSION [vega_fiyat_izleyici] ON SERVER;
GO

PRINT 'Fiyat izleyicisi kapatildi. Kayitlar: C:\Users\Public\vega-fiyat-izleyici\';
GO
