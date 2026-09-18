import { chromium } from "playwright";
const url = "http://127.0.0.1:5174/settings/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);
const nav = await page.locator(".nav-item").evaluateAll((els) =>
  els.map((e) => e.getAttribute("data-section")),
);
console.log("nav sections", nav.join(","));
console.log("has backup nav", nav.includes("backup"));
console.log("has storage nav", nav.includes("storage"));
for (const sec of ["api", "storage", "channels", "tts", "general"]) {
  try {
    await page.locator(`.nav-item[data-section="${sec}"]`).click({ timeout: 4000 });
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => ({
      title: document.getElementById("section-title")?.textContent,
      active: document.querySelector(".nav-item.is-active")?.getAttribute("data-section"),
    }));
    console.log("click", sec, "=>", JSON.stringify(info));
  } catch (e) {
    console.log("click", sec, "FAIL", String(e).slice(0, 120));
  }
}
const hint = await page.evaluate(() => document.getElementById("context-window-auto-hint")?.textContent);
console.log("model auto hint (on api panel)", hint);
console.log("PAGE_ERRORS", errors);
await browser.close();
