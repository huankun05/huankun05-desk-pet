const fs = require("fs");
const path = require("path");

function patch(file, fn) {
  const t = fs.readFileSync(file, "utf8");
  const out = fn(t);
  if (out !== t) {
    fs.writeFileSync(file, out, "utf8");
    console.log("patched", path.basename(file));
  } else console.log("nochange", path.basename(file));
}

const dp = "F:/Work/Create/desk_pet/desk-pet";

// ── 1) package / electron-builder：暂停改名，回到一致的「昔涟 / Cyrene」 ──
patch(path.join(dp, "package.json"), (t) =>
  t
    .replace('"name": "marea"', '"name": "live2d-cyrene"')
    .replace('"description": "汐月 Marea — Live2D 数字生命体桌宠"', '"description": "Live2D desktop pet — Cyrene"'),
);
patch(path.join(dp, "electron-builder.yml"), (t) =>
  t.replace("appId: com.marea.deskpet", "appId: com.cyrene.live2d").replace("productName: 汐月 Marea", "productName: Cyrene"),
);

// ── 2) settings HTML ──
const htmlPath = path.join(dp, "src/renderer/settings/index.html");
patch(htmlPath, (t) => {
  t = t.split("汐月 · 设置").join("昔涟 · 设置");
  t = t.split("汐月").join("昔涟");
  t = t.split("Marea").join("Cyrene");

  // hermes panel: 统一 panel-heading，去掉与「模型服务」重复的字段
  const oldHermesStart = t.indexOf('<section class="settings-panel is-hidden" id="hermes-panel"');
  const oldHermesEnd = t.indexOf("</section>", oldHermesStart);
  if (oldHermesStart < 0 || oldHermesEnd < 0) return t;
  const newHermes = `<section class="settings-panel is-hidden" id="hermes-panel" data-panel="hermes">
          <div class="panel-heading">
            <div class="panel-heading__icon"><svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><title>AI 引擎</title><path d="M24 6C14 6 8 13 8 22c0 7 4 12 10 14v6h12v-6c6-2 10-7 10-14 0-9-6-16-16-16z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><circle cx="18" cy="22" r="2.5" fill="currentColor"/><circle cx="30" cy="22" r="2.5" fill="currentColor"/><path d="M18 30c2 2 10 2 12 0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></div>
            <div>
              <h1>AI 引擎</h1>
              <p>负责思考与执行的本地 Agent（Hermes）。模型厂商与密钥请在「模型服务」配置，这里只管理引擎运行方式。</p>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section__header">
              <h3 class="settings-section__title">运行目录</h3>
              <p class="settings-section__hint">保存后写入 HERMES_HOME/.env，无需手改源文件。</p>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-source-dir">Hermes 源码目录</label>
              <div class="form-control">
                <input id="hermes-source-dir" type="text" placeholder="...\\desk_pet\\hermes-agent" autocomplete="off" />
                <span class="form-hint">含 cli.py / pyproject.toml 的官方检出目录</span>
              </div>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-home-dir">数据目录 HERMES_HOME</label>
              <div class="form-control">
                <input id="hermes-home-dir" type="text" placeholder="...\\desk_pet\\.runtime\\hermes-home" autocomplete="off" />
                <span class="form-hint" id="hermes-env-hint">会话、技能与日志</span>
              </div>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-uv-path">uv 路径</label>
              <div class="form-control">
                <input id="hermes-uv-path" type="text" placeholder="uv.exe 全路径或 uv" autocomplete="off" />
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section__header">
              <h3 class="settings-section__title">本地接口</h3>
              <p class="settings-section__hint">应用通过 http://地址:端口 + 密钥访问引擎。</p>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-api-host">监听地址</label>
              <div class="form-control"><input id="hermes-api-host" type="text" value="127.0.0.1" /></div>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-api-port">端口</label>
              <div class="form-control"><input id="hermes-api-port" type="number" min="1" max="65535" value="8642" /></div>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-api-key">访问密钥</label>
              <div class="form-control">
                <input id="hermes-api-key" type="text" autocomplete="off" placeholder="保存或生成后写入 .env" />
                <div class="form-actions" style="margin-top:8px">
                  <button type="button" class="btn-secondary" id="hermes-generate-key-btn">生成密钥</button>
                  <button type="button" class="btn-secondary" id="hermes-health-btn">检查健康</button>
                </div>
                <span class="form-hint" id="hermes-health">未检测</span>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section__header">
              <h3 class="settings-section__title">与「模型服务」的关系</h3>
              <p class="settings-section__hint">厂商、API Key、模型名只在「模型服务」维护；引擎页一键读取并写入引擎配置，避免两处重复填写。</p>
            </div>
            <div class="form-row">
              <label class="form-label" for="hermes-sync-model">保存模型服务后自动同步</label>
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
                <span class="form-hint">进程托管在下一阶段完善；当前仅保存配置</span>
              </div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn-secondary" id="hermes-sync-model-btn">从模型服务同步到引擎</button>
            </div>
          </div>

          <div class="form-actions form-actions--sticky">
            <span class="save-status" id="hermes-save-status" hidden></span>
            <button type="button" class="btn-primary" id="hermes-save-btn">保存引擎设置</button>
          </div>
        `;
  t = t.slice(0, oldHermesStart) + newHermes + t.slice(oldHermesEnd);

  // 补齐 nav：音乐 / 角色专页（避免有面板无入口）
  if (!t.includes('data-section="music"')) {
    t = t.replace(
      /(<button type="button" class="nav-item" data-section="memory")/,
      `<button type="button" class="nav-item" data-section="cyrene"><span><svg class="nav-item__icon" width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true"><title>角色专页</title><circle cx="24" cy="16" r="8" fill="none" stroke="currentColor" stroke-width="4"/><path d="M10 42C10 34 16 28 24 28C32 28 38 34 38 42" fill="none" stroke="currentColor" stroke-width="4"/></svg></span><span class="nav-item__label">角色专页</span></button>
        <button type="button" class="nav-item" data-section="memory"`,
    );
  }
  if (!t.includes('data-section="music"')) {
    t = t.replace(
      /(<button type="button" class="nav-item" data-section="asr")/,
      `<button type="button" class="nav-item" data-section="music"><span><svg class="nav-item__icon" width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true"><title>音乐</title><path d="M18 34V12l22-4v22" stroke="currentColor" stroke-width="4" fill="none"/><circle cx="14" cy="34" r="6" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="36" cy="30" r="6" fill="none" stroke="currentColor" stroke-width="4"/></svg></span><span class="nav-item__label">音乐</span></button>
        <button type="button" class="nav-item" data-section="asr"`,
    );
  }

  // 标题栏默认提示
  t = t.replace("填写模型服务配置，保存在本地。", "在左侧选择要配置的功能。");
  return t;
});

