# Vega belge yazım deseni

Bu belge, VegaWin'in kendi oluşturduğu kayıtlar incelenerek çıkarılmıştır.
Panelin Vega'ya yazma kodu (`db/yazma.js`) bu desene göre yazılmıştır.

İnceleme yöntemi: canlı bir dönemde Vega'nın kendi oluşturduğu fişler
uçtan uca izlendi; hangi tabloya hangi satırın, hangi bağ alanıyla
yazıldığı tespit edildi. Vega'ya hiç yazılmadı, yalnızca okundu.

## Tablo adlandırma

```
Kart tablosu    : F{firma}TBL{ad}            → F0103TBLSTOKLAR
Dönemli tablo   : F{firma}D{dönem}TBL{ad}    → F0103D0015TBLSTOKHAREKETLERI
```

## Stok giriş / çıkış fişi

Bir fiş dört tabloya yazılır. Bağ alanları şöyledir:

```
TBLSTKCIKBASLIK / TBLSTKGIRBASLIK
   IND ──────────────────────────┐  (belge kimliği, IDENTITY)
                                 │
TBLSTKCIKHAREKET / TBLSTKGIRHAREKET
   EVRAKNO ←─────────────────────┘  (başlık IND'i buraya yazılır)
   IND ──────────────────────────┐  (satır kimliği, IDENTITY)
                                 │
TBLSTOKHAREKETLERI               │
   LN      ←─────────────────────┘  (satır IND'i)
   BELGENO ←── başlık IND           (sayı olarak, belge numarası metni DEĞİL)
   EVRAKNO ←── belge numarası metni ('A0000001')
   IZAHAT  ←── belge tipi
                                 
TBLDEPOENVANTER
   BELGEIND   ←── başlık IND
   HAREKETIND ←── satır IND
   BELGETIPI  ←── belge tipi
   ENVANTER   ←── çıkışta −miktar, girişte +miktar
```

**Dikkat edilecek nokta:** `TBLSTOKHAREKETLERI.BELGENO` alanı sayıdır ve
başlık IND'ini tutar; belge numarası metni `EVRAKNO` alanındadır. İsimler
sezgiye ters, karıştırmak kolaydır.

## Kimlik üretimi

Dört tablonun da `IND` alanı **IDENTITY**'dir. Numarayı SQL Server üretir;
dışarıdan `MAX(IND)+1` hesaplanmamalıdır.

Belge numarası metni (`BELGENO`) elle girilen fişlerde `A` önekiyle
ilerler: `A0000001`, `A0000002`… Vega'nın kendi otomatik oluşturduğu
belgeler `Z` önekini kullanır. Panel yalnızca `A` serisini kullanır, böylece
Vega'nın kendi numaralarıyla çakışmaz.

## Belge tipleri

Aynı iş için birden fazla tip var; elle girilen ile otomatik oluşan ayrılıyor:

| Tip | Anlamı | Önek |
|---|---|---|
| 32  | Stok giriş fişi (elle) | A |
| 33  | Stok çıkış fişi (elle) | A |
| 103 | Stok girişi (otomatik/toplu) | Z |
| 104 | Stok çıkışı (otomatik/toplu) | Z |
| 20  | Alış faturası | |
| 93  | Sayım girişi | |
| 94  | Sayım çıkışı | |
| 96  | Üretim çıktısı | |
| 97  | Üretim tüketimi | |

`IZAHAT` (stok hareketinde) ve `BELGETIPI` (başlık ve envanterde) aynı
değeri taşır.

## Sıralama alanları

`SIRALAMATARIHIEX` kayan noktalı tarihtir: `CONVERT(FLOAT, GETDATE())`.
Aynı gün içindeki hareketlerin sırasını belirler.

## Başlık bayrakları

| Alan | Panelin yazdığı | Not |
|---|---|---|
| `ENVANTERUPDATE` | 1 | Vega'nın kendi fişlerinde 0 da görüldü; envanter satırının varlığını belirlemiyor |
| `SUCCESS` | 1 | |
| `STOKHAREKETEYAZ` | 1 | Stok hareketi yazılacağını belirtir |
| `CARIHAREKETEYAZ` | 0 | Tutanakta cari hareketi oluşmaz |
| `HAREKETDEPOSU` | depo no | Satırdaki `DEPO` ile aynı olmalı |
| `IPTAL`, `IADE`, `CONVERTED` | 0 | |

