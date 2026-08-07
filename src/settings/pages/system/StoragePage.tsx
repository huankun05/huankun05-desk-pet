import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { invoke } from '@tauri-apps/api/core';
import { Section, useToast } from '../../components';
import { isTauriEnv } from '../../../utils/tauriEnv';

/** 格式化字节为可读字符串 */
function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const idx = Math.min(i, units.length - 1);
  return `${(bytes / Math.pow(1024, idx)).toFixed(2)} ${units[idx]}`;
}

/** 计算浏览器 localStorage 占用字节（记忆 / RAG 等） */
function getLocalStorageBytes(): number {
  let total = 0;
  const enc = new TextEncoder();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const val = localStorage.getItem(key) || '';
    total += enc.encode(val).length;
  }
  return total;
}

interface StorageItem {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
}

interface StorageCategory {
  id: string;
  size: number;
  path: string;
  items: StorageItem[];
}

interface StorageUsage {
  total: number;
  app_path: string;
  categories: StorageCategory[];
}

/** 各分类的展示元数据（颜色 / 图标 / 管理跳转目标） */
const CATEGORY_META: Record<string, { color: string; icon: string; manageTo: string }> = {
  app: { color: '#6366f1', icon: 'solar:box-bold-duotone', manageTo: '/settings/system/about' },
  user: {
    color: '#10b981',
    icon: 'solar:user-circle-bold-duotone',
    manageTo: '/settings/memory/data',
  },
  cache: {
    color: '#f59e0b',
    icon: 'solar:folder-bold-duotone',
    manageTo: '/settings/system/files',
  },
  models: {
    color: '#0ea5e9',
    icon: 'solar:gallery-bold-duotone',
    manageTo: '/settings/models/live2d',
  },
};

