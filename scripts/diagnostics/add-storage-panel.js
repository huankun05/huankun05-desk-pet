const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// index.html: nav + panel
let html = fs.readFileSync(dp + "/src/renderer/settings/index.html", "utf8");
if (!html.includes('data-section="storage"')) {
  html = html.replace(
    /(<button type="button" class="nav-item" data-section="general")/,
    `<button type="button" class="nav-item" data-section="storage"><span><svg class="nav-item__icon" width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true"><title>存储与备份</title><rect x="8" y="10" width="32" height="28" rx="4" fill="none" stroke="currentColor" stroke-width="4"/><path d="M8 20h32M20 10v10" stroke="currentColor" stroke-width="4"/></svg></span><span class="nav-item__label">存储与备份</span></button>
        <button type="button" class="nav-item" data-section="general"`,
  );
}
if (!html.includes('data-panel="storage"')) {
  const panel = `
        <section class="settings-panel is-hidden" id="storage-panel" data-panel="storage">
          <div class="panel-heading">
            <div class="panel-heading__icon"><svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><title>存储与备份</title><rect x="8" y="10" width="32" height="28" rx="4" fill="none" stroke="currentColor" stroke-width="4"/><path d="M8 20h32M20 10v10" stroke="currentColor" stroke-width="4"/></svg></div>
            <div>
              <h1>存储与备份</h1>
              <p>查看数据目录、占用分析与缓存清理；备份聊天会话与关键配置。</p>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section__header">
              <h3 class="settings-section__title">数据位置</h3>
              <p class="settings-section__hint" id="storage-location-note">默认 %APPDATA%\\live2d-cyrene</p>
            </div>
            <div class="form-row">
              <label class="form-label">用户数据目录</label>
              <div class="form-control">
                <div id="storage-user-data" class="storage-path">—</div>
                <div class="form-actions">
                  <button type="button" class="btn-secondary" id="storage-open-user-data-btn">打开目录</button>
                </div>
              </div>
            </div>
            <div class="form-row">
              <label class="form-label">程序目录</label>
              <div class="form-control"><div id="storage-program-dir" class="storage-path">—</div></div>
            </div>
            <div class="form-row">
              <label class="form-label" for="storage-location-input">自定义数据目录</label>
              <div class="form-control">
                <input id="storage-location-input" type="text" placeholder="例如 D:\\Data\\deskpet（留空恢复默认）" autocomplete="off" />
                <div class="form-actions">
                  <button type="button" class="btn-secondary" id="storage-save-location-btn">保存位置</button>
                </div>
                <span class="form-hint">保存后需重启应用；环境变量 CYRENE_USER_DATA_DIR 优先级更高</span>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section__header">
              <h3 class="settings-section__title">占用分析</h3>
              <p class="settings-section__hint">总计 <strong id="storage-total">—</strong> · 可清理 <strong id="storage-cleanable">—</strong></p>
            </div>
            <div class="form-actions">
              <button type="button" class="btn-secondary" id="storage-refresh-btn">刷新</button>
              <button type="button" class="btn-secondary" id="storage-clean-all-btn">清理全部可清理项</button>
            </div>
            <div id="storage-dir-list" style="margin-top:12px"></div>
          </div>

          <div class="settings-section">
            <div class="settings-section__header">
              <h3 class="settings-section__title">备份</h3>
              <p class="settings-section__hint">完整备份含人设/技能/设置/会话/配置 JSON</p>
            </div>
            <div class="form-actions">
              <button type="button" class="btn-primary" id="storage-backup-all-btn">完整备份</button>
              <button type="button" class="btn-secondary" id="storage-backup-chats-btn">仅备份会话</button>
              <button type="button" class="btn-secondary" id="storage-backup-data-btn">仅备份配置</button>
            </div>
            <div id="storage-backup-list" style="margin-top:12px"></div>
          </div>

          <div class="form-actions form-actions--sticky">
            <span class="save-status" id="storage-status" hidden></span>
          </div>
        </section>
`;
  html = html.replace(
    /(<section class="settings-panel is-hidden" id="general-form" data-panel="general">)/,
    panel + "\n        $1",
  );
}
if (!html.includes("storage/storage.css")) {
  html = html.replace(
    '<link rel="stylesheet" href="./hermes/hermes.css" />',
    '<link rel="stylesheet" href="./hermes/hermes.css" />\n  <link rel="stylesheet" href="./storage/storage.css" />',
  );
}
fs.writeFileSync(dp + "/src/renderer/settings/index.html", html, "utf8");
console.log("html ok");

// settings.ts
let st = fs.readFileSync(dp + "/src/renderer/settings/settings.ts", "utf8");
if (!st.includes('from "./storage/panel"')) {
  st = st.replace(
    'import { initHermesPanel } from "./hermes/panel";',
    'import { initStoragePanel } from "./storage/panel";',
  );
  if (!st.includes("initStoragePanel")) {
    st = st.replace(
      'import { initLspPanel } from "./lsp/panel";',
      'import { initLspPanel } from "./lsp/panel";\nimport { initStoragePanel } from "./storage/panel";',
    );
  }
}
if (!st.includes("storage:")) {
  st = st.replace(
    "  general:",
    '  storage: { emoji: "💾", title: "存储与备份", hint: "目录占用、缓存清理、数据位置与备份" },\n  general:',
  );
}
if (!st.includes("isStorage")) {
  st = st.replace("  const isGeneral = section === \"general\";", "  const isStorage = section === \"storage\";\n  const isGeneral = section === \"general\";");
  st = st.replace(
    `  const generalForm = document.getElementById`,
    `  const storagePanel = document.getElementById("storage-panel");
  if (storagePanel) storagePanel.classList.toggle("is-hidden", !isStorage);
  if (isStorage) { try { void initStoragePanel(); } catch (e) { console.error("[Storage]", e); } }
  const generalForm = document.getElementById`,
  );
  // if generalForm is imported not getElementById - fix fallback
  if (!st.includes('getElementById("storage-panel")')) {
    st = st.replace(
      "  const isGeneral = section === \"general\";",
      `  const isStorage = section === "storage";
  const isGeneral = section === "general";`,
    );
  }
  st = st.replace(
    /const generalForm = document\.getElementById\("general-form"\);/,
    `const generalForm = document.getElementById("general-form");
  const storagePanelEl = document.getElementById("storage-panel");
  if (storagePanelEl) storagePanelEl.classList.toggle("is-hidden", !isStorage);
  if (isStorage) { try { void initStoragePanel(); } catch (e) { console.error("[Storage]", e); } }`,
  );
  st = st.replace("  generalForm.classList.toggle(\"is-hidden\", !isGeneral);",
    "  generalForm?.classList?.toggle?.(\"is-hidden\", !isGeneral);\n  const storagePanelEl2 = document.getElementById(\"storage-panel\");\n  if (storagePanelEl2) storagePanelEl2.classList.toggle(\"is-hidden\", !isStorage);\n  if (isStorage) { try { void initStoragePanel(); } catch (e) { console.error(\"[Storage]\", e); } }");
  st = st.replace(/isGeneral \|\|/g, "isGeneral || isStorage ||");
  st = st.replace(/!isGeneral &&/g, "!isGeneral &&\n    !isStorage &&");
}
fs.writeFileSync(dp + "/src/renderer/settings/settings.ts", st, "utf8");
console.log("settings.ts patched");

// i18n optional
console.log("done");
