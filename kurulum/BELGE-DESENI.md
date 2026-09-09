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

### Belge numarası: panelin kendi serisi olmalı

`BELGENO` **serbest metindir** — üzerinde tekillik kısıtı yok ve gerçek
veride kullanıcıların elle yazdığı her şey duruyor: `ATAKUMTÜLEKSİK/3801`,
`10.000$`, tedarikçi fatura numaraları, `KIRIK.` …

> **Panel uzun süre `A` serisini kullandı; bu yanlıştı.** Gerekçe "Vega
> otomatik belgelerinde `Z` kullanıyor, `A` boştur" idi. Oysa `A`, Vega'da
> **elle belge girilirken önerilen varsayılan seridir**: kullanıcı Vega'dan
> fiş kesince o da `A0000001`'den ilerler.
>
> İki gerçek veritabanında da görüldü — panel hiç yazmamışken A serisi
> doluydu (Özdemirkaya F0101/D0017'de `A0000009`'a kadar).
>
> İki sonucu vardı: (1) panel ve Vega aynı diziden numara alıyor, ikisi aynı
> anda fiş keserse **aynı numarayı** alabilir — `UPDLOCK` yalnız paneli
> bekletir, Vega o kilidi almaz; (2) panelin yazdığı belge kullanıcının elle
> yazdığından ayırt edilemiyor.

Panel artık kendi önekini kullanıyor. Önek `ayarlar.json` → `belgeOneki`
alanından geliyor, **varsayılan `GP`** (Galya Panel): `GP0000001`,
`GP0000002` … En fazla 4 harf/rakam; geçersizse varsayılana düşer.

Kurulumdan önce önekin o veritabanında boş olduğu doğrulanmalı:

```sql
SELECT LEFT(BELGENO,1) AS onek, COUNT(*) FROM F0102D0002TBLSTKCIKBASLIK
WHERE ISNULL(BELGENO,'') <> '' GROUP BY LEFT(BELGENO,1) ORDER BY 2 DESC;
```

Önek şu belgelerin hepsinde kullanılıyor: stok giriş/çıkış (32/33), alış
faturası (20), sayım (93/94) ve üretim fişinin `FISNO` alanı.

**İstisna — Vega'nın paylaşılan sayaçları.** Depo transferinin (38) ve
üretim 96/97 belgelerinin `Z` numaraları Vega'nın kendi dizisinin
devamıdır; onlar panelin öneki ile değil, `MAX + 1` ile üretilmeye devam
eder. Bu belgeleri Vega'nın kendisi de otomatik olarak böyle numaralıyor.

