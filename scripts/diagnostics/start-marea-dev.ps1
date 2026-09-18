# Start Marea dev app (detached). Logs: .runtime/logs/marea-dev-*.log via npm output if needed.
$dp = "F:\Work\Create\desk_pet\desk-pet"
$npm = "E:\software\Nodejs\npm.cmd"
if (-not (Test-Path $dp)) { throw "missing $dp" }
if (-not (Test-Path $npm)) { throw "missing $npm" }
Start-Process -FilePath $npm -ArgumentList "run","dev" -WorkingDirectory $dp -WindowStyle Minimized
Write-Host "Launched: npm run dev in $dp"
Write-Host "Settings window: 汐月 app -> 设置 -> 模型服务 / AI 引擎"
