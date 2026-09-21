/* 标记！AI写的超大技术债，延期重构*/
import "../ui/base.css";
import "./settings.css";
import "../ui/theme";
import { CustomSelect } from "./components/custom-select/custom-select";
import neteaseLogoUrl from "./assets/netease-logo.svg?url";
import { applySettingsI18n, initSettingsI18n, t, tOr } from "./i18n";
import {
  normalizeChatSocialContextEnabled,
  normalizeDefaultChatMode,
  normalizeMobileMessageSegmentationMode,
  normalizeProactiveChatMode,
  normalizeProactiveDeliveryTarget,
  normalizeSegmentedOutputMode,
  type DefaultChatMode,
  type MobileMessageSegmentationMode,
  type ProactiveChatMode,
  type ProactiveDeliveryTarget,
  type SegmentedOutputMode,
} from "../../shared/preferences";
import { isProactiveDeliveryTargetSelectable } from "../../shared/proactive-delivery";
import type { UiTheme } from "../../shared/ui-theme";
import { DEFAULT_UI_FONT, normalizeUiFont, type UiFont } from "../../shared/ui-font";
import { normalizeUiIcon, type UiIcon } from "../../shared/ui-icon";
import {
  DEFAULT_WINDOW_CORNER_RADIUS,
  normalizeWindowCornerRadius,
} from "../../shared/window-corner-radius";
import { applyWindowCornerRadius } from "../ui/window-corner-radius";
import { getCitaUiState } from "./cita-settings-state";
import { type ReasoningPreference } from "../../shared/reasoning";
import { type LoginFlowState } from "../../shared/music-types";
import { resolveApiEndpoint, type ApiTransport } from "../../shared/api-endpoint";
import type { ChatAppearanceSettings } from "../../shared/chat-appearance";
import type { ChatStoreApi } from "../react/features/chat/pages/chat-page-bridge";
import {
  DEFAULT_CUSTOM_STYLE,
  normalizeCustomStyleConfig,
  type CustomStyleConfig,
  type DiversityPreference,
  type RepetitionLevel,
} from "../../shared/style-sampling";
import { STYLE_DISPLAY_NAMES } from "../../shared/character-types";
import {
  CUSTOM_ENDPOINT_PROVIDERS,
  getCustomEndpointMode,
  getCustomEndpointPresentation,
  getCustomEndpointProvider,
  validateCustomEndpointConfig,
  type CustomEndpointMode,
} from "./custom-endpoint-state";
import type {
  ScheduleConfig,
  SchedulerApi,
  SchedulerResult,
  SchedulerToolInfo,
  SchedulerToolMode,
  ScheduledTask,
  ScheduledTaskHistoryEntry,
} from "./scheduler/types";
import { musicState } from "./music/state";
import { musicHomeView, musicReturnBtn, musicSearchForm, musicSearchHint, musicQrStatus, musicProfileAvatar, musicLoginBtn, musicCancelBtn, musicDisconnectBtn, musicQrImg, musicQrTip, musicQrBox, musicFeedbackEl, musicAccountStatusText, musicSearchInput, musicSearchBtn, musicSearchResults, musicToggle, musicAccordionCard, musicAccordionBody } from "./music/dom";
import { channelsState } from "./channels/state";
import { channelsWechatEnabledEl, channelsFeishuEnabledEl, channelsWechatStatusEl, channelsFeishuStatusEl, channelsRateUserEl, channelsRateChannelEl, channelsTtsEl, channelsStickerEl, channelsMirrorEl, channelsToolSandboxOffEl, channelsToolSandboxAllEl, channelsFeishuAppIdEl, channelsFeishuAppSecretEl, channelsFeishuAppSecretRevealBtn, channelsFeishuSaveBtn, channelsWechatLoginBtn, channelsWechatRestartBtn, channelsWechatFeedbackEl, channelsFeishuFeedbackEl, channelsLogListEl, channelsLogRefreshBtn, channelsLogClearBtn } from "./channels/dom";
import { memoryState } from "./memory/state";
import { memoryL0NameInput, memoryL0OccupationInput, memoryL0InterestsInput, memoryL0LanguageInput, memoryL0NoteInput, memoryL1GoalsInput, memoryL1PreferencesInput, memoryL1ProjectInput, memoryL2SearchInput, memoryL2List, memoryImportedList, memoryReflectionList, memoryL0EditBtn, memoryL0CancelBtn, memoryL1EditBtn, memoryL1CancelBtn } from "./memory/dom";
import { schedulerState } from "./scheduler/state";
import { schedulerNewBtn, schedulerEmpty, schedulerList, schedulerEditor, schedulerEditorTitle, schedulerEditorClose, schedulerTitleInput, schedulerPromptInput, schedulerEnabledInput, schedulerKindInput, schedulerOnceRunAtInput, schedulerTimeOfDayInput, schedulerDayOfWeekInput, schedulerIntervalEveryInput, schedulerIntervalUnitInput, schedulerToolLimitInput, schedulerToolPicker, schedulerToolEmptyHint, schedulerSilentStartInput, schedulerSilentEndInput, schedulerSaveStatus, schedulerCancelBtn, schedulerSaveBtn } from "./scheduler/dom";
import { tokensState } from "./tokens/state";
import { modalState } from "./shared/modal-state";
import { formatDateTime, escapeHtml } from "./shared/format";
import { parsePositiveIntOrThrow, parseCommandLine } from "./shared/parse";
import { apiState, type SavedProfileLite } from "./api/state";
import { apiForm, apiRuntimeForm, presetCards, profileList, profileListCount, profileEditorTitle, deleteProfileBtn, presetWebsiteLink, displayNameInput, baseUrlInput, baseUrlResetBtn, modelInput, modelInputSuggestions, contextWindowInput, apiKeyInput, apiKeyLabel, apiKeyHint, testConnectionBtn, transportSelect, transportHint, endpointPreview, customEndpointControls, customEndpointOverrides, customEndpointSummary, customEndpointGuideBtn, apiNoteText, multimodalToggle, embeddingDimensionsInput, thinkingModeSelect, toggleDisableMaxToken } from "./api/dom";
import "./api/credentials";  // 凭据迁移：导出 / 导入 / 变更记录（副作用导入）
import { visionBaseUrlInput, visionApiKeyInput, visionModelInput, visionFieldsWrap, testVisionBtn, visionTestStatus, visionOcrToggle, testOcrBtn, ocrTestStatus } from "./vision/dom";
import { auxiliaryDedicatedToggle, auxiliaryDedicatedFields, auxiliaryBaseUrlInput, auxiliaryApiKeyInput, auxiliaryModelInput } from "./auxiliary/dom";
import { consolidationToggle } from "./consolidation/dom";
import { initSkillsPanel } from "./skills/index";
import { appearanceForm, appearanceSaveStatus, runtimeSyncSelect, runtimeSyncNote, windowCornerRadiusInput, windowCornerRadiusVal, petAlwaysOnTopInput, petVisibleInput, petZoomInput, petZoomVal, characterDropdown, characterDropdownTrigger, characterDropdownValue, characterDropdownPanel, chatLineHeightInput, chatLineHeightVal, assistantBubbleEnabledInput, chatParaSpacingInput, chatParaSpacingVal, launchAtLoginInput, uiFontCurrent, uiFontImportButton, uiFontResetButton, uiIconSelect, openChromeGpu, disableGpuInput, sidebarVisibleInput, tasksVisibleInput } from "./appearance/dom";
import { generalForm, generalSaveStatus, languageSelect, defaultChatModeSelect, segmentedOutputSelect, mobileMessageSegmentationSelect, proactiveChatSelect, proactiveDeliveryRow, proactiveDeliverySelect, chatSocialContextEnabledInput, citaEnabledInput, citaEngineSelect, clearChatHistoryBtn, customStyleSamplingBtn, customStylePromptBtn } from "./general/dom";
import { minBtn, closeBtn, preferencesForm, sectionTitle, sectionHint, placeholderPanel, cyrenePanel, disclaimerPanel, pluginsPanel, placeholderIcon, placeholderTitle, placeholderCopy, saveStatus, runtimeSaveStatus, preferencesSaveStatus, cyreneSaveStatus, openStickerManagerBtn, addStickerBtn } from "./shared/shell";
import { pluginAddBtn, neteaseDetailView, permissionBlocksWrap, permissionNote } from "./plugins/dom";
import { preferencesState } from "./preferences/state";
import { stickerEnabledInput, stickerSizeSelect, stickerThresholdInput, stickerThresholdVal, stickerAddOverlay, stickerAddPickBtn, stickerAddFileName, stickerAddId, stickerAddDesc, stickerAddPhrases, stickerAddError, stickerAddConfirm, stickerAddCancel } from "./preferences/dom";
import { diversityDriverOf, diversityValueOf } from "./preferences/style-utils";
import { characterStyleForm } from "./character-style/dom";
import { initCharacterStylePanel } from "./character-style/panel";
import { initBackupPanel } from "./backup/backup-panel";
// 注意：技能面板只保留一个入口（skills/index.ts），禁止再 import skills-panel 造成重复绑定
import { initLspPanel } from "./lsp/panel";
import { initStoragePanel } from "./storage/panel";
import "./storage/storage.css";
import "./storage/storage.css";
import { pluginsState } from "./plugins/state";
import type {
  GeneralSettings,
  MemoryPanelApi,
  MemoryPanelPayload,
  ModelPreset,
  ModelSettings,
  ProviderProfile,
  SettingsApi,
  UserApi,
} from "./shared/types";
import { MODEL_PRESETS } from "./api/presets";
import { showModal, showHtmlModal, showInputModal } from "./shared/modal";
import { showToast } from "./shared/toast";
import {
  setSaveStatus, setCyreneSaveStatus, setPreferencesSaveStatus, setAppearanceSaveStatus,
  setGeneralSaveStatus, setRuntimeSaveStatus,
} from "./shared/save-status";
import { renderEmptyState, renderInfoList } from "./shared/render";
import { shallowEqual, safeGet } from "./shared/utils";
import {
  loadMemoryPanel,
  enterL0EditMode, exitL0EditMode, saveL0, cancelL0Edit,
  enterL1EditMode, exitL1EditMode, saveL1, cancelL1Edit,
  renderImportedDocs,
} from "./memory/panel";
import { initObsidianVaultUI } from "./memory/obsidian-vault-ui";
import {
  setSchedulerStatus, renderSchedulerTools, renderSchedulerList,
  loadSchedulerPanel, openSchedulerEditor, closeSchedulerEditor,
  updateSchedulerConditionalFields, collectSchedule, collectAllowedToolIds,
  saveSchedulerTask, toggleSchedulerTask, fireSchedulerTask,
  deleteSchedulerTask, toggleSchedulerHistory,
  saveSchedulerSilentHours, applySchedulerSilentHours,
} from "./scheduler/panel";
import { loadMusicPanel, disposeMusicPanel } from "./music/panel";
import { initLocalMusicPanel } from "./music/local-panel";
import { loadChannelsPanel } from "./channels/panel";
import { renderProactiveDeliveryAvailability } from "./channels/panel";
import "./asr/panel";  // 副作用导入：执行事件绑定 + 初始加载
import "./email/panel";  // 副作用导入：执行事件绑定 + 初始加载
import "./search/panel";  // 副作用导入：执行事件绑定 + 初始加载
import { saveTimeoutSettings } from "./timeout/panel";  // saveTimeoutSettings 被 API 表单处理器调用
import { DEFAULT_TIMEOUT_SETTINGS, type TimeoutSettings } from "../../shared/timeout-types";  // mock + API 表单校验用
import "./user/panel";  // 副作用导入：执行事件绑定 + 初始加载
import "./plugins/panel";  // 副作用导入：执行事件绑定 + 初始加载
import "./plugins/permission";  // 副作用导入：权限档位 UI + 风险确认弹窗
import "./tts/panel";  // 副作用导入：TTS 配置加载 + 引擎切换 + 测试发音 + 音色复刻
import "./tts/senseaudio-panel";  // 副作用导入：商汤 SenseAudio TTS 配置 + 密码显示/隐藏 + 音色列表
import "./rag/panel";  // 副作用导入：RAG 模型切换 + Embedding 下载/删除 + Reranker 模式
import "./preferences/panel";  // 副作用导入：截图热键捕获 + 表情包列表/添加/删除
import "./mcp/panel";  // 副作用导入：MCP Server 添加/删除/启停 + 自定义端点接入说明
import "./tokens/panel";  // 副作用导入：Token 用量图表 + 时间范围切换

// Inline modal (to avoid Vite tree-shaking)


/**
 * 富文本模态框（基于 cy-modal 样式但使用独立 overlay，避免与 showModal 冲突）。
 * 用于"音色快速复刻"这种需要展示多组说明（规格 / 费用 / 过期规则）的场景。
 * 调用方负责传入安全的 HTML（项目内固定字符串）；若内容来自用户/网络必须先 escapeHtml。
 */


// escapeHtml() 已定义在文件下方（settings.ts:3738），此处复用即可。

// Inline input modal (Electron 禁用了 window.prompt，所以自己实现)




declare global {
  interface Window {
    settings?: SettingsApi;
    credentials?: import("./shared/types").CredentialsApi;
    cyreneScheduler?: SchedulerApi;
    user?: UserApi;
    memoryPanel?: MemoryPanelApi;
  }
}

// MiMo 的 icon 是 lobehub-icons 仓库的 PNG（不在 icons-static-svg 包里）。
// 单独声明，与 8 家 npmmirror SVG 常量解耦（feat/chore 两个 commit 真正独立）。
// 实施时若图片加载失败，可考虑：1) 锁定 commit hash；2) 下载到本地 assets/icons/mimo.png
const MIMO_ICON_URL =
  "https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/light/xiaomimimo.png";


