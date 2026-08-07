import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, Switch, useToast } from '../../components';
import type { Rule } from '../../../hooks/useMemory';

const MEMORY_KEY = 'desk_pet_memory';

interface MemoryData {
  conversations: unknown[];
  preferences: Record<string, unknown>;
  facts: unknown[];
  rules: Rule[];
}

function loadMemory(): MemoryData {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MemoryData>;
      return {
        conversations: parsed.conversations ?? [],
        preferences: parsed.preferences ?? {},
        facts: parsed.facts ?? [],
        rules: (parsed.rules ?? []).map((r) => ({
          ...r,
          createdAt: new Date((r.createdAt as unknown as string) || Date.now()),
        })),
      };
    }
  } catch {
    /* ignore */
  }
  return { conversations: [], preferences: {}, facts: [], rules: [] };
}

function saveRules(rules: Rule[]) {
  try {
    const data = loadMemory();
    data.rules = rules;
    localStorage.setItem(MEMORY_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

/**
 * 记忆体 → 规则管理：从 localStorage 读取 / 保存规则列表。
 */
export function RulesPage() {
  const [rules, setRules] = useState<Rule[]>(() => loadMemory().rules);
  const [newRule, setNewRule] = useState('');
  const { t } = useTranslation();
  const { showToast } = useToast();

  const persist = (updated: Rule[]) => {
    setRules(updated);
    saveRules(updated);
  };

  const addRule = () => {
    const content = newRule.trim();
    if (!content) return;
    persist([
      ...rules,
      { id: Date.now().toString(), content, enabled: true, createdAt: new Date() },
    ]);
    setNewRule('');
  };

  const toggleRule = (id: string) =>
    persist(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));

  const removeRule = (id: string) => {
    persist(rules.filter((r) => r.id !== id));
    showToast(t('settings.rules.deleted'), 'success');
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section title={t('settings.rules_title')} description={t('settings.rules_desc')}>
        {rules.length > 0 ? (
          <ul>
            {rules.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-neutral-100 last:border-b-0"
              >
                <Icon
                  icon={
                    r.enabled
                      ? 'solar:check-circle-bold-duotone'
                      : 'solar:record-circle-bold-duotone'
                  }
                  className={`text-lg shrink-0 ${r.enabled ? 'text-green-500' : 'text-neutral-400'}`}
                />
                <span
                  className={`flex-1 text-sm min-w-0 ${
                    r.enabled ? 'text-neutral-800' : 'text-neutral-400 line-through'
                  }`}
                >
                  {r.content}
                </span>
                <Switch checked={r.enabled} onChange={() => toggleRule(r.id)} />
                <button
                  type="button"
                  onClick={() => removeRule(r.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-500"
                  aria-label={t('settings.rules.delete_aria')}
                >
                  <Icon icon="solar:trash-bin-trash-bold-duotone" className="text-base" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-sm text-neutral-400">
            <Icon icon="solar:document-text-bold-duotone" className="text-3xl mb-2" />
            <span>{t('settings.rules.empty')}</span>
            <span className="text-xs mt-1">{t('settings.rules.empty_desc')}</span>
          </div>
        )}

        <div className="flex gap-2 p-4 border-t border-neutral-100">
          <input
            type="text"
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addRule();
            }}
            placeholder={t('settings.rules_placeholder')}
            className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200"
          />
          <button
            type="button"
            onClick={addRule}
            disabled={!newRule.trim()}
            className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-900 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {t('settings.add')}
          </button>
        </div>
      </Section>
    </div>
  );
}

export default RulesPage;
