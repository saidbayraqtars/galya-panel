# Üretim fişi — 08.09.2026 bulgusu

Kaynak: müşterinin ekran kaydı (`20260908-1038-52.mp4`, 1:54) + izleyici
çıktısı (`izleme-2026-09-08-134106.md`) + VEGADB'nin kendi verisi
(F0102 / D0002, salt okunur sorgular).

Video ile izleyici kaydı saniye saniye eşleştirildi, sonra ortaya çıkan
desen veritabanındaki 68 gerçek Vega üretim fişiyle doğrulandı.

**Sonuç: panelin üretim fişinde iki ayrı kusur var. İkisi de veriyle
kanıtlandı.**

---

## 1. Video ↔ izleyici kaydı eşlemesi

Video 13:38:56'da (yerel) başlıyor. İzleyici damgaları UTC (+3 fark).

| Video | Saat (UTC) | Ekranda | İzleyicide |
|---:|---|---|---|
| 0:20 | 10:39:1x | İzleyici açıldı, "işlemi yap" bekliyor | — |
| 0:29 | — | Üretim Reçeteleri listesi, "DANA" süzgeci | — |
| 0:43 | 10:39:40 | **Yeni İş Emri** — DANA ANTRIKOT, fiş A0000298 | #1 `TBLUREURETIMARAC ← SELECT … RECETEARAC WHERE EVRAKNO=4516`<br>#2 `TBLUREURETIMPOZ ← SELECT … RECETEPOZ WHERE EVRAKNO=4516`<br>(hedef `EVRAKNO=1410` = üretim başlığının IND'i) |
| 0:46 | — | Üretim Girdileri: HAM DANA ANTRİKOT **25 KG × 950 = 23.750 TL** | — |
| 0:51 | — | Pozisyonlar: 1 BAŞLA/MUTFAK, 2 BİTİR/MERKEZ | — |
| 0:57–1:21 | — | Üretim Çıktıları: **18 + 3 + 3 + 1 = 25** | — |
| 1:33 | 10:40:29 | Pozisyon → **BAŞLA**, "Devam edilsin mi?" → Evet | #3–#8: DepoÇık **Z0000433** (evrakno 1535) 23.750 TL |
| 1:39 | 10:40:39 | Pozisyon → **BİTİR** → Evet | #9–#14: DepoÇık **Z0000434** (evrakno 1536) 23.750 TL<br>#15–#18: ÜreÇık **Z0052865** 23.750 TL<br>#19–#23: ÜreGir **Z0052866** **47.500 TL** |
| 1:44 | — | Üretim Çıkış Fişi Z0052865: HAM DANA ANTRİKOT 25 KG | — |
| 1:46 | — | Üretim Giriş Fişi Z0052866: **4 satır** | — |

İş emri ekranındaki son hâl (video 1:47):

| Çıktı türü | Stok | Miktar | Birim maliyet | Toplam | Maliyet oranı |
|---|---|---:|---:|---:|---:|
| Ana Mamul | DANA ANTRIKOT | 18 | 1.319,444436 | 23.749,999848 | 100,00 |
| Yan Mamul | DANA KUŞBAŞI | 3 | 0,00 | 0,00 | 0,00 |
| Yan Mamul | DANA KIYMA | 3 | 7.916,666616 | 23.749,999848 | 100,00 |
| Yan Mamul | FİRE | 1 | 0,00 | 0,00 | 0,00 |
| | | **25** | | **47.500,00** | **200** |

### İzleyicinin kaçırdıkları

İzleyici 1013 olay okudu, 23 yazma ifadesi gösterdi. `TBLUREURETIMLIST`,
`TBLUREURETIM`, `TBLUREURETIMCIKTI`, `TBLSTOKHAREKETLERI`,
`TBLDEPOENVANTER`, `TBLDEPOHARBASLIK` INSERT'lerinin **hiçbiri kayda
girmedi** — Vega bunları hazırlanmış (prepared) ifadeyle gönderiyor,
`main.js`'teki `YAZAN = /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/` süzgeci
`exec sp_execute …` metnini yakalamıyor.

Yani **izleyici çıktısı tek başına deseni vermez.** Bu bulgunun tamamı
VEGADB okunarak doğrulandı.

`TBLSHAREKET SET DETAY=IND-DETAY` ve `TBLDEPOHARHAREKET SET DETAY=IND-DETAY`
ifadeleri Vega'nın her belge ekranında çalıştırdığı satır sırası düzeltmesi;
peşine düşmeyin.

---

