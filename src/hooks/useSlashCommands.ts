import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

export interface SlashCommand {
  name: string;
  description: string;
  category: string;
  argsHint?: string;
  aliases?: string[];
  icon?: string;
  /** 绑定的内置动作 id（用于执行路由） */
  actionId?: string;
}

export interface SlashCompletion {
  command: SlashCommand;
  matchedText: string;
}

/**
 * 动作注册表 —— 把每条内置命令背后的"行为"抽成可复用单元。
 * 用户自定义命令时可直接从这张表里挑一个 action 绑定，无需写代码。
 * 扩充内置命令 = 往这里加一条 + 在 BUILTIN_COMMANDS 加一行。
 */
export const SLASH_ACTION_META: Record<
  string,
  { label: string; needsArgs?: boolean; category: string }
> = {
  new: { label: '新建会话', category: '会话' },
  clear: { label: '清屏并新建', category: '会话' },
  retry: { label: '重发最后一条消息', category: '会话' },
  undo: { label: '回退 N 条消息', needsArgs: true, category: '会话' },
  stop: { label: '停止当前生成', category: '会话' },
  model: { label: '查看或切换模型', needsArgs: true, category: '模型' },
  usage: { label: '查看用量', category: '模型' },
  status: { label: '查看连接状态', category: '系统' },
  voice: { label: '切换语音输入/TTS', needsArgs: true, category: '设置' },
  help: { label: '显示帮助', category: '系统' },
  export: { label: '导出当前会话', category: '会话' },
  rename: { label: '重命名当前会话', needsArgs: true, category: '会话' },
  theme: { label: '切换聊天主题', needsArgs: true, category: '设置' },
  clearctx: { label: '清空当前会话上下文', category: '会话' },
};

/** 设置页增删改自定义命令后广播的事件名（供已开的聊天窗实时重载） */
export const SLASH_COMMANDS_CHANGED = 'slash-commands-changed';

/** 内置命令 → 动作 id 映射（含别名） */
const BUILTIN_COMMAND_ACTIONS: Record<string, string> = {
  new: 'new',
  reset: 'new',
  clear: 'clear',
  retry: 'retry',
  undo: 'undo',
  stop: 'stop',
  model: 'model',
  usage: 'usage',
  status: 'status',
  voice: 'voice',
  help: 'help',
  export: 'export',
  rename: 'rename',
  theme: 'theme',
  clearctx: 'clearctx',
};

export const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: 'new',
    description: '新建会话',
    category: '会话',
    argsHint: '[标题]',
    icon: '📄',
    actionId: 'new',
  },
  { name: 'clear', description: '清屏并新建会话', category: '会话', icon: '🧹', actionId: 'clear' },
  {
    name: 'retry',
    description: '重发最后一条消息',
    category: '会话',
    icon: '🔄',
    actionId: 'retry',
  },
  {
    name: 'undo',
    description: '回退 N 条用户消息',
    category: '会话',
    argsHint: '[N]',
    icon: '↩️',
    actionId: 'undo',
  },
  { name: 'stop', description: '停止当前生成', category: '会话', icon: '⏹️', actionId: 'stop' },
  {
    name: 'export',
    description: '导出当前会话为 Markdown',
    category: '会话',
    icon: '📤',
    actionId: 'export',
  },
  {
    name: 'model',
    description: '查看或切换模型',
    category: '模型',
    argsHint: '[模型名]',
    icon: '🧠',
    actionId: 'model',
  },
  { name: 'usage', description: '查看余额/用量', category: '模型', icon: '📊', actionId: 'usage' },
  {
    name: 'status',
    description: '查看 Gateway 连接状态',
    category: '系统',
    icon: '📡',
    actionId: 'status',
  },
  {
    name: 'voice',
    description: '切换语音输入/TTS',
    category: '设置',
    argsHint: '[on|off]',
    icon: '🎙️',
    actionId: 'voice',
  },
  { name: 'help', description: '显示帮助', category: '系统', icon: '❓', actionId: 'help' },
  {
    name: 'rename',
    description: '重命名当前会话',
    category: '会话',
    argsHint: '[新标题]',
    icon: '✏️',
    actionId: 'rename',
  },
  {
    name: 'theme',
    description: '切换聊天主题（浅色/深色）',
    category: '设置',
    argsHint: '[light|dark]',
    icon: '🎨',
    actionId: 'theme',
  },
  {
    name: 'clearctx',
    description: '清空当前会话的上下文历史',
    category: '会话',
    icon: '🧼',
    actionId: 'clearctx',
  },
];