/** 微信风格环形图：每段对应一个分类，可点击选中 */
function DonutChart({
  categories,
  selectedId,
  onSelect,
}: {
  categories: StorageCategory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const size = 220;
  const stroke = 26;
  const radius = (size - stroke) / 2 - 8; // 预留边距给圆帽
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * radius;
  const total = categories.reduce((a, c) => a + c.size, 0) || 1;

  // 预计算每个扇区的长度与偏移（避免渲染期对外部变量重新赋值）
  const segments = categories.map((cat, i) => {
    const meta = CATEGORY_META[cat.id];
    const frac = cat.size / total;
    const len = frac * C;
    const prevFrac = categories.slice(0, i).reduce((s, c) => s + c.size / total, 0);
    const offset = -prevFrac * C;
    return { cat, meta, len, offset };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="select-none">
      {/* 背景环 */}
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#f1f1f4" strokeWidth={stroke} />
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {segments.map(({ cat, meta, len, offset }) => {
          if (!meta) return null;
          const isSel = selectedId === cat.id;
          // 极小扇区至少留 0.5px 以便可见且可点
          const dash = Math.max(len, cat.size > 0 ? 0.5 : 0);
          return (
            <circle
              key={cat.id}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={meta.color}
              strokeWidth={isSel ? stroke + 6 : stroke}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={offset}
              strokeLinecap="round"
              opacity={selectedId && !isSel ? 0.35 : 1}
              style={{ cursor: 'pointer', transition: 'opacity .2s, stroke-width .2s' }}
              onClick={() => onSelect(cat.id)}
            />
          );
        })}
      </g>
    </svg>
  );
}

/**
 * 存储管理：微信风格的占用分析
 * - 环形图可视化 应用本体 / 用户信息 / 缓存 / 模型文件 四类占用
 * - 点击扇区或图例选中分类，下方显示明细
 * - 「前往管理」跳转到对应设置页（跨页跳转）；「打开目录」在文件管理器中打开
 */
export function StoragePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>('app');
  const [cleaning, setCleaning] = useState(false);

  const load = useCallback(async () => {
    if (!isTauriEnv()) {
      setLoading(false);
      return;
    }
    try {
      const raw = await invoke<StorageUsage>('get_storage_usage');
      // 浏览器侧 localStorage（记忆 / RAG 等）体积并入用户信息分类
      const lsBytes = getLocalStorageBytes();
      const user = raw.categories.find((c) => c.id === 'user');
      if (user && lsBytes > 0) {
        user.size += lsBytes;
        user.items = [
          {
            name: t('settings.storage.localstorage_item'),
            path: '(localStorage)',
            size: lsBytes,
            is_dir: false,
          },
          ...user.items,
        ];
      }
      raw.total = raw.categories.reduce((a, c) => a + c.size, 0);
      setUsage(raw);
      setSelectedId('app');
    } catch (err) {
      showToast(t('settings.storage.error') + ': ' + err, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleOpen = async (path: string) => {
    try {
      await invoke('open_path', { path });
    } catch (err) {
      showToast(t('settings.storage.error') + ': ' + err, 'error');
    }
  };

  /** 清理缓存（temp 目录，保留最近 24h 内的文件） */
  const handleCleanupCache = async () => {
    setCleaning(true);
    try {
      if (isTauriEnv()) {
        await invoke('cleanup_temp', { max_age_hours: 24 });
        showToast(t('settings.storage.cleanup_cache_success'), 'success');
      } else {
        showToast(t('settings.storage.cleanup_cache_skip'), 'info');
      }
      await load();
    } catch (err) {
      showToast(t('settings.storage.cleanup_failed', { error: String(err) }), 'error');
    } finally {
      setCleaning(false);
    }
  };

  /** 清理旧备份（localStorage 中 deskpet_backup-* 条目） */
  const handleCleanupBackups = () => {
    setCleaning(true);
    try {
      let cleaned = 0;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('deskpet_backup-')) {
          localStorage.removeItem(key);
          cleaned++;
        }
      }
      showToast(
        t('settings.storage.cleanup_backups_success', { count: String(cleaned) }),
        'success',
      );
      setTimeout(() => load(), 1000);
    } catch (err) {
      showToast(t('settings.storage.cleanup_failed', { error: String(err) }), 'error');
    } finally {
      setCleaning(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center py-12 text-neutral-400 text-sm">
        <Icon icon="solar:restart-bold" className="animate-spin mr-2 text-base" />
        {t('settings.storage.loading')}
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="p-4 flex items-center justify-center py-12 text-neutral-400 text-sm">
        {t('settings.storage.error')}
      </div>
    );
  }

  const total = usage.total;
  const selected = usage.categories.find((c) => c.id === selectedId) || usage.categories[0];
  const meta = CATEGORY_META[selected.id];

  // 无子项时，用分类自身路径作为唯一明细行
  const detailItems: StorageItem[] =
    selected.items.length > 0
      ? selected.items
      : selected.path
        ? [
            {
              name: selected.path.split(/[\\/]/).pop() || selected.path,
              path: selected.path,
              size: selected.size,
              is_dir: true,
            },
          ]
        : [];

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 概览：环形图 + 中心总量 */}
      <Section
        title={t('settings.storage.total_label')}
        description={t('settings.storage.click_hint')}
      >
        <div className="p-4 flex flex-col items-center gap-4">
          <div className="relative">
            <DonutChart
              categories={usage.categories}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xs text-neutral-400">{t('settings.storage.total_label')}</span>
              <span className="text-2xl font-semibold text-neutral-800">{formatBytes(total)}</span>
            </div>
          </div>
        </div>
      </Section>

      {/* 图例列表（可点击选中分类） */}
      <Section title={t('settings.storage.items_title')}>
        <div className="p-2">
          {usage.categories.map((cat) => {
            const m = CATEGORY_META[cat.id];
            const catPct = total > 0 ? ((cat.size / total) * 100).toFixed(1) : '0';
            const isSel = selectedId === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedId(cat.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isSel ? 'bg-neutral-50' : 'hover:bg-neutral-50'
                }`}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: m.color }} />
                <Icon icon={m.icon} className="text-lg text-neutral-500 shrink-0" />
                <span className="flex-1 text-left text-sm text-neutral-700">
                  {t(`settings.storage.cat_${cat.id}`)}
                </span>
                <span className="text-sm font-medium text-neutral-700">
                  {formatBytes(cat.size)}
                </span>
                <span className="text-xs text-neutral-400 w-12 text-right">{catPct}%</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* 选中分类明细 + 管理操作 */}
      <Section
        title={t(`settings.storage.cat_${selected.id}`)}
        description={t(`settings.storage.cat_${selected.id}_desc`)}
      >
        <div className="p-2">
          <div className="px-3 py-2 flex items-center gap-2 text-xs text-neutral-400">
            <Icon icon="solar:folder-path-connect-bold-duotone" className="shrink-0" />
            <span className="font-mono truncate">{selected.path}</span>
          </div>

          <div className="flex flex-col">
            {detailItems.length === 0 && (
              <div className="px-3 py-3 text-sm text-neutral-400">
                {t('settings.storage.empty')}
              </div>
            )}
            {detailItems.map((it) => (
              <div
                key={it.path}
                className="flex items-center gap-3 px-3 py-2.5 border-t border-neutral-100"
              >
                <Icon
                  icon={it.is_dir ? 'solar:folder-bold-duotone' : 'solar:file-bold-duotone'}
                  className="text-base text-neutral-400 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-neutral-700 truncate">{it.name}</div>
                  <div className="text-xs text-neutral-400 font-mono truncate">{it.path}</div>
                </div>
                <span className="text-sm text-neutral-600 shrink-0">{formatBytes(it.size)}</span>
                <button
                  type="button"
                  onClick={() => handleOpen(it.path)}
                  disabled={it.path === '(localStorage)'}
                  title={t('settings.storage.open_dir')}
                  className="ml-1 p-1.5 rounded-lg bg-neutral-100 text-neutral-500 hover:bg-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Icon icon="solar:folder-with-files-bold-duotone" className="text-sm" />
                </button>
              </div>
            ))}
          </div>

          {/* 管理跳转 */}
          <div className="px-3 py-3 flex items-center justify-between gap-3 border-t border-neutral-100">
            <span className="text-xs text-neutral-400 leading-snug">
              {selected.id === 'app' ? t('settings.storage.app_tip') : ''}
            </span>
            <button
              type="button"
              onClick={() => navigate(meta.manageTo)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary-500)] text-white text-xs font-medium hover:bg-[var(--primary-600)] transition-colors shrink-0"
            >
              {t('settings.storage.manage')}
              <Icon icon="solar:alt-arrow-right-line-duotone" className="text-sm" />
            </button>
          </div>
        </div>
      </Section>

      {/* 一键清理 */}
      <Section
        title={t('settings.storage.cleanup_title')}
        description={t('settings.storage.cleanup_desc')}
      >
        <div className="p-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCleanupCache}
            disabled={cleaning}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cleaning ? (
              <Icon icon="solar:restart-bold" className="text-base animate-spin" />
            ) : (
              <Icon icon="solar:broom-bold-duotone" className="text-base" />
            )}
            {t('settings.storage.cleanup_cache')}
          </button>
          <button
            type="button"
            onClick={handleCleanupBackups}
            disabled={cleaning}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cleaning ? (
              <Icon icon="solar:restart-bold" className="text-base animate-spin" />
            ) : (
              <Icon icon="solar:trash-bin-2-bold-duotone" className="text-base" />
            )}
            {t('settings.storage.cleanup_backups')}
          </button>
        </div>
      </Section>
    </div>
  );
}

export default StoragePage;
