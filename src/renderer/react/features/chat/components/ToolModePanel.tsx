import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../../i18n";
import { TOOL_ICON_SVGS } from "./tool-icons";
import "./ToolModePanel.css";

type ToolMode = "work" | "code" | "learn" | "chat";

type TabKey = ToolMode;

interface ToolCatalogItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  modes: Array<"chat" | "work" | "code" | "learn"> | null;
  deprecated: string | null;
}

type Overrides = Record<string, Partial<Record<string, boolean>>>;

const BASE_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "work", label: "Work" },
  { key: "code", label: "Code" },
  { key: "learn", label: "Learn" },
];

/** Chat 模式首次开启工具增强时预勾选的白名单：音乐全量 + 幂等只读。
 *  播放类是闲聊刚需故全放（input-control 级仍受权限档位门控）；
 *  只读类无副作用。写入后完全由用户接管，后续开关不再覆盖。 */
const CHAT_TOOL_WHITELIST = [
  // 音乐工具（全量）
  "music_search",
  "music_get_daily_recommendations",
  "music_get_playback_status",
  "music_my_playlists",
  "music_playlist_detail",
  "music_play_track",
  "music_play_playlist",
  "music_stop_playback",
  "music_create_playlist",
  "music_add_to_playlist",
  "music_toggle_favorite",
  "music_remove_from_playlist",
  // 幂等只读
  "weather",
  "web_search",
  "fetch_url",
  "translate",
  "exchange_rate",
  "query_expense",
  "recall_history",
];

/** Chat 模式可见性：严格 opt-in，仅显式勾选（override.chat===true）放行。
 *  不走"未声明 modes 即全可见"的默认规则——与主进程 run-capabilities 同口径。 */
function isChatToolOn(tool: ToolCatalogItem, overrides: Overrides): boolean {
  return overrides[tool.id]?.chat === true;
}

function PlaceholderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="16" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="6 4" />
      <path d="M24 16V32" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M16 24H32" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function ToolIcon({ toolId }: { toolId: string }) {
  return (
    <span
      className="tool-card__icon"
      style={{
        background: "var(--cy-bg-page, #f5f5f5)",
        color: "var(--cy-text-muted, #6e6e73)",
      }}
    >
      {TOOL_ICON_SVGS[toolId] ?? <PlaceholderIcon />}
    </span>
  );
}

/** 与主进程 getEnabledToolsForMode 同源的默认可见性计算（前端镜像） */
function isVisibleForMode(tool: ToolCatalogItem, mode: ToolMode, overrides: Overrides): boolean {
  const override = overrides[tool.id]?.[mode];
  if (override !== undefined) return override;
  if (!tool.modes) return true;
  return tool.modes.includes(mode);
}

