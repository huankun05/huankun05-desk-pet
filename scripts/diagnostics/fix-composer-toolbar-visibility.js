const fs = require("fs");
const dp = "F:/Work/Create/desk_pet/desk-pet";

// ── ChatComposer: 四模式都显示 权限 / 模型 / 思考强度 / 上下文 ──
const composer = dp + "/src/renderer/react/features/chat/components/ChatComposer.tsx";
let c = fs.readFileSync(composer, "utf8");
c = c.replace(
  "const supportsPermission = supportsWorkFiles || supportsObsidianLibrary;",
  "const supportsPermission = true; // 四模式均显示权限等级",
);
fs.writeFileSync(composer, c, "utf8");
console.log("composer permission always");

// ── ContextUsageRing: 环旁显示「xx% · 用量 / 窗口 上下文已使用」──
const ring = dp + "/src/renderer/react/features/chat/components/ContextUsageRing.tsx";
let r = fs.readFileSync(ring, "utf8");
if (!r.includes("cy-context-usage-label")) {
  r = r.replace(
    `        <svg width={RING_SIZE} height={RING_SIZE} viewBox={\`0 0 \${RING_SIZE} \${RING_SIZE}\`} aria-hidden="true">`,
    `        <span className={\`cy-context-usage-label is-\${tone}\`}>
          {showRatio
            ? \`\${percentText} · \${formatTokenCount(usage.totalTokens)} / \${formatTokenCount(usage.contextWindowTokens)} \${t("contextRing.usedLabel", "上下文已使用")}\`
            : \`\${formatTokenCount(usage.totalTokens)} \${t("contextRing.usedLabel", "上下文已使用")}\`}
        </span>
        <svg width={RING_SIZE} height={RING_SIZE} viewBox={\`0 0 \${RING_SIZE} \${RING_SIZE}\`} aria-hidden="true">`,
  );
  fs.writeFileSync(ring, r, "utf8");
  console.log("ring label added");
}

// ── ContextUsageRing.css ──
const ringCss = dp + "/src/renderer/react/features/chat/components/ContextUsageRing.css";
if (fs.existsSync(ringCss)) {
  let css = fs.readFileSync(ringCss, "utf8");
  if (!css.includes("cy-context-usage-label")) {
    css += `

/* 输入框上方/旁的用量文案（对齐常见 Agent 输入区样式） */
.cy-context-usage-ring {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cy-context-usage-label {
  font-size: 12px;
  line-height: 1.4;
  color: var(--cy-text-muted, #6f6876);
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.04);
}
.cy-context-usage-label.is-warm {
  color: var(--ui-warning, #9c6a13);
  background: rgba(255, 180, 40, 0.12);
}
.cy-context-usage-label.is-alert {
  color: var(--ui-danger, #a63a49);
  background: rgba(220, 60, 80, 0.1);
}
`;
    fs.writeFileSync(ringCss, css, "utf8");
    console.log("ring css ok");
  }
}

// ── 提示：官方无上下文/模型列表时 ──
const settings = dp + "/src/renderer/settings/settings.ts";
let s = fs.readFileSync(settings, "utf8");
s = s.replace(
  `tOr("settings.modelNotInProviderList", "该模型不在服务商列表中，请核对模型 ID")`,
  `tOr("settings.modelNotInProviderList", "服务商未返回完整模型列表或该模型不在列表中，请手动填写模型 ID")`,
);
s = s.replace(
  `tOr("settings.modelInProviderList", "模型已在服务商列表中（接口未返回上下文，可手填或用目录值）")`,
  `tOr("settings.modelInProviderList", "模型已在服务商列表中；官方未提供上下文长度，请手动填写 Token")`,
);
s = s.replace(
  `tOr("settings.providerModelsFailed", "服务商模型列表获取失败")`,
  `tOr("settings.providerModelsFailed", "官方接口未提供模型列表，请手动填写模型名")`,
);
fs.writeFileSync(settings, s, "utf8");
console.log("settings hints ok");

// i18n
const zh = dp + "/src/renderer/settings/i18n/zh-CN.json";
if (fs.existsSync(zh)) {
  let z = fs.readFileSync(zh, "utf8");
  if (!z.includes("contextRing.usedLabel") && z.includes('"contextRing"')) {
    z = z.replace('"contextRing"', '"contextRing.usedLabel": "上下文已使用",\n    "contextRing"');
  }
  fs.writeFileSync(zh, z, "utf8");
}

console.log("done");
