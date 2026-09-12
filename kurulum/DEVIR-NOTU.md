# Devir notu — Galya Panel

Bu dosya, projeyi devralan kişinin (veya yeni bir sohbetin) sıfırdan bağlam
kurmadan devam edebilmesi için yazıldı. Kod okunarak veya git geçmişine
bakılarak öğrenilemeyecek şeyleri anlatır.

Son güncelleme: 11.09.2026 · Sürüm 1.9.2 (+ 11.09 düzeltmeleri, bkz. §15)

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
  ui/                Arayüz (index.html, app.js, aktarim-uretim.js, app.css) — çerçeve yok, düz JS
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
    aktarim.js       Şefim günlük satış aktarımı (okuma + mutabakat + yazma çağrısı)
    sunucu.js        Ağdan erişim için HTTP sunucusu
    maliyet.js       Maliyet hesabı (son alış fiyatı + reçete)
    fatura.js        Alış faturası taslağı (panel veritabanında)
    uretim.js        Üretim: manuel (fireli), sıfıra kadar, iş emri, aktarım sonrası
    uretim-depo.js   Reçete pozisyonları (BAŞLA/BİTİR, KOD ile) ve depo seçimi
    yetki.js         Kanal → yetki haritası (main.js'teki süzgecin tablosu)
    yedek.js         Yedekleme merkezi (BACKUP / RESTORE, işlem öncesi diferansiyel)
    rapor.js         Rapor üretimi
    disaaktar.js     Excel / PDF dışa aktarma
    guncelleme.js    electron-updater sarmalayıcı
    vegaprogram.js   VegaWinA5 exe'sini bulma / başlatma
  izleyici/          Ayrı, bağımsız Electron uygulaması (aşağıda)
  kurulum/
    BELGE-DESENI.md          Vega'ya yazma deseni — yazmaya dokunmadan önce okuyun
    DEVIR-NOTU.md            bu dosya
    URETIM-BULGU-08-09-2026.md, CODEX-*.md  bulgu raporu, Codex görev ve teslim notları
    sql-kullanici-olustur.sql
    sql-yetki-tazele.sql     restore sonrası okuma yetkisini geri verir
    sql-yazma-yetkisi-ver.sql  VEGADB'ye yazma yetkisi (ikinci kilit)
    sql-yedek-yetkisi-ver.sql  yedek alma (ve isteğe bağlı geri yükleme) yetkisi
    test-ortam.js           sınamaların ortak ayarı: panel tabloları daima GALYA_TEST'te
    test-sorgular.js        127 okuma sınaması
    test-yazma.js           152 yazma sınaması (--kur ile kurulur, GALYA_TEST üzerinde)
    test-kolon-denetimi.js  panelin doldurduğu kolonları Vega'nınkiyle karşılaştırır
    test-uretim-belge-zinciri.js  üretimin bütün tablo zinciri + geri alma (GALYA_TEST)
    uretim-sinama-verisi.js       belge zinciri sınamasının GALYA_TEST hazırlığı
    canli-belge-sinamasi.js lisanslı bir Vega veritabanına örnek belge yazar (--geri-al ile siler)
    test-yetki.js            42 kullanıcı / kapsam / onay sınaması
    test-yetki-haritasi.js   her IPC kanalı yetki haritasında sınıflanmış mı
    test-arayuz.js           35 arayüz duman sınaması (Electron ile)
    test-aktarim.js          Şefim aktarımı mutabakatı + süren gün kilidi (yalnız okur)
    test-aktarim-kolon-denetimi.js  aktarım kolonları (yalnız okur)
    test-aktarim-yazma.js    uçtan uca aktarım + geri alma (GALYA_TEST)
    test-geri-yukleme.js     yedekten geri yükleme, tam ve zincirli (yalnız GALYA_TEST)
    test-ag.js               ağ sunucusu ve oturum ayrımı
    oksuz-shareket-onar.sql  25.08 fişlerinin eksik TBLSHAREKET satırları — müşteri kararıyla ÇALIŞTIRILMIYOR
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

### Beş sert kural

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

5. **Pasif kart iki yerde işaretli: `STATUS = 2` ve `KOD8 = 'PASİF'`.**
   Vega'nın kendi alanı **STATUS**'tür (stokta da caride de); `KOD8` firmanın
   kendi işareti ve yalnız stokta var. 04.09.2026 sayımı (F0102): 617 stok
   kartı `STATUS = 2`, bunların 360'ında `KOD8` da 'PASİF' — yani **257 kart
   yalnız Vega'da**, 13 kart yalnız KOD8'de pasif. Panel bir süre sadece
   KOD8'e baktığı için o 257 kart listelere ve ana ekran sayılarına sızdı.
   `TBLSTOKLAR.AKTIF` alanı ise kullanılmıyor (0/NULL karışık, pasiflikle
   ilgisi yok) — ona bakmayın.

   Süzgeç tek yerde: `db/vega.js` → `stokPasifHaric()`, `cariPasifHaric()`,
   `pasifIfadesi()`. Yeni bir stok/cari listesi yazan herkes bunları
   kullanmalı; elle `KOD8 <> 'PASİF'` yazmak eksik süzgeçtir.

   Pasife alma da (`db/yazma.js` → `stokPasifYap`) iki alanı birden yazar;
   yalnız KOD8 yazıldığında kart Vega arayüzünde aktif kalıyordu.

   Maliyet motoru (`db/vega.js` → `sonAlisFiyatlari`) burada bir istisnadır:
   pasif kartları **süzmez**, işaretler. 17 pasif kart hâlâ aktif reçetelerde
   bileşen; süzülürse üst mamulün maliyeti eksik çıkar. Listeden ve yazmadan
   çıkarma işi `db/maliyet.js`'te yapılır.

Belge yazma deseninin tamamı `kurulum/BELGE-DESENI.md` içinde. Yazma koduna
dokunmadan önce o dosya okunmalı.

### Belge tipleri

| Tip | Anlamı |
|---|---|
| 32 / 33 | Stok giriş / çıkış (elle girilen, `A` önekli) |
| 103 / 104 | Stok giriş / çıkış (Vega'nın otomatiği, `Z` önekli) |
| 93 / 94 | Sayım girişi / çıkışı |
| 96 / 97 | Üretim çıktısı / tüketimi |

Panel **kendi belge serisini** kullanır: `ayarlar.json` → `belgeOneki`,
varsayılan `GP` (`GP0000001`). `A` serisi Vega'nın elle belge girişindeki
varsayılan serisidir; panel oraya yazarsa numaralar kullanıcınınkilerle
aynı diziye girer ve çakışabilir. Ayrıntı `BELGE-DESENI.md` → "Belge
numarası: panelin kendi serisi olmalı".

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
(`%APPDATA%\galya-panel\`) içinde SQL şifresi düz metindir. Bilgisayara
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
| Fireli (manuel) üretim | Çalışıyor — **canlıda denendi ve geri alındı** (25.08) |
| Çok çıktılı üretim (yan mamul + fire) | Çalışıyor — **08.09.2026'da eklendi**, canlıda DENENMEDİ |
| Sıfıra kadar üretim | Çalışıyor — **canlıda denendi ve geri alındı** (25.08), tek tek ve toplu |
| Zayiatlı üretim | **Kaldırıldı** (25.08.2026) |
| Otomatik üretim | **Kaldırıldı** (22.08.2026) |
| Her ekranda ayrıntılı Excel/PDF | Çalışıyor — 14 ekran, çıktıya ad verilebiliyor |
| Yedekleme merkezi | Çalışıyor — yedek alma canlıda denendi; geri yükleme **GALYA_TEST'te sınandı** (11.09.2026), canlıda DENENMEDİ |
| Kullanıcılar ve yetkiler | Çalışıyor — PIN'le giriş, sınıf kapsamı |
| Sayım onay akışı | Çalışıyor — onaysız Vega'ya yazılmıyor |
| Tam sayım | Çalışıyor — kapsamdaki bütün kartlar |
| Stok kartını pasife alma | Çalışıyor — `STATUS = 2` ve `KOD8 = PASİF` birlikte |
| Şefim günlük aktarımı | Çalışıyor — GALYA_TEST'te uçtan uca sınandı, canlıda DENENMEDİ (§13) |

Belgedeki maddelerin tamamı bitti. Panelin yazdığı her belge tipi gerçek
Vega fişlerinden çıkarıldı, `GALYA_TEST` üzerinde sınandı ve canlı firmada
tek örnekle doğrulanıp geri alındı — zayi, fireli ve sıfıra kadar üretim
hariç, onlar henüz yalnızca `GALYA_TEST` üzerinde denendi
(bkz. 11. Sıradaki işler).

### 08.09.2026'da yapılanlar

Müşteri Vega'da bir üretim yaparken ekranını kaydetti ve izleyici çıktısıyla
birlikte gönderdi: *"bu söz konusu üretimde program hâlâ yanlış işlem
yapıyor."* Video saniye saniye izleyici kaydıyla, sonra ikisi birden
VEGADB'nin kendi verisiyle karşılaştırıldı. **İki ayrı kusur çıktı, ikisi de
veriyle kanıtlandı.** Bulgunun tamamı `kurulum/URETIM-BULGU-08-09-2026.md`
dosyasında; deseni `BELGE-DESENI.md`'ye işlendi.

> **İzleyici çıktısı tek başına yetmiyor.** 1013 olay okundu, 23 yazma
> ifadesi gösterildi; ama `TBLUREURETIMLIST`, `TBLUREURETIM`,
> `TBLUREURETIMCIKTI`, `TBLSTOKHAREKETLERI` ve `TBLDEPOENVANTER`
> INSERT'lerinin hiçbiri kayda girmedi. Vega bunları hazırlanmış (prepared)
> ifadeyle gönderiyor, `izleyici/main.js`'teki
> `YAZAN = /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/` süzgeci `exec sp_execute …`
> metnini yakalamıyor. Desen çıkarırken izleyiciye tek başına güvenmeyin;
> veritabanından doğrulayın.

#### 1. 96/97 belgelerinin satırları `TBLSHAREKET`'e yazılmıyordu

"96 ve 97'nin başlık tablosu yoktur" doğruydu; ama **satır tablosu vardır**:
`F{firma}D{dönem}TBLSHAREKET`. `TBLSTOKHAREKETLERI.LN` o satırın IDENTITY
değeridir. Son 5.000 adet 96/97 hareketinin 5.000'inde bağ tutuyor; aynı
sorgu tip 33 için 2.000'de 3 tutuyor, yani rastlantı değil.

Panel `LN`'yi `MAX(LN) + 1` ile kendi üretiyor, `TBLSHAREKET`'e hiç
yazmıyordu:

- belge Vega'nın Üretim Giriş / Çıkış Fişi ekranında **satırsız** görünüyor,
- IDENTITY ilerlemediği için Vega'nın yazacağı sonraki belgeler **aynı
  LN'leri yeniden üretiyor**.

25.08'de canlıda bırakılan iki fişin 10 satırı bu yüzden `TBLSHAREKET`'te
yok; aynı örneklemdeki diğer 20.000 hareketin tamamında var.

Tablo dönemlidir ve Vega onu yalnız modül kullanılınca oluşturuyor (F0100 ve
F0101/D0002'de yok); panel `tabloVarMi` ile bakıyor, yoksa eski yola
düşüyor.

#### 2. Çok çıktılı reçetelerde yan mamuller hiç yazılmıyordu

Reçetenin çıktıları `F{firma}TBLURERECETECIKTI` tablosunda duruyor. **Bu
tablo kod tabanının hiçbir yerinde geçmiyordu.** Panel her üretimde tek
çıktı satırı yazıyordu (mamul, `ORAN` 100, `TUR` 0).

Reçete 4516 (DANA ANTRIKOT) gerçekte dört çıktılı: ana mamul + DANA KUŞBAŞI
+ DANA KIYMA + FİRE. F0102/D0002'deki 256 üretim fişinin 68'i çok çıktılı;
433 reçetenin 7'si böyle (4516, 4496, 4497, 4499, 4506, 4515, 4534).

Maliyet `ORAN`'a göre paylaşılıyor:

```
satır.TUTAR = toplam tüketim maliyeti × ORAN / 100
satır.FIYAT = satır.TUTAR / satır.MIKTAR
```

Video'daki üretim bu formülle birebir çıkıyor: 23.750 × %100 / 18 =
1.319,444444 · 23.750 × %100 / 3 = 7.916,666667.

> **`ORAN` toplamı 100 olmak zorunda değil** ve Vega bunu uyarmadan
> uyguluyor. DANA ANTRIKOT'ta toplam 200 — 23.750 TL hammadde 47.500 TL
> mamule dönüyor. Panel Vega ile aynı sayıyı yazıyor (yoksa sayılar
> tutmazdı), ama ekranda oran toplamını uyarı olarak gösteriyor. Bu bir
> reçete verisi sorunudur; düzeltilecekse reçete düzeltilmeli.

**Fire kararı (müşteriyle netleşti):** reçeteli çok çıktılı üretimde fire
Vega'daki gibi FİRE stok kartına 96 girişi olarak yazılıyor; zayi fişi
kesilmiyor, cari borcu oluşmuyor. Reçetesiz manuel üretimde eski akış (önce
zayi fişi) 22.08'deki isteğe uygun olarak duruyor. İkisi bir arada
yapılsaydı fire iki kez düşerdi.

Ekranda mamul seçilir seçilmez `uretim:isEmri` çağrılıyor (09.09.2026'ya
kadar `uretim:receteCiktilari`'ydı, o uç okuma tarafında duruyor). Birden
fazla çıktı varsa fire kutuları ve fire carisi bölümü gizleniyor; fire
çıktı satırlarından biri oluyor.

#### 2b. Ekran Vega'nın İş Emri ekranına göre yeniden yazıldı (09.09.2026)

08.09'daki düzeltme arka uçta doğruydu ama **ekranda görünmüyordu**: çıktı
tablosu yalnız çok çıktılı 7 reçetede açılıyordu, kalan 426 üründe ekran
hiç değişmiyordu. Müşteri 1.9.0'a güncelledikten sonra "frontend'de hiçbir
değişiklik yok" dedi ve haklıydı.

`uretimFireliBolumu()` silinip ekran kaydındaki İş Emri ekranına göre
yeniden yazıldı:

- **Çıktı tablosu her üründe görünüyor.** Tek çıktılı reçetede tek satır.
  Üretilen miktar da o satırdan giriliyor; ayrı "çıkan miktar" kutusu
  kaldırıldı (Vega'da da başlıktaki miktar çıktı satırından gelir).
- **Girdiler reçeteden doluyor.** Vega mamulü seçer seçmez "Üretim
  Girdileri" sekmesini dolduruyor; panel de artık öyle. Reçetesiz üründe
  hammadde elle seçiliyor, eski akış sürüyor.
- **Kolonlar Vega'nınkiyle aynı:** Çıktı Türü, Stok, Miktar, Birim Maliyet,
  Toplam Maliyet, Maliyet Oranı. Tablonun altında Vega'daki gibi kayıt
  sayısı / toplam miktar / toplam tutar / oran toplamı satırı var.
- **Maliyet ekranda anlık hesaplanıyor**, yukarıdaki formülle. Videodaki
  fişin sayıları birebir çıkıyor.

Yeni uç `uretim:isEmri` (`db/uretim.js`): mamul kartı, reçete bileşenleri
(birim maliyet + kalan), çıktı satırları ve oran toplamı tek çağrıda.

> **Tuş vuruşunda tablo yeniden çizilmemeli.** İlk yazımda her `input`
> olayında tablo baştan kuruluyordu; miktar kutusu DOM'dan söküldüğü için
> odak kayboluyor ve ilk rakamdan sonrası yazılamıyordu. Çizim ile hesap
> ayrıldı: tablolar yalnız satır eklenip çıkarıldığında kuruluyor,
> `hesaplariTazele()` yalnız sayı hücrelerinin metnini değiştiriyor.

#### 3. Reçete açarken ana mamul çıktı satırı yazılmıyordu

Vega **her** reçeteye `TBLURERECETECIKTI`'ya bir ana mamul satırı yazıyor:
`TUR` 0, `ORAN` 100, `RECETENO` = reçete başlığının IND'i. Üç kurulumda
627 reçetenin 627'sinde var — istisna yok. Reçete ekranı mamulü oradan
okuyor.

Panel yazmıyordu. Kolon denetimi de göremiyordu, çünkü **denetimin kendisi**
çıktı satırlarını elle ekleyip panelin eksiğini örtüyordu — sınamanın kendi
kurgusunun bir kusuru gizlemesinin iyi bir örneği. Denetime artık panelin
kendi yazdığı satır için ayrı bir vaka kondu (elle ekleme ondan sonra
yapılıyor).

`receteCiktiSatiriGuvence()` hem yeni reçetede yazıyor hem de eski
reçetelerde eksikse tamamlıyor (panelin önceki sürümüyle açılmış reçeteler
için).

#### 4. Belge serisi `A`'dan `GP`'ye alındı

Müşterinin uyarısı: *"belge numaraları varsayılan Vega'da A serisinden
başlıyor zaten, başka bir seri ver."*

Doğruydu. Panelin `A` seçimi "Vega otomatiklerde Z kullanıyor, A boştur"
varsayımına dayanıyordu; oysa `A` Vega'nın **elle belge girişindeki
varsayılan serisi**. Kanıt: bu makinedeki ikinci veritabanında panel hiç
yazmamışken A serisi `A0000009`'a kadar doluydu.

Riski iki taraflıydı: aynı anda fiş kesilirse numara çakışabiliyordu
(`UPDLOCK` yalnız paneli bekletir, Vega o kilidi almaz) ve panel belgesi
kullanıcının elle yazdığından ayırt edilemiyordu.

Artık önek `ayarlar.json` → `belgeOneki`, varsayılan **`GP`**. İki gerçek
veritabanının altı belge tablosunda da `GP` ile başlayan tek satır yok.
Stok giriş/çıkış, alış faturası, sayım ve üretim fişinin `FISNO`'su bu
öneki kullanıyor. Depo transferi (38) ve üretim 96/97 belgeleri Vega'nın
**paylaşılan** `Z` sayacının devamı olduğu için değişmedi.

#### 5. Kolon denetimi: 271 boş kolon bulundu ve dolduruldu

Müşterinin uyarısı: *"tabloları birebir aynı doldurması gerekiyor, yoksa Vega
okumamazlık yapıyor; daha önce bu sorunu hızlı belge doldurucuda yaşamıştık."*

Bunun için `kurulum/test-kolon-denetimi.js` yazıldı. Vega'nın gerçek
satırlarında kolon doluluk oranını ölçüp panelin yazdığıyla karşılaştırıyor;
Vega'nın %100 doldurduğu bir kolonu panel NULL bırakmışsa risk sayıyor.

İlk çalıştırma: **271 riskli kolon.** Dağılımı:

| Belge | Riskli kolon |
|---|---:|
| Sayım giriş/çıkış başlığı (93/94) | 44 + 44 |
| Sayım giriş/çıkış satırı | 18 + 18 |
| Stok giriş başlığı/satırı (32) | 24 + 21 |
| Alış faturası başlığı/satırı (20) | 20 + 14 |
| `TBLSHAREKET` (96/97) | 20 + 20 |
| Stok çıkış başlığı/satırı (33, tutanak) | 3 + 4 |
| Reçete başlığı | 10 |
| Diğer (stok hareketi, cari, üretim çıktısı) | 11 |

Değerlerin neredeyse tamamı `0`, `false` ya da `''` — yani veri değil,
Vega'nın beklediği doluluk. Hepsi dolduruldu; denetim şimdi **1013 zorunlu
kolonda 0 risk** veriyor.

Dikkat çeken nokta: `zayiFisiYaz` tertemizdi ama aynı tabloya (33) yazan
tutanak yolu (`fisYaz`) değildi — tutanak `STOKKODU` ve `STOKTIPI`'yi hiç
yazmıyordu. Aynı tabloya yazan iki kod yolundan biri doğru olabiliyor; bu
yüzden denetim belge tipi tipi çalışıyor.

**Ve bir kurulum yetmiyor.** Denetim bu makinedeki diğer Vega
veritabanlarına da yöneltildi; her biri bir öncekinin kaçırdığını yakaladı:

| Kurulum | Eksik | Nerede |
|---|---:|---|
| `VEGADB` (Galya, F0102/D0002) | 271 | sayım, fatura, tutanak, SHAREKET, reçete |
| `VEGADBozdemirkaya` (F0101/D0017) | 33 | zayi / stok çıkış (33) |
| `VEGADB_cazgır` (F0118/D0001) | 62 | **üretim başlığı 13, depo transferi 37**, üretim tüketimi, 96/97 |

Eksikler her seferinde başka yerdeydi: Galya'da tutanak eksikti/zayi
temizdi, Özdemirkaya'da tersi. **Üretim tarafındaki 50 kolon ancak üçüncü
kurulumda görüldü** — üretim modülünü canlı kullanan tek veritabanı oydu
(F0118D0001'de 380 üretim fişi). Yani panelin en çok uğraşılan kısmı, iki
kurulumda "temiz" göründükten sonra hâlâ eksikti.

Üçü de dolduruldu; üç veritabanına karşı da denetim temiz.

Denetimi başka bir veritabanına yöneltmek:

```
GALYA_KAYNAK_VT=VEGADB_cazgır GALYA_KAYNAK_FIRMA=F0118 GALYA_KAYNAK_DONEM=D0001 node kurulum/test-kolon-denetimi.js
```

> Yeni bir Vega veritabanına eriştiğinizde denetimi ona karşı da çalıştırın.
> Tek kurulumda "temiz" çıkmak yeterli değil.
GALYA_KAYNAK_VT=VEGADBozdemirkaya GALYA_KAYNAK_FIRMA=F0101 GALYA_KAYNAK_DONEM=D0017 node kurulum/test-kolon-denetimi.js
```

#### 5. Maliyet motoru da `ORAN`'ı bilmiyordu

`db/maliyet.js` bileşen maliyetinin tamamını mamule yazıyordu. Ana mamulün
oranı 100'den küçük olan reçetede (4497 TAVUK BONFILE, %9,07) mamul maliyeti
olduğundan yüksek çıkıyordu. Formül reçetenin kendi sakladığı çıktı
fiyatıyla doğrulandı:

```
4497 TAVUK BONFILE  4845 × %9,07211558 / 190   = 2,31338947   ✔
4515 LEVREK         6296 × %100        / 3,624 = 1737,30684   ✔
4516 DANA ANTRIKOT   950 × %100        / 1     = 950          ✔
```

Sınama 123'ten **150**'ye çıktı (`kurulum/test-yazma.js`); müşterinin
videosundaki üretim (oran toplamı 200 → 23.750 TL hammadde, 47.500 TL mamul)
birebir sınanıyor. `--kur` iki yeni tablo kopyalıyor: `TBLURERECETECIKTI` ve
`TBLSHAREKET`. Ayrıca `kurulum/test-kolon-denetimi.js` eklendi.

### 25.08.2026'da yapılanlar

Müşterinin dört isteği karşılandı.

#### 1. Zayiatlı üretim kaldırıldı

Müşterinin sözü: *"zayiatlı üretimi kaldırmak istiyorum, orada sadece
çalışanların zayi ettiği ürünleri yazabilelim; ayrıca eksiye düşmüş ürünleri
de sıfıra kadar üretebilelim."*

22.08'de eklenen birleşik kip (zayi fişi + stoğu sıfıra çekme, tek düğmede)
iki ayrı işi tek düğmeye bindiriyordu. Ayrıldılar:

| Nerede | Ne yapılır |
|---|---|
| Zayi / personel çıkışı ekranı | Çalışanın zayi ettiği ürün yazılır (stok çıkış fişi 33 + cari borç). Zaten vardı, değişmedi. |
| Üretim → "Sıfıra kadar üret" | Stoğu EKSİYE düşmüş, reçetesi olan ürünler listelenir; seçilenler sıfıra çekilir. Zayi fişi kesilmez. |

Kaldırılanlar: `uretim.zayiatliUret`, `uretim.uretilebilirler` ve
`uretim:zayiatli` / `uretim:uretilebilirler` kanalları.

Yeni uçlar: `uretim.sifirAdaylari` / `sifiraKadarUret` / `hepsiniSifirla`,
kanalları `uretim:sifirAdaylari` / `uretim:sifiraKadar` /
`uretim:hepsiniSifirla`. Üretilecek miktarı kullanıcı yazmıyor; program eksi
kalanın karşılığını buluyor ve **fişin yazıldığı anda** yeniden okuyor.

> Aday listesi artık THIRD işaretiyle SINIRLI DEĞİL. 22.08 öncesindeki
> otomatik üretim yalnızca `KOD11 = THIRD` kartlara bakıyordu; müşteri
> "eksiye düşmüş ürünleri" dediği için liste eksideki bütün reçeteli
> kartları getiriyor. Şeritteki "Yalnızca THIRD işaretliler" düğmesi eski
> dar listeyi veriyor. Canlı veride fark büyük: **9 aday, THIRD'e
> kısıtlanınca 1.**

##### Kendini tüketen reçete (canlı denemede çıktı)

Bazı kartların reçetesinde mamulün KENDİSİ bileşen olarak duruyor. F0102'de
`Tequila.Olmeca Blanco` üretmek için 0,07 birim `Tequila.Olmeca Blanco`
tüketiliyor — içkilerde şişeden kadeh üretimi böyle tanımlanmış.

Böyle bir kartta 1 birim üretim stoğu 1 değil **(1 − oran)** kadar artırıyor.
İlk canlı denemede bu görüldü: stoğu −0,1575 olan Tequila için 0,1575
üretildi ve stok sıfır yerine **−0,0110**'da kaldı.

Düzeltme (`uretim.kendiTuketimOrani` + `sifirlamaMiktari`):

    üretilecek = eksik / (1 − oran)

Tequila'da 0,1575 / 0,93 = 0,16935 → stok tam sıfıra oturuyor (canlıda
doğrulandı, sonra geri alındı). Oran 1 veya üstündeyse üretim stoğu hiç
artırmaz; o kart `uretilemez` işaretiyle geliyor, ekranda "Sıfıra çekilemez
— reçete kendini tüketiyor" yazıyor, toplu üretimde atlanıyor.

> Aynı ölçek **maliyet hesabında yok**. `db/maliyet.js` kendini tüketen
> reçeteyi olduğu gibi hesaplıyor; mamulün maliyeti kendi maliyetini
> içerdiği için oran büyükse şişiyor. Müşteriye sorulacaklar listesine
> girdi (11. bölüm).

#### 2. Manuel (fireli) üretim ekranı sadeleşti

Müşterinin sözü: *"senin yaptığın görsel daha zor, Vega tarafında bu görsel
daha basit."* İş mantığı değişmedi (`uretim.fireliUret` aynı), ekran
değişti:

```
1. Ne üretilecek?     [Ürün seç] somon      Çıkan miktar [3]
2. Neyden üretilecek? [Ürün seç] ham somon  Giren miktar [10]
   Fire: 7 (otomatik = giren − çıkan, elle değiştirilebilir)
```

- **Fire artık elle yazılmıyor**, giren − çıkan olarak hesaplanıyor.
  Kullanıcı kutuya dokunursa otomatik hesap o satır için devreden çıkıyor
  (yazdığı sayı ekran tazelenince silinseydi kimse güvenmezdi).
- Birden fazla hammadde eklenirse otomatik hesap kapanıyor ve ekran bunu
  yazıyor — hangi hammaddeye ne kadar fire düştüğü bilinemez.
- Fire carisi / alt hesap / sebep / "maliyetle yaz" alanları kapalı bir
  `<details>` bölümüne alındı. Varsayılan cari zaten FİRE (yoksa ZAYİ)
  kartı; kullanıcı çoğu zaman hiç açmıyor.
- **Reçete gerekmiyor**, gerekmedi de: `yazma.uretimHazirligi` elle bileşen
  listesi alıyor. "Somon" kartının reçetesi yok ve olması da gerekmiyor.

#### 2b. Miktar yazımı ve fire kutusu (1.7.1)

İki kusur ilk kullanımda çıktı:

- **`sayiYaz(x, 3)` üç ondalık basamağı zorla yazıyordu.** Türkçe biçimde
  virgül ondalık ayracı olduğu için 28 ekrana `28,000` diye düşüyor ve
  kullanıcı bunu "28 bin" diye okuyor — nitekim "neden 28 yazınca 28000
  alıyor" diye soruldu. Yeni `miktarYaz()` gereksiz sıfır yazmıyor
  (28 → `28`), bir yüzdelikten küçük değerlerde ise basamağı artırıyor
  (0,0083 üç basamakta `0,008` diye kırpılıyordu). Üretim ekranlarında
  16 yerde değişti.
- **Fire kutusunun etiketi yalan söylüyordu.** Kullanıcı fireye elle
  dokununca otomatik hesap kapanıyor (yazdığı sayı silinmesin diye,
  bilinçli) ama etiket "(otomatik)" demeye devam ediyordu; giren/çıkan
  sonradan değişince fire olduğu yerde kalıyor ve ekran tutarsız
  görünüyordu. Etiket artık anında değişiyor ve **kutuyu boşaltmak
  otomatiğe döndürüyor**.

> Otomatik fire hesabı artık **birim eşitliğine** de bağlı. "10 kg ham
> somondan 3 kg somon" işinde giren − çıkan doğru; "10 kg hamurdan 40 adet
> ekmek" işinde `40 adet − 10 kg` diye bir şey yok ve fireyi 30 gibi
> uydurma bir sayıya çekerdi. Birimler tutmuyorsa etiket "elle yazın —
> birimler farklı" diyor, hesap yapılmıyor.

#### 3. Tam sayımda stok durumu süzgeci

Müşterinin sözü: *"tam sayım ekranına full yetki verildiyse filtreleme
sistemi getir."*

Sınıflandırma süzgeçlerinin (KOD1…KOD10) yanına ikinci bir katman kondu:
**Hepsi / Eksi stok / Kalan 0 / Eksi ve sıfır / Stoklu**.

> Bu süzgeç YALNIZCA yöneticide çiziliyor ve `sayim:ekran` yetkisiz istekten
> `stokDurumu` alanını **siliyor**. Sebebi körleme sayım: "eksileri göster"
> diyebilen sayımcı, gizlenen teorik miktarı satır satır geri okurdu.
> Süzgeç kapsamı da genişletemiyor — kapsam (oturumdan) ve süzgeç (arayüzden)
> SQL'de AND'leniyor (sınama var).

#### 4. Neredeyse her ekranda ayrıntılı Excel / PDF

Müşterinin sözü: *"sayım exceli ve çıktısı tam sayım, zayi gibi tanımlama
yapabilmeliyiz; neredeyse her ekranda ayrıntılı bir excel raporu dışarı
aktarabilmeliyiz."*

**Çıktı tanımı.** Dışa aktarma olan her ekranda bir "Çıktı tanımı" kutusu
var (hazır seçenekli, serbest yazılabilir). Yazılan ad hem Excel/PDF'in ilk
satırına hem de **dosya adının başına** giriyor: `Tam-sayim-Sayim-listesi_
2026-08-25_1430.xlsx`. Ekran değişince tanım sıfırlanıyor; aynı ekranda iki
kutu varsa (üretim) biri diğerine yansıyor.

**Yeni çıktı alan ekranlar:** Zayi (fiş listesi + **satır dökümü**), Üretim
(sıfıra çekilecekler + yazılan fişler), Tutanak, Alış faturası, Reçete
listesi, Reçete ağacı (düzleştirilmiş, seviye sütunlu), Satış aktarımı,
Sayım onay kuyruğu, Sayım geçmişi, Sayım farkları, Kullanıcı yetkileri,
Yedek listesi, tek ürünün stok hareketi.

Zayi satır dökümü için yeni uç: `zayi.satirDokumu` / `zayi:satirDokumu` —
ekrandaki tablo fiş başlıklarını gösteriyor, "kim neyi ne kadar zayi etti"
ancak satır düzeyinde çıkıyor.

### 22.08.2026'da yapılanlar

Müşterinin beş isteği karşılandı. Üçü üretimin anlamını değiştiriyor.

#### 1. Üretim artık zayi/fire geçmeden yapılmıyor

Müşterinin sözü: *"zayiatlı üretim dediğimiz mantıkta önce zayi için stok
çıkış fişi yapılması gerekiyor, sonrasında sıfırlanana kadar üret mantığı
olmalı; diğer şekilde o zayiatlı üretim olmuyormuş."*

Üretim ekranında artık iki şerit var, ikisi de ÖNCE zayi fişi keser:

| Kip | Ne zaman | Ne olur |
|---|---|---|
| Zayiatlı | **Mamul** zayi olmuş | Mamulden zayi fişi (33) → stok eksiye düşer → stok SIFIRLANANA KADAR reçeteden üretilir. Miktarı program bulur. |
| Fireli (manuel) | **Hammadde** fire vermiş | Firenin zayi fişi (33) → kalan hammadde tüketilip mamul üretilir. Miktarları kullanıcı yazar. |

> **Zayiatlı kip 25.08.2026'da kaldırıldı** (bkz. yukarıdaki bölüm). Müşteri
> zayi girişini kendi ekranında, sıfıra çekmeyi ayrı bir kipte istedi.
> Buradaki anlatım kararın nasıl geldiğini göstermek için duruyor.

**Otomatik üretim kaldırıldı** (`uretim.adaylar`, `uretim.uret`,
`uretim.hepsiniUret` ve `uretim:adaylar` / `uretim:uret` /
`uretim:hepsiniUret` kanalları). THIRD ekranındaki "Sıfıra kadar üret"
kısayolu da gitti — o kısayol zayi adımını atlıyordu.

#### 2. Fireli üretim: "10 kg ham somondan 3 kg somon"

Müşterinin tarifi: *"ne üretilecekse seçiliyor, misal somon; sonra o neyden
üretilecekse — ham somon — o giriliyor 10 kg olarak; çıkışta 3 kg somon ve
7 kg fire olarak yazılıyor."*

Vega karşılığı iki belge:

```
1. Zayi çıkış fişi (33)  →  ham somon 7 kg, cari FİRE/ZAYİ
2. Üretim fişi           →  ham somon 3 kg tüketim, somon 3 kg çıktı
```

Toplamda 10 kg hammadde stoktan çıkar, 3 kg mamul girer. Sıra bilinçli:
üretim adımı hata verirse fire fişi geri alınır. Tersi sırada üretim yazılıp
fire yazılamasaydı stokta olmayan hammadde tüketilmiş görünürdü.

> **Reçete şartı kalktı.** `yazma.uretimHazirligi` artık `elleBilesenler`
> alıyor; verilirse reçeteye hiç bakılmıyor, tüketim satırlarını kullanıcı
> belirliyor. Reçetesi olmayan mamul de üretilebiliyor — "somon" kartının
> reçetesi yok ve olması da gerekmiyor. Reçete varsa yalnızca pozisyon
> adımları (üretim yeri / mamul deposu) ve KDV oranı ondan okunuyor;
> yoksa varsayılan BAŞLA/BİTİR adımları yazılıyor.

Ürün seçimi için ayrı bir uç açıldı: `uretim:urunAra`. Stok ekranının arama
ucu `stok` yetkisine bağlı ve sayımcıya o yetki verilmiyor; üretim yapan
kişinin stok ekranını açabilmesi gerekmesin diye.

Fire sıfırsa zayi fişi hiç kesilmiyor ve `uretim:fireli` o durumda `zayi`
yetkisi de aramıyor.

#### 3. Gider / hizmet ekranı bar-mutfak dışındaki her şeyi listeliyor

Eskiden yalnızca `STOKTIPI = 3` kartları (16 kart) geliyordu. Artık sınıfı
(`KOD2`) BAR ya da MUTFAK **olmayan** bütün kartlar geliyor (398 kart);
şeritten eski dar listeye dönülebiliyor.

> **Bar ve mutfak korumalı.** Bu ekranın "Sıfırla" düğmesi stoğu tek tuşla
> siliyor. `yazma.giderStokSifirla` kartın sınıfını VEGADB'den kendisi
> okuyup BAR/MUTFAK ise reddediyor — istek DevTools'tan kurcalansa bile
> gerçek mutfak stoğu bu uçtan sıfırlanamıyor. Gider/hizmet kartları
> (STOKTIPI 3) sınıfı ne olursa olsun sıfırlanabiliyor.

#### 4. Tam sayımda sınıflandırma süzgeci, Excel ve PDF

Tam sayım listesi 1.253 kart; müşteri "özel kod" süzgeci istedi. Stok
ekranındaki KOD1…KOD10 süzgeçlerinin aynısı sayım ekranına kondu — kod
`kodSuzgeciOku` / `kodSuzgeciKutulari` / `kodSuzgeciOzeti` içinde ortak,
iki ekran da onu çağırıyor.

Sayım listesi iki ayrı çıktı olarak alınabiliyor, ikisi de ekrandaki
süzgece ve arama kutusuna uyuyor:

| Düğme | Ne verir |
|---|---|
| **Föy: Excel / PDF** | Sayımdan ÖNCE. "Sayılan miktar" sütunu boş; kâğıda basılıp elde doldurulur. |
| **Dolu liste: Excel / PDF** | Sayımdan SONRA. Ekranda yazılı miktarlarla; yöneticide fark sütunu da var. |

Körleme sayım çıktıda da geçerli: `Vega'da görünen` sütunu yalnızca
yöneticinin çıktısında var.

> **Süzgeç kapsamı genişletemez.** Kullanıcının sayabildiği sınıflar
> (kapsam) oturumdan geliyor, süzgeç arayüzden. İkisi SQL'de AND'leniyor;
> kapsamı BAR olan kişi `kod2=MUTFAK` süzgeci istese bile liste boş dönüyor
> (sınama var). `sayim.sayimKaydet` süzgeçleri BİLEREK geçirmiyor: kaydetme
> anındaki denetim listesi süzgeçsiz okunuyor, yani süzgecin üst kümesi —
> kullanıcı süzgeci değiştirse bile kaydettiği satır reddedilmiyor.

#### 5. Yedekleme merkezi

Müşterinin isteği: *"basit bir yedekleme merkezi; işlemden önce yedeği
alacak, işlemden önce ekrana yedek almayı unutmayın diye uyarı çıkacak,
geri de yükleyebilmeli."*

`db/yedek.js` + "Yedekleme merkezi" ekranı. Bilinmesi gereken dört şey:

1. **Yedek dosyası SUNUCUDA oluşur, panelin kurulu olduğu PC'de değil.**
   `BACKUP DATABASE` komutunu SQL Server servisi çalıştırır; verilen klasör
   onun disklerinde aranır ve servis hesabının oraya yazma izni olmalı.
   Klasör Ayarlar ekranından (`yedekKlasoru`); boşsa SQL Server'ın kendi
   varsayılan yedek klasörü kullanılır.

2. **Ayrı bağlantı.** Yedek ve geri yükleme `sql.yonetimHavuzu()` ile
   `master` üzerinde kendi bağlantısını açıp kapatıyor. Normal havuz
   VEGADB'nin *içinde* duruyor ve o havuzla VEGADB geri yüklenemez
   ("veritabanı kullanımda").

3. **Yetki ayrı verilir.** `galya_panel` VEGADB'de salt okunur; yedek için
   `db_backupoperator`, geri yükleme için `dbcreator` gerekiyor.
   `kurulum/sql-yedek-yetkisi-ver.sql` ikisini de içeriyor ama **geri
   yükleme satırı bilerek yorumda**. Yetki yoksa ekran sebebini yazıyor ve
   hiçbir şey yapmıyor.

   > mssql sürücüsü BACKUP hatasında yalnızca son satırı veriyor
   > ("BACKUP DATABASE is terminating abnormally"); asıl sebep
   > ("permission denied in database 'VEGADB'") `e.precedingErrors`
   > dizisinde duruyor. `hataMetni()` ikisini birleştiriyor — birleştirmeden
   > kullanıcı neden başarısız olduğunu hiç öğrenemiyordu.

4. **Uyarı.** `yedek:hatirlatma` son yedeğin yaşına bakıyor; ayarlardaki
   saatten (`yedekUyariSaat`, varsayılan 24) eskiyse ya da hiç yedek yoksa
   Vega'ya yazan ekranların başına kırmızı bir kutu düşüyor
   (`yedekUyarisiCiz`): Üretim, Zayi, Sayım onayı, Alış faturası, Gider.
   Her ekranda sürekli duran bir uyarı bir süre sonra okunmaz oluyor; o
   yüzden yalnızca gerektiğinde çıkıyor.

**Geri yükleme panelin geri dönüşü olmayan tek işi.** Veritabanı yedeğin
alındığı ana döner, aradaki her şey silinir; ayrıca `SINGLE_USER`'a alındığı
için Vega ve Şefim dahil bağlı olan herkes atılır. Korumalar:

- `yedek:geriYukle` **yönetici kanalı** (`YONETICI_KANALLARI`).
- Arayüzde iki kapı: ne olacağını anlatan onay penceresi, sonra veritabanı
  adının elle yazılması.
- `RESTORE HEADERONLY` ile dosyanın gerçekten o veritabanının yedeği olduğu
  doğrulanıyor — yanlış dosya reddediliyor.
- Geri yüklemeden önce otomatik bir **güvenlik yedeği** alınıyor; alınamazsa
  işlem hiç başlamıyor.
- `ALTER DATABASE … SET MULTI_USER` `finally` içinde: hata çıksa bile
  veritabanı tek kullanıcıda bırakılmıyor (bırakılsaydı Vega ve Şefim hiç
  bağlanamazdı).

Veritabanı adı SQL metnine doğrudan giriyor (parametre olamaz), o yüzden
her ad önce beyaz listeye (`vegaVeritabani`, `panelVeritabani`) ve
`sys.databases`'e karşı doğrulanıyor; dosya yolu parametre olarak gidiyor
ve uzantısı `.bak`/`.trn` değilse reddediliyor.

Yedek listesi `msdb.dbo.backupset`'ten geliyor — SSMS ya da bakım planıyla
alınanlar da görünsün diye. msdb okunamazsa panelin kendi
`GALYA_PANEL.dbo.Yedek` tablosuna düşülüyor.

---

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
node kurulum/test-sorgular.js                # 127 okuma sınaması
node kurulum/test-yazma.js --kur             # test veritabanını hazırla/tamamla
node kurulum/test-yazma.js                   # 152 yazma sınaması
node kurulum/test-kolon-denetimi.js          # kolon doluluk denetimi (Vega ile karşılaştırma)
node kurulum/test-uretim-belge-zinciri.js    # 114 üretim tablo zinciri sınaması
node kurulum/test-aktarim.js                 #  23 Şefim mutabakatı + süren gün kilidi (yalnız okur)
node kurulum/test-aktarim-yazma.js           #  62 uçtan uca aktarım + geri alma
node kurulum/test-aktarim-kolon-denetimi.js  # aktarım kolonları
node kurulum/test-geri-yukleme.js            #  16 yedekten geri yükleme (yalnız GALYA_TEST, tek başına)
node kurulum/test-yetki.js                   #  41 kullanıcı / kapsam / onay sınaması
node kurulum/test-yetki-haritasi.js          # her kanal yetki haritasında mı
npx electron kurulum/test-arayuz.js          #  35 arayüz duman sınaması
node izleyici/test-izleyici.js …             #   6 izleyici sınaması
```

> **08.09.2026: yazma sınaması 146/146 geçti** (123'ten çıktı; çok çıktılı
> üretim ve `TBLSHAREKET` sınamaları eklendi). `--kur` iki yeni tablo
> kopyalıyor: `TBLURERECETECIKTI` ve `TBLSHAREKET` — eski bir `GALYA_TEST`
> varsa `--kur` bir kez daha çalıştırılmalı.
>
> **25.08.2026: dördü de geçti** — 120 / 123 / 41 / 35, sıfır hata.
>
> Başlarken hepsi `Login failed for user 'galya_panel'` veriyordu: geliştirme
> sunucusundaki VEGADB restore edilmiş ve `galya_panel` kullanıcısı içeride
> kalmamıştı (giriş sunucuda duruyordu, şifre doğruydu). `sql-yetki-tazele.sql`
> çalıştırılınca düzeldi. Aynı hatayı bir daha görürseniz ilk bakılacak yer
> burası:
>
>     sqlcmd -S localhost -E -C -i kurulum/sql-yetki-tazele.sql

`test-kolon-denetimi.js` ayrı bir işi yapıyor: panelin yazdığı satırı
Vega'nın **kendi** satırlarıyla kolon kolon karşılaştırıyor. Vega bir belgeyi
okurken alanların dolu olmasını bekliyor; NULL bırakılan kolon satırı tabloya
sokar ve stok doğru hareket eder ama Vega'nın ekranı belgeyi açamayabilir.
Ayrıntı `BELGE-DESENI.md` → "Boş bırakılan kolon belgeyi açılmaz yapar".

> Betik GALYA_TEST'in hareket tablolarını her çalıştırmada boşaltıyor
> (kart tabloları duruyor). Sebep: çöken bir çalıştırma yarım belge
> bırakırsa sonraki sınamalar alakasız hatalar veriyor — bir kez oldu.
> Hedef veritabanının adı GALYA_TEST değilse betik hiçbir şey silmiyor.

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

Ayarlar paketli sürümde `%APPDATA%\galya-panel\ayarlar.json` altında durur,
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

> **11.09.2026 — bu makinede iki değişiklik.** VEGADB yeni bir yedekle
> yeniden yüklendi (16:21, `VEGADB_galya` olarak geri yüklenip VEGADB adını
> aldı). GALYA_PANEL ise 16:36'da SSMS'ten sa ile **silindi** (SQL'in
> varsayılan izi); sa ile açılan panel 16:37'de `panel.kur()` ile boşunu
> kurdu. Eski panel verisinin (kullanıcılar, ürün eşleştirmeleri, sayım /
> tutanak / zayi kayıtları) bu makinedeki son yedeği
> `GALYA_PANEL-20260822-123150.bak`, SQL Server'ın varsayılan Backup
> klasöründe. Kullanıcı kurulu paneli sa ile bağlamaya karar verdi;
> `galya_panel`'in VEGADB'deki salt okuma kilidi o kurulumda yok.
>
> 12.09: kullanıcı GALYA_PANEL'i birine göstermek için silmişti; eski yedek
> **yüklenmedi**. Yeni kurulan panelde kullanıcının 11.09 denemeleri var
> (2 zayi, 3 üretim, 1 fatura, 36 işlem kaydı) ve bunlar yeni VEGADB'deki
> belgelere bakıyor. 22.08 yedeği hem bunları silerdi hem de artık olmayan
> Vega belgelerine bağlı kayıtlar getirirdi. Aynı sebeple `galya_panel`
> girişinin yeni GALYA_PANEL'de kullanıcısı yok; `test-ag` bu makinede
> açılmıyor (kod değil, ortam).

---

## 11. Sıradaki işler

0. **Çok çıktılı üretim canlıda DENENMEDİ (08.09.2026).** Kod `GALYA_TEST`
   üzerinde doğrulandı (146 sınama) ve okuma tarafı gerçek VEGADB'de
   sınandı, ama VEGADB'ye tek bir çok çıktılı fiş yazılmadı. İlk denemede:

   - **TEK üründen başlayın** — reçetesi dört çıktılı DANA ANTRIKOT iyi bir
     örnek, çünkü hem yan mamulü hem firesi var.
   - Fişi yazdıktan sonra Vega'nın **Üretim Giriş Fişi** ekranını açın ve
     dört satırın da göründüğünü kontrol edin. Satırların görünmesi
     `TBLSHAREKET` düzeltmesinin çalıştığının kanıtıdır; satırsız
     görünüyorsa yazma yolunda bir şey eksik demektir.
   - Sonra **geri alın** ve `TBLSHAREKET`'te satır kalmadığını doğrulayın.
   - Üretim 96/97 sayacını kullanıyor ve Şefim entegrasyonu aynı sayacı
     günde 250–600 belge hızında ilerletiyor; yoğun saatlerde denemeyin.

   25.08'de geliştirme kopyasında bırakılan iki fişin (`A0000290`,
   `A0000291`) 10 satırı `TBLSHAREKET`'te yoktu. **Müşteri kararı (10.09):
   onarılmayacak** — `oksuz-shareket-onar.sql` hazır ama çalıştırılmıyor
   (madde 10). 11.09'da VEGADB yeni bir yedekten yeniden yüklendiği için bu
   not artık eski kopyaya ait.

1. **CEVAPLANDI (10.09.2026): panel dokunmaz.** Müşteri isterse verimleri
   Vega tarafında kendisi değiştirecek; panel Vega'daki verimi okumaya devam
   ediyor. Eski not:
   **Reçete verimleri.** 433 reçetenin 430'unda verim (`TBLURERECETELIST.
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
5. **Fireli ve sıfıra kadar üretim canlıda denendi (25.08.2026).** F0102 /
   D0002 üzerinde, geliştirme sunucusundaki kopyada:

   - Sıfıra kadar: `SUSHİ SİRKESİ 1,5 LT` (−0,0083) → fiş A0000290, doğan
     belgeler 38+38+97+96, 5 tüketim + 1 çıktı hareketi, stok sıfıra oturdu,
     geri alındı ve stok −0,0083'e döndü.
   - Fireli: **10 kg HAM SOMON → 3 kg SOMON + 7 kg fire** (müşterinin kendi
     örneği). Zayi fişi A0000477 (tip 33, cari FİRE, `OZELKOD4 = FİRE`,
     fiyatsız olduğu için cari borcu 0), ardından üretim fişi. Ham somon
     −10, somon +3. İkisi de geri alındı, stoklar başlangıca döndü.
   - Toplu: iki ürün tek düğmede, ikisi de yazıldı ve geri alındı.

   VEGADB'de kalıntı belge yok. Panel geçmişinde `canli-deneme` kullanıcı
   adıyla 5 kayıt duruyor, hepsi "geri alındı" işaretli.

   **Yine de canlı müşteri sunucusunda dikkat:** üretim 96/97 sayacını
   kullanıyor, Şefim entegrasyonu günde 250–600 belge hızında ilerletiyor;
   yoğun saatlerde toplu üretimden kaçının. İlk gerçek kullanımda TEK ürünle
   başlayın — "Seçilenleri sıfıra çek" liste uzunsa onlarca fiş keser.

   Fireli üretimde müşteriyle teyit edilecek iki nokta duruyor:
   - Fire hangi cariye yazılacak? Panel `FİRE` kartını, yoksa `ZAYİ`
     kartını varsayılan seçiyor; muhasebenin beklediği bu mu?
   - Fire fişi varsayılan olarak **fiyatsız** (cari borcu 0). Zayi fişinde
     olduğu gibi burada da "maliyetle yaz" kutusu var; hangisinin
     kullanılacağı muhasebeyle netleşmeli.
6. **Geri yükleme GALYA_TEST'te sınandı (11.09.2026) — bir kusur çıktı,
   düzeltildi.** `kurulum/test-geri-yukleme.js` panelin kendi koduyla tam
   yedekten dönüşü, işlem öncesi yedekten (temel + diferansiyel) zincirli
   dönüşü ve üç kapıyı (uzantı, beyaz liste, başka veritabanının yedeği)
   sınıyor: 16/16.

   Kusur: geri yükleme öncesi güvenlik yedeği, geri yüklenecek yedekle aynı
   saniyeye düşerse **aynı dosya adını** alıyordu (damga saniyelik, `INIT`
   aynı adlı dosyanın üstüne yazar). Güvenlik yedeği seçilen yedeği eziyor,
   geri yükleme "tamamlandı" deyip o anki hâli yüklüyordu. Güvenlik yedeği
   artık `…-guvenlik-<damga>.bak` adıyla ayrı dosyaya gidiyor.

   Hâlâ karar bekleyen: geri yükleme yetkisi (`sql-yedek-yetkisi-ver.sql`
   içindeki `dbcreator` satırı) bilerek yorumda. Müşteri geri yüklemeyi
   panelden mi yapmak istiyor, yoksa gerektiği gün SSMS'ten bir yönetici mi
   yapsın? Canlı bir veritabanında geri yükleme hâlâ hiç yapılmadı.
7. **Yedek klasörü kurulumda ayarlanmalı.** Şu an boş, yani SQL Server'ın
   varsayılan klasörü kullanılıyor (`C:\Program Files\Microsoft SQL
   Server\…\Backup`). Sistem diskinde yedek tutmak ilk disk dolduğunda
   hem yedeği hem veritabanını birden kaybettirir; ayrı bir diske
   (`D:\SQLYedek` gibi) alınmalı. Klasör SUNUCUDA olmalı ve SQL Server
   servis hesabı oraya yazabilmeli.
8. **Eski yedekleri kim silecek?** İşlem öncesi yedekler döngüsel (iki
   temel + `yedekIslemSayisi` yuva, üstüne yazılıyor); onlar büyümüyor.
   Elle alınan yedekler ve geri yükleme öncesi güvenlik yedekleri ise her
   seferinde yeni dosya — VEGADB'nin tam yedeği ~2,2 GB. Temizlik
   yapılmıyor; bilerek — dosya silmek geri dönüşü olmayan bir iş ve
   sunucudaki bakım planının işi. Müşteriye söylenmeli.
9. **CEVAPLANDI (10.09.2026): tam sayımda girilmeyen ürüne dokunulmaz.**
   Müşteri: tam sayım parça parça yapılıyor — bugün bar biter, yarın mutfak
   sayılır. Girilmeyen ürünün stoğu sıfıra çekilseydi henüz sayılmamış
   bölüm silinmiş olurdu. Bugünkü davranış (miktar yazılmayan satır sayıma
   hiç girmez, stok değişmez) doğru; değiştirilmeyecek.
10. **CEVAPLANDI (10.09.2026): kendini tüketen reçeteler bilinçli.**
   Kullanıcılar her reçeteyi kendileri sıfırdan kuruyor; `Tequila.Olmeca
   Blanco` gibi kartlarda mamulün kendisinin bileşen olması doğru. Maliyet
   motoru o satırı döngü sayıp atlıyordu; artık denklemle çözüyor
   (`db/maliyet.js` → `maliyetHesapla`): c = pay × diğerleri / (verim −
   pay × kendi). Yalnız kendisinden oluşan reçetede alış fiyatı geçerli.
   Onarım betiği (25.08'in iki fişi) de müşteri kararıyla ÇALIŞTIRILMAYACAK.

11. **CEVAPLANDI (10.09.2026): sayımcıya `stok` yetkisi verilmez.**
   Akış: sayımcı telefondan (ağ erişimi, §14) girer, föyü Excel doldurur
   gibi doldurur, Vega'daki miktarı görmez (körleme). Kaydedilen sayım
   yöneticiye düşer; yönetici inceler, onaylayınca Vega'ya sayım giriş /
   çıkış fişi (93/94) olarak yazılır. Bu akış kodda zaten vardı (§5b).
   Telefon için `ui/index.html`'e viewport satırı ve `ui/app.css` sonuna
   700px altı düzen eklendi — önceden telefon masaüstü sayfasını küçültüp
   çiziyordu, miktar kutuları parmakla tutulamıyordu.

---

## 11b. Uzaktan erişim (mobil / web) — 18.08.2026 kararı

> **09.09.2026: bu karar değişti, ağdan erişim YAPILDI.** Aşağısı o günkü
> araştırma; hâlâ geçerli olan kısmı "yorucu olan kod değil, şunlar"
> bölümüdür. Ne yapıldığı **§14**'te. Kısaca: tam web paneli değil, aynı
> arayüz aynı kanallar üzerinden HTTP'ye açıldı; tünel/TLS yapılmadı, yalnız
> yerel ağ.

**Karar (18.08.2026): yapılmadı, masaüstü programıyla devam.** Müşteri kullanmaya
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

### DÜZELTME (09.09.2026): aktarım kopuk DEĞİL

Bu bölümde uzun süre şu yazdı: *"12.06.2026'dan beri biriken 20.451 satış
Vega'ya hiç geçmemiş."* **Yanlıştı.** Ölçüm `Bill.Aktarildi` alanına
bakıyordu; o alan `bit` tipinde ve **141.984 satırın hepsinde 1**. Farklı
olan `AktarimDurumu` kolonuydu: 12.06.2026'da bir Şefim sürümüyle gelmiş,
0 varsayılanıyla duruyor ve entegrasyon programı onu hiç doldurmuyor.

Vega tarafı doğruluyor: `F0102/D0002` içinde **184 gün için** ŞEFSATIŞ stok
çıkış belgesi var. Dönem içinde eksik olan yalnız 4 gün:
`20.01`, `22.04`, `02.06`, `29.07`.

**11.09.2026: taşındı.** Eski `sefim.aktarimDurumu()` `Aktarildi`'ye
bakıyordu ve her zaman 0 diyordu; silindi. Ana ekrandaki kutu ("Vega'ya
aktarılmamış satış günü") ve Satış aktarımı ekranının cümlesi artık
`db/aktarim.js` → `eksikOzeti()` kullanıyor: `gunler()` ile Şefim satış
günü ↔ Vega belgesi karşılaştırması; süren gün ve dönem dışı günler
sayılmaz. Kutu Günlük aktarım ekranını açıyor. Şefim satış carisi olmayan
firmada kutu hiç çizilmiyor. F0102/D0002'de 4 gün çıkıyor (20.01, 22.04,
02.06, 29.07). Kanal adı eskisi gibi `satis:aktarimDurumu`.

### Ürün eşleşmesi

326 üründe 321'i otomatik eşleşiyor. Sorun isim eşleşmesi değil; birkaç ürün
firma tarafından bilerek BAŞKA bir karta bağlanmış (birkaç bira
`BAŞLANGIÇ İKRAM`a, `Karpuz Tabağı` `FİX 7 YAŞ ALTI`na). Panel bu eşleşmeyi
Vega'nın geçmiş belgelerinden öğreniyor — bkz. `BELGE-DESENI.md` → "Ürün →
stok kartı eşleşmesi".

> Daha önceki devir notunda "eşleşme 324'te 1" yazıyordu. O ölçüm, VEGADB
> geçici olarak ÖZDEMİRKAYA verisi tutarken alınmıştı.

---

## 13. Şefim günlük aktarımı — panele taşındı (09.09.2026)

Müşteri her sabah Vega'nın kendi **"Şefim Entegrasyon"** programını
çalıştırıp dünkü satışı Vega'ya aktarıyor, hemen ardından eksiye düşen
mamulleri üretiyordu. İkisi de panele girdi.

**Kullanıcı kararı:** panel aktarımı KENDİSİ yapacak (Vega'nın programını
açmak değil). Belge deseninin tamamı `kurulum/BELGE-DESENI.md` → "Şefim
günlük satış aktarımı" bölümünde; yazma koduna dokunmadan önce orası
okunmalı.

### Dosyalar

```
db/aktarim.js                          okuma, mutabakat, önizleme, aktar, geri al
db/yazma.js  -> sefimAktarimYaz()      belgeleri yazan kısım
ui/app.js    -> ekranlar.gunlukAktarim ekran
GALYA_PANEL.dbo.SefimAktarim           hangi gün kim aktardı, hangi belgeler
```

### Doğrulama durumu

| Ne | Nasıl | Sonuç |
|---|---|---|
| Mutabakat | `test-aktarim.js` — Vega'nın 11.08 belgesiyle karşılaştırma | **kuruşu kuruşuna** (142.910,21 = 142.910,21), 104 satırın 103'ü birebir |
| Kolon doluluğu | `test-aktarim-kolon-denetimi.js` | 268 zorunlu kolon, **0 eksik** |
| Uçtan uca yazma | `test-aktarim-yazma.js` — GALYA_TEST'e gerçek aktarım + geri alma | **30/30**, 7 belge, geri almada 0 kalıntı |

**Canlı VEGADB'ye henüz tek aktarım yazılmadı.** İlk gerçek kullanımda:

- Önce **eski ve küçük bir gün** seçin (eksik günlerden `20.01` gibi).
- Yazdıktan sonra Vega'nın **Stok Çıkış Fişi** ve **Cari Ekstre** ekranlarını
  açıp belgenin göründüğünü kontrol edin.
- Sonra **geri alın** ve stoğun döndüğünü doğrulayın.
- Aktarım 33/13/11 belge tiplerini kullanıyor; üretim 96/97 sayacına
  dokunmuyor, yani yoğun saat kısıtı yok.

### Bilinmesi gerekenler

1. **`sefim` veritabanında UPDATE yetkisi gerekiyor.** Panel yazdığı satırları
   `Bill.Aktarildi = 1` diye işaretliyor. Yetki yoksa işaretleme atlanıyor ve
   ekranda uyarı çıkıyor — o gün Vega'nın kendi programı çalıştırılırsa satış
   stoktan **iki kez** düşer. `kurulum/sql-yazma-yetkisi-ver.sql` içinde.
2. **Aynı gün iki kez aktarılamıyor**; üç kapı var (panel kaydı, Vega
   tarafındaki belge, rezervasyon kilidi). Ayrıntı BELGE-DESENI'nde.
3. **Dönem dışı günler aktarılamıyor.** Şefim'in satış geçmişi (341 gün) Vega
   dönemininkinden (184 gün) uzun; eski günler `kapsamDisi` diye işaretlenip
   düğmesiz gösteriliyor.
4. **Mutabakat tutmuyorsa aktarım engelleniyor.** Eşleşmeyen ya da "yoksay"
   işaretli ürün belgeye girmiyor; fark kuruş mertebesini aşarsa yazma
   reddediliyor.
5. **Süren iş günü aktarılamıyor (11.09.2026).** İş günü ertesi gün
   `sefimGunKesimSaati`'ne (04:00) kadar sürüyor. Önceden bugünün günü de
   "eksik" görünüp "İncele ve aktar" düğmesi alıyordu; öğlen aktarılsaydı
   günün kalan satışı bir daha aktarılamazdı (aynı gün iki kez
   aktarılmıyor). Artık `gunler()` o günü `suruyor` diye işaretliyor,
   önizleme engelleyici uyarı veriyor, `aktar()` `GUN_SURUYOR` ile
   reddediyor — `zorla` ile de. Gün sınırı sunucu saatiyle
   (`suankiIsGunu()`).

### Aktarımdan sonraki üretim (10.09.2026)

Günlük aktarım açıldığında panel artık üretimi üç ayrı listede gösterir:

- **Eksiği kapatılacaklar:** yalnız tek çıktılı reçeteler; tek tek veya toplu
  sıfıra kadar üretilebilir.
- **İş emri gerekenler:** çok çıktılı reçeteler; "İş emri aç" mamulü seçer,
  reçete girdi/çıktılarını doldurur ve eksiği ana mamul miktarı olarak önerir.
- **Bugün de yapılacak mı?:** son 30 günde en sık yapılan üretimlerdir. Bu
  liste kendiliğinden fiş yazmaz, yalnız iş emrini hazır açar.

Aktarım ekranından açılan her üretim `SefimAktarimUretim` tablosuyla o günün
`SefimAktarim` kaydına bağlanır. Bağ ve `UretimFisi` geçmişi, Vega üretim
zinciriyle aynı SQL transaction'ında yazılır. Üretim geri alındığında bağ da
silinir. Fireli üretimde doğan zayi fişinin kimliği bağda tutulur ve üretimle
birlikte geri alınır.

**Geri alma sırası zorunludur:** önce o güne bağlı üretim fişleri, sonra
Şefim aktarımı. Bağlı üretim varken aktarım geri alma işlemi
`ONCE_URETIM_GERI_AL` ile reddedilir. Bu kilit ve üretim bağı aynı aktarım
satırında `UPDLOCK, HOLDLOCK` altında tutulduğu için iki istemcinin araya
girip bağlantısız fiş bırakması engellenir.

Çok çıktılı reçeteler `sıfıra kadar üret` ve `hepsini sıfırla` yollarından
çıkarıldı. Çıktı miktarları açıkça gönderilmeden doğrudan üretim yazma yolu da
`IS_EMRI_GEREKLI` ile durur. Yazma kilidi kapalıysa aktarım ekranındaki bütün
üretim düğmeleri pasiftir.

#### Codex teslimi denetlendi (10.09.2026) — iki düzeltme

1. **96/97 EVRAKNO ve depo transferi (38) BELGENO'su yeniden `Z` serisinde.**
   Codex bunları panelin `GP` serisine çevirmiş, raporda da söylememişti.
   Bu, §6 "Belge serisi A'dan GP'ye" bölümündeki karara aykırıydı: F0102'de
   154.187 adet 96/97 satırının ve 415 transfer fişinin **hepsi** `Z`. `GP`
   yalnız üretim fişinin kendi `FISNO`'sunda kalıyor. Sabit
   `VEGA_OTOMATIK_SERI` (`db/yazma.js`); belge zinciri sınaması artık `Z`
   bekliyor.
2. **BAŞLA / BİTİR adımı `KOD` ile bulunuyor, `SIRANO` ile değil.**
   `db/uretim-depo.js` → `adimBul()`. F0102'de 3 adımlı üç reçete var:
   4481 KUZU KULAĞI MİX ve 4529 Sushi Tavuk Salata'da BİTİR **3.** sırada,
   1153 Rakı.Beylerbeyi'nde 3. sırada deposu boş ikinci bir BAŞLA duruyor.
   `sira === 2` kuralı 4481/4529'da BİTİR deposunu görmüyor, mamulü seçilen
   depoya yazıyordu. Pozisyon satırının `MALIYET`'i de BİTİR adımına KOD ile
   yazılıyor; ekran depoları arka ucun seçtiğinden gösteriyor.
   Sınama: `test-sorgular.js` → "Pozisyon depoları KOD ile seçiliyor".

**Referans fiş notu:** görev notundaki IND 1410 (üretim) ve 1535/1536
(transfer) **müşterinin makinesindeki** (DESKTOP-OR7N4UE) VEGADB'de. Bu
makinedeki kopya 25.08.2026'da bitiyor (son üretim IND 1402). Sınamanın
aynı reçetenin gerçek fişi IND 1384'ü kullanması doğru.

Ayrıca `main.js` 4758791 sürümünde tanımsız `agErisiminiAc()` çağırıyordu
(fonksiyonun adı `agErisimiAc`); Codex düzeltti.

---

## 14. Zorunlu giriş ve ağdan erişim (09.09.2026)

### Zorunlu giriş

Program açılırken **tam ekran PIN ekranı** geliyor. Öncesinde hiçbir ekran
çizilmiyor ve hiçbir veri okunmuyor (eskiden ana ekran açılıyor, giriş yalnız
işlem yaparken isteniyordu).

Hiç kullanıcı tanımlı değilse giriş ekranı yine çıkıyor ama "kullanıcı
tanımlamadan devam et" geçişi veriyor — aksi hâlde yeni kurulum hiç
açılamazdı. **Ağdan bağlanan için bu geçiş yok.**

### Ağdan erişim

```
Ayarlar -> Ağdan erişim -> "Ağ erişimini aç"
http://192.168.1.50:51234
```

`db/sunucu.js`, Node'un kendi `http` modülüyle; dış bağımlılık yok. Aynı
arayüz, aynı kanallar, aynı yetki süzgeci.

**En pahalı kısım oturum ayrımıydı.** `db/oturum.js` oturumu modül seviyesinde
TEK bir nesnede tutuyordu; ağda iki kişi bağlanınca ikisi aynı oturumu
paylaşır, biri giriş yapınca diğeri de onun yetkilerini alırdı. Oturumlar
artık **jetonla** ayrılıyor (`yerel` = Electron penceresi, jeton = her
tarayıcı). `kurulum/test-ag.js` bunu sınıyor.

`main.js` içindeki `kayitEt` bir `KANALLAR` haritasına ayrıldı;
`calistirKanal(kanal, girdi, jeton)` hem IPC hem HTTP tarafından çağrılıyor.
Yetki denetimi tek yerde kaldı.

**Güvenlik sınırı — okunmadan açılmamalı:**

1. Trafik **şifresiz** (düz HTTP). PIN ağ üzerinden açık geçer. Yalnız
   güvenilen yerel ağda açın; **internete port yönlendirmesi yapmayın.**
2. Aktif bir **yönetici kullanıcı yoksa sunucu hiç açılmıyor**. Panel,
   kullanıcı tanımlı olmayan kurulumda herkesi yönetici sayıyor; ağ için bu
   felaket olurdu.
3. Makineye bağlı kanallar ağdan reddediliyor: yazdırma, klasör açma, Vega
   programını başlatma, güncelleme, onay kutusu. Tarayıcı onay kutusunu
   sayfa içinde çiziyor.
4. Oturum çerezi `HttpOnly` + `SameSite=Strict`. 12 saat dokunulmayan ağ
   oturumu düşüyor.

`ayarlar.json`: `agErisimiAktif`, `agPort` (51234), `agAdresi` (`0.0.0.0`).

> **09.09.2026 — sıradaki iş listesi Codex'e devredildi.** Ayrıntılı yönerge:
> `kurulum/CODEX-GOREV-09-09-2026.md` (pozisyon/depo-şube denetimi, pasif stoklar,
> reçeteli görünme, belge zinciri sınaması, aktarım sonrası manuel üretim).

---

## 15. 11.09.2026 — yarım kalanların kapatılması

1.9.2'nin üstüne; 1.9.3'e girdi (12.09.2026).

| Ne | Nerede | Ayrıntı |
|---|---|---|
| Ana ekran aktarım kutusu gerçek eksiği gösteriyor | `db/aktarim.js` → `eksikOzeti`, `db/ozet.js` | §12 |
| Süren iş günü aktarılamıyor | `db/aktarim.js` → `gunler`, `onizleme`, `aktar` | §13 madde 5 |
| Geri yükleme sınandı; güvenlik yedeğinin ad çakışması düzeltildi | `db/yedek.js`, `kurulum/test-geri-yukleme.js` | §11 madde 6 |
| Ayar dosyasının gerçek yolu yazıldı | `%APPDATA%\galya-panel\ayarlar.json` | aşağıda |

Sınamalar: sorgular 127/0, aktarım 23/0, aktarım yazma 62/0, geri yükleme
16/0, yetki haritası temiz, arayüz 35/0. Yazma yoluna (`db/yazma.js`)
dokunulmadı. `test-geri-yukleme.js` GALYA_TEST'e bağlı her bağlantıyı
düşürür (`SINGLE_USER`); başka bir sınamayla aynı anda çalıştırmayın.

**Ayar dosyası `%APPDATA%\galya-panel\` altında**, bu notun eski hâlinde
yazdığı gibi "Galya Panel" altında değil: Electron klasör adını
`package.json`'daki `name`'den alıyor. "Login failed for user
'galya_panel'" iki ayrı sebepten çıkıyor, SQL günlüğü hangisi olduğunu
söylüyor:

    sqlcmd -S localhost -E -C -Q "EXEC xp_readerrorlog 0,1,N'Login failed'"

`Password did not match` → ayar dosyasındaki şifre yanlış (11.09'da bu
oldu). `Failed to open the explicitly specified database` → veritabanında
öksüz kullanıcı, `sql-yetki-tazele.sql`.

### Canlıda ilk deneme sırası (müşteride — hepsi bekliyor)

Kodu bitmiş ama müşterinin veritabanında hiç çalıştırılmamış işler. Her
birinde: önce yedek, tek kalem, Vega ekranında gözle kontrol, geri al,
stoğun döndüğünü doğrula.

1. **Şefim günlük aktarımı** — eski ve küçük bir eksik günle (20.01).
   Vega: Stok Çıkış Fişi + Cari Ekstre. Önce `sefim` UPDATE yetkisi
   (`sql-yazma-yetkisi-ver.sql`); yoksa Vega'nın programı aynı günü ikinci
   kez aktarabilir. (§13)
2. **Aktarım sonrası üretim** — aktarılan günün "Eksiği kapatılacaklar"
   listesinden tek ürün. Geri alma sırası: önce üretim, sonra aktarım.
   (§13)
3. **Çok çıktılı üretim / İş emri** — DANA ANTRIKOT. Vega: Üretim Giriş
   Fişi'nde 4 satır, Depo Hareket Fişi'nde iki transfer. Yoğun saatte
   değil. (§11 madde 0)
4. **Zayi fişi** — tek kalem. Vega: Stok Çıkış Fişi + ZAYİ carisinin
   ekstresi. (§11 madde 4)
5. **Alış faturası** — tek fatura; cari ekstresine düştüğü görülmeli.
   (§11 madde 3)

### Müşteriye sorulacaklar

- Geri yükleme panelden mi, SSMS'ten mi? (`dbcreator` satırı yorumda)
- Yedek klasörü sistem diski yerine ayrı bir diskte olmalı (§11 madde 7);
  eski yedekleri kim silecek (§11 madde 8)?
- Fire hangi cariye (FİRE / ZAYİ)? Fire fişi fiyatsız mı, maliyetle mi?
  (§11 madde 5)
- Müşteri kurulumunda `vegayaYazmaAktif` açık mı başlasın? (§5)
- Gerçek veritabanı sınırı (ayrı `galya_sayimci` SQL girişi) isteniyor mu?
  (§5b)

---

## 16. 12.09.2026 — ortak numara, zayi belgesi, zayiden üretim, fatura tutarı

Müşterinin 11.09 isteği; §15'in üstüne, 1.9.3'e girdi (12.09.2026).

| Ne | Nerede |
|---|---|
| Panelin bütün belgeleri tek numara dizisi (GP) | `db/yazma.js` → `panelBelgeNo`, `GALYA_PANEL.dbo.BelgeSayac` |
| Zayi belgesi (imza için PDF / yazdır) | `db/disaaktar.js` → `zayiBelgeHtml`, `db/rapor.js`, `zayi.belgeVerisi` |
| Üretim → "Zayi belgesine göre" | `db/uretim.js` → `zayiListesi` / `zayiUretimi` / `zayidenUret`, `GALYA_PANEL.dbo.ZayiUretim` |
| Alış faturasında tutar yazınca birim fiyat | `ui/app.js` → `alisFaturaPenceresi` |
| Şefim yalnız kendi firmasına | `db/aktarim.js` → `sefimFirmasi`, ayar `sefimFirmasi` |

**Belge numarası.** Ayrıntı BELGE-DESENI → "Belge numarası: panelin kendi
serisi olmalı". Sayaç tablo başınaydı: sayım fişi de stok fişi de
`GP0000001` alıyordu, geri alınan belgenin numarası yeniden veriliyordu.
Z serisi (depo transferi 38, üretim 96/97) Vega'nın ortak sayacı olarak
`siradakiBelgeNo`'da kaldı.

**Zayiden üretim.** Zayi ekranından Vega'ya yazılmış fişin ürünleri, zayi
edilen miktar kadar reçetesinden üretilir. Bir fişteki bir ürün bir kez
üretilir (`ZayiUretim`; kilit `yazma.zayiUretimKilidi`). Üretimi olan zayi
fişi Vega'dan geri alınmaz (`ONCE_URETIM_GERI_AL`), önce üretim geri
alınır; üretim geri alınınca bağ silinir. Reçetesiz ya da çok çıktılı ürün
Manuel üretim (İş Emri) kipinde açılır, oradan yazılan üretim de `zayiId`
ile aynı fişe bağlanır. Şeritten başka kipe geçince `zayiId` taşınmaz.

**Zayi belgesi.** Tutanakla aynı iskelet (ortak `BELGE_TEMEL_CSS`,
`imzaHucreleriHtml`, `vegaRozetiHtml`); imzalar Zayi Eden / Düzenleyen /
Onaylayan. Maliyetli zayide birim maliyet, tutar ve toplam da basılır.
Tutanak ve zayi belge kanalları ağdan çağrılamaz (`sunucu.js` →
`SUNUCU_DISI_KANALLAR`): kayıt yeri sunucunun ekranında açılır, çıktı
sunucunun yazıcısından çıkardı.

**Fatura tutarı.** İskontolu alımda birim fiyat bilinmiyor, toplam
biliniyor. Satırda ve ekleme formunda Tutar yazılınca miktar (kilo) aynı
kalır, birim fiyat = tutar ÷ miktar (6 hane; `BirimFiyat DECIMAL(18,6)`).
Son yazılan tutarsa miktar düzeltilince tutar korunur, fiyat yeniden
hesaplanır; son yazılan fiyatsa tutar yeniden hesaplanır.

**Şefim firması.** Şefim, Galya'nın F0102'sine (GALYA YENİ) ait: `sefim`
günlük tutarları F0102'nin ŞEFSATIŞ fişleriyle kuruşu kuruşuna tutuyor,
F0103'ünkiler (GALYA KEBAP) tutmuyor. F0101 ve F0103'te de ŞEFSATIŞ carisi
olduğu için ana ekran oralarda da yüzlerce "eksik gün" gösteriyordu. Ayar
`sefimFirmasi` (yalnız `ayarlar.json`; boşsa `varsayilanFirma`, müşteride
F0102). Başka firmada gün listesi ve aktarım `SEFIM_FIRMASI_DEGIL` ile
reddedilir, ana ekran kutusu çıkmaz. Geri alma açık kaldı.

Sınamalar: yazma 166/0 (yeni: ortak numara 4, zayiden üretim 11), sorgular
128/0, belge zinciri 114/0, aktarım yazma 62/0, aktarım 23/0, yetki 42/0,
yetki haritası temiz, geri yükleme 16/0, arayüz 35/0, kolon denetimleri
temiz. `test-yazma` artık başta `panel.kur()` çağırıyor; yeni panel
tabloları GALYA_TEST'te de kuruluyor. `test-ag` bu makinede açılmıyor
(§10, ortam).

**Canlı deneme sırasına eklenecekler (§15'in devamı):**

6. **Zayi belgesi** — zayi fişi → Belge → PDF'i açıp imza alanlarına bak.
7. **Zayiden üretim** — aynı fiş → Üretim → Zayi belgesine göre → tek ürün
   → Vega Üretim Giriş Fişi → geri al; sonra zayi fişinin geri
   alınabildiğini gör.
8. **Fatura tutarı** — satıra toplamı yazıp birim fiyatın hesaplandığını,
   Vega'daki faturada ve cari ekstresinde tutarın aynen durduğunu gör.
9. **Belge numarası** — iki farklı belge kes; numaraların art arda
   geldiğini gör.

**Yeni Şefim denemesi (12.09).** Kullanıcı aktarılmamış Şefim yedeğini
`sefim` üstüne yükledi (11:35:59, SSMS) ve kurulu 1.9.2 ile denedi. Üç ayrı
şey çıktı:

- *"Aktar tuşu bir şey yapmıyor."* 1.9.2'nin MUTABAKAT denetimi satır
  toplamını tahsilatla karşılaştırıp farkı "kayıp satır" sayıyordu; fark
  çoğunlukla ödenmiş adisyonlardaki indirimdi. 1.9.2 kodu gerçek veride
  yeniden koşuldu: 32 eksik günün 18'inde "Vega'ya aktar" kapalı. Vega'nın
  kendi Şefim fişleri (11.08, 07.08) TUTAR'ı tam satır toplamıyla yazıyor,
  indirimi düşmüyor; ŞEFSATIŞ borcu da o. Düzeltme `aktarim.onizleme`:
  belge tutarı = tahsilat + ödenmiş indirim (`tahsilat().odenenIndirim`),
  yuvarlama yalnız kuruş; engel yalnız belgeye girmeyen satır (eşleşmeyen +
  yoksayılan > eşik); ödeme başka güne kaymışsa `ODEME_FARKI` yalnız uyarı
  (stok satıra göre düşer, tahsilat ödeme gününe yazılır). Salt okuma SQL
  tahmini: 30/32 gün açık; 13.08 (YENİÜRÜN.SİGARA 300 TL) ve 11.09
  (Liqueur.Martini bianco 75cl 3.750 TL, SİGARA 140 TL) ürünler bağlanana
  kadar kapalı. Ödemesi kayan günler: 16.08, 28.08→29.08, 02.09→04.09
  (3.550 TL).
- *Ekranın "Yükleniyor…"da kalması.* Videodaki ekran günlük aktarım değil,
  1.9.2 ana ekranındaki "Vega'ya işlenmemiş satış" kutusunun açtığı eski
  Satış aktarımı ekranıydı (kutu 1.9.3'te günlük aktarıma gidiyor).
  Restore'dan 50 sn sonraydı; `sefim`'de AUTO_CLOSE açık olduğu için 8
  saniyede 12 kez yeniden açıldı (errorlog "Starting up database 'sefim'").
  Aynı ekranlar şimdi 0,5 sn altında açılıyor. AUTO_CLOSE yedekle geliyor:
  yedekler müşteriden geldiğine göre müşterinin `sefim` ve VEGADB'sinde de
  açık, orada bir kez kapatılmalı. `sql-yetki-tazele.sql` artık onu da
  kapatıyor.
- *SefimWebServis.* Vega'nın Şefim web servisi (mobil uygulama, kiosk,
  online sipariş; `C:\Program Files (x86)\Vega\Sefim\sefimWebApp`)
  `appsettings.json`'daki eski sa şifresiyle dakikada bir bağlanmaya
  çalışıyor (`Login failed for user 'sa'. Reason: Password did not match`;
  servis günlüğü `C:\Windows\System32\Logs\log-*.txt`, en az 01.09'dan beri
  günde binlerce 18456). Panelle ve aktarımla ilgisi yok. Şifre dosyada
  elle güncellenip servis yeniden başlatılmalı.

- *"İncele ve aktar bir şey tetiklemiyor."* Tetikliyordu (12:52'de 13
  önizleme koştu, her biri 0,1 sn altında), ama 1.9.2 günün dökümünü ve
  "Vega'ya aktar" düğmesini 60 satırlık gün listesinin EN ALTINA
  ekliyordu; ekran baştan çizilince sayfa başta kalıyor, kullanıcı aynı
  listeyi görüyordu. Artık döküm listenin üstünde, seçilen gün listede mavi
  çerçeveli (`ekranlar.gunlukAktarim`, `.aktarim-gun.secili`).
  `test-arayuz` bunu denetliyor: döküm üstte, kaydırmadan görünüyor, düğme
  listenin üstünde. 1.9.2'de geçici çözüm: tıkladıktan sonra en alta
  kaydırmak.

Sınamalar (yeni Şefim, `sql-yetki-tazele.sql` sonrası): aktarım yazma 61/0,
yazma 166/0, sorgular 128/0, arayüz 40/0. `test-aktarim` 07.08'de (indirimli
gün, Vega A0000460) belge tutarı Vega ile aynı (147.470,34 / 147.470,47,
indirim 3.620); tek hata "çağla tarhan" veresiyesinin Vega'da olmaması
(veri). Varsayılan gün 11.08 bu veride tutmuyor (19/4): 747867 numaralı
adisyon 11.08 22:23'te açılıp 16.08'de ödenmiş (1.795 TL); Vega'nın 11.08
fişi onu içeremezdi, 14.08 kopyasında adisyon henüz açıktı. **Açık soru:**
geç kapanan adisyonun satırları aktarılmış güne düşüyor; 16.08'de yalnız
ödeme uyarısı çıkar, o mal stoktan düşmez.

**29.07 başka firmaya aktarılmış.** Panel 29.07'yi en eski eksik gün
gösteriyor. F0102/D0002'de o gün Şefim fişi yok (A0000443 28.07, A0000445
30.07); aynı gün F0103/D0001'de (GALYA KEBAP) A0000508 + A0000509 =
143.525,05 TL var, Şefim'in 29.07 toplamı 143.470,09 TL. F0103'ün öteki
günleri Şefim'le hiç tutmuyor (kebapçının kendi satışı), F0102'ninkiler
kuruşuna tutuyor: Vega'nın Şefim programı o gün yanlış firmada
çalıştırılmış. 29.07'yi panelden F0102'ye aktarmak doğru; F0103'teki iki
fiş Vega'da silinmeli, kebapçının kendi 29.07 satışı F0103'e ayrıca
aktarılmalı (müşteri kararı). Başka firmada aynı tarihte Şefim fişi olması
tek başına ölçüt değil (F0103'te her gün var), o yüzden panele denetim
eklenmedi.
