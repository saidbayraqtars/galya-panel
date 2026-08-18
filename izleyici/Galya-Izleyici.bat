@echo off
rem Galya Izleyici - tek dosya. Cift tiklayin.
rem Asagisi PowerShell betigidir; cmd oraya hic ulasmaz.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$k=[IO.File]::ReadAllText('%~f0',[Text.Encoding]::UTF8); $m=$k.IndexOf('#PS'+'START'); Invoke-Expression $k.Substring($m)"
exit /b
#PSSTART
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$OTURUM = 'galya_vega_izleyici'
$KLASOR = 'C:\Users\Public\galya-izleyici'
$DOSYA  = $KLASOR + '\vega.xel'
$DESEN  = $KLASOR + '\vega*.xel'

function Basla($m) { Write-Host $m -ForegroundColor Cyan }
function Iyi($m)   { Write-Host $m -ForegroundColor Green }
function Kotu($m)  { Write-Host $m -ForegroundColor Red }

Write-Host ''
Basla '=== Galya Izleyici ==='
Write-Host 'Vega''nin veritabanina hangi SQL''i yazdigini kaydeder. Veri degistirmez.'
Write-Host ''

# --- Baglanti bilgileri ---------------------------------------------------

$sunucu = Read-Host 'Sunucu adi [bos = localhost]'
if (-not $sunucu) { $sunucu = 'localhost' }

$kullanici = Read-Host 'SQL kullanici adi [bos birakirsan Windows girisi kullanilir]'
$sifre = ''
if ($kullanici) {
  $gizli = Read-Host 'Sifre' -AsSecureString
  $sifre = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
             [Runtime.InteropServices.Marshal]::SecureStringToBSTR($gizli))
}

$vt = Read-Host 'Veritabani [bos = VEGADB]'
if (-not $vt) { $vt = 'VEGADB' }
$vtSql = $vt.Replace("'", "''")

if ($kullanici) {
  $cs = "Server=$sunucu;Database=master;User ID=$kullanici;Password=$sifre;TrustServerCertificate=True;Connect Timeout=20"
} else {
  $cs = "Server=$sunucu;Database=master;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=20"
}

function SqlCalistir($metin) {
  $c = New-Object System.Data.SqlClient.SqlConnection $cs
  $c.Open()
  try {
    $k = $c.CreateCommand()
    $k.CommandText = $metin
    $k.CommandTimeout = 600
    [void]$k.ExecuteNonQuery()
  } finally { $c.Close() }
}

function SqlTekSatir($metin) {
  $c = New-Object System.Data.SqlClient.SqlConnection $cs
  $c.Open()
  try {
    $k = $c.CreateCommand()
    $k.CommandText = $metin
    $k.CommandTimeout = 600
    $r = $k.ExecuteReader()
    $sonuc = @{}
    if ($r.Read()) { for ($i = 0; $i -lt $r.FieldCount; $i++) { $sonuc[$r.GetName($i)] = $r.GetValue($i) } }
    $r.Close()
    return $sonuc
  } finally { $c.Close() }
}

# --- Baglanti ve yetki sinamasi -------------------------------------------

Write-Host ''
Basla 'Baglaniliyor...'
try {
  $d = SqlTekSatir @"
SELECT @@SERVERNAME AS sunucu,
       SUSER_SNAME() AS kim,
       IS_SRVROLEMEMBER('sysadmin') AS sysadmin,
       (SELECT COUNT(*) FROM sys.databases WHERE name = '$vtSql') AS vtVar
"@
} catch {
  Kotu ('Baglanilamadi: ' + $_.Exception.Message)
  Read-Host 'Kapatmak icin Enter'
  exit 1
}

Iyi ("Baglandi: {0} / kullanici {1}" -f $d.sunucu, $d.kim)
if ([int]$d.vtVar -eq 0) { Kotu "UYARI: '$vt' adinda veritabani yok. Ad dogru mu?" }
if ([int]$d.sysadmin -ne 1) {
  Kotu 'Bu kullanici sysadmin degil. Izleme acmak sysadmin ister (genelde sa).'
  Read-Host 'Kapatmak icin Enter'
  exit 1
}

# --- Izlemeyi baslat -------------------------------------------------------

