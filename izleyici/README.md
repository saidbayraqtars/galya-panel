# Galya İzleyici

`Galya-Izleyici.bat` — tek dosya. VegaWinA5'in veritabanına gerçekte hangi
SQL'i yazdığını kaydeder ve masaüstüne bir `.md` dosyası bırakır.
**Veri değiştirmez**; sadece SQL Server'da bir Extended Events oturumu açar.

## Kullanım

`Galya-Izleyici.bat` dosyasını Vega'nın çalıştığı bilgisayara kopyala, çift
tıkla. Kurulum yok, Node yok, .NET/PowerShell zaten Windows'ta var.

1. Sunucu adı (boş = `localhost`), SQL kullanıcı + şifre (boş bırakırsan
   Windows girişi kullanılır), veritabanı (boş = `VEGADB`).
   İzleme açmak **sysadmin** ister — genelde `sa`.
2. "Şimdi Vega'da işlemi yap" yazınca Vega'ya geç, öğrenmek istediğin tek
   işlemi yap (ör. Stok Yönetimi → Araçlar → Maliyetlendirme).
3. Enter'a bas. Kayıtlar okunur, oturum kapatılır, dosya masaüstünde
   `Galya-Izleyici-Kayitlari\izleme-<tarih>.md` olarak açılır.
4. O dosyayı bana gönder.

## Dosyada ne var

- Sunucu / veritabanı / olay sayısı özeti
- Hangi tabloya kaç INSERT / UPDATE / DELETE gittiği tablosu
- Yazan ifadelerin tam SQL metni (ilk 3000 tanesi)

`SELECT`'ler yazılmaz — işe yarayan kısım yazma ifadeleri.

## Nereye ne yazar

| Ne | Nerede |
|---|---|
| Ham kayıtlar (.xel) | `C:\Users\Public\galya-izleyici\` (SQL Server'ın makinesinde) |
| Sonuç dosyası | Masaüstü → `Galya-Izleyici-Kayitlari` |
| Oturum adı | `galya_vega_izleyici` |

Program biterken oturumu sunucudan tamamen kaldırır. Ham `.xel` dosyaları
klasörde kalır, elle silinebilir.

## Eski Electron sürümü

`main.js`, `ui/`, `lib/`, `dist/` eski GUI sürümüne ait — artık gerekmiyor,
silinebilir.
