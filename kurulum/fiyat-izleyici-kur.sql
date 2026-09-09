/* ============================================================
   Vega fiyatlama mantığını yakalama (kılavuz §61)
   ============================================================

   NEDEN: Bir müşteriye hangi fiyat listesinin (SATISFIYATI1..6) ve hangi
   TBLPROTOKOL kuralının uygulandığını Vega **istemci tarafında** hesaplıyor;
   veritabanında bunu yapan tek bir view/prosedür yok (arandı, bulunamadı).
   Öğrenmenin tek yolu, Vega fiyatı çekerken çalıştırdığı SQL'i yakalamak.

   KULLANIM:
     1. sqlcmd -S localhost -E -C -i kurulum\fiyat-izleyici-kur.sql
     2. Arctos'u aç → Satış > Sipariş (ya da fatura) → bir CARİ seç →
        bir STOK satırı ekle. Fiyat ekrana geldiği an yakalanır.
        Kuralların dolu olduğu bir firmada yapın (protokol satırı olmayan
        firmada yakalanan sorgu yalnız fiyat listesini gösterir).
     3. node kurulum\izleyici-oku.js  (dosya yolunu aşağıdakiyle değiştirerek)
        ya da:
        SELECT CAST(event_data AS XML) FROM sys.fn_xe_file_target_read_file(
          'C:\Users\Public\vega-fiyat-izleyici\fiyat*.xel', NULL, NULL, NULL);
     4. Bitince: kurulum\fiyat-izleyici-kapat.sql

   Yalnız okur; hiçbir veriyi değiştirmez. Süzgeç dar tutuldu (yalnızca
   PROTOKOL / SATISFIYATI geçen ifadeler), bu yüzden dosya küçük kalır.
   ============================================================ */

IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = 'vega_fiyat_izleyici')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = 'vega_fiyat_izleyici')
        ALTER EVENT SESSION [vega_fiyat_izleyici] ON SERVER STATE = STOP;
    DROP EVENT SESSION [vega_fiyat_izleyici] ON SERVER;
END
GO

EXEC xp_create_subdir N'C:\Users\Public\vega-fiyat-izleyici';
GO

CREATE EVENT SESSION [vega_fiyat_izleyici] ON SERVER
  ADD EVENT sqlserver.rpc_completed (
      ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.database_name)
      WHERE ([sqlserver].[like_i_sql_unicode_string]([sqlserver].[sql_text], N'%PROTOKOL%')
          OR [sqlserver].[like_i_sql_unicode_string]([sqlserver].[sql_text], N'%SATISFIYATI%'))
  ),
  ADD EVENT sqlserver.sql_batch_completed (
      ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.database_name)
      WHERE ([sqlserver].[like_i_sql_unicode_string]([sqlserver].[sql_text], N'%PROTOKOL%')
          OR [sqlserver].[like_i_sql_unicode_string]([sqlserver].[sql_text], N'%SATISFIYATI%'))
  )
  ADD TARGET package0.event_file (
      SET filename = N'C:\Users\Public\vega-fiyat-izleyici\fiyat.xel',
          max_file_size = 64,        -- MB
          max_rollover_files = 4
  )
  WITH (MAX_DISPATCH_LATENCY = 3 SECONDS, MAX_MEMORY = 32 MB, TRACK_CAUSALITY = ON);
GO

ALTER EVENT SESSION [vega_fiyat_izleyici] ON SERVER STATE = START;
GO

PRINT 'Fiyat izleyicisi basladi: C:\Users\Public\vega-fiyat-izleyici\fiyat.xel';
PRINT 'Simdi Arctos ta bir siparise cari + stok satiri ekleyin.';
GO
