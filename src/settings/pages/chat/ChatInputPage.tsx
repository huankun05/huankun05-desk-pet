import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow } from '../../components';
import {
  BUILTIN_COMMANDS,
  CustomSlashCommand,
  CustomCommandType,
  loadCustomCommands,
  saveCustomCommands,
  SLASH_ACTION_META,
} from '../../../hooks/useSlashCommands';
import type { SlashCommand } from '../../../hooks/useSlashCommands';

interface DisplayCmd {
  name: string;
  description: string;
  category: string;
  argsHint?: string;
  icon?: string;
  actionId?: string;
  isCustom: boolean;
  custom?: CustomSlashCommand;
}

type EditorState =
  | { mode: 'new' }
  | { mode: 'duplicate'; builtin: SlashCommand }
  | { mode: 'edit'; cmd: CustomSlashCommand }
  | null;

const VALID_NAME = /^[a-z0-9_]+$/;

function buildDisplay(builtin: SlashCommand[], custom: CustomSlashCommand[]): DisplayCmd[] {
  const list: DisplayCmd[] = builtin.map((c) => ({
    name: c.name,
    description: c.description,
    category: c.category,
    argsHint: c.argsHint,
    icon: c.icon,
    actionId: c.actionId,
    isCustom: false,
  }));
  for (const c of custom) {
    list.push({
      name: c.name,
      description: c.description,
      category: c.category,
      argsHint: c.argsHint,
      icon: c.icon,
      actionId: c.actionId,
      isCustom: true,
      custom: c,
    });
  }
  return list;
}

function groupByCategory(cmds: DisplayCmd[]): Map<string, DisplayCmd[]> {
  const map = new Map<string, DisplayCmd[]>();
  for (const cmd of cmds) {
    const list = map.get(cmd.category);
    if (list) list.push(cmd);
    else map.set(cmd.category, [cmd]);
  }
  return map;
}

// ───────────────────────────────────────────────────────────
// 命令编辑器弹窗
// ───────────────────────────────────────────────────────────

