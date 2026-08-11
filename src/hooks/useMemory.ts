import { useState, useEffect, useCallback, useMemo } from 'react';
import { getHermesGatewayClient } from '../services/hermesGateway';
import type { MemoryItem, MemoryCategory } from '../services/hermesGateway';
import { personaManager } from '../services/persona';

/**
 * useMemory —— 记忆 Hook（后端驱动，core.brain 单源）
 *
 * 设计要点：
 *  - 唯一真相源 = Python core.brain（经 Hermes Gateway 的单个 WebSocket）。
 *  - 加载：gateway `listMemories` 优先，本地 localStorage 缓存作为离线兜底。
 *  - 写入：乐观更新本地状态 + 缓存，随后通过 gateway 落库；落库成功用真实条目回填。
 *  - 不再维护 `conversations`，对话由 unified-memory 管线和 core.brain 的语义召回负责。
 *  - 三类展示记忆（fact / preference / rule）全部归一化自同一份 `MemoryItem[]`。
 */

/** 本地缓存键前缀（按角色隔离） */
const MEMORY_CACHE_PREFIX = 'desk_pet_memory_cache_';

function getPersonaId(): string {
  try {
    return personaManager.getActiveProfile()?.id ?? 'default';
  } catch {
    return 'default';
  }
}

