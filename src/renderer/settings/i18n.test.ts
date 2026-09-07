// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applySettingsI18n, getSettingsLocale, t, tOr } from "./i18n";

describe("settings i18n", () => {
  it("defaults to zh-CN and resolves known keys", () => {
    expect(getSettingsLocale()).toBe("zh-CN");
    expect(t("appTitle")).toBe("昔涟 · 设置");
    expect(t("nav.api")).toBe("API 设置");
    expect(t("nav.characterStyle")).toBe("角色与风格");
    expect(t("hint.channels")).toBeTruthy();
    expect(t("panel.memory")).toBe("昔涟记忆");
  });

  it("returns the key itself when the key is missing", () => {
    expect(t("nav.notExist")).toBe("nav.notExist");
  });

  it("tOr falls back when the key is missing", () => {
    expect(tOr("nav.notExist", "回退文案")).toBe("回退文案");
    expect(tOr("nav.api", "回退文案")).toBe("API 设置");
  });

  it("applySettingsI18n replaces text, placeholder and aria-label", () => {
    document.body.innerHTML = `
      <h1 data-i18n="panel.api">API 设置</h1>
      <input data-i18n="placeholder.copy">
      <aside data-i18n-aria="navAria">nav</aside>
    `;
    applySettingsI18n();
    expect(document.querySelector("h1")?.textContent).toBe("API 设置");
    expect((document.querySelector("input") as HTMLInputElement).placeholder).toBe(
      "这个模块先占位，等核心聊天与 API 接通后再继续扩展。",
    );
    expect(document.querySelector("aside")?.getAttribute("aria-label")).toBe("设置导航");
  });

  it("applySettingsI18n replaces title attribute via data-i18n-title", () => {
    document.body.innerHTML = `
      <a id="link" href="#" data-i18n-title="settings.visitSiteTitle">link</a>
    `;
    applySettingsI18n();
    expect(document.querySelector("a")?.getAttribute("title")).toBe("前往厂商官网");
  });

  it("applySettingsI18n skips containers with child elements (icons)", () => {
    document.body.innerHTML = `
      <h1 data-i18n="panel.api"><svg id="icon"></svg>API 设置</h1>
    `;
    applySettingsI18n();
    const h1 = document.querySelector("h1")!;
    expect(h1.querySelector("#icon")).not.toBeNull();
    expect(h1.textContent).toContain("API 设置");
  });
});
