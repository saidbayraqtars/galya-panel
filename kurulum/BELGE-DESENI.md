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

## GK alanı

Bütün hareket tablolarında (`TBLSTKCIKHAREKET`, `TBLALFATHAREKET`,
`TBLDEPOHARHAREKET`, …) `GK` adında bir tam sayı alan var. Uzun süre "ne
olduğu bilinmiyor" diye boş bırakıldı; gerçek veriye bakılarak çözüldü:

- Vega'nın yazdığı satırların **tamamı dolu** (`TBLSTKCIKHAREKET`'te
  21.456 satırın 21.456'sı, `TBLALFATHAREKET`'te 3.474/3.474).
- Aynı stok, aynı miktar ve aynı fiyatla girilmiş **14 satırın 14 farklı
  GK'sı** var. Yani içerikten türeyen bir sağlama (checksum) değil.
- 3.474 satırda 3.429 farklı değer, aralık `int` sınırlarında.

Sonuç: GK satırın rastgele kimliğidir. Panel `gkUret()` ile rastgele bir
int32 yazıyor (`db/yazma.js`).

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

## Alış faturası

`F0102`/`D0002` içindeki 706 gerçek alış faturası okunarak çıkarıldı.
Panel bu deseni `db/yazma.js` → `alisFaturasiYaz()` içinde uyguluyor.

```
TBLALFATBASLIK
   IND ──────────────────────────┐  IDENTITY
   BELGENO                       │  elle girilende 'A0000329', e-faturada 'UOF…'
   FIRMANO                       │  tedarikçinin cari IND'i
   BELGETIPI = 20, GIRIS = 1     │
                                 │
TBLALFATHAREKET                  │
   EVRAKNO ←─────────────────────┘  başlık IND
   IND ──────────────────────────┐  satır IND
   AFIYATI / FIYATI              │  birim fiyat (KDV hariç)
   KDV                           │  yüzde olarak oran (1, 10, 20…)
   GK                            │  rastgele int32
                                 │
TBLSTOKHAREKETLERI               │
   BELGENO ←── başlık IND        │
   LN      ←─────────────────────┘  satır IND
   EVRAKNO ←── belge numarası metni
   IZAHAT = 20, GIREN = miktar

TBLDEPOENVANTER
   BELGEIND / HAREKETIND ←── başlık ve satır IND, ENVANTER = +miktar

TBLCARIHAREKETLERI
   LN      ←── başlık IND
   EVRAKNO ←── belge numarası metni
   IZAHAT = 20
   ALACAK  ←── KDV **dahil** genel toplam   (BORC boş)
```

Dikkat edilecekler:

- Cari hareketinde bağ alanı `LN`'dir; stok hareketindeki `BELGENO`'nun
  karşılığıdır. Bu tabloda `BELGENO` diye bir alan **yok**.
- Alış faturası tedarikçiye borçlanmadır: tutar `ALACAK` sütununa yazılır.
- `OZELKOD1` / `OZELKOD2` şube-kasa alanları; Galya'da 706 faturanın
  hepsinde `MERKEZ`. Panel bu değeri sabit yazmaz, mevcut faturalarda en çok
  geçen değeri okuyup kullanır.
- Başlıkta `KDV` alanı **oran değil bayraktır** ("fiyatlar KDV dahil mi").
  Panel fiyatları KDV hariç yazdığı için 0 veriyor. Oran satırdaki `KDV`
  alanındadır.
- Yazma ayrıca stok kartını günceller: `ALISFIYATI`, `ESKIALISFIYATI`,
  `ALISFIYATIDEGISMETARIHI`, `SONALISTARIHI`. Maliyetlendirme bu alanlar ve
  hareketler üzerinden çalıştığı için zorunlu.

Panelde fatura önce `GALYA_PANEL.dbo.AlisFatura` tablosunda taslak olarak
durur; Vega'ya yazma ayrı bir onaydan geçer ve geri alınabilir.

## Üretim fişi

Bu bölüm, gerçek Galya veritabanı (`F0102` / MARQUE GIDA, dönem `D0002`)
geri yüklendikten sonra, Vega'nın kendi oluşturduğu 256 üretim fişi
okunarak çıkarıldı. Panel bu deseni `db/yazma.js` → `uretimFisiYaz()`
içinde uyguluyor.

### Tablolar ve bağ alanları

