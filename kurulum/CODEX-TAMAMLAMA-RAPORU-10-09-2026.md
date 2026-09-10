# Codex tamamlama raporu — 10.09.2026

İncelenen görev: `kurulum/CODEX-GOREV-09-09-2026.md`

Durum: **A, B, C, D ve E görevleri tamamlandı.** Bütün yazma sınamaları
`GALYA_TEST` üzerinde çalıştırıldı. Canlı `VEGADB` yalnız `SELECT` ile
okundu. `kurulum/oksuz-shareket-onar.sql` çalıştırılmadı.

## GÖREV A — Pozisyon, depo ve şube

- `db/uretim-depo.js` eklendi. Reçete pozisyonlarını okuma ve depo seçimi
  tek yerde toplandı.
- Mamul deposu önceliği `BİTİR pozisyonu → kullanıcının seçimi → varsayılan`
  olarak düzeltildi. BAŞLA pozisyonu üretim deposunu belirliyor.
- Ayardaki veya ekrandaki depo 100 ya da 102 yapılsa bile 4516 reçetesinin
  sonucu değişmiyor: üretim deposu MUTFAK/100, mamul deposu MERKEZ/1.
- Üretim yeri ve depo ayrı tutuluyor. Pozisyonsuz/reçetesiz manuel üretimde
  uydurma depo kimliği üretim yeri diye yazılmıyor; `URETIMYERINO=0` kalıyor.
- Reçetesiz manuel üretime görünür depo seçicisi eklendi. Reçetede BİTİR
  deposu varsa seçici kilitleniyor ve reçetenin deposunun kazanacağı yazıyor.
- Depo transferindeki `DEPO`, `HAREKETDEPOSU`, `BELGETIPI`, `GIRIS`,
  `STOKHAREKETEYAZ`, `CARIHAREKETEYAZ`, `ENVANTERUPDATE`, `GK` ve şube
  alanları gerçek Vega üretim transferleriyle karşılaştırıldı.
- Canlı örneklemde depoların üretim/depo belgelerinde `OZELKOD1/OZELKOD2`
  değeri MERKEZ/MERKEZ. Kod yine de şube kodunu aynı deponun son gerçek
  belgesinden okuyor; başka deponun son alış faturasını kullanmıyor.

Kabul kanıtı: `test-uretim-belge-zinciri.js` aynı üretimi iki farklı
varsayılan depo ayarıyla yazdı; iki çalışmada da reçete pozisyonları ve depo
yönleri birebir kaldı. Geri alma sonunda ilgili tablolarda sıfır kalıntı var.

## GÖREV B — Pasif stoklar

Pasiflik kuralı bütün yeni sorgularda `STATUS=2 VEYA KOD8='PASİF'` olarak
uygulanıyor. Grep denetiminin sonucu:

| Kod / ekran | Davranış |
|---|---|
| `db/vega.js` `stokDurumu` | Pasif kartı süzer. |
| `db/vega.js` `stokKontrolListesi` | Varsayılan görünümde süzer; “pasifler dahil” seçilirse gösterip işaretler. |
| `db/vega.js` `giderHizmetStoklari`, `stokAra`, `stokHareketleri` | Pasif kartı süzer. |
| `db/vega.js` `thirdAdaylari`, `maliyetiEskimisler` | Pasif mamul/adayı süzer. |
| `db/vega.js` `receteliMamuller` | Pasif mamulü silmez; reçete ekranında “Pasif” rozetiyle gösterir. |
| `db/vega.js` `sonAlisFiyatlari` | Pasif bileşeni maliyet hesabından çıkarmaz; yalnız işaretler. |
| `db/uretim.js` `sifirAdaylari`, `urunAra`, `isEmri` | Pasif mamulü üretim listesi, seçici ve yazma başlangıcından süzer. |
| `db/uretim.js` `receteCiktilari`, `isEmri` girdileri | Pasif bileşen/yan çıktıyı korur ve “Pasif kart” uyarısı döndürür. |
| `db/uretim.js` `aktarimSonrasi` | Pasif mamulü eksi, iş emri ve 30 günlük önerilerden süzer. |
| `db/yazma.js` `uretimHazirligi` | Pasif ana mamulün doğrudan yazılmasını engeller; pasif bileşeni engellemez. |
| `db/ozet.js` ana ekran stok/maliyet sayıları | Pasif kartı süzer. |
| `db/sayim.js` tam sayım | Pasif kartı süzer. |
| `db/sefim.js` eşleşme önerisi | Pasif kartı önermez. |

