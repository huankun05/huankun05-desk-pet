import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { useMemory } from '../../../hooks/useMemory';
import { Section, SliderRow, useToast, useConfirm } from '../../components';
import {
  fetchMemories,
  addMemory,
  deleteMemory,
  type MemoryItem,
} from '../../../services/gatewayApi';
import { getRAGEngine } from '../../../services/rag/engine';

type Tab = 'conversations' | 'facts' | 'preferences' | 'growth' | 'rag';

const CATEGORY_LABEL: Record<string, string> = {
  preference: '偏好',
  fact: '事实',
  feedback: '反馈',
  rule: '约定',
};

/**
 * 记忆体 → 记忆查看
 * 四个 Tab：对话历史 / 事实记忆 / 用户偏好 / 成长记忆
 * 注：对话持久档案由「会话档案」（大脑 state.db）管理，本页为本地运行数据。
 */
export function MemoryViewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { memory, clearMemory } = useMemory();

  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab');
    if (t === 'conversations' || t === 'facts' || t === 'preferences' || t === 'growth' || t === 'rag') return t;
    return 'conversations';
  });

  // --- RAG 文档状态（解决 LongTermPage 18条→MemoryViewPage 0条的数据源断裂） ---
  const [ragDocs, setRagDocs] = useState<{ id: string; content: string; importance: number; createdAt: Date }[]>([]);
  const [ragLoading, setRagLoading] = useState(true);

  useEffect(() => {
    try {
      const engine = getRAGEngine();
      const docs = engine.getAllDocuments().map((d) => ({
        id: d.id,
        content: d.content.length > 120 ? d.content.slice(0, 120) + '…' : d.content,
        importance: d.importance,
        createdAt: d.createdAt,
      }));
      // 按重要性降序
      docs.sort((a, b) => b.importance - a.importance);
      setRagDocs(docs);
    } catch {
      /* RAG 引擎可能未初始化 */
      setRagDocs([]);
    } finally {
      setRagLoading(false);
    }
  }, []);

  // --- 成长记忆状态 ---
  const [growthItems, setGrowthItems] = useState<MemoryItem[]>([]);
  const [growthLoading, setGrowthLoading] = useState(true);
  const [newGrowthText, setNewGrowthText] = useState('');
  const [newGrowthCat, setNewGrowthCat] = useState('fact');

  const loadGrowthMemories = useCallback(() => {
    setGrowthLoading(true);
    fetchMemories()
      .then((r) => setGrowthItems(r.items))
      .catch(() => setGrowthItems([]))
      .finally(() => setGrowthLoading(false));
  }, []);

  useEffect(() => {
    loadGrowthMemories();
  }, [loadGrowthMemories]);

  const handleAddGrowth = async () => {
    const text = newGrowthText.trim();
    if (!text) return;
    try {
      await addMemory(text, newGrowthCat);
      setNewGrowthText('');
      showToast(t('settings.memory.growth.added', { defaultValue: '已添加记忆' }), 'success');
      loadGrowthMemories();
    } catch {
      showToast(t('settings.memory.growth.add_fail', { defaultValue: '添加失败' }), 'error');
    }
  };

  const handleDeleteGrowth = async (id: number) => {
    try {
      await deleteMemory(id);
      setGrowthItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      showToast(t('settings.memory.growth.del_fail', { defaultValue: '删除失败' }), 'error');
    }
  };

  // --- 对话历史操作 ---
  const handleDeleteConversation = async (index: number) => {
    const ok = await confirm(t('settings.memoryview.confirm_delete_conversation'));
    if (!ok) return;
    const newConvos = [...memory.conversations];
    newConvos.splice(index, 1);
    localStorage.setItem(
      `desk_pet_memory_${getPersonaId()}`,
      JSON.stringify({ ...memory, conversations: newConvos }),
    );
    showToast(t('settings.memoryview.deleted'), 'success');
    window.location.reload();
  };

  const handleClearConversations = async () => {
    const ok = await confirm(t('settings.memoryview.confirm_clear_conversations'));
    if (!ok) return;
    clearMemory();
    showToast(t('settings.memoryview.cleared'), 'success');
  };

  // --- 事实记忆操作 ---
  const [editingFactId, setEditingFactId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editImportance, setEditImportance] = useState(0.5);

  const startEditFact = (id: string) => {
    const fact = memory.facts.find((f) => f.id === id);
    if (!fact) return;
    setEditingFactId(id);
    setEditContent(fact.content);
    setEditImportance(fact.importance);
  };

  const saveEditFact = () => {
    if (!editingFactId) return;
    const newFacts = memory.facts.map((f) =>
      f.id === editingFactId ? { ...f, content: editContent, importance: editImportance } : f,
    );
    localStorage.setItem(
      `desk_pet_memory_${getPersonaId()}`,
      JSON.stringify({ ...memory, facts: newFacts }),
    );
    setEditingFactId(null);
    showToast(t('settings.memoryview.saved'), 'success');
    window.location.reload();
  };

  const handleDeleteFact = async (id: string) => {
    const ok = await confirm(t('settings.memoryview.confirm_delete_fact'));
    if (!ok) return;
    const newFacts = memory.facts.filter((f) => f.id !== id);
    localStorage.setItem(
      `desk_pet_memory_${getPersonaId()}`,
      JSON.stringify({ ...memory, facts: newFacts }),
    );
    showToast(t('settings.memoryview.deleted'), 'success');
    window.location.reload();
  };

  // --- 偏好操作 ---
  const [editingPrefKey, setEditingPrefKey] = useState<string | null>(null);
  const [editPrefValue, setEditPrefValue] = useState('');

  const startEditPref = (key: string) => {
    setEditingPrefKey(key);
    setEditPrefValue(JSON.stringify(memory.preferences[key], null, 2));
  };

  const saveEditPref = () => {
    if (!editingPrefKey) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editPrefValue);
    } catch {
      showToast(t('settings.memoryview.invalid_json'), 'error');
      return;
    }
    const newPrefs = { ...memory.preferences, [editingPrefKey]: parsed };
    localStorage.setItem(
      `desk_pet_memory_${getPersonaId()}`,
      JSON.stringify({ ...memory, preferences: newPrefs }),
    );
    setEditingPrefKey(null);
    showToast(t('settings.memoryview.saved'), 'success');
    window.location.reload();
  };

  const handleDeletePref = async (key: string) => {
    const ok = await confirm(t('settings.memoryview.confirm_delete_pref'));
    if (!ok) return;
    const newPrefs = { ...memory.preferences };
    delete newPrefs[key];
    localStorage.setItem(
      `desk_pet_memory_${getPersonaId()}`,
      JSON.stringify({ ...memory, preferences: newPrefs }),
    );
    showToast(t('settings.memoryview.deleted'), 'success');
    window.location.reload();
  };

  function getPersonaId(): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pm = (window as any)?.deskpetPersonaManager;
      if (pm?.getActiveProfile?.()) return pm.getActiveProfile().id;
    } catch {
      /* ignore */
    }
    return 'default';
  }

  const formatDate = (d: Date) => {
    const date = new Date(d);
    return date.toLocaleString();
  };

  // Tab label map
  const tabLabels = [
    {
      key: 'conversations' as Tab,
      label: t('settings.memoryview.tab_conversations'),
      icon: 'solar:document-text-bold-duotone',
    },
    {
      key: 'facts' as Tab,
      label: t('settings.memoryview.tab_facts'),
      icon: 'solar:document-bold-duotone',
    },
    {
      key: 'preferences' as Tab,
      label: t('settings.memoryview.tab_preferences'),
      icon: 'solar:settings-bold-duotone',
    },
    {
      key: 'growth' as Tab,
      label: t('settings.memory.growth.title', { defaultValue: '成长记忆' }),
      icon: 'solar:graph-new-bold-duotone',
    },
    {
      key: 'rag' as Tab,
      label: t('settings.memoryview.tab_rag', { defaultValue: 'RAG 文档' }),
      icon: 'solar:brain-bold-duotone',
    },
  ] as const;

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 记忆职责提示：持久档案在会话档案 */}
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
        <Icon icon="solar:info-circle-bold" className="shrink-0 text-sm text-neutral-400" />
        <span className="flex-1">{t('settings.memoryview.archive_hint')}</span>
        <button
          type="button"
          onClick={() => navigate('/settings/memory/sessions')}
          className="shrink-0 font-medium text-[var(--primary-600)] transition-colors hover:text-[var(--primary-700)]"
        >
          {t('settings.memoryview.archive_go')}
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1 mb-4">
        {tabLabels.map(({ key, label, icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-white text-neutral-800 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <Icon icon={icon} className="text-sm" />
              {label}
            </button>
          );
        })}
      </div>

      {/* ===== 对话历史 ===== */}
      {tab === 'conversations' && (
        <Section
          title={t('settings.memoryview.conversations_title')}
          description={t('settings.memoryview.conversations_desc', {
            count: String(memory.conversations.length),
          })}
        >
          {memory.conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-neutral-400">
              <Icon icon="solar:chat-square-bold-duotone" className="text-3xl mb-2" />
              <span>{t('settings.memoryview.empty_conversations')}</span>
            </div>
          ) : (
            <div className="flex flex-col">
              {memory.conversations.map((msg, idx) => (
                <div
                  key={`${msg.role}-${msg.timestamp.getTime()}-${idx}`}
                  className="flex items-start gap-3 px-4 py-3 border-b border-neutral-100"
                >
                  <span
                    className={`shrink-0 mt-0.5 h-7 w-7 flex items-center justify-center rounded-full text-xs font-medium ${
                      msg.role === 'user'
                        ? 'bg-neutral-200 text-neutral-600'
                        : 'bg-[var(--primary-100)] text-[var(--primary-600)]'
                    }`}
                  >
                    {msg.role === 'user' ? '你' : 'AI'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-neutral-800 whitespace-pre-wrap break-words">
                      {msg.content}
                    </div>
                    <div className="text-xs text-neutral-400 mt-1">{formatDate(msg.timestamp)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteConversation(idx)}
                    className="shrink-0 p-1.5 rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    title={t('common.delete')}
                  >
                    <Icon icon="solar:trash-bin-trash-bold-duotone" className="text-base" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {memory.conversations.length > 0 && (
            <div className="px-4 py-3 border-t border-neutral-100">
              <button
                type="button"
                onClick={handleClearConversations}
                className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 transition-colors"
              >
                <Icon icon="solar:trash-bin-trash-bold-duotone" />
                {t('settings.memoryview.clear_all_conversations')}
              </button>
            </div>
          )}
        </Section>
      )}

      {/* ===== 事实记忆 ===== */}
      {tab === 'facts' && (
        <Section
          title={t('settings.memoryview.facts_title')}
          description={t('settings.memoryview.facts_desc', { count: String(memory.facts.length) })}
        >
          {memory.facts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-neutral-400">
              <Icon icon="solar:document-bold-duotone" className="text-3xl mb-2" />
              <span>{t('settings.memoryview.empty_facts')}</span>
            </div>
          ) : (
            <div className="flex flex-col">
              {memory.facts.map((fact) => (
                <div key={fact.id} className="border-b border-neutral-100 last:border-b-0">
                  {editingFactId === fact.id ? (
                    <div className="p-4 space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-500">
                          {t('settings.memoryview.content')}
                        </label>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 focus:outline-none focus:border-[var(--primary-500)]"
                        />
                      </div>
                      <SliderRow
                        label={t('settings.memoryview.importance')}
                        desc={t('settings.memoryview.importance_desc')}
                        min={0}
                        max={1}
                        step={0.05}
                        value={editImportance}
                        onChange={(v) => setEditImportance(v)}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveEditFact}
                          className="flex items-center gap-1 rounded-lg bg-[var(--primary-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-600)]"
                        >
                          <Icon icon="solar:check-circle-bold" className="text-sm" />
                          {t('settings.memoryview.save')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingFactId(null)}
                          className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                        >
                          {t('settings.memoryview.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-neutral-800">{fact.content}</div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-neutral-400">
                            {formatDate(fact.timestamp)}
                          </span>
                          <span className="text-xs text-neutral-500">
                            {t('settings.memoryview.importance')}:{' '}
                            {(fact.importance * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditFact(fact.id)}
                          className="p-1.5 rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
                          title={t('common.edit')}
                        >
                          <Icon icon="solar:pen-bold" className="text-base" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteFact(fact.id)}
                          className="p-1.5 rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                          title={t('common.delete')}
                        >
                          <Icon icon="solar:trash-bin-trash-bold-duotone" className="text-base" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ===== 用户偏好 ===== */}
      {tab === 'preferences' && (
        <Section
          title={t('settings.memoryview.preferences_title')}
          description={t('settings.memoryview.preferences_desc', {
            count: String(Object.keys(memory.preferences).length),
          })}
        >
          {Object.keys(memory.preferences).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-neutral-400">
              <Icon icon="solar:settings-bold-duotone" className="text-3xl mb-2" />
              <span>{t('settings.memoryview.empty_preferences')}</span>
            </div>
          ) : (
            <div className="flex flex-col">
              {Object.entries(memory.preferences).map(([key, value]) => (
                <div key={key} className="border-b border-neutral-100 last:border-b-0">
                  {editingPrefKey === key ? (
                    <div className="p-4 space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-500">
                          {t('settings.memoryview.key')}
                        </label>
                        <input
                          type="text"
                          value={key}
                          disabled
                          className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-500">
                          {t('settings.memoryview.value')}
                        </label>
                        <textarea
                          value={editPrefValue}
                          onChange={(e) => setEditPrefValue(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 font-mono focus:outline-none focus:border-[var(--primary-500)]"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveEditPref}
                          className="flex items-center gap-1 rounded-lg bg-[var(--primary-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-600)]"
                        >
                          <Icon icon="solar:check-circle-bold" className="text-sm" />
                          {t('settings.memoryview.save')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingPrefKey(null)}
                          className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                        >
                          {t('settings.memoryview.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="text-xs font-medium text-neutral-500 shrink-0 font-mono">
                        {key}
                      </span>
                      <span className="flex-1 text-sm text-neutral-700 truncate">
                        {JSON.stringify(value)}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditPref(key)}
                          className="p-1.5 rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
                          title={t('common.edit')}
                        >
                          <Icon icon="solar:pen-bold" className="text-base" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePref(key)}
                          className="p-1.5 rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                          title={t('common.delete')}
                        >
                          <Icon icon="solar:trash-bin-trash-bold-duotone" className="text-base" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ===== 成长记忆 ===== */}
      {tab === 'growth' && (
        <Section
          title={t('settings.memory.growth.title', { defaultValue: '成长记忆' })}
          description={t('settings.memory.growth.desc', {
            defaultValue: '桌宠在对话中自动学到的用户偏好与事实，可手动添加。',
          })}
        >
          {/* 手动添加 */}
          <div className="space-y-2 px-4 pb-3">
            <textarea
              value={newGrowthText}
              onChange={(e) => setNewGrowthText(e.target.value)}
              placeholder={t('settings.memory.growth.add_placeholder', {
                defaultValue: '手动添加一条要记住的信息…',
              })}
              className="w-full rounded-lg border border-neutral-200 p-2 text-sm focus:border-[var(--primary-500)] focus:outline-none"
              rows={2}
            />
            <div className="flex items-center gap-2">
              <select
                value={newGrowthCat}
                onChange={(e) => setNewGrowthCat(e.target.value)}
                className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm"
              >
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddGrowth}
                disabled={!newGrowthText.trim()}
                className="rounded-lg bg-[var(--primary-500)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {t('settings.memory.growth.add', { defaultValue: '添加' })}
              </button>
            </div>
          </div>

          {/* 列表 */}
          <div className="px-4">
            {growthLoading ? (
              <p className="text-xs text-neutral-400">
                {t('settings.memory.growth.loading', { defaultValue: '加载中…' })}
              </p>
            ) : growthItems.length === 0 ? (
              <p className="text-xs text-neutral-400">
                {t('settings.memory.growth.empty', {
                  defaultValue: '还没有成长记忆，多聊一聊桌宠就会开始学习。',
                })}
              </p>
            ) : (
              <ul className="space-y-2">
                {growthItems.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-neutral-800">{m.text}</span>
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700">
                          {CATEGORY_LABEL[m.category] ?? m.category}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-neutral-400">
                        {m.source} ·{' '}
                        {m.created_at ? new Date(m.created_at * 1000).toLocaleString() : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteGrowth(m.id)}
                      className="shrink-0 rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-50"
                    >
                      {t('settings.memory.growth.delete', { defaultValue: '删除' })}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      )}

      {/* ===== RAG 文档（长期记忆向量库） ===== */}
      {tab === 'rag' && (
        <Section
          title={t('settings.memoryview.rag_title', { defaultValue: 'RAG 文档' })}
          description={t('settings.memoryview.rag_desc', {
            defaultValue: '长期记忆向量库中的文档（来自对话自动抽取），与上方对话/事实/偏好为不同数据源。',
            count: String(ragDocs.length),
          })}
        >
          {ragLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-500">
              <Icon icon="solar:restart-bold" className="text-lg animate-spin" />
              <span>{t('common.loading')}</span>
            </div>
          ) : ragDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-neutral-400">
              <Icon icon="solar:brain-bold-duotone" className="text-3xl mb-2" />
              <span>{t('settings.memoryview.empty_rag', { defaultValue: 'RAG 文档为空，多进行对话后系统会自动抽取关键信息。' })}</span>
            </div>
          ) : (
            <div className="flex flex-col">
              {/* 统计条 */}
              <div className="flex items-center gap-4 px-4 py-2 bg-neutral-50 rounded-lg mb-2 text-xs text-neutral-500">
                <span>共 {ragDocs.length} 条文档</span>
                <span>·</span>
                <span>重要性 &gt; 0.7: {ragDocs.filter((d) => d.importance > 0.7).length} 条</span>
                <span>·</span>
                <span>由 RAG 引擎自动从对话中抽取并持久化</span>
              </div>
              {ragDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-start gap-3 px-4 py-3 border-b border-neutral-100"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-neutral-800 whitespace-pre-wrap break-words">{doc.content}</div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-neutral-400">
                        {doc.createdAt.toLocaleString()}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          doc.importance > 0.7
                            ? 'bg-green-100 text-green-700'
                            : doc.importance > 0.4
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-neutral-100 text-neutral-500'
                        }`}
                      >
                        {(doc.importance * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

export default MemoryViewPage;
