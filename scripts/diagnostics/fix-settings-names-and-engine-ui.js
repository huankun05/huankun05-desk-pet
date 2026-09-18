const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

function patch(file, fn) {
  const t = fs.readFileSync(file, "utf8");
  const n = fn(t);
  if (n !== t) {
    fs.writeFileSync(file, n, "utf8");
    console.log("ok", file.split("/").pop());
  } else console.log("skip", file.split("/").pop());
}

// 设置功能名 → 通俗（产品名仍是 昔涟/Cyrene，不动）
const navMap = [
  [">API 设置<", ">模型服务<"],
  ["title>API 设置</title>", "title>模型服务</title>"],
  ["panel.api\">API 设置", "panel.api\">模型服务"],
  ["<h1 data-i18n=\"panel.api\">API 设置</h1>", "<h1 data-i18n=\"panel.api\">模型服务</h1>"],
  [">TTS 设置<", ">语音合成<"],
  [">ASR 设置<", ">语音识别<"],
  [">连接手机<", ">消息渠道<"],
  [">LSP 设置<", ">代码辅助<"],
  ["title>LSP 设置</title>", "title>代码辅助</title>"],
  [">本地引擎<", ">AI 引擎<"],
  ["title>本地引擎</title>", "title>AI 引擎</title>"],
];

patch(dp + "/src/renderer/settings/index.html", (t) => {
  for (const [a, b] of navMap) t = t.split(a).join(b);

  // AI 引擎：零路径，只显示连接状态与动作
  const start = t.indexOf('<section class="settings-panel is-hidden" id="hermes-panel"');
  const end = t.indexOf("</section>", start);
  if (start < 0 || end < 0) return t;
  const panel = `<section class="settings-panel is-hidden" id="hermes-panel" data-panel="hermes">
          <div class="panel-heading">
            <div class="panel-heading__icon"><svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><title>AI 引擎</title><path d="M24 6C14 6 8 13 8 22c0 7 4 12 10 14v6h12v-6c6-2 10-7 10-14 0-9-6-16-16-16z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><circle cx="18" cy="22" r="2.5" fill="currentColor"/><circle cx="30" cy="22" r="2.5" fill="currentColor"/><path d="M18 30c2 2 10 2 12 0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></div>
            <div>
              <h1>AI 引擎</h1>
              <p>应用内置的智能核心，负责思考与执行。随应用自动连接，无需配置路径。</p>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section__header">
              <h3 class="settings-section__title">连接状态</h3>
              <p class="settings-section__hint" id="hermes-env-hint">引擎与应用一体，启动后自动就绪</p>
            </div>
            <div class="form-row">
              <label class="form-label">引擎</label>
              <div class="form-control">
                <span class="form-hint" id="hermes-health">检测中…</span>
                <div class="form-actions">
                  <button type="button" class="btn-secondary" id="hermes-health-btn">刷新状态</button>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section__header">
              <h3 class="settings-section__title">模型</h3>
              <p class="settings-section__hint">厂商与密钥在「模型服务」配置；引擎自动使用同一套配置。</p>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-sync-model">模型服务变更后自动同步引擎</label>
              <div class="form-control">
                <label class="toggle-switch">
                  <input type="checkbox" id="hermes-sync-model" checked />
                  <span class="toggle-switch__slider"></span>
                </label>
              </div>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-auto-start">随应用自动启动引擎</label>
              <div class="form-control">
                <label class="toggle-switch">
                  <input type="checkbox" id="hermes-auto-start" checked />
                  <span class="toggle-switch__slider"></span>
                </label>
                <span class="form-hint">默认开启；关闭后需在进程层手动维护引擎</span>
              </div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn-secondary" id="hermes-sync-model-btn">立即同步模型配置</button>
            </div>
          </div>

          <div class="form-actions form-actions--sticky">
            <span class="save-status" id="hermes-save-status" hidden></span>
            <button type="button" class="btn-primary" id="hermes-save-btn">保存</button>
          </div>
        `;
  return t.slice(0, start) + panel + t.slice(end);
});

