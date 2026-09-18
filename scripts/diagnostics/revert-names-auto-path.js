const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

function patch(file, fn) {
  let t = fs.readFileSync(file, "utf8");
  const n = fn(t);
  if (n !== t) {
    fs.writeFileSync(file, n, "utf8");
    console.log("ok", file);
  } else console.log("skip", file);
}

// ── 名称全部还原（产品/设置导航/面板标题），以后不再改 ──
const nameMap = [
  [">模型服务<", ">API 设置<"],
  ["title>模型服务</title>", "title>API 设置</title>"],
  ["panel.api\">模型服务", "panel.api\">API 设置"],
  ["<h1 data-i18n=\"panel.api\">模型服务</h1>", "<h1 data-i18n=\"panel.api\">API 设置</h1>"],
  [">语音合成<", ">TTS 设置<"],
  [">语音识别<", ">ASR 设置<"],
  [">消息渠道<", ">连接手机<"],
  [">代码辅助<", ">LSP 设置<"],
  ["title>代码辅助</title>", "title>LSP 设置</title>"],
  [">AI 引擎<", ">本地引擎<"],
  ["title>AI 引擎</title>", "title>本地引擎</title>"],
  ["AI 引擎 · Hermes", "本地引擎"],
  ["汐月", "昔涟"],
  ["Marea", "Cyrene"],
];

patch(dp + "/src/renderer/settings/index.html", (t) => {
  for (const [a, b] of nameMap) t = t.split(a).join(b);

  // 本地引擎面板：路径只读展示，不要求手填
  const start = t.indexOf('<section class="settings-panel is-hidden" id="hermes-panel"');
  const end = t.indexOf("</section>", start);
  if (start >= 0 && end > start) {
    const panel = `<section class="settings-panel is-hidden" id="hermes-panel" data-panel="hermes">
          <div class="panel-heading">
            <div class="panel-heading__icon"><svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><title>本地引擎</title><path d="M24 6C14 6 8 13 8 22c0 7 4 12 10 14v6h12v-6c6-2 10-7 10-14 0-9-6-16-16-16z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><circle cx="18" cy="22" r="2.5" fill="currentColor"/><circle cx="30" cy="22" r="2.5" fill="currentColor"/><path d="M18 30c2 2 10 2 12 0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></div>
            <div>
              <h1>本地引擎</h1>
              <p>应用内置的 Agent 大脑（Hermes）。路径自动探测；模型与密钥在「API 设置」配置，这里一键同步。</p>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section__header">
              <h3 class="settings-section__title">运行状态</h3>
              <p class="settings-section__hint" id="hermes-env-hint">自动探测引擎安装位置</p>
            </div>
            <div class="form-row">
              <label class="form-label">引擎源码</label>
              <div class="form-control"><code id="hermes-source-dir-view" style="font-size:12px;word-break:break-all">—</code></div>
            </div>
            <div class="form-row">
              <label class="form-label">数据目录</label>
              <div class="form-control"><code id="hermes-home-dir-view" style="font-size:12px;word-break:break-all">—</code></div>
            </div>
            <div class="form-row">
              <label class="form-label">uv</label>
              <div class="form-control"><code id="hermes-uv-path-view" style="font-size:12px;word-break:break-all">—</code></div>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-health-btn">健康检查</label>
              <div class="form-control">
                <div class="form-actions">
                  <button type="button" class="btn-secondary" id="hermes-health-btn">检查健康</button>
                  <button type="button" class="btn-secondary" id="hermes-generate-key-btn">生成访问密钥</button>
                </div>
                <span class="form-hint" id="hermes-health">未检测</span>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section__header">
              <h3 class="settings-section__title">与 API 设置</h3>
              <p class="settings-section__hint">厂商与密钥只在「API 设置」维护；引擎从这里同步，避免重复填写。</p>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-sync-model">保存 API 设置后自动同步引擎</label>
              <div class="form-control">
                <label class="toggle-switch">
                  <input type="checkbox" id="hermes-sync-model" checked />
                  <span class="toggle-switch__slider"></span>
                </label>
              </div>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-auto-start">启动应用时拉起引擎</label>
              <div class="form-control">
                <label class="toggle-switch">
                  <input type="checkbox" id="hermes-auto-start" />
                  <span class="toggle-switch__slider"></span>
                </label>
              </div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn-secondary" id="hermes-sync-model-btn">从 API 设置同步到引擎</button>
            </div>
          </div>

          <div class="form-actions form-actions--sticky">
            <span class="save-status" id="hermes-save-status" hidden></span>
            <button type="button" class="btn-primary" id="hermes-save-btn">保存</button>
          </div>
        `;
    t = t.slice(0, start) + panel + t.slice(end);
  }
  return t;
});

patch(dp + "/src/renderer/settings/settings.ts", (t) => {
  for (const [a, b] of [
    ['title: "模型服务", hint: "配置模型厂商与 API Key"', 'title: t("nav.api"), hint: t("hint.api")'],
    ['title: "AI 引擎", hint: "Hermes 运行配置：路径、端口、密钥、模型同步"', 'title: "本地引擎", hint: "内置 Agent 大脑（自动探测路径）"'],
    ['title: "代码辅助", hint: "语言服务器，辅助写代码"', 'title: t("nav.lsp"), hint: t("hint.lsp")'],
    ['title: "语音合成", hint: "让角色说话的声音引擎"', 'title: t("nav.tts"), hint: t("hint.tts")'],
    ['title: "语音识别", hint: "听懂你说的话"', 'title: t("nav.asr"), hint: t("hint.asr")'],
    ['title: "消息渠道", hint: "连接 QQ / 微信 / 飞书 等"', 'title: t("nav.channels"), hint: t("hint.channels")'],
  ]) t = t.split(a).join(b);
  return t;
});

// i18n 导航名还原
patch(dp + "/src/renderer/settings/i18n/zh-CN.json", (t) => {
  t = t.replace('"api": "模型服务"', '"api": "API 设置"');
  t = t.replace('"tts": "语音合成"', '"tts": "TTS 设置"');
  t = t.replace('"asr": "语音识别"', '"asr": "ASR 设置"');
  t = t.replace('"channels": "消息渠道"', '"channels": "连接手机"');
  t = t.replace('"lsp": "代码辅助"', '"lsp": "LSP 设置"');
  return t;
});
patch(dp + "/src/renderer/settings/i18n/en-US.json", (t) => {
  t = t.replace('"api": "Model Service"', '"api": "API Settings"');
  t = t.replace('"tts": "Speech Synthesis"', '"tts": "TTS Settings"');
  t = t.replace('"asr": "Speech Recognition"', '"asr": "ASR Settings"');
  t = t.replace('"lsp": "Code Assist"', '"lsp": "LSP Settings"');
  return t;
});

// 打包名还原
patch(dp + "/package.json", (t) =>
  t.replace('"name": "marea"', '"name": "live2d-cyrene"').replace(/"description": ".*"/, '"description": "Live2D desktop pet — Cyrene"'),
);
patch(dp + "/electron-builder.yml", (t) =>
  t.replace("appId: com.marea.deskpet", "appId: com.cyrene.live2d").replace(/^productName: .*$/m, "productName: Cyrene"),
);

console.log("done");