function OturumuKaldir {
  try {
    SqlCalistir @"
IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = '$OTURUM')
   ALTER EVENT SESSION [$OTURUM] ON SERVER STATE = STOP;
IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = '$OTURUM')
   DROP EVENT SESSION [$OTURUM] ON SERVER;
"@
  } catch { }
}

Basla 'Izleme aciliyor...'
OturumuKaldir
SqlCalistir "EXEC xp_create_subdir N'$KLASOR';"
try {
  SqlCalistir @"
IF (SELECT CAST(value_in_use AS INT) FROM sys.configurations WHERE name = 'xp_cmdshell') = 1
   EXEC xp_cmdshell 'del /q "$DESEN"', NO_OUTPUT;
"@
} catch { }

SqlCalistir @"
CREATE EVENT SESSION [$OTURUM] ON SERVER
  ADD EVENT sqlserver.rpc_completed (
      ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
      WHERE sqlserver.database_name = N'$vtSql'
  ),
  ADD EVENT sqlserver.sql_batch_completed (
      ACTION (sqlserver.client_app_name, sqlserver.sql_text, sqlserver.username)
      WHERE sqlserver.database_name = N'$vtSql'
  )
  ADD TARGET package0.event_file (
      SET filename = N'$DOSYA', max_file_size = 512, max_rollover_files = 8
  )
  WITH (MAX_DISPATCH_LATENCY = 3 SECONDS, MAX_MEMORY = 64 MB,
        EVENT_RETENTION_MODE = NO_EVENT_LOSS, TRACK_CAUSALITY = ON);
"@
SqlCalistir "ALTER EVENT SESSION [$OTURUM] ON SERVER STATE = START;"
Iyi 'Izleme acik.'

Write-Host ''
Write-Host '-------------------------------------------------------------'
Write-Host ' SIMDI Vega''da ogrenmek istedigin islemi yap.'
Write-Host ' Tek bir islem yap; ne kadar az sey yaparsan kayit o kadar temiz.'
Write-Host '-------------------------------------------------------------'
Read-Host ' Islemi bitirince Enter''a bas'

# --- Yakalananlari oku -----------------------------------------------------

Basla 'Kayitlar okunuyor...'

function DegerCoz($ham) {
  $v = $ham
  $m = [regex]::Match($v, '^<!\[CDATA\[([\s\S]*?)\]\]>$')
  if ($m.Success) { $v = $m.Groups[1].Value }
  $v = $v -replace '&lt;', '<' -replace '&gt;', '>' -replace '&quot;', '"'
  $v = $v -replace '&#x0D;', "`r" -replace '&#x0A;', "`n" -replace '&amp;', '&'
  return $v.Trim()
}

function Alan($xml, $ad) {
  $kalip = 'name="' + $ad + '"[^>]*>\s*(?:<type[^>]*(?:/>|>\s*</type>)\s*)?<value>([\s\S]*?)</value>'
  $m = [regex]::Match($xml, $kalip)
  if ($m.Success) { return DegerCoz $m.Groups[1].Value }
  return ''
}

$yazmaKalip  = [regex]'(?is)\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([\[\]A-Za-z0-9_\.#]+)'
$bizimKalip  = [regex]'(?i)galya_vega_izleyici|dm_xe_session|fn_xe_file_target|xp_create_subdir|server_event_sessions'
$bizimUygKalip = [regex]'(?i)Management Studio|SQLCMD|\.Net SqlClient|Galya'

$toplam = 0
$yazmalar = New-Object 'System.Collections.Generic.List[object]'
$ozet = @{}
$ENYAZMA = 3000

