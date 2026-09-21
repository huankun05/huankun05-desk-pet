const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// ── HTML ──
const htmlPath = dp + "/src/renderer/settings/index.html";
let h = fs.readFileSync(htmlPath, "utf8");

const modelRe = /<label class="field field--full" style="position:relative;">[\s\S]*?id="fetch-models-btn"[\s\S]*?<\/label>/;
const modelNeu = `<label class="field field--full" style="position:relative;">
              <span data-i18n="api.modelName">模型名</span>
              <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
                <div style="position:relative;flex:1 1 auto;min-width:160px;">
                  <input id="model-input" type="text" placeholder="选厂商后自动填入，可手填" autocomplete="off" data-i18n="settings.modelPlaceholderDefault" style="width:100%;min-height:40px;padding:8px 12px;border-radius:10px;border:1px solid var(--ui-input-border,#d2d2d7);background:var(--ui-input-bg,#fff);" />
                  <div id="provider-model-dropdown" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:80;border:1px solid var(--ui-border,#e5e5ea);border-radius:10px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.12);overflow:hidden;">
                    <div style="padding:8px;border-bottom:1px solid var(--ui-border,#eee);">
                      <input id="provider-model-search" type="search" placeholder="搜索模型…" style="width:100%;min-height:34px;padding:6px 10px;border-radius:8px;border:1px solid var(--ui-input-border,#d2d2d7);" />
                    </div>
                    <div id="provider-model-list" style="max-height:220px;overflow:auto;padding:4px;"></div>
                  </div>
                </div>
                <!-- 获取成功前隐藏 ▼，成功后显示；与输入框分离 -->
                <button type="button" id="model-list-toggle" class="btn-secondary" title="展开/收起模型列表" aria-label="展开/收起模型列表" style="display:none;min-height:40px;min-width:40px;padding:0 10px;flex:none;">▼</button>
                <button type="button" class="btn-secondary" id="fetch-models-btn" style="min-height:40px;padding:0 14px;white-space:nowrap;flex:none;">获取模型列表</button>
              </div>
            </label>`;

const ctxRe = /<label class="field" style="width:100%;">[\s\S]*?context-window-auto-hint[\s\S]*?<\/label>/;
const ctxNeu = `<label class="field" style="width:100%;position:relative;">
              <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                <span style="white-space:nowrap;font-weight:600;min-width:132px;" data-i18n="api.contextWindow">上下文窗口（Token）</span>
                <div style="position:relative;flex:1 1 200px;min-width:160px;display:flex;align-items:center;">
                  <input id="context-window-input" type="text" inputmode="numeric" placeholder="手填 Token，或点右侧选择推荐值" autocomplete="off" style="width:100%;min-height:40px;padding:8px 40px 8px 12px;border-radius:10px;border:1px solid var(--ui-input-border,#d2d2d7);background:var(--ui-input-bg,#fff);" />
                  <button type="button" id="context-preset-toggle" title="推荐上下文" aria-label="推荐上下文" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);min-height:32px;min-width:32px;border:none;background:transparent;cursor:pointer;font-size:12px;opacity:.6;">▼</button>
                  <div id="context-preset-dropdown" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:79;border:1px solid var(--ui-border,#e5e5ea);border-radius:10px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.12);overflow:hidden;max-height:240px;overflow-y:auto;">
                    <!-- 由脚本填充推荐值 -->
                  </div>
                </div>
              </div>
              <span class="form-hint" id="context-window-auto-hint" style="display:none;"></span>
            </label>`;

if (modelRe.test(h)) { h = h.replace(modelRe, modelNeu); console.log("model html ok"); }
else console.log("model miss");
if (ctxRe.test(h)) { h = h.replace(ctxRe, ctxNeu); console.log("ctx html ok"); }
else console.log("ctx miss");
fs.writeFileSync(htmlPath, h, "utf8");