// ───────────────────────────────────────────────────────────
// 自定义命令数据层（localStorage 持久化）
// ───────────────────────────────────────────────────────────

export const CUSTOM_COMMANDS_KEY = 'deskpet_custom_commands_v1';

export type CustomCommandType = 'macro' | 'action';

export interface CustomSlashCommand {
  id: string;
  name: string;
  description: string;
  category: string;
  argsHint?: string;
  icon?: string;
  type: CustomCommandType;
  /** type === 'macro'：触发时填入/发送的预设文本 */
  macroText?: string;
  /** type === 'action'：绑定的内置动作 id（见 SLASH_ACTION_META） */
  actionId?: string;
  /** 由某个内置命令"复制为自定义"而来时记录源名，便于 UI 标记 */
  source?: string;
  createdAt: number;
}

export function loadCustomCommands(): CustomSlashCommand[] {
  try {
    const raw = localStorage.getItem(CUSTOM_COMMANDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomSlashCommand[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomCommands(cmds: CustomSlashCommand[]): void {
  try {
    localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(cmds));
  } catch {
    /* ignore quota / private mode */
  }
}

/** 合并内置 + 自定义，供 UI 列表与自动补全使用 */
export function getAllCommands(custom: CustomSlashCommand[]): SlashCommand[] {
  const customAsSlash: SlashCommand[] = custom.map((c) => ({
    name: c.name,
    description: c.description,
    category: c.category,
    argsHint: c.argsHint,
    icon: c.icon,
    actionId: c.actionId,
  }));
  return [...BUILTIN_COMMANDS, ...customAsSlash];
}

export interface UseSlashCommandsOptions {
  onNewChat?: (title?: string) => void;
  onRetry?: () => void;
  onUndo?: (n?: number) => void;
  onStop?: () => void;
  onModelChange?: (model?: string) => void;
  onStatus?: () => void;
  onUsage?: () => void;
  onVoiceToggle?: (enable?: boolean) => void;
  onHelp?: () => void;
  onExport?: () => void;
  onRename?: (title: string) => void;
  onTheme?: (theme?: 'light' | 'dark') => void;
  onClearCtx?: () => void;
  gatewayReady?: boolean;
}

export function useSlashCommands(options: UseSlashCommandsOptions = {}) {
  const [input, setInput] = useState('');
  const [completions, setCompletions] = useState<SlashCompletion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [slashActive, setSlashActive] = useState(false);
  const [customCommands, setCustomCommands] = useState<CustomSlashCommand[]>(() =>
    loadCustomCommands(),
  );
  const abortRef = useRef(false);

  // 设置页修改后可在 focus 时调用以重新加载
  const reloadCustomCommands = useCallback(() => {
    setCustomCommands(loadCustomCommands());
  }, []);

  const reset = useCallback(() => {
    setInput('');
    setCompletions([]);
    setSelectedIndex(0);
    setSlashActive(false);
    abortRef.current = false;
  }, []);

  const allCommands = useMemo(() => getAllCommands(customCommands), [customCommands]);

  const complete = useCallback(
    (query: string): SlashCompletion[] => {
      const q = query.trim().toLowerCase();
      if (!q) {
        return allCommands.map((cmd) => ({ command: cmd, matchedText: cmd.name }));
      }
      return allCommands
        .filter((cmd) => {
          const hay = [cmd.name, ...(cmd.aliases ?? [])].join(' ').toLowerCase();
          return hay.includes(q) || cmd.description.toLowerCase().includes(q);
        })
        .map((cmd) => {
          const matched =
            [cmd.name, ...(cmd.aliases ?? [])].find((a) => a.toLowerCase().startsWith(q)) ??
            cmd.name;
          return { command: cmd, matchedText: matched };
        });
    },
    [allCommands],
  );

  const updateCompletions = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      const isSlash = trimmed.startsWith('/');
      setSlashActive(isSlash);
      if (!isSlash) {
        setCompletions([]);
        setSelectedIndex(0);
        return;
      }
      const query = trimmed.slice(1);
      const items = complete(query);
      setCompletions(items);
      setSelectedIndex((idx) => Math.min(idx, Math.max(0, items.length - 1)));
    },
    [complete],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      updateCompletions(value);
    },
    [updateCompletions],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!slashActive || completions.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((idx) => (idx + 1) % completions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((idx) => (idx - 1 + completions.length) % completions.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (completions.length > 0) {
          e.preventDefault();
          const selected = completions[selectedIndex].command.name;
          const current = input.trim();
          if (current.includes(' ')) {
            // Already has args, treat as submit
            return;
          }
          const next = '/' + selected + ' ';
          setInput(next);
          updateCompletions(next);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        reset();
      }
    },
    [slashActive, completions, selectedIndex, input, reset, updateCompletions],
  );

  const executeSelected = useCallback(() => {
    if (!slashActive || completions.length === 0) return null;
    const selected = completions[selectedIndex].command.name;
    const current = input.trim();
    if (current.includes(' ')) {
      return null;
    }
    const next = '/' + selected + ' ';
    setInput(next);
    updateCompletions(next);
    return null;
  }, [slashActive, completions, selectedIndex, input, updateCompletions]);

  /**
   * 路由到具体动作。返回是否处理。
   */
  const routeAction = useCallback(
    (actionId: string, argString: string): boolean => {
      switch (actionId) {
        case 'new':
        case 'clear':
          options.onNewChat?.(argString || undefined);
          break;
        case 'retry':
          options.onRetry?.();
          break;
        case 'undo':
          options.onUndo?.(argString ? Number(argString) : undefined);
          break;
        case 'stop':
          options.onStop?.();
          break;
        case 'model':
          options.onModelChange?.(argString || undefined);
          break;
        case 'status':
          options.onStatus?.();
          break;
        case 'usage':
          options.onUsage?.();
          break;
        case 'voice':
          options.onVoiceToggle?.(
            argString === 'on' ? true : argString === 'off' ? false : undefined,
          );
          break;
        case 'help':
          options.onHelp?.();
          break;
        case 'export':
          options.onExport?.();
          break;
        case 'rename':
          if (argString) options.onRename?.(argString);
          break;
        case 'theme':
          options.onTheme?.(
            argString === 'light' ? 'light' : argString === 'dark' ? 'dark' : undefined,
          );
          break;
        case 'clearctx':
          options.onClearCtx?.();
          break;
        default:
          return false;
      }
      return true;
    },
    [options],
  );

  const executeCommand = useCallback(
    (raw: string): { handled: boolean; macro?: string } => {
      const trimmed = raw.trim();
      if (!trimmed.startsWith('/')) return { handled: false };

      const withoutSlash = trimmed.slice(1);
      const [name, ...args] = withoutSlash.split(/[ \t]+/);
      const argString = args.join(' ');

      // 1. 自定义命令优先（用户自定义可覆盖同名内置）
      const custom = customCommands.find((c) => c.name === name);
      if (custom) {
        if (custom.type === 'macro') {
          // 宏命令：把预设文本 + 参数填入输入框，让用户确认后再发
          const base = (custom.macroText ?? '').trim();
          const filled = base + (argString ? ' ' + argString : '');
          return { handled: true, macro: filled };
        }
        // action 型：路由到注册表动作
        if (!custom.actionId) return { handled: true };
        const ok = routeAction(custom.actionId, argString);
        return { handled: ok };
      }

      // 2. 内置命令（含别名）
      const actionId = BUILTIN_COMMAND_ACTIONS[name];
      if (!actionId) return { handled: false };
      const ok = routeAction(actionId, argString);
      return { handled: ok };
    },
    [customCommands, routeAction],
  );

  const handleSubmit = useCallback(
    (value: string): { handled: boolean; macro?: string } => {
      const trimmed = value.trim();
      if (!trimmed) return { handled: false };
      if (trimmed.startsWith('/')) {
        const result = executeCommand(trimmed);
        if (result.handled) {
          if (result.macro === undefined) reset();
          return result;
        }
      }
      return { handled: false };
    },
    [executeCommand, reset],
  );

  useEffect(() => {
    if (!showHelp) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowHelp(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showHelp]);

  return {
    input,
    setInput: handleInputChange,
    completions,
    selectedIndex,
    setSelectedIndex,
    slashActive,
    showHelp,
    setShowHelp,
    handleKeyDown,
    handleSubmit,
    reset,
    executeSelected,
    executeCommand,
    customCommands,
    reloadCustomCommands,
  };
}
