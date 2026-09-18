const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/index.html";
let t = fs.readFileSync(f, "utf8");
const nl = "\r\n";
const oldCss = '  <link rel="stylesheet" href="./settings.css" />';
const newCss =
  oldCss +
  nl +
  '  <link rel="stylesheet" href="./styles/controls.css" />' +
  nl +
  '  <link rel="stylesheet" href="./hermes/hermes.css" />';
if (t.includes(oldCss)) {
  t = t.replace(oldCss, newCss);
  console.log("css ok");
} else {
  console.log("css miss");
}

const pairs = [
  ['data-i18n="nav.api">API 设置<', ">模型服务<"],
  ["<title>智核</title>", "<title>AI 引擎</title>"],
  [">智核</span></button>", ">AI 引擎</span></button>"],
  ["智核 · Hermes", "AI 引擎 · Hermes"],
  [
    "智能核心（官方 Hermes Agent）运行配置",
    "AI 引擎（Hermes Agent）负责思考与执行任务，这里配置它的运行方式",
  ],
  ['data-i18n="nav.tts">TTS 设置<', ">语音合成<"],
  ['data-i18n="nav.asr">ASR 设置<', ">语音识别<"],
  ['data-i18n="nav.channels">连接手机<', ">消息渠道<"],
  ['data-i18n="nav.lsp">LSP 设置<', ">代码辅助<"],
  ["title>LSP 设置</title>", "title>代码辅助</title>"],
  ['data-i18n="nav.api">API 设置</title>', "title>模型服务</title>"],
  ['<h1 data-i18n="panel.api">API 设置</h1>', '<h1 data-i18n="panel.api">模型服务</h1>'],
  ['data-i18n="panel.api">API 设置', 'data-i18n="panel.api">模型服务'],
  ['data-i18n="api.headingDesc">先配置一个模型服务', 'data-i18n="api.headingDesc">先配置模型服务'],
];

for (const [k, v] of pairs) {
  if (t.includes(k)) {
    t = t.split(k).join(v);
    console.log("ok", k.slice(0, 48));
  } else {
    console.log("miss", k.slice(0, 48));
  }
}

fs.writeFileSync(f, t, "utf8");
console.log("saved bytes", Buffer.byteLength(t));