```
TBLUREURETIMLIST                    (üretim fişi başlığı, dönemli)
   IND ─────────────────────┐        IDENTITY
   FISNO                    │        'A0000289' — üretimin kendi sayacı
   STOKNO / MIKTAR          │        üretilen mamul ve miktarı
   RECETENO                 │        TBLURERECETELIST.IND
   DURUM                    │        2 = tamamlandı (veride tek görülen değer)
                            │
TBLUREURETIM                │       (tüketilen bileşen satırları)
   EVRAKNO ←────────────────┤        BAŞLIĞIN IND'i
                            │
TBLUREURETIMCIKTI           │       (çıktı satırları)
   EVRAKNO ←────────────────┤        BAŞLIĞIN IND'i
   RECETENO ←───────────────┤        !!! reçete değil, yine BAŞLIĞIN IND'i
                            │
TBLUREURETIMPOZ             │       (pozisyon adımları, 2 satır)
   EVRAKNO ←────────────────┤        BAŞLIĞIN IND'i
                            │
TBLUREBELGE                 │       (üretimden doğan belgelerin dizini)
   EIND ←───────────────────┘        BAŞLIĞIN IND'i
   BELGENO                           doğan belgenin numarası (sayı)
   IZAHAT                            doğan belgenin tipi
   EVRAKNO                           doğan belgenin numara metni ('Z0046842')
   MAMULSATIRI                       mamulün TBLSTOKHAREKETLERI.LN değeri
```

> **İkinci EVRAKNO tuzağı.** Reçetede `TBLURERECETE.EVRAKNO` reçete
> başlığının IND'ini tutuyordu. Üretimde aynı şey `TBLUREURETIMCIKTI`
> tablosunda `RECETENO` adıyla karşımıza çıkıyor: alan reçeteyi değil,
> **üretim başlığının IND'ini** tutuyor. Ada güvenmeyin.

### Satır alanları

`TBLUREURETIM` (tüketim) — gözlenen sabitler:

| Alan | Değer |
|---|---|
| `POZISYONNO` | 1 (başlangıç pozisyonu) |
| `CIKISPOZISYONNO` | 2 (bitiş pozisyonu) |
| `MIKTARTURU` | 1 |
| `MALIYETTURU` | −1 |
| `DEPONO` | bileşenin çekildiği depo |

`TBLUREURETIMCIKTI` (çıktı) — `TUR` alanı satırın ne olduğunu söyler:

| `TUR` | Anlamı |
|---|---|
| 0 | mamul (her fişte bir tane) |
| 2 | fire / yan ürün |

`ORAN` alanı çıktının yüzde payıdır (mamul 87.5, fire 0.0525 gibi).

`TBLUREURETIMPOZ` her fişte tam iki satırdır:

| `SIRANO` | `KOD` | `POZISYONNO` | Anlamı |
|---|---|---|---|
| 1 | `BAŞLA` | 100 | üretim yerine giriş |
| 2 | `BİTİR` | 101 | mamul deposuna çıkış |

### Doğan belgeler

En sık ve **hâlâ kullanılan** desen `38 + 38 + 97 + 96` (256 fişin 127'si,
son örnek 12.08.2026). Sırayla:

1. **`IZAHAT 38` — depo transferi (hammadde → üretim yeri deposu).**
   `TBLDEPOHARBASLIK` (IND IDENTITY, `BELGENO` metin `Z…`,
   `ALTBELGENO` = üretim fişinin `FISNO`'su, `DEPO` = hedef,
   `HAREKETDEPOSU` = kaynak, `BELGETIPI` = 38)
   \+ `TBLDEPOHARHAREKET` (`EVRAKNO` = başlık IND)
   \+ `TBLDEPOENVANTER` **iki satır** (hedef `+miktar`, kaynak `−miktar`;
   `BELGEIND` = başlık IND, `HAREKETIND` = hareket IND).
   **Bu adım `TBLSTOKHAREKETLERI`'ne hiç yazmaz.**

2. **`IZAHAT 38` — geri transfer (üretim yeri → mamul deposu).** Aynı yapı,
   depolar ters.

3. **`IZAHAT 97` — tüketim.** `TBLSTOKHAREKETLERI` (`CIKAN` = miktar,
   `GIREN` = 0) + `TBLDEPOENVANTER` (`−miktar`).

4. **`IZAHAT 96` — çıktı.** `TBLSTOKHAREKETLERI` (mamul ve fire için birer
   satır, `GIREN` = miktar) + `TBLDEPOENVANTER` (`+miktar`).

Diğer desenler (`38` tek başına, `96` tek başına, `38+38+97`) 2026 başındaki
fişlerde görülüyor; Vega hareket doğmayan adımı atlıyor. Yeni yazılacak fiş
tam deseni izlemeli.

> **96 ve 97'nin başlık tablosu yoktur.** Stok giriş/çıkışta `BELGENO`
> `TBLSTKGIRBASLIK`/`TBLSTKCIKBASLIK` IND'ini tutar; üretimde böyle bir
> başlık **aranmasın, yok**. `IND IN (55204,55205)` sorgusu iki tabloda da
> sıfır satır döner. Bağ yalnızca `TBLUREBELGE` üzerinden kurulur.

### 96/97 numarası nereden gelir

Başlık olmadığı için IDENTITY de yoktur. Gözlenen:

- `BELGENO`, 96 ve 97 arasında **paylaşılan tek bir sayaçtır**; her belge
  için bir artar (…55202 = 96, 55203 = 97, 55204 = 97, 55205 = 96).
- `EVRAKNO` = `'Z'` + 7 haneye sıfırla doldurulmuş ayrı bir sayaç.
- İkisi arasındaki fark şu an sabit (8363) ama bu geçmişte kaymış; **fark
  sabit varsayılmamalı**, her ikisi de kendi `MAX + 1`'inden türetilmeli.

