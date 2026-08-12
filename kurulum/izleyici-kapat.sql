/* Yakalamayı bitir ve izleyiciyi kaldır. */
IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = 'galya_vega_izleyici')
BEGIN
    ALTER EVENT SESSION [galya_vega_izleyici] ON SERVER STATE = STOP;
    DROP EVENT SESSION [galya_vega_izleyici] ON SERVER;
    PRINT 'Izleyici kapatildi ve kaldirildi.';
END
ELSE
    PRINT 'Izleyici zaten yok.';
GO