export const ToolModePanel: React.FC = () => {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolCatalogItem[]>([]);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<TabKey>("code");
  // Chat 模式工具增强总开关（general-settings.chatToolsEnabled）
  const [chatToolsEnabled, setChatToolsEnabled] = useState(false);
  // 关总开关时若停在 Chat tab，回退到 Code（避免 tab 悬空）。
  const tabRef = useRef<TabKey>("code");
  tabRef.current = tab;

  useEffect(() => {
    let cancelled = false;
    const api = window.settings;
    Promise.all([
      api?.getToolCatalog?.() ?? Promise.resolve([]),
      api?.getToolModeOverrides?.() ?? Promise.resolve({}),
      api?.getGeneral?.() ?? Promise.resolve({}),
    ])
      .then(([catalog, ov, general]) => {
        if (cancelled) return;
        setTools(catalog as ToolCatalogItem[]);
        setOverrides(ov as Overrides);
        setChatToolsEnabled((general as { chatToolsEnabled?: boolean }).chatToolsEnabled === true);
      })
      .catch((err) => console.warn("[ToolModePanel] load failed:", err))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const toggleMode = useCallback((toolId: string, mode: ToolMode, next: boolean) => {
    setOverrides((prev) => ({
      ...prev,
      [toolId]: { ...prev[toolId], [mode]: next },
    }));
    void window.settings
      ?.setToolModeOverride?.(toolId, mode, next)
      ?.catch((err) => console.warn("[ToolModePanel] set override failed:", err));
  }, []);

  /** 总开关切换：首次开启（尚无任何 chat override）时预勾选白名单，一次性初始化。 */
  const toggleChatTools = useCallback((next: boolean) => {
    const prevOverrides = overrides;
    const hasChatOverride = Object.values(prevOverrides).some((m) => m?.chat !== undefined);
    let payload: Record<string, unknown> = { chatToolsEnabled: next };
    let nextOverrides = prevOverrides;
    if (next && !hasChatOverride) {
      // 只预勾选目录里存在且全局启用的白名单工具，避免写入死键。
      const available = new Set(tools.filter((t) => !t.deprecated && t.enabled).map((t) => t.id));
      const initialized: Overrides = { ...prevOverrides };
      for (const toolId of CHAT_TOOL_WHITELIST) {
        if (available.has(toolId)) {
          initialized[toolId] = { ...(initialized[toolId] ?? {}), chat: true };
        }
      }
      nextOverrides = initialized;
      payload = { chatToolsEnabled: true, toolModeOverrides: initialized };
    }
    setChatToolsEnabled(next);
    setOverrides(nextOverrides);
    void window.settings
      ?.saveGeneral?.(payload)
      ?.catch((err) => console.warn("[ToolModePanel] save general failed:", err));
    if (next) setTab("chat");
    else if (tabRef.current === "chat") setTab("code");
  }, [overrides, tools]);

  const TABS = useMemo(
    () => (chatToolsEnabled ? [...BASE_TABS, { key: "chat" as TabKey, label: "Chat" }] : BASE_TABS),
    [chatToolsEnabled],
  );

  const isToolOn = useCallback((tool: ToolCatalogItem, mode: TabKey, ov: Overrides): boolean => {
    if (mode === "chat") return isChatToolOn(tool, ov);
    return isVisibleForMode(tool, mode, ov);
  }, []);

  const visibleTools = useMemo(() => {
    const kw = filter.trim().toLowerCase();
    const usable = tools.filter((t) => !t.deprecated);
    // 所有 tab 统一展示全部启用工具：关掉的工具置灰保留在列表里，便于重新开启。
    // （此前非 chat tab 会把 override=false 的工具直接过滤掉，导致关掉后无法再打开。）
    const shown = usable.filter((t) => t.enabled);
    const searched = kw
      ? shown.filter(
          (t) =>
            t.id.toLowerCase().includes(kw) ||
            t.name.toLowerCase().includes(kw) ||
            t.description.toLowerCase().includes(kw),
        )
      : shown;
    return [...searched].sort((a, b) => {
      const aOn = isToolOn(a, tab, overrides);
      const bOn = isToolOn(b, tab, overrides);
      if (aOn !== bOn) return aOn ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
  }, [tools, overrides, filter, tab, isToolOn]);

  return (
    <div className="tool-panel">
      <header className="tool-panel__header">
        <h1 className="tool-panel__title">{t("toolPanel.title")}</h1>
        <p className="tool-panel__subtitle">
          {t("toolPanel.subtitle", { mode: TABS.find((item) => item.key === tab)?.label })}
        </p>
      </header>

      <div className="tool-panel__master">
        <div className="tool-panel__master-text">
          <strong>{t("toolPanel.chatEnhanceTitle")}</strong>
          <span>{t("toolPanel.chatEnhanceDesc")}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={chatToolsEnabled}
          aria-label={t("toolPanel.chatEnhanceTitle")}
          className={"tool-card__pill tool-panel__master-pill" + (chatToolsEnabled ? " is-on" : "")}
          onClick={() => toggleChatTools(!chatToolsEnabled)}
        >
          <span className="tool-card__pill-knob" />
        </button>
      </div>

      <div className="tool-panel__search-row">
        <input
          className="tool-panel__search"
          placeholder={t("toolPanel.searchPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="tool-panel__tabs">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            className={"tool-panel__tab" + (tab === tabItem.key ? " is-active" : "")}
            onClick={() => setTab(tabItem.key)}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="tool-panel__loading">{t("common.loading")}</div>
      ) : (
        <div className="tool-panel__grid">
          {visibleTools.map((tool) => {
            const isOn = isToolOn(tool, tab, overrides);
            return (
              <div key={tool.id} className={"tool-card" + (isOn ? "" : " is-off")}>
                <ToolIcon toolId={tool.id} />
                <div className="tool-card__body">
                  <div className="tool-card__name">
                    {tool.name}
                    {!tool.enabled && <span className="tool-card__badge">{t("toolPanel.disabledBadge")}</span>}
                  </div>
                  <div className="tool-card__desc">{tool.description.split("\n")[0] || t("toolPanel.noDescription")}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  className={"tool-card__pill" + (isOn ? " is-on" : "")}
                  onClick={() => toggleMode(tool.id, tab, !isOn)}
                >
                  <span className="tool-card__pill-knob" />
                </button>
              </div>
            );
          })}
          {visibleTools.length === 0 && <div className="tool-panel__empty">{t("toolPanel.noMatch")}</div>}
        </div>
      )}
    </div>
  );
};

export default ToolModePanel;
