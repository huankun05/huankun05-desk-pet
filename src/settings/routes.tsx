import type { ComponentType } from 'react';
import React from 'react';
import {
  createHashRouter,
  Navigate,
  isRouteErrorResponse,
  useRouteError,
  type RouteObject,
} from 'react-router-dom';
import { SettingsLayout } from './components/SettingsLayout';

/**
 * 路由级错误兜底：任何页面渲染抛错（含 HMR 陈旧实例导致的 Provider 缺失）
 * 都显示友好提示而非 React Router 默认白屏。
 */
// routes.tsx 同时导出非组件的路由实例 `routes`，Fast Refresh 无法拆分，故以下组件豁免。
// eslint-disable-next-line react-refresh/only-export-components
function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : '未知错误';
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-lg font-medium text-neutral-800">页面出错了</p>
      <pre className="max-w-md whitespace-pre-wrap text-xs text-neutral-500">{message}</pre>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white transition-colors hover:bg-indigo-600"
      >
        重新加载
      </button>
    </div>
  );
}

// 页面组件懒加载映射：在路由匹配时才动态 import，减小 settings bundle
const pageComponentLoaders: Record<string, () => Promise<{ default: ComponentType }>> = {
  '/settings/appearance': () => import('./pages/appearance/AppearanceIndex'),
  '/settings/appearance/general': () => import('./pages/appearance/GeneralPage'),
  '/settings/appearance/interaction': () => import('./pages/appearance/InteractionPage'),
  '/settings/appearance/bubble': () => import('./pages/appearance/BubblePage'),
  '/settings/appearance/display': () => import('./pages/appearance/DisplayPage'),
  '/settings/appearance/performance': () => import('./pages/appearance/PerformancePage'),
  '/settings/chat': () => import('./pages/chat/ChatIndex'),
  '/settings/chat/appearance': () => import('./pages/chat/ChatAppearancePage'),
  '/settings/chat/input': () => import('./pages/chat/ChatInputPage'),
  '/settings/chat/voice': () => import('./pages/chat/ChatVoicePage'),
  '/settings/chat/session': () => import('./pages/chat/ChatSessionPage'),
  '/settings/chat/call-summaries': () => import('./pages/chat/CallSummariesPage'),
  '/settings/models': () => import('./pages/models/ModelsIndex'),
  '/settings/models/live2d': () => import('./pages/models/Live2DPage'),
  '/settings/models/behavior': () => import('./pages/models/BehaviorPage'),
  '/settings/models/character': () => import('./pages/models/CharacterPage'),
  '/settings/models/emotion': () => import('./pages/models/EmotionPage'),
  '/settings/models/personality': () => import('./pages/models/PersonalityPage'),
  '/settings/models/expressions': () => import('./pages/models/ExpressionsPage'),
  '/settings/models/interaction': () => import('./pages/models/InteractionPage'),
  '/settings/services': () => import('./pages/services/ServicesIndex'),
  '/settings/services/status': () => import('./pages/services/StatusPage'),
  '/settings/services/llm': () => import('./pages/services/LLMPage'),
  '/settings/services/tts': () => import('./pages/services/TTSPage'),
  '/settings/services/stt': () => import('./pages/services/STTPage'),
  '/settings/services/embedding': () => import('./pages/services/EmbeddingPage'),
  '/settings/services/multimodal': () => import('./pages/services/MultimodalPage'),
  '/settings/services/vision': () => import('./pages/services/VisionPage'),
  '/settings/services/usage': () => import('./pages/services/UsagePage'),
  '/settings/extensions': () => import('./pages/extensions/ExtensionsIndex'),
  '/settings/extensions/mcp': () => import('./pages/services/McpPage'),
  '/settings/extensions/wake-word': () => import('./pages/services/WakeWordPage'),
  '/settings/extensions/plugins': () => import('./pages/extensions/PluginsPage'),
  '/settings/extensions/tools': () => import('./pages/extensions/ToolsPage'),
  '/settings/extensions/marketplace': () => import('./pages/marketplace/MarketplaceIndex'),
  '/settings/privacy': () => import('./pages/privacy/PermissionsIndex'),
  '/settings/memory': () => import('./pages/memory/MemoryIndex'),
  '/settings/memory/context': () => import('./pages/memory/ContextPage'),
  '/settings/memory/long-term': () => import('./pages/memory/LongTermPage'),
  '/settings/memory/data': () => import('./pages/memory/DataPage'),
  '/settings/memory/view': () => import('./pages/memory/MemoryViewPage'),
  '/settings/memory/sessions': () => import('./pages/memory/SessionPage'),
  '/settings/system': () => import('./pages/system/SystemIndex'),
  '/settings/system/general': () => import('./pages/system/GeneralPage'),
  '/settings/system/developer': () => import('./pages/system/DeveloperPage'),
  '/settings/system/about': () => import('./pages/system/AboutPage'),
  '/settings/system/automation': () => import('./pages/system/AutomationPage'),
  '/settings/system/shortcuts': () => import('./pages/system/ShortcutsPage'),
  '/settings/system/files': () => import('./pages/system/FileManagerPage'),
  '/settings/system/storage': () => import('./pages/system/StoragePage'),
};