function CommandEditorModal({
  state,
  existingNames,
  onSave,
  onClose,
}: {
  state: Exclude<EditorState, null>;
  existingNames: string[];
  onSave: (cmd: CustomSlashCommand) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const initialName =
    state.mode === 'new' ? '' : state.mode === 'duplicate' ? state.builtin.name : state.cmd.name;
  const initialDesc =
    state.mode === 'new'
      ? ''
      : state.mode === 'duplicate'
        ? state.builtin.description
        : state.cmd.description;
  const initialCategory =
    state.mode === 'new'
      ? '自定义'
      : state.mode === 'duplicate'
        ? state.builtin.category
        : state.cmd.category;
  const initialIcon =
    state.mode === 'new'
      ? '⚡'
      : state.mode === 'duplicate'
        ? (state.builtin.icon ?? '⚡')
        : (state.cmd.icon ?? '⚡');
  const initialType: CustomCommandType = state.mode === 'edit' ? state.cmd.type : 'macro';
  const initialMacro =
    state.mode === 'edit' && state.cmd.type === 'macro' ? (state.cmd.macroText ?? '') : '';
  const initialAction =
    state.mode === 'edit' && state.cmd.type === 'action' ? (state.cmd.actionId ?? '') : '';

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDesc);
  const [category, setCategory] = useState(initialCategory);
  const [icon, setIcon] = useState(initialIcon);
  const [type, setType] = useState<CustomCommandType>(initialType);
  const [macroText, setMacroText] = useState(initialMacro);
  const [actionId, setActionId] = useState(initialAction);

  const selfId = state.mode === 'edit' ? state.cmd.id : null;
  const nameError = (() => {
    if (!name) return t('settings.chat.cmd_name_required', { defaultValue: '命令名不能为空' });
    if (!VALID_NAME.test(name))
      return t('settings.chat.cmd_name_invalid', {
        defaultValue: '仅限小写字母、数字和下划线',
      });
    if (existingNames.some((n) => n === name && n !== selfId))
      return t('settings.chat.cmd_name_exists', { defaultValue: '命令名已存在' });
    return null;
  })();

  const handleSave = () => {
    if (nameError) return;
    const now = Date.now();
    const cmd: CustomSlashCommand = {
      id: selfId ?? `cmd_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      description,
      category: category.trim() || t('settings.chat.cmd_cat_custom', { defaultValue: '自定义' }),
      icon,
      type,
      macroText: type === 'macro' ? macroText : undefined,
      actionId: type === 'action' ? actionId || undefined : undefined,
      source: state.mode === 'duplicate' ? state.builtin.name : undefined,
      createdAt: selfId ? (state.mode === 'edit' ? state.cmd.createdAt : now) : now,
    };
    onSave(cmd);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-neutral-100 bg-white px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-800">
            {state.mode === 'edit'
              ? t('settings.chat.cmd_edit_title', { defaultValue: '编辑命令' })
              : t('settings.chat.cmd_new_title', { defaultValue: '新建命令' })}
          </h3>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          {/* 名称 */}
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              {t('settings.chat.cmd_field_name', { defaultValue: '命令名' })}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-neutral-400">/</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value.trim().toLowerCase())}
                placeholder="mycmd"
                className="flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-[var(--primary-400)]"
              />
            </div>
            {nameError && <p className="mt-1 text-xs text-red-500">{nameError}</p>}
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              {t('settings.chat.cmd_field_desc', { defaultValue: '描述' })}
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('settings.chat.cmd_desc_placeholder', {
                defaultValue: '这条命令的作用',
              })}
              className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-[var(--primary-400)]"
            />
          </div>

          {/* 分类 + 图标 */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('settings.chat.cmd_field_category', { defaultValue: '分类' })}
              </label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-[var(--primary-400)]"
              />
            </div>
            <div className="w-16">
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('settings.chat.cmd_field_icon', { defaultValue: '图标' })}
              </label>
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm text-center outline-none focus:border-[var(--primary-400)]"
              />
            </div>
          </div>

          {/* 类型 */}
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              {t('settings.chat.cmd_field_type', { defaultValue: '类型' })}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setType('macro')}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  type === 'macro'
                    ? 'border-[var(--primary-400)] bg-[var(--primary-50)] text-[var(--primary-700)]'
                    : 'border-neutral-200 text-neutral-600'
                }`}
              >
                {t('settings.chat.cmd_type_macro', { defaultValue: '快捷宏' })}
              </button>
              <button
                type="button"
                onClick={() => setType('action')}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  type === 'action'
                    ? 'border-[var(--primary-400)] bg-[var(--primary-50)] text-[var(--primary-700)]'
                    : 'border-neutral-200 text-neutral-600'
                }`}
              >
                {t('settings.chat.cmd_type_action', { defaultValue: '绑定动作' })}
              </button>
            </div>
          </div>

          {/* 宏文本 */}
          {type === 'macro' ? (
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('settings.chat.cmd_field_macro', { defaultValue: '宏文本（触发时填入输入框）' })}
              </label>
              <textarea
                value={macroText}
                onChange={(e) => setMacroText(e.target.value)}
                rows={3}
                placeholder={t('settings.chat.cmd_macro_placeholder', {
                  defaultValue: '例如：请用通俗的语言解释以下内容',
                })}
                className="w-full resize-none rounded-lg border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-[var(--primary-400)]"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {t('settings.chat.cmd_field_action', { defaultValue: '绑定动作' })}
              </label>
              <select
                value={actionId}
                onChange={(e) => setActionId(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-[var(--primary-400)]"
              >
                <option value="">—</option>
                {Object.entries(SLASH_ACTION_META).map(([id, meta]) => (
                  <option key={id} value={id}>
                    {meta.label}
                    {meta.needsArgs ? ' (需参数)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-neutral-100 bg-white px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            {t('settings.chat.cmd_cancel', { defaultValue: '取消' })}
          </button>
          <button
            onClick={handleSave}
            disabled={!!nameError}
            className="rounded-lg bg-[var(--primary-500)] px-4 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {t('settings.chat.cmd_save', { defaultValue: '保存' })}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// 主页面
// ───────────────────────────────────────────────────────────

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

  const [customCommands, setCustomCommands] = useState<CustomSlashCommand[]>(() =>
    loadCustomCommands(),
  );
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<EditorState>(null);

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

  const persist = (next: CustomSlashCommand[]) => {
    setCustomCommands(next);
    saveCustomCommands(next);
  };

  const handleSave = (cmd: CustomSlashCommand) => {
    const exists = customCommands.some((c) => c.id === cmd.id);
    const next = exists
      ? customCommands.map((c) => (c.id === cmd.id ? cmd : c))
      : [...customCommands, cmd];
    persist(next);
    setEditor(null);
  };

  const handleDelete = (cmd: CustomSlashCommand) => {
    if (
      !window.confirm(
        t('settings.chat.cmd_delete_confirm', {
          name: cmd.name,
          defaultValue: `确定删除命令「/${cmd.name}」吗？`,
        }),
      )
    ) {
      return;
    }
    persist(customCommands.filter((c) => c.id !== cmd.id));
  };

  // 合并 + 过滤 + 分组
  const display = useMemo(() => buildDisplay(BUILTIN_COMMANDS, customCommands), [customCommands]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return display;
    return display.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        (cmd.argsHint ?? '').toLowerCase().includes(q),
    );
  }, [display, search]);

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);

  const toggleCategory = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const totalCount = display.length;
  const searchActive = search.trim().length > 0;

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
          defaultValue: `共 ${totalCount} 条命令，在聊天框输入 / 即可触发`,
        })}
      >
        {/* 搜索 + 新建 */}
        <div className="flex items-center gap-2 border-b border-neutral-100 p-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg bg-neutral-100 px-3 py-1.5">
            <span className="text-neutral-400">🔍</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('settings.chat.command_search', { defaultValue: '搜索命令或作用…' })}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-neutral-400 hover:text-neutral-600"
              >
                ×
              </button>
            )}
          </div>
          <button
            onClick={() => setEditor({ mode: 'new' })}
            className="shrink-0 rounded-lg bg-[var(--primary-500)] px-3 py-1.5 text-sm text-white hover:bg-[var(--primary-600)]"
          >
            + {t('settings.chat.command_new', { defaultValue: '新建' })}
          </button>
        </div>

        {/* 分组折叠列表 */}
        {grouped.size === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-neutral-400">
            {t('settings.chat.command_empty', { defaultValue: '没有匹配的命令' })}
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {Array.from(grouped.entries()).map(([category, cmds]) => {
              const isOpen = searchActive || expanded.has(category);
              return (
                <div key={category}>
                  <button
                    type="button"
                    onClick={() => !searchActive && toggleCategory(category)}
                    className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-neutral-50"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                      {category}
                      <span className="ml-1.5 font-normal normal-case text-neutral-300">
                        ({cmds.length})
                      </span>
                    </span>
                    <span className="text-neutral-300">{isOpen ? '▾' : '▸'}</span>
                  </button>

                  {isOpen && (
                    <div>
                      {cmds.map((cmd) => (
                        <div
                          key={cmd.name}
                          className="flex items-start gap-3 border-t border-neutral-50 px-4 py-3"
                        >
                          <span className="text-lg leading-none mt-0.5 shrink-0">
                            {cmd.icon ?? '🔹'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="text-sm font-mono font-semibold text-[var(--primary-600)] bg-[var(--primary-50)] px-1.5 py-0.5 rounded">
                                /{cmd.name}
                              </code>
                              {cmd.argsHint && (
                                <span className="text-xs font-mono text-neutral-400">
                                  {cmd.argsHint}
                                </span>
                              )}
                              {cmd.isCustom && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                  {cmd.custom?.type === 'macro'
                                    ? t('settings.chat.cmd_type_macro', { defaultValue: '宏' })
                                    : t('settings.chat.cmd_type_action', { defaultValue: '动作' })}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-neutral-500 mt-1">{cmd.description}</p>
                          </div>

                          {/* 操作按钮 */}
                          <div className="flex shrink-0 items-center gap-1">
                            {cmd.isCustom ? (
                              <>
                                <button
                                  onClick={() => setEditor({ mode: 'edit', cmd: cmd.custom! })}
                                  title={t('settings.chat.command_edit', { defaultValue: '编辑' })}
                                  className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                                >
                                  ✎
                                </button>
                                <button
                                  onClick={() => handleDelete(cmd.custom!)}
                                  title={t('settings.chat.command_delete', {
                                    defaultValue: '删除',
                                  })}
                                  className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                                >
                                  🗑
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setEditor({ mode: 'duplicate', builtin: cmd })}
                                title={t('settings.chat.command_duplicate', {
                                  defaultValue: '复制为自定义',
                                })}
                                className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                              >
                                ⧉
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {editor && (
        <CommandEditorModal
          state={editor}
          existingNames={customCommands.map((c) => c.name)}
          onSave={handleSave}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

export default ChatInputPage;
