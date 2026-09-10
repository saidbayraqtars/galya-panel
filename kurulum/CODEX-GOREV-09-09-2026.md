# Codex görev notu — 09.09.2026

Bu belge **Vega veritabanını hiç bilmeyen** bir geliştiriciye yazıldı. Önce
1–2. bölümleri sonuna kadar oku; görevler (4. bölüm) bu bilgi olmadan
yapılamaz. Belgedeki bütün sayılar, tablo adları ve satır örnekleri
**09.09.2026'da canlı VEGADB'den salt okunur sorgularla** alınmıştır,
tahmin yoktur.

Okuma sırası:

1. `kurulum/DEVIR-NOTU.md` (projenin tamamı; özellikle §4, §5, §11, §13)
2. `kurulum/BELGE-DESENI.md` (Vega'nın belge yazma deseni)
3. `kurulum/URETIM-BULGU-08-09-2026.md` (üretim fişi deseni, video çözümlemesi)
4. bu belge

---

## 1. İhlal edilmeyecek kurallar

1. **Canlı VEGADB'ye tek satır yazma.** Yazma sınamaları yalnız `GALYA_TEST`
   veritabanında yapılır (`kurulum/test-yazma.js` bunu kendi kuruyor).
   `ayarlar.json` → `vegayaYazmaAktif` alanını sen değiştirme.
2. **Canlı veritabanında yalnız `SELECT`.** `UPDATE/INSERT/DELETE/MERGE`,
   `sp_rename`, `ALTER` yok. Kolon öğrenmek için `INFORMATION_SCHEMA.COLUMNS`
   kullan.
3. **Program açıkken sınama çalıştırma.** `GALYA_PANEL.dbo.Kullanici`
   tablosunda tek satır bile varsa panel giriş ister; testler o yüzden
   `GALYA_TEST` üzerinden gider.
4. **Belge serisi `GP`.** Vega elle belge girişinde `A` serisini kendi
   kullanıyor; panelin kestiği her belge `GP0000001` gibi olmalı
   (`ayarlar.json` → `belgeOneki`).
5. **Kolon doluluk kuralı.** Vega'nın %100 doldurduğu bir kolonu panel boş
   bırakırsa belge Vega'nın ekranında **hiç açılmaz**. Her yeni yazma için
   `kurulum/test-kolon-denetimi.js` ve `test-aktarim-kolon-denetimi.js`
   çalıştırılır.
6. Bir şeyden emin değilsen **Vega'nın kendi verisine bak** (aynı belge
   tipinden gerçek satırları oku ve panelinkiyle kolon kolon karşılaştır).
   Tahmin yürütme.

---

## 2. Veritabanı — sıfırdan

### 2.1 Sunucu ve veritabanları

| Veritabanı | Ne | Panel ne yapar |
|---|---|---|
| `VEGADB` | Vega ERP'nin kendi veritabanı (müşterinin gerçek verisi) | okur, onaylı yerlerde yazar |
| `sefim` | Şefim adisyon/POS programının veritabanı | okur; aktarılan satırı `Bill.Aktarildi = 1` yapar |
| `GALYA_PANEL` | Panelin kendi veritabanı (kullanıcı, log, sayım, aktarım kaydı) | tam yetki |
| `GALYA_TEST` | VEGADB'nin sınama kopyası | yazma sınamaları burada |

Bağlantı bilgisi `ayarlar.json` içinde, kod tarafı `db/sql.js`.

### 2.2 Tablo adlandırma — en çok yanlış yapılan yer

Vega bir veritabanında **birden fazla firma** ve her firmada **birden fazla
dönem** tutar. Tablo adı bu yüzden ön ek taşır:

```
F0102TBLSTOKLAR                → firma tablosu  (dönemi yok: kartlar)
F0102D0002TBLSTOKHAREKETLERI   → dönem tablosu  (F = firma 0102, D = dönem 0002)
TBLLOG, TBLLOCKS               → ön eksiz, ortak
```

Kodda bunlar `db/firma.js` içindeki iki yardımcıyla üretilir:

```js
kart(v, firma, 'TBLSTOKLAR')                 // [VEGADB].dbo.[F0102TBLSTOKLAR]
tablo(v, firma, donem, 'TBLSTOKHAREKETLERI') // [VEGADB].dbo.[F0102D0002TBLSTOKHAREKETLERI]
```

**Firma/dönem adını asla koda gömme.** Bu kurulumda varsayılan `F0102` /
`D0002` (`ayarlar.json`), ama aynı sunucuda `F0100` gibi başka firmalar da
var ve orada üretim modülü hiç kullanılmadığı için `TBLURERECETECIKTI` gibi
tablolar **yoktur**. Yeni bir tabloya dokunmadan önce
`tabloVarMi(firma, donem, ad)` ile varlığını sor (örnek: `db/uretim.js`
→ `urunAra`).