/**
 * 路由 meta 信息
 * 用于：SettingsLayout 顶部标题栏（图标 + 标题 + 副标题）
 */
export interface SettingsMeta {
  /** 主标题（中文） */
  title: string;
  /** 副标题（英文） */
  subtitle?: string;
  /** 描述文字 */
  description?: string;
  /** Solar duotone 图标名 */
  icon: string;
  /** 是否作为父级列表中的可点击入口 */
  settingsEntry?: boolean;
  /** 在父级列表中的排序（升序） */
  order?: number;
}

/**
 * 设置条目：meta + 路径 + 子条目
 * 一份配置同时驱动路由表与标题栏元数据
 */
export interface SettingsEntry extends SettingsMeta {
  /** 完整路径（用于导航） */
  path: string;
  /** 子条目（存在则该路径为二级入口页） */
  children?: SettingsEntry[];
  /** 自定义布局组件（存在则用该组件包裹子路由，通常用于 Tab 布局） */
  layout?: ComponentType;
}

/** 设置根 meta —— 用于 /settings 首页 */
const settingsRootMeta: SettingsMeta = {
  title: '设置',
  subtitle: 'Settings',
  description: '应用配置中心',
  icon: 'solar:settings-bold-duotone',
};

/**
 * 设置树：驱动路由表与标题栏元数据的单一真相源
 *
 * 图标与描述与各 IndexPage 组件保持一致（bold-duotone 风格）
 *
 * 路径结构：
 * /settings
 *   /  (index - 设置首页)
 *   /appearance
 *     /  (index - 外观二级入口)
 *     /general  (主题)
 *     /interaction  (交互设置)
 *   /models
 *     /  (index - 角色二级入口)
 *     /live2d  (Live2D 模型切换)
 *     /character  (角色管理)
 *     /behavior  (角色行为)
 *   /services
 *     /  (index - AI 服务二级入口)
 *     /llm  (语言模型)
 *     /tts  (语音合成)
 *     /stt  (语音识别)
 *     /multimodal  (多模态)
 *   /extensions
 *     /  (index - 扩展二级入口)
 *     /mcp  (MCP 服务器)
 *     /wake-word  (语音唤醒)
 *     /plugins  (已安装插件管理；市场已独立为 /settings/extensions/marketplace)
 *   /memory
 *     /  (index - 记忆体二级入口)
 *     /context  (上下文管理：短期对话窗口)
 *     /long-term  (长期记忆：RAG / 混合检索 / LLM 增强抽取)
 *     /rules  (规则管理)
 *     /view  (记忆查看)
 *     /sessions  (会话档案)
 *     /data  (数据管理)
 *     /backup  (备份与恢复)
 *   /system
 *     /  (index - 系统二级入口)
 *     /general  (常规)
 *     /developer  (开发者)
 *     /about  (关于)
 *     /automation  (自动化)
 *     /shortcuts  (快捷键)
 */
