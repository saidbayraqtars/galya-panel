'use strict';

// Programın kendi veritabanı: GALYA_PANEL
// Sayım, eşleştirme ve tutanak kayıtları burada tutulur; böylece ağdaki
// bütün bilgisayarlar aynı kayıtları görür. VEGADB'ye hiçbir şey yazılmaz.

const { sorgu, calistir, mssql } = require('./sql');
const { ayarOku } = require('./ayar');

let kuruldu = false;

async function kur() {
  if (kuruldu) return;
  const a = ayarOku();
  const p = a.panelVeritabani;

  await calistir(`
    IF DB_ID(N'${p}') IS NULL
      EXEC('CREATE DATABASE [${p}]');
  `);

  await calistir(`
    USE [${p}];

    IF OBJECT_ID('dbo.UrunEslestirme') IS NULL
    CREATE TABLE dbo.UrunEslestirme (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      Firma         NVARCHAR(10)  NOT NULL,
      SefimUrunAdi  NVARCHAR(400) NOT NULL,
      VegaStokNo    INT           NULL,
      VegaStokAdi   NVARCHAR(400) NULL,
      BirimCarpan   DECIMAL(18,6) NOT NULL DEFAULT 1,
      Yoksay        BIT           NOT NULL DEFAULT 0,
      Aciklama      NVARCHAR(200) NULL,
      Kaydeden      NVARCHAR(100) NULL,
      KayitTarihi   DATETIME      NOT NULL DEFAULT GETDATE()
    );

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_UrunEslestirme')
      CREATE UNIQUE INDEX UX_UrunEslestirme
        ON dbo.UrunEslestirme (Firma, SefimUrunAdi);

    IF OBJECT_ID('dbo.AraSayim') IS NULL
    CREATE TABLE dbo.AraSayim (
      Id           INT IDENTITY(1,1) PRIMARY KEY,
      Firma        NVARCHAR(10) NOT NULL,
      Donem        NVARCHAR(10) NOT NULL,
      Depo         INT          NOT NULL,
      SayimTarihi  DATETIME     NOT NULL DEFAULT GETDATE(),
      Sayan        NVARCHAR(100) NULL,
      Aciklama     NVARCHAR(200) NULL,
      VegayaYazildi BIT         NOT NULL DEFAULT 0,
      VegaBelgeNo  NVARCHAR(50) NULL,
      Iptal        BIT          NOT NULL DEFAULT 0
    );

    IF OBJECT_ID('dbo.AraSayimSatir') IS NULL
    CREATE TABLE dbo.AraSayimSatir (
      Id           INT IDENTITY(1,1) PRIMARY KEY,
      SayimId      INT           NOT NULL,
      StokNo       INT           NOT NULL,
      StokAdi      NVARCHAR(400) NOT NULL,
      Birim        NVARCHAR(20)  NULL,
      TeorikMiktar DECIMAL(18,6) NOT NULL DEFAULT 0,
      SayilanMiktar DECIMAL(18,6) NOT NULL DEFAULT 0,
      Fark         AS (SayilanMiktar - TeorikMiktar) PERSISTED,
      BirimMaliyet DECIMAL(18,6) NOT NULL DEFAULT 0
    );

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AraSayimSatir_Sayim')
      CREATE INDEX IX_AraSayimSatir_Sayim ON dbo.AraSayimSatir (SayimId);

    -- Sayım Vega'ya yazılınca kesilen fişlerin kimlikleri buraya konur;
    -- geri alma bu bilgiyle dört tablodaki satırları tek tek siliyor.
    IF COL_LENGTH('dbo.AraSayim', 'VegaFisler') IS NULL
      ALTER TABLE dbo.AraSayim ADD VegaFisler NVARCHAR(MAX) NULL;

    -- Sayım türü: 'ara' (seçili ürünler) veya 'tam' (kapsamdaki her kart).
    IF COL_LENGTH('dbo.AraSayim', 'Tur') IS NULL
      ALTER TABLE dbo.AraSayim ADD Tur NVARCHAR(10) NOT NULL DEFAULT 'ara';

    -- Onay akışı. Sayım artık kaydedilir kaydedilmez Vega'ya gitmiyor;
    -- yönetici onaylayana kadar 'bekliyor' durumunda bekler.
    IF COL_LENGTH('dbo.AraSayim', 'Durum') IS NULL
      ALTER TABLE dbo.AraSayim ADD Durum NVARCHAR(12) NOT NULL DEFAULT 'bekliyor';
    IF COL_LENGTH('dbo.AraSayim', 'Onaylayan') IS NULL
      ALTER TABLE dbo.AraSayim ADD Onaylayan NVARCHAR(100) NULL;
    IF COL_LENGTH('dbo.AraSayim', 'OnayTarihi') IS NULL
      ALTER TABLE dbo.AraSayim ADD OnayTarihi DATETIME NULL;
    IF COL_LENGTH('dbo.AraSayim', 'RedSebebi') IS NULL
      ALTER TABLE dbo.AraSayim ADD RedSebebi NVARCHAR(300) NULL;

    -- Sayımı yapan kullanıcının kapsamı (KOD2 sınıfları, virgülle ayrık).
    -- Boşsa kapsam sınırsızdır.
    IF COL_LENGTH('dbo.AraSayim', 'Kapsam') IS NULL
      ALTER TABLE dbo.AraSayim ADD Kapsam NVARCHAR(400) NULL;

    -- Onay akışından ÖNCE kaydedilmiş sayımlar 'bekliyor' varsayılanıyla
    -- gelirdi; oysa onlar zaten Vega'ya yazılmıştı. Bir kereye mahsus
    -- düzeltme (yeni kayıtlar zaten doğru durumla açılıyor).
    --
    -- EXEC şart: bu betiğin tamamı tek toplu iş olarak derleniyor ve
    -- ALTER TABLE ile eklenen sütun derleme anında henüz yok. Doğrudan
    -- yazılsaydı "Invalid column name 'Durum'" verirdi.
    EXEC('UPDATE dbo.AraSayim SET Durum = ''onaylandi''
          WHERE VegayaYazildi = 1 AND Durum = ''bekliyor''');

    IF OBJECT_ID('dbo.SayimListesi') IS NULL
    CREATE TABLE dbo.SayimListesi (
      Id        INT IDENTITY(1,1) PRIMARY KEY,
      Firma     NVARCHAR(10)  NOT NULL,
      StokNo    INT           NOT NULL,
      StokAdi   NVARCHAR(400) NOT NULL,
      Sira      INT           NOT NULL DEFAULT 0,
      Aktif     BIT           NOT NULL DEFAULT 1
    );

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_SayimListesi')
      CREATE UNIQUE INDEX UX_SayimListesi ON dbo.SayimListesi (Firma, StokNo);

    IF OBJECT_ID('dbo.Tutanak') IS NULL
    CREATE TABLE dbo.Tutanak (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      Firma         NVARCHAR(10)  NOT NULL,
      Donem         NVARCHAR(10)  NOT NULL,
      Depo          INT           NOT NULL,
      Tarih         DATETIME      NOT NULL DEFAULT GETDATE(),
      DusenStokNo   INT           NOT NULL,
      DusenStokAdi  NVARCHAR(400) NOT NULL,
      DusenMiktar   DECIMAL(18,6) NOT NULL,
      ArtanStokNo   INT           NOT NULL,
      ArtanStokAdi  NVARCHAR(400) NOT NULL,
      ArtanMiktar   DECIMAL(18,6) NOT NULL,
      Sebep         NVARCHAR(300) NULL,
      Duzenleyen    NVARCHAR(100) NULL,
      VegayaYazildi BIT           NOT NULL DEFAULT 0,
      VegaBelgeNo   NVARCHAR(50)  NULL,
      Iptal         BIT           NOT NULL DEFAULT 0
    );

    -- Vega'ya yazılan fiş çiftinin kimlikleri; geri alma bunları kullanıyor.
    IF COL_LENGTH('dbo.Tutanak', 'VegaFisler') IS NULL
      ALTER TABLE dbo.Tutanak ADD VegaFisler NVARCHAR(MAX) NULL;

    IF OBJECT_ID('dbo.ThirdIsaret') IS NULL
    CREATE TABLE dbo.ThirdIsaret (
      Id          INT IDENTITY(1,1) PRIMARY KEY,
      Firma       NVARCHAR(10)  NOT NULL,
      StokNo      INT           NOT NULL,
      StokAdi     NVARCHAR(400) NOT NULL,
      Isaretli    BIT           NOT NULL DEFAULT 1,
      VegayaYazildi BIT         NOT NULL DEFAULT 0,
      Kaydeden    NVARCHAR(100) NULL,
      KayitTarihi DATETIME      NOT NULL DEFAULT GETDATE()
    );

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ThirdIsaret')
      CREATE UNIQUE INDEX UX_ThirdIsaret ON dbo.ThirdIsaret (Firma, StokNo);

    IF OBJECT_ID('dbo.FaturaEslestirme') IS NULL
    CREATE TABLE dbo.FaturaEslestirme (
      Id             INT IDENTITY(1,1) PRIMARY KEY,
      Firma          NVARCHAR(10)  NOT NULL,
      TedarikciVkn   NVARCHAR(20)  NULL,
      FaturaUrunAdi  NVARCHAR(400) NOT NULL,
      VegaStokNo     INT           NULL,
      VegaStokAdi    NVARCHAR(400) NULL,
      BirimCarpan    DECIMAL(18,6) NOT NULL DEFAULT 1,
      KabulEtme      BIT           NOT NULL DEFAULT 0,
      Kaydeden       NVARCHAR(100) NULL,
      KayitTarihi    DATETIME      NOT NULL DEFAULT GETDATE()
    );

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FaturaEslestirme')
      CREATE UNIQUE INDEX UX_FaturaEslestirme
        ON dbo.FaturaEslestirme (Firma, FaturaUrunAdi);

    -- Alış faturası taslağı. Kullanıcı faturayı panelde hazırlar; Vega'ya
    -- yazma ayrı bir onayla olur, böylece yanlış giriş Vega'ya hiç gitmez.
    IF OBJECT_ID('dbo.AlisFatura') IS NULL
    CREATE TABLE dbo.AlisFatura (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      Firma         NVARCHAR(10)  NOT NULL,
      Donem         NVARCHAR(10)  NOT NULL,
      Depo          INT           NOT NULL,
      CariNo        INT           NOT NULL,
      CariAdi       NVARCHAR(400) NOT NULL,
      BelgeNo       NVARCHAR(50)  NULL,
      Tarih         DATE          NOT NULL,
      VadeTarihi    DATE          NULL,
      Aciklama      NVARCHAR(300) NULL,
      AraToplam     DECIMAL(18,4) NOT NULL DEFAULT 0,
      KdvToplam     DECIMAL(18,4) NOT NULL DEFAULT 0,
      GenelToplam   DECIMAL(18,4) NOT NULL DEFAULT 0,
      Duzenleyen    NVARCHAR(100) NULL,
      KayitTarihi   DATETIME      NOT NULL DEFAULT GETDATE(),
      VegayaYazildi BIT           NOT NULL DEFAULT 0,
      VegaBelgeInd  INT           NULL,
      VegaBelgeNo   NVARCHAR(50)  NULL,
      Iptal         BIT           NOT NULL DEFAULT 0
    );

    -- Fatura yazılırken stok kartındaki alış fiyatı alanları değişiyor.
    -- Geri alma bunları eski hâline döndürebilsin diye önceki değerler
    -- burada saklanıyor.
    IF COL_LENGTH('dbo.AlisFatura', 'OncekiFiyatlar') IS NULL
      ALTER TABLE dbo.AlisFatura ADD OncekiFiyatlar NVARCHAR(MAX) NULL;

    IF OBJECT_ID('dbo.AlisFaturaSatir') IS NULL
    CREATE TABLE dbo.AlisFaturaSatir (
      Id          INT IDENTITY(1,1) PRIMARY KEY,
      FaturaId    INT           NOT NULL,
      Sira        INT           NOT NULL DEFAULT 0,
      StokNo      INT           NOT NULL,
      StokAdi     NVARCHAR(400) NOT NULL,
      StokKodu    NVARCHAR(100) NULL,
      Birim       NVARCHAR(20)  NULL,
      BirimEx     INT           NULL,
      Miktar      DECIMAL(18,6) NOT NULL,
      BirimFiyat  DECIMAL(18,6) NOT NULL,
      KdvOrani    DECIMAL(9,4)  NOT NULL DEFAULT 0,
      Tutar       AS (Miktar * BirimFiyat) PERSISTED
    );

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AlisFaturaSatir_Fatura')
      CREATE INDEX IX_AlisFaturaSatir_Fatura ON dbo.AlisFaturaSatir (FaturaId);

    -- Maliyetlendirme geçmişi: karta yazılan maliyetin önceki değeri burada
    -- durur; geri alma bunu kullanır.
    IF OBJECT_ID('dbo.MaliyetYazma') IS NULL
    CREATE TABLE dbo.MaliyetYazma (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      Firma         NVARCHAR(10)  NOT NULL,
      Tarih         DATETIME      NOT NULL DEFAULT GETDATE(),
      Kullanici     NVARCHAR(100) NULL,
      UrunSayisi    INT           NOT NULL DEFAULT 0,
      GeriAlindi    BIT           NOT NULL DEFAULT 0,
      Detay         NVARCHAR(MAX) NULL
    );

    -- Panelin yazdığı üretim fişleri; geri alma bu kayıttan yürüyor.
    IF OBJECT_ID('dbo.UretimFisi') IS NULL
    CREATE TABLE dbo.UretimFisi (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      Firma         NVARCHAR(10)  NOT NULL,
      Donem         NVARCHAR(10)  NOT NULL,
      Depo          INT           NOT NULL,
      Tarih         DATETIME      NOT NULL DEFAULT GETDATE(),
      MamulStokNo   INT           NOT NULL,
      MamulAdi      NVARCHAR(400) NOT NULL,
      Miktar        DECIMAL(18,6) NOT NULL,
      ReceteNo      INT           NULL,
      FisNo         NVARCHAR(50)  NULL,
      UretimInd     INT           NULL,
      Kullanici     NVARCHAR(100) NULL,
      GeriAlindi    BIT           NOT NULL DEFAULT 0,
      Belgeler      NVARCHAR(MAX) NULL
    );

    -- Zayi / personel çıkışı. Bozulan, kırılan, çalışanın elinde kalan mal
    -- buradan giriliyor. Vega karşılığı stok çıkış fişi (belge tipi 33) ve
    -- seçilen carinin (ZAYİ, FİRE ya da personel kartı) borç hareketi.
    -- Fatura gibi önce panelde taslak durur, ayrı onayla Vega'ya yazılır.
    -- Şefim günlük satış aktarımı. Bir satır = bir iş gününün Vega'ya
    -- aktarımı. Yazılan belgelerin IND'leri Belgeler alanında JSON olarak
    -- duruyor; geri alma bunlara bakıyor. Tarih iş günüdür (04:00 kesimi),
    -- takvim günü değil.
    IF OBJECT_ID('dbo.SefimAktarim') IS NULL
    CREATE TABLE dbo.SefimAktarim (
      Id          INT IDENTITY(1,1) PRIMARY KEY,
      Firma       NVARCHAR(10)  NOT NULL,
      Donem       NVARCHAR(10)  NOT NULL,
      Depo        INT           NOT NULL,
      IsGunu      DATE          NOT NULL,
      Tarih       DATETIME      NOT NULL DEFAULT GETDATE(),
      SatisTutari DECIMAL(18,4) NOT NULL DEFAULT 0,
      SatirSayisi INT           NOT NULL DEFAULT 0,
      KasaGiris   DECIMAL(18,4) NOT NULL DEFAULT 0,
      KasaCikis   DECIMAL(18,4) NOT NULL DEFAULT 0,
      BillIdler   NVARCHAR(MAX) NULL,
      Belgeler    NVARCHAR(MAX) NULL,
      Kullanici   NVARCHAR(100) NULL,
      Bilgisayar  NVARCHAR(100) NULL,
      -- 'yaziliyor' → satır aktarım BAŞLAMADAN önce yer tutucu olarak
      -- açılıyor; benzersizlik kısıtı ikinci kişiyi burada durduruyor.
      -- 'tamam'     → belgeler yazıldı.
      -- Yarım kalan (program çakıldı, ağ koptu) satır 'yaziliyor'da kalır ve
      -- eskidiğinde temizlenebilir.
      Durum       NVARCHAR(20)  NOT NULL DEFAULT 'tamam',
      GeriAlindi  BIT           NOT NULL DEFAULT 0
    );

    -- Eski kurulumlarda tablo bu kolonlar olmadan açılmıştı.
    IF COL_LENGTH('dbo.SefimAktarim', 'Durum') IS NULL
      ALTER TABLE dbo.SefimAktarim ADD Durum NVARCHAR(20) NOT NULL DEFAULT 'tamam';
    IF COL_LENGTH('dbo.SefimAktarim', 'Bilgisayar') IS NULL
      ALTER TABLE dbo.SefimAktarim ADD Bilgisayar NVARCHAR(100) NULL;

    -- Aynı iş günü iki kez aktarılmasın. Geri alınan kayıt için engel
    -- olmamalı, o yüzden süzgeçli (filtered) benzersizlik.
    IF OBJECT_ID('dbo.SefimAktarim') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_SefimAktarim_Gun')
      CREATE UNIQUE INDEX UQ_SefimAktarim_Gun
        ON dbo.SefimAktarim (Firma, Donem, IsGunu) WHERE GeriAlindi = 0;

    -- Üretim fişi ve günlük aktarım bağı aynı SQL transaction'ında yazılır.
    -- Üretim geri alınınca bağ silinir; denetim geçmişi UretimFisi'nde kalır.
    IF OBJECT_ID('dbo.SefimAktarimUretim') IS NULL
    CREATE TABLE dbo.SefimAktarimUretim (
      AktarimId INT NOT NULL REFERENCES dbo.SefimAktarim(Id),
      UretimInd INT NOT NULL,
      FisNo NVARCHAR(50) NOT NULL,
      StokNo INT NOT NULL,
      Miktar DECIMAL(18,6) NOT NULL,
      Tarih DATETIME NOT NULL DEFAULT GETDATE(),
      Kullanici NVARCHAR(100) NULL,
      ZayiBaslikInd INT NULL,
      PRIMARY KEY (AktarimId, UretimInd)
    );

    IF OBJECT_ID('dbo.Zayi') IS NULL
    CREATE TABLE dbo.Zayi (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      Firma         NVARCHAR(10)  NOT NULL,
      Donem         NVARCHAR(10)  NOT NULL,
      Depo          INT           NOT NULL,
      Tarih         DATE          NOT NULL,
      CariNo        INT           NOT NULL,
      CariAdi       NVARCHAR(400) NOT NULL,
      AltHesap      NVARCHAR(100) NULL,
      Sebep         NVARCHAR(300) NULL,
      -- Zayi satırlarında birim fiyat 0 mı, kart maliyeti mi yazılacak.
      -- Vega'nın kendi zayi fişlerinde 945 satırın 801'i sıfır fiyatlı.
      MaliyetliMi   BIT           NOT NULL DEFAULT 0,
      Toplam        DECIMAL(18,4) NOT NULL DEFAULT 0,
      Duzenleyen    NVARCHAR(100) NULL,
      KayitTarihi   DATETIME      NOT NULL DEFAULT GETDATE(),
      VegayaYazildi BIT           NOT NULL DEFAULT 0,
      VegaBelgeInd  INT           NULL,
      VegaBelgeNo   NVARCHAR(50)  NULL,
      Iptal         BIT           NOT NULL DEFAULT 0
    );

    IF OBJECT_ID('dbo.ZayiSatir') IS NULL
    CREATE TABLE dbo.ZayiSatir (
      Id          INT IDENTITY(1,1) PRIMARY KEY,
      ZayiId      INT           NOT NULL,
      Sira        INT           NOT NULL DEFAULT 0,
      StokNo      INT           NOT NULL,
      StokAdi     NVARCHAR(400) NOT NULL,
      StokKodu    NVARCHAR(100) NULL,
      Birim       NVARCHAR(20)  NULL,
      BirimEx     INT           NULL,
      Miktar      DECIMAL(18,6) NOT NULL,
      BirimMaliyet DECIMAL(18,6) NOT NULL DEFAULT 0,
      KdvOrani    DECIMAL(9,4)  NOT NULL DEFAULT 0
    );

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ZayiSatir_Zayi')
      CREATE INDEX IX_ZayiSatir_Zayi ON dbo.ZayiSatir (ZayiId);

    -- Panelin ortak belge sayacı (11.09.2026). Bir firma + dönemde panelin
    -- verdiği en büyük GP numarası; geri alınan belgenin numarası yeniden
    -- verilmesin diye tutuluyor. Vega da taranıyor: bkz. yazma.panelBelgeNo.
    IF OBJECT_ID('dbo.BelgeSayac') IS NULL
    CREATE TABLE dbo.BelgeSayac (
      Firma  NVARCHAR(10) NOT NULL,
      Donem  NVARCHAR(10) NOT NULL,
      Onek   NVARCHAR(10) NOT NULL,
      SonNo  INT          NOT NULL,
      Tarih  DATETIME     NOT NULL DEFAULT GETDATE(),
      PRIMARY KEY (Firma, Donem, Onek)
    );

    -- Zayi belgesine göre üretim: hangi zayi fişi için hangi üretim fişi
    -- yazıldı. Üretim fişiyle aynı transaction'da yazılır, üretim geri
    -- alınınca silinir. Bağlı üretim varken zayi fişi Vega'dan geri alınamaz.
    IF OBJECT_ID('dbo.ZayiUretim') IS NULL
    CREATE TABLE dbo.ZayiUretim (
      ZayiId    INT           NOT NULL,
      UretimInd INT           NOT NULL,
      FisNo     NVARCHAR(50)  NOT NULL,
      StokNo    INT           NOT NULL,
      Miktar    DECIMAL(18,6) NOT NULL,
      Tarih     DATETIME      NOT NULL DEFAULT GETDATE(),
      Kullanici NVARCHAR(100) NULL,
      PRIMARY KEY (ZayiId, UretimInd)
    );

    -- Kullanıcılar. Giriş yalnızca PIN'ledir: kullanıcı adı seçilmez, girilen
    -- PIN hangi kullanıcıya aitse o kişi olarak giriş yapılır. Bu yüzden PIN
    -- benzersiz olmak zorunda; oturum.js yeni PIN'i kaydetmeden önce
    -- mevcutların hepsiyle karşılaştırıyor.
    --
    -- Yetkiler tek bir JSON alanında: { sayim, tamSayim, zayi, uretim,
    -- siniflar: ['BAR'] }. Ayrı tablo açmak bu boyuttaki bir yetki kümesi
    -- için ekranı da kodu da gereksiz büyütürdü.
    IF OBJECT_ID('dbo.Kullanici') IS NULL
    CREATE TABLE dbo.Kullanici (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      Ad            NVARCHAR(100) NOT NULL,
      PinTuz        NVARCHAR(64)  NOT NULL,
      PinOzet       NVARCHAR(128) NOT NULL,
      Rol           NVARCHAR(20)  NOT NULL DEFAULT 'kullanici',
      Yetkiler      NVARCHAR(MAX) NULL,
      Aktif         BIT           NOT NULL DEFAULT 1,
      Olusturan     NVARCHAR(100) NULL,
      KayitTarihi   DATETIME      NOT NULL DEFAULT GETDATE(),
      DegisimTarihi DATETIME      NULL
    );

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Kullanici_Ad')
      CREATE UNIQUE INDEX UX_Kullanici_Ad ON dbo.Kullanici (Ad);

    -- Yönetici PIN'i. Tek satır (Id = 1) tutulur; PinTuz/PinOzet NULL ise
    -- PIN tanımlı değildir ve program herkese yönetici gibi davranır.
    --
    -- Kullanıcı tablosu gelince bu tablo geçmişe dönük uyum için kaldı:
    -- kur() sırasında buradaki PIN varsa ve henüz kullanıcı yoksa
    -- "Yönetici" adında bir kullanıcıya taşınıyor (aşağıda).
    IF OBJECT_ID('dbo.Guvenlik') IS NULL
    CREATE TABLE dbo.Guvenlik (
      Id            INT           NOT NULL PRIMARY KEY,
      PinTuz        NVARCHAR(64)  NULL,
      PinOzet       NVARCHAR(128) NULL,
      Degistiren    NVARCHAR(100) NULL,
      DegisimTarihi DATETIME      NULL,
      CONSTRAINT CK_Guvenlik_TekSatir CHECK (Id = 1)
    );

    IF NOT EXISTS (SELECT 1 FROM dbo.Guvenlik WHERE Id = 1)
      INSERT INTO dbo.Guvenlik (Id) VALUES (1);

    -- Tek yönetici PIN'inden çok kullanıcıya geçiş. Eskiden belirlenmiş PIN
    -- kaybolmasın diye "Yönetici" adlı kullanıcıya aynı özetle taşınıyor;
    -- kullanan kişi güncellemeden sonra da eski PIN'iyle giriyor.
    IF NOT EXISTS (SELECT 1 FROM dbo.Kullanici)
       AND EXISTS (SELECT 1 FROM dbo.Guvenlik WHERE Id = 1 AND PinTuz IS NOT NULL AND PinOzet IS NOT NULL)
      INSERT INTO dbo.Kullanici (Ad, PinTuz, PinOzet, Rol, Yetkiler, Olusturan)
      SELECT 'Yönetici', PinTuz, PinOzet, 'yonetici', NULL, Degistiren
      FROM dbo.Guvenlik WHERE Id = 1;

    IF OBJECT_ID('dbo.Yedek') IS NULL
    CREATE TABLE dbo.Yedek (
      Id          INT IDENTITY(1,1) PRIMARY KEY,
      Tarih       DATETIME      NOT NULL DEFAULT GETDATE(),
      Veritabani  NVARCHAR(128) NOT NULL,
      Dosya       NVARCHAR(500) NULL,
      Boyut       BIGINT        NULL,
      -- 'yedek'   elle alınan tam yedek
      -- 'temel'   işlem öncesi yedeklerin dayandığı tam yedek
      -- 'islem'   bir işlemden hemen önce alınan diferansiyel yedek
      -- 'geriyukleme'
      Tur         NVARCHAR(20)  NOT NULL DEFAULT 'yedek',
      Kullanici   NVARCHAR(100) NULL,
      Aciklama    NVARCHAR(300) NULL,
      -- Diferansiyel yedeğin dayandığı tam yedek dosyası. Geri yükleme
      -- önce bunu, sonra diferansiyeli açıyor.
      TemelDosya  NVARCHAR(500) NULL,
      -- Hangi işlemden önce alındı (IPC kanal adı ve okunur karşılığı).
      Islem       NVARCHAR(200) NULL,
      -- Dosya döngüsel kullanılıyor; üstüne yazılan yedek geçersiz olur.
      Gecerli     BIT           NOT NULL DEFAULT 1,
      Slot        INT           NULL
    );

    -- 22.08.2026'da eklenen alanlar; eski kurulumlarda tablo zaten vardı.
    IF COL_LENGTH('dbo.Yedek', 'TemelDosya') IS NULL
      ALTER TABLE dbo.Yedek ADD TemelDosya NVARCHAR(500) NULL;
    IF COL_LENGTH('dbo.Yedek', 'Islem') IS NULL
      ALTER TABLE dbo.Yedek ADD Islem NVARCHAR(200) NULL;
    IF COL_LENGTH('dbo.Yedek', 'Gecerli') IS NULL
      ALTER TABLE dbo.Yedek ADD Gecerli BIT NOT NULL DEFAULT 1;
    IF COL_LENGTH('dbo.Yedek', 'Slot') IS NULL
      ALTER TABLE dbo.Yedek ADD Slot INT NULL;

    IF OBJECT_ID('dbo.Islem') IS NULL
    CREATE TABLE dbo.Islem (
      Id         INT IDENTITY(1,1) PRIMARY KEY,
      Tarih      DATETIME     NOT NULL DEFAULT GETDATE(),
      Kullanici  NVARCHAR(100) NULL,
      Bilgisayar NVARCHAR(100) NULL,
      Ekran      NVARCHAR(60)  NULL,
      Islem      NVARCHAR(200) NULL,
      Detay      NVARCHAR(MAX) NULL
    );
  `);

  kuruldu = true;
}

function p() {
  return ayarOku().panelVeritabani;
}

async function kayit(ekran, islem, detay, kullanici, bilgisayar) {
  try {
    await calistir(
      `INSERT INTO [${p()}].dbo.Islem (Kullanici, Bilgisayar, Ekran, Islem, Detay)
       VALUES (@k, @b, @e, @i, @d)`,
      {
        k: kullanici || null,
        b: bilgisayar || null,
        e: ekran || null,
        i: islem || null,
        d: detay ? (typeof detay === 'string' ? detay : JSON.stringify(detay)) : null
      }
    );
  } catch (e) {
    // Günlük kaydı tutulamazsa işlem durmasın
  }
}

module.exports = { kur, p, kayit, sorgu, calistir, mssql };