$c = New-Object System.Data.SqlClient.SqlConnection $cs
$c.Open()
try {
  $k = $c.CreateCommand()
  $k.CommandText = "SELECT CAST(event_data AS NVARCHAR(MAX)) AS event_data FROM sys.fn_xe_file_target_read_file(N'$DESEN', NULL, NULL, NULL)"
  $k.CommandTimeout = 1200
  $r = $k.ExecuteReader()
  while ($r.Read()) {
    $toplam++
    if ($toplam % 5000 -eq 0) { Write-Host ("  {0} olay okundu..." -f $toplam) }
    $xml = [string]$r.GetValue(0)
    $metin = Alan $xml 'batch_text'
    if (-not $metin) { $metin = Alan $xml 'statement' }
    if (-not $metin) { $metin = Alan $xml 'sql_text' }
    if (-not $metin) { continue }
    if ($bizimKalip.IsMatch($metin)) { continue }
    $uyg = Alan $xml 'client_app_name'
    if ($bizimUygKalip.IsMatch($uyg)) { continue }

    $eslesmeler = $yazmaKalip.Matches($metin)
    if ($eslesmeler.Count -eq 0) { continue }

    foreach ($e in $eslesmeler) {
      $tablo = $e.Groups[2].Value -replace '[\[\]]', ''
      $tur = ($e.Groups[1].Value -split '\s+')[0].ToUpper()
      if (-not $ozet.ContainsKey($tablo)) { $ozet[$tablo] = @{ INSERT = 0; UPDATE = 0; DELETE = 0 } }
      $ozet[$tablo][$tur] = $ozet[$tablo][$tur] + 1
    }

    if ($yazmalar.Count -lt $ENYAZMA) {
      $zaman = ''
      $mz = [regex]::Match($xml, 'timestamp="([^"]+)"')
      if ($mz.Success) { $zaman = $mz.Groups[1].Value }
      $yazmalar.Add([pscustomobject]@{ zaman = $zaman; uygulama = $uyg; metin = $metin })
    }
  }
  $r.Close()
} finally { $c.Close() }

Iyi ("Toplam {0} olay, {1} yazma ifadesi." -f $toplam, $yazmalar.Count)

# --- Dosyaya yaz -----------------------------------------------------------

$masaustu = [Environment]::GetFolderPath('Desktop')
$hedefKlasor = Join-Path $masaustu 'Galya-Izleyici-Kayitlari'
if (-not (Test-Path $hedefKlasor)) { [void](New-Item -ItemType Directory -Path $hedefKlasor) }
$dosyaAdi = 'izleme-' + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + '.md'
$hedef = Join-Path $hedefKlasor $dosyaAdi

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('# Galya Izleyici kaydi')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('| | |')
[void]$sb.AppendLine('|---|---|')
[void]$sb.AppendLine("| Tarih | $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') |")
[void]$sb.AppendLine("| Sunucu | $($d.sunucu) |")
[void]$sb.AppendLine("| Veritabani | $vt |")
[void]$sb.AppendLine("| Okunan olay | $toplam |")
[void]$sb.AppendLine("| Yazma ifadesi | $($yazmalar.Count) |")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Hangi tabloya ne yazildi')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('| Tablo | INSERT | UPDATE | DELETE |')
[void]$sb.AppendLine('|---|---:|---:|---:|')
foreach ($t in ($ozet.Keys | Sort-Object)) {
  $s = $ozet[$t]
  [void]$sb.AppendLine("| $t | $($s.INSERT) | $($s.UPDATE) | $($s.DELETE) |")
}
if ($ozet.Count -eq 0) { [void]$sb.AppendLine('| (hicbir yazma yakalanmadi) | | | |') }
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Yazan ifadeler')
[void]$sb.AppendLine('')
$no = 0
foreach ($y in $yazmalar) {
  $no++
  $m = $y.metin
  if ($m.Length -gt 8000) { $m = $m.Substring(0, 8000) + "`r`n-- ... (kisaltildi)" }
  [void]$sb.AppendLine("### $no. $($y.zaman)  -  $($y.uygulama)")
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('```sql')
  [void]$sb.AppendLine($m)
  [void]$sb.AppendLine('```')
  [void]$sb.AppendLine('')
}
if ($yazmalar.Count -ge $ENYAZMA) {
  [void]$sb.AppendLine("> Ilk $ENYAZMA yazma ifadesi kaydedildi, gerisi atlandi.")
}

[IO.File]::WriteAllText($hedef, $sb.ToString(), (New-Object Text.UTF8Encoding $false))
Iyi "Kaydedildi: $hedef"

# --- Temizlik --------------------------------------------------------------

Basla 'Izleme kapatiliyor...'
OturumuKaldir
Iyi 'Kapatildi.'

Write-Host ''
Write-Host 'Bu dosyayi bana gonder.' -ForegroundColor Yellow
try { Start-Process explorer.exe ('/select,"' + $hedef + '"') } catch { }
Read-Host 'Kapatmak icin Enter'
