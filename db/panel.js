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
