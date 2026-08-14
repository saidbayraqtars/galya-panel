# Galya İzleyici

VegaWinA5'in veritabanına gerçekte hangi SQL'i gönderdiğini kaydeden
taşınabilir araç. Amacı, Vega'nın arayüzünden yapılan bir işlemi (örneğin
**Stok Yönetimi → Araçlar → Maliyetlendirme**) panelin de yapabilmesi için
Vega'nın hangi tabloya ne yazdığını öğrenmek.

**Veri değiştirmez.** Yalnızca SQL Server'da bir Extended Events oturumu
açar, çalışan ifadeleri dinler ve masaüstüne metin dosyası olarak kaydeder.

## Kullanım

`GalyaIzleyici.exe` dosyasını VegaWinA5'in çalıştığı bilgisayara kopyalayıp
çift tıklayın. Kurulum yapmaz, tek dosyadır.

1. **Bağlanın.** Sunucu adı, SQL kullanıcısı ve şifresi. İzleme açmak
   **sysadmin** yetkisi ister — genelde `sa` kullanıcısı kullanılır.
   Sunucu adı: `localhost`, bilgisayar adı veya `BILGISAYAR\SQLEXPRESS`.
2. **İzlemeyi başlatın.** İzlenecek veritabanını seçin (genelde `VEGADB`).
3. **VegaWinA5'te öğrenmek istediğiniz işlemi yapın.** Tek bir işlem yapın;
   ne kadar az başka şey yaparsanız kayıt o kadar temiz olur.
4. **Yakalananları gösterin.** Hangi tablolara kaç ifade yazıldığını ve ilk
   yazan ifadeleri ekranda görürsünüz.
5. **Dosyaya kaydedin.** "Sadece yazanları kaydet" genelde yeterlidir.
   Dosya masaüstünde `Galya-Izleyici-Kayitlari` klasörüne düşer.
6. **İzlemeyi kapatın.** Açık kalırsa sunucuda kayıt dosyası büyümeye
   devam eder.

Kaydedilen dosyayı bana gönderin; Vega'nın ne yaptığını oradan çıkarıp
panele eklerim.

## Nereye ne yazar

| Ne | Nerede |
|---|---|
| Ham kayıtlar (.xel) | `C:\Users\Public\galya-izleyici\` (sunucu makinesinde) |
| Kaydettiğiniz metin dosyaları | Masaüstü → `Galya-Izleyici-Kayitlari` |
| SQL Server'daki oturum adı | `galya_vega_izleyici` |

Her izleme başlatışı kendi dosyasına yazar, eski kayıtlar yenisine
karışmaz. "İzlemeyi kapat" oturumu sunucudan tamamen kaldırır; ham `.xel`
dosyaları klasörde kalır, elle silebilirsiniz.

## Sınama

```
node test-izleyici.js <sunucu> <kullanici> <sifre> [veritabani]
```

İzleme açar, izlenen veritabanında tanınabilir bir `SELECT` çalıştırır,
yakalandığını doğrular ve oturumu kaldırır. Hiçbir veri değiştirilmez.

## Derleme

```
npm install
npm run dist       # dist/GalyaIzleyici.exe
```