// ── 3) panel.ts：去掉重复模型字段 ──
patch(path.join(dp, "src/renderer/settings/hermes/panel.ts"), (t) => {
  t = t.replace(
    '  setVal("hermes-default-model", s.defaultModel || "");\n  setVal("hermes-model-provider", s.modelProvider || "");\n',
    "",
  );
  t = t.replace(
    `    defaultModel: el<HTMLInputElement>("hermes-default-model")?.value.trim() ?? "",
    modelProvider: el<HTMLInputElement>("hermes-model-provider")?.value.trim() ?? "",
`,
    "",
  );
  t = t.replace("从模型服务同步", "从模型服务同步");
  t = t.replace(
    "const keys = res.written?.length ? res.written.join(\", \") : \"(未找到可同步的模型 Key，请先在「API 设置」填写)\";",
    "const keys = res.written?.length ? res.written.join(\", \") : \"(未找到可同步的模型 Key，请先在「模型服务」填写)\";",
  );
  return t;
});

// ── 4) settings.ts NAV_LABELS ──
patch(path.join(dp, "src/renderer/settings/settings.ts"), (t) => {
  if (!t.includes("cyrene:")) {
    t = t.replace(
      "  memory:",
      "  cyrene: { emoji: \"🌸\", title: \"角色专页\", hint: \"当前角色的详细设定\" },\n  music: { emoji: \"🎵\", title: \"音乐\", hint: \"音乐与氛围音\" },\n  memory:",
    );
  }
  t = t.split("汐月").join("昔涟");
  return t;
});

// ── 5) vite plugin 注释里的汐月 ──
patch(path.join(dp, "vite.config.ts"), (t) => t.split("汐月").join("昔涟"));

// ── 6) controls.css：统一分区标题（无论有无 panel-heading）──
const controls = path.join(dp, "src/renderer/settings/styles/controls.css");
if (fs.existsSync(controls)) {
  let c = fs.readFileSync(controls, "utf8");
  if (!c.includes("/* 统一分区标题 */")) {
    c += `

/* 统一分区标题：有/无 panel-heading 的面板都使用同一层级样式 */
.settings-panel > .settings-section:first-child {
  margin-top: 4px;
}
.settings-section__title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.settings-section__title::before {
  content: "";
  display: inline-block;
  width: 4px;
  height: 14px;
  border-radius: 2px;
  background: var(--brand-primary, var(--rb-pink-500, #ff5b8a));
  flex: none;
}
.panel-heading + .settings-section .settings-section__title::before {
  /* 面板已有大标题时，小节仍保留短竖线，层级一致 */
  opacity: 0.85;
}
`;
    fs.writeFileSync(controls, c, "utf8");
    console.log("controls.css appended");
  }
}

console.log("done");
