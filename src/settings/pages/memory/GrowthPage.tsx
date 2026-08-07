import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Section } from '../../components';
import { useToast } from '../../components';
import {
  fetchMemories,
  addMemory,
  deleteMemory,
  type MemoryItem,
} from '../../../services/gatewayApi';

const CATEGORY_LABEL: Record<string, string> = {
  preference: '偏好',
  fact: '事实',
  feedback: '反馈',
  rule: '约定',
};

export function GrowthPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState('');
  const [newCat, setNewCat] = useState('fact');

  const load = useCallback(() => {
    setLoading(true);
    fetchMemories()
      .then((r) => setItems(r.items))
      .catch(() => {
        setItems([]);
        showToast(
          t('settings.memory.growth.gateway_off', {
            defaultValue: '无法连接 Gateway，请确认后端已启动',
          }),
          'error',
        );
      })
      .finally(() => setLoading(false));
  }, [showToast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    const text = newText.trim();
    if (!text) return;
    try {
      await addMemory(text, newCat);
      setNewText('');
      showToast(
        t('settings.memory.growth.added', { defaultValue: '已添加记忆' }),
        'success',
      );
      load();
    } catch {
      showToast(
        t('settings.memory.growth.add_fail', { defaultValue: '添加失败' }),
        'error',
      );
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMemory(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      showToast(
        t('settings.memory.growth.del_fail', { defaultValue: '删除失败' }),
        'error',
      );
    }
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.memory.growth.title', { defaultValue: '成长记忆' })}
        description={t('settings.memory.growth.desc', {
          defaultValue: '桌宠在对话中自动学到的用户偏好与事实，会在后续对话被召回运用。',
        })}
      >
        {/* 手动添加 */}
        <div className="space-y-2 px-4 pb-3">
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder={t('settings.memory.growth.add_placeholder', {
              defaultValue: '手动添加一条要记住的信息…',
            })}
            className="w-full rounded-lg border border-neutral-200 p-2 text-sm focus:border-[var(--primary-500)] focus:outline-none"
            rows={2}
          />
          <div className="flex items-center gap-2">
            <select
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
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
              onClick={handleAdd}
              disabled={!newText.trim()}
              className="rounded-lg bg-[var(--primary-500)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {t('settings.memory.growth.add', { defaultValue: '添加' })}
            </button>
          </div>
        </div>

        {/* 列表 */}
        <div className="px-4">
          {loading ? (
            <p className="text-xs text-neutral-400">
              {t('settings.memory.growth.loading', { defaultValue: '加载中…' })}
            </p>
          ) : items.length === 0 ? (
            <p className="text-xs text-neutral-400">
              {t('settings.memory.growth.empty', {
                defaultValue: '还没有成长记忆，多聊一聊桌宠就会开始学习。',
              })}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((m) => (
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
                      {m.created_at
                        ? new Date(m.created_at * 1000).toLocaleString()
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(m.id)}
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
    </div>
  );
}

export default GrowthPage;
