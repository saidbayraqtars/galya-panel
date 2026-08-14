# Devir notu — Galya Panel

Bu dosya, projeyi devralan kişinin (veya yeni bir sohbetin) sıfırdan bağlam
kurmadan devam edebilmesi için yazıldı. Kod okunarak veya git geçmişine
bakılarak öğrenilemeyecek şeyleri anlatır.

Son güncelleme: 14.08.2026 · Sürüm 1.2.0 · Son commit `68c46ad`

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
    rapor.js         Rapor üretimi
    disaaktar.js     Excel / PDF dışa aktarma
    guncelleme.js    electron-updater sarmalayıcı
    vegaprogram.js   VegaWinA5 exe'sini bulma / başlatma
  izleyici/          Ayrı, bağımsız Electron uygulaması (aşağıda)
  kurulum/
    BELGE-DESENI.md          Vega'ya yazma deseni — yazmaya dokunmadan önce okuyun
    DEVIR-NOTU.md            bu dosya
    sql-kullanici-olustur.sql
    test-sorgular.js         88 okuma sınaması
    test-yazma.js            29 yazma sınaması (GALYA_TEST üzerinde)
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
VEGADB'ye tek satır gitmez. Kullanıcının açık isteği bu.

Yazan işler: THIRD özel kod 11, gider/hizmet stok sıfırlama, reçete
oluştur/güncelle/sil, tutanak fişi. Her biri geri alınabilir. Her yazma
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
| **Maliyetlendirme tetikleme** | **Yapılmadı** — desen çıkarılmadı |
| **Üretim tetikleme** | **Yapılmadı** — desen çıkarılmadı |
| Sayım fişini Vega'ya yazma | `sayimFisiYaz` hâlâ hata fırlatan taslak |

Son üçü tahminle yazılmamalı. Yanlış yazılan fiş stok, maliyet ve muhasebe
zincirini birden bozar.

### Neden yapılamadı

- **Üretim:** Elde üretim yapılmış bir Vega veritabanı yok. İncelenen
  veritabanında `TBLURERECETE`, `TBLUREURETIM`, `TBLUREBELGE` bomboş ve
  hiçbir hareket `IZAHAT` 96/97 taşımıyor. Desen yokluktan çıkarılamaz.
- **Maliyetlendirme:** Tek belge yazımı değil, toplu yeniden hesaplama.
  Ne yaptığını görmek için Vega çalışırken SQL trafiğini yakalamak gerekiyor.
  İzleyici tam bunun için yazıldı.

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
node kurulum/test-sorgular.js     # 88 okuma sınaması
node kurulum/test-yazma.js        # 29 yazma sınaması
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

## 10. Şu anki veritabanı durumu — DİKKAT

`VEGADB` yeniden restore edildi ve şu an **başka bir müşterinin** verisini
tutuyor: **ÖZDEMİRKAYA** (15.421 tablo, canlı dönemler `F0103D0015`,
`F0101D0015`, `F0101D0017`). Galya verisi (`F0102` / MARQUE GIDA) bu
veritabanında **yok**.

Panel yine de çalışıyor, çünkü firma/dönem keşfi dinamik (88/88 okuma
sınaması geçiyor). Ama:

- `ayarlar.json` hâlâ `varsayilanFirma: "F0102"`, `varsayilanDonem: "D0002"`
  diyor. Bunlar artık yok; panel ilk firmaya düşüyor. Gerçek Galya
  veritabanı geri geldiğinde bu iki satır düzeltilmeli.
- ÖZDEMİRKAYA'da hiç üretim/reçete verisi yok, bu yüzden üretim deseni
  buradan çıkarılamaz.

---

## 11. Sıradaki işler

1. **Gerçek Galya veritabanı restore edilsin.** Kullanıcı bunu yapacağını
   söyledi. Sonrasında `ayarlar.json` içindeki varsayılan firma/dönem
   düzeltilecek ve üretim (`IZAHAT` 96/97) deseni gerçek veriden çıkarılacak.
2. **Maliyetlendirme deseni.** İzleyici çalışırken VegaWinA5 → Stok Yönetimi
   → Araçlar → Maliyetlendirme çalıştırılacak, kayıt dosyası incelenecek,
   sonra kodlanacak.
3. **Sayım fişi yazımı.** Deseni stok giriş/çıkışla aynı görünüyor (tip
   93/94), ama sayımda Vega envanteri farklı sıralıyor olabilir.
   `GALYA_TEST` üzerinde doğrulanmadan açılmamalı.

---

## 12. Şefim tarafı (bilinmesi gereken)

Şefim aktarımı **kopuk**: 20.451 satış Vega'ya aktarılmamış ve ürün isim
eşleşmesi 324'te 1. Yani teorik stok bugün güvenilir değil. Panel bunu
gizlemiyor, ekranda gösteriyor. Stok sayılarına dayanan bir özellik
eklemeden önce bu akılda tutulmalı.