Zorunlu (NOT NULL, varsayılansız) alan yoktur; bu tablolarda tüm alanlar
boş bırakılabilir. Yine de yukarıdaki alanlar Vega'nın kendi fişleriyle
tutarlı olacak şekilde doldurulur.

## Panelin uyguladığı kurallar

- Dört satır **tek işlem** (transaction) içinde yazılır. Bir adım hata
  verirse hiçbiri kalmaz, yarım belge oluşmaz.
- Her yazma `GALYA_PANEL.dbo.Islem` tablosuna kullanıcı, bilgisayar ve
  satır kimlikleriyle kaydedilir.
- Geri alma aynı dört satırı siler; stok miktarı işlem öncesindeki hâline
  döner.
- `ayarlar.json` içindeki `vegayaYazmaAktif` kapalıyken hiçbiri çalışmaz.

## Reçete

Reçete iki dönemsiz kart tablosunda durur:

```
TBLURERECETELIST                 (reçete başlığı)
   IND ──────────────────┐        reçete numarası, IDENTITY
   STOKNO                │        üretilen mamulün stok kartı
   MIKTAR                │        verim: kaç birim mamul çıkıyor
                         │
TBLURERECETE                     (bileşen satırları)
   EVRAKNO ←─────────────┘        BAŞLIĞIN IND'i
   STOKNO                         bileşenin stok kartı
   DETAY                          satır sırası
```

**En kolay yapılan hata:** `TBLURERECETE.EVRAKNO` alanının mamulün stok
IND'ini tuttuğunu sanmak. Tutmuyor — reçete **başlığının** IND'ini tutuyor.
Mamule ulaşmak için başlıktan geçmek gerekir.

Alt reçete ayrı bir kayıt değildir. Bir bileşenin stok kartı başka bir
başlıkta `STOKNO` olarak geçiyorsa, ağaç oradan devam eder. Mamul → yarı
mamul → yarı mamul zinciri böyle kurulur.

Panel reçeteye yazarken:

- Mamulün başlığı yoksa önce `TBLURERECETELIST` kaydı açar.
- Aynı mamule ikinci başlık açmaz; varsa mevcut olanı kullanır.
- Aynı bileşeni reçeteye iki kez eklemez.
- Mamulün kendisini bileşen olarak eklemez.
- Ağacı gezerek **döngü kontrolü** yapar: eklenecek bileşenin reçetesinde
  mamulün kendisi geçiyorsa işlemi reddeder (yoksa ağaç sonsuza gider).

Reçete tabloları yalnızca tanım tutar; stok hareketi, envanter, maliyet ve
muhasebe zincirine dokunmaz. Bu yüzden yazma işlemleri arasında en düşük
riskli olanıdır.

## Sınama

`node kurulum/test-yazma.js`

Sınama müşteri veritabanına dokunmaz: yapısı VEGADB'den kopyalanmış boş bir
`GALYA_TEST` veritabanında çalışır, yazar, doğrular, geri alır.

## Henüz çıkarılmamış desenler

- **Üretim tetikleme** — üretimin hangi tablolara ne yazdığı çıkarılmadı.
  Elde üretim yapılmış bir Vega veritabanı gerekiyor: `TBLUREURETIM`,
  `TBLUREBELGE`, `TBLUREURETIMCIKTI` dolu olmalı ve stok hareketlerinde
  `IZAHAT` 96/97 bulunmalı. İncelenen veritabanında bu tablolar boş.
- **Maliyetlendirme** — tek belge değil, toplu yeniden hesaplama. Vega'nın
  ne yazdığı `kurulum/izleyici-kur.sql` ile yakalanmalı: izleyici
  çalışırken VegaWin'de Stok Yönetimi → Araçlar → Maliyetlendirme
  çalıştırılır, sonra `node kurulum/izleyici-oku.js` ile okunur.
- **Sayım fişi** — deseni stok giriş/çıkış ile aynı görünüyor (tip 93/94),
  ancak sayım Vega'da envanteri farklı sıralıyor olabilir; doğrulanmadan
  açılmamalı.