export const settingsTree: SettingsEntry[] = [
  {
    title: '外观',
    subtitle: 'Appearance',
    description: '主题、样式、视觉效果',
    icon: 'solar:pallete-2-bold-duotone',
    settingsEntry: true,
    order: 1,
    path: '/settings/appearance',
    children: [
      {
        title: '通用',
        subtitle: 'General',
        description: '主题预设、明暗模式',
        icon: 'solar:emoji-funny-square-bold-duotone',
        settingsEntry: true,
        order: 0,
        path: '/settings/appearance/general',
      },
      {
        title: '交互',
        subtitle: 'Interaction',
        description: '淡出效果、透明度、点击反馈',
        icon: 'solar:hand-stars-bold-duotone',
        settingsEntry: true,
        order: 1,
        path: '/settings/appearance/interaction',
      },
      {
        title: '气泡与字体',
        subtitle: 'Bubble & Font',
        description: '气泡字号、圆角、配色、时长与位置',
        icon: 'solar:document-text-bold-duotone',
        settingsEntry: true,
        order: 2,
        path: '/settings/appearance/bubble',
      },
      {
        title: '窗口与性能',
        subtitle: 'Window & Performance',
        description: 'FPS 显示、窗口位置记忆',
        icon: 'solar:monitor-bold-duotone',
        settingsEntry: true,
        order: 3,
        path: '/settings/appearance/performance',
      },
    ],
  },
  {
    title: '聊天',
    subtitle: 'Chat',
    description: '聊天窗口的外观、输入、语音与会话数据',
    icon: 'solar:document-text-bold-duotone',
    settingsEntry: true,
    order: 2,
    path: '/settings/chat',
    children: [
      {
        title: '聊天外观',
        subtitle: 'Chat Appearance',
        description: '头像、气泡、背景、配色与字号（仅作用于聊天窗口）',
        icon: 'solar:pallete-2-bold-duotone',
        settingsEntry: true,
        order: 0,
        path: '/settings/chat/appearance',
      },
      {
        title: '输入与命令',
        subtitle: 'Input & Commands',
        description: '发送快捷键、Slash 自动补全、附件行为',
        icon: 'solar:keyboard-bold-duotone',
        settingsEntry: true,
        order: 1,
        path: '/settings/chat/input',
      },
      {
        title: '语音',
        subtitle: 'Voice',
        description: 'TTS、STT、唤醒词',
        icon: 'solar:microphone-bold-duotone',
        settingsEntry: true,
        order: 2,
        path: '/settings/chat/voice',
      },
      {
        title: '会话与数据',
        subtitle: 'Sessions & Data',
        description: '历史会话、收藏消息、数据清理',
        icon: 'solar:folder-with-files-bold-duotone',
        settingsEntry: true,
        order: 3,
        path: '/settings/chat/session',
      },
      {
        title: '通话记录',
        subtitle: 'Call Summaries',
        description: '语音通话的口语化复盘，可查看/搜索/重命名/导出',
        icon: 'solar:phone-calling-bold-duotone',
        settingsEntry: true,
        order: 4,
        path: '/settings/chat/call-summaries',
      },
    ],
  },
  {
    title: '角色',
    subtitle: 'Character',
    description: 'Live2D 模型、人设与行为',
    icon: 'solar:document-add-bold-duotone',
    settingsEntry: true,
    order: 2,
    path: '/settings/models',
    children: [
      {
        title: 'Live2D 模型',
        subtitle: 'Live2D Models',
        description: '模型切换、参数调整与角色外观（镜像/显隐）',
        icon: 'solar:gallery-bold-duotone',
        settingsEntry: true,
        order: 0,
        path: '/settings/models/live2d',
      },
      {
        title: '角色管理',
        subtitle: 'Character',
        description: '角色提示词、人设管理',
        icon: 'solar:user-circle-bold-duotone',
        settingsEntry: true,
        order: 1,
        path: '/settings/models/character',
      },
      {
        title: '角色行为',
        subtitle: 'Behavior',
        description: '互动行为、内心独白、主动聊天',
        icon: 'solar:user-heart-bold-duotone',
        settingsEntry: true,
        order: 2,
        path: '/settings/models/behavior',
      },
      {
        title: '情绪状态',
        subtitle: 'Emotion',
        description: '九维情绪、PAD 映射、情绪变化记录',
        icon: 'solar:emoji-funny-circle-bold-duotone',
        settingsEntry: true,
        order: 3,
        path: '/settings/models/emotion',
      },
      {
        title: '人格画像',
        subtitle: 'Personality',
        description: 'HEXACO 六维人格、PAD 基线、人格描述',
        icon: 'solar:user-circle-bold-duotone',
        settingsEntry: true,
        order: 4,
        path: '/settings/models/personality',
      },
      {
        title: '表情与动作',
        subtitle: 'Expressions & Motions',
        description: '表情/动作预览、启用停用与情绪映射',
        icon: 'solar:emoji-funny-circle-bold-duotone',
        settingsEntry: true,
        order: 5,
        path: '/settings/models/expressions',
      },
      {
        title: '交互消息',
        subtitle: 'Interaction Messages',
        description: '点击反馈、闲聊台词池、冷却时间与 TTS 设置',
        icon: 'solar:document-text-bold-duotone',
        settingsEntry: true,
        order: 5,
        path: '/settings/models/interaction',
      },
    ],
  },
  {
    title: '服务',
    subtitle: 'Services',
    description: 'LLM、语音合成、语音识别、多模态',
    icon: 'solar:server-bold-duotone',
    settingsEntry: true,
    order: 3,
    path: '/settings/services',
    children: [
      {
        title: '运行状态',
        subtitle: 'Status',
        description: '本地服务运行状态与手动启动/停止/重启',
        icon: 'solar:health-bold-duotone',
        settingsEntry: true,
        order: 0,
        path: '/settings/services/status',
      },
      {
        title: '语言模型',
        subtitle: 'LLM',
        description: 'API 配置、模型选择',
        icon: 'solar:document-text-bold-duotone',
        settingsEntry: true,
        order: 1,
        path: '/settings/services/llm',
      },
      {
        title: '语音合成',
        subtitle: 'TTS',
        description: 'TTS 引擎配置',
        icon: 'solar:speaker-bold-duotone',
        settingsEntry: true,
        order: 2,
        path: '/settings/services/tts',
      },
      {
        title: '语音识别',
        subtitle: 'STT',
        description: 'STT 引擎配置',
        icon: 'solar:microphone-bold-duotone',
        settingsEntry: true,
        order: 3,
        path: '/settings/services/stt',
      },
      {
        title: 'Embedding',
        subtitle: 'Embedding',
        description: '向量模型配置',
        icon: 'solar:database-bold-duotone',
        settingsEntry: true,
        order: 4,
        path: '/settings/services/embedding',
      },
      {
        title: '多模态',
        subtitle: 'Multimodal',
        description: 'Vision 模型、截图分析配置',
        icon: 'solar:camera-bold-duotone',
        settingsEntry: true,
        order: 5,
        path: '/settings/services/multimodal',
      },
      {
        title: '视觉模型',
        subtitle: 'Vision',
        description: '独立视觉模型服务（截图理解、一起看优先使用）',
        icon: 'solar:eye-bold-duotone',
        settingsEntry: true,
        order: 6,
        path: '/settings/services/vision',
      },
      {
        title: '用量统计',
        subtitle: 'Usage',
        description: 'LLM / 视觉调用成本账本与报表',
        icon: 'solar:chart-2-bold-duotone',
        settingsEntry: true,
        order: 7,
        path: '/settings/services/usage',
      },
    ],
  },
  {
    title: '扩展',
    subtitle: 'Extensions',
    description: 'MCP、语音唤醒、插件与市场',
    icon: 'solar:widget-5-bold-duotone',
    settingsEntry: true,
    order: 4,
    path: '/settings/extensions',
    children: [
      {
        title: 'MCP',
        subtitle: 'MCP Servers',
        description: '模型上下文协议服务器',
        icon: 'solar:server-square-cloud-bold-duotone',
        settingsEntry: true,
        order: 0,
        path: '/settings/extensions/mcp',
      },
      {
        title: '语音唤醒',
        subtitle: 'Wake Word',
        description: '唤醒词检测与模型管理',
        icon: 'solar:soundwave-bold-duotone',
        settingsEntry: true,
        order: 1,
        path: '/settings/extensions/wake-word',
      },
      {
        title: '插件',
        subtitle: 'Plugins',
        description: '已安装插件管理',
        icon: 'solar:plug-circle-bold-duotone',
        settingsEntry: true,
        order: 2,
        path: '/settings/extensions/plugins',
      },
      {
        title: '工具',
        subtitle: 'Tools',
        description: '工具调用管理与启用/禁用',
        icon: 'solar:widget-5-bold-duotone',
        settingsEntry: true,
        order: 3,
        path: '/settings/extensions/tools',
      },
      {
        title: '市场',
        subtitle: 'Marketplace',
        description: '浏览与安装插件、MCP 预设与技能扩展',
        icon: 'solar:shop-bold-duotone',
        settingsEntry: true,
        order: 4,
        path: '/settings/extensions/marketplace',
      },
    ],
  },
  {
    title: '隐私与权限',
    subtitle: 'Privacy & Permissions',
    description: '语音操作授权、能力分级、使用记录',
    icon: 'solar:shield-check-bold-duotone',
    settingsEntry: true,
    order: 5,
    path: '/settings/privacy',
  },
  {
    title: '记忆体',
    subtitle: 'Memory',
    description: '存放记忆的地方，以及策略',
    icon: 'solar:database-bold-duotone',
    settingsEntry: true,
    order: 6,
    path: '/settings/memory',
    children: [
      {
        title: '上下文管理',
        subtitle: 'Context',
        description: '对话窗口长度、压缩策略与保留轮次',
        icon: 'solar:documents-bold-duotone',
        settingsEntry: true,
        order: 0,
        path: '/settings/memory/context',
      },
      {
        title: '长期记忆',
        subtitle: 'Long-Term Memory',
        description: '记忆开关、混合检索与 LLM 增强抽取',
        icon: 'solar:book-bold-duotone',
        settingsEntry: true,
        order: 1,
        path: '/settings/memory/long-term',
      },
      {
        title: '记忆查看',
        subtitle: 'View',
        description: '查看事实、偏好与约定规则',
        icon: 'solar:eye-bold-duotone',
        settingsEntry: true,
        order: 3,
        path: '/settings/memory/view',
      },
      {
        title: '会话档案',
        subtitle: 'Sessions',
        description: '大脑会话、全文检索、统一查询',
        icon: 'solar:document-text-bold-duotone',
        settingsEntry: true,
        order: 4,
        path: '/settings/memory/sessions',
      },
      {
        title: '数据与备份',
        subtitle: 'Data & Backup',
        description: '备份、还原、数据清空',
        icon: 'solar:archive-bold-duotone',
        settingsEntry: true,
        order: 5,
        path: '/settings/memory/data',
      },
    ],
  },
  {
    title: '系统',
    subtitle: 'System',
    description: '常规、开发者、关于',
    icon: 'solar:filters-bold-duotone',
    settingsEntry: true,
    order: 7,
    path: '/settings/system',
    children: [
      {
        title: '常规',
        subtitle: 'General',
        description: '语言、启动项、窗口',
        icon: 'solar:settings-bold-duotone',
        settingsEntry: true,
        order: 0,
        path: '/settings/system/general',
      },
      {
        title: '开发者',
        subtitle: 'Developer',
        description: '调试模式、日志',
        icon: 'solar:code-bold-duotone',
        settingsEntry: true,
        order: 1,
        path: '/settings/system/developer',
      },
      {
        title: '关于',
        subtitle: 'About',
        description: '版本信息',
        icon: 'solar:info-circle-bold-duotone',
        settingsEntry: true,
        order: 2,
        path: '/settings/system/about',
      },
      {
        title: '自动化',
        subtitle: 'Automation',
        description: '定时任务管理',
        icon: 'solar:clock-circle-bold-duotone',
        settingsEntry: true,
        order: 3,
        path: '/settings/system/automation',
      },
      {
        title: '快捷键',
        subtitle: 'Shortcuts',
        description: '自定义全局快捷键',
        icon: 'solar:keyboard-bold-duotone',
        settingsEntry: true,
        order: 4,
        path: '/settings/system/shortcuts',
      },
      {
        title: '文件管理',
        subtitle: 'File Manager',
        description: '数据目录、临时文件、导入导出',
        icon: 'solar:folder-bold-duotone',
        settingsEntry: true,
        order: 5,
        path: '/settings/system/files',
      },
      {
        title: '存储管理',
        subtitle: 'Storage',
        description: '各类数据占用可视化与管理',
        icon: 'solar:box-bold-duotone',
        settingsEntry: true,
        order: 6,
        path: '/settings/system/storage',
      },
    ],
  },
];