if (!window.settings) {
  (window as unknown as { settings: SettingsApi }).settings = {
    minimize: () => {},
    close: () => {},
    getConfig: () =>
      Promise.resolve({
        mode: "auto",
        provider: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        apiKey: "",
        runtimeSync: "off",
        stickerEnabled: true,
        stickerSize: "standard",
        stickerSimilarityThreshold: 0.55,
        chatRequestTimeoutSec: 300,
        citaRepairBudgetSec: 8,
        multimodal: true,
      }),
    saveConfig: (c) => Promise.resolve(c as ModelSettings),
    getGeneral: () => Promise.resolve({
      maxParallelToolCalls: 4,
      citaEnabled: false,
      citaSemanticEngine: "remote",
      petAlwaysOnTop: true,
      petVisible: true,
      petZoom: 1,
      chatLineHeight: 1.75,
      assistantBubbleEnabled: true,
      chatParaSpacing: 0.5,
      sidebarVisible: true,
      tasksVisible: true,
      launchAtLogin: false,
      language: "zh-CN",
      uiTheme: "pearl-white",
      uiThemeRadius: false,
      uiFont: DEFAULT_UI_FONT,
      uiIcon: "cyrene-sun",
      windowCornerRadius: DEFAULT_WINDOW_CORNER_RADIUS,
      defaultChatMode: "chat",
      currentStyleId: "default",
      customStyle: DEFAULT_CUSTOM_STYLE,
      segmentedOutputMode: "off",
      mobileMessageSegmentation: "off",
      proactiveChatMode: "off",
      proactiveDeliveryTarget: "local",
      chatSocialContextEnabled: false,
      screenshotHotkey: "Alt+Shift+S",
    }),
    saveGeneral: (c) => Promise.resolve(c as GeneralSettings),
    openCustomStylePrompt: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsGetConfig: () => Promise.resolve({ wechat: {}, feishu: {}, qq: {} }),
    channelsSaveConfig: () => Promise.resolve({}),
    channelsRestart: () => Promise.resolve({ ok: false }),
    channelsQqTestConnection: () => Promise.resolve({ ok: false, error: "settings api unavailable" }),
    channelsQqBotTestConnection: () => Promise.resolve({ ok: false, error: "settings api unavailable" }),
    channelsLogGet: () => Promise.resolve([]),
    channelsLogClear: () => Promise.resolve({ ok: true }),
    onChannelsInstallProgress: () => () => {},
    onChannelsWechatQrcode: () => () => {},
    onChannelsWechatLoginDone: () => () => {},
    channelsWechatLoginStart: () => Promise.resolve({ ok: false, error: "settings api unavailable" }),
    channelsGetStatus: () => Promise.resolve({}),
    onChannelsStatusChanged: () => () => {},
    beginScreenshotHotkeyCapture: () => Promise.resolve(true),
    endScreenshotHotkeyCapture: () => Promise.resolve(true),
    openSidebar: () => {},
    closeSidebar: () => {},
    openTasks: () => {},
    closeTasks: () => {},
    openChromeGpu: () => {},
    setPetAlwaysOnTop: () => {},
    setPetVisible: () => {},
    setPetZoom: () => {},
    pickUiFont: () => Promise.resolve(null),
    importUiFont: () => Promise.resolve(DEFAULT_UI_FONT),
    resetUiFont: () => Promise.resolve(DEFAULT_UI_FONT),
    previewRuntimeSync: () => {},
    openStickerManager: async () => ({ ok: false, error: "settings api unavailable" }),
    stickerPickFile: async () => null,
    stickerAdd: async () => { throw new Error("settings api unavailable"); },
    setToolEnabled: async () => ({ ok: false, error: "settings api unavailable" }),
    getToolEnabled: async () => ({}),
    getToolCatalog: async () => [],
    getToolModeOverrides: async () => ({}),
    setToolModeOverride: async () => ({ ok: false, error: "settings api unavailable" }),
    clearToolModeOverride: async () => ({ ok: false, error: "settings api unavailable" }),
    getSkillCatalog: async () => [],
    rescanSkills: async () => ({ ok: false, count: 0, error: "settings api unavailable" }),
    getSkillModeOverrides: async () => ({}),
    setSkillModeOverride: async () => ({ ok: false, error: "settings api unavailable" }),
    clearSkillModeOverride: async () => ({ ok: false, error: "settings api unavailable" }),
    addMcpServer: async () => ({ ok: false, error: "settings api unavailable" }),
    removeMcpServer: async () => ({ ok: false, error: "settings api unavailable" }),
    listMcpServers: async () => [],
    getTimeoutSettings: async () => DEFAULT_TIMEOUT_SETTINGS,
    saveTimeoutSettings: async c => (c as TimeoutSettings),
  };
}

if (!window.cyreneScheduler) {
  (window as unknown as { cyreneScheduler: SchedulerApi }).cyreneScheduler = {
    list: async () => ({ ok: true, value: [] }),
    add: async () => ({ ok: false, error: "scheduler api unavailable" }),
    update: async () => ({ ok: false, error: "scheduler api unavailable" }),
    delete: async () => ({ ok: false, error: "scheduler api unavailable" }),
    toggle: async () => ({ ok: false, error: "scheduler api unavailable" }),
    fireNow: async () => ({ ok: false, reason: "scheduler api unavailable" }),
    getHistory: async () => ({ ok: true, value: [] }),
    getTools: async () => ({ ok: true, value: [] }),
  };
}

document.querySelectorAll<HTMLImageElement>("[data-music-logo]").forEach((image) => {
  image.src = neteaseLogoUrl;
});



// 模式按钮已删除——baseUrl 永远可改、模型名永远可手填（datalist 出预设建议）
// provider 不再暴露给用户（从预设内部拿，保证 capabilities 匹配不出错）。
// 用户看到的是"昵称"框——给模型起自定义名字，状态栏"正在喂养"显示它。
// API 协议下拉（openai / anthropic）—— 不根据 URL 自动猜测。

// 视觉模型配置区元素

// 高级运行设置

// Embedding 维度（可选，仅 cloud 模式）

// 档案化改造后，perProvider 缓存体系退役：
// 表单绑定「档案」（apiState.editingProfileId）而不是「当前厂商」，
// 同厂商建多套配置（官方 API + 中转站）互不覆盖。持久化走 modelProfiles。

// 当前激活的厂商：每次 applyPreset 后更新；用于"切到下一家厂商前先把当前那家的输入框值缓存住"



const NAV_LABELS: Record<string, { emoji: string; title: string; hint: string }> = {
  memory: { emoji: `<img src="../icons/mimi.png" width="24" height="24" alt="" aria-hidden="true" style="vertical-align:-3px" />`, title: t("nav.memory"), hint: t("hint.memory") },
  chat: { emoji: `<svg style="vertical-align:-3px" width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M33 38H22V30H36V22H44V38H39L36 41L33 38Z" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 6H36V30H17L13 34L9 30H4V6Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 18H20" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M26 18H27" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M12 18H13" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`, title: t("nav.chat"), hint: t("hint.chat") },
  user: { emoji: `<svg style="vertical-align:-3px" width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M44 8H4V38H19L24 43L29 38H44V8Z" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="19" r="5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33 32C33 27.5817 28.9706 24 24 24C19.0294 24 15 27.5817 15 32" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, title: t("nav.user"), hint: t("hint.user") },
  tasks: { emoji: `<svg style="vertical-align:-3px" width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M23.9998 44.3332C34.1251 44.3332 42.3332 36.1251 42.3332 25.9999C42.3332 15.8747 34.1251 7.66656 23.9998 7.66656C13.8746 7.66656 5.6665 15.8747 5.6665 25.9999C5.6665 36.1251 13.8746 44.3332 23.9998 44.3332Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M23.7594 15.3536L23.7582 26.3624L31.5305 34.1347" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9.00001L11 4.00001" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M44 9.00001L37 4.00001" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, title: t("nav.tasks"), hint: t("hint.tasks") },
  plugins: { emoji: "🔌", title: t("nav.plugins"), hint: t("hint.plugins") },
  backup: { emoji: "💾", title: t("nav.backup"), hint: t("hint.backup") },
  preferences: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>偏好设置</title><path d="M12 35.0137H9H4V8.01273C4 6.90868 4.89543 6.01367 6 6.01367H42C43.1046 6.01367 44 6.90868 44 8.01273V35.0137H36" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 32L14 42H34L24 32Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`, title: t("nav.preferences"), hint: t("hint.preferences") },
  "character-style": { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>角色与风格</title><circle cx="24" cy="16" r="8" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M10 42C10 34.268 16.268 28 24 28C31.732 28 38 34.268 38 42" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 8L42 12L38 16" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`, title: t("nav.characterStyle"), hint: t("hint.characterStyle") },
  appearance: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>外观设置</title><path d="M24 44C29.9601 44 26.3359 35.136 30 31C33.1264 27.4709 44 29.0856 44 24C44 12.9543 35.0457 4 24 4C12.9543 4 4 12.9543 4 24C4 35.0457 12.9543 44 24 44Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M28 17C29.6569 17 31 15.6569 31 14C31 12.3431 29.6569 11 28 11C26.3431 11 25 12.3431 25 14C25 15.6569 26.3431 17 28 17Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M16 21C17.6569 21 19 19.6569 19 18C19 16.3431 17.6569 15 16 15C14.3431 15 13 16.3431 13 18C13 19.6569 14.3431 21 16 21Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M17 34C18.6569 34 20 32.6569 20 31C20 29.3431 18.6569 28 17 28C15.3431 28 14 29.3431 14 31C14 32.6569 15.3431 34 17 34Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`, title: t("nav.appearance"), hint: t("hint.appearance") },
  storage: { emoji: "💾", title: "存储与备份", hint: "目录占用、缓存清理、数据位置与备份" },
  music: { emoji: "🎵", title: "音乐", hint: "音乐与氛围音" },
  general: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>通用设置</title><path d="M18.2838 43.1713C14.9327 42.1736 11.9498 40.3213 9.58787 37.867C10.469 36.8227 11 35.4734 11 34.0001C11 30.6864 8.31371 28.0001 5 28.0001C4.79955 28.0001 4.60139 28.01 4.40599 28.0292C4.13979 26.7277 4 25.3803 4 24.0001C4 21.9095 4.32077 19.8938 4.91579 17.9995C4.94381 17.9999 4.97188 18.0001 5 18.0001C8.31371 18.0001 11 15.3138 11 12.0001C11 11.0488 10.7786 10.1493 10.3846 9.35011C12.6975 7.1995 15.5205 5.59002 18.6521 4.72314C19.6444 6.66819 21.6667 8.00013 24 8.00013C26.3333 8.00013 28.3556 6.66819 29.3479 4.72314C32.4795 5.59002 35.3025 7.1995 37.6154 9.35011C37.2214 10.1493 37 11.0488 37 12.0001C37 15.3138 39.6863 18.0001 43 18.0001C43.0281 18.0001 43.0562 17.9999 43.0842 17.9995C43.6792 19.8938 44 21.9095 44 24.0001C44 25.3803 43.8602 26.7277 43.594 28.0292C43.3986 28.01 43.2005 28.0001 43 28.0001C39.6863 28.0001 37 30.6864 37 34.0001C37 35.4734 37.531 36.8227 38.4121 37.867C36.0502 40.3213 33.0673 42.1736 29.7162 43.1713C28.9428 40.752 26.676 39.0001 24 39.0001C21.324 39.0001 19.0572 40.752 18.2838 43.1713Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M24 31C27.866 31 31 27.866 31 24C31 20.134 27.866 17 24 17C20.134 17 17 20.134 17 24C17 27.866 20.134 31 24 31Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`, title: t("nav.general"), hint: t("hint.general") },
  api: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>模型服务</title><g clip-path="url(#api-key-nav-clip)"><circle cx="15" cy="33" r="8" fill="none" stroke="currentColor" stroke-width="4"/><path d="M29 16L35.5 22" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 26L37 7" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M35 11L42 17.5" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g><defs><clipPath id="api-key-nav-clip"><rect width="48" height="48" fill="none"/></clipPath></defs></svg>`, title: "模型服务", hint: "配置模型厂商与 API Key" },
  "api-advanced": { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>高级设置</title><path d="M34.0003 41L44 24L34.0003 7H14.0002L4 24L14.0002 41H34.0003Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M24 29C26.7614 29 29 26.7614 29 24C29 21.2386 26.7614 19 24 19C21.2386 19 19 21.2386 19 24C19 26.7614 21.2386 29 24 29Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`, title: t("nav.apiAdvanced"), hint: t("hint.apiAdvanced") },
  cyrene: { emoji: "🌸", title: t("nav.cyrene"), hint: t("hint.cyrene") },
  tts: { emoji: "🎙️", title: "语音合成", hint: "让角色说话的声音引擎" },
  asr: { emoji: "🎧", title: "语音识别", hint: "听懂你说的话" },
  channels: { emoji: "📱", title: "消息渠道", hint: "连接 QQ / 微信 / 飞书 等" },
  lsp: { emoji: "🧩", title: "代码辅助", hint: "语言服务器，辅助写代码" },
	  tokens: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>Token 用量</title><path d="M4 42H44" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="8" y="28" width="6" height="14" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><rect x="21" y="18" width="6" height="24" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><rect x="34" y="6" width="6" height="36" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`, title: t("nav.tokens"), hint: t("hint.tokens") },
	  disclaimer: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>免责声明</title><rect x="13" y="10" width="28" height="34" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M35 10V4H8C7.44772 4 7 4.44772 7 5V38H13" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 22H33" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 30H33" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, title: t("nav.disclaimer"), hint: t("hint.disclaimer") },
  skills: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>技能管理</title><path d="M14 8H34C37.3137 8 40 10.6863 40 14V34C40 37.3137 37.3137 40 34 40H14C10.6863 40 8 37.3137 8 34V14C8 10.6863 10.6863 8 14 8Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M16 18H32" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M16 26H28" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M16 34H24" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`, title: t("nav.skills"), hint: t("hint.skills") },
};