### 2.3 Anahtar kavramlar

| Kavram | Anlamı |
|---|---|
| `IND` | Her tablonun kendi birincil anahtarı, çoğunda `IDENTITY` (otomatik artan) |
| `EVRAKNO` | Satır tablosunda **başlığın IND'i** (stok numarası değil!) |
| `BELGENO` | Belge numarası (sayı). 96/97 üretim belgelerinde ayrı bir sayaç |
| `IZAHAT` | Stok hareketinin belge tipi (aşağıdaki tabloya bak) |
| `LN` | `TBLSTOKHAREKETLERI` satırının belge satırına (`TBLSHAREKET.IND`) bağı |
| `DETAY` | Satır sırası. Vega her belge ekranında `SET DETAY=IND-DETAY` düzeltmesi çalıştırır; peşine düşme |
| `DELETED` | 1 ise kart silinmiş sayılır; sorgularda hep `ISNULL(DELETED,0)=0` |
| `IND >= 100` | 100'ün altındaki kayıtlar Vega'nın sistem kayıtlarıdır, listelenmez |

### 2.4 Stok kartı: `TBLSTOKLAR`

Canlı örnek (bu belgede sürekli kullanılacak):

```
IND   STOKKODU            MALINCINSI          STOKTIPI STATUS KOD8   KOD2    BIRIM
371   DANA ANTRIKOT       DANA ANTRIKOT KG    19       1      NULL   MUTFAK  KG
4568  HAM  DANA ANTRİKOT  HAM  DANA ANTRİKOT  18       1      NULL   MUTFAK  KG
4459  DANA KUŞBAŞI        DANA KUŞBAŞI        -        1      NULL   -       KG
914   DANA KIYMA          DANA KIYMA          -        1      NULL   -       KG
4569  FİRE                FİRE                -        1      NULL   -       ADET
4471  KARKAS ANTRİKOT     KARKAS ANTRİKOT     18       2      PASİF  NULL    KG
```

Dikkat edilecekler:

- **`STOKKODU` (kod) ile `MALINCINSI` (ad) çoğu kartta FARKLIDIR.** 371
  numaralı kartın adı `DANA ANTRIKOT KG`, kodu `DANA ANTRIKOT`. Vega'nın
  üretim çıktısı ekranında **kod** görünür, panelde **ad**. İkisi aynı
  karttır — müşteri "DANA ANTRIKOT KG'nin çıktısında DANA ANTRIKOT yazıyor"
  derse yanlışlık yok demektir (09.09.2026'da doğrulandı; panelde alt satır
  artık `kod: …` diyor).
- **Pasiflik iki alanda birden tutulur:** `STATUS = 2` **veya**
  `KOD8 = 'PASİF'`. Vega ikisini ayrı ayrı kullanıyor; 257 kart yalnız
  birinde işaretli. Panelin süzgeci `db/vega.js` → `stokPasifHaric()`.
  Kendi sorgunda pasif süzeceksen **bu yardımcıyı kullan**, elle `STATUS=2`
  yazma.
- `STOKTIPI`: 3/7/9 = gider-hizmet, 11 = grup kartı (STOK, MUTFAK, ALKOL
  gibi ağaç düğümleri), 26 = hizmet, 34 = depozito. Bunların birim maliyeti
  yoktur; listelerden çıkarılır.
- `MALIYET` = kartın birim maliyeti, `ALISFIYATI` = son alış fiyatı.

### 2.5 Depo, üretim yeri, şube, firma — dördü ayrı şeydir

Bu kurulumdaki **depolar** (`F0102TBLDEPOLAR`):

```
IND  DEPOKODU   DEPOADI
1    MERKEZ     MERKEZ
2    HURDA      HURDA
3    TRANSFER   TRANSFER
5    SATIS      SATIS
100  MUTFAK     MUTFAK
101  BAR        (yok)
102  SHERATON   SHERATON
```

**Üretim yeri numarası depo numarası DEĞİLDİR.** DANA ANTRIKOT reçetesinin
(4516) pozisyonları:

```
SIRANO KOD    URETIMYERINO URETIMYERIKODU DEPONO DEPOKODU
1      BAŞLA  100          MUTFAK         100    MUTFAK
2      BİTİR  102          MERKEZ         1      MERKEZ
```

BİTİR adımında üretim yeri **102 = MERKEZ**, ama depo **1 = MERKEZ**. Bu
kurulumda depo 102 `SHERATON`'dur. İkisini karıştıran kod mamulü yanlış
depoya — başka bir şubeye — yazar. Müşterinin birden fazla deposu/şubesi
olduğu için bu kritik.

