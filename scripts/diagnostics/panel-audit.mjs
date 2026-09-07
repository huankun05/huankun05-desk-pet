/**
 * 面板全面审计：连接运行中的应用（CDP 9222），逐个点击设置导航项，
 * 检查对应面板是否真正可见（rect 在视口内、无 is-hidden、offsetParent 非 null）。
 */
import { chromium } from "playwright";

const CDP_URL = "http://127.0.0.1:9222";

const SECTIONS = [
  "api", "api-advanced", "tokens", "character-style", "appearance", "preferences",
  "memory", "tts", "asr", "channels", "plugins", "lsp", "skills", "backup",
  "tasks", "general", "user", "disclaimer",
];

const PANEL_IDS = {
  api: "api-form",
  "api-advanced": "api-runtime-form",
  tokens: "token-panel",
  "character-style": "character-style-form",
  appearance: "appearance-form",
  preferences: "preferences-form",
  memory: "memory-panel",
  tts: "tts-panel",
  asr: "asr-panel",
  channels: "channels-panel",
  plugins: "plugins-panel",
  lsp: "lsp-panel",
  skills: "skills-panel",
  backup: "backup-panel",
  tasks: "tasks-panel",
  general: "general-form",
  user: "user-panel",
  disclaimer: "disclaimer-panel",
};

const browser = await chromium.connectOverCDP(CDP_URL);
const contexts = browser.contexts();
console.log(`共 ${contexts.length} 个浏览器上下文`);

let settingsPage = null;
for (const ctx of contexts) {
  for (const page of ctx.pages()) {
    console.log(`页面: ${page.url()} | title=${await page.title().catch(() => "?")}`);
    if (/settings|设置/.test(page.url()) || (await page.title().catch(() => ""))?.includes("设置")) {
      settingsPage = page;
    }
  }
}

if (!settingsPage) {
  console.log("!! 未找到设置窗口页面");
  process.exit(1);
}

console.log(`\n使用设置页面: ${settingsPage.url()}`);

// 收集页面错误
settingsPage.on("console", (msg) => {
  if (msg.type() === "error") console.log(`[page console.error] ${msg.text().slice(0, 300)}`);
});
settingsPage.on("pageerror", (err) => console.log(`[pageerror] ${String(err).slice(0, 300)}`));

await settingsPage.bringToFront().catch(() => {});

// 等待页面就绪
await settingsPage.waitForSelector(".nav-item", { timeout: 10000 }).catch(() => {});

for (const section of SECTIONS) {
  const panelId = PANEL_IDS[section];
  const result = await settingsPage.evaluate(
    async ({ section, panelId }) => {
      const navBtn = document.querySelector(`.nav-item[data-section="${section}"]`);
      if (!navBtn) return { error: "导航按钮不存在" };
      navBtn.click();
      await new Promise((r) => setTimeout(r, 120));
      const panel = document.getElementById(panelId);
      if (!panel) return { error: `面板 #${panelId} 不存在` };
      const cs = getComputedStyle(panel);
      const rect = panel.getBoundingClientRect();
      const vp = { w: window.innerWidth, h: window.innerHeight };
      const hiddenClass = panel.classList.contains("is-hidden");
      const visible =
        !hiddenClass &&
        cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        panel.offsetParent !== null &&
        rect.width > 0 &&
        rect.height > 0;
      return {
        navActive: document.querySelector(".nav-item.is-active")?.getAttribute("data-section") ?? null,
        hiddenClass,
        display: cs.display,
        offsetParent: panel.offsetParent ? panel.offsetParent.tagName + "#" + panel.offsetParent.id : null,
        rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
        vp,
        visible,
        title: document.getElementById("section-title")?.textContent ?? "",
      };
    },
    { section, panelId },
  );
  const ok = result.visible ? "OK " : "FAIL";
  console.log(
    `[${ok}] ${section.padEnd(16)} 面板#${panelId.padEnd(22)} visible=${result.visible} hidden=${result.hiddenClass} display=${result.display} rect=${result.error ? "" : JSON.stringify(result.rect)}${result.error ? " err=" + result.error : ""}`,
  );
}

await browser.close();