patch(dp + "/src/renderer/settings/settings.ts", (t) => {
  for (const [a, b] of [
    ['title: t("nav.api"), hint: t("hint.api")', 'title: "模型服务", hint: "配置模型厂商与 API Key"'],
    ['title: "本地引擎", hint: "内置 Agent 大脑（自动探测路径）"', 'title: "AI 引擎", hint: "内置智能核心，随应用自动连接"'],
    ['title: t("nav.lsp"), hint: t("hint.lsp")', 'title: "代码辅助", hint: "语言服务器，辅助写代码"'],
    ['title: t("nav.tts"), hint: t("hint.tts")', 'title: "语音合成", hint: "让角色说话的声音引擎"'],
    ['title: t("nav.asr"), hint: t("hint.asr")', 'title: "语音识别", hint: "听懂你说的话"'],
    ['title: t("nav.channels"), hint: t("hint.channels")', 'title: "消息渠道", hint: "连接 QQ / 微信 / 飞书 等"'],
  ]) t = t.split(a).join(b);
  return t;
});

patch(dp + "/src/renderer/settings/i18n/zh-CN.json", (t) => {
  t = t.replace('"api": "API 设置"', '"api": "模型服务"');
  t = t.replace('"tts": "TTS 设置"', '"tts": "语音合成"');
  t = t.replace('"asr": "ASR 设置"', '"asr": "语音识别"');
  t = t.replace('"channels": "连接手机"', '"channels": "消息渠道"');
  t = t.replace('"lsp": "LSP 设置"', '"lsp": "代码辅助"');
  return t;
});
patch(dp + "/src/renderer/settings/i18n/en-US.json", (t) => {
  t = t.replace('"api": "API Settings"', '"api": "Model Service"');
  t = t.replace('"tts": "TTS Settings"', '"tts": "Speech"');
  t = t.replace('"asr": "ASR Settings"', '"asr": "Speech Input"');
  t = t.replace('"lsp": "LSP Settings"', '"lsp": "Code Assist"');
  return t;
});

// panel.ts：不再读/写路径字段
patch(dp + "/src/renderer/settings/hermes/panel.ts", (t) => {
  return `/**
 * AI 引擎设置：路径由应用内部处理，界面只管理连接与模型同步。
 */

type Health = { ok: boolean; status: number; body: string; baseUrl: string };

function api() {
  const s = (window as unknown as { settingsApi?: { hermes?: Record<string, (...args: never[]) => Promise<unknown>> } }).settingsApi;
  return s?.hermes ?? null;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setStatus(text: string, ok?: boolean): void {
  const node = el("hermes-save-status");
  if (!node) return;
  node.hidden = !text;
  node.textContent = text;
  node.style.color = ok === false ? "#d1495b" : "";
}

function renderHealth(h: Health | null): void {
  const node = el("hermes-health");
  if (!node) return;
  if (!h) {
    node.textContent = "未检测";
    return;
  }
  node.textContent = h.ok ? "已连接" : "未连接（引擎可能未随应用启动）";
  node.style.color = h.ok ? "#0b6b5c" : "#a63a49";
}

let inited = false;

export async function initHermesPanel(): Promise<void> {
  if (inited) return;
  inited = true;
  const bridge = api();
  if (!bridge) {
    setStatus("设置 API 不可用", false);
    return;
  }

  const load = async () => {
    try {
      const res = (await bridge.getSettings()) as {
        settings: { syncModelCredentials?: boolean; autoStartGateway?: boolean };
        health: Health;
      };
      const sync = el<HTMLInputElement>("hermes-sync-model");
      if (sync) sync.checked = res.settings.syncModelCredentials !== false;
      const auto = el<HTMLInputElement>("hermes-auto-start");
      if (auto) auto.checked = res.settings.autoStartGateway !== false;
      renderHealth(res.health);
      setStatus("");
    } catch (err) {
      setStatus(String(err), false);
    }
  };

  el("hermes-save-btn")?.addEventListener("click", () => {
    void (async () => {
      try {
        await bridge.saveSettings({
          syncModelCredentials: el<HTMLInputElement>("hermes-sync-model")?.checked !== false,
          autoStartGateway: el<HTMLInputElement>("hermes-auto-start")?.checked !== false,
        });
        setStatus("已保存", true);
      } catch (err) {
        setStatus(String(err), false);
      }
    })();
  });

  el("hermes-sync-model-btn")?.addEventListener("click", () => {
    void (async () => {
      try {
        const res = (await bridge.syncModelCredentials()) as { written?: string[] };
        setStatus(res.written?.length ? "模型配置已同步到引擎" : "模型服务里还没有可用配置", true);
        await load();
      } catch (err) {
        setStatus(String(err), false);
      }
    })();
  });

  el("hermes-health-btn")?.addEventListener("click", () => {
    void (async () => {
      try {
        renderHealth((await bridge.testHealth()) as Health);
      } catch (err) {
        setStatus(String(err), false);
      }
    })();
  });

  await load();
}
`;
});

console.log("done");