## 2. KUSUR A — 96/97 belgelerinin satırları `TBLSHAREKET`'e yazılmıyor

`BELGE-DESENI.md` "96 ve 97'nin başlık tablosu yoktur" diyor. Doğru; ama
**satır tablosu vardır: `F{firma}D{dönem}TBLSHAREKET`.**

Kanıt (son 5.000 adet 96/97 hareketi):

```
TBLSTOKHAREKETLERI.LN = TBLSHAREKET.IND      4990 / 4990
TBLSHAREKET.EVRAKNO   = hareketin BELGENO'su 4990 / 4990
STOKNO aynı                                  4990 / 4990
```

Aynı sorgu `IZAHAT = 33` için 2000'de 3 tutuyor — yani bağ 96/97'ye özgü,
rastlantı değil.

`TBLSHAREKET.IND` bir **IDENTITY**'dir. Vega önce `TBLSHAREKET` satırını
yazıyor, dönen `IND`'i `TBLSTOKHAREKETLERI.LN` ve
`TBLDEPOENVANTER.HAREKETIND` olarak kullanıyor. `TBLUREBELGE.MAMULSATIRI`
de aynı sayıdır.

Panel (`db/yazma.js` → `uretimFisiYaz`) `TBLSHAREKET`'e **hiç** yazmıyor;
LN'yi `MAX(LN) + 1` ile kendi uyduruyor. İki sonucu var:

1. **Belge Vega'nın Üretim Giriş/Çıkış Fişi ekranında satırsız görünür.**
   Stok hareketi oluşuyor, ama belgenin kendi satırı yok.
2. **IDENTITY ilerlemediği için LN çakışması üretiyor.** Panelin 25.08'de
   yazdığı iki fiş 176423–176432 LN'lerini kullandı; `TBLSHAREKET`'in
   IDENT_CURRENT değeri hâlâ 176422. Vega'nın yazacağı sonraki 10 belge
   satırı **aynı LN'leri** alacak ve `MAMULSATIRI` eşleşmesi bozulacak.

Panelin canlıda bıraktığı iki fişin durumu:

```
BELGENO 55206 (97) LN 176423   SHAREKET YOK
BELGENO 55207 (96) LN 176424   SHAREKET YOK
BELGENO 55208 (97) LN 176425-176431  SHAREKET YOK
BELGENO 55209 (96) LN 176432   SHAREKET YOK
```

Aynı örneklemdeki 20.000 hareketin geri kalanının tamamında `TBLSHAREKET`
satırı var. Eksik olan **yalnızca panelin yazdığı 10 satır**.

### Doğrusu

96 ve 97 belgesinin HER satırı için, `TBLSTOKHAREKETLERI`'nden **önce**:

```sql
INSERT INTO F{f}D{d}TBLSHAREKET
  (TARIH, DETAY, EVRAKNO, FIRMANO, STOKNO, STOKKODU, MALINCINSI, STOKTIPI,
   MIKTAR, BIRIMMIKTAR, BIRIM, BIRIMEX, KDV, FIYATI, AFIYATI, GERCEKTOPLAM,
   DEPO, PARABIRIMI, KUR, GK, ACIKLAMA)
OUTPUT INSERTED.IND
VALUES (@tarih, 0, @belgeNo, 0, @stokNo, @kod, @ad, @stokTipi,
        @miktar, 1, @birim, @birimEx, 0, @fiyat, @fiyat, @tutar,
        @depo, 'TL', 1, @gk, '')
```

Dönen `IND` → `TBLSTOKHAREKETLERI.LN`, `TBLDEPOENVANTER.HAREKETIND`,
(mamul satırı için) `TBLUREBELGE.MAMULSATIRI`.

`GK` alanının kuralı `BELGE-DESENI.md` → "GK alanı" bölümünde.
Geri almada `TBLSHAREKET` satırları da silinmeli.

---

## 3. KUSUR B — Çok çıktılı reçetelerde yan mamuller yazılmıyor

> **09.09.2026 eki — üçüncü kusur.** Panel reçete açarken
> `TBLURERECETECIKTI`'ya ana mamul satırını (TUR 0 / ORAN 100 / RECETENO =
> başlık IND) hiç yazmıyordu. Vega'nın üç kurulumundaki 627 reçetenin
> 627'sinde bu satır var. Kolon denetimi bunu göremiyordu: denetimin kendisi
> çıktı satırlarını elle ekliyor, panelin eksiğini örtüyordu. Düzeltildi
> (`receteCiktiSatiriGuvence`), denetime de kendi vakası eklendi.

