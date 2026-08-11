import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { useMemory } from '../../../hooks/useMemory';
import { Section, SliderRow, useToast, useConfirm } from '../../components';

type Tab = 'facts' | 'preferences' | 'rules';

/**
 * 记忆查看页
 *
 * 三类总结性记忆：
 *  - 事实记忆：从对话中提炼或手动添加的要点（带重要性权重）
 *  - 用户偏好：键值对形式的偏好
 *  - 约定规则：与桌宠的行为约定、反馈条款等
 *
 * 交互设计：
 *  - 列表在上，添加框在下
 *  - 双击条目进入编辑模式
 *  - hover 显示操作按钮（删除 / 调整重要性）
 */
export function MemoryViewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { memory, addFact, setPreference, addRule, removeRule, toggleRule } = useMemory();

  const [tab, setTab] = useState<Tab>(() => {
    const p = searchParams.get('tab');
    if (p === 'preferences' || p === 'rules' || p === 'facts') return p;
    return 'facts';
  });

  // ── 事实记忆 ──
  const [newFactText, setNewFactText] = useState('');
  const [newFactImportance, setNewFactImportance] = useState(0.6);
  const [editingFactId, setEditingFactId] = useState<string | null>(null);
  const [editFactContent, setEditFactContent] = useState('');
  const [editFactImportance, setEditFactImportance] = useState(0.5);

  // ── 用户偏好 ──
  const [newPrefKey, setNewPrefKey] = useState('');
  const [newPrefValue, setNewPrefValue] = useState('');
  const [editingPrefKey, setEditingPrefKey] = useState<string | null>(null);
  const [editPrefValue, setEditPrefValue] = useState('');

  // ── 约定规则 ──
  const [newRuleContent, setNewRuleContent] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRuleContent, setEditRuleContent] = useState('');

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

  const memoryKey = `desk_pet_memory_${getPersonaId()}`;

  const reloadMemory = () => window.location.reload();

  // ── 事实操作 ──
  const handleAddFact = () => {
    const text = newFactText.trim();
    if (!text) return;
    addFact(text, newFactImportance);
    setNewFactText('');
    setNewFactImportance(0.6);
    showToast(t('settings.memoryview.added'), 'success');
  };

  const startEditFact = (id: string) => {
    const fact = memory.facts.find((f) => f.id === id);
    if (!fact) return;
    setEditingFactId(id);
    setEditFactContent(fact.content);
    setEditFactImportance(fact.importance);
  };

  const saveEditFact = () => {
    if (!editingFactId) return;
    const newFacts = memory.facts.map((f) =>
      f.id === editingFactId ? { ...f, content: editFactContent, importance: editFactImportance } : f,
    );
    localStorage.setItem(memoryKey, JSON.stringify({ ...memory, facts: newFacts }));
    setEditingFactId(null);
    showToast(t('settings.memoryview.saved'), 'success');
    reloadMemory();
  };

  const handleDeleteFact = async (id: string) => {
    const ok = await confirm(t('settings.memoryview.confirm_delete_fact'));
    if (!ok) return;
    const newFacts = memory.facts.filter((f) => f.id !== id);
    localStorage.setItem(memoryKey, JSON.stringify({ ...memory, facts: newFacts }));
    showToast(t('settings.memoryview.deleted'), 'success');
    reloadMemory();
  };

  const handleAdjustImportance = (id: string, delta: number) => {
    const newFacts = memory.facts.map((f) =>
      f.id === id ? { ...f, importance: Math.max(0, Math.min(1, f.importance + delta)) } : f,
    );
    localStorage.setItem(memoryKey, JSON.stringify({ ...memory, facts: newFacts }));
    reloadMemory();
  };

  // ── 偏好操作 ──
  const handleAddPref = () => {
    const key = newPrefKey.trim();
    if (!key) {
      showToast(t('settings.memoryview.key_required'), 'error');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(newPrefValue || '"{}"');
    } catch {
      showToast(t('settings.memoryview.invalid_json'), 'error');
      return;
    }
    setPreference(key, parsed);
    setNewPrefKey('');
    setNewPrefValue('');
    showToast(t('settings.memoryview.added'), 'success');
  };

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
    localStorage.setItem(memoryKey, JSON.stringify({ ...memory, preferences: newPrefs }));
    setEditingPrefKey(null);
    showToast(t('settings.memoryview.saved'), 'success');
    reloadMemory();
  };

  const handleDeletePref = async (key: string) => {
    const ok = await confirm(t('settings.memoryview.confirm_delete_pref'));
    if (!ok) return;
    const newPrefs = { ...memory.preferences };
    delete newPrefs[key];
    localStorage.setItem(memoryKey, JSON.stringify({ ...memory, preferences: newPrefs }));
    showToast(t('settings.memoryview.deleted'), 'success');
    reloadMemory();
  };

  // ── 规则操作 ──
  const handleAddRule = () => {
    const content = newRuleContent.trim();
    if (!content) return;
    addRule(content);
    setNewRuleContent('');
    showToast(t('settings.memoryview.added'), 'success');
  };

  const startEditRule = (id: string) => {
    const rule = memory.rules.find((r) => r.id === id);
    if (!rule) return;
    setEditingRuleId(id);
    setEditRuleContent(rule.content);
  };

  const saveEditRule = () => {
    if (!editingRuleId) return;
    const newRules = memory.rules.map((r) =>
      r.id === editingRuleId ? { ...r, content: editRuleContent.trim() } : r,
    );
    localStorage.setItem(memoryKey, JSON.stringify({ ...memory, rules: newRules }));
    setEditingRuleId(null);
    showToast(t('settings.memoryview.saved'), 'success');
    reloadMemory();
  };

  const handleDeleteRule = async (id: string) => {
    const ok = await confirm(t('settings.memoryview.confirm_delete_rule'));
    if (!ok) return;
    removeRule(id);
    showToast(t('settings.memoryview.deleted'), 'success');
  };

  const formatDate = (d: Date | string) => new Date(d).toLocaleString();

  const tabLabels: { key: Tab; label: string; icon: string }[] = [
    { key: 'facts', label: t('settings.memoryview.tab_facts'), icon: 'solar:document-bold-duotone' },
    { key: 'preferences', label: t('settings.memoryview.tab_preferences'), icon: 'solar:settings-bold-duotone' },
    { key: 'rules', label: t('settings.memoryview.tab_rules'), icon: 'solar:checklist-bold-duotone' },
  ];

  /* ═══════════════════ 通用：hover 操作按钮组 ═══════════════════ */
  const HoverActions = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
      {children}
    </div>
  );

  /* ═══════════════════ 渲染 ═══════════════════ */
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
                active ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <Icon icon={icon} className="text-sm" />
              {label}
            </button>
          );
        })}
      </div>

      {/* ═══════════════════ 事实记忆 ═══════════════════ */}
      {tab === 'facts' && (
        <Section
          title={t('settings.memoryview.facts_title')}
          description={t('settings.memoryview.facts_desc', { count: String(memory.facts.length) })}
        >
          {/* 列表 */}
          {memory.facts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-neutral-400">
              <Icon icon="solar:document-bold-duotone" className="text-3xl mb-2" />
              <span>{t('settings.memoryview.empty_facts')}</span>
            </div>
          ) : (
            <div className="flex flex-col -mx-4">
              {memory.facts.map((fact) => (
                <div
                  key={fact.id}
                  className="group relative border-b border-neutral-100 last:border-b-0"
                  onDoubleClick={() => startEditFact(fact.id)}
                >
                  {editingFactId === fact.id ? (
                    /* 编辑态 */
                    <div className="p-4 space-y-3 bg-neutral-50/50">
                      <textarea
                        value={editFactContent}
                        onChange={(e) => setEditFactContent(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 focus:outline-none focus:border-[var(--primary-500)]"
                      />
                      <SliderRow
                        label={t('settings.memoryview.importance')}
                        desc={t('settings.memoryview.importance_desc')}
                        min={0}
                        max={1}
                        step={0.05}
                        value={editFactImportance}
                        onChange={(v) => setEditFactImportance(v)}
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
                          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                        >
                          {t('settings.memoryview.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* 展示态：双击编辑 + hover 操作 */
                    <div className="flex items-start gap-3 px-4 py-3 cursor-default select-none">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-neutral-800 leading-relaxed">{fact.content}</div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[11px] text-neutral-400">{formatDate(fact.timestamp)}</span>
                          <span
                            className={`text-[11px] font-medium ${
                              fact.importance > 0.7
                                ? 'text-emerald-600'
                                : fact.importance > 0.4
                                  ? 'text-amber-500'
                                  : 'text-neutral-400'
                            }`}
                          >
                            {(fact.importance * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      <HoverActions>
                        {/* 重要性 +/- */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleAdjustImportance(fact.id, -0.1); }}
                          className="p-1 rounded text-neutral-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                          title="-10%"
                        >
                          <Icon icon="solar:minus-circle-linear" className="text-base" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleAdjustImportance(fact.id, 0.1); }}
                          className="p-1 rounded text-neutral-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                          title="+10%"
                        >
                          <Icon icon="solar:add-circle-linear" className="text-base" />
                        </button>
                        {/* 删除 */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteFact(fact.id); }}
                          className="p-1.5 rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                          title={t('common.delete')}
                        >
                          <Icon icon="solar:trash-bin-trash-bold-duotone" className="text-base" />
                        </button>
                      </HoverActions>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 添加框（底部） */}
          <div className="mt-4 space-y-2 border-t border-neutral-100 pt-3">
            <textarea
              value={newFactText}
              onChange={(e) => setNewFactText(e.target.value)}
              placeholder={t('settings.memoryview.add_fact_placeholder')}
              className="w-full rounded-lg border border-neutral-200 p-2 text-sm focus:border-[var(--primary-500)] focus:outline-none resize-none"
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
        </Section>
      )}

      {/* ═══════════════════ 用户偏好 ═══════════════════ */}
      {tab === 'preferences' && (
        <Section
          title={t('settings.memoryview.preferences_title')}
          description={t('settings.memoryview.preferences_desc', { count: String(Object.keys(memory.preferences).length) })}
        >
          {Object.keys(memory.preferences).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-neutral-400">
              <Icon icon="solar:settings-bold-duotone" className="text-3xl mb-2" />
              <span>{t('settings.memoryview.empty_preferences')}</span>
            </div>
          ) : (
            <div className="flex flex-col -mx-4">
              {Object.entries(memory.preferences).map(([key, value]) => (
                <div
                  key={key}
                  className="group relative border-b border-neutral-100 last:border-b-0"
                  onDoubleClick={() => startEditPref(key)}
                >
                  {editingPrefKey === key ? (
                    <div className="p-4 space-y-3 bg-neutral-50/50">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-500">{t('settings.memoryview.key')}</label>
                        <input
                          type="text"
                          value={key}
                          disabled
                          className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-500">{t('settings.memoryview.value')}</label>
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
                          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                        >
                          {t('settings.memoryview.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3 cursor-default select-none">
                      <span className="text-xs font-medium text-neutral-500 shrink-0 font-mono">{key}</span>
                      <span className="flex-1 text-sm text-neutral-700 truncate">{JSON.stringify(value)}</span>
                      <HoverActions>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeletePref(key); }}
                          className="p-1.5 rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                          title={t('common.delete')}
                        >
                          <Icon icon="solar:trash-bin-trash-bold-duotone" className="text-base" />
                        </button>
                      </HoverActions>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 添加框（底部） */}
          <div className="mt-4 space-y-2 border-t border-neutral-100 pt-3">
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
        </Section>
      )}

      {/* ═══════════════════ 约定规则 ═══════════════════ */}
      {tab === 'rules' && (
        <Section
          title={t('settings.memoryview.rules_title')}
          description={t('settings.memoryview.rules_desc', { count: String(memory.rules.length) })}
        >
          {memory.rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-neutral-400">
              <Icon icon="solar:checklist-bold-duotone" className="text-3xl mb-2" />
              <span>{t('settings.memoryview.empty_rules')}</span>
            </div>
          ) : (
            <div className="flex flex-col -mx-4">
              {memory.rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`group relative border-b border-neutral-100 last:border-b-0 ${!rule.enabled ? 'opacity-50' : ''}`}
                  onDoubleClick={() => startEditRule(rule.id)}
                >
                  {editingRuleId === rule.id ? (
                    <div className="p-4 space-y-3 bg-neutral-50/50">
                      <textarea
                        value={editRuleContent}
                        onChange={(e) => setEditRuleContent(e.target.value)}
                        rows={2}
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 focus:outline-none focus:border-[var(--primary-500)]"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveEditRule}
                          className="flex items-center gap-1 rounded-lg bg-[var(--primary-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-600)]"
                        >
                          <Icon icon="solar:check-circle-bold" className="text-sm" />
                          {t('settings.memoryview.save')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingRuleId(null)}
                          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                        >
                          {t('settings.memoryview.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3 cursor-default select-none">
                      {/* 启用/禁用开关 */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleRule(rule.id); }}
                        className={`shrink-0 w-8 h-5 rounded-full transition-colors ${rule.enabled ? 'bg-emerald-500' : 'bg-neutral-300'} relative`}
                        title={rule.enabled ? t('common.disable') : t('common.enable')}
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${rule.enabled ? 'left-[18px]' : 'left-0.5'}`}
                        />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-neutral-800 leading-relaxed">{rule.content}</div>
                        <div className="text-[11px] text-neutral-400 mt-0.5">{formatDate(rule.createdAt)}</div>
                      </div>
                      <HoverActions>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteRule(rule.id); }}
                          className="p-1.5 rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                          title={t('common.delete')}
                        >
                          <Icon icon="solar:trash-bin-trash-bold-duotone" className="text-base" />
                        </button>
                      </HoverActions>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 添加框（底部） */}
          <div className="mt-4 space-y-2 border-t border-neutral-100 pt-3">
            <input
              type="text"
              value={newRuleContent}
              onChange={(e) => setNewRuleContent(e.target.value)}
              placeholder={t('settings.memoryview.add_rule_placeholder')}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-[var(--primary-500)] focus:outline-none"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleAddRule}
                disabled={!newRuleContent.trim()}
                className="rounded-lg bg-[var(--primary-500)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {t('settings.memoryview.add_rule_btn')}
              </button>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

export default MemoryViewPage;
