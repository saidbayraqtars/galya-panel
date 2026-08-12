# Galya Panel

VegaWin ve Vega Şefim veritabanları üzerinden çalışan, günlük kullanım için
masaüstü takip programı. VegaWin ana sistem olarak kalır; bu program onun
verisini okur, dikkat isteyen durumları tek ekranda gösterir ve kendi
kayıtlarını (ara sayım, ürün eşleştirme, tutanak) ayrı bir veritabanında tutar.

## Ne yapar

Ana ekranda altı kutu vardır; her kutu tek bir soruya cevap verir ve tıklanınca
o konunun listesini açar:

| Kutu | Cevapladığı soru |
|---|---|
| Stoğu biten ürün | Hangi ürünler eksiye düşmüş veya bitmiş |
| Azalan ürün | Hangi ürünler kritik seviyenin altına inmiş |
| Vega'ya işlenmemiş satış | Şefim'de satılıp Vega'ya düşmemiş kaç satır var |
| Sayım farkı olan ürün | Son ara sayımda kaç üründe fark çıkmış |
| Bekleyen e-fatura | Gelen kutusunda kaç fatura kabul bekliyor |
| Maliyeti eskimiş ürün | Alış fiyatı değişmiş ama maliyeti güncellenmemiş ürünler |

Alt ekranlar: ara sayım, reçete ağacı, THIRD listesi, ürün değişim tutanağı,
cari bakiye, günlük satış ve reçetelere göre hammadde tüketimi.

## Vega'ya yazma

Program varsayılan olarak **VEGADB'ye hiçbir şey yazmaz**. Sayım, tutanak,
eşleştirme ve THIRD işaretleri `GALYA_PANEL` adlı kendi veritabanında tutulur.

Yazma kodu hazırdır ama `ayarlar.json` içindeki `vegayaYazmaAktif` değeri
`true` yapılana kadar çalışmaz. Açmadan önce:

1. Vega yetkilisinden belge yazma yönteminin teyidi alınmalı
   (`ENVANTERUPDATE`, `STOKHAREKETEYAZ`, `SUCCESS` bayrakları, evrak numarası üretimi),
2. İşlem önce DEMO firmasında (F0100) denenmeli,
3. VEGADB yedeği alınmalı.

Açıldığında ilk çalışan işlem stok kartındaki Özel Kod 11 (THIRD) yazmasıdır —
en dar kapsamlı ve geri alınabilir işlem odur. Sayım fişi ve tutanak fişi
yazma fonksiyonları bilerek eksik bırakılmış, çağrıldıklarında ne beklendiğini
anlatan bir mesaj verirler.

## Kurulum

### 1. SQL kullanıcısı (bir kez, sunucuda)

`kurulum/sql-kullanici-olustur.sql` dosyasındaki şifreyi değiştirin, sonra
SQL Server'ın kurulu olduğu makinede çalıştırın:

```
sqlcmd -S localhost -E -i kurulum\sql-kullanici-olustur.sql
```

Bu betik `galya_panel` kullanıcısını oluşturur, VEGADB ve sefim üzerinde
**sadece okuma** yetkisi verir, `GALYA_PANEL` veritabanını açar.

### 2. Programın kurulumu (her bilgisayara)

`Galya Panel Setup x.y.z.exe` dosyasını çalıştırın. Program ilk açılışta
kendi ayar dosyasını oluşturur:

```
%APPDATA%\Galya Panel\ayarlar.json
```

Ayarlar ekranından sunucu adını ve SQL şifresini girin, "Bağlantıyı dene"
ile doğrulayın.

### 3. Ağdaki diğer bilgisayarlar

SQL Server'da TCP/IP protokolü açık ve 1433 portu güvenlik duvarında izinli
olmalıdır. Diğer bilgisayarlara aynı kurulum dosyası kurulur, ayarlarda
`sunucu` alanına SQL Server'ın makine adı yazılır.

## Otomatik güncelleme

Program her açılışta ve 4 saatte bir GitHub Releases üzerindeki yeni sürümü
kontrol eder, arka planda indirir ve "şimdi kur" diye sorar. Kullanıcı bir şey
yapmazsa güncelleme program kapanırken kurulur.

Yeni sürüm yayınlamak için:

```
npm version patch
npm run release
```

`release` komutu için ortamda `GH_TOKEN` tanımlı olmalıdır.

## Geliştirme

```
npm install
npm start          # programı çalıştır
npm run test:db    # veritabanı sorgularını Electron olmadan sına
npm run dist       # kurulum dosyasını üret (yayınlamadan)
```

## Dosya düzeni

```
main.js              Electron ana süreç, IPC uçları
preload.js           Arayüzün erişebildiği güvenli köprü
ui/                  Arayüz (tek HTML + tek CSS + tek JS)
db/ayar.js           Ayar dosyasının okunması/yazılması
db/sql.js            SQL Server bağlantı havuzu
db/firma.js          Firma ve dönem keşfi, tablo adı üretimi
db/panel.js          GALYA_PANEL şeması ve işlem günlüğü
db/vega.js           VEGADB okumaları (tek satır yazma yok)
db/sefim.js          Şefim okumaları ve ürün eşleştirme
db/sayim.js          Ara sayım
db/tutanak.js        Ürün değişim tutanağı ve THIRD işaretleme
db/ozet.js           Ana ekran kutularının sayıları
db/yazma.js          VEGADB'ye yazma — varsayılan kapalı
db/guncelleme.js     Otomatik güncelleme
kurulum/             SQL kullanıcı betiği ve veritabanı testi
```

## Bilinen durum

- Şefim menü adları aktif firmanın (GALYA YENİ) stok kartlarıyla eşleşmiyor;
  eşleştirme "Satış aktarımı" ekranından bir kez yapılır ve kalıcı saklanır.
- Şefim `Product.StockCode` alanı boş olduğu için eşleştirme isim üzerinden
  kurulur.
- Stok kartlarındaki `KOD1` alanına adisyon notları yazılmış durumda; grup
  ağacı olarak kullanılamıyor.
- `KOD11` (Özel Kod 11) bütün kartlarda boş — THIRD işaretlemesi sıfırdan yapılır.