Reçetenin çıktıları `F{firma}TBLURERECETECIKTI` tablosunda durur. **Bu
tablo kod tabanının hiçbir yerinde geçmiyor** (`grep RECETECIKTI` = 0 sonuç).
Panel her üretimde tek çıktı satırı yazıyor: mamul, `ORAN = 100`, `TUR = 0`.

Reçete 4516 (DANA ANTRIKOT) gerçekte:

| TUR | Stok | Miktar | ORAN | Anlamı |
|---:|---|---:|---:|---|
| 0 | DANA ANTRIKOT | 1 | 100 | ana mamul |
| 2 | DANA KUŞBAŞI | 1 | 0 | yan mamul |
| 2 | DANA KIYMA | 1 | 100 | yan mamul |
| 2 | FİRE | 1 (ADET) | 0 | fire |

Bileşen tek: HAM DANA ANTRİKOT 1 KG @ 950.

### Vega'nın yazdığı (A0000279, 03.08.2026, başlık IND 1384)

Tüketim: HAM DANA ANTRİKOT **36,82 KG × 950 = 34.979,00 TL**

`TBLUREURETIMCIKTI` — dört satır:

| STOKKODU | MIKTAR | ORAN | TUR | FIYAT | TUTAR | RECETENO |
|---|---:|---:|---:|---:|---:|---|
| DANA ANTRIKOT | 17,24 | 100 | 0 | 2028,9443073 | 34.978,999858 | 1384 (= başlık IND) |
| DANA KUŞBAŞI | 6,42 | 0 | 2 | 0 | 0 | NULL |
| DANA KIYMA | 10,34 | 100 | 2 | 3382,88199787 | 34.978,999858 | NULL |
| FİRE | 2,82 | 0 | 2 | 0 | 0 | NULL |

96 belgesi (`BELGENO 52947`, `Z0044584`) **dört** `TBLSTOKHAREKETLERI` +
**dört** `TBLDEPOENVANTER` satırı; fiyatı sıfır olanlar dahil.
97 belgesi tek satır (tüketim). `MAMULSATIRI` yalnız `TUR = 0` satırının
LN'si (168952).

### Panelin yazdığı (A0000290, 25.08.2026, başlık IND 1401)

```
Tüketim : HAM SOMON 10 KG @ 804,85
Çıktı   : SOMON 28 KG, ORAN 100, TUR 0        ← TEK SATIR
```

SOMON reçetesinde (4499) `FİRE` çıktısı tanımlı; panel onu yazmadı. Fireyi
ayrı bir **zayi çıkış fişine (tip 33, cari hareketi)** yazdı — Vega bunu
hiç yapmıyor, fireyi FİRE stok kartına 96 girişi olarak koyuyor.

### Formüller (video ve 68 fişle doğrulandı)

```
toplamMaliyet = Σ (tüketim miktarı × birim maliyet)
satır.TUTAR   = toplamMaliyet × ORAN / 100
satır.FIYAT   = satır.TUTAR / satır.MIKTAR
```

Doğrulama: 23.750 × 100% / 18 = 1.319,444436 ✔ · 23.750 × 100% / 3 =
7.916,666616 ✔ · 34.979 × 87,5% / 14 = 2.499,99 (A0000289) ✔

**ORAN toplamı 100 olmak zorunda değil.** DANA ANTRIKOT reçetesinde toplam
200 (hem ana mamul hem DANA KIYMA %100) — bu yüzden video'daki üretimde
23.750 TL hammadde 47.500 TL mamule dönüştü. Vega bunu uyarmadan yapıyor.
Panel de aynısını yapmalı (aksi hâlde panelin sayısı Vega'nınkinden farklı
çıkar), ama ekranda **"maliyet oranları toplamı %200"** uyarısı gösterilmeli.

### Etkilenen reçeteler (F0102, 433 reçetenin 7'si)

| Reçete | Mamul | Çıktı satırı | ORAN toplamı |
|---:|---|---:|---:|
| 4516 | DANA ANTRIKOT | 4 | 200 |
| 4496 | DANA BONFILE | 2 | 100 |
| 4497 | TAVUK BONFILE | 2 | 9,12 |
| 4499 | SOMON | 2 | 100 |
| 4506 | DANA CİĞER | 2 | 100 |
| 4515 | LEVREK | 2 | 100 |
| 4534 | TAVUK PIRZOLA | 2 | 100 |

Kalan 479 reçetenin tek çıktısı var; onlarda panelin davranışı zaten doğru.

### Yan etki: `db/maliyet.js`