**Şube:** belgelerin `OZELKOD1` / `OZELKOD2` alanlarında taşınıyor; panel
bunu `db/yazma.js` → `faturaSubeKodlari()` ile mevcut belgelerden okuyup
aynısını yazıyor.

**Firma:** `F0102` gibi. Panel tek firmaya kilitli değil; ayarlardan
seçiliyor ve bütün sorgular `dogrula(secim.firma, secim.donem)` ile
başlıyor. Yeni kod da öyle başlamalı.

### 2.6 Belge tipleri (`IZAHAT`)

| Kod | Ne | Nerede |
|---|---|---|
| 11 / 13 / 33 | Şefim satış aktarımının kestiği belgeler | `BELGE-DESENI.md` |
| 20 | Alış faturası | maliyet hesabı bunun son satırından çıkar |
| 33 | Stok çıkış fişi (zayi/fire/personel) — cari hareketi de doğar | `db/zayi.js` |
| 38 | Depo hareket (transfer) fişi satırı | `TBLDEPOHARBASLIK` / `TBLDEPOHARHAREKET` |
| 67 | Sayım fişi — envanter toplarken **hariç tutulur** | `BELGETIPI <> 67` |
| 96 | **Üretim girişi** (üretimden çıkan mamuller) | üretim fişi |
| 97 | **Üretim tüketimi** (üretimde harcanan hammadde) | üretim fişi |

96 ve 97'nin **başlık tablosu yoktur**; ama **satır tablosu vardır**:
`F{firma}D{dönem}TBLSHAREKET`. Bu 08.09.2026'da bulundu — panel önceden
oraya hiç yazmıyordu ve belge Vega'nın ekranında satırsız görünüyordu.

### 2.7 Üretimin tablo zinciri

Bir üretim fişi şu tabloları doğurur:

```
TBLUREURETIMLIST     başlık                 IND = üretimin kimliği, FISNO = 'GP0000123'
TBLUREURETIM         tüketim satırları      EVRAKNO = başlık IND
TBLUREURETIMCIKTI    çıktı satırları        EVRAKNO = başlık IND, RECETENO = başlık IND (yalnız ana mamulde)
TBLUREURETIMPOZ      pozisyon adımları      EVRAKNO = başlık IND
TBLUREURETIMARAC     makine/araç satırları  EVRAKNO = başlık IND (reçeteden kopyalanır)
TBLUREBELGE          doğan belgelerin dizini (MAMULSATIRI = ana mamul satırının LN'i)

TBLSHAREKET          96/97 belgelerinin satırları (IND = IDENTITY → LN)
TBLSTOKHAREKETLERI   stok hareketi           LN = TBLSHAREKET.IND
TBLDEPOENVANTER      envanter satırı         HAREKETIND = TBLSHAREKET.IND
TBLDEPOHARBASLIK/HAREKET  depo hareket (transfer) fişleri — pozisyon adımları için
```

Reçete tarafı (dönemsiz, firma tabloları):

```
TBLURERECETELIST   reçete başlığı  IND = reçete no, STOKNO = mamul, MIKTAR = verim
TBLURERECETE       bileşenler      EVRAKNO = reçete IND
TBLURERECETECIKTI  çıktılar        EVRAKNO = reçete IND, TUR 0 = ana mamul / 2 = yan mamul-fire, ORAN = maliyet payı %
TBLURERECETEPOZ    pozisyonlar     EVRAKNO = reçete IND
TBLURERECETEARAC   araçlar         EVRAKNO = reçete IND
```

Maliyet formülü (Vega'nın 68 fişiyle ve müşterinin ekran kaydıyla
doğrulandı):

```
toplamMaliyet = Σ (tüketilen miktar × bileşenin birim maliyeti)
satır.TUTAR   = toplamMaliyet × ORAN / 100
satır.FIYAT   = satır.TUTAR / satır.MIKTAR
```

`ORAN` toplamı 100 olmak zorunda değil: 4516 numaralı reçetede toplam
**200**'dür ve Vega bunu uyarmadan uygular (23.750 TL hammadde 47.500 TL
mamule dönüşür). Panel aynı sayıyı yazar, ekranda uyarı gösterir.

### 2.8 Canlı örnek: 08.09.2026'da müşterinin yaptığı üretim

Bu, aşağıdaki her görevin ölçüsüdür. Müşteri Vega'nın **İş Emri** ekranında
şunu yaptı (ekran kaydı + izleyici çıktısı):

```
Mamul     : DANA ANTRIKOT KG (stok 371), reçete 4516, fiş A0000298, başlık IND 1410
Girdi     : HAM  DANA ANTRİKOT (stok 4568) 25 KG × 950 TL = 23.750 TL
Pozisyon  : 1 BAŞLA / MUTFAK,  2 BİTİR / MERKEZ
Çıktılar  : DANA ANTRIKOT 18 · DANA KUŞBAŞI 3 · DANA KIYMA 3 · FİRE 1   (toplam 25)
```