/**
 * section id → 词典 key（kebab-case → camelCase），如 "api-advanced" → "apiAdvanced"。
 * 翻译在 switchSection 时按当前语言即时取值，语言切换后标题栏会自动跟随。
 */
function sectionDictKey(section: string): string {
  return section.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// 当前激活的 section，语言初始化完成后用于刷新标题栏
let currentSection = "general";

minBtn.addEventListener("click", () => window.settings?.minimize());
closeBtn.addEventListener("click", () => window.settings?.close());





async function saveAppearancePatch(patch: Partial<GeneralSettings>, successText = tOr("settings.appliedAuto", "已自动应用")): Promise<void> {
  try {
    setAppearanceSaveStatus(tOr("settings.applying", "应用中…"));
    await window.settings!.saveGeneral(patch);
    setAppearanceSaveStatus(successText, "is-ok");
  } catch (error) {
    console.error("自动应用外观设置失败:", error);
    setAppearanceSaveStatus(tOr("settings.appliedAutoFailed", "自动应用失败"), "is-error");
  }
}

function getRuntimeSyncValue(): "off" | "local" | "llm" {
  const v = runtimeSyncSelect.querySelector<HTMLButtonElement>(".option-block.is-active")?.dataset.value; return v === "llm" ? "llm" : v === "local" ? "local" : "off";
}

function applyRuntimeSyncSelection(value: "off" | "local" | "llm"): void {
  runtimeSyncSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  syncRuntimeNote();
}

function syncRuntimeNote(): void {
  runtimeSyncNote.classList.toggle("is-hidden", getRuntimeSyncValue() !== "llm");
}

function getStickerSizeValue(): "small" | "standard" | "large" {
  const value = stickerSizeSelect.querySelector<HTMLButtonElement>(".option-block.is-active")?.dataset.value;
  return value === "small" || value === "large" ? value : "standard";
}

function applyStickerSizeSelection(value: "small" | "standard" | "large"): void {
  stickerSizeSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function applyLanguageSelection(language: "zh-CN"): void {
  languageSelect.querySelectorAll<HTMLButtonElement>(".language-option").forEach((button) => {
    const active = button.dataset.lang === language;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function applyOptionGroupValue(group: HTMLElement, value: string): void {
  group.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function getOptionGroupValue(group: HTMLElement, fallback: string): string {
  return group.querySelector<HTMLButtonElement>(".option-block.is-active")?.dataset.value ?? fallback;
}

function applyDefaultChatModeSelection(mode: DefaultChatMode): void {
  applyOptionGroupValue(defaultChatModeSelect, mode);
}

function getDefaultChatModeValue(): DefaultChatMode {
  return normalizeDefaultChatMode(getOptionGroupValue(defaultChatModeSelect, "chat"));
}

function applySegmentedOutputSelection(mode: SegmentedOutputMode): void {
  applyOptionGroupValue(segmentedOutputSelect, mode);
}

function getSegmentedOutputValue(): SegmentedOutputMode {
  return normalizeSegmentedOutputMode(getOptionGroupValue(segmentedOutputSelect, "off"));
}

function applyMobileMessageSegmentationSelection(mode: MobileMessageSegmentationMode): void {
  applyOptionGroupValue(mobileMessageSegmentationSelect, mode);
}

function getMobileMessageSegmentationValue(): MobileMessageSegmentationMode {
  return normalizeMobileMessageSegmentationMode(getOptionGroupValue(mobileMessageSegmentationSelect, "off"));
}

function applyProactiveChatSelection(mode: ProactiveChatMode): void {
  applyOptionGroupValue(proactiveChatSelect, mode);
}

function getProactiveChatValue(): ProactiveChatMode {
  return normalizeProactiveChatMode(getOptionGroupValue(proactiveChatSelect, "off"));
}

function applyProactiveDeliverySelection(target: ProactiveDeliveryTarget): void {
  applyOptionGroupValue(proactiveDeliverySelect, target);
}

function getProactiveDeliveryValue(): ProactiveDeliveryTarget {
  return normalizeProactiveDeliveryTarget(getOptionGroupValue(proactiveDeliverySelect, "local"));
}


function buildCustomStyleConfigFromModal(): CustomStyleConfig {
  if (!preferencesState.customStyleOverlay) return preferencesState.currentCustomStyleConfig;
  const diversityDriver = (
    preferencesState.customStyleOverlay.querySelector<HTMLInputElement>('input[name="custom-diversity"]:checked')?.value
    ?? "model-default"
  ) as DiversityPreference["driver"];
  const rawValue = Number((
    preferencesState.customStyleOverlay.querySelector<HTMLInputElement>("#custom-diversity-value")?.value
    ?? ""
  ).trim());
  const repetition = (
    preferencesState.customStyleOverlay.querySelector<HTMLInputElement>('input[name="custom-repetition"]:checked')?.value
    ?? "model-default"
  ) as RepetitionLevel;
  return normalizeCustomStyleConfig({
    diversity: diversityDriver === "model-default"
      ? { driver: "model-default" }
      : { driver: diversityDriver, value: rawValue },
    repetition,
  });
}

function ensureCustomStyleModal(): HTMLElement {
  if (preferencesState.customStyleOverlay) return preferencesState.customStyleOverlay;
  preferencesState.customStyleOverlay = document.createElement("div");
  preferencesState.customStyleOverlay.id = "custom-style-overlay";
  preferencesState.customStyleOverlay.className = "cy-modal-overlay is-hidden custom-style-overlay";
  preferencesState.customStyleOverlay.innerHTML = [
    '<div class="cy-modal custom-style-modal" role="dialog" aria-modal="true">',
    `  <div class="cy-modal__head"><span class="cy-modal__icon">🖊️</span><h3 class="cy-modal__title">${tOr("settings.customStyleModalTitle", "自定义风格采样")}</h3></div>`,
    '  <hr class="cy-modal__divider">',
    '  <div class="custom-style-modal__section">',
    `    <div class="custom-style-modal__label">${tOr("settings.diversityControl", "多样性控制")}</div>`,
    `    <label><input type="radio" name="custom-diversity" value="model-default"> ${tOr("settings.followModel", "跟随模型")}</label>`,
    '    <label><input type="radio" name="custom-diversity" value="temperature"> Temperature</label>',
    '    <label><input type="radio" name="custom-diversity" value="top-p"> Top-P</label>',
    '    <div class="custom-style-modal__value" id="custom-diversity-row"><span id="custom-diversity-label">Temperature</span><input id="custom-diversity-value" type="number" min="0" max="2" step="0.01"></div>',
    '  </div>',
    '  <div class="custom-style-modal__section">',
    `    <div class="custom-style-modal__label">${tOr("settings.repetitionControl", "重复控制")}</div>`,
    `    <label><input type="radio" name="custom-repetition" value="model-default"> ${tOr("settings.followModel", "跟随模型")}</label>`,
    `    <label><input type="radio" name="custom-repetition" value="light"> ${tOr("settings.repetitionLight", "轻度抑制")}</label>`,
    `    <label><input type="radio" name="custom-repetition" value="medium"> ${tOr("settings.repetitionMedium", "中度抑制")}</label>`,
    `    <label><input type="radio" name="custom-repetition" value="strong"> ${tOr("settings.repetitionStrong", "重度抑制")}</label>`,
    '  </div>',
    '  <div class="cy-modal__actions">',
    `    <button type="button" class="ghost-btn" id="custom-style-reset">${tOr("settings.restoreDefault", "恢复默认")}</button>`,
    `    <button type="button" class="ghost-btn" id="custom-style-cancel">${tOr("common.cancel", "取消")}</button>`,
    `    <button type="button" class="btn-primary" id="custom-style-save">${tOr("common.save", "保存")}</button>`,
    '  </div>',
    '</div>',
  ].join("\n");
  document.body.appendChild(preferencesState.customStyleOverlay);

  const updateDiversityRow = () => {
    const driver = preferencesState.customStyleOverlay!.querySelector<HTMLInputElement>(
      'input[name="custom-diversity"]:checked',
    )?.value ?? "model-default";
    const row = preferencesState.customStyleOverlay!.querySelector<HTMLElement>("#custom-diversity-row");
    const label = preferencesState.customStyleOverlay!.querySelector<HTMLElement>("#custom-diversity-label");
    const value = preferencesState.customStyleOverlay!.querySelector<HTMLInputElement>("#custom-diversity-value");
    if (!row || !label || !value) return;
    row.hidden = driver === "model-default";
    label.textContent = driver === "top-p" ? "Top-P" : "Temperature";
    value.min = "0";
    value.max = driver === "top-p" ? "1" : "2";
  };
  preferencesState.customStyleOverlay.querySelectorAll<HTMLInputElement>('input[name="custom-diversity"]').forEach((input) => {
    input.addEventListener("change", updateDiversityRow);
  });
  preferencesState.customStyleOverlay.querySelector<HTMLButtonElement>("#custom-style-cancel")?.addEventListener("click", () => {
    preferencesState.customStyleOverlay?.classList.add("is-hidden");
  });
  preferencesState.customStyleOverlay.querySelector<HTMLButtonElement>("#custom-style-reset")?.addEventListener("click", () => {
    renderCustomStyleModal(DEFAULT_CUSTOM_STYLE);
  });
  preferencesState.customStyleOverlay.querySelector<HTMLButtonElement>("#custom-style-save")?.addEventListener("click", async () => {
    try {
      preferencesState.currentCustomStyleConfig = buildCustomStyleConfigFromModal();
      await window.settings!.saveGeneral({ customStyle: preferencesState.currentCustomStyleConfig });
      preferencesState.customStyleOverlay?.classList.add("is-hidden");
      setPreferencesSaveStatus(tOr("settings.customStyleSaved", "自定义风格已保存"), "is-ok");
    } catch {
      setPreferencesSaveStatus(tOr("settings.customStyleSaveFailed", "自定义风格保存失败"), "is-error");
    }
  });
  return preferencesState.customStyleOverlay;
}

function renderCustomStyleModal(config: CustomStyleConfig): void {
  const overlay = ensureCustomStyleModal();
  const normalized = normalizeCustomStyleConfig(config);
  const driver = diversityDriverOf(normalized);
  const repetition = normalized.repetition;
  const driverInput = overlay.querySelector<HTMLInputElement>(
    `input[name="custom-diversity"][value="${driver}"]`,
  );
  const repetitionInput = overlay.querySelector<HTMLInputElement>(
    `input[name="custom-repetition"][value="${repetition}"]`,
  );
  if (driverInput) driverInput.checked = true;
  if (repetitionInput) repetitionInput.checked = true;
  const valueInput = overlay.querySelector<HTMLInputElement>("#custom-diversity-value");
  if (valueInput) valueInput.value = String(diversityValueOf(normalized));
  overlay.querySelectorAll<HTMLInputElement>('input[name="custom-diversity"]').forEach((input) => {
    input.dispatchEvent(new Event("change"));
  });
}

function openCustomStyleModal(): void {
  const overlay = ensureCustomStyleModal();
  renderCustomStyleModal(preferencesState.currentCustomStyleConfig);
  overlay.classList.remove("is-hidden");
}

function renderProactiveDeliveryVisibility(): void {
  proactiveDeliveryRow.hidden = getProactiveChatValue() !== "on";
}


function renderUiFont(font: UiFont): void {
  uiFontCurrent.textContent = font.kind === "custom" ? font.displayName : "思源黑体" + tOr("settings.defaultFontSuffix", "（默认）");
  uiFontResetButton.hidden = font.kind !== "custom";
}

function renderUiIcon(icon: UiIcon): void {
  uiIconSelect.querySelectorAll<HTMLButtonElement>(".appearance-icon-option").forEach((button) => {
    const active = button.dataset.icon === icon;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}




function fillPresetOptions(): void {
  if (!presetCards) return;
  presetCards.replaceChildren();
  for (const preset of MODEL_PRESETS) {
    if (preset.hiddenInPresetList) continue;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "preset-card";
    card.dataset.provider = preset.providerName;
    if (preset.disabled) {
      card.classList.add("is-disabled");
      card.disabled = true;
    }

    // logo：有本地 SVG 用 img，没有（如 DeepSeek）用首字母文字占位
    const logoWrap = document.createElement("span");
    logoWrap.className = "preset-card__logo";
    if (preset.iconUrl) {
      const img = document.createElement("img");
      img.src = preset.iconUrl;
      img.alt = "";
      img.width = 24;
      img.height = 24;
      logoWrap.appendChild(img);
    } else {
      logoWrap.textContent = preset.shortName.charAt(0);
    }
    card.appendChild(logoWrap);

    const label = document.createElement("span");
    label.className = "preset-card__name";
    label.textContent = preset.shortName;
    if (preset.disabled) label.textContent += tOr("settings.notAdaptedSuffix", "（暂未适配）");
    card.appendChild(label);

    presetCards.appendChild(card);
  }
}

/** 标记当前选中的厂商卡片（替换原 presetSelect.value = ...） */
function setActivePresetCard(providerName: string): void {
  if (!presetCards) return;
  const cardProvider = getCustomEndpointMode(providerName)
    ? CUSTOM_ENDPOINT_PROVIDERS.cloud
    : providerName;
  presetCards.querySelectorAll(".preset-card").forEach((card) => {
    card.classList.toggle("is-active", (card as HTMLElement).dataset.provider === cardProvider);
  });
}

function findPreset(providerName: string): ModelPreset {
  // fallback：找不到匹配的预设时，回退到列表第一个可用项（当前是 MiniMax）。
  // 不直接返回 MODEL_PRESETS[0] 是为了未来若把首项改成 disabled 也仍然合法。
  const fallback = MODEL_PRESETS.find((preset) => !preset.disabled) ?? MODEL_PRESETS[0];
  return MODEL_PRESETS.find((preset) => preset.providerName === providerName) ?? fallback;
}

/**
 * 填充模型名输入框 + datalist 联想建议。
 * 模式按钮已删除——只有一个输入框，可手填，按方向键也能从厂商预设里选。
 */
function fillModelOptions(preset: ModelPreset, preferredModel?: string): void {
  // datalist 联想建议
  modelInputSuggestions?.replaceChildren?.();
  for (const model of preset.mainModels) {
    const option = document.createElement("option");
    option.value = model;
    modelInputSuggestions?.appendChild?.(option);
  }

  const fallback = preset.mainModels[0] ?? "";
  modelInput.value = preferredModel ?? fallback;
  // 不在此处 autoResolve：applyPreset 会在填完 Key/URL 后统一触发
}

// ── 档案编辑（表单绑定档案，不再绑定"当前厂商"） ────────────────

/** 视觉三框是全局配置：切换档案/预设时先快照再恢复，避免被 preset 默认值覆盖。 */
function snapshotVisionInputs(): { baseUrl: string; apiKey: string; model: string; ocrEnabled: boolean } {
  return {
    baseUrl: visionBaseUrlInput.value,
    apiKey: visionApiKeyInput.value,
    model: visionModelInput.value,
    ocrEnabled: visionOcrToggle.checked,
  };
}

function restoreVisionInputs(snapshot: { baseUrl: string; apiKey: string; model: string; ocrEnabled: boolean }): void {
  visionBaseUrlInput.value = snapshot.baseUrl;
  visionApiKeyInput.value = snapshot.apiKey;
  visionModelInput.value = snapshot.model;
  visionOcrToggle.checked = snapshot.ocrEnabled;
}

/** 辅助模型是全局配置：切换档案/预设时先快照再恢复，避免被 preset 默认值覆盖。 */
function snapshotAuxiliaryInputs(): { mode: "inherit-main" | "dedicated"; baseUrl: string; apiKey: string; model: string } {
  return {
    mode: auxiliaryDedicatedToggle.checked ? "dedicated" : "inherit-main",
    baseUrl: auxiliaryBaseUrlInput.value,
    apiKey: auxiliaryApiKeyInput.value,
    model: auxiliaryModelInput.value,
  };
}

function restoreAuxiliaryInputs(snapshot: { mode: "inherit-main" | "dedicated"; baseUrl: string; apiKey: string; model: string }): void {
  auxiliaryDedicatedToggle.checked = snapshot.mode === "dedicated";
  auxiliaryBaseUrlInput.value = snapshot.baseUrl;
  auxiliaryApiKeyInput.value = snapshot.apiKey;
  auxiliaryModelInput.value = snapshot.model;
  if (auxiliaryDedicatedFields) {
    auxiliaryDedicatedFields.style.display = snapshot.mode === "dedicated" ? "block" : "none";
  }
}

/** 档案列表渲染：卡片 = 昵称 + 厂商 + 模型 + 徽标（默认/上下文/多模态）。 */
function renderProfileList(): void {
  if (!profileList) return;
  profileList.replaceChildren();
  const count = apiState.profiles.length;
  profileListCount.textContent = count ? `${count}${tOr("settings.profileCountSuffix", " 个档案")}` : "";

  if (count === 0) {
    const empty = document.createElement("div");
    empty.className = "profile-list__empty";
    empty.textContent = tOr("settings.noProfiles", "还没有档案。选下方厂商预设新建一个，保存后会出现在这里。");
    profileList.appendChild(empty);
    return;
  }

  for (const profile of apiState.profiles) {
    const isDefault = profile.id === apiState.defaultProfileId;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "profile-card" + (profile.id === apiState.editingProfileId ? " is-active" : "");
    card.dataset.profileId = profile.id;

    const name = document.createElement("span");
    name.className = "profile-card__name";
    name.textContent = profile.displayName || profile.provider;
    card.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "profile-card__meta";
    const metaParts: string[] = [findPreset(profile.provider).shortName, profile.model];
    if (profile.contextWindowTokens) metaParts.push(`${Math.round(profile.contextWindowTokens / 1000)}k`);
    meta.textContent = metaParts.join(" · ");
    card.appendChild(meta);

    const badges = document.createElement("span");
    badges.className = "profile-card__badges";
    if (isDefault) {
      const badge = document.createElement("span");
      badge.className = "profile-card__badge";
      badge.textContent = tOr("settings.defaultBadge", "默认");
      badges.appendChild(badge);
    }
    if (profile.multimodal === true) {
      const badge = document.createElement("span");
      badge.className = "profile-card__badge profile-card__badge--vision";
      badge.textContent = tOr("settings.multimodalBadge", "多模态");
      badges.appendChild(badge);
    }
    card.appendChild(badges);

    if (!isDefault) {
      const setDefaultBtn = document.createElement("span");
      setDefaultBtn.className = "profile-card__set-default";
      setDefaultBtn.textContent = tOr("settings.setDefault", "设为默认");
      setDefaultBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await window.settings?.setDefaultModelProfile?.(profile.id);
          await reloadProfiles();
        } catch (err) {
          console.warn("设置默认档案失败:", err);
        }
      });
      card.appendChild(setDefaultBtn);
    }

    profileList.appendChild(card);
  }
}

/** 从 main 拉取档案列表并渲染。 */
async function reloadProfiles(): Promise<void> {
  const catalog = await window.settings?.listModelProfiles?.();
  if (!catalog) return;
  apiState.profiles = catalog.profiles as SavedProfileLite[];
  apiState.defaultProfileId = catalog.defaultModelProfileId;
  renderProfileList();
}

/** 编辑状态 UI：标题 + 删除按钮可见性。 */
function applyEditingStateUI(): void {
  profileEditorTitle.textContent = apiState.editingProfileId ? tOr("settings.editProfileTitle", "编辑档案") : tOr("settings.newProfileTitle", "新建档案");
  deleteProfileBtn.hidden = !apiState.editingProfileId;
}

/**
 * 上下文窗口自动填充：输入框为空时，按（厂商, 模型）从主进程知识表解析
 * 并填入。模型未知/接口缺失/查询失败都静默跳过——用户手动输入永不被覆盖。
 */
const CATALOG_DEFAULT_CONTEXT = 256000;
function fillContextWindowIfEmpty(): void {
  if (!contextWindowInput.value.trim()) {
    const provider = apiState.activeProvider;
    const model = getCurrentModelValue().trim();
    window.settings?.lookupModelContextWindow?.(provider, model)
      .then((value) => {
        // 查询返回期间用户可能已手填/切换，二次校验再落值
        if (value && !contextWindowInput.value.trim()) {
          contextWindowInput.value = String(value);
        }
      })
      .catch(() => { /* 知识表查询失败静默：保持空，保存时走运行时回退 */ });
  }
}



/** 服务商模型下拉：点击可选用 */
/** 目录带出上下文（仅当输入框为空） */
async function autoResolveModelMeta(_reason: string): Promise<void> {
  const provider = apiState.activeProvider;
  const model = getCurrentModelValue().trim();
  if (!provider || !model) return;
  try {
    const v = await window.settings?.lookupModelContextWindow?.(provider, model);
    if (typeof v === "number" && v > 0) {
      const input = document.getElementById("context-window-input") as HTMLInputElement | null;
      if (!input?.value.trim()) applyContextTokens(v, false);
    }
  } catch {
    /* ignore */
  }
}

let _providerModelsCache: Array<{ id: string; contextWindow?: number }> = [];

/** 本页会话内缓存的模型列表（获取成功后才有；退出设置窗销毁） */
let _providerModelsCache: Array<{ id: string; contextWindow?: number }> = [];
let _modelListOpen = false;

const CONTEXT_PRESETS: Array<{ label: string; value: number }> = [
  { label: "8K", value: 8192 },
  { label: "32K", value: 32768 },
  { label: "64K", value: 65536 },
  { label: "128K", value: 131072 },
  { label: "200K", value: 200000 },
  { label: "256K", value: 262144 },
  { label: "512K", value: 524288 },
  { label: "1M", value: 1048576 },
];

function openModelDropdown(open: boolean): void {
  _modelListOpen = open;
  const drop = document.getElementById("provider-model-dropdown");
  const arrow = document.getElementById("model-list-toggle");
  if (drop) drop.style.display = open && _providerModelsCache.length ? "block" : "none";
  if (arrow) {
    // 未获取成功 → 完全不显示箭头
    if (!_providerModelsCache.length) {
      arrow.style.display = "none";
    } else {
      arrow.style.display = "";
      arrow.textContent = open ? "▲" : "▼";
    }
  }
}

function toggleModelDropdown(): void {
  if (!_providerModelsCache.length) return;
  openModelDropdown(!_modelListOpen);
  if (_modelListOpen) {
    renderProviderModelList(
      (document.getElementById("provider-model-search") as HTMLInputElement | null)?.value || "",
    );
  }
}

function renderProviderModelList(filter = ""): void {
  const box = document.getElementById("provider-model-list");
  if (!box) return;
  if (!_providerModelsCache.length) {
    openModelDropdown(false);
    box.innerHTML = "";
    return;
  }
  const q = filter.trim().toLowerCase();
  const list = _providerModelsCache.filter((m) => !q || m.id.toLowerCase().includes(q));
  const current = getCurrentModelValue().trim();
  if (!list.length) {
    box.innerHTML = '<div style="padding:10px;color:#888;font-size:13px;">无匹配模型</div>';
    return;
  }
  box.innerHTML = list
    .map((m) => {
      const active = m.id === current;
      return `<button type="button" class="provider-model-item" data-id="${m.id}" data-ctx="${m.contextWindow || ""}" style="display:flex;width:100%;justify-content:space-between;align-items:center;text-align:left;margin:2px 0;padding:9px 10px;min-height:38px;border:1px solid ${active ? "var(--brand-primary,#ff5b8a)" : "transparent"};border-radius:8px;background:${active ? "var(--brand-primary-soft,#fff1f6)" : "transparent"};cursor:pointer;">
        <span>${m.id}</span>
        <span style="font-size:12px;opacity:.7;">${m.contextWindow ? Math.round(m.contextWindow / 1000) + "K" : ""}</span>
      </button>`;
    })
    .join("");
  box.querySelectorAll<HTMLButtonElement>(".provider-model-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id || "";
      if (!id) return;
      modelInput.value = id;
      const ctx = btn.dataset.ctx;
      if (ctx && Number(ctx) > 0) {
        applyContextTokens(Number(ctx), false);
      } else {
        void autoResolveModelMeta("select");
      }
      openModelDropdown(false);
    });
  });
}

/** 上下文推荐下拉（贴输入框，未展开时隐藏） */
let _ctxListOpen = false;

function openContextPresetDropdown(open: boolean): void {
  _ctxListOpen = open;
  const drop = document.getElementById("context-preset-dropdown");
  const arrow = document.getElementById("context-preset-toggle");
  if (drop) drop.style.display = open ? "block" : "none";
  if (arrow) arrow.textContent = open ? "▲" : "▼";
  if (open) renderContextPresetList();
}

function renderContextPresetList(): void {
  const box = document.getElementById("context-preset-dropdown");
  if (!box) return;
  const current = (document.getElementById("context-window-input") as HTMLInputElement | null)?.value.trim() || "";
  const items = CONTEXT_PRESETS.map((p) => {
    const active = current === String(p.value);
    return `<button type="button" class="ctx-preset-item" data-value="${p.value}" style="display:flex;width:100%;justify-content:space-between;padding:9px 12px;min-height:38px;border:none;border-bottom:1px solid var(--ui-border,#f0f0f0);background:${active ? "var(--brand-primary-soft,#fff1f6)" : "transparent"};cursor:pointer;text-align:left;">
      <span>${p.label}</span><span style="opacity:.65;font-size:12px;">${p.value}</span>
    </button>`;
  }).join("");
  box.innerHTML =
    items +
    `<button type="button" class="ctx-preset-item" data-value="" style="display:block;width:100%;padding:9px 12px;min-height:38px;border:none;background:transparent;cursor:pointer;text-align:left;opacity:.75;">手填（清空推荐）</button>`;
  box.querySelectorAll<HTMLButtonElement>(".ctx-preset-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.value || "";
      const input = document.getElementById("context-window-input") as HTMLInputElement | null;
      if (input) input.value = v;
      openContextPresetDropdown(false);
    });
  });
}

