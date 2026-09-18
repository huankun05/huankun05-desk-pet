# Start Hermes gateway with API server (foreground). Ctrl+C to stop.
$ErrorActionPreference = "Stop"
$Workspace = "F:\Work\Create\desk_pet"
$HermesSrc = Join-Path $Workspace "hermes-agent"
$HermesHome = Join-Path $Workspace ".runtime\hermes-home"
$Uv = "E:\software\Python3.12\Scripts\uv.exe"
$envFile = Join-Path $HermesHome ".env"

if (-not (Test-Path $envFile)) { throw "Missing $envFile — run setup-hermes.ps1 first" }

# Load .env into process env
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $name = $Matches[1]
    $val = $Matches[2].Trim()
    Set-Item -Path "Env:$name" -Value $val
  }
}
$env:HERMES_HOME = $HermesHome
if (-not $env:API_SERVER_KEY) { throw "API_SERVER_KEY empty in $envFile" }
if (-not $env:API_SERVER_PORT) { $env:API_SERVER_PORT = "8642" }

Write-Host "HERMES_HOME=$env:HERMES_HOME"
Write-Host "API http://127.0.0.1:$($env:API_SERVER_PORT) key_len=$($env:API_SERVER_KEY.Length)"

Push-Location $HermesSrc
try {
  # Official entry: gateway facade start_gateway (cli --gateway)
  & $Uv run python cli.py --gateway
} finally {
  Pop-Location
}
