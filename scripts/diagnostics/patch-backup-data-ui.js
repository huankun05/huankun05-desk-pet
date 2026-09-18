const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/index.html";
let t = fs.readFileSync(f, "utf8");

// Expand backup category options
t = t.replace(
  `<option value="all" data-i18n="backup.all">全部（人设 + 风格 + 配置）</option>`,
  `<option value="all" data-i18n="backup.all">全部（配置 + 聊天 + 技能 + 人设）</option>`,
);
if (!t.includes('value="chats"')) {
  t = t.replace(
    `<option value="skills" data-i18n="backup.skillsOnly">仅技能</option>`,
    `<option value="skills" data-i18n="backup.skillsOnly">仅技能</option>
                    <option value="chats">仅聊天与检查点</option>
                    <option value="data">仅关键配置（模型/渠道等）</option>`,
  );
}

// heading desc
t = t.replace(
  `data-i18n="backup.headingDesc">备份和恢复人设、风格、角色配置和应用设置。修改人设或风格时会自动备份。`,
  `data-i18n="backup.headingDesc">备份/恢复配置、聊天、技能与人设。可查看数据目录占用并清理缓存。`,
);

// Insert data directory section after panel-heading, before 手动备份
const insertAfter = `          </div>

          <!-- 手动备份区域 -->`;
const dataSection = `          </div>

          <!-- 数据目录与占用 -->
          <div class="settings-section">
            <div class="settings-section__heading">
              <h2>数据目录</h2>
              <p class="settings-section__hint" id="data-root-path">数据根目录加载中…</p>
            </div>
            <div class="settings-section__body">
              <div id="data-paths-list" style="font-size:12.5px;line-height:1.7;color:var(--ui-text-default,#2c2c2e);"></div>
              <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
                <button type="button" class="btn-secondary" id="data-usage-scan-btn">刷新占用</button>
                <button type="button" class="btn-secondary" id="data-usage-clean-btn">清理缓存</button>
                <button type="button" class="btn-secondary" id="data-usage-open-root-btn">打开数据文件夹</button>
                <span class="save-status" id="data-usage-summary"></span>
              </div>
              <div id="data-usage-table" style="margin-top:12px;font-size:12.5px;"></div>
            </div>
          </div>

          <!-- 手动备份区域 -->`;
if (t.includes(insertAfter) && !t.includes("data-usage-scan-btn")) {
  t = t.replace(insertAfter, dataSection);
  console.log("data section inserted");
} else {
  console.log("insert point miss or already present");
}

fs.writeFileSync(f, t, "utf8");
