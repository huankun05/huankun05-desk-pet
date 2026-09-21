const fs = require("fs");
const { execSync } = require("child_process");
const cwd = "F:/Work/Create/desk_pet/desk-pet";
const good = execSync("git show fd90c40:src/renderer/settings/index.html", { cwd, encoding: "utf8" });
const curPath = cwd + "/src/renderer/settings/index.html";
const cur = fs.readFileSync(curPath, "utf8");

// 从 good 中提取 profile editor 表单（含 display-name 到 multimodal）
const startTag = '<div class="profile-editor-heading">';
const start = good.indexOf(startTag);
if (start < 0) throw new Error("no heading in good");
const multi = good.indexOf('profile-multimodal-row', start);
const endLabel = good.indexOf("</label>", multi);
const end = endLabel + "</label>".length;
let segment = good.slice(start, end);

// 改进 model / context 行（按我们最终 UI）
segment = segment.replace(
  /<label class="field field--full">[\s\S]*?<\/label>(\s*<label class="field">[\s\S]*?context-window-auto-hint[\s\S]*?<\/label>)?/,
  (m, ctxPart) => {
    return `<label class="field field--full">
              <span data-i18n="api.modelName">模型名</span>
              <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
                <input id="model-input" type="text" placeholder="选厂商后自动填入，可手填" autocomplete="off" data-i18n="settings.modelPlaceholderDefault" style="flex:1 1 240px;min-width:200px;min-height:40px;padding:8px 12px;border-radius:10px;border:1px solid var(--ui-input-border,#d2d2d7);background:var(--ui-input-bg,#fff);" />
                <button type="button" class="btn-secondary" id="fetch-models-btn" style="min-height:40px;padding:0 16px;white-space:nowrap;">获取模型列表</button>
              </div>
              <datalist id="model-input-suggestions"></datalist>
              <div id="provider-model-dropdown" style="display:none;margin-top:8px;border:1px solid var(--ui-border,#e5e5ea);border-radius:12px;background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.06);overflow:hidden;">
                <div style="padding:8px 10px;border-bottom:1px solid var(--ui-border,#eee);">
                  <input id="provider-model-search" type="search" placeholder="搜索模型…" style="width:100%;min-height:36px;padding:6px 10px;border-radius:8px;border:1px solid var(--ui-input-border,#d2d2d7);" />
                </div>
                <div id="provider-model-list" style="max-height:240px;overflow:auto;padding:6px;"></div>
              </div>
            </label>

            <label class="field" style="width:100%;">
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:4px;width:100%;">
                <span data-i18n="api.contextWindow" style="white-space:nowrap;font-weight:600;">上下文窗口（Token）</span>
                <select id="context-window-preset" class="setting-select" style="flex:0 1 320px;min-width:260px;max-width:100%;min-height:40px;">
                  <option value="">常用规格…</option>
                  <option value="8192">8K（8192）</option>
                  <option value="32768">32K（32768）</option>
                  <option value="65536">64K（65536）</option>
                  <option value="131072">128K（131072）</option>
                  <option value="200000">200K（200000）</option>
                  <option value="262144">256K（262144）</option>
                  <option value="524288">512K（524288）</option>
                  <option value="1048576">1M（1048576）</option>
                  <option value="__custom__">自定义…</option>
                </select>
                <input id="context-window-input" type="number" min="4096" step="1" placeholder="131072" autocomplete="off" style="flex:0 0 140px;width:140px;min-height:40px;" />
                <span class="form-hint" data-i18n="api.contextWindowHint" style="flex:1 1 200px;min-width:140px;text-align:right;margin:0;">单位 Token。可手填；选模型后自动带出。</span>
              </div>
              <span class="form-hint" id="context-window-auto-hint" style="display:none;"></span>
            </label>`;
  },
);

// 替换当前文件里损坏的 form-grid（profile-editor-heading 到 multimodal）
const curStart = cur.indexOf(startTag);
const curMulti = cur.indexOf("profile-multimodal-row", curStart);
const curEnd = cur.indexOf("</label>", curMulti) + "</label>".length;
if (curStart < 0 || curMulti < 0) throw new Error("current form markers missing");
const next = cur.slice(0, curStart) + segment + cur.slice(curEnd);
fs.writeFileSync(curPath, next, "utf8");
console.log("restored form ok");
console.log("has display-name", next.includes('id="display-name"'));
console.log("has model-input", next.includes('id="model-input"'));
console.log("has fetch-models-btn", next.includes('id="fetch-models-btn"'));
console.log("has api-key-input", next.includes('id="api-key-input"'));
console.log("has base-url-input", next.includes('id="base-url-input"'));
