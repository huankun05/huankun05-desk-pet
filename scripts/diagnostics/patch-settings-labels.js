const fs = require("fs");

// 1) settings.ts NAV_LABELS
const st = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let s = fs.readFileSync(st, "utf8");
const navPairs = [
  [
    'api: { emoji: `<svg style="vertical-align:-3px" width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>API 设置</title>',
    'api: { emoji: `<svg style="vertical-align:-3px" width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>模型服务</title>',
  ],
  ['title: t("nav.api"), hint: t("hint.api")', 'title: "模型服务", hint: "配置模型厂商与 API Key"'],
  ['hermes: { emoji: "🧠", title: "智核", hint: "智能核心（Hermes）路径、端口、密钥与模型同步" }', 'hermes: { emoji: "🧠", title: "AI 引擎", hint: "Hermes 运行配置：路径、端口、密钥、模型同步" }'],
  ['lsp: { emoji: "🧩", title: t("nav.lsp"), hint: t("hint.lsp") }', 'lsp: { emoji: "🧩", title: "代码辅助", hint: "语言服务器，辅助写代码" }'],
  ['tts: { emoji: "🎙️", title: t("nav.tts"), hint: t("hint.tts") }', 'tts: { emoji: "🎙️", title: "语音合成", hint: "让角色说话的声音引擎" }'],
  ['asr: { emoji: "🎧", title: t("nav.asr"), hint: t("hint.asr") }', 'asr: { emoji: "🎧", title: "语音识别", hint: "听懂你说的话" }'],
  ['channels: { emoji: "📱", title: t("nav.channels"), hint: t("hint.channels") }', 'channels: { emoji: "📱", title: "消息渠道", hint: "连接 QQ / 微信 / 飞书 等" }'],
];
for (const [k, v] of navPairs) {
  if (s.includes(k)) { s = s.split(k).join(v); console.log("settings.ts ok"); }
  else console.log("settings.ts miss", k.slice(0, 50));
}
fs.writeFileSync(st, s, "utf8");

// 2) i18n zh-CN
const zhPath = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/i18n/zh-CN.json";
let zh = fs.readFileSync(zhPath, "utf8");
const zhPairs = [
  ['"api": "API 设置"', '"api": "模型服务"'],
  ['"tts": "TTS 设置"', '"tts": "语音合成"'],
  ['"asr": "ASR 设置"', '"asr": "语音识别"'],
  ['"channels": "连接手机"', '"channels": "消息渠道"'],
  ['"lsp": "LSP 设置"', '"lsp": "代码辅助"'],
  ['"api": "配置模型服务"', '"api": "配置模型厂商与密钥"'],
];
for (const [k, v] of zhPairs) {
  if (zh.includes(k)) { zh = zh.split(k).join(v); console.log("zh ok", k); }
  else console.log("zh miss", k);
}
fs.writeFileSync(zhPath, zh, "utf8");

// 3) i18n en-US
const enPath = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/i18n/en-US.json";
let en = fs.readFileSync(enPath, "utf8");
const enPairs = [
  ['"api": "API Settings"', '"api": "Model Service"'],
  ['"tts": "TTS Settings"', '"tts": "Speech Synthesis"'],
  ['"asr": "ASR Settings"', '"asr": "Speech Recognition"'],
  ['"channels": "Connect Phone"', '"channels": "Messaging Channels"'],
  ['"lsp": "LSP Settings"', '"lsp": "Code Assist"'],
];
for (const [k, v] of enPairs) {
  if (en.includes(k)) { en = en.split(k).join(v); console.log("en ok", k); }
  else console.log("en miss", k);
}
fs.writeFileSync(enPath, en, "utf8");

// 4) insert group labels in settings nav HTML
const hf = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/index.html";
let h = fs.readFileSync(hf, "utf8");
const inserts = [
  ['<nav class="settings-nav__list">', '<nav class="settings-nav__list">\n        <span class="settings-nav__group-label">模型与智能</span>'],
  ['data-section="character-style"', null], // handled below
];
if (h.includes('<nav class="settings-nav__list">\n        <span class="settings-nav__group-label">')) {
  console.log("group label already present");
} else {
  h = h.replace(
    '<nav class="settings-nav__list">',
    '<nav class="settings-nav__list">\n        <span class="settings-nav__group-label">模型与智能</span>',
  );
  // before character-style button
  h = h.replace(
    /(\s*)(<button type="button" class="nav-item" data-section="character-style")/,
    '$1<span class="settings-nav__group-label">角色与体验</span>\n$1$2',
  );
  h = h.replace(
    /(\s*)(<button type="button" class="nav-item" data-section="tts")/,
    '$1<span class="settings-nav__group-label">语音</span>\n$1$2',
  );
  h = h.replace(
    /(\s*)(<button type="button" class="nav-item" data-section="channels")/,
    '$1<span class="settings-nav__group-label">连接与工具</span>\n$1$2',
  );
  h = h.replace(
    /(\s*)(<button type="button" class="nav-item" data-section="backup")/,
    '$1<span class="settings-nav__group-label">数据与任务</span>\n$1$2',
  );
  h = h.replace(
    /(\s*)(<button type="button" class="nav-item" data-section="general")/,
    '$1<span class="settings-nav__group-label">其他</span>\n$1$2',
  );
  fs.writeFileSync(hf, h, "utf8");
  console.log("group labels inserted");
}

// 5) hermes panel.ts status copy
const pp = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/hermes/panel.ts";
let p = fs.readFileSync(pp, "utf8");
p = p.replace("已保存并写入 .env", "已保存，配置已写入 AI 引擎运行目录");
fs.writeFileSync(pp, p, "utf8");
console.log("done");