Vega'nın yazdıkları (`TBLLOG` satırlarından):

```
DepoÇık  Z0000433  (TBLDEPOHARBASLIK IND 1535)  23.750,00 TL   ← BAŞLA adımı
DepoÇık  Z0000434  (IND 1536)                   23.750,00 TL   ← BİTİR adımı
ÜreÇık   Z0052865  (97 = tüketim)               23.750,00 TL
ÜreGir   Z0052866  (96 = çıktılar, dört satır)  47.500,00 TL
```

Sonuç tablosu (Vega'nın ekranı):

| Çıktı türü | Stok | Miktar | Birim maliyet | Toplam | Oran |
|---|---|---:|---:|---:|---:|
| Ana Mamul | DANA ANTRIKOT | 18 | 1.319,444436 | 23.749,99 | 100 |
| Yan Mamul | DANA KUŞBAŞI | 3 | 0 | 0 | 0 |
| Yan Mamul | DANA KIYMA | 3 | 7.916,666616 | 23.749,99 | 100 |
| Yan Mamul | FİRE | 1 | 0 | 0 | 0 |

**İzleyici kaydı tek başına yetmez.** Vega INSERT'lerin çoğunu hazırlanmış
(`sp_executesql`) ifadeyle gönderiyor ve `main.js`'teki
`YAZAN = /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/` süzgeci bunları yakalamıyor.
Desenin tamamı VEGADB okunarak çıkarıldı.

---

## 3. Panelin bugünkü hâli

```
db/uretim.js    okuma: sifirAdaylari(), urunAra(), receteCiktilari(), isEmri(),
                sifiraKadarUret(), fireliUret()
db/yazma.js     yazma: uretimHazirligi(), ciktiSatirlariniCoz(), uretimFisiYaz(),
                uretimFisiGeriAl(), uretimStokHareketiYaz(), depoTransferiYaz()
db/maliyet.js   reçete maliyet motoru (ORAN'ı uyguluyor)
db/aktarim.js   Şefim günlük satış aktarımı (okuma, mutabakat, aktar, geri al)
ui/app.js       ekranlar.uretim → uretimFireliBolumu() (İş Emri ekranı),
                ekranlar.gunlukAktarim → uretilecekleriCiz()
main.js         kanallar; yetki süzgeci db/yetki.js
```

### 09.09.2026'da yapılanlar (tekrar etme, üstüne koy)

| # | Ne | Nerede |
|---|---|---|
| 1 | Ekran bölüm adları Vega'nın sekme adlarına çevrildi: **Üretim Girdileri**, **Üretim Çıktıları** | `ui/app.js` |
| 2 | **Pozisyonlar** bölümü eklendi (salt okunur: sıra, pozisyon, üretim yeri, depo + hangi depodan hangi depoya yazılacağını anlatan alt not) | `ui/app.js` → `pozTablosunuKur()` |
| 3 | `uretim:isEmri` artık `pozlar` da döndürüyor (`TBLURERECETEPOZ` + `TBLDEPOLAR` adı) | `db/uretim.js` → `isEmri()` |
| 4 | Ürün seçme penceresine **Reçete** sütunu ("Reçeteli · n bileşen" / "Reçetesiz") | `ui/app.js`, `db/uretim.js` → `urunAra()` |
| 5 | Çıktı satırının alt notu artık `kod: …` diyor (ad/kod karışıklığı) | `ui/app.js` |

Canlı doğrulama (salt okunur): `uretim:isEmri` 371 için 1 girdi, 4 çıktı,
2 pozisyon (MUTFAK → MERKEZ) döndürüyor; `urunAra` TUBORG kartlarını
"Reçetesiz" işaretliyor.

---

## 4. GÖREVLER

### GÖREV A — Pozisyon → depo hareketi: çoklu depo / şube / firma denetimi

**Neden:** Üretim yalnız 96/97 stok hareketi doğurmuyor; pozisyon adımları
için **iki depo hareket fişi** de kesiliyor (Z0000433 / Z0000434). Tek
depolu kurulumda kimse fark etmez; müşterinin MERKEZ, MUTFAK, BAR, SHERATON
depoları var — yanlış depoya yazan fiş başka şubenin stoğunu bozar.

**Bugünkü kod:** `db/yazma.js` → `uretimFisiYaz()`:

```js
const bitir = h.pozlar.find((p) => Number(p.sira) === 2) || null;
const basla = h.pozlar.find((p) => Number(p.sira) === 1) || null;
const mamulDeposu  = Number(kayit.depo || (bitir && bitir.depoNo) || ayarOku().varsayilanDepo || 1);
const uretimDeposu = Number((basla && basla.depoNo) || 0) || mamulDeposu;
```

Sonra iki kez `depoTransferiYaz()` çağrılıyor (mamul deposu → üretim deposu,
sonra geri).

**Yapılacaklar:**

1. **Öncelik hatası.** `kayit.depo` (ekrandan/ayardan gelen depo) reçetenin
   `BİTİR` adımından **önce** geliyor. Reçete "mamul MERKEZ'e girsin" derken
   ayardaki varsayılan depo MUTFAK ise mamul yanlış depoya girer. Vega'nın
   davranışı: **pozisyon kazanır.** Sırayı `bitir.depoNo → kayit.depo →
   varsayılan` yap; fark varsa ekranda uyar.
2. **Pozisyonsuz reçetede üretim yeri = depo yapılmış.** Aynı fonksiyonda
   varsayılan pozisyon satırları yazılırken `URETIMYERINO` alanına depo
   numarası konuyor:
   ```js
   { sira: 1, kod: 'BAŞLA', …, yerNo: uretimDeposu, depoNo: uretimDeposu }
   ```
   Üretim yeri ile depo ayrı numaralandırmadır (§2.5). Önce Vega'nın gerçek
   fişlerine bak:
   ```sql
   SELECT TOP 50 P.EVRAKNO, P.SIRANO, P.KOD, P.URETIMYERINO, P.URETIMYERIKODU,
          P.DEPONO, P.DEPOKODU
   FROM   [VEGADB].dbo.[F0102D0002TBLUREURETIMPOZ] P
   ORDER  BY P.EVRAKNO DESC;
   ```
   Bulduğun desene uy. Uyduramıyorsan `URETIMYERINO = 0` bırakmak yanlış
   numara yazmaktan iyidir (sonra kolon denetimini çalıştır).
3. **İki transfer fişini Vega'nınkiyle kolon kolon karşılaştır.** Vega'nın
   gerçek fişleri elde: `TBLDEPOHARBASLIK` IND **1535** ve **1536**
   (`BELGENO` Z0000433 / Z0000434):
   ```sql
   SELECT * FROM [VEGADB].dbo.[F0102D0002TBLDEPOHARBASLIK]  WHERE IND     IN (1535,1536);
   SELECT * FROM [VEGADB].dbo.[F0102D0002TBLDEPOHARHAREKET] WHERE EVRAKNO IN (1535,1536);
   ```
   Özellikle: `DEPO`, `HAREKETDEPOSU`, `BELGETIPI`, `GIRIS`,
   `STOKHAREKETEYAZ`, `CARIHAREKETEYAZ`, `ENVANTERUPDATE`, `OZELKOD1/2`
   (şube), `GK`. Vega'nın iki fişi de `TBLLOG`'a **DepoÇık** diye geçmiş —
   panelin yön mantığı (`hedefDepo` / `kaynakDepo`) bununla tutuyor mu?
4. **Şube kodları.** `faturaSubeKodlari()` şube kodunu mevcut alış
   faturalarından okuyor; birden fazla şubeli kurulumda bu "son kullanılan
   şube"yi getirir. Doğrusu **üretimin yapıldığı deponun şubesi**dir.
   Vega'nın üretim ve depo belgelerinde `OZELKOD1/OZELKOD2` depoya göre
   değişiyor mu — canlıdan oku, sonra karar ver. Değişiyorsa depo → şube
   eşlemesini kur.
5. **Depo seçimi ekranda görünmeli.** Reçetesiz üretimde ayar deposu
   sessizce kullanılıyor; kullanıcı hangi depoya ürettiğini göremiyor.
   Reçetesiz üretimde depo seçtir.

**Kabul ölçütü:** `GALYA_TEST`'te MUTFAK→MERKEZ reçetesiyle bir üretim
yazıldığında iki depo hareket fişinin depoları reçetedeki pozisyonlarla
birebir; ayardaki varsayılan depo değiştirilse bile sonuç değişmiyor; kolon
denetimi 0 eksik.

---

### GÖREV B — Pasif stoklar

**Neden:** Müşteri "pasif stoklardan da emin olalım" dedi. Panelin süzgeci
var ama kapsamı denetlenmedi.

**Canlı durum (09.09.2026, F0102):**

- 433 reçetenin **hepsinde** bileşen ve çıktı satırı var (boş reçete yok).
- **Reçetesi olan 6 kart pasif:** `BADEM KG` (reçete 2404),
  `CHOCOLATE DE FRANCE` (2326), `Galya Kuver` (2237), `milano pizza` (2315),
  `Serpme Kahvaltı` (2337), `ZEYTİN EZMESİ` (2252).
- **25'ten fazla aktif reçetede pasif bir kart bileşen olarak duruyor**
  (`ANA YEMEK.MANTI` → `NANE`, `Fettucini Alfredo` → `KÜLTÜR MANTARI`,
  `Gin.Bulldog.Duble` → `Gin.Bulldog.70cl` …).

**Yapılacaklar:**

1. `stokPasifHaric()` / `pasifIfadesi()` kullanan **her** sorguyu çıkar
   (grep) ve şu tabloyu belgeye yaz: hangi ekran pasifi süzüyor, hangisi
   gösteriyor, hangisi yalnız işaretliyor.
2. Kuralı netleştir ve uygula:
   - **Mamul pasifse** üretim listelerinde ve ürün seçicide **çıkmaz**
     (bugün öyle; doğrula).
   - **Bileşen pasifse** üretim yazmayı **engelleme** — Vega yazıyor — ama
     İş Emri ekranında o satırı "pasif kart" diye işaretle. Maliyet motoru
     bilerek pasifi süzmüyor: süzülürse üst mamulün maliyeti eksik çıkar
     (`db/vega.js` → `sonAlisFiyatlari` yorumu).
   - **Çıktı satırı pasifse** (yan mamul pasife alınmış olabilir) uyar.
3. Pasifliğin iki alanda tutulduğunu unutma (`STATUS = 2` **veya**
   `KOD8 = 'PASİF'`); yeni sorguda ikisini birden sor.
4. Sınama: `kurulum/test-sorgular.js` içine "pasif mamul üretim listesinde
   görünmüyor" ve "pasif bileşenli reçete uyarı veriyor" vakalarını ekle.

---

### GÖREV C — "Reçeteli görünen" ürünler (TUBORG GOLD vakası)

**Canlı durum:** `TUBORG` geçen üç kart var —
`33 CL TUBORG GOLD RB DEPOZİTO` (4322, depozito kartı, STOKTIPI 34),
`Bira.Tuborg 33cl` (297), `Bira.tuborg ice` (749) — ve **hiçbirinin reçetesi
yok**. Yani veri doğru; sorun, ekranın onları reçeteliymiş gibi
göstermesiydi. Ürün seçicideki "Reçete" sütunu 09.09'da eklendi (§3).

**Yapılacaklar:**

1. Panelin "reçeteli" diye ürün listelediği **bütün** yerleri tara ve
   birebir ölç:
   ```sql
   SELECT COUNT(DISTINCT STOKNO) FROM [VEGADB].dbo.[F0102TBLURERECETELIST];
   ```
   Ekranın gösterdiği sayı bununla tutmuyorsa sorgu yanlıştır. Bakılacak
   uçlar: `recete:mamuller` (`db/vega.js` → `receteliMamuller`),
   `uretim:urunAra`, `aktarim:uretilecekler` (`uretim.sifirAdaylari`),
   `db/maliyet.js`.
2. `receteliMamuller()` pasif mamulleri süzmüyor — ekranda "pasif" rozeti
   göster (silme, göster).
3. **Çok çıktılı reçetelerde "sıfıra kadar üret" tehlikesi.**
   `ciktiSatirlariniCoz()` çıktı listesi verilmezse **yalnız ana mamul**
   satırını yazıyor. F0102'de 7 reçete çok çıktılı: 4516 DANA ANTRIKOT,
   4496 DANA BONFILE, 4497 TAVUK BONFILE, 4499 SOMON, 4506 DANA CİĞER,
   4515 LEVREK, 4534 TAVUK PIRZOLA. Bunlar "sıfıra kadar üret" veya
   "hepsini sıfırla" ile üretilirse Vega'nın yazacağı yan mamul satırları
   hiç oluşmaz. Bu ürünleri toplu üretimden **çıkar** ya da "bu ürün İş
   Emri ekranından üretilmeli" diye durdur.

---

### GÖREV D — Belge zinciri denetimi (üretim çıkış fişi / depo hareket fişi)

**Neden:** Müşterinin cümlesi: *"sonucunda da üretim çıkış fişi, depo hareket
fişi filan oluyor, bunlara dikkat etmemiz şart."* Bir üretim **altı** belge
doğuruyor (üretim başlığı + 97 tüketim + 96 giriş + 2 depo hareket fişi +
`TBLUREBELGE` dizini). Bugün bunların tamamını uçtan uca doğrulayan tek bir
sınama yok.

**Yapılacaklar:**

1. `kurulum/test-uretim-belge-zinciri.js` yaz. `GALYA_TEST`'te bir üretim
   yazsın ve şunları tek tek doğrulasın:
   - `TBLUREURETIMLIST` 1 satır, `FISNO` `GP` serisinde.
   - `TBLUREURETIM` bileşen sayısı kadar satır; tutar = Σ miktar × maliyet.
   - `TBLUREURETIMCIKTI` reçetedeki çıktı sayısı kadar satır; yalnız `TUR=0`
     satırının `RECETENO` alanı = başlık IND, diğerleri `NULL`.
   - `TBLUREURETIMPOZ` reçetedeki pozisyon sayısı kadar; depolar birebir.
   - `TBLUREURETIMARAC` reçetedeki araç sayısı kadar.
   - 96 ve 97 belgelerinin **her satırı** için `TBLSHAREKET` satırı var ve
     `TBLSTOKHAREKETLERI.LN = TBLSHAREKET.IND`,
     `TBLDEPOENVANTER.HAREKETIND = TBLSHAREKET.IND`.
   - `TBLUREBELGE.MAMULSATIRI` = `TUR=0` satırının LN'i.
   - İki `TBLDEPOHARBASLIK` + satırları; depolar pozisyonlarla aynı.
   - `uretimFisiGeriAl()` sonrası **hiçbir tabloda kalıntı yok** (özellikle
     `TBLSHAREKET` ve `TBLDEPOHARHAREKET`).
   Karşılaştırma ölçüsü Vega'nın gerçek fişi olsun: başlık IND **1410**,
   reçete **4516**.
2. Kolon doluluk denetimini bu altı belgenin **hepsini** kapsayacak şekilde
   genişlet (`kurulum/test-kolon-denetimi.js`).
3. **Canlıda temizlik borcu.** 25.08.2026'da panelin bıraktığı iki fişin
   (`A0000290`, `A0000291`) 10 satırı `TBLSHAREKET`'te yok
   (`BELGENO 55206–55209`, `LN 176423–176432`). `TBLSHAREKET`'in IDENTITY
   değeri hâlâ 176422 olduğu için Vega'nın yazacağı sonraki 10 belge satırı
   aynı LN'leri alacak ve `MAMULSATIRI` eşleşmesi bozulacak. Onarım betiğini
   **yaz ama çalıştırma**: `kurulum/oksuz-shareket-onar.sql` desenine bak,
   aynı üslupta hazırla ve dosyanın başına "müşteri onayı + yedek olmadan
   çalıştırılmaz" yaz.

---

### GÖREV E — Şefim aktarımından sonraki **manuel üretim** (asıl istenen iş)

**Yönerge:** `DEVIR-NOTU.md` §13 ("Şefim günlük aktarımı — panele taşındı").
Kaynak: müşterinin gönderdiği izleyici kaydı (`izleme-2026-09-08-134106.md`)
ve ekran kaydı.

**Müşterinin sabah rutini (gerçek):**

1. Vega'nın "Şefim Entegrasyon" programını açar, dünkü satışı aktarır.
   → **Bu adım panele girdi** (`db/aktarim.js`, ekran `gunlukAktarim`).
2. Aktarım stoğu düşürünce eksiye geçen mamulleri üretir. Panelde bugün
   yalnız *liste* var: `uretilecekleriCiz()` eksideki reçeteli mamulleri
   gösterip "Üretim ekranını aç" diyor.
3. **Bunun üstüne elle birkaç üretim daha yapıyor.** İzleyici kaydındaki iş
   budur: Vega'nın **İş Emri** ekranında DANA ANTRIKOT reçetesini açıp 25 kg
   ham antrikotu 18 + 3 + 3 + 1 diye dağıtıyor. Bu "eksiği kapatma" değil,
   **hammadde bozma/parçalama** işidir ve miktarları kullanıcı elle yazar.
   Panelde bu iş İş Emri ekranından yapılabiliyor ama **günlük rutinin
   parçası değil**: kullanıcı ekran değiştirmek, ürünü yeniden aramak,
   miktarları hatırlamak zorunda.

**Yapılacak:** aktarım ekranındaki "Aktarımdan sonra üretilecekler"
bölümünü, müşterinin gerçekte yaptığı **iki** işi de kapsayacak hâle getir.

1. **Listeyi ikiye ayır.**
   - *Eksiği kapatılacaklar* (tek çıktılı reçeteli mamuller): bugünkü
     "sıfıra kadar üret" akışı, toplu üretilebilir.
   - *İş emri gerekenler* (çok çıktılı 7 reçete + kullanıcının sık yaptığı
     bozma işleri): her satırda **"İş emri aç"** düğmesi olsun; tıklanınca
     üretim ekranı o mamul **seçili**, girdi/çıktı satırları dolu ve eksik
     miktar ana mamul satırına **önerilmiş** olarak açılsın. Ekran zaten
     `ekranAc('uretim', { … })` ile parametre alabiliyor; `mamulStokNo` ve
     `oneriMiktar` parametreleri ekle, `uretimFireliBolumu()` açılışta
     `mamulSec()` çağırsın.
2. **Son 30 günün alışkanlığını öner.** Müşteri her sabah aşağı yukarı aynı
   üç-beş bozma işini yapıyor:
   ```sql
   SELECT TOP 10 L.STOKNO, S.MALINCINSI, COUNT(*) AS adet, MAX(L.TARIH) AS son
   FROM   [VEGADB].dbo.[F0102D0002TBLUREURETIMLIST] L
   JOIN   [VEGADB].dbo.[F0102TBLSTOKLAR] S ON S.IND = L.STOKNO
   WHERE  L.TARIH >= DATEADD(day, -30, GETDATE())
   GROUP  BY L.STOKNO, S.MALINCINSI
   ORDER  BY COUNT(*) DESC;
   ```
   Bu listeyi "bugün de yapılacak mı?" diye göster; tıklanınca aynı iş emri
   ekranı açılsın. **Kendiliğinden üretim yazma — öneri, yazma değil.**
3. **Günün kaydı.** `GALYA_PANEL.dbo.SefimAktarim` satırı o günün aktarımını
   tutuyor (`Belgeler` alanında yazılan belgelerin IND'leri JSON). O güne
   ait üretim fişlerini de aynı kayda bağla; yeni tablo
   `dbo.SefimAktarimUretim (AktarimId, UretimInd, FisNo, StokNo, Miktar,
   Tarih, Kullanici)` uygun. Amaç: ekranda "bugün aktarım yapıldı + şu 4
   üretim kesildi" diye tek bakışta görünmesi ve geri alırken sıranın
   bilinmesi. Tablo `db/panel.js` içindeki şema kurucusuna eklenir
   (`IF OBJECT_ID(...) IS NULL CREATE TABLE …` deseni orada).
4. **Geri alma sırası — dikkat.** Aktarım geri alınırsa satış stoğa geri
   döner; ama o satış yüzünden kesilen üretim fişleri geri alınmazsa mamul
   stoğu **iki kez** artar. Aktarım geri alma yolu, o güne bağlı üretim
   fişleri varsa **önce onların geri alınmasını** istesin (ya da sırayla
   hepsini geri alsın: önce üretim, sonra aktarım). `db/aktarim.js` geri
   alma yolunda uygula, sınamasını `kurulum/test-aktarim-yazma.js` içine ek.
5. **§13'ün kısıtları geçerli:** aynı gün iki kez aktarılamaz, dönem dışı
   gün aktarılamaz, mutabakat tutmazsa yazma reddedilir. Üretim tarafına da
   aynı disiplin: yazma kilidi kapalıysa (`vegayaYazmaAktif = false`)
   düğmeler pasif olsun.
6. **Belgeye işle:** `DEVIR-NOTU.md` §13'ün altına "Aktarımdan sonraki
   üretim" başlığı aç; ne yapıldığını, hangi tabloların doğduğunu ve geri
   alma sırasını yaz.

**Kabul ölçütü:** `GALYA_TEST`'te bir gün aktarılıyor → ekranda hem "eksiği
kapatılacaklar" hem "iş emri gerekenler" listeleniyor → çok çıktılı bir
reçete iş emri ekranında dolu açılıyor → üretim yazılıyor → aktarım geri
alınmak istendiğinde önce üretimin geri alınması isteniyor → hepsi geri
alındığında hiçbir tabloda kalıntı kalmıyor.

---

## 5. Sınama yordamı

```bash
node kurulum/test-sorgular.js                 # okuma
node kurulum/test-yazma.js                    # GALYA_TEST'e yazma (146 vaka)
node kurulum/test-kolon-denetimi.js           # kolon doluluğu
node kurulum/test-aktarim.js                  # Şefim mutabakatı
node kurulum/test-aktarim-yazma.js            # aktarım uçtan uca
node kurulum/test-aktarim-kolon-denetimi.js
```

Arayüz sınaması (Electron; oturumsuz pencereler atlanır):

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe kurulum/test-arayuz.js
```

`Login failed for user galya_panel` hatası görürsen VEGADB'de öksüz kullanıcı
kalmıştır: `kurulum/sql-yetki-tazele.sql`.

## 6. Canlıda ilk deneme (müşteride)

1. Önce **yedek**.
2. Tek üründen, küçük miktarla başla.
3. Yazdıktan sonra Vega'yı aç: **Üretim Giriş Fişi** ekranında bütün
   satırların göründüğünü, **Üretim Çıkış Fişi**'nde tüketimin durduğunu,
   **Depo Hareket Fişi** ekranında iki fişin doğru depolarla göründüğünü
   kontrol et.
4. Sonra **geri al** ve stokların döndüğünü doğrula.
5. Ancak ondan sonra günlük kullanıma geç.
