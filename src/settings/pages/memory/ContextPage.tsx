import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow, Switch, SliderRow, useToast } from '../../components';

/**
 * 上下文管理设置页
 *
 * 管理「短期记忆」——即单次对话窗口能记住多少内容：
 * 压缩开关、token 上限、压缩触发阈值、最大保留轮次。
 *
 * 与「长期记忆」页（/settings/memory/long-term）相互独立：
 * 本页控制送进模型的对话窗口，长期记忆页控制跨会话的记忆检索与抽取。
 */

interface ContextConfig {
  compressionEnabled: boolean;
  maxContextTokens: number;
  compressionThreshold: number;
  enforceMaxTurns: number;
}

const CONTEXT_CONFIG_KEY = 'deskpet_contextConfig';

const DEFAULT_CONTEXT: ContextConfig = {
  compressionEnabled: true,
  maxContextTokens: 8000,
  compressionThreshold: 85,
  enforceMaxTurns: 30,
};

function loadContextConfig(): ContextConfig {
  try {
    const raw = localStorage.getItem(CONTEXT_CONFIG_KEY);
    if (raw) {
      return { ...DEFAULT_CONTEXT, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONTEXT };
}

function saveContextConfig(config: ContextConfig) {
  localStorage.setItem(CONTEXT_CONFIG_KEY, JSON.stringify(config));
}

export function ContextPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [ctxConfig, setCtxConfig] = useState<ContextConfig>(() => loadContextConfig());

  // 跨窗口同步（主窗口修改时设置窗口跟随刷新）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONTEXT_CONFIG_KEY) {
        setCtxConfig(loadContextConfig());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updateCtx = useCallback((patch: Partial<ContextConfig>) => {
    setCtxConfig((prev) => {
      const next = { ...prev, ...patch };
      saveContextConfig(next);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setCtxConfig({ ...DEFAULT_CONTEXT });
    saveContextConfig({ ...DEFAULT_CONTEXT });
    showToast(t('settings.preferences.saved'), 'success');
  }, [showToast, t]);

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.memory.context_section_title')}
        description={t('settings.memory.context_section_desc')}
      >
        <div className="p-4 space-y-1">
          <SettingRow
            title={t('settings.memory.context_compression')}
            description={t('settings.memory.context_compression_desc')}
          >
            <Switch
              checked={ctxConfig.compressionEnabled}
              onClick={() => updateCtx({ compressionEnabled: !ctxConfig.compressionEnabled })}
            />
          </SettingRow>
        </div>
        <SliderRow
          label={t('settings.memory.context_max_tokens')}
          value={ctxConfig.maxContextTokens}
          min={2000}
          max={32000}
          step={1000}
          unit={t('settings.memory.context_tokens_unit')}
          desc={t('settings.memory.context_max_tokens_desc')}
          onChange={(v) => updateCtx({ maxContextTokens: v })}
        />
        <SliderRow
          label={t('settings.memory.context_threshold')}
          value={ctxConfig.compressionThreshold}
          min={50}
          max={95}
          step={1}
          unit="%"
          desc={t('settings.memory.context_threshold_desc')}
          onChange={(v) => updateCtx({ compressionThreshold: v })}
        />
        <SliderRow
          label={t('settings.memory.context_max_turns')}
          value={ctxConfig.enforceMaxTurns}
          min={0}
          max={50}
          step={1}
          unit={t('settings.memory.context_turns_unit')}
          desc={t('settings.memory.context_max_turns_desc')}
          onChange={(v) => updateCtx({ enforceMaxTurns: v })}
        />
        <div className="px-4 pb-4">
          <p className="text-xs text-neutral-400">{t('settings.memory.context_hint')}</p>
        </div>
      </Section>

      <div className="flex justify-center mt-4">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
        >
          {t('settings.memory.context_reset')}
        </button>
      </div>
    </div>
  );
}

export default ContextPage;