Önek kurulumda bir kez seçilir; sonradan değiştirmek numara dizisini kırar
(yeni önek 1'den başlar). Bu yüzden Ayarlar ekranında değil, yalnız
`ayarlar.json` içinde.

## Belge tipleri

Aynı iş için birden fazla tip var; elle girilen ile otomatik oluşan ayrılıyor:

| Tip | Anlamı | Önek |
|---|---|---|
| 32  | Stok giriş fişi (elle) | Vega: A · panel: `belgeOneki` |
| 33  | Stok çıkış fişi (elle) | Vega: A · panel: `belgeOneki` |
| 103 | Stok girişi (otomatik/toplu) | Z |
| 104 | Stok çıkışı (otomatik/toplu) | Z |
| 20  | Alış faturası | |
| 93  | Sayım girişi | |
| 94  | Sayım çıkışı | |
| 96  | Üretim çıktısı | |
| 97  | Üretim tüketimi | |

`IZAHAT` (stok hareketinde) ve `BELGETIPI` (başlık ve envanterde) aynı
değeri taşır.

## Boş bırakılan kolon belgeyi açılmaz yapar

**Vega bir belgeyi okurken satırdaki alanların dolu olmasını bekliyor.** Bir
kolonu NULL bırakmak satırı tabloya sokar, stok da doğru hareket eder — ama
Vega'nın kendi ekranı belgeyi açamayabilir. Bu, panelin yazdığı belgede
saatlerce fark edilmeyen, ancak müşteri belgeyi açmaya çalıştığında ortaya
çıkan bir kusurdur; "hızlı belge doldurucu" işinde tam olarak bu yaşandı.

Ölçüsü `kurulum/test-kolon-denetimi.js`:

```
node kurulum/test-kolon-denetimi.js
```

Betik gerçek veritabanında Vega'nın kendi satırlarına bakıp her kolonun
**doluluk oranını** ölçüyor (belge tipi başına 5.000 satıra kadar), sonra
panelin GALYA_TEST'e yazdığı satırla karşılaştırıyor. Vega'nın **%100**
doldurduğu bir kolonu panel NULL bırakmışsa risk sayılıyor.

Eşik neden %100: Vega bir alanı bazen dolduruyorsa (%40, %90) o alan
belgenin okunması için şart değildir — kullanıcı girmiş ya da girmemiştir.
Her satırda dolduruyorsa alan belgenin bir parçasıdır.

> **08.09.2026'da ilk çalıştırmada 271 riskli kolon çıktı** — alış faturası,
> sayım fişi, tutanak, üretim ve `TBLSHAREKET` satırlarında. Değerlerin
> neredeyse tamamı `0`, `false` ya da `''` idi; yani "veri" değil, Vega'nın
> beklediği doluluk. Hepsi dolduruldu, sonuç 0.
>
> İlginç ayrıntı: `zayiFisiYaz` o gün bile tertemizdi, ama aynı tabloya yazan
> tutanak (`fisYaz`) değildi. Aynı tabloya yazan iki kod yolundan biri doğru
> olabiliyor; bu yüzden denetim belge tipi tipi çalışıyor.

### Her kurulum aynı kolonları doldurmuyor — birleşim alınmalı

Denetim başka bir Vega kurulumuna da yöneltilebiliyor:

```
GALYA_KAYNAK_VT=VEGADBozdemirkaya GALYA_KAYNAK_FIRMA=F0101 GALYA_KAYNAK_DONEM=D0017 node kurulum/test-kolon-denetimi.js
```

08.09.2026'da üç kurulum karşılaştırıldı ve her biri bir öncekinin
kaçırdığını yakaladı:

| Kurulum | Bulunan eksik | Nerede |
|---|---:|---|
| `VEGADB` (Galya) | 271 | sayım, fatura, tutanak, SHAREKET, reçete |
| `VEGADBozdemirkaya` | 33 | zayi / stok çıkış (33) |
| `VEGADB_cazgır` | 62 | **üretim başlığı (13), depo transferi (37)**, üretim tüketimi, 96/97 |

Eksikler her seferinde **başka yerdeydi**: Galya'da tutanak eksikti/zayi
temizdi, Özdemirkaya'da zayi eksikti/tutanak temizdi. Üretim tarafındaki
13 + 37 kolon ancak üçüncü kurulumda görüldü, çünkü üretim modülünü canlı
kullanan tek veritabanı oydu (F0118D0001'de 380 üretim fişi).

Yani "%100 dolu" kümesi kuruluma göre değişiyor. **Doğru olan birleşimi
doldurmaktır.** Elinizdeki HER Vega veritabanına karşı çalıştırın; tek
kurulumla "temiz" çıkmak yeterli değil.

Bu makinedeki üç kurulum için:

```
node kurulum/test-kolon-denetimi.js
GALYA_KAYNAK_VT=VEGADBozdemirkaya GALYA_KAYNAK_FIRMA=F0101 GALYA_KAYNAK_DONEM=D0017 node kurulum/test-kolon-denetimi.js
GALYA_KAYNAK_VT=VEGADB_cazgır     GALYA_KAYNAK_FIRMA=F0118 GALYA_KAYNAK_DONEM=D0001 node kurulum/test-kolon-denetimi.js
```

### Son adım: belgeyi Vega'da açmak

Kolon denetimi gerekli ama yeterli değil. Tek kesin kanıt belgenin Vega'nın
kendi ekranında açılmasıdır:

```
node kurulum/canli-belge-sinamasi.js --vt <lisanslı_vt> --firma F0101 --donem D0017
node kurulum/canli-belge-sinamasi.js --vt <lisanslı_vt> --geri-al
```

Betik her belge tipinden birer tane yazıp numaralarını söylüyor; Vega A5 o
veritabanıyla açılıp belgeler görülüyor, sonra hepsi geri alınıyor. Üretim
yazmıyor (96/97 sayacı Şefim ile paylaşılıyor).

Yeni bir belge tipi yazan herkes bu iki betiğe de kendi belgesini eklemeli.

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
| 0 | ana mamul (her fişte bir tane) |
| 2 | fire / yan mamul |

**Bir fişte birden fazla çıktı satırı olur.** F0102/D0002'deki 256 üretim
fişinin 68'i çok çıktılı. Örnek (`A0000279`, reçete 4516 DANA ANTRIKOT):
36,82 kg ham et tüketilip 17,24 antrikot + 6,42 kuşbaşı + 10,34 kıyma +
2,82 fire çıkıyor. Miktarları kullanıcı iş emri ekranında yazıyor.

Çıktı listesi reçetenin `F{firma}TBLURERECETECIKTI` tablosundan gelir; hangi
ürünlerin çıkacağını ve her birinin maliyet payını orası söyler.

### Reçete açarken ana mamul çıktısı da yazılmalı

Vega **her** reçeteye bu tabloya bir ana mamul satırı (`TUR` 0, `ORAN` 100,
`RECETENO` = reçete başlığının IND'i) yazıyor. Üç kurulumda 627 reçetenin
627'sinde var, istisnası yok:

| Kurulum | Reçete | Çıktı satırı olmayan | TUR 0'ı olmayan |
|---|---:|---:|---:|
| `VEGADB` F0102 | 433 | 0 | 0 |
| `VEGADB_cazgır` F0118 | 194 | 0 | 0 |

Reçete ekranı mamulü bu satırdan okuyor; satır yoksa reçete Vega'da çıktısız
görünür. Panel 09.09.2026'ya kadar yazmıyordu — kolon denetimi bunu
göremiyordu, çünkü denetimin kendisi çıktı satırlarını elle ekliyordu ve
panelin eksiğini örtüyordu. `receteCiktiSatiriGuvence()` artık hem yeni
reçetede yazıyor hem de eski reçetelerde eksikse tamamlıyor.

| Alan | Ana mamul | Yan mamul |
|---|---|---|
| `TUR` | 0 | 2 |
| `RECETENO` | **üretim başlığının IND'i** | `NULL` |
| `BIRIMMIKTAR` | `NULL` | 1 |
| `POZISYONNO` | 2 | 2 |
| `KALANMIKTAR` | = `MIKTAR` | = `MIKTAR` |

`ORAN` alanı çıktının yüzde payıdır ve maliyet buna göre paylaşılır:

```
satır.TUTAR = toplam tüketim maliyeti × ORAN / 100
satır.FIYAT = satır.TUTAR / satır.MIKTAR
```

> **`ORAN` toplamı 100 olmak zorunda değil.** DANA ANTRIKOT reçetesinde hem
> ana mamul hem DANA KIYMA %100 taşıyor, toplam 200: 23.750 TL hammadde
> 47.500 TL mamule dönüyor. Vega bunu uyarmadan yapıyor (08.09.2026 ekran
> kaydı). TAVUK BONFILE'de tersi var — toplam %9,12, maliyetin çoğu hiçbir
> çıktıya yazılmıyor. Panel Vega ile aynı sayıyı yazıyor, ama ekranda oran
> toplamını uyarı olarak gösteriyor: bu bir reçete verisi sorunudur,
> hesaplama hatası değil.

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

4. **`IZAHAT 96` — çıktı.** Her çıktı için birer `TBLSTOKHAREKETLERI`
   (`GIREN` = miktar) + `TBLDEPOENVANTER` (`+miktar`) satırı. **Fiyatı sıfır
   olan yan mamul ve fire satırları da yazılır**; stok kartı yine artar.
   `TBLUREBELGE.MAMULSATIRI` yalnız `TUR = 0` satırının `LN`'sidir.

Diğer desenler (`38` tek başına, `96` tek başına, `38+38+97`) 2026 başındaki
fişlerde görülüyor; Vega hareket doğmayan adımı atlıyor. Yeni yazılacak fiş
tam deseni izlemeli.

> **96 ve 97'nin başlık tablosu yoktur.** Stok giriş/çıkışta `BELGENO`
> `TBLSTKGIRBASLIK`/`TBLSTKCIKBASLIK` IND'ini tutar; üretimde böyle bir
> başlık **aranmasın, yok**. `IND IN (55204,55205)` sorgusu iki tabloda da
> sıfır satır döner. Bağ yalnızca `TBLUREBELGE` üzerinden kurulur.

### Satır tablosu: `TBLSHAREKET` (başlığı yok, satırı var)

Başlığı olmaması satırı da olmadığı anlamına gelmiyor. 96 ve 97 belgelerinin
satırları `F{firma}D{dönem}TBLSHAREKET` tablosunda durur — Vega'nın Üretim
Giriş / Çıkış Fişi ekranının okuduğu tablo budur.

```
TBLSHAREKET
   IND ─────────────────┐   IDENTITY
   EVRAKNO                  belgenin BELGENO'su (sayı)
                        │
TBLSTOKHAREKETLERI      │
   LN  ←────────────────┘   satırın TBLSHAREKET.IND'i
```

08.09.2026'da bulundu. Son 5.000 adet 96/97 hareketinde:

```
LN = TBLSHAREKET.IND                4990 / 4990
TBLSHAREKET.EVRAKNO = BELGENO       4990 / 4990
STOKNO aynı                         4990 / 4990
```

Aynı sorgu `IZAHAT = 33` için 2.000'de 3 tutuyor; yani bağ 96/97'ye özgü,
rastlantı değil. Stok giriş/çıkış fişleri satırlarını kendi
`TBLSTKCIKHAREKET` / `TBLSTKGIRHAREKET` tablolarında tutar ve `LN`'leri ayrı
bir sayaçtan gelir.

**Sıra önemli:** önce `TBLSHAREKET` satırı yazılır, dönen IDENTITY `LN`
olarak `TBLSTOKHAREKETLERI`'ne ve `HAREKETIND` olarak
`TBLDEPOENVANTER`'e geçer. `TBLUREBELGE.MAMULSATIRI` de aynı sayıdır.

Panel `LN`'yi uzun süre `MAX(LN) + 1` ile kendi üretiyor ve `TBLSHAREKET`'e
hiç yazmıyordu. İki sonucu vardı: belge Vega'nın ekranında **satırsız**
görünüyordu ve IDENTITY ilerlemediği için Vega'nın yazacağı sonraki belgeler
**aynı LN'leri yeniden üretiyordu**.

Yazılan alanlar (Vega'nın satırından birebir):

| Alan | Değer |
|---|---|
| `EVRAKNO` | belgenin `BELGENO`'su |
| `DETAY`, `SELECTED`, `FIRMANO`, `KDV` | 0 |
| `MIKTAR`, `ENVANTER` | miktar (97'de de **artı**) |
| `BIRIMMIKTAR`, `SERIMIKTAR` | 1 |
| `AFIYATI`, `FIYATI` | birim maliyet |
| `GERCEKTOPLAM` | miktar × birim maliyet |
| `TERMIN` | `1899-12-30` |
| `PARABIRIMI` / `KUR` | `TL` / 1 |
| `GK` | rastgele int32 (`gkUret()`) |

> Tablo dönemlidir ve Vega onu yalnızca modül kullanılınca oluşturuyor:
> VEGADB'de `F0100` ile `F0101/D0002` gibi dönemlerde **yok**. Panel
> `tabloVarMi` ile bakıyor; yoksa eski `MAX(LN) + 1` yoluna düşüyor.

> Geri almada `TBLSHAREKET` satırları da silinmeli. Silmeden önce `LN`'ler
> `TBLSTOKHAREKETLERI`'nden okunup `IND` ile siliniyor; `EVRAKNO = BELGENO`
> ile silmek başka belge tiplerinin sayaç uzayıyla örtüşüp yanlış satıra
> dokunabilirdi.

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
node kurulum/test-yazma.js           # 106 sınama
node kurulum/test-yetki.js           #  41 sınama (kullanıcı, kapsam, onay)
```

Sınama müşteri veritabanına dokunmaz: yapısı VEGADB'den kopyalanmış boş bir
`GALYA_TEST` veritabanında çalışır, yazar, doğrular, geri alır. `--kur`
eksik tabloları `SELECT * INTO … WHERE 1=0` ile ekler (bu kalıp IDENTITY
özelliğini korur) ve tabloyu kaynakta hangi firma kullanıyorsa oradan alır —
her firma her modülü kullanmadığı için sabit bir firmadan kopyalamak
yetmiyor.

Kapsam: yazma kilidi, tutanak fiş çifti, reçete, alış faturası (beş tablo +
GK + stok kartı alış fiyatı), üretim fişi (altı tablo + iki depo transferi
+ 96/97 hareketleri), sayım fişi (giriş + çıkış çifti, stoğun sayılan
miktara oturması, çift yazma engeli, fark yokken fiş kesilmemesi), **zayi
fişi** (beş tablo + cari borç hareketi, fiyatsız ve maliyetli kip) ve
**pasife alma**; hepsinin geri alınması.

`test-yetki.js` ayrı duruyor çünkü VEGADB'ye hiç yazmıyor: kullanıcı
tanımlama, PIN'le giriş, PIN benzersizliği, son yöneticinin korunması, sayım
kapsamı (KOD2) ve onay akışını sınıyor. Panel tablolarını `GALYA_TEST`
içinde açıyor; canlı `GALYA_PANEL`e yönelirse kendini durduruyor — sınama
kullanıcı tablosunu boşaltıyor ve canlıda çalışsaydı programı bilinmeyen bir
PIN'le kilitlerdi.

## Sayım fişi

Vega'nın sayım fişi **mutlak** değil, **fark** belgesidir. Fişteki miktar
"sayımda şu kadar çıktı" demek değil, "stoğa şu kadar eklenecek" demektir.
Firmanın 31.07.2026 sayımı (`Z0000047` / `Z0000021`) bunu gösteriyor:

| Ürün | fiş öncesi | fişteki miktar | fiş sonrası |
|---|---:|---:|---:|
| Bira.Carlsberg 33 cl | −10 | +10 | 0 |
| Pizza Marinara | −3 | +3 | 0 |
| TUZ | −11,197 | +29,017 | 17,820 |

Yani `fark = fiziki sayım − sistemdeki miktar`. Artı farklar sayım **giriş**
fişine (belge tipi 93), eksi farklar sayım **çıkış** fişine (94) yazılır.
Vega tek bir sayımda ikisini arka arkaya keser; panel de öyle yapar.

### Tablolar ve bağ alanları

```
TBLSAYIM{GIRIS|CIKIS}BASLIK      IND (IDENTITY)  ← belge kimliği
   │                             BELGENO = Z0000001…
   ├── TBLSAYIM{...}HAREKET      EVRAKNO = başlık IND
   │                             IND (IDENTITY) ← satır kimliği
   ├── TBLSTOKHAREKETLERI        BELGENO = başlık IND
   │                             LN      = satır IND
   │                             EVRAKNO = belge numarası metni (Z0000048)
   │                             IZAHAT  = '93' / '94'
   └── TBLDEPOENVANTER           BELGEIND   = başlık IND
                                 HAREKETIND = satır IND
                                 ENVANTER   = +fark / −fark
```

### Belge numarası

`Z` öneki + 7 hane. Sayaç **her tabloda ayrı** yürüyor: aynı sayımda giriş
fişi `Z0000048` iken çıkış fişi `Z0000022` olabiliyor (48 giriş, 22 çıkış
belgesi kesilmiş). `MAX(...) + 1` okuması `WITH (UPDLOCK, HOLDLOCK)` ile
yapılıyor; aynı anda iki kullanıcı fiş keserse ikincisi bekler.

Z serisi 103/104 otomatik belgelerinde de kullanılıyor ama onlar başka
tablolarda durduğu için sayaçlar çakışmıyor.

### Alan ayrıntıları

Başlık:

- `GIRIS` = 1 (93) / 0 (94), `BELGETIPI` = 93 / 94
- `DEPO` = `HAREKETDEPOSU` = sayımın deposu
- `OZELKOD1` = `OZELKOD2` = depo adı (`MERKEZ`)
- `FIRMANO` = 1, `USERNO` = kullanıcı, `PARABIRIMI` = `TL`, `KUR` = 1
- `STOKHAREKETEYAZ` = `CARIHAREKETEYAZ` = 1
- `TUTAR` = `ARATOPLAM` = giriş fişinde toplam maliyet; **çıkış fişinde 0**
- `ENVANTERUPDATE` ve `SUCCESS` gerçek fişlerde boş — panel de doldurmuyor

Satır:

- `MIKTAR` = `ENVANTER` = farkın mutlak değeri
- `BIRIMMIKTAR` = 1, `SATISKOSULU` = 1, `SERIMIKTAR` = 1
- `TERMIN` = `1899-12-30` (Vega'nın boş tarihi)
- `ACIKLAMA` = `Sayım`
- `GK` = rastgele int32 (bkz. GK alanı)
- Giriş fişinde `AFIYATI` = `FIYATI` = kart maliyeti
- Çıkış fişinde `AFIYATI` = kart maliyeti ama `FIYATI` = 1 ve `ISK1` = 100
  (yüzde yüz iskonto). Vega tutarı böyle sıfırlıyor.

### Panelin çalışma biçimi

Fark, **fişin kesildiği andaki** stoğa göre yeniden hesaplanır — sayım
kaydedildikten sonra Şefim satış işlemeye devam ettiği için ekrandaki eski
teorik miktarla yazmak stoğu yanlış yere oturtur. Mutlak değeri 0,0001'in
altındaki farklar yuvarlama artığı sayılıp atlanır; hiç fark yoksa fiş
kesilmez.

Geri alma dört tablodaki satırları da siler; stok fiş öncesine döner.
Kesilen fişlerin kimlikleri `GALYA_PANEL.dbo.AraSayim.VegaFisler` alanında
saklanır.

## Zayi / personel çıkışı

`F0102`/`D0002` içindeki **37 gerçek ZAYİ fişi** okunarak çıkarıldı. Panel bu
deseni `db/yazma.js` → `zayiFisiYaz()` içinde uyguluyor.

Belge tipi **33** — yani tutanağın kullandığı stok çıkış fişinin aynısı.
İki farkı var:

1. `FIRMANO` bir **cariyi** gösterir: `ZAYİ` (F0102'de IND 158), `FİRE`
   (157), ya da malın üstünde kaldığı personelin kartı (`ÇAĞLA TARHAN`,
   `ULAŞ HİNDİSTAN`…). Ekranda "Firma Kodu" diye görünen alan bu.
2. `CARIHAREKETEYAZ = 1` ve `TBLCARIHAREKETLERI`'ne **BORÇ** satırı düşer.
   37 fişin 37'sinde de böyle.

```
TBLSTKCIKBASLIK
   IND ──────────────────────────┐  IDENTITY
   BELGENO = 'A0000404'          │  A serisi, elle girilen fiş
   FIRMANO = 158                 │  ZAYİ carisi
   OZELKOD4 = 'ZAYİ'             │  ekrandaki "Alt Hesap"
   OZELKOD1 = OZELKOD2 = MERKEZ  │  şube / kasa
   DEPO = NULL, HAREKETDEPOSU=1  │  !!! DEPO boş bırakılıyor
   BELGETIPI = 33, GIRIS = 0     │
   TUTAR = KDV dahil             │  ARATOPLAM = KDV hariç
   STOKHAREKETEYAZ = CARIHAREKETEYAZ = 1
                                 │
TBLSTKCIKHAREKET                 │
   EVRAKNO ←─────────────────────┘  başlık IND
   IND ──────────────────────────┐  satır IND
   FIRMANO = 158                 │  satırda da cari tekrarlanıyor
   AFIYATI = kart maliyeti       │  FIYATI = satış fiyatı
   KDV = oran (1, 10, 20)        │  GK = rastgele int32
                                 │
TBLSTOKHAREKETLERI               │
   BELGENO ←── başlık IND        │  LN ←─────────┘
   EVRAKNO ←── belge numarası metni, IZAHAT = 33
   CIKAN = miktar, GIREN = 0
   BIRIMFIYAT = BIRIMMALIYET = FIYATI (AFIYATI değil)

TBLDEPOENVANTER
   BELGEIND / HAREKETIND ←── başlık ve satır IND, ENVANTER = −miktar

TBLCARIHAREKETLERI
   LN      ←── başlık IND
   EVRAKNO ←── belge numarası metni
   IZAHAT  = '33'
   BORC    ←── başlıktaki TUTAR   (ALACAK boş)
   OZELKOD ←── alt hesap ('ZAYİ')
```

### Birim fiyat: sıfır mı, maliyet mi

Gerçek veride **945 zayi satırının 801'i sıfır fiyatlı** (%85). Yani firma
zayii çoğunlukla tutarsız giriyor: yalnızca miktar düşüyor, cari borcu 0
oluyor. Kalan 144 satırda fiyat girilmiş ve tutar cariye borç yazılmış.

Panel ikisini de yapıyor; hangisi olacağına kullanıcı zayi ekranındaki
**"Maliyetle yaz"** kutusundan karar veriyor (varsayılan: kapalı, yani
Vega'daki norm). Kutu işaretlenirse `AFIYATI = FIYATI = kart maliyeti`
olur ve KDV dahil toplam cariye borç yazılır.

> **KDV oranı stok kartında yazmıyor.** Kartta `KDVGRUBU` var; oran
> `TBLKDVGRUPLARI` tablosunda (IND 1 → %20, 100 → %10, 101 → %1, 102 → %0).
> Satırdaki `KDV` alanı bu tablodan geliyor. `TBLSTOKLAR.KDV` diye bir alan
> **yok**; bir kez bu varsayımla yazıldı ve `Invalid column name 'KDV'`
> hatası alındı.

Geri alma beş tablodaki satırları da siler; stok ve cari bakiye fiş
öncesine döner.

## Sıfıra kadar üretim

Yeni bir belge tipi yok: **yalnızca üretim fişi** (38+38+97+96) kesiliyor.
Stoğu eksiye düşmüş, reçetesi olan ürün için eksi kalanın karşılığı kadar
üretim yazılıyor ve stok sıfıra oturuyor.

`db/uretim.js` → `sifiraKadarUret()`:

1. Kalan **yazma anında Vega'dan okunur** (Şefim aradaki saniyelerde satış
   işleyebilir; ekrandaki eski sayı stoğu yanlış yere oturturdu).
2. Kalan eksi değilse fiş HİÇ kesilmez, hata döner.
3. Eksiyse eksik miktar kadar üretim fişi yazılır.

`hepsiniSifirla()` aynı işi seçilen ürünlerin hepsi için yapıyor; bir ürün
hata verirse diğerleri yazılmaya devam ediyor ve sonuç listesinde hangisinin
neden yazılamadığı duruyor.

> **Kendini tüketen reçete.** Bazı kartların reçetesinde mamulün KENDİSİ
> bileşen: F0102'de `Tequila.Olmeca Blanco` üretmek için 0,07 birim aynı
> kart tüketiliyor (şişeden kadeh). Böyle bir kartta 1 birim üretim stoğu
> (1 − oran) kadar artırıyor, o yüzden üretilecek miktar ölçekleniyor:
> `eksik / (1 − oran)`. Ölçeklenmezse tek geçişte sıfıra inilmiyor — canlıda
> görüldü: −0,1575 olan kart 0,1575 üretimden sonra −0,0110'da kaldı.
> Oran ≥ 1 ise üretim stoğu hiç artırmaz; kart `uretilemez` işaretiyle
> geliyor ve fiş kesilmiyor.

> **Zayi fişi kesilmiyor.** 25.08.2026'ya kadar "zayiatlı üretim" adında
> birleşik bir kip vardı: önce zayi fişi kesiyor, sonra stoğu sıfıra
> çekiyordu. Müşterinin kararıyla kaldırıldı — zayi girişi kendi ekranında
> (Zayi / personel çıkışı) yapılıyor, burası yalnızca eksiği kapatıyor.
> Deseni `galya döküman/zaiyatlı manuel üretim .md` izleyici kaydında
> duruyor: kullanıcı Vega'da da iki işi ayrı yapıyor — önce
> `StkÇık\A0000499\ZAYİ` fişi, sonra üretim fişi.

### Üretim fişine eklenen tablo: TBLUREURETIMARAC

İzleyici kaydındaki 23. ifade, Vega'nın üretim araçlarını reçeteden olduğu
gibi kopyaladığını gösterdi:

```sql
INSERT INTO F0102D0002TBLUREURETIMARAC (EVRAKNO,ARACNO,ARACKODU,CALISMAUSULU,
       POZISYONNO,MIKTAR,BIRIMMIKTAR,SIRANO)
SELECT 1405 AS EVRAKNO, ARACNO, ARACKODU, CALISMAUSULU, POZISYONNO, MIKTAR,
       BIRIMMIKTAR, SIRANO
FROM F0102TBLURERECETEARAC WHERE EVRAKNO=4499
```

(1405 = üretim başlığının IND'i, 4499 = reçete IND'i.) Panel aynısını
yazıyor; reçetede araç tanımlı değilse hiç satır oluşmuyor. Geri alma bu
tabloyu da siliyor.

## Fireli (manuel) üretim

Sıfıra kadar üretimin kardeşi. Fark: orada eksiye düşmüş **mamul** reçeteden
üretiliyor, burada **hammadde** fire vermiş ve mamul reçetesiz üretiliyor.
Müşterinin tarifi:

> "Ne üretilecekse seçiliyor, misal somon. Sonra o neyden üretilecekse —
> ham somon — o giriliyor 10 kg olarak. Çıkışta 3 kg somon ve 7 kg fire
> olarak yazılıyor."

Yine yeni bir belge tipi yok, aynı iki belge ardarda kesiliyor:

```
1. Zayi çıkış fişi (33)  ham somon 7 kg   cari FİRE/ZAYİ
2. Üretim fişi           ham somon 3 kg tüketim → somon 3 kg çıktı
                         (doğan belgeler: 38 + 38 + 97 + 96)
```

Toplamda 10 kg hammadde stoktan çıkar, 3 kg mamul girer.

`db/uretim.js` → `fireliUret()`:

1. Her hammadde satırı için **giren miktar** ve **fire** alınır.
2. Fire toplamı > 0 ise zayi fişi kesilir (yalnızca fire satırlarıyla).
3. Üretim fişi yazılır; tüketim miktarı `giren − fire`.
4. Üretim yazılamazsa **fire fişi geri alınır**.

Fire sıfırsa zayi fişi hiç kesilmez, yalnızca üretim yazılır.

### Reçetesiz üretim fişi

Fireli üretimde reçete YOKTUR — "somon" kartının reçetesi yok ve olması da
gerekmiyor. `yazma.uretimHazirligi()` bunun için `elleBilesenler` alıyor:

| Alan | Reçeteli üretim | Elle bileşenli üretim |
|---|---|---|
| Tüketim satırları | `TBLURERECETE`'den, verime oranlanarak | Kullanıcının verdiği miktar, olduğu gibi |
| `TBLUREURETIMLIST.RECETENO` | Reçete başlığının IND'i | Reçete varsa IND'i, yoksa **0** |
| Pozisyon adımları | `TBLURERECETEPOZ`'dan | Reçete varsa oradan, yoksa varsayılan BAŞLA/BİTİR |
| `TBLUREURETIMARAC` | Reçeteden kopyalanır | Reçete varsa kopyalanır, yoksa satır oluşmaz |
| KDV oranı | Reçete başlığından | Reçete varsa oradan, yoksa 0 |

Yani reçete varsa **yalnızca çerçevesi** (pozisyon, araç, KDV) kullanılıyor;
miktarlar her hâlükârda elle gelenler. Reçete yoksa üretim fişi yine de
eksiksiz yazılıyor.

> Çıktı satırındaki `TBLUREURETIMCIKTI.RECETENO` alanı reçeteyi değil,
> **üretim başlığının IND'ini** tutuyor (alan adı yanıltıcı, Vega'nın kendi
> fişlerinde de böyle). Bu, reçetesiz üretimde de değişmiyor.

## Çok çıktılı üretim

08.09.2026'da eklendi; bulgunun tamamı `URETIM-BULGU-08-09-2026.md`'de.

Reçetesinde birden fazla çıktı olan mamulde iş **kökten değişiyor** ve
Vega'nın iş emri ekranına dönüşüyor:

```
Reçete çıktıları (F0102, 4516 DANA ANTRIKOT)
   TUR 0  DANA ANTRIKOT   ORAN 100     ana mamul
   TUR 2  DANA KUŞBAŞI    ORAN 0       yan mamul
   TUR 2  DANA KIYMA      ORAN 100     yan mamul
   TUR 2  FİRE            ORAN 0       fire

Kullanıcının yazdığı  →  25 kg ham et  →  18 + 3 + 3 + 1
```

| | Tek çıktılı / reçetesiz | Çok çıktılı |
|---|---|---|
| Tüketim | giren − fire | **girenin tamamı** |
| Fire | ayrı zayi çıkış fişi (33) + cari borcu | reçetedeki **FİRE stok kartına 96 girişi** |
| Çıktı satırı | 1 | reçetedeki her satır (miktarı > 0 olanlar) |
| Maliyet | tamamı mamule | `ORAN`'a göre paylaşılır |

Fire'nin iki kip arasında yer değiştirmesi bilinçli: Vega reçeteli üretimde
zayi fişi kesmiyor, fireyi bir çıktı sayıyor. İkisi bir arada yapılsaydı
fire **iki kez** düşerdi. Reçetesiz manuel üretimde eski akış (önce zayi
fişi) müşterinin 22.08.2026'daki isteği gereği duruyor.

`db/uretim.js` → `receteCiktilari()` reçetenin çıktılarını okuyor.
`isEmri()` bunu reçete bileşenleri, birim maliyetler ve kalanlarla
birleştirip arayüze tek parça veriyor; ekran mamul seçilir seçilmez onu
çağırıp Vega'nın İş Emri ekranındaki iki sekmeyi (Üretim Girdileri /
Üretim Çıktıları) dolduruyor. `fireliUret()` `ciktilar` aldığında zayi
fişi kesmiyor.

## Stok kartını pasife alma

Belge yazılmıyor; tek alanlık güncelleme:

```
TBLSTOKLAR.KOD8   ←   'PASİF'
```

Firma kullanmadığı **373 kartı** zaten böyle işaretlemiş. Panel yeni bir
alan uydurmak yerine aynısını kullanıyor; böylece Vega'nın kendi
raporlarında da pasif görünüyor.

Pasiften çıkarırken **yalnızca `PASİF` yazan kartlar** temizleniyor; `KOD8`
alanında başka bir değer varsa ona dokunulmuyor.

Pasif kartlar stok listelerinde ve sayım föylerinde görünmez (`pasifDahil`
süzgeciyle geri getirilebilir). Hareketleri, geçmişi ve envanteri olduğu
gibi durur — kart silinmiyor, yalnızca listelerden çekiliyor.

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

## Şefim günlük satış aktarımı (11 / 13 / 33)

Vega'nın kendi **"Şefim Entegrasyon"** programının 184 gün boyunca yazdığı
belgeler okunarak çıkarıldı; 11.08.2026 iş günü için kuruşu kuruşuna
doğrulandı (`kurulum/test-aktarim.js`). Panel bu deseni `db/aktarim.js` +
`db/yazma.js` → `sefimAktarimYaz()` içinde uyguluyor.

### Bir günün belgeleri

| Belge | Tip | Cari | Ne |
|---|---|---|---|
| Stok çıkış | 33 | ŞEFSATIŞ | Günün satışının stoktan düşmesi + cariye borç |
| Cari giriş | 13 | ŞEFSATIŞ | Her tahsilat türü için AYRI belge (nakit, kredi kartı…) |
| Cari çıkış | 11 | ŞEFİMKASA | Şefim'de girilen kasa giderleri |
| Cari giriş | 13 | ŞEFİMKASA | Şefim'de girilen kasa girişleri |
| Stok çıkış | 33 | *müşteri* | **Her veresiye müşterisi için ayrı fiş** |

Hepsinde `OZELKOD4 = 'SEFIM'`. Panel de aynı işareti yazıyor; panelin kestiği
belge `BELGENO` önekinden (`GP`) ayırt ediliyor.

### Hangi satırlar giriyor

```
Bill ⋈ BillHeader
  BillState = 1            kapanmış adisyon
  Canceling = 0
  iş günü 04:00 → 04:00    (ayarlarda sefimGunKesimSaati)
  Payment.Debit = 0        veresiye adisyon ŞEFSATIŞ belgesine GİRMEZ
```

Vega satırı = **(stok kartı, KDV dahil fiyat)** grubu:

```
MIKTAR   = Σ Quantity
FIYATI   = Price / (1 + KDV/100)     Bill.Price KDV DAHİLDİR
KDV      = stok kartının KDV grubundan (TBLKDVGRUPLARI)
AFIYATI  = kartın MALIYET'i
```

Başlıktaki `TUTAR` **günün tahsilatıdır** (nakit + kredi kartı), satır
toplamı değil; ikisi arasındaki kuruş farkı `YUVARLAMA`'ya yazılır. Vega'nın
kendi 11.08 belgesinde `ARATOPLAM 142.910,2397 / TUTAR 142.910,21 /
YUVARLAMA −0,0299`.

> Panel bu farkı bir **emniyet ölçüsü** olarak kullanıyor: fark kuruş
> mertebesini aşarsa (>1 TL ya da >%0,05) aktarım engelleniyor. Büyük bir
> "yuvarlama" yuvarlama değildir — eşleşmeyen ya da "yoksay" işaretli bir
> ürün belgeye girmemiş demektir.

### Ürün → stok kartı eşleşmesi

Üç kademe, sırayla:

1. Panelin kendi `UrunEslestirme` tablosu (kullanıcı elle bağladıysa).
2. **Vega'nın geçmiş Şefim belgelerinde aynı ürün adına yazdığı kart — en
   SON kullanılanı.** Firma zaman zaman bir ürünü başka bir karta bağlıyor
   (birkaç bira `BAŞLANGIÇ İKRAM`a, `Karpuz Tabağı` `FİX 7 YAŞ ALTI`na
   bağlanmış). En SIK kullanılan alınırsa eski eşleşme kazanıyor ve stok
   yanlış karttan düşüyor.
3. Birebir isim eşleşmesi (geçmişi olmayan yeni ürün).

11.08 iş gününde bu zincir Vega'nın 104 satırının 103'ünü birebir üretiyor.

### Veresiye adisyonlar

`Payment.Debit <> 0` olan adisyon ŞEFSATIŞ belgesine girmiyor; parası
alınmadığı için günün tahsilatına dahil değil. Kanıtı: 11.08'de üç adisyon
veresiye kapanmıştı (950,00 + 835,00 + 750,00 = **2.535,00**); Şefim satır
toplamı 145.445,21, ŞEFSATIŞ belgesi 142.910,21 — fark tam 2.535,00.

Kaybolmuyorlar: her **müşteri** için ayrı stok çıkış fişi kesiliyor ve tutar
o carinin borcuna yazılıyor. Cari kartı yoksa Şefim'deki müşteri adıyla
açılıyor (`Payment.CustomerName`).

> Borca yazılan tutar adisyonun **tam** tutarıdır, indirim düşülmez.
> ONUR ÇEBİ'nin adisyonu 584,50 veresiye + 250,50 indirimdi; Vega 835,00
> borç yazdı.

### Kasa satırı ne zaman yazılır

`TBLKASA` yalnız **fiziksel para** hareketinde:

| Belge | ISLEM | Alan | Kasa satırı |
|---|---|---|---|
| Nakit tahsilat (13) | −2 | GELIR | var |
| Kredi kartı tahsilatı (13) | — | — | **yok** |
| Kasa gideri (11) | −3 | GIDER | var |

Açıklama biçimi Vega'nınkiyle aynı: `ŞEFİMKASA\ekmek (Admin)` —
cari kodu + `\` + Şefim'deki açıklama + ` (kullanıcı)`.

### Vega'nın kendi programındaki kusur

Şefim Entegrasyon, **aktarmadığı satırları da** `Bill.Aktarildi = 1` diye
işaretliyor. Veresiye adisyonun satırları belgeye girmiyor ama bir daha da
aday olmuyor. Panel bunu tekrarlamıyor: yalnızca gerçekten yazdığı `Bill`
kimliklerini işaretliyor, kalanı ertesi gün yeniden aday oluyor.

> `Bill.Aktarildi` yazabilmek için SQL kullanıcısının **sefim** veritabanında
> UPDATE yetkisi gerekir (`kurulum/sql-yazma-yetkisi-ver.sql`). Yetki yoksa
> panel işaretlemeyi atlıyor ve ekranda uyarı gösteriyor — o gün Vega'nın
> kendi programı çalıştırılırsa satış stoktan iki kez düşer.

### Aynı gün iki kez aktarılmasın

Üç kapı var, üçü de gerekli:

1. **Panelin kendi kaydı** (`GALYA_PANEL.dbo.SefimAktarim`) — o gün daha önce
   aktarılmış mı.
2. **Vega tarafı** — o güne ait ŞEFSATIŞ belgesi var mı. Panelde kaydı
   olmayan ama Vega'nın kendi programının yaptığı aktarımı bu yakalıyor.
3. **Rezervasyon kilidi** — Vega'ya tek satır yazılmadan önce gün
   `Durum = 'yaziliyor'` ile rezerve ediliyor. `SefimAktarim` üzerindeki
   süzgeçli benzersiz indeks (`Firma, Donem, IsGunu` · `GeriAlindi = 0`)
   aynı anda gelen ikinci isteği veritabanı seviyesinde reddediyor.

1 ve 2 tek başına yetmez: iki kişi aynı saniyede düğmeye basarsa ikisi de
okuma kontrolünü geçer. Yarışı çözen 3'tür.

Yazma hata verirse rezervasyon siliniyor, gün yeniden aday oluyor. Program
çakarsa satır `yaziliyor`da asılı kalır; 15 dakika sonra **yönetici**
temizleyebilir (`aktarim:kilitTemizle`) — panel önce Vega'ya bakıp belge
yazılmış mı diye kontrol ediyor.

### Sınama

```
node kurulum/test-aktarim.js                 mutabakat (yalnız okur)
node kurulum/test-aktarim-kolon-denetimi.js  kolon doluluğu (yalnız okur)
node kurulum/test-aktarim-yazma.js           uçtan uca yazma (GALYA_TEST)
```

---

## Henüz çıkarılmamış desenler

Kalmadı: panelin yazdığı bütün belge tipleri (11/13 cari giriş-çıkış,
20 alış faturası, 32/33 stok giriş/çıkış, 38 depo transferi, 93/94 sayım,
96/97 üretim) gerçek fişlerden çıkarıldı ve sınandı.

