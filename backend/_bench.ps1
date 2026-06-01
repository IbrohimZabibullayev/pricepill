Set-Location D:\PricePill\backend
$line = Get-Content .env | Where-Object { $_ -match '^ANTHROPIC_API_KEY=' } | Select-Object -First 1
$env:ANTHROPIC_API_KEY = ($line -replace '^ANTHROPIC_API_KEY=', '').Trim()
$own = "C:/Users/Surface/Downloads/Telegram Desktop/прайс  28.05.xls"
$comp = "C:/Users/Surface/Downloads/Telegram Desktop/Прайс лист__2026-05-28.xls"
$start = Get-Date
$out = npx ts-node --transpile-only scripts/verify.ts $own $comp 2>&1
$end = Get-Date
$secs = [math]::Round(($end - $start).TotalSeconds, 1)
$clean = $out | ForEach-Object { ($_ -replace '\x1b\[[0-9;]*m','') }
$err429 = ($clean | Select-String -Pattern "429|rate_limit" | Measure-Object).Count
$autoLine = $clean | Select-String -Pattern "Auto-qabul" | ForEach-Object { $_.Line }
$doneLine = $clean | Select-String -Pattern "Taqqoslash tugadi|Jami:|vaqti:" | ForEach-Object { $_.Line }
$report = "WALL_SECONDS: $secs`n429_COUNT: $err429`nAUTO: $autoLine`n" + ($doneLine -join "`n")
[System.IO.File]::WriteAllText("D:\PricePill\backend\_benchout.txt", $report)