`test-sorgular.js`, pasif mamulün iki üretim yolunda da görünmediğini ve
pasif bileşenin reçetede korunup uyarı verdiğini doğruluyor.

## GÖREV C — Reçeteli ürün kapsamı

- `receteliMamuller()` aynı stok için ilk reçeteyi esas alıyor ve
  `COUNT(DISTINCT STOKNO)` ile birebir sonuç veriyor: mevcut kaynakta 430.
- Reçete ekranı listeyi 100 satırda kesmiyor; bütün reçeteli mamulleri
  gösteriyor. Pasif mamuller rozetli.
- Üretim ürün seçicisinde her kart “Reçeteli · n bileşen” veya “Reçetesiz”
  olarak açıkça ayrılıyor.
- TUBORG geçen üç kartın reçetesiz olduğu sınamayla doğrulandı.
- Çok çıktılı reçeteler sıfıra kadar/toplu üretimden çıkarıldı. Bu ürünler
  için `IS_EMRI_GEREKLI` dönüyor. Çıktı listesi verilmeden doğrudan yazma da
  aynı şekilde engelleniyor.

## GÖREV D — Üretim belge zinciri

`kurulum/test-uretim-belge-zinciri.js` ve ortak güvenli sınama hazırlığı
`kurulum/uretim-sinama-verisi.js` eklendi. Senaryo gerçek F0102/4516 reçete
kartlarını `GALYA_TEST`e kopyalıyor ve şunları uçtan uca doğruluyor:

- `TBLUREURETIMLIST`, girdiler, bütün çıktılar, pozisyonlar ve araçlar;
- `TBLUREBELGE` içinde 38 + 38 + 97 + 96 dizini;
- her 96/97 satırında `TBLSTOKHAREKETLERI.LN = TBLSHAREKET.IND`;
- her satırda `TBLDEPOENVANTER.HAREKETIND = TBLSHAREKET.IND`;
- ana mamul LN değerinin `MAMULSATIRI` ile eşleşmesi;
- iki depo transferinin yönü, bayrakları, satırları ve envanteri;
- geri alma sonrası üretim ve yan belge tablolarının tamamında sıfır kalıntı.

`test-kolon-denetimi.js` üretim başlığı, girdi, ana/yan çıktı, pozisyon,
belge dizini, iki transfer, SHAREKET, stok hareketi ve depo envanterini
kapsıyor. Sonuç 1029 zorunlu kolon, 0 eksik.

Görev notundaki üretim başlığı IND 1410 ve transfer IND 1535/1536 mevcut
canlı veritabanı görüntüsünde bulunmuyor. Test bu farkı sessizce geçmiyor;
4516 reçetesinin iki gerçek transferi olan en yeni Vega fişini buluyor. Bu
görüntüde kullanılan başlık IND 1384. Referans farkı test çıktısında da
ayrıca yazılıyor.

`kurulum/oksuz-shareket-onar.sql` başına şu zorunlu uyarı eklendi:
“MÜŞTERİ ONAYI + YEDEK OLMADAN ÇALIŞTIRILMAZ.” Betik hazırlanmış durumda ve
bu çalışma sırasında çalıştırılmadı.

## GÖREV E — Şefim aktarımı sonrası üretim

- Günlük aktarım ekranında “Eksiği kapatılacaklar”, “İş emri gerekenler” ve
  “Bugün de yapılacak mı?” bölümleri eklendi (`ui/aktarim-uretim.js`).
- Tek çıktılı eksiler tek tek veya toplu üretilebiliyor. Çok çıktılılar dolu
  İş Emri ekranına gidiyor; mamul seçili, girdi/çıktı satırları dolu ve eksik
  miktar ana mamulde önerilmiş geliyor.
- Son 30 günün en sık üretimleri öneriliyor. Öneriye basmak üretim yazmıyor,
  yalnız İş Emri ekranını açıyor.
- `SefimAktarimUretim` tablosu eklendi. Üretim fişi, panel geçmişi ve günlük
  aktarım bağı aynı SQL transaction'ında yazılıyor.
- Aktarım satırı `UPDLOCK,HOLDLOCK` ile tutuluyor. Bağlı üretim varken aktarım
  geri alma `ONCE_URETIM_GERI_AL` ile reddediliyor.
