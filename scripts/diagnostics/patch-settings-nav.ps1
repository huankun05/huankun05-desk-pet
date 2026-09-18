$f = "F:\Work\Create\desk_pet\desk-pet\src\renderer\settings\index.html"
$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8
$nl = "`r`n"
$oldCss = '  <link rel="stylesheet" href="./settings.css" />'
$newCss = '  <link rel="stylesheet" href="./settings.css" />' + $nl +
  '  <link rel="stylesheet" href="./styles/controls.css" />' + $nl +
  '  <link rel="stylesheet" href="./hermes/hermes.css" />'
if ($t.Contains($oldCss)) { $t = $t.Replace($oldCss, $newCss); Write-Host "css links ok" }
else { Write-Host "css links NOT found" }

$pairs = @(
  @('data-i18n="nav.api">API 设置<', '>模型服务<'),
  @('<title>智核</title>', '<title>AI 引擎</title>'),
  @('>智核</span></button>', '>AI 引擎</span></button>'),
  @('智核 · Hermes', 'AI 引擎 · Hermes'),
  @('智能核心（官方 Hermes Agent）运行配置', 'AI 引擎（Hermes Agent）负责思考与执行任务，这里配置它的运行方式'),
  @('data-i18n="nav.tts">TTS 设置<', '>语音合成<'),
  @('data-i18n="nav.asr">ASR 设置<', '>语音识别<'),
  @('data-i18n="nav.channels">连接手机<', '>消息渠道<'),
  @('data-i18n="nav.lsp">LSP 设置<', '>代码辅助<'),
  @('title>LSP 设置</title>', 'title>代码辅助</title>'),
  @('title data-i18n="nav.api">API 设置</title>', 'title>模型服务</title>'),
  @('data-i18n="panel.api">API 设置', 'data-i18n="panel.api">模型服务'),
  @('<h1 data-i18n="panel.api">API 设置</h1>', '<h1 data-i18n="panel.api">模型服务</h1>')
)
foreach ($p in $pairs) {
  $k = $p[0]; $v = $p[1]
  if ($t.Contains($k)) { $t = $t.Replace($k, $v); Write-Host "ok: $k" }
  else { Write-Host "miss: $k" }
}

# insert group labels after nav list open — optional, skip if complex
Set-Content -LiteralPath $f -Value $t -Encoding UTF8
Write-Host "saved"