Maliyet motoru da `TBLURERECETECIKTI`'yi bilmiyor; bileşen maliyetinin
tamamını mamule yazıyor. Ana mamulün `ORAN`'ı 100'den küçük olan reçetede
(4497 TAVUK BONFILE, ORAN 9,07) mamul maliyeti **olduğundan yüksek**
çıkıyor. Vega'nın kendi fişinde aynı mamul %87,5 ile maliyetleniyor.

---

## 4. Yapılanlar

Hepsi 08.09.2026'da uygulandı ve `GALYA_TEST` üzerinde sınandı
(146 yazma sınaması, sıfır hata; önceki sayı 123'tü).

| # | Ne | Nerede |
|---|---|---|
| 1 | 96/97 satırları önce `TBLSHAREKET`'e yazılıyor, dönen IDENTITY `LN` oluyor | `db/yazma.js` → `uretimStokHareketiYaz()` |
| 2 | Reçetenin çıktıları okunuyor | `db/yazma.js` → `uretimHazirligi()`, `db/uretim.js` → `receteCiktilari()` |
| 3 | Her çıktı için `TBLUREURETIMCIKTI` + 96 hareketi + envanter satırı | `db/yazma.js` → `uretimFisiYaz()` |
| 4 | Maliyet `ORAN`'a göre paylaşılıyor | `db/yazma.js` → `ciktiSatirlariniCoz()` |
| 5 | Geri almada `TBLSHAREKET` satırları da siliniyor | `db/yazma.js` → `uretimFisiGeriAl()` |
| 6 | Çok çıktılı kipte zayi fişi kesilmiyor, fire bir çıktıdır | `db/uretim.js` → `fireliUret()`, `main.js` |
| 7 | Ekranda çıktı satırları ve oran toplamı uyarısı | `ui/app.js` → `uretimFireliBolumu()` |
| 8 | Maliyet motoru ana mamulün payını uyguluyor | `db/maliyet.js` |
| 9 | Yeni uç `uretim:receteCiktilari` | `main.js`, `preload.js`, `db/yetki.js` |
| 10 | Desen belgeye işlendi | `BELGE-DESENI.md`, `DEVIR-NOTU.md` |
| 11 | Sınama: çok çıktılı üretim + `TBLSHAREKET` denetimleri | `kurulum/test-yazma.js` |

### Doğrulama

Okuma tarafı gerçek VEGADB'de (F0102/D0002) çalıştırıldı; panel Vega'nın
sayılarını birebir üretiyor:

```
DANA ANTRIKOT KG  18 × 1319,444444 = 23.750,00   (Vega: 1319,444436)
DANA KUŞBAŞI       3 ×       0,000 =      0,00
DANA KIYMA         3 × 7916,666667 = 23.750,00   (Vega: 7916,666616)
FİRE               1 ×       0,000 =      0,00
TOPLAM            25                = 47.500,00
```

Maliyet motoru reçetenin kendi sakladığı çıktı fiyatıyla doğrulandı:

```
4497 TAVUK BONFILE  4845 × %9,07211558 / 190   = 2,31338947   ✔
4516 DANA ANTRIKOT   950 × %100        / 1     = 950          ✔
```

(4515 LEVREK'te fark var — reçetenin sakladığı fiyat kaydedildiği günün
alış fiyatına, motorunki BUGÜNÜN son alış fiyatına dayanıyor. Tasarım
gereği; kusur değil.)

### Karar

Müşteriyle netleşti:

- **Fire:** reçeteli çok çıktılı üretimde Vega gibi FİRE stok kartına 96
  girişi olarak yazılıyor. Zayi fişi kesilmiyor, cari borcu oluşmuyor.
  Reçetesiz manuel üretimde eski akış (önce zayi fişi) duruyor.
- **Miktarlar:** kullanıcı her çıktı için elle yazıyor (Vega'nın iş emri
  ekranındaki gibi). Reçetedeki miktarlar oran kabul edilip ölçeklenmiyor —
  gerçek üretim dağılımını yansıtmıyorlar.

### Kalan tek iş

Canlıda denenmedi. `DEVIR-NOTU.md` → "11. Sıradaki işler" 0. madde: tek
üründen başlanacak, Vega'nın Üretim Giriş Fişi ekranında dört satırın da
göründüğü kontrol edilecek, sonra geri alınacak.

25.08'de canlıda bırakılan iki fişin (`A0000290`, `A0000291`) 10 satırı
`TBLSHAREKET`'te yok; müşteriye geçmeden temizlenmeli.