/** 稳定的前端引用 id（用于幂等 upsert / 编辑去重） */
function makeClientRef(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadCache(personaId: string): MemoryItem[] {
  try {
    const raw = localStorage.getItem(`${MEMORY_CACHE_PREFIX}${personaId}`);
    if (raw) return JSON.parse(raw) as MemoryItem[];
  } catch {
    /* ignore */
  }
  return [];
}

function saveCache(personaId: string, items: MemoryItem[]): void {
  try {
    localStorage.setItem(`${MEMORY_CACHE_PREFIX}${personaId}`, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

/** 偏好值统一从 meta.value 读取（兼容 meta 为字符串的兜底） */
function readMetaValue(it: MemoryItem): unknown {
  const meta = it.meta;
  if (meta && typeof meta === 'object' && 'value' in meta) {
    return (meta as Record<string, unknown>).value;
  }
  if (typeof meta === 'string') {
    try {
      const parsed = JSON.parse(meta);
      if (parsed && typeof parsed === 'object' && 'value' in parsed) return parsed.value;
    } catch {
      /* ignore */
    }
  }
  return it.content;
}

/** 展示层：事实条目（id 用字符串，兼容页面既有比较逻辑） */
export interface MemoryFactItem {
  id: string;
  content: string;
  importance: number;
  timestamp: string;
  client_ref: string;
}

/** 展示层：规则条目 */
export interface MemoryRuleItem {
  id: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  client_ref: string;
}

/** 展示层：归一化的记忆视图 */
export interface MemoryView {
  facts: MemoryFactItem[];
  preferences: Record<string, unknown>;
  rules: MemoryRuleItem[];
}

export function useMemory() {
  // 首屏直接用当前角色的本地缓存渲染（不依赖 effect 内的同步 setState）
  const [items, setItems] = useState<MemoryItem[]>(() => loadCache(getPersonaId()));
  const [loaded, setLoaded] = useState(false);

  // 当前活跃角色 id（随角色切换刷新）
  const [personaId, setPersonaId] = useState<string>(() => getPersonaId());

  // 订阅人设切换事件
  useEffect(() => personaManager.subscribe(() => setPersonaId(getPersonaId())), []);

  // 人设存储异步初始化完成后，修正为真实的活跃角色（首屏可能读到默认角色）
  useEffect(() => {
    let cancelled = false;
    personaManager.ready.then(() => {
      if (!cancelled) setPersonaId(getPersonaId());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 加载（gateway 优先，本地缓存兜底；所有 setState 均位于异步回调内）
  useEffect(() => {
    let cancelled = false;
    const client = getHermesGatewayClient();
    client.connect();
    client
      .listMemories(personaId, 'default')
      .then((remote) => {
        if (cancelled) return;
        const cached = loadCache(personaId);
        // 远端有数据，或本地无缓存时，以远端为准；否则回退本地缓存
        if (remote.length || !cached.length) {
          setItems(remote);
          saveCache(personaId, remote);
        } else {
          setItems(cached);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // 加载失败（离线/网关未起）则回退本地缓存
        const cached = loadCache(personaId);
        if (cached.length) setItems(cached);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [personaId]);

  /** 用真实/最新条目替换本地状态（按 id 或 client_ref 匹配） */
  const reconcile = useCallback((persona: string, real: MemoryItem) => {
    setItems((prev) => {
      const next = prev.map((it) =>
        it.id === real.id || it.client_ref === real.client_ref ? real : it,
      );
      saveCache(persona, next);
      return next;
    });
  }, []);

  /** 新增一条记忆（乐观更新 + 落库回填） */
  const addMemoryRaw = useCallback(
    (
      content: string,
      category: MemoryCategory,
      opts: {
        importance?: number;
        is_permanent?: boolean;
        meta?: Record<string, unknown>;
        enabled?: boolean;
      } = {},
    ): void => {
      const persona = personaId;
      const client_ref = makeClientRef();
      const now = new Date().toISOString();
      const optimistic: MemoryItem = {
        id: -Date.now(),
        character_id: persona,
        user_id: 'default',
        content,
        category,
        source: 'ui',
        enabled: opts.enabled ?? true,
        meta: opts.meta ?? {},
        client_ref,
        importance: opts.importance ?? 0.5,
        is_permanent: opts.is_permanent ?? category !== 'fact',
        access_count: 0,
        created_at: now,
        updated_at: now,
      };
      setItems((prev) => {
        const next = [...prev, optimistic];
        saveCache(persona, next);
        return next;
      });
      getHermesGatewayClient()
        .addMemory({
          content,
          category,
          character_id: persona,
          user_id: 'default',
          client_ref,
          importance: optimistic.importance,
          is_permanent: optimistic.is_permanent,
          enabled: optimistic.enabled,
          meta: optimistic.meta,
        })
        .then((real) => reconcile(persona, real))
        .catch(() => {
          /* 离线：保留乐观条目，下次同步时由后端合并 */
        });
    },
    [personaId, reconcile],
  );

  /** 按 id 更新（乐观更新 + 落库回填） */
  const updateById = useCallback(
    (
      id: string,
      fields: Partial<
        Pick<
          MemoryItem,
          'content' | 'category' | 'enabled' | 'importance' | 'is_permanent' | 'meta'
        >
      >,
    ): void => {
      const persona = personaId;
      const nid = Number(id);
      const now = new Date().toISOString();
      setItems((prev) => {
        const next = prev.map((it) => (it.id === nid ? { ...it, ...fields, updated_at: now } : it));
        saveCache(persona, next);
        return next;
      });
      getHermesGatewayClient()
        .updateMemory(nid, fields)
        .then((real) => {
          if (real) reconcile(persona, real);
        })
        .catch(() => {
          /* 离线：保留本地修改 */
        });
    },
    [personaId, reconcile],
  );

  /** 按 id 删除（乐观移除） */
  const removeById = useCallback(
    async (id: string): Promise<void> => {
      const persona = personaId;
      const nid = Number(id);
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== nid);
        saveCache(persona, next);
        return next;
      });
      try {
        await getHermesGatewayClient().deleteMemory({ id: nid });
      } catch {
        /* 离线：本地已移除 */
      }
    },
    [personaId],
  );

  // ===== 事实 =====
  const addFact = useCallback(
    (content: string, importance = 0.6) => {
      addMemoryRaw(content, 'fact', { importance, is_permanent: false });
    },
    [addMemoryRaw],
  );

  const updateFact = useCallback(
    (id: string, fields: { content?: string; importance?: number }) => {
      updateById(id, fields);
    },
    [updateById],
  );

  const deleteFact = useCallback(
    async (id: string) => {
      await removeById(id);
    },
    [removeById],
  );

  const adjustImportance = useCallback(
    async (id: string, delta: number) => {
      const nid = Number(id);
      const current = items.find((it) => it.id === nid);
      if (!current) return;
      const importance = Math.max(0, Math.min(1, current.importance + delta));
      await updateFact(id, { importance });
    },
    [items, updateFact],
  );

  // ===== 偏好（键值对，归一到单条 preference 记忆） =====
  const upsertPreference = useCallback(
    (key: string, value: unknown) => {
      const persona = personaId;
      const existing = items.find((it) => it.category === 'preference' && it.content === key);
      if (existing) {
        const base = typeof existing.meta === 'object' && existing.meta ? existing.meta : {};
        const meta = { ...(base as Record<string, unknown>), value };
        setItems((prev) => {
          const next = prev.map((it) => (it.id === existing.id ? { ...it, meta } : it));
          saveCache(persona, next);
          return next;
        });
        getHermesGatewayClient()
          .updateMemory(existing.id, { meta })
          .then((real) => {
            if (real) reconcile(persona, real);
          })
          .catch(() => {
            /* 离线：保留本地修改 */
          });
      } else {
        addMemoryRaw(key, 'preference', { is_permanent: true, meta: { value } });
      }
    },
    [personaId, items, addMemoryRaw, reconcile],
  );

  const setPreference = upsertPreference;
  const updatePreference = upsertPreference;

  const deletePreference = useCallback(
    async (key: string) => {
      const target = items.find((it) => it.category === 'preference' && it.content === key);
      if (!target) return;
      await removeById(String(target.id));
    },
    [items, removeById],
  );

  // ===== 规则 =====
  const addRule = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      addMemoryRaw(content, 'rule', { is_permanent: true, enabled: true });
    },
    [addMemoryRaw],
  );

  const updateRule = useCallback(
    (id: string, fields: { content?: string; enabled?: boolean }) => {
      updateById(id, fields);
    },
    [updateById],
  );

  const toggleRule = useCallback(
    (id: string) => {
      const target = items.find((it) => it.id === Number(id));
      if (!target) return;
      updateRule(id, { enabled: !target.enabled });
    },
    [items, updateRule],
  );

  const removeRule = useCallback(
    async (id: string) => {
      await removeById(id);
    },
    [removeById],
  );

  // ===== 清空当前角色全部记忆 =====
  const clearMemory = useCallback(async () => {
    const persona = personaId;
    const snapshot = items;
    setItems([]);
    saveCache(persona, []);
    const client = getHermesGatewayClient();
    await Promise.all(snapshot.map((it) => client.deleteMemory({ id: it.id }).catch(() => {})));
  }, [personaId, items]);

  // ===== 归一化展示视图 =====
  const memory = useMemo<MemoryView>(() => {
    const facts: MemoryFactItem[] = [];
    const rules: MemoryRuleItem[] = [];
    const preferences: Record<string, unknown> = {};
    for (const it of items) {
      if (it.category === 'fact') {
        facts.push({
          id: String(it.id),
          content: it.content,
          importance: it.importance,
          timestamp: it.created_at,
          client_ref: it.client_ref,
        });
      } else if (it.category === 'rule') {
        rules.push({
          id: String(it.id),
          content: it.content,
          enabled: it.enabled,
          createdAt: it.created_at,
          client_ref: it.client_ref,
        });
      } else if (it.category === 'preference') {
        if (it.content) preferences[it.content] = readMetaValue(it);
      }
    }
    return { facts, preferences, rules };
  }, [items]);

  return {
    memory,
    loaded,
    addFact,
    updateFact,
    deleteFact,
    adjustImportance,
    setPreference,
    updatePreference,
    deletePreference,
    addRule,
    updateRule,
    toggleRule,
    removeRule,
    clearMemory,
  };
}
