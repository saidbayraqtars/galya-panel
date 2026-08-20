# Devir notu — Galya Panel

Bu dosya, projeyi devralan kişinin (veya yeni bir sohbetin) sıfırdan bağlam
kurmadan devam edebilmesi için yazıldı. Kod okunarak veya git geçmişine
bakılarak öğrenilemeyecek şeyleri anlatır.

Son güncelleme: 19.08.2026 · Sürüm 1.5.0

---

## 1. İş neyle ilgili

Müşteri (Galya), **VegaWin A5** (ERP) ve **Vega Şefim** (POS) kullanıyor.
İki program arasında ve Vega'nın kendi arayüzünde günlük olarak tekrarlanan
işleri tek ekranda toplayan bir masaüstü uygulaması istiyorlar.

Kaynak belge: `C:\Users\saidb\Desktop\VegaWin Entegrasyon Teknik Görüşme Notu.docx`

### Müşterinin koyduğu tek katı kural

> "Yapılan programın **aşırı basit** ve **istenilen dışında** olmaması,
> en gerizekalı olanın bile kullanacağı şekilde olması gerek."

Bu bir üslup tercihi değil, kabul şartı. Ekrana özellik eklemeden önce
belgede isteniyor mu diye bakın. "Faydalı olur" diye eklenen şey burada
kusur sayılıyor.

### Kullanıcının verdiği mimari kararlar

| Konu | Karar |
|---|---|
| Kurulum yeri | Ağdaki birkaç PC |
| Yazma yetkisi | Önce sadece okusun; yazmayı kullanıcı kendi açacak |
| Firma seçimi | Dört firma da seçilebilsin (tek firmaya sabitlenmesin) |
| Oto güncelleme kaynağı | Ayrı, **açık** release deposu |

---

## 2. Depolar

| Depo | Ne için |
|---|---|
| `saidbayraqtars/galya-panel` (özel) | Kaynak kod |
| `saidbayraqtars/galya-panel-releases` (açık) | Yalnızca kurulum dosyaları |

Release deposunun **açık** olması zorunlu. electron-updater kurulu
uygulamanın içinden çalışır ve elinde GitHub jetonu yoktur; özel depodaki
`latest.yml` dosyasını göremez, güncelleme sessizce hiç çalışmaz.

İki tuzak daha:

- electron-builder varsayılan olarak **taslak** (draft) release oluşturur.
  Taslağı electron-updater göremez. Yayın ayarında `"releaseType": "release"`
  bunun için var.
- Bomboş bir depoya release oluşturulamaz (`422 Repository is empty`).
  Önce bir README göndermek gerekir.

---

## 3. Klasör düzeni

```
rapor programı (galya)/
  main.js            Electron ana süreç, tüm IPC uçları
  preload.js         contextBridge, kanal beyaz listesi
  ui/                Arayüz (index.html, app.js, app.css) — çerçeve yok, düz JS
  db/
    sql.js           Bağlantı havuzu, sorgu, işlem (transaction) yardımcısı
    ayar.js          ayarlar.json okuma/yazma
    firma.js         Firma ve dönem keşfi (dinamik, sabit liste yok)
    vega.js          VEGADB okumaları
    sefim.js         Şefim okumaları
    ozet.js          Ana ekran özeti
    yazma.js         VEGADB'ye yazan HER ŞEY (kilitli)
    panel.js         GALYA_PANEL şeması (kendi veritabanımız)
    tutanak.js       Ürün değişim tutanakları
    sayim.js         Ara ve tam sayım, kapsam süzgeci, onay akışı
    oturum.js        Kullanıcılar, PIN'le giriş, roller ve yetkiler
    zayi.js          Zayi / personel çıkışı taslağı (panel veritabanında)
    maliyet.js       Maliyet hesabı (son alış fiyatı + reçete)
    fatura.js        Alış faturası taslağı (panel veritabanında)
    uretim.js        Üretim: zayiatlı, manuel, otomatik
    rapor.js         Rapor üretimi
    disaaktar.js     Excel / PDF dışa aktarma
    guncelleme.js    electron-updater sarmalayıcı
    vegaprogram.js   VegaWinA5 exe'sini bulma / başlatma
  izleyici/          Ayrı, bağımsız Electron uygulaması (aşağıda)
  kurulum/
    BELGE-DESENI.md          Vega'ya yazma deseni — yazmaya dokunmadan önce okuyun
    DEVIR-NOTU.md            bu dosya
    sql-kullanici-olustur.sql
    sql-yetki-tazele.sql     restore sonrası okuma yetkisini geri verir
    sql-yazma-yetkisi-ver.sql  VEGADB'ye yazma yetkisi (ikinci kilit)
    test-sorgular.js         98 okuma sınaması
    test-yazma.js           106 yazma sınaması (--kur ile kurulur, GALYA_TEST üzerinde)
    test-yetki.js            41 kullanıcı / kapsam / onay sınaması
    test-arayuz.js           29 arayüz duman sınaması (Electron ile)
    izleyici-kur.sql / izleyici-kapat.sql / izleyici-oku.js   (eski, elle sürüm)
```

Kod ve değişken adları Türkçe. Sürdürün — yarısı Türkçe yarısı İngilizce
bir kod tabanı okumak zorlaşır.

---

## 4. Veritabanı bilgisi (en pahalı öğrenilen kısım)

### Tablo adlandırma

```
Kart tablosu   : F{firma}TBL{ad}           → F0103TBLSTOKLAR
Dönemli tablo  : F{firma}D{dönem}TBL{ad}   → F0103D0015TBLSTOKHAREKETLERI
```

Firma ve dönem listesi **çalışma anında** `sys.tables` taranarak bulunuyor;
hiçbir yere sabit yazılmadı. Veritabanı değişince panel kendini uyduruyor.

### Dört sert kural

