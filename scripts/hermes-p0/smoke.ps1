# Smoke: health / capabilities (chat optional via SMOKE_CHAT=1)
$ErrorActionPreference = "Continue"
$HermesHomeEnv = "F:\Work\Create\desk_pet\.runtime\hermes-home\.env"
$key = ""
$port = "8642"
if (Test-Path $HermesHomeEnv) {
  Get-Content $HermesHomeEnv | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $n = $Matches[1]; $v = $Matches[2].Trim()
      if ($n -eq "API_SERVER_KEY") { $script:key = $v }
      if ($n -eq "API_SERVER_PORT" -and $v) { $script:port = $v }
    }
  }
}
$base = "http://127.0.0.1:$port"
Write-Host "base=$base key_len=$($key.Length)"

Write-Host "=== health ==="
try {
  $h = Invoke-WebRequest -Uri "$base/health" -TimeoutSec 5 -UseBasicParsing
  Write-Host ("STATUS {0} {1}" -f $h.StatusCode, $h.Content)
} catch {
  Write-Host "HEALTH FAIL: $($_.Exception.Message)"
  exit 1
}

if (-not $key) { Write-Host "No key; done."; exit 0 }

Write-Host "=== capabilities ==="
try {
  $c = Invoke-WebRequest -Uri "$base/v1/capabilities" -Headers @{ Authorization = "Bearer $key" } -TimeoutSec 5 -UseBasicParsing
  $body = $c.Content
  if ($body.Length -gt 600) { $body = $body.Substring(0, 600) }
  Write-Host ("STATUS {0}" -f $c.StatusCode)
  Write-Host $body
} catch {
  Write-Host "capabilities: $($_.Exception.Message)"
}

if ($env:SMOKE_CHAT -eq "1") {
  Write-Host "=== chat completions ==="
  $payload = @{ model = "hermes-agent"; messages = @(@{ role = "user"; content = "hi" }); stream = $false } | ConvertTo-Json -Depth 6
  try {
    $r = Invoke-WebRequest -Uri "$base/v1/chat/completions" -Method POST -Headers @{ Authorization = "Bearer $key"; "Content-Type" = "application/json" } -Body $payload -TimeoutSec 60 -UseBasicParsing
    $t = $r.Content
    if ($t.Length -gt 800) { $t = $t.Substring(0, 800) }
    Write-Host ("STATUS {0}" -f $r.StatusCode)
    Write-Host $t
  } catch {
    Write-Host "chat fail (need model provider?): $($_.Exception.Message)"
  }
} else {
  Write-Host "Skip chat (SMOKE_CHAT=1 after model config)."
}

Write-Host "Smoke finished OK"
