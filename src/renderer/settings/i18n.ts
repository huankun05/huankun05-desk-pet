/**
 * settings 页面（非 React）轻量级 i18n 模块。
 *
 * - 词典：./i18n/zh-CN.json（默认）、./i18n/en-US.json。
 * - t(key)：按当前语言点分路径查词典，缺 key 时回退 key 本身，便于发现漏抽文案。
 * - DOM 替换：静态文案在 HTML 上标 `data-i18n="nav.api"`，initSettingsI18n / applySettingsI18n
 *   加载时批量替换 textContent（input/textarea 则替换 placeholder）。
 * - 动态文案（导航标题栏、占位面板等由 TS 渲染的）直接调用 t()。
 * - 语言来源：跟随通用设置 GeneralSettings.language（主进程），与聊天主界面保持一致。
 */
import zhCN from "./i18n/zh-CN.json";
import enUS from "./i18n/en-US.json";

type SettingsDict = Record<string, string | SettingsDict>;

const FALLBACK_LOCALE = "zh-CN";
const resources: Record<string, SettingsDict> = {
  "zh-CN": zhCN as SettingsDict,
  "en-US": enUS as SettingsDict,
};

let currentLocale = FALLBACK_LOCALE;

function lookup(key: string): string {
  const parts = key.split(".");
  let cur: unknown = resources[currentLocale];
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return "";
    }
  }
  return typeof cur === "string" ? cur : "";
}

/** 翻译函数：按当前语言取值，缺 key 时回退 key 本身。 */
export function t(key: string): string {
  return lookup(key) || key;
}

/** 翻译函数：按当前语言取值，缺 key 时回退 fallback（供动态文案兜底中文）。 */
export function tOr(key: string, fallback: string): string {
  return lookup(key) || fallback;
}

/** 当前生效的语言（如 "zh-CN" / "en-US"）。 */
export function getSettingsLocale(): string {
  return currentLocale;
}

/**
 * 批量替换 DOM 中带 `data-i18n` 的静态文案。
 * - data-i18n：替换 textContent（input/textarea 则替换 placeholder），不会动带子元素（图标等）的容器。
 * - data-i18n-aria：替换 aria-label（如导航区可访问性名称）。
 */
export function applySettingsI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (!key) return;
    const value = t(key);
    if (value === key) return;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.setAttribute("placeholder", value);
    } else if (el.children.length === 0) {
      // 仅替换纯文本元素，带子元素（图标等）的容器跳过，避免误删图标
      el.textContent = value;
    }
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    const key = el.dataset.i18nAria;
    if (!key) return;
    const value = t(key);
    if (value === key) return;
    el.setAttribute("aria-label", value);
  });
}

/**
 * 从通用设置读取语言并应用（跟随聊天主界面）。
 * 完成后刷新 data-i18n 静态文案与 <html lang>；返回最终生效的语言。
 */
export async function initSettingsI18n(): Promise<string> {
  try {
    const general = await window.settings?.getGeneral?.();
    const lang = general?.language;
    if (typeof lang === "string" && lang.trim() && lang in resources) {
      currentLocale = lang.trim();
    }
  } catch {
    // 读取失败时保持默认语言
  }
  document.documentElement.lang = currentLocale;
  document.title = t("appTitle");
  applySettingsI18n();
  return currentLocale;
}
