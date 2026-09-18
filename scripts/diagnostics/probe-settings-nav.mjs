/**
 * 用 Playwright 打开设置页，点击导航，收集 console 错误
 */
import { chromium } from "playwright";

const url = "http://127.0.0.1:5174/settings/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const logs = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`);
});
await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2000);

const navCount = await page.locator(".nav-item").count();
console.log("nav-item count", navCount);

// probe clickability
const probe = await page.evaluate(() => {
  const items = [...document.querySelectorAll(".nav-item")];
  const first = items[0];
  if (!first) return { error: "no nav" };
  const r = first.getBoundingClientRect();
  const cs = getComputedStyle(first);
  const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    pointerEvents: cs.pointerEvents,
    display: cs.display,
    visibility: cs.visibility,
    topTag: topEl?.tagName,
    topClass: topEl?.className,
    hasListenerHint: first.dataset.section,
    titleText: document.getElementById("section-title")?.textContent,
  };
});
console.log("probe", JSON.stringify(probe, null, 2));

// try click second nav item
try {
  const labels = await page.locator(".nav-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
  console.log("sections", labels.slice(0, 8).join(","));
  await page.locator('.nav-item[data-section="general"]').click({ force: true, timeout: 5000 });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    title: document.getElementById("section-title")?.textContent,
    active: document.querySelector(".nav-item.is-active")?.getAttribute("data-section"),
    generalHidden: document.getElementById("general-form")?.classList.contains("is-hidden"),
    apiHidden: document.getElementById("api-form")?.classList.contains("is-hidden"),
  }));
  console.log("after click general", after);
} catch (e) {
  console.log("click fail", String(e));
}

// try normal click without force
try {
  await page.locator('.nav-item[data-section="tts"]').click({ timeout: 5000 });
  await page.waitForTimeout(400);
  const after2 = await page.evaluate(() => ({
    title: document.getElementById("section-title")?.textContent,
    active: document.querySelector(".nav-item.is-active")?.getAttribute("data-section"),
  }));
  console.log("after click tts", after2);
} catch (e) {
  console.log("click tts fail", String(e));
}

console.log("PAGE_ERRORS", errors);
console.log("CONSOLE", logs.slice(0, 40));
await browser.close();
