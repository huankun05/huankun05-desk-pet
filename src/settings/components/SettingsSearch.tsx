import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { settingsTree, type SettingsEntry } from '../routes';

interface SearchHit {
  title: string;
  subtitle?: string;
  description?: string;
  icon: string;
  path: string;
  /** 所属一级分组标题（如「外观」「系统」） */
  group: string;
}

/** 将设置树递归扁平化为可搜索条目列表 */
function flatten(entries: SettingsEntry[], group = ''): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const e of entries) {
    hits.push({
      title: e.title,
      subtitle: e.subtitle,
      description: e.description,
      icon: e.icon,
      path: e.path,
      group: group || e.title,
    });
    if (e.children) hits.push(...flatten(e.children, e.title));
  }
  return hits;
}

/**
 * SettingsSearch — 设置页顶部搜索框
 *
 * 数据源为 settingsTree（路由单一真相源），搜索标题/副标题/描述，
 * 下拉结果点击跳转到对应设置页。
 * 支持 ↑↓ 选择、Enter 跳转、Esc / 点击外部关闭。
 */
export function SettingsSearch() {
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const index = useMemo(() => flatten(settingsTree), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return index
      .filter(
        (h) =>
          h.title.toLowerCase().includes(q) ||
          (h.subtitle ?? '').toLowerCase().includes(q) ||
          (h.description ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, index]);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[active].path);
    }
  };

  return (
    <div ref={boxRef} className="relative ml-auto w-96">
      <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 transition-colors focus-within:border-[var(--primary-300)] focus-within:bg-white">
        <Icon icon="solar:magnifer-bold" className="shrink-0 text-base text-neutral-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="搜索设置…"
          className="w-full bg-transparent text-sm text-neutral-700 outline-none placeholder:text-neutral-400"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setActive(0);
              inputRef.current?.focus();
            }}
            className="shrink-0 text-neutral-300 transition-colors hover:text-neutral-500"
            aria-label="清空搜索"
          >
            <Icon icon="solar:close-circle-bold" className="text-base" />
          </button>
        )}
      </div>

      {open && query.trim() && (
        <div className="absolute right-0 top-full z-50 mt-2 w-full overflow-hidden rounded-xl border border-neutral-100 bg-white shadow-lg">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-neutral-400">没有匹配的设置项</div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((h, i) => (
                <li key={h.path}>
                  <button
                    type="button"
                    onClick={() => go(h.path)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                      i === active ? 'bg-[var(--primary-50)]' : ''
                    }`}
                  >
                    <Icon icon={h.icon} className="shrink-0 text-lg text-neutral-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-neutral-800">{h.title}</span>
                      <span className="block truncate text-xs text-neutral-400">
                        {h.subtitle || h.description}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-neutral-300">{h.group}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
