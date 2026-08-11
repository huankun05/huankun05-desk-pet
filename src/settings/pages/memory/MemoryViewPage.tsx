import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { useMemory } from '../../../hooks/useMemory';
import { Section, SliderRow, useToast, useConfirm } from '../../components';

type Tab = 'facts' | 'preferences';

/**
 * 记忆体 → 记忆查看
 *
 * 只展示「总结性记忆」两类：
 *  - 事实记忆：从对话中提炼或手动添加的要点（带重要性权重）
 *  - 用户偏好：键值对形式的偏好
 *
 * 设计原则（与用户确认）：
 *  - 对话原始记录统一在「聊天 → 会话档案」查看，本页不再重复展示原始对话。
 *  - RAG 向量库是底层检索层（自动从对话抽取片段用于检索），不在 UI 展示原始文档。
 *  - 「成长记忆」只是 事实/偏好/反馈/约定 的分类，不再单列，统一在对应类别下手动添加。
 */
export function MemoryViewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { memory, addFact, setPreference } = useMemory();

  const [tab, setTab] = useState<Tab>(() => {
    const p = searchParams.get('tab');
    return p === 'preferences' ? 'preferences' : 'facts';
  });

  // --- 手动添加：事实 ---
  const [newFactText, setNewFactText] = useState('');
  const [newFactImportance, setNewFactImportance] = useState(0.6);

  // --- 手动添加：偏好 ---
  const [newPrefKey, setNewPrefKey] = useState('');
  const [newPrefValue, setNewPrefValue] = useState('');

  // --- 事实记忆编辑 ---
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

  const handleAddFact = () => {
    const text = newFactText.trim();
    if (!text) return;
    addFact(text, newFactImportance);
    setNewFactText('');
    showToast(t('settings.memoryview.added'), 'success');
  };

  // --- 偏好编辑 ---
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

  const handleAddPref = () => {
    const key = newPrefKey.trim();
    if (!key) {
      showToast(t('settings.memoryview.key_required'), 'error');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(newPrefValue);
    } catch {
      showToast(t('settings.memoryview.invalid_json'), 'error');
      return;
    }
    setPreference(key, parsed);
    setNewPrefKey('');
    setNewPrefValue('');
    showToast(t('settings.memoryview.added'), 'success');
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

  const tabLabels = [
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
  ] as const;

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 记忆职责提示 */}
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

      {/* ===== 事实记忆 ===== */}
      {tab === 'facts' && (
        <Section
          title={t('settings.memoryview.facts_title')}
          description={t('settings.memoryview.facts_desc', { count: String(memory.facts.length) })}
        >
          {/* 手动添加（篡改 / 补记记忆） */}
          <div className="space-y-2 px-4 pb-3 pt-1">
            <p className="text-xs font-medium text-neutral-500">
              {t('settings.memoryview.manual_add')}
            </p>
            <textarea
              value={newFactText}
              onChange={(e) => setNewFactText(e.target.value)}
              placeholder={t('settings.memoryview.add_fact_placeholder')}
              className="w-full rounded-lg border border-neutral-200 p-2 text-sm focus:border-[var(--primary-500)] focus:outline-none"
              rows={2}
            />
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <SliderRow
                  label={t('settings.memoryview.importance')}
                  desc={t('settings.memoryview.importance_desc')}
                  min={0}
                  max={1}
                  step={0.05}
                  value={newFactImportance}
                  onChange={(v) => setNewFactImportance(v)}
                />
              </div>
              <button
                type="button"
                onClick={handleAddFact}
                disabled={!newFactText.trim()}
                className="shrink-0 self-end rounded-lg bg-[var(--primary-500)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {t('settings.memoryview.add_fact_btn')}
              </button>
            </div>
          </div>

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
          {/* 手动添加 */}
          <div className="space-y-2 px-4 pb-3 pt-1">
            <p className="text-xs font-medium text-neutral-500">
              {t('settings.memoryview.manual_add')}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newPrefKey}
                onChange={(e) => setNewPrefKey(e.target.value)}
                placeholder={t('settings.memoryview.add_pref_key_placeholder')}
                className="w-40 shrink-0 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm focus:border-[var(--primary-500)] focus:outline-none"
              />
              <input
                type="text"
                value={newPrefValue}
                onChange={(e) => setNewPrefValue(e.target.value)}
                placeholder={t('settings.memoryview.add_pref_value_placeholder')}
                className="flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm focus:border-[var(--primary-500)] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddPref}
                disabled={!newPrefKey.trim()}
                className="shrink-0 self-stretch rounded-lg bg-[var(--primary-500)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {t('settings.memoryview.add_pref_btn')}
              </button>
            </div>
          </div>

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
    </div>
  );
}

export default MemoryViewPage;
