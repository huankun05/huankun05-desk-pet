# P0 Hermes runtime setup (Windows)
# Creates HERMES_HOME, .env with API_SERVER_KEY, and uv venv for hermes-agent.

$ErrorActionPreference = "Stop"
$Workspace = "F:\Work\Create\desk_pet"
$HermesSrc = Join-Path $Workspace "hermes-agent"
$HermesHome = Join-Path $Workspace ".runtime\hermes-home"
$Uv = "E:\software\Python3.12\Scripts\uv.exe"
$Python = "E:\software\Python3.12\python.exe"

if (-not (Test-Path $HermesSrc)) { throw "Hermes source missing: $HermesSrc" }
if (-not (Test-Path $Uv)) { throw "uv not found: $Uv" }

New-Item -ItemType Directory -Force -Path $HermesHome | Out-Null
$envFile = Join-Path $HermesHome ".env"
if (-not (Test-Path $envFile)) {
  $key = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
  $content = @"
# desk-pet P0 Hermes runtime (generated $(Get-Date -Format o))
API_SERVER_KEY=$key
API_SERVER_PORT=8642
API_SERVER_HOST=127.0.0.1
HERMES_HOME=$HermesHome
# Configure a model provider before /v1/runs chat tests, e.g.:
# OPENROUTER_API_KEY=
# OPENAI_API_KEY=
# XIAOMI_API_KEY=
"@
  Set-Content -Path $envFile -Value $content -Encoding UTF8
  Write-Host "Wrote $envFile"
} else {
  Write-Host "Keep existing $envFile"
}

Write-Host "Syncing hermes-agent venv with uv (this can take several minutes)..."
Push-Location $HermesSrc
try {
  # core + mcp + messaging (api_server adapter needs aiohttp from messaging extra)
  & $Uv sync --extra mcp --extra messaging --python $Python
  if ($LASTEXITCODE -ne 0) { throw "uv sync failed: $LASTEXITCODE" }
  Write-Host "uv sync OK"
  & $Uv run python -c "import gateway, sys; print('gateway import OK', sys.version)"
} finally {
  Pop-Location
}

Write-Host "Setup done. HERMES_HOME=$HermesHome"
Write-Host "Next: .\desk-pet\scripts\hermes-p0\start-gateway.ps1"
