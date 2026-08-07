import { useState, useCallback, useEffect, useRef } from 'react';

export interface SlashCommand {
  name: string;
  description: string;
  category: string;
  argsHint?: string;
  aliases?: string[];
  icon?: string;
}

export interface SlashCompletion {
  command: SlashCommand;
  matchedText: string;
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'new', description: '新建会话', category: '会话', argsHint: '[标题]', icon: '📄' },
  { name: 'clear', description: '清屏并新建会话', category: '会话', icon: '🧹' },
  { name: 'retry', description: '重发最后一条消息', category: '会话', icon: '🔄' },
  { name: 'undo', description: '回退 N 条用户消息', category: '会话', argsHint: '[N]', icon: '↩️' },
  { name: 'stop', description: '停止当前生成', category: '会话', icon: '⏹️' },
  {
    name: 'model',
    description: '查看或切换模型',
    category: '模型',
    argsHint: '[模型名]',
    icon: '🧠',
  },
  { name: 'usage', description: '查看余额/用量', category: '模型', icon: '📊' },
  { name: 'status', description: '查看 Gateway 连接状态', category: '系统', icon: '📡' },
  {
    name: 'voice',
    description: '切换语音输入/TTS',
    category: '设置',
    argsHint: '[on|off]',
    icon: '🎙️',
  },
  { name: 'help', description: '显示帮助', category: '系统', icon: '❓' },
];

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
  gatewayReady?: boolean;
}

export function useSlashCommands(options: UseSlashCommandsOptions = {}) {
  const [input, setInput] = useState('');
  const [completions, setCompletions] = useState<SlashCompletion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [slashActive, setSlashActive] = useState(false);
  const abortRef = useRef(false);

  const reset = useCallback(() => {
    setInput('');
    setCompletions([]);
    setSelectedIndex(0);
    setSlashActive(false);
    abortRef.current = false;
  }, []);

  const complete = useCallback((query: string): SlashCompletion[] => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return BUILTIN_COMMANDS.map((cmd) => ({ command: cmd, matchedText: cmd.name }));
    }
    return BUILTIN_COMMANDS.filter((cmd) => {
      const hay = [cmd.name, ...(cmd.aliases ?? [])].join(' ').toLowerCase();
      return hay.includes(q) || cmd.description.toLowerCase().includes(q);
    }).map((cmd) => {
      const matched =
        [cmd.name, ...(cmd.aliases ?? [])].find((a) => a.toLowerCase().startsWith(q)) ?? cmd.name;
      return { command: cmd, matchedText: matched };
    });
  }, []);

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

  const executeCommand = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed.startsWith('/')) return { handled: false as const };

      const withoutSlash = trimmed.slice(1);
      const [name, ...args] = withoutSlash.split(/[ \t]+/);
      const argString = args.join(' ');

      switch (name) {
        case 'new':
        case 'reset':
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
        default:
          return { handled: false as const };
      }
      return { handled: true as const };
    },
    [options],
  );

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith('/')) {
        const result = executeCommand(trimmed);
        if (result.handled) {
          reset();
          return true;
        }
      }
      return false;
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
  };
}