/** 取路径最后一段作为相对路径段（如 '/settings/appearance/general' -> 'general'） */
function getLastSegment(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

// 懒加载包装组件：在首次渲染该路由时才请求页面模块
// eslint-disable-next-line react-refresh/only-export-components
function LazyPage({ loader }: { loader: () => Promise<{ default: ComponentType }> }) {
  const [Component, setComponent] = React.useState<ComponentType | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    loader()
      .then((mod) => {
        if (!cancelled) setComponent(() => mod.default);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [loader]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8 text-center text-sm text-neutral-500">
        <div>
          <p className="mb-2 text-base font-medium text-neutral-700">页面加载失败</p>
          <pre className="whitespace-pre-wrap text-xs">{error}</pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs text-white hover:bg-indigo-600"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
  if (!Component) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
        加载中…
      </div>
    );
  }
  return <Component />;
}

// eslint-disable-next-line react-refresh/only-export-components
function MissingPage() {
  return (
    <div className="flex h-full w-full items-center justify-center p-8 text-center text-sm text-neutral-500">
      <div>
        <p className="mb-2 text-base font-medium text-neutral-700">页面未找到</p>
        <p>该设置页暂未实现或路由配置有误。</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs text-white hover:bg-indigo-600"
        >
          返回设置首页
        </button>
      </div>
    </div>
  );
}

/**
 * 由 settingsTree 递归构建子路由
 * - 含 children 的条目：作为 path 路由，index 渲染对应 IndexPage，子路由递归构建
 * - 叶子条目：通过动态 import 懒加载页面组件，减小首屏 bundle
 * - 若条目带有 layout，则父路由 element 使用该 layout 包裹子路由
 */
function buildChildRoutes(entries: SettingsEntry[]): RouteObject[] {
  return entries.map((entry) => {
    const segment = getLastSegment(entry.path);
    const loader = pageComponentLoaders[entry.path];
    if (entry.children && entry.children.length > 0) {
      const childRoutes = [
        {
          index: true,
          element: loader ? <LazyPage loader={loader} /> : <MissingPage />,
          handle: { meta: entry },
        },
        ...buildChildRoutes(entry.children),
      ];

      if (entry.layout) {
        return {
          path: segment,
          handle: { meta: entry },
          element: <entry.layout />,
          children: childRoutes,
        };
      }

      return {
        path: segment,
        handle: { meta: entry },
        children: childRoutes,
      };
    }
    return {
      path: segment,
      element: loader ? <LazyPage loader={loader} /> : <MissingPage />,
      handle: { meta: entry },
    };
  });
}

export const routes = createHashRouter([
  // 根路径重定向到 /settings
  {
    path: '/',
    element: <Navigate to="/settings" replace />,
  },
  {
    path: '/settings',
    element: <SettingsLayout />,
    errorElement: <RouteError />,
    handle: { meta: settingsRootMeta },
    children: [
      // 设置首页：列出所有顶级入口
      {
        index: true,
        element: <LazyPage loader={() => import('./pages/IndexPage')} />,
        handle: { meta: settingsRootMeta },
      },
      // 递归生成的二级与叶子路由
      ...buildChildRoutes(settingsTree),
    ],
  },
]);