function applyContextTokens(tokens: number, blank = false): void {
  const input = document.getElementById("context-window-input") as HTMLInputElement | null;
  if (input) input.value = blank || !tokens ? "" : String(tokens);
}

function toastModels(msg: string, type: "ok" | "err" | "info"): void {
  showToast(msg, type, type === "err" ? 4000 : 2600);
}

async function fetchModelsForCurrentForm(): Promise<void> {
  const provider = apiState.activeProvider || "";
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = getApiKeyForRequest?.() ?? "";
  if (!baseUrl) {
    toastModels("获取失败：请先填写 Base URL", "err");
    return;
  }
  if (!apiKey && !/ollama|localhost/i.test(provider + baseUrl)) {
    toastModels(`获取失败：请先填写「${provider || "当前厂商"}」的 API Key`, "err");
    return;
  }
  try {
    const fetchModels = window.settings?.fetchProviderModels;
    if (!fetchModels) {
      toastModels("获取失败：当前环境不支持", "err");
      return;
    }
    const result = await fetchModels({
      baseUrl,
      apiKey: /ollama|localhost/i.test(provider + baseUrl) && !apiKey ? "ollama" : apiKey,
    });
    if (result.ok && result.models?.length) {
      _providerModelsCache = result.models;
      const search = document.getElementById("provider-model-search") as HTMLInputElement | null;
      if (search) search.value = "";
      // 成功后才显示 ▼ 并展开列表
      openModelDropdown(true);
      renderProviderModelList("");
      const current = getCurrentModelValue().trim();
      const hit = result.models.find((m) => m.id === current);
      if (hit?.contextWindow) applyContextTokens(hit.contextWindow, false);
      toastModels(`获取到 ${result.models.length} 个模型`, "ok");
      return;
    }
    _providerModelsCache = [];
    openModelDropdown(false);
    const raw = String(result.error || "未知错误");
    const err = /<html|DOCTYPE|_next/i.test(raw) ? "接口返回网页，请检查 Base URL" : raw.slice(0, 100);
    toastModels(`获取失败：${err}`, "err");
  } catch (e) {
    toastModels(`获取失败：${String(e).slice(0, 100)}`, "err");
  }
}