1. **`DELETED = 0` yazmayın.** Alan satırların neredeyse tamamında `NULL`.
   `ISNULL(S.DELETED, 0) = 0` kullanın. Bu yüzden bir ara cari bakiye ve
   THIRD adayları sıfır satır döndü.

2. **`TBLDEPOENVANTER.ENVANTER` fark (delta) tutar, bakiye değil.**
   Güncel stok = deltaların **toplamı**. `BELGETIPI = 67` hariç tutulur.

3. **`TBLSTOKHAREKETLERI.BELGENO` sayıdır ve başlık IND'ini tutar.**
   Belge numarası metni (`A0000001`) `EVRAKNO` alanındadır. İsimler sezgiye
   ters.

4. **`TBLURERECETE.EVRAKNO`, reçete BAŞLIĞININ IND'ini tutar** — mamulün
   stok IND'ini değil. Bu varsayımla yazılan satır hatasız ekleniyor ama
   hiçbir yerde görünmüyor. Bir kez bu hataya düşüldü.

Belge yazma deseninin tamamı `kurulum/BELGE-DESENI.md` içinde. Yazma koduna
dokunmadan önce o dosya okunmalı.

### Belge tipleri

| Tip | Anlamı |
|---|---|
| 32 / 33 | Stok giriş / çıkış (elle girilen, `A` önekli) |
| 103 / 104 | Stok giriş / çıkış (Vega'nın otomatiği, `Z` önekli) |
| 93 / 94 | Sayım girişi / çıkışı |
| 96 / 97 | Üretim çıktısı / tüketimi |

Panel yalnızca `A` serisini kullanır; böylece Vega'nın kendi numaralarıyla
çakışmaz.

---

## 5. Yazma kilidi

`db/yazma.js` içindeki her fonksiyon `kilitKontrol()` çağırır. `ayarlar.json`
içinde `vegayaYazmaAktif: false` iken `{kod: 'YAZMA_KAPALI'}` fırlatır ve
VEGADB'ye tek satır gitmez.

> **17.08.2026:** Bayrağın varsayılanı **açık** yapıldı. Sebep: bütün
> özellikler yazma açıkken denenecek, canlı kurulum ancak o denemeden sonra
> dağıtılacak. İkinci emniyet SQL tarafında duruyor — `galya_panel`
> kullanıcısı VEGADB üzerinde salt okunur; yetki verilmeden bayrak açık olsa
> da yazma başarısız olur. Müşteri kurulumuna geçerken bu varsayılanın
> istenip istenmediği yeniden değerlendirilmeli.

Yazan işler: THIRD özel kod 11, gider/hizmet stok sıfırlama, reçete
oluştur/güncelle/sil, tutanak fişi, alış faturası, üretim fişi,
maliyetlendirme, sayım fişi, **zayi fişi** ve **stok kartını pasife alma**.
Her biri geri alınabilir. Her yazma `GALYA_PANEL.dbo.Islem` tablosuna
kullanıcı + bilgisayar + satır kimlikleriyle loglanır.

> Günlükteki "kullanıcı", giriş yapılmışsa **panel kullanıcısının adı**,
> yapılmamışsa Windows oturum adıdır (`main.js` → `kayitEt`). Windows adı
> giriş yapılmışken de `windows` alanında duruyor.

`kurulum/sql-kullanici-olustur.sql` dosyasındaki `galya_panel` kullanıcısı
VEGADB ve sefim üzerinde **salt okunur**; yalnızca GALYA_PANEL'de `db_owner`.
Yani yazma açılsa bile SQL tarafında ayrıca yetki verilmesi gerekir.

> Şifre bu dosyada yer tutucudur (`BURAYA-GUCLU-BIR-SIFRE-YAZIN`). Bir kez
> gerçek şifre depoya girdi; şifre değiştirildi ve dosya yer tutucuya
> çevrildi. Gerçek şifre yalnızca `.gitignore`'daki `ayarlar.json` içinde
> durur. Depoya bir daha şifre yazmayın.

---

## 5b. Kullanıcılar, yetki ve körleme sayım (19.08.2026'da genişletildi)

Müşterinin isteği iki aşamada geldi:

1. **18.08.2026** — sayımı yapan çalışan Vega'daki teorik miktarı görmesin;
   yetkili kişi PIN girince görsün. (Tek yönetici PIN'i.)
2. **19.08.2026** — "yönetici paneli ve alt kullanıcılar sistemi getirmeliyiz,
   kullanıcıya barı sayma yetkisi verince sadece barı sayabilmeli."

İkincisi birincinin yerine geçti; tek PIN yerine **kullanıcı listesi** var.

### Giriş: yalnızca PIN

Kullanıcı listeden isim SEÇMEZ. PIN'ini yazar, program PIN'in kime ait
olduğunu bulur. Depoda tabletle çalışan için en hızlı yol bu; müşterinin
kararı da böyleydi.

Zorunlu sonucu: **PIN'ler benzersiz olmak zorunda.** Aynı PIN iki kişide
olsaydı hangisinin girdiği belirsizleşirdi. `oturum.kullaniciKaydet()` yeni
PIN'i mevcutların hepsiyle karşılaştırıp çakışmayı reddediyor.

Her kullanıcının kendi tuzu olduğu için giriş, PIN'i bütün kullanıcılarla
tek tek deniyor. Eşleşme bulunsa bile döngü kırılmıyor — geçen süre PIN'in
listenin başında mı sonunda mı olduğunu ele vermesin diye.

### Roller ve yetkiler

| Rol | Ne yapabilir |
|---|---|
| `yonetici` | Her şey: onay, kullanıcı yönetimi, ayarlar, pasife alma |
| `kullanici` | Yalnızca işaretlenen yetkiler, sayımda yalnızca kendi kapsamı |

Yetkiler `GALYA_PANEL.dbo.Kullanici.Yetkiler` alanında **tek bir JSON**
olarak duruyor:

```json
{ "sayim": true, "tamSayim": false, "zayi": true, "uretim": false,
  "stok": false, "siniflar": ["BAR"] }
```

Ayrı bir yetki tablosu açılmadı; bu boyuttaki bir küme için hem kodu hem
ekranı gereksiz büyütürdü.

### Sayım kapsamı — "barı sayma yetkisi"

`siniflar` dizisi stok kartındaki **`KOD2` (Sınıf)** alanına bakıyor.
F0102'de gerçek değerler: `MUTFAK` (497 kart), `BAR` (405), `GİDER` (15) ve
Şefim'den sızmış otuz küsur adisyon notu.

Depo yerine sınıf seçildi çünkü müşteri isteği aynı cümlede "bar mutfak
**sınıfı**" diyordu. Vega'da `BAR` (101) ve `MUTFAK` (100) diye **depo** da
var; ikisi karıştırılmamalı.

Kapsam **iki yerde** uygulanıyor:

- `sayim:ekran` listeyi süzüyor — kullanıcı kapsamı dışındaki ürünü hiç
  görmüyor.
- `sayim.sayimKaydet()` kaydetme anında listeyi yeniden okuyup gelen her
  satırın kapsamda olduğunu doğruluyor; değilse sayımın tamamını reddediyor.

İkincisi şart: kapsam arayüzden değil **oturumdan** okunuyor
(`oturum.kapsamAl()`), yani DevTools'tan istek kurcalansa bile bar yetkisi
olan kişi mutfağı sayamıyor.

### Onay akışı — sayım artık doğrudan Vega'ya gitmiyor

18.08'de sayım kaydedilir kaydedilmez fiş kesiliyordu. Müşteri bunu
değiştirdi: "sayım direkt Vega'ya aktarılmamalı, önce yönetici onaylayınca
aktarılabilmeli."

```
sayim:kaydet   → AraSayim.Durum = 'bekliyor'   (Vega'ya hiçbir şey yazılmaz)
sayim:onayla   → yazma.sayimFisiYaz()          (93/94 fiş çifti kesilir)
sayim:reddet   → Durum = 'reddedildi'          (sebep saklanır)
```

`sayim:onayla` **yönetici kanalı** ve sayımın Vega'ya işlendiği tek yer.
Fark, fişin kesildiği andaki güncel stoğa göre yeniden hesaplanıyor —
sayım ile onay arasında Şefim satış işlemeye devam ettiği için.

Ana ekranda "Onay bekleyen sayım" kutusu var; oradan onay ekranına gidiliyor.

### Ara sayım / tam sayım

| Tür | Liste |
|---|---|
| `ara` | `SayimListesi` tablosuna konmuş ürünler (günlük "şu iki kalemi say") |
| `tam` | Kapsamdaki BÜTÜN stok kartları, pasifler hariç (dönem sonu envanteri) |

**Miktar yazılmayan satır ikisinde de sayıma girmez.** Tam sayımda da boş
bırakılan ürünün stoğu sıfırlanmaz. Kullanıcının kararı buydu: tam sayım
listeyi genişletir, davranışı değiştirmez. Gerçek envanter sayımı isteniyorsa
bu ayrı bir karar — sayılmayan ürünün stoğunu silmek geri dönüşü zor bir iş.

Tam sayım ayrı bir yetki (`tamSayim`); ara sayım yetkisi olan herkes tam
sayım yapamıyor.

### Körleme sayım (18.08'den beri aynı)

`sayim:ekran` kanalı, yönetici değilse `teorik` ve `birimMaliyet` alanlarını
nesneden **çıkarır** — CSS ile gizlemez, göndermez. Bunun zorunlu sonucu:
`sayim.sayimKaydet` teorik miktarı arayüzden almıyor, kaydetme anında
Vega'dan yeniden okuyor. Yan faydası, arayüz kurcalansa bile uydurma fark
yazılamaması.

`sayim:gecmis`, `sayim:detay` ve `sayim:bekleyenler` yönetici ister. Açık
bırakılsaydı sayan kişi rastgele bir miktar kaydedip farkı okur ve teorik
miktarı geri hesaplardı. Aynı sebeple `sayim:kaydet` yanıtındaki `artan` /
`azalan` / `farkliSatir` / `farkTutari` alanları yönetici değilse yanıttan
çıkarılır.

### Süzgeç nerede

`main.js` içinde üç katman var:

1. `YONETICI_KANALLARI` — yalnızca yönetici çağırabilir (onay, kullanıcı
   yönetimi, `ayar:yaz`, `stok:pasifYap`, sayım geçmişi).
2. `YETKI_KANALLARI` — kanal → gereken yetki anahtarı eşlemesi. Yönetici
   hepsini geçer.
3. Yanıt süzme — `sayim:ekran` ve `sayim:kaydet` engellenmez, **yanıtları
   role göre süzülür**.

Üçü de `kayitEt()` içinde, her IPC çağrısında. Arayüzdeki `yetkiVar()`
yalnızca düğmeyi çizip çizmeyeceğini belirler; DevTools açılsa bile yasak
kanal cevap vermez.

### Hiç kullanıcı yoksa kilit yok

Kullanıcı tablosu boşsa (ya da hepsi pasifse) program **bugüne kadar nasıl
çalışıyorsa öyle** çalışır: giriş sorulmaz, herkes yöneticidir, sağ üstteki
düğme hiç görünmez. Güncelleme kimseyi şaşırtmasın diye böyle.

İlk yönetici Ayarlar ekranından açılıyor; sonrası Kullanıcılar ekranından.
Eski tek PIN'i olan kurulumlar için `panel.kur()` içinde bir kereye mahsus
geçiş var: `Guvenlik` tablosundaki PIN, "Yönetici" adlı kullanıcıya aynı
özetle taşınıyor. Kullanan kişi güncellemeden sonra da eski PIN'iyle giriyor.

Son yönetici silinemiyor — silinseydi kimse onay veremez, kullanıcı yönetimi
de açılmazdı.

### 18.08'deki "bilinen boşluk" kapandı (kısmen)

O gün şu yazılmıştı: *"Stok ekranı envanter miktarını herkese gösteriyor.
Sayım ekranında gizli olan sayı, Stok ekranındaki süzgeçte aynen duruyor."*

Artık `stok:kontrol`, `stok:durum`, `stok:ara`, `stok:hareket` ve cari uçları
`stok` yetkisine bağlı. Bu yetki verilmeyen sayımcı stok ekranını açamıyor.
Ama **yetki verilirse miktar yine görünür** — o ekrandaki sayı süzülmüyor.
Sayımcıya stok yetkisi vermeyin.

### Bunun sınırı (değişmedi)

PIN **ekranı** kilitler, **veritabanını** kilitlemez. `ayarlar.json`
(`%APPDATA%\Galya Panel\`) içinde SQL şifresi düz metindir. Bilgisayara
erişimi olan çalışan o dosyayı Not Defteri'yle açıp SSMS veya Excel'den
VEGADB'yi okuyabilir. Bu katman kazara görmeyi ve merakı keser, niyetli
birini durdurmaz.

Gerçek sınır isteniyorsa yapılacak iş ayrıdır: ikinci bir SQL girişi
(`galya_sayimci`) açmak, VEGADB'de `db_datareader` vermemek, sayım için
gereken birkaç view/procedure üzerinde yalnızca `EXECUTE` tanımlamak ve
yönetici şifresini ayar dosyasına hiç yazmamak (girişte elle alınır).
`db/sql.js` iki havuz tutacak şekilde değişir. Müşteri karar vermeden
başlamayın.

---

## 6. Belgedeki maddeler — durum

| Madde | Durum |
|---|---|
| THIRD (özel kod 11) okuma + ekleme | Çalışıyor |
| Sayım (panelden say, farkı Vega'ya yaz) | Çalışıyor — 93/94 fiş çifti |
| Reçete okuma / oluşturma / güncelleme | Çalışıyor |
| Tutanak (ürün değişimi) + log | Çalışıyor |
| Stok kontrol (teorik ↔ fiziki) | Çalışıyor |
| Kritik stok raporu | Çalışıyor |
| Gider/hizmet stok sıfırlama | Çalışıyor |
| Excel / PDF dışa aktarma | Çalışıyor |
| Maliyetlendirme | Çalışıyor — son alış fiyatı, `TBLSTOKLAR.MALIYET`'e yazıyor |
| Üretim fişi ("sıfıra kadar üret") | Çalışıyor — tam desen (38+38+97+96) |
| Alış faturası girişi | Çalışıyor — taslak, sonra tek onayla Vega'ya |
| Tutanak belgesi (imzalı çıktı) | Çalışıyor — PDF ve yazıcı |
| Sınıflandırma süzgeçleri (10 kod alanı) | Çalışıyor — çoklu seçim + "hariç tut" |
| Sayım fişini Vega'ya yazma | Çalışıyor — canlıda denendi ve geri alındı |
| Zayi / personel çıkışı | Çalışıyor — 33 fiş + cari borç, canlıda DENENMEDİ |
| Zayiatlı üretim | Çalışıyor — zayi + üretim tek işlem, canlıda DENENMEDİ |
| Manuel / otomatik üretim | Çalışıyor |
| Kullanıcılar ve yetkiler | Çalışıyor — PIN'le giriş, sınıf kapsamı |
| Sayım onay akışı | Çalışıyor — onaysız Vega'ya yazılmıyor |
| Tam sayım | Çalışıyor — kapsamdaki bütün kartlar |
| Stok kartını pasife alma | Çalışıyor — `KOD8 = PASİF` |

Belgedeki maddelerin tamamı bitti. Panelin yazdığı her belge tipi gerçek
Vega fişlerinden çıkarıldı, `GALYA_TEST` üzerinde sınandı ve canlı firmada
tek örnekle doğrulanıp geri alındı — zayi ve zayiatlı üretim hariç, onlar
henüz yalnızca `GALYA_TEST` üzerinde denendi (bkz. 11. Sıradaki işler).

### 19.08.2026'da eklenenler

Müşterinin aynı gün ilettiği yedi istek karşılandı:

- **Zayi / personel çıkışı** (`db/zayi.js`, `yazma.zayiFisiYaz`). Bozulan mal
  ile çalışanın elinde kalan mal aynı belgeyle düşülüyor: stok çıkış fişi
  (33) + seçilen carinin borç hareketi. Aradaki tek fark cari — gerçek zayide
  `ZAYİ` kartı, personelde kalanda kişinin kendi kartı. Fatura gibi önce
  taslak durur, `Vega'ya yaz` ayrı bir onaydır. Desen 37 gerçek ZAYİ
  fişinden çıkarıldı; ayrıntısı `BELGE-DESENI.md` → "Zayi / personel çıkışı".
- **Zayiatlı üretim** (`uretim.zayiatliUret`). İzleyici kaydındaki
  (`galya döküman/zaiyatlı manuel üretim .md`) elle yapılan işin tamamı tek
  düğmede: zayi fişi kesilir, kalan yeniden okunur, eksik kadar üretim
  yapılır. Üretim yazılamazsa zayi fişi geri alınır — stoktan düşmüş ama
  üretilmemiş ürün bırakılmaz.
- **Manuel üretim.** Reçetesi olan herhangi bir ürün, istenen miktarda.
  Eskiden yalnızca "THIRD işaretli + stoğu eksi" ürünler üretilebiliyordu.
  Üretim ekranı üç şeride ayrıldı: zayiatlı / manuel / otomatik.
- **Kullanıcılar ve yetkiler** (`db/oturum.js`, "Kullanıcılar" ekranı).
  Ayrıntısı 5b bölümünde.
- **Sayım onayı.** Sayım artık kaydedilir kaydedilmez Vega'ya gitmiyor;
  yönetici onaylayınca fiş kesiliyor. Ana ekranda "Onay bekleyen sayım"
  kutusu var.
- **Tam sayım.** Ara sayımın yanına kapsamdaki bütün kartları listeleyen
  ikinci tür eklendi. Miktar yazılmayan satır ikisinde de sayıma girmez.
- **Sınıf süzgeci çoklu seçim ve "hariç tut" kipi kazandı.** Müşterinin
  istediği "bar-mutfak dışındakileri getirme" işi bununla çıkıyor: Sınıf
  alanında BAR ve MUTFAK işaretlenir, "hariç" kutusu boş bırakılırsa
  yalnızca onlar gelir. `KOD2`'de bu ikisinin yanında Şefim'den sızmış otuz
  küsur adisyon notu duruyor ve listeyi kirletiyordu.
- **Stok kartını pasife alma.** Firma kullanmadığı 373 kartı zaten
  `KOD8 = PASİF` diye işaretlemiş; panel aynı alanı kullanıyor. Pasif
  kartlar stok listelerinde ve sayım föylerinde görünmüyor.
- **Üretim fişine `TBLUREURETIMARAC` eklendi.** İzleyici kaydı Vega'nın
  üretim araçlarını reçeteden kopyaladığını gösterdi; panel de kopyalıyor.

> **KDV tuzağı.** Zayi fişi yazılırken `TBLSTOKLAR.KDV` diye bir alan
> varsayıldı; öyle bir alan yok. Kartta `KDVGRUBU` var, oran
> `TBLKDVGRUPLARI` tablosunda (1 → %20, 100 → %10, 101 → %1, 102 → %0).

### 18.08.2026'da eklenenler
- **Sayım artık panelden yapılıyor.** Kullanıcı sayılan miktarları yazıp
  kaydediyor; program farkı kendisi hesaplayıp Vega'ya sayım fişini kesiyor.
  Vega'nın sayım programına yönlendiren düğmeler kaldırıldı. Fark, fişin
  kesildiği andaki güncel stoğa göre yeniden hesaplanır — sayım kaydedildikten
  sonra Şefim satış işlemeye devam ettiği için ekrandaki eski miktarla yazmak
  stoğu yanlış yere oturturdu. Yanlışlık olursa geçmiş listesinden geri
  alınıyor. Desen `kurulum/BELGE-DESENI.md` → "Sayım fişi".
- **Sınıflandırma süzgeçleri düzeltildi.** Önceki hâli beş kod alanını
  kapsıyordu ve seçenekleri kartlardaki değerlerden üretiyordu. Stok değer
  raporu yeniden çözümlenince iki eksik çıktı: firma `KOD6` / `KOD7` /
  `KOD9`'u da (Sezon/Yıl, Marka, Renk) ve raporda hiç görünmeyen `KOD8`
  (PASİF) ile `KOD10`'u (SAYIMURETIM) kullanıyormuş. Seçenekler artık
  firmanın kendi tanım tablosundan (`TBLSTOKKODTAN`) geliyor.

### 17.08.2026'da eklenenler

- **Alış faturası.** Kullanıcı faturayı panelde hazırlıyor, kaydediyor,
  düzeltebiliyor; Vega'ya yazma ayrı bir onayla oluyor. Yazınca stok
  girişi, depo envanteri ve **cari borç** birlikte oluşuyor. Geri alınabilir.
- **Maliyetlendirme.** İzleyici kaydı Vega'nın maliyetlendirme sırasında
  veritabanına hiçbir şey yazmadığını gösterdi (6.468 okuma, 0 yazma);
  müşteri de sonucun `TBLSTOKLAR`'daki maliyet alanına yazıldığını doğruladı.
  Panel maliyeti kendisi hesaplayıp o alana yazıyor, eski değerleri saklıyor.
- **Üretim fişi.** `BELGE-DESENI.md`'deki tam desen kodlandı. 96/97 belge
  numarası kilitli okunuyor, yazımdan önce çakışma kontrolü yapılıyor,
  çakışırsa işlem geri alınıp yeniden deneniyor.
- **Tutanak artık anında Vega'ya yazılıyor.** Kayıt oluşur oluşmaz çıkış
  (−) ve giriş (+) fişi çifti yazılıyor; yazma kapalıysa eskisi gibi
  yalnızca panelde kalıyor.
- **GK alanı çözüldü** (bkz. `BELGE-DESENI.md`), tutanak fişi dahil bütün
  hareket satırlarında dolduruluyor.
- **Bugünkü satış ekranı kaldırıldı.** Şefim satışları Vega'ya
  aktarılmadığı sürece o ekran gerçeği göstermiyordu; aktarım açığı zaten
  "Satış aktarımı" ekranında duruyor.
- **Stok ekranı:** kalan 0 / 1–5 / 6–20 süzgeçleri, serbest aralık, ad-kod
  araması, hareketsiz kartlar dahil komple liste, ekrandaki listeden tek
  tuşla sayım listesi oluşturma.
- **Cari ekranı:** arama, borçlu/alacaklı süzgeci, en az bakiye eşiği,
  bakiyesi sıfır olanları da gösterme.
- **Reçete ağacı:** her bileşenin maliyeti, mamulün alttan yukarı hesaplanan
  toplam maliyeti ve ağacın içinden satır düzenleme/silme/ekleme.
- **Sınıflandırma süzgeçleri.** Müşterinin verdiği stok değer raporu
  (`galya döküman/stokdeğer17.08.2026.xls`) çözümlendi; oradaki sütunların
  Vega karşılığı şu:

  | Rapordaki sütun | Vega alanı | Tanımlı değer | Kart |
  |---|---|---|---|
  | Tür | `KOD1` | 51 | 1390 |
  | Sınıf | `KOD2` | 12 | 978 |
  | 3-ÖK | `KOD3` | 2 (İÇECEK) | 68 |
  | 4-ÖK | `KOD4` | 3 (ALKOL, FİRE) | 181 |
  | 5-ÖK | `KOD5` | 3 (VAR, FİRE) | 597 |
  | Sezon/Yıl | `KOD6` | 15 (sayı kodları) | 317 |
  | Marka | `KOD7` | 11 (sayı kodları) | 156 |
  | — raporda yok | `KOD8` | PASİF | 373 |
  | Renk | `KOD9` | 6 (sayı kodları) | 17 |
  | — raporda yok | `KOD10` | SAYIMURETIM | 47 |

  Eşleştirme raporla kart kart karşılaştırılarak doğrulandı: **486/486 satır
  birebir tuttu**. Raporda `3-ÖK` sütunu hiç basılmıyor, buna karşılık
  `Marka` / `Renk` / `Sezon/Yıl` sütunları var — bunlar Vega'nın stok
  kartındaki `KOD7` / `KOD9` / `KOD6` alanları ve firma bunlara ad değil
  sayı kodu yazmış. `KOD8` ve `KOD10` raporda hiç görünmüyor ama firma
  ikisini de kullanıyor.

  Açılır kutuların içeriği firmanın kendi tanım tablosundan geliyor:
  `F{firma}TBLSTOKKODTAN`, `CATEGORY` sütunu kaçıncı KOD alanı olduğunu
  söylüyor. Vega'nın kendi açılır listeleri de buradan beslendiği için
  kullanıcı Vega'da ne görüyorsa panelde de onu görüyor.

  > `KOD1`'de tanım tablosunda olmayan ~250 değer var: `ULAŞ BEY`,
  > `MÜZİKÇİLER`, `S-15`, `SOS OLMASIN`… Bunlar Şefim'den sızmış adisyon
  > notları. Silinmedi (kartlarda duruyor) ama açılır listede ayrı bir
  > "Kartlarda geçen diğer" grubunda, en altta duruyor.

  Dışa aktarmada da aynı sütunlar var, böylece panelin çıktısı Vega'nın
  stok değer raporuyla karşılaştırılabiliyor. "Bütün stok listesi"
  süzgeci gider/hizmet kartlarını da alır; rapor onları da bastığı için
  ancak böyle birebir örtüşüyor.
- **Tutanak belgesi.** İmza alanlı, A4 tek sayfa resmî çıktı. Tutanak
  listesindeki "Belge" düğmesi PDF kaydeder, "Yazdır" doğrudan yazıcıya
  gönderir. Sayfa düzeni `db/disaaktar.js` → `tutanakBelgeHtml()`.
  Dört imza kutusu var (Düzenleyen, Depo Sorumlusu, Muhasebe, Onaylayan);
  başlıklar `imzalar` parametresiyle değiştirilebiliyor. Belgenin üstünde
  stok kaydının Vega'ya işlenip işlenmediği yazıyor — imzalayan bunu
  bilerek imzalasın.

---

## 7. İzleyici (`izleyici/`)

Ayrı, bağımsız bir Electron uygulaması. VegaWinA5'in veritabanına gerçekte
hangi SQL'i gönderdiğini SQL Server Extended Events ile kaydeder. **Veri
değiştirmez**, yalnızca dinler.

Taşınabilir tek dosya: `dist/GalyaIzleyici.exe` (~77 MB). Kurulum, node,
sqlcmd gerektirmez.

Kullanım: bağlan → izlemeyi başlat (veritabanı seç) → VegaWinA5'te ilgilenilen
işlemi yap → "sadece yazanları kaydet" → **izlemeyi kapat**.
Kayıt masaüstünde `Galya-Izleyici-Kayitlari` klasörüne düşer.

Notlar:

- Extended Events **sysadmin** ister; genelde `sa` ile bağlanılır.
- Her oturum kendi zaman damgalı `.xel` dosyasına yazar. Eski sürüm eski
  kayıtları silmek için `xp_cmdshell` çağırıyordu — müşteri sunucularında
  genelde kapalı ve açtırmak yanlış olurdu; bağımlılık kaldırıldı.
- Kapatılmazsa sunucudaki kayıt dosyası büyümeye devam eder.
- `node izleyici/test-izleyici.js <sunucu> <kullanici> <sifre> [vt]` uçtan uca
  sınar (6 sınama). Yalnızca `SELECT` yapar.

`kurulum/izleyici-*.sql` ve `izleyici-oku.js` bunun elle çalıştırılan eski
sürümüdür. Kalsın; sunucuda exe çalıştırılamayan durumlarda işe yarar.

---

## 8. Sınama

```
node kurulum/test-sorgular.js       #  98 okuma sınaması
node kurulum/test-yazma.js --kur    # test veritabanını hazırla/tamamla
node kurulum/test-yazma.js          # 106 yazma sınaması
node kurulum/test-yetki.js          #  41 kullanıcı / kapsam / onay sınaması
npx electron kurulum/test-arayuz.js #  29 arayüz duman sınaması
node izleyici/test-izleyici.js …    #   6 izleyici sınaması
```

Yazma sınamaları müşteri verisine dokunmaz: yapısı VEGADB'den
`SELECT * INTO … WHERE 1=0` ile kopyalanmış boş bir **`GALYA_TEST`**
veritabanında çalışır. Bu kalıp IDENTITY özelliğini korur, bu yüzden seçildi.
Sınama `GALYA_AYAR_DOSYASI` ortam değişkeniyle geçici bir ayar dosyasına
yönlendirir.

`test-yetki.js` VEGADB'ye hiç yazmaz (stok kartlarını yalnızca okur) ama
panel tablolarını da **`GALYA_TEST` içinde** açar. Sebep: sınama kullanıcı
tablosunu boşaltıyor; canlı `GALYA_PANEL` üzerinde çalışsaydı müşterinin
tanımladığı bütün kullanıcılar silinir ve program bilinmeyen bir PIN'le
kilitlenirdi. Betik canlı panel veritabanına yönelirse kendini durduruyor.

> Bu tuzağa bir kez düşüldü: geliştirme sırasında canlı `GALYA_PANEL`
> içinde iki test kullanıcısı kaldı. Kullanıcı tanımlıyken program giriş
> istediği için, PIN'i bilmeyen biri paneli kullanamaz hâle gelir. Temizlendi;
> `test-yetki.js` artık aynı hatayı yapamıyor.

`test-arayuz.js` gerçek arayüzü görünmez bir pencerede açar, her ekranı
sırayla çizer ve hata çıkıp çıkmadığına bakar; kaydet/yaz düğmelerine
basmaz, yani VEGADB'ye dokunmaz. Tanımsız değişkeni, yanlış kanal adını ve
çizim sırasında patlayan kodu yakalar — yerleşim/görünüm hatalarını
yakalamaz. **Electron ile** çalıştırılır (`npx electron …`), düz `node` ile
değil.

> Ekran görüntüsü alıp fareyle tıklayarak sınamaya çalışmayın — denendi.
> Electron penceresi arka plandayken `mouse_event` tıklamaları pencereye
> geçmiyor; ekran görüntüsü doğru çıksa bile tıklama hiç işlenmiyor ve
> sonuç yanıltıcı oluyor. `executeJavaScript` ile `ekranAc()` çağırmak hem
> güvenilir hem de hata metnini doğrudan veriyor.

> Sahte sınama tuzağı: ilk yazılan kilit sınaması `kontrol(..., true, ...)`
> şeklindeydi, yani koşulu ne olursa olsun geçiyordu. Şimdiki hâli
> `vegayaYazmaAktif` bayrağını gerçekten kapatıp `kod === 'YAZMA_KAPALI'`
> geldiğini **ve** sıfır satır yazıldığını doğruluyor.

---

## 9. Çalıştırma / paketleme

```
npm install
npm start                              # geliştirme
npx electron-builder --win --x64        # kurulum dosyası
cd izleyici && npm run dist             # dist/GalyaIzleyici.exe
```

> `ELECTRON_RUN_AS_NODE` ortam değişkeni set ise Electron açılmaz;
> `Cannot read properties of undefined (reading 'whenReady')` verir.
> Kabuk ortamınızda varsa temizleyin.

Ayarlar paketli sürümde `%APPDATA%\Galya Panel\ayarlar.json` altında durur,
ilk açılışta `ayarlar.ornek.json` kopyalanarak oluşturulur.

> BOM tuzağı: PowerShell'in `Set-Content -Encoding UTF8` komutu dosyanın
> başına BOM koyar, `JSON.parse` patlar ve program sessizce varsayılanlara
> döner (şifre boş kalır → "Login failed"). `ayar.js` artık BOM'u kırpıyor,
> ama ayar dosyasını elle yazarken BOM'suz yazın.

Arayüzde CSP var: `default-src 'self'; script-src 'self'; style-src 'self'
'unsafe-inline'`. Satır içi `<script>` çalışmaz.

---

## 10. Şu anki veritabanı durumu

Gerçek Galya verisi **geri yüklendi** (14.08.2026). `VEGADB` artık 3.883
tablo tutuyor ve firmalar şöyle:

| Firma | Ad | Canlı dönem | Hareket | Son hareket |
|---|---|---|---|---|
| `F0100` | DEMO | — | 0 | — |
| `F0101` | GALYA eski | `D0001` | 40.407 | 22.10.2025 |
| `F0102` | **GALYA YENİ** (MARQUE GIDA) | **`D0002`** | 185.151 | 12.08.2026 |
| `F0103` | GALYA KEBAP | `D0001` | 20.442 | 09.08.2026 |

`ayarlar.json` içindeki `varsayilanFirma: "F0102"` / `varsayilanDonem:
"D0002"` bu tabloya uyuyor; düzeltme gerekmedi.

> **Restore sonrası ilk iş: yetki.** Yedek başka bir sunucudan geldiği için
> `galya_panel` kullanıcısı VEGADB ve sefim içinde yoktu; panel
> `Login failed for user 'galya_panel'` veriyordu. Giriş aslında sunucuda
> duruyor, başarısız olan veritabanını açmak. Çözüm:
> `sqlcmd -S localhost -E -C -i kurulum/sql-yetki-tazele.sql`
> (yalnızca okuma yetkisi verir). Her restore'dan sonra tekrarlanacak.

---

## 11. Sıradaki işler

1. **Reçete verimleri.** 433 reçetenin 430'unda verim (`TBLURERECETELIST.
   MIKTAR`) 1 girilmiş. Bir kazan tiramisu da "1 birim" sayıldığı için
   hesaplanan mamul maliyeti porsiyon değil kazan maliyeti çıkıyor. Bu
   panelin hesabındaki bir hata değil, reçete verisindeki eksiklik; müşteriye
   söylenmeli, doldurulmadan mamul maliyetleri kullanılmamalı.
2. **Üretim fişinin canlıda ilk denemesi.** Kod `GALYA_TEST` üzerinde
   doğrulandı (14 sınama). Canlıda ilk kez çalıştırırken tek üründen
   başlanmalı ve Vega arayüzünden fişin göründüğü kontrol edilmeli.
   96/97 sayacını Şefim entegrasyonu günde 250–600 belge hızında
   ilerlettiği için yoğun saatlerde toplu üretimden kaçınılmalı.
3. **Alış faturasının canlıda ilk denemesi.** Cari borç oluşturduğu için
   muhasebe zincirine dokunan yazma işlemlerinden biri. İlk faturanın
   Vega'da doğru göründüğü ve cari ekstresine düştüğü teyit edilmeli.
4. **Zayi fişinin canlıda ilk denemesi.** 19.08.2026'da yazıldı, yalnızca
   `GALYA_TEST` üzerinde denendi (19 sınama). Alış faturası gibi cari
   hareketi oluşturuyor, yani muhasebe zincirine dokunuyor. İlk fişte tek
   kalemle başlanmalı; Vega'nın Stok Çıkış Fişi ekranında belgenin ve ZAYİ
   carisinin ekstresinde borcun göründüğü kontrol edilmeli. Fiyatsız kip
   (varsayılan) cari borcunu 0 yazar — muhasebenin bunu beklediği teyit
   edilmeli.
5. **Zayiatlı üretimin canlıda ilk denemesi.** İki belge birden kesiyor
   (zayi + üretim). Üretim tarafı 96/97 sayacını kullandığı için yoğun
   saatlerden kaçınılmalı. Üretim adımı hata verirse zayi fişinin gerçekten
   geri alındığı gözle doğrulanmalı.
6. **Müşteriye sorulacak: tam sayımda girilmeyen ürün.** Şu an atlanıyor
   (stok değişmiyor). Gerçek dönem sonu envanterinde sayılmayan ürünün
   stoğunun sıfırlanması beklenir. Bu geri dönüşü zor bir davranış
   olduğu için kullanıcının kararıyla "atla" seçildi; envanter kapanışında
   yeterli olup olmadığı müşteriyle netleşmeli.
7. **Müşteriye sorulacak: sayımcıya stok yetkisi.** `stok` yetkisi verilen
   kullanıcı stok ekranında envanter miktarını görür — körleme sayım o kişi
   için anlamını yitirir. Sayım yapan kullanıcılara bu yetki verilmemeli;
   gerekiyorsa `stok:kontrol` yanıtındaki miktarın da süzülmesi ayrı bir iş.

---

## 11b. Uzaktan erişim (mobil / web) — 18.08.2026 kararı

**Karar: yapılmadı, masaüstü programıyla devam.** Müşteri kullanmaya
başlasın, uzaktan neye ihtiyaç duyduğu ortaya çıkınca yeniden bakılır.
Aşağısı o gün baştan araştırılmasın diye.

### Kod tarafı zaten hazır

Arayüz SQL'e hiç dokunmuyor; her şey kanal üzerinden gidiyor:

```
ui/app.js → cagir(kanal, veri) → preload → main.js kayitEt → db/*.js → SQL
```

`db/` altındaki 16 dosyanın 13'ü saf Node — Electron bağımlılığı yok.
Kalan üçü: `rapor.js` (PDF/yazdırma, `BrowserWindow`), `guncelleme.js`
(electron-updater), `ayar.js` (Electron require'ı zaten `try/catch` ile
korumalı, o yüzden test betikleri Electron'suz çalışıyor).

83 kanalın hepsi `async (girdi, kim) => sonuç` imzasında. Web'e taşımak
kabaca `kayitEt`'i bir Map'e alıp aynı işleyicileri HTTP'den de çağırmak
demek — yarım günlük iş.

### Yorucu olan kod değil, şunlar

1. **Veritabanını dışarı açmak.** Program şu an yerel ağda; dışarıya bakan
   hiçbir yüzey yok. Cloudflare Tunnel port açmadan ve sabit IP gerektirmeden
   çözer ama risk sıfırlanmaz — `galya_panel` kullanıcısının VEGADB'deki
   yazma yetkisi de bu durumda yeniden değerlendirilmeli.
2. **Kimlik doğrulama yok.** "Kullanıcı" = Windows oturum adı. Giriş, rol,
   yetki yok. Yazma kilidi de tek global bayrak; uzaktan çok kullanıcıda
   "kim yazabilir" sorusuna dönüşür.
3. **İki arayüzü sonsuza kadar senkron tutmak.** Asıl kalıcı yük bu.

### Yapılacaksa nasıl yapılmalı

Native mobil uygulama **değil** — iki kod tabanı, mağaza onayı, güncelleme
sürtünmesi getirir ve mobil web sayfasının üstüne hiçbir şey koymaz; ikisi
de aynı tünelden geçecek. Web sayfası ana ekrana eklenince uygulama gibi
durur.

Tam web paneli de değil (3-4 hafta, bakım yükü iki katı). Dar bir mobil
sayfa yeter: **sayım + salt okunur stok/cari**. Ekranların çoğu masa başı
işi (alış faturası, maliyetlendirme, reçete, tutanak) ve telefonda
yapılması kimseye bir şey kazandırmaz. Tek gerçek kazanç sayım: şu an
depoda kâğıda yazıp masaya gelip giriyorlar.

Kaba efor ~1 hafta: HTTP katmanı yarım gün, giriş+roller 1 gün, mobil
sayım ekranı 2-3 gün, okuma ekranları 1 gün, tünel+TLS yarım gün, test
1 gün.

> **Barkod okutma olmaz.** `F0102TBLBIRIMLEREX`'te 2.464 birim satırının
> yalnızca 62'sinde `BARCODE` dolu (%2,5). Firma barkod girmemiş; mobil
> sayım ada göre arama olmak zorunda.

---

## 12. Şefim tarafı (bilinmesi gereken)

Gerçek veriyle ölçüldü (14.08.2026, `F0102` / `D0002`):

| | |
|---|---|
| Aktarılan satış | 121.533 |
| **Aktarılmayan satış** | **20.451** |
| En eski bekleyen | 12.06.2026 |
| Ürün eşleşmesi | 326'da 321 otomatik eşleşti, 5 eşleşmedi |

Yani sorun **isim eşleşmesi değil, aktarımın kendisi**: 12.06.2026'dan beri
biriken 20.451 satış Vega'ya hiç geçmemiş. Teorik stok bu yüzden gerçeğin
gerisinde. Panel bunu gizlemiyor, ekranda gösteriyor.

> Daha önceki devir notunda "eşleşme 324'te 1" yazıyordu. O ölçüm, VEGADB
> geçici olarak ÖZDEMİRKAYA verisi tutarken alınmıştı — Şefim ürünleri
> başka bir müşterinin stok kartlarıyla karşılaştırılıyordu. Gerçek Galya
> verisinde eşleşme sorunu yok.

Stok sayılarına dayanan bir özellik eklemeden önce aktarım açığı akılda
tutulmalı.
