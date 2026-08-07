import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow } from '../../components';
import { BUILTIN_COMMANDS } from '../../../hooks/useSlashCommands';
import type { SlashCommand } from '../../../hooks/useSlashCommands';

/** 按分类分组并保持声明顺序 */
function groupByCategory(commands: SlashCommand[]) {
  const map = new Map<string, SlashCommand[]>();
  for (const cmd of commands) {
    const list = map.get(cmd.category);
    if (list) list.push(cmd);
    else map.set(cmd.category, [cmd]);
  }
  return map;
}

/** 单条命令卡片 */
function CommandCard({ command }: { command: SlashCommand }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-neutral-100 last:border-b-0">
      {/* 图标 */}
      <span className="text-lg leading-none mt-0.5 shrink-0">{command.icon ?? '🔹'}</span>

      {/* 命令信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 命令名 + 参数提示 */}
          <code className="text-sm font-mono font-semibold text-[var(--primary-600)] bg-[var(--primary-50)] px-1.5 py-0.5 rounded">
            /{command.name}
          </code>
          {command.argsHint && (
            <span className="text-xs font-mono text-neutral-400">{command.argsHint}</span>
          )}
        </div>
        <p className="text-xs text-neutral-500 mt-1">{command.description}</p>
      </div>
    </div>
  );
}

export function ChatInputPage() {
  const { t } = useTranslation();
  const [slashEnabled, setSlashEnabled] = useState(() => {
    try {
      return localStorage.getItem('deskpet_slash_enabled') !== 'false';
    } catch {
      return true;
    }
  });
  const [sendOnEnter, setSendOnEnter] = useState(() => {
    try {
      return localStorage.getItem('deskpet_send_on_enter') !== 'false';
    } catch {
      return true;
    }
  });

  const updateSlash = (value: boolean) => {
    setSlashEnabled(value);
    try {
      localStorage.setItem('deskpet_slash_enabled', value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  };

  const updateSendOnEnter = (value: boolean) => {
    setSendOnEnter(value);
    try {
      localStorage.setItem('deskpet_send_on_enter', value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  };

  // 按分类分组
  const grouped = useMemo(() => groupByCategory(BUILTIN_COMMANDS), []);

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 开关区域 */}
      <Section
        title={t('settings.chat.input_title', { defaultValue: '输入与命令' })}
        description={t('settings.chat.input_desc', {
          defaultValue: '发送快捷键、Slash 自动补全、附件行为',
        })}
      >
        <div className="space-y-3 p-4">
          <SettingRow
            title={t('settings.chat.send_on_enter', { defaultValue: '回车发送' })}
            description={t('settings.chat.send_on_enter_desc', {
              defaultValue: '输入消息后按 Enter 直接发送，Shift+Enter 换行',
            })}
          >
            <button
              type="button"
              onClick={() => updateSendOnEnter(!sendOnEnter)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                sendOnEnter ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  sendOnEnter ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </SettingRow>

          <SettingRow
            title={t('settings.chat.slash_autocomplete', { defaultValue: 'Slash 自动补全' })}
            description={t('settings.chat.slash_autocomplete_desc', {
              defaultValue: '输入 / 时显示命令自动补全列表',
            })}
          >
            <button
              type="button"
              onClick={() => updateSlash(!slashEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                slashEnabled ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  slashEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </SettingRow>
        </div>
      </Section>

      {/* 可用命令列表 */}
      <Section
        title={t('settings.chat.command_list_title', { defaultValue: '可用命令' })}
        description={t('settings.chat.command_list_desc', {
          defaultValue: `共 ${BUILTIN_COMMANDS.length} 条内置命令，在聊天框输入 / 即可触发`,
        })}
      >
        <div className="divide-y divide-neutral-100">
          {Array.from(grouped.entries()).map(([category, commands]) => (
            <div key={category}>
              {/* 分类标题 */}
              <div className="px-4 pt-3 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  {category}
                </span>
              </div>
              {/* 该分类下的命令 */}
              {commands.map((cmd) => (
                <CommandCard key={cmd.name} command={cmd} />
              ))}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

export default ChatInputPage;