function bindModelAutoResolve(): void {
  if ((globalThis as { _modelUiBound?: boolean })._modelUiBound) return;
  (globalThis as { _modelUiBound?: boolean })._modelUiBound = true;

  modelInput?.addEventListener("change", () => void autoResolveModelMeta("input"));
  modelInput?.addEventListener("blur", () => void autoResolveModelMeta("select"));

  document.getElementById("fetch-models-btn")?.addEventListener("click", () => {
    void fetchModelsForCurrentForm();
  });
  document.getElementById("model-list-toggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleModelDropdown();
  });
  document.getElementById("provider-model-search")?.addEventListener("input", (e) => {
    renderProviderModelList((e.target as HTMLInputElement).value);
  });
  // 仅在已有缓存时，点输入框切换下拉
  modelInput?.addEventListener("click", () => {
    if (_providerModelsCache.length) toggleModelDropdown();
  });

  // 上下文推荐下拉
  document.getElementById("context-preset-toggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextPresetDropdown(!_ctxListOpen);
  });
  document.getElementById("context-window-input")?.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const n = (el.value || "").replace(/[^0-9]/g, "");
    if (el.value !== n) el.value = n;
    if (_ctxListOpen) renderContextPresetList();
  });

  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (_modelListOpen && !target.closest("#provider-model-dropdown") && !target.closest("#model-list-toggle") && !target.closest("#model-input") && !target.closest("#fetch-models-btn")) {
      openModelDropdown(false);
    }
    if (_ctxListOpen && !target.closest("#context-preset-dropdown") && !target.closest("#context-preset-toggle") && !target.closest("#context-window-input")) {
      openContextPresetDropdown(false);
    }
  });
}
 } catch (e) { console.error("[Settings] bind", e); } // idempotent

  try { bindModelAutoResolve(); } catch (e) { console.error("[Settings] bind", e); } // idempotent

  try { bindModelAutoResolve(); } catch (e) { console.error("[Settings] bind model ui", e); } // idempotent

  initThemeSwitcher();
  initCustomSelects();
  initPasswordToggles();
  // 语言跟随通用设置；加载完成后刷新静态文案与当前标题栏
  void initSettingsI18n().then(() => {
    applySettingsI18n();
    switchSection(currentSection);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initSettingsPage();
  });
} else {
  initSettingsPage();
}

function initCustomSelects(): void {
  setTimeout(() => {
    try {
      const count = CustomSelect.wrapAll("select.setting-select");
      console.log("[CustomSelect] 成功包装", count.length, "个下拉栏");
    } catch (error) {
      console.error("[CustomSelect] 批量包装失败:", error);
    }
  }, 100);
}
// 通用密码显示/隐藏切换
function initPasswordToggles(): void {
  document.querySelectorAll<HTMLButtonElement>(".password-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      if (!targetId) return;
      const input = document.getElementById(targetId) as HTMLInputElement | null;
      if (!input) return;
      if (input.type === "password") {
        input.type = "text";
      } else {
        input.type = "password";
      }
    });
  });
}


windowCornerRadiusInput.addEventListener("input", () => {
  const radius = applyWindowCornerRadius(windowCornerRadiusInput.value);
  windowCornerRadiusVal.textContent = `${radius}px`;
  setAppearanceSaveStatus(tOr("settings.autoApplyOnRelease", "松开后自动应用"));
});

windowCornerRadiusInput.addEventListener("change", () => {
  const windowCornerRadius = normalizeWindowCornerRadius(windowCornerRadiusInput.value);
  void saveAppearancePatch({ windowCornerRadius });
});

petAlwaysOnTopInput.addEventListener("change", () => {
  window.settings?.setPetAlwaysOnTop(petAlwaysOnTopInput.checked);
  setAppearanceSaveStatus(tOr("settings.applied", "已应用"), "is-ok");
});

uiFontImportButton.addEventListener("click", async () => {
  try {
    const sourcePath = await window.settings?.pickUiFont();
    if (!sourcePath) return;
    uiFontImportButton.disabled = true;
    setAppearanceSaveStatus(tOr("settings.importingFont", "正在导入字体…"));
    const font = await window.settings!.importUiFont(sourcePath);
    renderUiFont(font);
    setAppearanceSaveStatus(tOr("settings.fontApplied", "字体已应用"), "is-ok");
  } catch (error) {
    console.error("导入字体失败:", error);
    setAppearanceSaveStatus(tOr("settings.fontImportFailed", "导入字体失败"), "is-error");
  } finally {
    uiFontImportButton.disabled = false;
  }
});

uiFontResetButton.addEventListener("click", async () => {
  try {
    uiFontResetButton.disabled = true;
    const font = await window.settings!.resetUiFont();
    renderUiFont(font);
    setAppearanceSaveStatus(tOr("settings.fontRestored", "已恢复思源黑体"), "is-ok");
  } catch (error) {
    console.error("恢复默认字体失败:", error);
    setAppearanceSaveStatus(tOr("settings.fontRestoreFailed", "恢复默认字体失败"), "is-error");
  } finally {
    uiFontResetButton.disabled = false;
  }
});

uiIconSelect.querySelectorAll<HTMLButtonElement>(".appearance-icon-option").forEach((button) => {
  button.addEventListener("click", async () => {
    const icon = normalizeUiIcon(button.dataset.icon);
    try {
      await window.settings!.saveGeneral({ uiIcon: icon });
      renderUiIcon(icon);
      setAppearanceSaveStatus(tOr("settings.iconApplied", "图标已应用"), "is-ok");
    } catch (error) {
      console.error("应用图标失败:", error);
      setAppearanceSaveStatus(tOr("settings.iconApplyFailed", "应用图标失败"), "is-error");
    }
  });
});

petVisibleInput.addEventListener("change", () => {
  window.settings?.setPetVisible(petVisibleInput.checked);
  setAppearanceSaveStatus(tOr("settings.applied", "已应用"), "is-ok");
});
petZoomInput.addEventListener("input", () => {
  petZoomVal.textContent = Math.round(Number(petZoomInput.value) * 100) + "%";
});
petZoomInput.addEventListener("change", () => {
  window.settings?.setPetZoom(Number(petZoomInput.value));
  setAppearanceSaveStatus(tOr("settings.applied", "已应用"), "is-ok");
});

// 角色选择器自定义下拉组件
let characterDropdownOpen = false;
function toggleCharacterDropdown(open?: boolean): void {
  characterDropdownOpen = open ?? !characterDropdownOpen;
  characterDropdownPanel.classList.toggle("is-hidden", !characterDropdownOpen);
  characterDropdownTrigger.setAttribute("aria-expanded", String(characterDropdownOpen));
  characterDropdownTrigger.classList.toggle("is-open", characterDropdownOpen);
}

characterDropdownTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleCharacterDropdown();
});

