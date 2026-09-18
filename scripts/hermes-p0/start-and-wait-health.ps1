# Start Hermes gateway detached + poll health + smoke
$ErrorActionPreference = "Continue"
$Workspace = "F:\Work\Create\desk_pet"
$HermesSrc = Join-Path $Workspace "hermes-agent"
$HermesHome = Join-Path $Workspace ".runtime\hermes-home"
$Uv = "E:\software\Python3.12\Scripts\uv.exe"
$logDir = Join-Path $Workspace ".runtime\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir "hermes-gateway.out.log"
$stderr = Join-Path $logDir "hermes-gateway.err.log"
$envFile = Join-Path $HermesHome ".env"

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process")
  }
}
[Environment]::SetEnvironmentVariable("HERMES_HOME", $HermesHome, "Process")
$port = if ($env:API_SERVER_PORT) { $env:API_SERVER_PORT } else { "8642" }
[Environment]::SetEnvironmentVariable("API_SERVER_PORT", $port, "Process")

Get-CimInstance Win32_Process -Filter "Name like '%python%' or Name like '%uv%'" -EA SilentlyContinue |
  Where-Object { $_.CommandLine -match "cli\.py --gateway" } |
  ForEach-Object {
    Write-Host "stop old PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue
  }
Start-Sleep -Seconds 1

$argLine = "run python cli.py --gateway"
$p = Start-Process -FilePath $Uv -ArgumentList $argLine -WorkingDirectory $HermesSrc `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
Write-Host "gateway PID=$($p.Id) port=$port"
$p.Id | Set-Content (Join-Path $logDir "hermes-gateway.pid")

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2 -UseBasicParsing
    Write-Host "HEALTH $($r.StatusCode) $($r.Content)"
    $ok = $true
    break
  } catch {
    Write-Host "t=$($i*2)s $($_.Exception.Message)"
  }
}

Write-Host "--- stderr api lines ---"
if (Test-Path $stderr) {
  Get-Content $stderr | Select-String -Pattern "API Server|api_server|adapter|8642|Error" | Select-Object -Last 20
}

if ($ok) { exit 0 } else { exit 1 }