> **Yarış tehlikesi.** `MAX(BELGENO) + 1` burada IDENTITY değildir ve bu
> sayaç boşta değildir: Şefim entegrasyonu aynı sayacı **günde 250–600
> belge** hızında ilerletiyor (12.08.2026'da 302 belge / 995 hareket).
> Numara işlemin (transaction) içinde, tabloyu kilitleyerek alınmalı;
> işlem dışında okunan numara yazılana kadar başkasına gitmiş olabilir.
> Bu, panelin şimdiye kadar yazdığı belgelerin hiçbirinde olmayan bir
> koşuldur — stok giriş/çıkış ve tutanak IDENTITY kullanır.

### Diğer alanlar

| Alan | Nereden gelir |
|---|---|
| `STOKTIPI` | stok kartının kendi `STOKTIPI` değeri (`F0102TBLSTOKLAR`) |
| `BIRIMEX` | stok kartının varsayılan birim satırı — `F0102TBLBIRIMLEREX.IND` (`VARSAYILAN = 1`) |
| `BIRIMFIYAT` / `BIRIMMALIYET` | ikisi de aynı; reçeteden gelen maliyet |
| `SIRALAMATARIHIEX` | `CONVERT(FLOAT, GETDATE())` |

### Üretim, 96/97 hareketlerinin küçük bir azınlığıdır

Dönem `D0002` içinde 23.471 adet `96` ve 130.706 adet `97` hareketi var; ama
bunların yalnızca 200 + 364 tanesi bir üretim fişine bağlı. Gerisini Şefim
tarafı otomatik üretiyor. Yani **"IZAHAT 96/97 = elle üretim" değildir**;
üretim raporu yazarken `TBLUREBELGE` üzerinden bağ kurulmalı, yoksa rapor
POS satışlarının reçete düşümlerini de üretim sanır.

## Sınama

```
node kurulum/test-yazma.js --kur     # test veritabanını hazırlar/tamamlar
node kurulum/test-yazma.js           # 55 sınama
```

Sınama müşteri veritabanına dokunmaz: yapısı VEGADB'den kopyalanmış boş bir
`GALYA_TEST` veritabanında çalışır, yazar, doğrular, geri alır. `--kur`
eksik tabloları `SELECT * INTO … WHERE 1=0` ile ekler (bu kalıp IDENTITY
özelliğini korur) ve tabloyu kaynakta hangi firma kullanıyorsa oradan alır —
her firma her modülü kullanmadığı için sabit bir firmadan kopyalamak
yetmiyor.

Kapsam: yazma kilidi, tutanak fiş çifti, reçete, alış faturası (beş tablo +
GK + stok kartı alış fiyatı) ve üretim fişi (altı tablo + iki depo transferi
+ 96/97 hareketleri), hepsinin geri alınması.

## Maliyetlendirme

Belge yazılmıyor. İzleyici, Vega'nın maliyetlendirme aracı çalışırken
dinlendi: 6.468 olay okundu, **sıfır yazma ifadesi** yakalandı. Yani
kopyalanacak bir belge deseni yok; iş tek bir alanın güncellenmesinden
ibaret:

```
TBLSTOKLAR.MALIYET   ←   hesaplanan birim maliyet
```

Panelin hesabı (`db/maliyet.js`), müşterinin koyduğu kurala göre:

```
hammadde maliyeti = SON ALIŞ fiyatı
                    (TBLSTOKHAREKETLERI, IZAHAT = 20, en yeni BIRIMFIYAT;
                     yoksa TBLSTOKLAR.ALISFIYATI)

mamul maliyeti    = Σ (bileşen maliyeti × miktar × (1 + fire/100)) / verim
                    (verim = TBLURERECETELIST.MIKTAR)
```

Ağaç alttan yukarı yürür, döngüde zincir kırılır. Yazma öncesi her kartın
eski maliyeti `GALYA_PANEL.dbo.MaliyetYazma` tablosuna kaydedilir; geri
alma bunu kullanır.

> Galya verisinde 433 reçetenin 430'unda verim **1** girilmiş. Yani bir
> kazan tiramisu reçetesi de "1 birim" sayılıyor ve hesaplanan maliyet
> porsiyon değil kazan maliyeti çıkıyor. Bu bir hesap hatası değil, reçete
> verisi eksikliği; verim alanı doldurulmadan mamul maliyetleri anlamlı
> olmaz.

Maliyetlendirme sırasında gider/hizmet (3), grup kartı (11) ve hizmet (26)
tipindeki kartlar hesaba katılmaz; bu kartlarda alış fiyatı alanında fatura
toplamı gibi anlamsız değerler duruyor.

## Henüz çıkarılmamış desenler

- **Sayım fişi** — deseni stok giriş/çıkış ile aynı görünüyor (tip 93/94),
  ancak sayım Vega'da envanteri farklı sıralıyor olabilir; doğrulanmadan
  açılmamalı.
