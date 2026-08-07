import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Message } from '../components/Chat/ChatWindow';
import type { ChatMessage } from '../services/ai';
import { personaManager } from '../services/persona';

interface MemoryEntry {
  id: string;
  type: 'conversation' | 'preference' | 'fact';
  content: string;
  timestamp: Date;
  importance: number; // 0-1
}

export interface Rule {
  id: string;
  content: string;
  enabled: boolean;
  createdAt: Date;
}

interface MemoryData {
  conversations: Message[];
  preferences: Record<string, unknown>;
  facts: MemoryEntry[];
  rules: Rule[];
}

const MEMORY_KEY_LEGACY = 'desk_pet_memory';

/** 取当前活跃角色的存储键（角色记忆隔离） */
function getPersonaId(): string {
  try {
    return personaManager.getActiveProfile()?.id ?? 'default';
  } catch {
    return 'default';
  }
}

export function useMemory() {
  const [memory, setMemory] = useState<MemoryData>({
    conversations: [],
    preferences: {},
    facts: [],
    rules: [],
  });

  // 当前活跃角色 id（随角色切换刷新）
  const [personaId, setPersonaId] = useState<string>(() => getPersonaId());

  // 订阅人设切换事件，切换后重新加载对应角色的记忆
  useEffect(() => {
    return personaManager.subscribe(() => setPersonaId(getPersonaId()));
  }, []);

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

  const memoryKey = `desk_pet_memory_${personaId}`;

  // 加载记忆（按角色隔离；首次把旧的全局记忆归入默认角色）
  useEffect(() => {
    try {
      let raw = localStorage.getItem(memoryKey);
      if (!raw) {
        // 迁移：把旧全局键下的记忆并入当前（默认）角色，避免首次切换后记忆"消失"
        if (personaId === 'default') {
          const legacy = localStorage.getItem(MEMORY_KEY_LEGACY);
          if (legacy) {
            localStorage.setItem(memoryKey, legacy);
            raw = legacy;
          }
        }
      }
      if (raw) {
        const parsed = JSON.parse(raw);
        // 恢复 Date 对象
        parsed.conversations = (parsed.conversations || []).map(
          (msg: ChatMessage & { timestamp: string }) => ({
            ...msg,
            timestamp: new Date(msg.timestamp),
          }),
        );
        parsed.facts = (parsed.facts || []).map(
          (fact: Omit<MemoryEntry, 'timestamp'> & { timestamp: string }) => ({
            ...fact,
            timestamp: new Date(fact.timestamp),
          }),
        );
        if (!parsed.preferences) parsed.preferences = {};
        if (!parsed.rules) parsed.rules = [];
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMemory(parsed);
      }
    } catch (e) {
      console.error('Failed to load memory:', e);
    }
  }, [memoryKey, personaId]);

  // 保存记忆
  const saveMemory = useCallback(
    (data: MemoryData) => {
      try {
        localStorage.setItem(memoryKey, JSON.stringify(data));
        // 同步到 Tauri 文件（按角色隔离键）
        invoke('save_data', { key: memoryKey, data: JSON.stringify(data) }).catch(() => {});
      } catch (e) {
        console.error('Failed to save memory:', e);
      }
    },
    [memoryKey],
  );

  // 添加对话消息
  const addConversation = useCallback(
    (message: Message) => {
      setMemory((prev) => {
        const newData = {
          ...prev,
          conversations: [...prev.conversations, message].slice(-100), // 保留最近100条
        };
        saveMemory(newData);
        return newData;
      });
    },
    [saveMemory],
  );

  // 添加事实记忆
  const addFact = useCallback(
    (content: string, importance: number = 0.5) => {
      const entry: MemoryEntry = {
        id: Date.now().toString(),
        type: 'fact',
        content,
        timestamp: new Date(),
        importance,
      };
      setMemory((prev) => {
        const newData = {
          ...prev,
          facts: [...prev.facts, entry].slice(-50), // 保留最近50条事实
        };
        saveMemory(newData);
        return newData;
      });
    },
    [saveMemory],
  );

  // 设置偏好
  const setPreference = useCallback(
    (key: string, value: unknown) => {
      setMemory((prev) => {
        const newData = {
          ...prev,
          preferences: { ...prev.preferences, [key]: value },
        };
        saveMemory(newData);
        return newData;
      });
    },
    [saveMemory],
  );

  // 获取上下文（用于 AI 对话）
  const getContext = useCallback(() => {
    const recentConversations = memory.conversations.slice(-10);
    const importantFacts = memory.facts.filter((f) => f.importance > 0.7).slice(-5);
    const enabledRules = memory.rules.filter((r) => r.enabled);

    let context = '';

    // 规则（最高优先级，放在最前面）
    if (enabledRules.length > 0) {
      context += '[Rules]\n';
      enabledRules.forEach((r) => {
        context += `- ${r.content}\n`;
      });
      context += '\n';
    }

    if (Object.keys(memory.preferences).length > 0) {
      context += '[User Preferences]\n';
      Object.entries(memory.preferences).forEach(([key, value]) => {
        context += `- ${key}: ${JSON.stringify(value)}\n`;
      });
      context += '\n';
    }

    if (importantFacts.length > 0) {
      context += '[Facts to remember]\n';
      importantFacts.forEach((fact) => {
        context += `- ${fact.content}\n`;
      });
      context += '\n';
    }

    if (recentConversations.length > 0) {
      context += '[Recent conversation]\n';
      recentConversations.forEach((msg) => {
        context += `${msg.role}: ${msg.content}\n`;
      });
    }

    return context;
  }, [memory]);

  // 规则管理
  const addRule = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      const rule: Rule = {
        id: Date.now().toString(),
        content: content.trim(),
        enabled: true,
        createdAt: new Date(),
      };
      setMemory((prev) => {
        const newData = { ...prev, rules: [...prev.rules, rule] };
        saveMemory(newData);
        return newData;
      });
    },
    [saveMemory],
  );

  const removeRule = useCallback(
    (ruleId: string) => {
      setMemory((prev) => {
        const newData = { ...prev, rules: prev.rules.filter((r) => r.id !== ruleId) };
        saveMemory(newData);
        return newData;
      });
    },
    [saveMemory],
  );

  const toggleRule = useCallback(
    (ruleId: string) => {
      setMemory((prev) => {
        const newData = {
          ...prev,
          rules: prev.rules.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r)),
        };
        saveMemory(newData);
        return newData;
      });
    },
    [saveMemory],
  );

  // 清空记忆
  const clearMemory = useCallback(() => {
    const emptyMemory: MemoryData = {
      conversations: [],
      preferences: {},
      facts: [],
      rules: [],
    };
    setMemory(emptyMemory);
    saveMemory(emptyMemory);
  }, [saveMemory]);

  // 从管理后台同步（接收完整记忆数据）
  const loadFromServer = useCallback(
    (data: Partial<MemoryData>) => {
      setMemory((prev) => {
        const next = { ...prev, ...data };
        saveMemory(next);
        return next;
      });
    },
    [saveMemory],
  );

  return {
    memory,
    addConversation,
    addFact,
    setPreference,
    getContext,
    addRule,
    removeRule,
    toggleRule,
    clearMemory,
    loadFromServer,
  };
}