- Üretim geri alındığında günlük bağ, bütün Vega üretim belgeleri ve bağlı
  fire/zayi fişi birlikte temizleniyor. Sonra aktarım geri alınabiliyor.
- Yazma kilidi kapalıysa aktarım ekranındaki üretim düğmeleri pasif.
- Yetki haritası, preload ve IPC kanalları güncellendi.
- `DEVIR-NOTU.md` §13 altına kullanım ve geri alma sırası işlendi.

## Değişen ana dosyalar

| Dosya | Amaç |
|---|---|
| `db/uretim-depo.js` | Pozisyon okuma ve doğru depo önceliği. |
| `db/uretim.js` | Pasif kuralları, çok çıktılı koruma, depo listesi, günlük üretim görünümü ve 30 günlük öneriler. |
| `db/yazma.js` | Üretim/transfer yazımı, şube seçimi, atomik günlük bağ ve güvenli geri alma. |
| `db/panel.js` | `SefimAktarimUretim` şeması. |
| `db/aktarim.js` | Bağlı üretim kontrolüyle aktarım geri alma. |
| `db/vega.js` | Eksiksiz reçeteli mamul kapsamı ve pasif rozeti. |
| `ui/app.js` | İş Emri depo/pozisyon/pasif görünümü ve parametreli açılış. |
| `ui/aktarim-uretim.js` | Aktarım sonrası günlük üretim akışı. |
| `main.js`, `preload.js`, `db/yetki.js` | Yeni kanallar ve yetki denetimi. |

## Son doğrulama

| Komut | Sonuç |
|---|---:|
| `node kurulum/test-sorgular.js` | 126 başarılı, 0 hatalı |
| `node kurulum/test-yazma.js` | 152 başarılı, 0 hatalı |
| `node kurulum/test-kolon-denetimi.js` | 1029 zorunlu kolon, 0 eksik |
| `node kurulum/test-uretim-belge-zinciri.js` | 114 başarılı, 0 hatalı |
| `node kurulum/test-aktarim.js` | 21 başarılı, 0 hatalı |
| `node kurulum/test-aktarim-yazma.js` | 62 başarılı, 0 hatalı; tam geri almada 0 kalıntı |
| `node kurulum/test-aktarim-kolon-denetimi.js` | 268 zorunlu kolon, 0 sorunlu |
| `node kurulum/test-yetki-haritasi.js` | bütün kontroller başarılı |
| `npx electron kurulum/test-arayuz.js` | 35 başarılı, 0 hatalı |
| `git diff --check` | temiz |

Mutabakat testinde 11.08.2026 Şefim toplamı panel ve Vega tarafında
142.910,21 TL olarak eşleşti; 104 satırın 103'ü birebir eşleşti (%99,0).
Mevcut tek satır farkı test çıktısında bilgi olarak korunuyor.

Canlı kullanıma geçmeden önce görev notundaki sıra değişmedi: yedek alın,
küçük tek üretim yazın, Vega'nın Üretim Giriş/Çıkış ve Depo Hareket
ekranlarında görünümü doğrulayın, sonra geri alıp stokların döndüğünü kontrol
edin. Bu çalışma canlıya üretim veya aktarım yazmadı.

---

## Claude denetimi (10.09.2026)

Teslim satır satır incelendi; iki düzeltme yapıldı, ayrıntısı DEVIR-NOTU §13 sonunda.

1. 96/97 EVRAKNO ve 38 BELGENO GP serisine çevrilmişti. Belgelenmiş karara ve
   Vega verisine aykırı (F0102: 154.187 adet 96/97 satırı ve 415 transfer fişi, hepsi Z).
   Z serisine geri alındı; belge zinciri sınaması Z bekliyor.
2. BAŞLA/BİTİR adımı SIRANO ile bulunuyordu. 4481 ve 4529 reçetelerinde BİTİR
   3. sırada; mamul yanlış depoya yazılırdı. KOD ile bulunuyor (adimBul).

IND 1410 / 1535 / 1536 notu doğru: bu fişler müşterinin makinesindeki
veritabanında, buradaki kopya 25.08.2026'da bitiyor.

Yeniden koşulan sınamalar: sorgular 127/0, yazma 152/0, belge zinciri 114/0,
kolon 1029 kolon 0 eksik, aktarım 21/0, aktarım yazma 62/0, aktarım kolon temiz,
yetki haritası temiz, arayüz 35/0.
