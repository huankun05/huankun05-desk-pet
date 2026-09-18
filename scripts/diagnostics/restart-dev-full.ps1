# 完整重启开发版：杀残留 → 重建主进程 → 启动 vite+electron
$ErrorActionPreference = "Continue"
$dp = "F:\Work\Create\desk_pet\desk-pet"
$npm = "E:\software\Nodejs\npm.cmd"

Write-Host "1) kill desk-pet electron/node (not other projects)"
Get-CimInstance Win32_Process -Filter "Name='electron.exe' OR Name='node.exe' OR Name='npm.cmd'" -EA SilentlyContinue |
  Where-Object { $_.CommandLine -match "desk_pet\\\\desk-pet|Create\\desk_pet" } |
  ForEach-Object {
    Write-Host "  kill $($_.ProcessId) $($_.Name)"
    Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue
  }

# stale vite-dev-url
$devUrl = Join-Path $dp "dist\main\.vite-dev-url.json"
if (Test-Path $devUrl) { Remove-Item $devUrl -Force -EA SilentlyContinue }

Write-Host "2) rebuild main+preload"
Push-Location $dp
& $npm run build:main
Write-Host "  build:main exit=$LASTEXITCODE"
& $npm run build:preload
Write-Host "  build:preload exit=$LASTEXITCODE"
Pop-Location

Write-Host "3) start dev"
Start-Process -FilePath $npm -ArgumentList "run","dev" -WorkingDirectory $dp -WindowStyle Minimized

Write-Host "4) wait for vite + electron"
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 2
  $urlJson = Get-Content $devUrl -EA SilentlyContinue
  $electron = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -EA SilentlyContinue |
    Where-Object { $_.CommandLine -match "desk_pet" }
  if ($urlJson -and $electron) {
    Write-Host "  vite-dev-url: $urlJson"
    Write-Host "  desk-pet electron: $($electron.ProcessId -join ',')"
    $ok = $true
    break
  }
  if ($i % 5 -eq 0) { Write-Host "  wait $($i*2)s..." }
}
if ($ok) { Write-Host "STARTED OK" } else { Write-Host "START TIMEOUT — check npm run dev in $dp" }

if (Test-Path $devUrl) { Get-Content $devUrl }
Get-Content "C:\Users\shangmeng\AppData\Roaming\live2d-cyrene\logs\error.log" -Tail 8 -EA SilentlyContinue
