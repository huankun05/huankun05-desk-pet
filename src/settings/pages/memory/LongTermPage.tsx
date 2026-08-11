import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { Section, SettingRow, Switch, useToast, useConfirm } from '../../components';
import { isRAGEnabled, setRAGEnabled } from '../../../services/pipeline/stages/rag';
import { getRAGEngine } from '../../../services/rag/engine';
import {
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from '../../../services/provider/embedding';
import { providerManager } from '../../../services/provider/manager';
import { isOfflineModeEnabled } from '../../../services/provider/watchdog';
import type { LLMCall } from '../../../services/memory/llm-enhancer';

/**
 * 长期记忆设置页
 *
 * 汇集跨会话记忆的三块能力：
 * 1. 本地长期记忆（RAG）开关 / 条目数 / 清空
 * 2. LLM 增强记忆抽取（默认关闭）
 * 3. 混合检索（BM25 + Embedding）
 *
 * 与「上下文管理」页（/settings/memory/context）相互独立：
 * 上下文只决定当前对话窗口，本页决定跨会话记住什么、怎么找回来。
 */

// ===== 混合检索配置 =====

interface HybridRAGConfig {
  enabled: boolean;
  bm25Weight: number;
  embeddingWeight: number;
  providerType: 'ollama' | 'openai';
  ollamaHost: string;
  ollamaModel: string;
  openaiApiBase: string;
  openaiApiKey: string;
  openaiModel: string;
}

const HYBRID_RAG_KEY = 'deskpet_hybrid_rag';

const DEFAULT_HYBRID_RAG: HybridRAGConfig = {
  enabled: false,
  bm25Weight: 0.5,
  embeddingWeight: 0.5,
  providerType: 'ollama',
  ollamaHost: 'http://localhost:11434',
  ollamaModel: 'nomic-embed-text',
  openaiApiBase: 'https://api.openai.com/v1',
  openaiApiKey: '',
  openaiModel: 'text-embedding-3-small',
};

function loadHybridRAG(): HybridRAGConfig {
  try {
    const raw = localStorage.getItem(HYBRID_RAG_KEY);
    if (raw) {
      return { ...DEFAULT_HYBRID_RAG, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_HYBRID_RAG };
}

function saveHybridRAG(config: HybridRAGConfig) {
  localStorage.setItem(HYBRID_RAG_KEY, JSON.stringify(config));
}

// ===== LLM 增强记忆抽取配置（默认关闭） =====

interface MemoryExtractConfig {
  llmEnhancementEnabled: boolean;
}

const MEMORY_EXTRACT_KEY = 'deskpet_memory_extract';

const DEFAULT_MEMORY_EXTRACT: MemoryExtractConfig = {
  llmEnhancementEnabled: false,
};

function loadMemoryExtract(): MemoryExtractConfig {
  try {
    const raw = localStorage.getItem(MEMORY_EXTRACT_KEY);
    if (raw) return { ...DEFAULT_MEMORY_EXTRACT, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_MEMORY_EXTRACT };
}

function saveMemoryExtract(config: MemoryExtractConfig): void {
  localStorage.setItem(MEMORY_EXTRACT_KEY, JSON.stringify(config));
}

export function LongTermPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [ragEnabled, setRagState] = useState<boolean>(() => isRAGEnabled());
  const [ragDocCount, setRagDocCount] = useState<number>(0);
  const [hybrid, setHybrid] = useState<HybridRAGConfig>(() => loadHybridRAG());
  const [memExtract, setMemExtract] = useState<MemoryExtractConfig>(() => loadMemoryExtract());

  // 读取已记忆条目数（延迟到 engine 初始化后）
  const refreshDocCount = useCallback(() => {
    try {
      setRagDocCount(getRAGEngine().size);
    } catch {
      /* 纯设置窗口环境可能未初始化 engine */
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(refreshDocCount, 150);
    return () => clearTimeout(timer);
  }, [refreshDocCount]);

  // 将混合检索配置同步到 RAG engine
  useEffect(() => {
    try {
      const engine = getRAGEngine();
      engine.setEmbeddingProvider(
        hybrid.enabled
          ? hybrid.providerType === 'ollama'
            ? new OllamaEmbeddingProvider({
                id: 'ollama-embedding',
                type: 'embedding',
                name: 'Ollama Embedding',
                enable: true,
                apiBase: hybrid.ollamaHost,
                model: hybrid.ollamaModel,
              })
            : new OpenAIEmbeddingProvider({
                id: 'openai-embedding',
                type: 'embedding',
                name: 'OpenAI Embedding',
                enable: true,
                apiBase: hybrid.openaiApiBase,
                apiKey: hybrid.openaiApiKey,
                model: hybrid.openaiModel,
              })
          : null,
      );
      engine.setConfig({
        hybridEnabled: hybrid.enabled,
        hybridBm25Weight: hybrid.bm25Weight,
        hybridEmbeddingWeight: hybrid.embeddingWeight,
      });
    } catch {
      /* settings page env may lack full init; ignore */
    }
  }, [hybrid]);

  // 将 LLM 增强记忆抽取配置同步到 RAG engine
  useEffect(() => {
    try {
      const engine = getRAGEngine();
      engine.setConfig({ llmEnhancementEnabled: memExtract.llmEnhancementEnabled });
      const llmChat: LLMCall = async (prompt: string) => {
        if (isOfflineModeEnabled()) throw new Error('离线模式已开启');
        const provider = providerManager.getActiveChatProvider();
        if (!provider) throw new Error('未配置对话模型');
        return provider.chat(
          [
            { role: 'system', content: '你是桌面宠物助手的长期记忆抽取器，只输出 JSON 数组。' },
            { role: 'user', content: prompt },
          ],
          { temperature: 0.2, maxTokens: 800 },
        );
      };
      engine.setLLMEnhancer(memExtract.llmEnhancementEnabled ? llmChat : null);
    } catch {
      /* settings page env may lack full init; ignore */
    }
  }, [memExtract]);

  // Embedding 配置摘要（用于展示）
  const embeddingSummary = hybrid.enabled
    ? hybrid.providerType === 'ollama'
      ? `${hybrid.ollamaHost}/${hybrid.ollamaModel}`
      : `${hybrid.openaiApiBase}/${hybrid.openaiModel}`
    : t('settings.memory.rag_embedding_disabled');

  const handleToggleRAG = useCallback(() => {
    const next = !ragEnabled;
    setRAGEnabled(next);
    setRagState(next);
    showToast(t('settings.preferences.saved'), 'success');
  }, [ragEnabled, showToast, t]);

  const handleWipeRAG = useCallback(async () => {
    const ok = await confirm({
      title: t('settings.memory.rag_wipe_title'),
      message: t('settings.memory.rag_wipe_desc'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    getRAGEngine().wipeAll();
    setRagDocCount(0);
    showToast(t('settings.memory.rag_wiped'), 'success');
  }, [confirm, showToast, t]);

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 本地长期记忆 */}
      <Section
        title={t('settings.memory.rag_section_title')}
        description={t('settings.memory.rag_section_desc')}
      >
        <div className="p-4 space-y-3">
          <SettingRow
            title={t('settings.memory.rag_enable')}
            description={t('settings.memory.rag_enable_desc')}
          >
            <Switch checked={ragEnabled} onClick={handleToggleRAG} />
          </SettingRow>

          <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <Icon icon="solar:book-bold" className="text-base text-neutral-400 shrink-0" />
              <span className="text-sm text-neutral-700">{t('settings.memory.rag_doc_count')}</span>
              <span className="text-sm font-medium text-neutral-800">{ragDocCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleWipeRAG}
                className="shrink-0 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-red-50 hover:border-red-200 hover:text-red-500"
              >
                {t('settings.memory.rag_wipe')}
              </button>
            </div>
          </div>

          <p className="text-xs text-neutral-400 pt-1">{t('settings.memory.rag_hint')}</p>
        </div>
      </Section>

      {/* LLM 增强记忆抽取 */}
      <Section
        title={t('settings.memory.llm_extract_title')}
        description={t('settings.memory.llm_extract_desc')}
      >
        <div className="p-4 space-y-3">
          <SettingRow
            title={t('settings.memory.llm_extract_enable')}
            description={t('settings.memory.llm_extract_enable_desc')}
          >
            <Switch
              checked={memExtract.llmEnhancementEnabled}
              onClick={() => {
                const next = {
                  ...memExtract,
                  llmEnhancementEnabled: !memExtract.llmEnhancementEnabled,
                };
                setMemExtract(next);
                saveMemoryExtract(next);
              }}
            />
          </SettingRow>
          {memExtract.llmEnhancementEnabled && (
            <p className="text-xs text-neutral-400 pt-1">{t('settings.memory.llm_extract_hint')}</p>
          )}
        </div>
      </Section>

      {/* 混合检索 */}
      <Section
        title={t('settings.memory.hybrid_title')}
        description={t('settings.memory.hybrid_desc')}
      >
        <div className="p-4 space-y-3">
          <SettingRow
            title={t('settings.memory.hybrid_enable')}
            description={t('settings.memory.hybrid_enable_desc')}
          >
            <Switch
              checked={hybrid.enabled}
              onClick={() =>
                setHybrid((prev) => {
                  const nextConfig = { ...prev, enabled: !prev.enabled };
                  saveHybridRAG(nextConfig);
                  return nextConfig;
                })
              }
            />
          </SettingRow>

          {hybrid.enabled && (
            <>
              <div className="rounded-lg border border-neutral-200 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon
                      icon="solar:database-bold-duotone"
                      className="text-base text-neutral-400 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-neutral-700">
                        {t('settings.memory.hybrid_embedding_source')}
                      </p>
                      <p className="text-xs text-neutral-500 truncate">{embeddingSummary}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/settings/services/embedding')}
                    className="shrink-0 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
                  >
                    {t('settings.memory.hybrid_goto_services')}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-neutral-200 bg-white p-3">
                <p className="text-xs font-medium text-neutral-700 mb-2">
                  {t('settings.memory.hybrid_bm25_weight')}
                </p>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={hybrid.bm25Weight}
                  onChange={(e) =>
                    setHybrid((prev) => {
                      const nextConfig = { ...prev, bm25Weight: Number(e.target.value) };
                      saveHybridRAG(nextConfig);
                      return nextConfig;
                    })
                  }
                  className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-700"
                />
                <p className="text-[10px] text-neutral-400 mt-1">
                  {t('settings.memory.hybrid_vector_weight_hint', {
                    percent: ((1 - hybrid.bm25Weight) * 100).toFixed(0),
                  })}
                </p>
              </div>

              <p className="text-xs text-neutral-400 pt-1">{t('settings.memory.hybrid_hint')}</p>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}

export default LongTermPage;