characterDropdownPanel.addEventListener("click", async (e) => {
  const option = (e.target as HTMLElement).closest<HTMLButtonElement>(".character-dropdown__option");
  if (!option) return;
  const characterId = option.dataset.characterId;
  const styleId = option.dataset.styleId;
  if (!characterId || !styleId) return;
  // 更新 UI
  characterDropdownValue.textContent = option.textContent;
  characterDropdownPanel.querySelectorAll(".character-dropdown__option").forEach((el) => {
    const btn = el as HTMLButtonElement;
    const active = btn.dataset.characterId === characterId;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  toggleCharacterDropdown(false);
  // 保存：同时切换角色和绑定的回复风格
  // 风格（currentStyleId）实时生效，Live2D 模型（currentCharacterId）重启后生效
  try {
    await window.settings!.saveGeneral({ currentCharacterId: characterId, currentStyleId: styleId as StyleId });
    const styleName = STYLE_DISPLAY_NAMES[styleId as StyleId] ?? styleId;
    setAppearanceSaveStatus(`${tOr("settings.switchedPrefix", "已切换到「")}${option.textContent?.split(" · ")[0]}${tOr("settings.switchedMid", "」· ")}${styleName}${tOr("settings.switchedSuffix", "风格实时生效，模型重启后生效")}`, "is-ok");
  } catch {
    setAppearanceSaveStatus(tOr("settings.characterSwitchFailed", "角色切换保存失败"), "is-error");
  }
});

document.addEventListener("click", (e) => {
  if (!characterDropdownOpen) return;
  if (!characterDropdown.contains(e.target as Node)) {
    toggleCharacterDropdown(false);
  }
});

// ── 角色管理 UI（动态生成，避免修改庞大的 index.html） ──
(function initCharacterManager() {
  // 在角色下拉框后面插入"管理角色"按钮
  const manageBtn = document.createElement("button");
  manageBtn.type = "button";
  manageBtn.className = "ghost-btn character-manage-btn";
  manageBtn.id = "character-manage-btn";
  manageBtn.textContent = tOr("settings.manageCharacters", "管理角色");
  characterDropdown.after(manageBtn);

  // 创建角色管理弹窗
  const modal = document.createElement("div");
  modal.className = "character-modal is-hidden";
  modal.id = "character-modal";
  modal.innerHTML = `
    <div class="character-modal__backdrop" data-close></div>
    <div class="character-modal__card">
      <div class="character-modal__header">
        <h2>${tOr("settings.characterModalTitle", "角色管理")}</h2>
        <button type="button" class="ghost-btn" data-close>${tOr("common.close", "关闭")}</button>
      </div>
      <div class="character-modal__body">
        <div class="character-modal__list" id="character-manage-list"></div>
        <div class="character-modal__editor is-hidden" id="character-manage-editor">
          <h3 id="character-editor-title">${tOr("settings.editCharacterTitle", "编辑角色")}</h3>
          <label class="character-field">
            <span>${tOr("settings.characterNameLabel", "角色名称")}</span>
            <input type="text" id="character-edit-name" placeholder="${tOr("settings.characterNamePlaceholder", "例如：昔涟")}" />
          </label>
          <label class="character-field">
            <span>${tOr("settings.characterModelPathLabel", "模型路径")}</span>
            <input type="text" id="character-edit-modelpath" placeholder="${tOr("settings.characterModelPathPlaceholder", "相对于 assets/models/，例如 cyrene/Cyrene.model3.json")}" />
          </label>
          <label class="character-field">
            <span>${tOr("settings.characterStyleLabel", "绑定风格")}</span>
            <select id="character-edit-style">
              <option value="default">${tOr("settings.styleDefault", "温柔（默认）")}</option>
              <option value="lively">${tOr("settings.styleLively", "元气·活泼")}</option>
              <option value="healing">${tOr("settings.styleHealing", "治愈·安心")}</option>
              <option value="focused">${tOr("settings.styleFocused", "知性·认真")}</option>
              <option value="sweet">${tOr("settings.styleSweet", "撒娇·黏人")}</option>
              <option value="custom">${tOr("settings.styleCustom", "自定义")}</option>
            </select>
          </label>
          <div class="character-modal__actions">
            <button type="button" class="ghost-btn" data-cancel>${tOr("common.cancel", "取消")}</button>
            <button type="button" class="save-btn" data-save>${tOr("settings.saveCharacter", "保存角色")}</button>
          </div>
        </div>
      </div>
      <div class="character-modal__footer">
        <span class="save-status" id="character-manage-status">${tOr("common.pendingAction", "等待操作")}</span>
        <button type="button" class="save-btn" id="character-add-btn">${tOr("settings.newCharacter", "+ 新建角色")}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const listEl = modal.querySelector("#character-manage-list") as HTMLDivElement;
  const editorEl = modal.querySelector("#character-manage-editor") as HTMLDivElement;
  const editorTitle = modal.querySelector("#character-editor-title") as HTMLElement;
  const nameInput = modal.querySelector("#character-edit-name") as HTMLInputElement;
  const modelPathInput = modal.querySelector("#character-edit-modelpath") as HTMLInputElement;
  const styleSelect = modal.querySelector("#character-edit-style") as HTMLSelectElement;
  const statusEl = modal.querySelector("#character-manage-status") as HTMLElement;
  const addBtn = modal.querySelector("#character-add-btn") as HTMLButtonElement;

  let editingCharacters: CharacterConfig[] = [];
  let editingIndex = -1;

  function setStatus(text: string, type: "" | "is-ok" | "is-error" = "") {
    statusEl.textContent = text;
    statusEl.className = "save-status" + (type ? " " + type : "");
  }

  function renderList() {
    listEl.innerHTML = "";
    editingCharacters.forEach((char, idx) => {
      const styleName = STYLE_DISPLAY_NAMES[char.styleId] ?? char.styleId;
      const item = document.createElement("div");
      item.className = "character-manage-item";
      item.innerHTML = `
        <div class="character-manage-item__info">
          <strong>${char.name}</strong>
          <span>${styleName}${tOr("settings.characterItemMetaMid", "风格 · ")}${char.modelPath}</span>
        </div>
        <div class="character-manage-item__actions">
          <button type="button" class="ghost-btn" data-edit="${idx}">${tOr("common.edit", "编辑")}</button>
          <button type="button" class="ghost-btn is-danger" data-delete="${idx}" ${char.id === "cyrene" ? `disabled title='${tOr("settings.defaultCharNotDeletable", "默认角色不可删除")}'` : ""}>${tOr("common.delete", "删除")}</button>
        </div>
      `;
      listEl.appendChild(item);
    });
  }

  function openEditor(index: number) {
    editingIndex = index;
    const char = editingCharacters[index];
    editorTitle.textContent = index === -1 ? tOr("settings.newCharacterTitle", "新建角色") : tOr("settings.editCharacterTitle", "编辑角色");
    nameInput.value = char?.name ?? "";
    modelPathInput.value = char?.modelPath ?? "";
    styleSelect.value = char?.styleId ?? "default";
    listEl.classList.add("is-hidden");
    editorEl.classList.remove("is-hidden");
    addBtn.classList.add("is-hidden");
  }

  function closeEditor() {
    editingIndex = -1;
    listEl.classList.remove("is-hidden");
    editorEl.classList.add("is-hidden");
    addBtn.classList.remove("is-hidden");
  }

  async function saveEditor() {
    const name = nameInput.value.trim();
    const modelPath = modelPathInput.value.trim();
    const styleId = styleSelect.value as StyleId;
    if (!name) { setStatus(tOr("settings.characterNameRequired", "请填写角色名称"), "is-error"); return; }
    if (!modelPath) { setStatus(tOr("settings.characterModelPathRequired", "请填写模型路径"), "is-error"); return; }

    if (editingIndex === -1) {
      // 新建：生成唯一 ID
      const baseId = name.toLowerCase().replace(/[^a-z0-9]/g, "-") || "character";
      let id = baseId;
      let n = 1;
      while (editingCharacters.some((c) => c.id === id)) {
        id = `${baseId}-${n++}`;
      }
      editingCharacters.push({ id, name, modelPath, styleId });
    } else {
      editingCharacters[editingIndex] = {
        ...editingCharacters[editingIndex],
        name,
        modelPath,
        styleId,
      };
    }

    try {
      await window.settings!.saveGeneral({ characters: editingCharacters });
      setStatus(tOr("settings.characterSaved", "角色已保存"), "is-ok");
      closeEditor();
      renderList();
      // 刷新外观设置的角色下拉框
      void loadGeneralSettings();
    } catch {
      setStatus(tOr("common.saveFailed", "保存失败"), "is-error");
    }
  }

  // 事件绑定
  manageBtn.addEventListener("click", async () => {
    try {
      const cfg = await window.settings!.getGeneral();
      editingCharacters = Array.isArray(cfg.characters) && cfg.characters.length > 0
        ? [...cfg.characters]
        : [{ id: "cyrene", name: "昔涟", modelPath: "cyrene/Cyrene.model3.json", styleId: "default" }];
      renderList();
      closeEditor();
      modal.classList.remove("is-hidden");
      setStatus(tOr("common.pendingAction", "等待操作"));
    } catch {
      setStatus(tOr("settings.loadCharactersFailed", "读取角色列表失败"), "is-error");
    }
  });

  modal.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", () => modal.classList.add("is-hidden"));
  });

  listEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const editBtn = target.closest("[data-edit]");
    const deleteBtn = target.closest("[data-delete]");
    if (editBtn) {
      openEditor(Number(editBtn.getAttribute("data-edit")));
    } else if (deleteBtn && !deleteBtn.hasAttribute("disabled")) {
      const idx = Number(deleteBtn.getAttribute("data-delete"));
      const char = editingCharacters[idx];
      if (window.confirm(`${tOr("settings.deleteCharConfirmPrefix", "确定删除角色「")}${char.name}${tOr("settings.deleteCharConfirmSuffix", "」？\n删除后不可恢复。")}`)) {
        editingCharacters.splice(idx, 1);
        window.settings!.saveGeneral({ characters: editingCharacters })
          .then(() => {
            setStatus(tOr("settings.characterDeleted", "角色已删除"), "is-ok");
            renderList();
            void loadGeneralSettings();
          })
          .catch(() => setStatus(tOr("settings.deleteFailed", "删除失败"), "is-error"));
      }
    }
  });

  addBtn.addEventListener("click", () => {
    editingIndex = -1;
    openEditor(-1);
  });

  editorEl.querySelector("[data-cancel]")?.addEventListener("click", closeEditor);
  editorEl.querySelector("[data-save]")?.addEventListener("click", () => void saveEditor());
})();

// 行间距滑块
chatLineHeightInput.addEventListener("input", () => {
  const val = Number(chatLineHeightInput.value);
  chatLineHeightVal.textContent = val.toFixed(2);
  document.documentElement.style.setProperty("--rb-chat-line-height", String(val));
  setAppearanceSaveStatus(tOr("settings.autoApplyOnRelease", "松开后自动应用"));
});
chatLineHeightInput.addEventListener("change", () => {
  void saveAppearancePatch({ chatLineHeight: Number(chatLineHeightInput.value) });
});
assistantBubbleEnabledInput.addEventListener("change", () => {
  void saveAppearancePatch({ assistantBubbleEnabled: assistantBubbleEnabledInput.checked });
});
// 段间距滑块
chatParaSpacingInput.addEventListener("input", () => {
  const val = Number(chatParaSpacingInput.value);
  chatParaSpacingVal.textContent = val.toFixed(2) + "em";
  document.documentElement.style.setProperty("--rb-chat-para-spacing", val + "em");
  setAppearanceSaveStatus(tOr("settings.autoApplyOnRelease", "松开后自动应用"));
});
chatParaSpacingInput.addEventListener("change", () => {
  void saveAppearancePatch({ chatParaSpacing: Number(chatParaSpacingInput.value) });
});

defaultChatModeSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    applyDefaultChatModeSelection(normalizeDefaultChatMode(button.dataset.value));
    setPreferencesSaveStatus(tOr("settings.unsavedChanges", "有未保存的更改"));
  });
});

segmentedOutputSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    applySegmentedOutputSelection(normalizeSegmentedOutputMode(button.dataset.value));
    setPreferencesSaveStatus(tOr("settings.unsavedChanges", "有未保存的更改"));
  });
});

mobileMessageSegmentationSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    applyMobileMessageSegmentationSelection(normalizeMobileMessageSegmentationMode(button.dataset.value));
    setPreferencesSaveStatus(tOr("settings.unsavedChanges", "有未保存的更改"));
  });
});

proactiveChatSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    applyProactiveChatSelection(normalizeProactiveChatMode(button.dataset.value));
    renderProactiveDeliveryVisibility();
    setPreferencesSaveStatus(tOr("settings.unsavedChanges", "有未保存的更改"));
  });
});

proactiveDeliverySelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    applyProactiveDeliverySelection(normalizeProactiveDeliveryTarget(button.dataset.value));
    setPreferencesSaveStatus(tOr("settings.unsavedChanges", "有未保存的更改"));
  });
});

citaEnabledInput.addEventListener("change", () => {
  setPreferencesSaveStatus(tOr("settings.unsavedChanges", "有未保存的更改"));
});


// ── 模型厂商 Work 流程适配说明 ──────────────────────────────
// 展示各厂商结构化输出档位与实测兼容性；「详细文档」在 app 内本地渲染完整实测报告。
// 模型厂商 Work 流程适配（手写 HTML，避免引入 markdown 渲染依赖）
const WORK_FLOW_COMPAT_MD = `
<h2>模型兼容性</h2>
<blockquote>Cyrene 会根据不同厂商自动选择对应的 Structured Output Profile。</blockquote>
<table>
  <thead>
    <tr><th>厂商</th><th>支持状态</th><th>档位</th><th>已实测模型</th><th>说明</th></tr>
  </thead>
  <tbody>
    <tr><td>OpenAI</td><td>⚠️ 文档适配</td><td>A</td><td>-</td><td>已完成官方协议适配，等待实测。</td></tr>
    <tr><td>Claude</td><td>⚠️ 文档适配</td><td>A</td><td>-</td><td>已完成官方协议适配，等待实测。</td></tr>
    <tr><td>豆包</td><td>✅ 已实测</td><td>A</td><td>Seed 2.1 Turbo / Pro</td><td>推荐使用，完整 Work 流程稳定。</td></tr>
    <tr><td>Kimi</td><td>✅ 已实测</td><td>A</td><td>K2.6、K2.7 Code</td><td>推荐普通 API，Coding 端点不建议用于 Work。</td></tr>
    <tr><td>DeepSeek</td><td>✅ 已实测</td><td>B</td><td>V4 Flash、V4 Pro</td><td>推荐，速度快、稳定。</td></tr>
    <tr><td>Qwen</td><td>✅ 已实测</td><td>B</td><td>Qwen3.7 Max</td><td>推荐，表现稳定。</td></tr>
    <tr><td>GLM</td><td>✅ 已实测</td><td>B</td><td>GLM 5.1、5.2</td><td>推荐，4.7 不建议。</td></tr>
    <tr><td>MiMo</td><td>✅ 已实测</td><td>B</td><td>MiMo 2.5、2.5 Pro</td><td>推荐，表现稳定。</td></tr>
    <tr><td>MiniMax</td><td>✅ 已实测</td><td>M</td><td>MiniMax M3</td><td>推荐，需使用 M 档适配。</td></tr>
    <tr><td>其他模型</td><td>⚠️ 文档适配</td><td>D</td><td>-</td><td>使用通用兼容模式，请自行验证。</td></tr>
  </tbody>
</table>
<h3>档位说明</h3>
<ul>
  <li><strong>A</strong>：原生 JSON Schema / Function Calling</li>
  <li><strong>B</strong>：JSON Object + 本地校验</li>
  <li><strong>M</strong>：MiniMax 专用适配</li>
  <li><strong>D</strong>：通用兼容模式（未知模型 / 自定义端点）</li>
</ul>
`.trim();

// 测试连接按钮：调用厂商 adapter 的真实连接测试
if (testConnectionBtn) {
  const btn = testConnectionBtn;
  btn.addEventListener("click", async () => {
    const provider = apiState.activeProvider;
    const baseUrl = baseUrlInput.value;
    const model = getCurrentModelValue().trim();
    const customValidationError = validateActiveCustomEndpoint();
    if (customValidationError) {
      setSaveStatus(customValidationError, "is-error");
      return;
    }
    const apiKey = getApiKeyForRequest();
    if (!baseUrl) { setSaveStatus(tOr("settings.needApiUrlBeforeTest", "请先填写 API URL 再测试"), "is-error"); return; }
    if (!model) { setSaveStatus(tOr("settings.needModelBeforeTest", "请先选择/填写模型再测试"), "is-error"); return; }
    if (!await saveTimeoutSettings(true)) {
      return;
    }
    setSaveStatus(tOr("settings.testingConnection", "测试连接中…"));
    btn.disabled = true;
    try {
      const result = await window.settings!.testConnection!({
        provider,
        baseUrl,
        model,
        apiKey,
        explicitTransport: transportSelect.value as ProviderProfile["explicitTransport"],
        reasoning: apiState.editingReasoning,
      });
      if (result.ok) setSaveStatus(tOr("settings.connSuccessPrefix", "连接成功 ") + result.latency + "ms · " + (result.sample ?? ""), "is-ok");
      else setSaveStatus(tOr("settings.connFailed", "连接失败：") + (result.error ?? tOr("common.unknownError", "未知错误")), "is-error");
    } catch (e) {
      setSaveStatus(tOr("settings.connFailed", "连接失败：") + (e instanceof Error ? e.message : String(e)), "is-error");
    } finally {
      
      // 测试成功后从服务商拉取模型列表，自动检查模型名与上下文
      void (async () => {
        try {
          const fetchModels = window.settings?.fetchProviderModels;
          if (!fetchModels) return;
          const result = await fetchModels({ baseUrl, apiKey });
          if (!result.ok || !result.models?.length) {
            const meta = document.getElementById("context-window-auto-hint");
            if (meta && result.error) {
              meta.textContent = tOr("settings.providerModelsFailed", "官方接口未提供模型列表，请手动填写模型名") + ": " + result.error;
            }
            return;
          }
          // 更新 datalist
          modelInputSuggestions?.replaceChildren?.();
          for (const m of result.models) {
            const option = document.createElement("option");
            option.value = m.id;
            modelInputSuggestions?.appendChild?.(option);
          }
          const current = getCurrentModelValue().trim();
          const hit = result.models.find((m) => m.id === current);
          const meta = document.getElementById("context-window-auto-hint");
          if (!hit) {
            if (meta) {
              meta.textContent =
                tOr("settings.modelNotInProviderList", "服务商未返回完整模型列表或该模型不在列表中，请手动填写模型 ID")
                + " · " + tOr("settings.providerModelCount", "服务商共")
                + " " + result.models.length + " " + tOr("settings.providerModelCountUnit", "个");
            }
            return;
          }
          if (hit.contextWindow && hit.contextWindow > 0) {
            contextWindowInput.value = String(hit.contextWindow);
            if (meta) {
              meta.textContent = tOr("settings.contextFromProvider", "上下文窗口来自服务商 API");
            }
          } else if (meta) {
            meta.textContent = tOr("settings.modelInProviderList", "模型已在服务商列表中；官方未提供上下文长度，请手动填写 Token");
            fillContextWindowIfEmpty();
          }
        } catch { /* ignore */ }
      })();
btn.disabled = false;
    }
  });
}

// ── 视觉模型配置事件 ──────────────────────────────────────
// 多模态开关：ON 隐藏视觉配置区，OFF 显示
multimodalToggle.addEventListener("change", () => {
  applyMultimodalUI();
  setSaveStatus(tOr("settings.unsavedChanges", "有未保存的更改"));
});

// Base URL 重置按钮：一键复原厂商默认 baseUrl
baseUrlResetBtn.addEventListener("click", () => {
  const preset = findPreset(apiState.activeProvider);
  if (preset) {
    baseUrlInput.value = transportSelect.value === "anthropic" && preset.anthropicBaseUrl
      ? preset.anthropicBaseUrl
      : preset.baseUrl;
    updateEndpointPreview();
    setSaveStatus(tOr("settings.resetToDefaultUrl", "已重置为厂商默认 URL"));
  }
});

baseUrlInput.addEventListener("input", updateEndpointPreview);
transportSelect.addEventListener("change", () => {
  const preset = findPreset(apiState.activeProvider);
  const currentBaseUrl = baseUrlInput.value.trim().replace(/\/$/, "");
  const knownPresetUrls = [preset.baseUrl, preset.anthropicBaseUrl]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\/$/, ""));
  if (knownPresetUrls.includes(currentBaseUrl)) {
    if (transportSelect.value === "anthropic" && preset.anthropicBaseUrl) {
      baseUrlInput.value = preset.anthropicBaseUrl;
    } else if (transportSelect.value === "openai" || transportSelect.value === "responses") {
      // responses 与 openai 共用同一 Base URL（后缀由 resolveApiEndpoint 追加）
      baseUrlInput.value = preset.baseUrl;
    }
  }
  updateEndpointPreview();
  if (transportSelect.value === "anthropic" && !preset.anthropicBaseUrl && preset.transport !== "anthropic") {
    transportHint.textContent = tOr("settings.anthropicNotBuiltin", "该厂商的 Anthropic 兼容地址未内置；请按服务商文档填写 Base URL，程序只追加 /v1/messages。");
  }
  setSaveStatus(tOr("settings.unsavedChanges", "有未保存的更改"));
});

// 测试视觉模型按钮（仅在多模态开关 OFF 时可见）
testVisionBtn.addEventListener("click", async () => {
  const synced = multimodalToggle.checked;
  const baseUrl = synced ? baseUrlInput.value : visionBaseUrlInput.value;
  const apiKey = synced ? apiKeyInput.value : visionApiKeyInput.value;
  const model = synced ? getCurrentModelValue() : visionModelInput.value;
  if (!baseUrl) { visionTestStatus.textContent = tOr("settings.visionUrlRequired", "请先填写 API URL"); return; }
  if (!model) { visionTestStatus.textContent = tOr("settings.needVisionModelBeforeTest", "请先填写视觉型号"); return; }
  visionTestStatus.textContent = tOr("settings.testing", "测试中…");
  testVisionBtn.disabled = true;
  try {
    const result = await window.settings!.testVision?.({ baseUrl, apiKey, model });
    if (result?.ok) visionTestStatus.textContent = tOr("settings.visionConnSuccessPrefix", "✅ 连接成功 ") + result.latency + "ms · " + (result.sample ?? "");
    else visionTestStatus.textContent = tOr("settings.visionConnFailedPrefix", "❌ ") + (result?.error ?? tOr("common.unknownError", "未知错误"));
  } catch (e) {
    visionTestStatus.textContent = tOr("settings.visionConnFailedPrefix", "❌ ") + (e instanceof Error ? e.message : String(e));
  } finally {
    testVisionBtn.disabled = false;
  }
});

// 辅助模型：切换独立配置时显示/隐藏字段
auxiliaryDedicatedToggle.addEventListener("change", () => {
  if (auxiliaryDedicatedFields) {
    auxiliaryDedicatedFields.style.display = auxiliaryDedicatedToggle.checked ? "block" : "none";
  }
});

// 测试 OCR 服务按钮
testOcrBtn.addEventListener("click", async () => {
  ocrTestStatus.textContent = tOr("settings.ocrTesting", "测试中…（首次需下载语言包，可能较慢）");
  testOcrBtn.disabled = true;
  try {
    const result = await window.settings!.testOcr?.();
    if (result?.ok) {
      ocrTestStatus.textContent = tOr("settings.ocrOkPrefix", "✅ OCR 服务正常 ") + result.latency + "ms · " + (result.sample ?? "");
    } else {
      ocrTestStatus.textContent = tOr("settings.ocrFailPrefix", "❌ ") + (result?.error ?? tOr("common.unknownError", "未知错误"));
    }
  } catch (e) {
    ocrTestStatus.textContent = tOr("settings.ocrFailPrefix", "❌ ") + (e instanceof Error ? e.message : String(e));
  } finally {
    testOcrBtn.disabled = false;
  }
});




apiRuntimeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setRuntimeSaveStatus(tOr("settings.saving", "保存中…"));
  try {
    if (!await saveTimeoutSettings(false)) return;
    setRuntimeSaveStatus(tOr("common.saved", "已保存"), "is-ok");
  } catch {
    setRuntimeSaveStatus(tOr("common.saveFailed", "保存失败"), "is-error");
  }
});

appearanceForm.addEventListener("submit", (e) => {
  e.preventDefault();
});

generalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setGeneralSaveStatus(tOr("settings.saving", "保存中…"));
  try {
    await window.settings!.saveGeneral({
      disableGpuElectron: disableGpuInput.checked,
      sidebarVisible: sidebarVisibleInput.checked,
      tasksVisible: tasksVisibleInput.checked,
      launchAtLogin: launchAtLoginInput.checked,
      language: "zh-CN",
    });
    setGeneralSaveStatus(tOr("common.saved", "已保存"), "is-ok");
  } catch {
    setGeneralSaveStatus(tOr("common.saveFailed", "保存失败"), "is-error");
  }
});

cyrenePanel.addEventListener("submit", async (e) => {
  e.preventDefault();
  setCyreneSaveStatus(tOr("settings.saving", "保存中…"));
  try {
    const rawDim = embeddingDimensionsInput?.value?.trim();
    const parsedNum = rawDim ? Number(rawDim) : NaN;
    const parsedDim = Number.isFinite(parsedNum) && parsedNum > 0
      ? Math.max(1, Math.min(65536, Math.round(parsedNum)))
      : undefined;
    await window.settings!.saveConfig({
      runtimeSync: getRuntimeSyncValue(),
      stickerEnabled: stickerEnabledInput.checked,
      stickerSize: getStickerSizeValue(),
      stickerSimilarityThreshold: parseFloat(stickerThresholdInput.value),
      embeddingDimensions: parsedDim && parsedDim > 0 ? parsedDim : undefined,
    });
    setCyreneSaveStatus(tOr("common.saved", "已保存"), "is-ok");
  } catch {
    setCyreneSaveStatus(tOr("common.saveFailed", "保存失败"), "is-error");
  }
});

apiForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const customValidationError = validateActiveCustomEndpoint();
  if (customValidationError) {
    setSaveStatus(customValidationError, "is-error");
    return;
  }
  setSaveStatus(tOr("settings.saving", "保存中…"));
  try {
    if (!await saveTimeoutSettings(true)) {
      return;
    }
    // 档案保存：editingProfileId 存在 = 更新（字段全量覆盖），否则新增。
    // 上下文窗口与多模态跟随档案；留空 = 自动（运行时按模型知识表解析，不再固化 256000）。
    const isEditing = Boolean(apiState.editingProfileId);
    const typedContextWindow = parseInt(contextWindowInput.value.trim(), 10);
    const profile = {
      id: apiState.editingProfileId,
      provider: apiState.activeProvider,
      displayName: displayNameInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      model: getCurrentModelValue().trim(),
      apiKey: getApiKeyForRequest(),
      explicitTransport: transportSelect.value as ApiTransport,
      reasoning: apiState.editingReasoning,
      contextWindowTokens: Number.isFinite(typedContextWindow) && typedContextWindow >= 1
        ? Math.max(4096, typedContextWindow)
        : undefined,
      multimodal: multimodalToggle.checked,
    };
    const result = await window.settings!.saveModelProfile?.(profile);
    if (!result) throw new Error(tOr("settings.modelListUnavailable", "模型列表不可用"));
    // 全局选项（视觉模型/辅助模型/思考开关/maxToken）不随档案走，单独保存
    await window.settings!.saveConfig({
      vision: {
        baseUrl: visionBaseUrlInput.value.trim(),
        apiKey: visionApiKeyInput.value.trim(),
        model: visionModelInput.value.trim(),
        ocrEnabled: visionOcrToggle.checked,
      },
      auxiliary: {
        mode: auxiliaryDedicatedToggle.checked ? "dedicated" : "inherit-main",
        baseUrl: auxiliaryBaseUrlInput.value.trim(),
        apiKey: auxiliaryApiKeyInput.value.trim(),
        model: auxiliaryModelInput.value.trim(),
      },
      skillConsolidationEnabled: consolidationToggle ? consolidationToggle.checked : false,
      thinkingOverride: (thinkingModeCustomSelect ? thinkingModeCustomSelect.getValue() : thinkingModeSelect?.value) === "enable" ? 1 : (thinkingModeCustomSelect ? thinkingModeCustomSelect.getValue() : thinkingModeSelect?.value) === "disable" ? -1 : 0,
      disableMaxToken: toggleDisableMaxToken.checked,
    });
    if (isEditing) {
      setSaveStatus(tOr("settings.profileUpdated", "档案已更新"), "is-ok");
    } else if (result.added) {
      setSaveStatus(tOr("settings.profileAdded", "已加入模型列表"), "is-ok");
      // 新建成功后切到编辑态，用户可直接再改再存
      const saved = (result.profiles as SavedProfileLite[]).at(-1);
      if (saved && saved.id) {
        apiState.editingProfileId = saved.id;
        apiState.editingReasoning = saved.reasoning;
        applyEditingStateUI();
      }
    } else {
      setSaveStatus(tOr("settings.profileDuplicate", "相同 Key、模型名与 URL 的档案已存在"), "is-error");
    }
    await reloadProfiles();
  } catch {
    setSaveStatus(tOr("common.saveFailed", "保存失败"), "is-error");
  }
});












function switchSection(section: string): void {
  currentSection = section;
  const label = NAV_LABELS[section] ?? NAV_LABELS.api;
  const dictKey = sectionDictKey(section);
  const title = tOr(`nav.${dictKey}`, label.title);
  const hint = tOr(`hint.${dictKey}`, label.hint);
  sectionTitle.textContent = title;
  sectionHint.textContent = hint;
  // 先更新导航栏激活状态，确保即使后面的面板初始化出错也能正确高亮
  document.querySelectorAll(".nav-item").forEach((el) => {
    const isMatch = (el as HTMLElement).dataset.section === section;
    el.classList.toggle("is-active", isMatch);
  });


  const isApi = section === "api";
  const isApiAdvanced = section === "api-advanced";
  const isAppearance = section === "appearance";
  const isStorage = section === "storage";
  const isGeneral = section === "general";
  const isPreferences = section === "preferences";
  const isCharacterStyle = section === "character-style";
  const isCyrene = section === "cyrene";
  const isDisclaimer = section === "disclaimer";
  const isMemory = section === "memory";
  const isUser = section === "user";
  const isTasks = section === "tasks";
  const isPlugins = section === "plugins";
  const isTokens = section === "tokens";
  const isChannels = section === "channels";
  const isTts = section === "tts";
  const isAsr = section === "asr";
  const isMusic = section === "music";
  const isSkills = section === "skills";
  const isLsp = section === "lsp";
  const isBackup = section === "backup";
  apiForm.classList.toggle("is-hidden", !isApi);
  apiRuntimeForm.classList.toggle("is-hidden", !isApiAdvanced);
  appearanceForm.classList.toggle("is-hidden", !isAppearance);
  generalForm?.classList?.toggle?.("is-hidden", !isGeneral);
  const storagePanelEl2 = document.getElementById("storage-panel");
  if (storagePanelEl2) storagePanelEl2.classList.toggle("is-hidden", !isStorage);
  if (isStorage) { try { void initStoragePanel(); } catch (e) { console.error("[Storage]", e); } }
  preferencesForm.classList.toggle("is-hidden", !isPreferences);
  characterStyleForm.classList.toggle("is-hidden", !isCharacterStyle);
  cyrenePanel.classList.toggle("is-hidden", !isCyrene);
  disclaimerPanel.classList.toggle("is-hidden", !isDisclaimer);
  const memoryPanel = document.getElementById("memory-panel");
  if (memoryPanel) memoryPanel.classList.toggle("is-hidden", !isMemory);
  const userPanel = document.getElementById("user-panel");
  if (userPanel) userPanel.classList.toggle("is-hidden", !isUser);
  const tasksPanel = document.getElementById("tasks-panel");
  if (tasksPanel) tasksPanel.classList.toggle("is-hidden", !isTasks);
  if (isTasks) void loadSchedulerPanel();
  pluginsPanel.classList.toggle("is-hidden", !isPlugins);
  const tokenPanel = document.getElementById("token-panel");
  if (tokenPanel) tokenPanel.classList.toggle("is-hidden", !isTokens);
  const channelsPanel = document.getElementById("channels-panel");
  if (channelsPanel) channelsPanel.classList.toggle("is-hidden", !isChannels);
  if (isChannels) void loadChannelsPanel();
  const ttsPanel = document.getElementById("tts-panel");
  if (ttsPanel) ttsPanel.classList.toggle("is-hidden", !isTts);
  const asrPanel = document.getElementById("asr-panel");
  if (asrPanel) asrPanel.classList.toggle("is-hidden", !isAsr);
  const musicPanel = document.getElementById("music-panel");
  if (musicPanel) musicPanel.classList.toggle("is-hidden", !isMusic);
  if (isMusic) void loadMusicPanel();
  else disposeMusicPanel();
  const skillsPanel = document.getElementById("skills-panel");
  if (skillsPanel) skillsPanel.classList.toggle("is-hidden", !isSkills);
  if (isSkills) { try { initSkillsPanel(); } catch (e) { console.error("[Skills] 初始化失败:", e); } }
  const lspPanel = document.getElementById("lsp-panel");
  if (lspPanel) lspPanel.classList.toggle("is-hidden", !isLsp);
  if (isLsp) { try { void initLspPanel(); } catch (e) { console.error("[LSP] 初始化失败:", e); } }
  const backupPanel = document.getElementById("backup-panel");
  if (backupPanel) backupPanel.classList.toggle("is-hidden", !isBackup);
  if (isBackup) { try { initBackupPanel(); } catch (e) { console.error("[Backup] 初始化失败:", e); } }

  placeholderPanel.classList.toggle(
    "is-hidden",
    isApi || isApiAdvanced || isAppearance || isGeneral || isStorage || isPreferences || isCharacterStyle || isCyrene || isDisclaimer || isMemory || isUser || isTasks || isPlugins || isTokens || isChannels || isTts || isAsr || isMusic || isSkills || isLsp || isBackup,
  );

  if (
    !isApi &&
    !isApiAdvanced &&
    !isAppearance &&
    !isGeneral &&
    !isStorage &&
    !isPreferences &&
    !isCharacterStyle &&
    !isCyrene &&
    !isDisclaimer &&
    !isMemory &&
    !isUser &&
    !isTasks &&
    !isPlugins &&
    !isTokens &&
    !isChannels &&
    !isTts &&
    !isAsr &&
    !isMusic &&
    !isSkills &&
    !isLsp &&
    !isBackup
  ) {
	    placeholderIcon.innerHTML = label.emoji;
    placeholderTitle.textContent = title;
    placeholderCopy.textContent = tOr("placeholder.copy", "这个模块先占位，等核心聊天与 API 接通后再继续扩展。");
  }

  document.querySelectorAll(".nav-item").forEach((el) => {
    const isMatch = (el as HTMLElement).dataset.section === section;
    el.classList.toggle("is-active", isMatch);
  });
  const activeNav = document.querySelector(".nav-item.is-active");
  console.log("[Settings/Trace] switchSection section=", section, "activeNav=", activeNav ? (activeNav as HTMLElement).dataset.section : null);
}

document.querySelectorAll(".nav-item").forEach((el) => {
  el.addEventListener("click", () => {
    const section = (el as HTMLElement).dataset.section;
    if (!section) return;
    try {
      switchSection(section);
    } catch (err) {
      console.error("[Settings] switchSection failed", section, err);
      // 即使面板初始化失败，也要切换标题与激活态，保证导航仍可用
      try {
        currentSection = section;
        const label = NAV_LABELS[section] ?? NAV_LABELS.api;
        sectionTitle.textContent = tOr(`nav.${sectionDictKey(section)}`, label.title);
        sectionHint.textContent = tOr(`hint.${sectionDictKey(section)}`, label.hint);
        document.querySelectorAll(".nav-item").forEach((n) => {
          n.classList.toggle("is-active", (n as HTMLElement).dataset.section === section);
        });
      } catch { /* ignore */ }
    }
  });
});

schedulerNewBtn?.addEventListener("click", () => void openSchedulerEditor());
schedulerEditorClose?.addEventListener("click", closeSchedulerEditor);
schedulerCancelBtn?.addEventListener("click", closeSchedulerEditor);
schedulerSaveBtn?.addEventListener("click", () => void saveSchedulerTask());
schedulerKindInput?.addEventListener("change", updateSchedulerConditionalFields);
schedulerToolLimitInput?.addEventListener("change", updateSchedulerConditionalFields);
schedulerSilentStartInput?.addEventListener("change", () => void saveSchedulerSilentHours());
schedulerSilentEndInput?.addEventListener("change", () => void saveSchedulerSilentHours());
updateSchedulerConditionalFields();

void loadConfig();
void loadGeneralSettings();
window.settings?.onChannelsStatusChanged((status) => {
  renderProactiveDeliveryAvailability(status as Record<string, { phase?: string }>);
});

// ===== channels panel (连接手机) =====
// 飞书配置输入框（Phase 2 长连接版：只需 App ID + App Secret）
// 微信按钮





// ===== Phase 3.4：消息日志 =====





// 首次进入 channels panel 时拉一次日志
// （也可以在用户展开 details 时再拉，但保持简单直接拉）
void loadChannelsPanel();

// ===== Phase 2: 音乐工具面板 =====
// 备注：window.music.* 已在 preload 中通过 contextBridge 暴露。
// 由于 renderer 走 Vite 打包、main/preload 走 esbuild，两端类型不互通，
// 这里直接用 (window as any).music 做弱类型化调用，避免给 global.d.ts 加一堆 cross-bundle 类型。




















// ── 网易云折叠卡片状态已移除：外部不显示具体连接状态，只在音乐面板内可见 ──

// 初始化角色与风格面板
initCharacterStylePanel();
initBackupPanel();

// 启动时读 URL hash 决定初始标签（main 通过 loadURL 带 #api 实现"切换模型按钮跳 API"）。
// 无 hash 默认 general。
const initialSection = (window.location.hash || "#general").slice(1);
switchSection(initialSection);
// 监听 main 发来的切标签事件（窗口已打开时，main 不重新 loadURL，改发事件）
window.settings?.onSwitchSection?.((section) => {
  switchSection(section);
});
// --- L0/L1 editable logic ---














// Bind edit button events
memoryL0EditBtn?.addEventListener("click", () => {
  if (memoryState.l0Editing) { saveL0(); } else { enterL0EditMode(); }
});
memoryL0CancelBtn?.addEventListener("click", cancelL0Edit);

memoryL1EditBtn?.addEventListener("click", () => {
  if (memoryState.l1Editing) { saveL1(); } else { enterL1EditMode(); }
});
memoryL1CancelBtn?.addEventListener("click", cancelL1Edit);

// ── Obsidian Vault 绑定 UI（逻辑抽离至 ./memory/obsidian-vault-ui）──

initObsidianVaultUI();

memoryImportedList?.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement | null;
  const deleteBtn = target?.closest(".memory-record__delete") as HTMLElement | null;
  if (!deleteBtn) return;

  const importId = deleteBtn.dataset.importId || "";
  const fileName = deleteBtn.dataset.fileName || tOr("settings.untitledDoc", "未命名文档");

  const confirmed = await showModal({
    title: tOr("settings.deleteDocTitle", "删除导入知识"),
    message: tOr("settings.deleteDocConfirmPrefix", "确定删除导入知识？\n\n文件：\n《") + fileName + tOr("settings.deleteDocConfirmSuffix", "》\n\n删除后不可恢复，如需使用请重新导入。"),
    icon: "⚠️",
    confirmText: tOr("common.delete", "删除"),
    cancelText: tOr("common.cancel", "取消"),
  });

  if (!confirmed) return;

  try {
    const result = await window.memoryPanel?.deleteImportedDoc(importId, fileName);
    if (result?.ok) {
      await loadMemoryPanel();
    }
  } catch (err) {
    console.error("[settings] delete imported doc failed", err);
  }
});


void loadMemoryPanel();


// ── 音乐工具手风琴 ─────────────────────────────────────────
musicToggle?.addEventListener("click", () => {
  const expanded = musicToggle?.getAttribute("aria-expanded") === "true";
  musicToggle?.setAttribute("aria-expanded", String(!expanded));
  musicAccordionCard?.classList.toggle("is-expanded", !expanded);
  musicAccordionBody?.classList.toggle("is-collapsed", expanded);
});

// ── 音乐工具路由 ──────────────────────────────────────────────
initLocalMusicPanel();

// 技能管理面板改为懒加载，在 switchSection 中第一次切换到 skills 时初始化

document.getElementById("music-platform-netease")?.addEventListener("click", () => {
  switchSection("music");
  musicHomeView?.classList.add("is-hidden");
  neteaseDetailView?.classList.remove("is-hidden");
});
musicReturnBtn?.addEventListener("click", () => {
	  switchSection("plugins");
	});



// ── 清空聊天历史 ─────────────────────────────────────────────
clearChatHistoryBtn.addEventListener("click", async () => {
  if (!window.confirm(tOr("settings.clearChatConfirm", "清空所有聊天会话？\n此操作会删除全部历史对话，无法恢复。"))) return;
  const chatStore = (window as typeof window & { chatStore?: ChatStoreApi }).chatStore;
  try {
    const sessions = await chatStore?.list();
    if (sessions && sessions.length > 0) {
      // 串行删除（store 不支持批量删除；会话数量不会大，可接受）
      for (const s of sessions) {
        await chatStore?.delete(s.id);
      }
    }
    setGeneralSaveStatus(tOr("settings.clearChatDone", "所有聊天会话已清空"), "is-ok");
  } catch (err) {
    console.warn("[settings] 清空聊天会话失败:", err);
    setGeneralSaveStatus(tOr("settings.clearChatFailed", "清空失败，请查看终端日志"), "is-error");
  }
});

// ── 预设卡：选择厂商 = 开始新建档案草稿 ───────────────────────
presetCards?.addEventListener("click", (e) => {
  const card = (e.target as HTMLElement).closest(".preset-card") as HTMLElement | null;
  if (!card || card.classList.contains("is-disabled")) return;
  const cardProviderName = card.dataset.provider;
  if (!cardProviderName) return;

  const providerName = getCustomEndpointMode(cardProviderName)
    ? getCustomEndpointProvider(apiState.customEndpointMode)
    : cardProviderName;
  startNewDraft(providerName);
  setSaveStatus(tOr("settings.presetApplied", "已应用预设，填写 API Key 后保存档案"));
});

// ── 自定义端点云端/本地模式切换（切换 = 换草稿厂商） ───────────
customEndpointControls?.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-custom-endpoint-mode]");
  const nextMode = button?.dataset.customEndpointMode as CustomEndpointMode | undefined;
  if (!nextMode || nextMode === apiState.customEndpointMode) return;

  apiState.customEndpointMode = nextMode;
  const providerName = getCustomEndpointProvider(nextMode);
  startNewDraft(providerName);
  setSaveStatus(nextMode === "local"
    ? tOr("settings.fillLocalEndpoint", "请填写本地服务地址和模型 ID")
    : tOr("settings.fillCloudEndpoint", "请填写云端服务地址、API Key 和模型 ID"));
});

// ── 档案列表：点击档案载入编辑 ────────────────────────────────
profileList?.addEventListener("click", (e) => {
  const card = (e.target as HTMLElement).closest(".profile-card") as HTMLElement | null;
  if (!card) return;
  const profileId = card.dataset.profileId;
  const profile = apiState.profiles.find((p) => p.id === profileId);
  if (!profile) return;
  editProfile(profile, multimodalToggle.checked);
});

// ── 删除当前编辑的档案 ────────────────────────────────────────
deleteProfileBtn?.addEventListener("click", async () => {
  if (!apiState.editingProfileId) return;
  const profile = apiState.profiles.find((p) => p.id === apiState.editingProfileId);
  const name = profile?.displayName || profile?.model || tOr("settings.thisProfile", "该档案");
  try {
    await window.settings?.deleteModelProfile?.(apiState.editingProfileId);
    setSaveStatus(tOr("settings.profileDeletedPrefix", "已删除「") + name + tOr("settings.profileDeletedSuffix", "」"), "is-ok");
    await reloadProfiles();
    // 删除后切到剩余的默认档案；没有档案则回到草稿态
    const next = apiState.profiles.find((p) => p.id === apiState.defaultProfileId) ?? apiState.profiles[0];
    if (next) {
      editProfile(next, multimodalToggle.checked);
    } else {
      startNewDraft(apiState.activeProvider || "MiniMax（稀宇科技）");
    }
  } catch {
    setSaveStatus(tOr("settings.deleteFailed", "删除失败"), "is-error");
  }
});

// ── 偏好设置：聊天社交上下文 / 自定义风格 / 表单提交 ─────────
chatSocialContextEnabledInput.addEventListener("change", () => {
  setPreferencesSaveStatus(tOr("settings.unsavedChanges", "有未保存的更改"));
});

customStyleSamplingBtn?.addEventListener("click", () => {
  openCustomStyleModal();
});

customStylePromptBtn?.addEventListener("click", async () => {
  try {
    const result = await window.settings?.openCustomStylePrompt?.();
    if (!result?.ok) {
      setPreferencesSaveStatus(tOr("settings.openPromptFailed", "打开 Prompt 文件失败"), "is-error");
      return;
    }
    setPreferencesSaveStatus(tOr("settings.promptOpened", "已打开 Prompt 文件位置"), "is-ok");
  } catch {
    setPreferencesSaveStatus(tOr("settings.openPromptFailed", "打开 Prompt 文件失败"), "is-error");
  }
});

preferencesForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setPreferencesSaveStatus(tOr("settings.saving", "保存中…"));
  try {
    await window.settings!.saveGeneral({
      citaEnabled: citaEnabledInput.checked,
      citaSemanticEngine: "remote",
      chatSocialContextEnabled: chatSocialContextEnabledInput.checked,
      defaultChatMode: "chat",
      segmentedOutputMode: "off",
      mobileMessageSegmentation: getMobileMessageSegmentationValue(),
      proactiveChatMode: getProactiveChatValue(),
      proactiveDeliveryTarget: getProactiveDeliveryValue(),
    });
    setPreferencesSaveStatus(tOr("common.saved", "已保存"), "is-ok");
  } catch {
    setPreferencesSaveStatus(tOr("common.saveFailed", "保存失败"), "is-error");
  }
});
