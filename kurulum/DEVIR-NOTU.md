# Devir notu — Galya Panel

Bu dosya, projeyi devralan kişinin (veya yeni bir sohbetin) sıfırdan bağlam
kurmadan devam edebilmesi için yazıldı. Kod okunarak veya git geçmişine
bakılarak öğrenilemeyecek şeyleri anlatır.

Son güncelleme: 17.08.2026 · Sürüm 1.3.0

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
    sayim.js         Ara sayım
    maliyet.js       Maliyet hesabı (son alış fiyatı + reçete)
    fatura.js        Alış faturası taslağı (panel veritabanında)
    uretim.js        "Stoğu sıfıra kadar üret" iş akışı
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
    test-sorgular.js         91 okuma sınaması
    test-yazma.js            56 yazma sınaması (--kur ile kurulur, GALYA_TEST üzerinde)
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
maliyetlendirme. Her biri geri alınabilir. Her yazma
`GALYA_PANEL.dbo.Islem` tablosuna kullanıcı + bilgisayar + satır kimlikleriyle
loglanır.

`kurulum/sql-kullanici-olustur.sql` dosyasındaki `galya_panel` kullanıcısı
VEGADB ve sefim üzerinde **salt okunur**; yalnızca GALYA_PANEL'de `db_owner`.
Yani yazma açılsa bile SQL tarafında ayrıca yetki verilmesi gerekir.

> Şifre bu dosyada yer tutucudur (`BURAYA-GUCLU-BIR-SIFRE-YAZIN`). Bir kez
> gerçek şifre depoya girdi; şifre değiştirildi ve dosya yer tutucuya
> çevrildi. Gerçek şifre yalnızca `.gitignore`'daki `ayarlar.json` içinde
> durur. Depoya bir daha şifre yazmayın.

---

## 6. Belgedeki maddeler — durum

| Madde | Durum |
|---|---|
| THIRD (özel kod 11) okuma + ekleme | Çalışıyor |
| Ara sayım (Vega'nın sayım programını açma) | Çalışıyor |
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
| Sınıflandırma süzgeçleri (Tür/Sınıf/ÖK) | Çalışıyor |
| Sayım fişini Vega'ya yazma | `sayimFisiYaz` hâlâ hata fırlatan taslak |

Sayım fişi tahminle yazılmamalı. Yanlış yazılan fiş stok, maliyet ve
muhasebe zincirini birden bozar.

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

  | Rapordaki sütun | Vega alanı | Örnek değerler |
  |---|---|---|
  | Tür | `KOD1` | BİRA, RAKI, MEŞRUBAT, M (256 değer) |
  | Sınıf | `KOD2` | BAR, MUTFAK, GİDER (32 değer) |
  | 3-ÖK | `KOD3` | İÇECEK |
  | 4-ÖK | `KOD4` | ALKOL, FİRE |
  | 5-ÖK | `KOD5` | VAR, FİRE |

  Stok ekranındaki açılır kutular bu kodlardan üretiliyor; liste sabit
  yazılmadı, firma hangi kodu kullanıyorsa o çıkıyor. Dışa aktarmada da
  aynı sütunlar var, böylece panelin çıktısı Vega'nın stok değer raporuyla
  karşılaştırılabiliyor (`Bira.Henieken` satırı birebir tutuyor).
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
node kurulum/test-sorgular.js     # 91 okuma sınaması
node kurulum/test-yazma.js --kur  # test veritabanını hazırla/tamamla
node kurulum/test-yazma.js        # 55 yazma sınaması
node izleyici/test-izleyici.js …  #  6 izleyici sınaması
```

Yazma sınamaları müşteri verisine dokunmaz: yapısı VEGADB'den
`SELECT * INTO … WHERE 1=0` ile kopyalanmış boş bir **`GALYA_TEST`**
veritabanında çalışır. Bu kalıp IDENTITY özelliğini korur, bu yüzden seçildi.
Sınama `GALYA_AYAR_DOSYASI` ortam değişkeniyle geçici bir ayar dosyasına
yönlendirir.

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
   muhasebe zincirine dokunan tek yazma işlemi. İlk faturanın Vega'da
   doğru göründüğü ve cari ekstresine düştüğü teyit edilmeli.
4. **Sayım fişi yazımı.** Deseni stok giriş/çıkışla aynı görünüyor (tip
   93/94), ama sayımda Vega envanteri farklı sıralıyor olabilir.
   `GALYA_TEST` üzerinde doğrulanmadan açılmamalı.

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
