import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import {
  Section,
  SettingRow,
  Switch,
  SliderRow,
  ProviderStatusBadge,
  SettingsJumpButton,
  type ProviderTestResult,
} from '../../components';
import { createStorage } from '../../../services/storage';
import { useStorageEvent } from '../../../hooks/useStorageEvent';
import { providerManager } from '../../../services/provider/manager';
import { isVisionModel } from '../../../services/provider/ollama/chat';

/** 多模态配置 */
interface MultimodalConfig {
  /** 总开关 */
  enabled: boolean;
  /** Vision 模型检测模式：auto=自动检测，manual=手动标记 */
  visionDetection: 'auto' | 'manual';
  /** 手动标记当前 LLM 是否为 vision 模型（仅 manual 模式生效） */
  isVisionModel: boolean;
  /** 视觉来源优先级：auto/llm_first/embedding_first/vision_model_first */
  visionSourcePriority: 'auto' | 'llm_first' | 'embedding_first' | 'vision_model_first';
  /** 截图 JPEG 质量 30-90 */
  screenshotQuality: number;
  /** 截图分辨率缩减：1.0=原始，0.75，0.5，0.25 */
  screenshotScale: number;
  /** "一起看"模式自动截屏间隔（秒）10-120 */
  watchInterval: number;
  /** "一起看"系统提示词 */
  watchPrompt: string;
}

const DEFAULT_CONFIG: MultimodalConfig = {
  enabled: true,
  visionDetection: 'auto',
  isVisionModel: false,
  visionSourcePriority: 'auto',
  screenshotQuality: 70,
  screenshotScale: 0.75,
  watchInterval: 30,
  watchPrompt:
    '你是一个正在和我一起刷短视频的桌面宠物伙伴。我刚刚截取了当前屏幕画面。请：\n1. 简要描述你看到的视频内容（不超过 20 字）\n2. 以可爱、活泼的语气发表一句评论（不超过 30 字）\n3. 根据内容选择一个合适的表情标签：[happy, sad, surprised, angry, shy, neutral]\n返回 JSON: { "comment": "...", "expression": "...", "description": "..." }',
};

/** 多模态配置存储（项目目录 data/config/） */
const multimodalStorage = createStorage<MultimodalConfig>('multimodal', DEFAULT_CONFIG, {
  location: 'project',
  subdir: 'config',
});

/** 截图分辨率选项 */
const SCALE_OPTIONS: { value: number; labelKey: string }[] = [
  { value: 1.0, labelKey: 'settings.multimodal.scale_original' },
  { value: 0.75, labelKey: 'settings.multimodal.scale_75' },
  { value: 0.5, labelKey: 'settings.multimodal.scale_50' },
  { value: 0.25, labelKey: 'settings.multimodal.scale_25' },
];

export function MultimodalPage() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<MultimodalConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [isWatching, setIsWatching] = useState(false);
  const [mmStatus, setMmStatus] = useState<ProviderTestResult>({ status: 'idle' });

  // 监听"一起看"模式状态（由主窗口写入 localStorage）
  useStorageEvent(
    'deskpet_watchTogether',
    (newValue) => {
      setIsWatching(newValue === 'true');
    },
    [],
  );

  const loadConfig = useCallback(async () => {
    await multimodalStorage.init();
    setConfig(multimodalStorage.get());
    // 读取初始状态
    try {
      setIsWatching(localStorage.getItem('deskpet_watchTogether') === 'true');
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const updateConfig = (patch: Partial<MultimodalConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    multimodalStorage.set(next);
  };

  /**
   * 校验多模态配置是否自洽、能否启动视觉：
   * - 手动检测模式需开启「当前模型支持视觉」
   * - 自动检测模式需当前激活 LLM 为 vision 模型
   */
  const validateMultimodal = (): ProviderTestResult => {
    if (!config.enabled) return { status: 'idle' };
    const active = providerManager.getActiveChatProvider();
    const model = active?.config.model ?? '';
    const visionOk =
      config.visionDetection === 'manual' ? config.isVisionModel : isVisionModel(model);
    if (!visionOk) {
      return { status: 'error', message: t('settings.multimodal.validation_no_vision') };
    }
    return { status: 'success', message: t('settings.multimodal.validation_ok') };
  };

  const runMultimodalCheck = async () => {
    setMmStatus({ status: 'testing' });
    await providerManager.ready;
    await new Promise((r) => setTimeout(r, 150));
    setMmStatus(validateMultimodal());
  };

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center py-12 text-neutral-400 text-sm">
        <Icon icon="solar:restart-bold" className="animate-spin mr-2 text-base" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 基础配置 */}
      <Section
        title={t('settings.multimodal.basic_title')}
        description={t('settings.multimodal.basic_desc')}
      >
        <div className="p-4">
          <SettingRow
            title={t('settings.multimodal.enable_label')}
            description={t('settings.multimodal.enable_desc')}
          >
            <Switch
              checked={config.enabled}
              onChange={() => updateConfig({ enabled: !config.enabled })}
            />
          </SettingRow>

          <SettingRow
            title={t('settings.multimodal.vision_detection_label')}
            description={t('settings.multimodal.vision_detection_desc')}
          >
            <select
              value={config.visionDetection}
              onChange={(e) =>
                updateConfig({ visionDetection: e.target.value as 'auto' | 'manual' })
              }
              className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-700 focus:outline-none focus:border-[var(--primary-500)]"
            >
              <option value="auto">{t('settings.multimodal.detection_auto')}</option>
              <option value="manual">{t('settings.multimodal.detection_manual')}</option>
            </select>
          </SettingRow>

          {config.visionDetection === 'manual' && (
            <SettingRow
              title={t('settings.multimodal.is_vision_label')}
              description={t('settings.multimodal.is_vision_desc')}
            >
              <Switch
                checked={config.isVisionModel}
                onChange={() => updateConfig({ isVisionModel: !config.isVisionModel })}
              />
            </SettingRow>
          )}

          <SettingRow
            title={t('settings.multimodal.vision_source_priority_label', '视觉来源优先级')}
            description={t(
              'settings.multimodal.vision_source_priority_desc',
              '当模型本身支持多模态时，优先使用哪一个视觉来源',
            )}
          >
            <select
              value={config.visionSourcePriority}
              onChange={(e) =>
                updateConfig({
                  visionSourcePriority: e.target.value as MultimodalConfig['visionSourcePriority'],
                })
              }
              className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-700 focus:outline-none focus:border-[var(--primary-500)]"
            >
              <option value="auto">{t('settings.multimodal.vision_source_auto', '自动')}</option>
              <option value="llm_first">
                {t('settings.multimodal.vision_source_llm_first', '优先 LLM 原生视觉')}
              </option>
              <option value="vision_model_first">
                {t('settings.multimodal.vision_source_vision_model_first', '优先独立视觉模型')}
              </option>
              <option value="embedding_first">
                {t('settings.multimodal.vision_source_embedding_first', '优先 Embedding 描述')}
              </option>
            </select>
          </SettingRow>

          <SettingRow
            title={t('settings.multimodal.check_config')}
            description={t('settings.multimodal.check_desc')}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={runMultimodalCheck}
                disabled={mmStatus.status === 'testing'}
                className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mmStatus.status === 'testing' && (
                  <Icon icon="solar:restart-bold" className="text-sm animate-spin" />
                )}
                {t('settings.multimodal.check_config')}
              </button>
              <ProviderStatusBadge result={mmStatus} />
            </div>
          </SettingRow>
        </div>
      </Section>

      {/* 截图配置 */}
      <Section
        title={t('settings.multimodal.screenshot_title')}
        description={t('settings.multimodal.screenshot_desc')}
      >
        <div className="p-4">
          <SliderRow
            label={t('settings.multimodal.quality_label')}
            desc={t('settings.multimodal.quality_desc')}
            min={30}
            max={90}
            step={5}
            value={config.screenshotQuality}
            onChange={(v) => updateConfig({ screenshotQuality: v })}
            unit="%"
          />

          <SettingRow
            title={t('settings.multimodal.scale_label')}
            description={t('settings.multimodal.scale_desc')}
          >
            <select
              value={config.screenshotScale}
              onChange={(e) => updateConfig({ screenshotScale: Number(e.target.value) })}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-700 focus:outline-none focus:border-[var(--primary-500)]"
            >
              {SCALE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </SettingRow>
        </div>
      </Section>

      {/* 一起看模式 */}
      <Section
        title={t('settings.multimodal.watch_title')}
        description={t('settings.multimodal.watch_desc')}
      >
        <div className="p-4">
          {/* 状态指示器 */}
          <div className="mb-3 p-3 rounded-xl bg-neutral-50 border border-neutral-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${isWatching ? 'bg-green-500 animate-pulse' : 'bg-neutral-300'}`}
              />
              <span className="text-sm font-medium text-neutral-700">
                {isWatching
                  ? t('settings.multimodal.status_watching')
                  : t('settings.multimodal.status_idle')}
              </span>
            </div>
            <span className="text-xs text-neutral-400">
              {t('settings.multimodal.shortcut_hint')}
            </span>
          </div>

          <SliderRow
            label={t('settings.multimodal.interval_label')}
            desc={t('settings.multimodal.interval_desc')}
            min={10}
            max={120}
            step={5}
            value={config.watchInterval}
            onChange={(v) => updateConfig({ watchInterval: v })}
            unit="s"
          />

          <div className="mt-3 p-3 rounded-xl bg-neutral-50 border border-neutral-100">
            <div className="flex items-center gap-2 mb-2">
              <Icon
                icon="solar:document-text-bold-duotone"
                className="text-base text-[var(--primary-500)]"
              />
              <span className="text-sm font-medium text-neutral-700">
                {t('settings.multimodal.prompt_label')}
              </span>
            </div>
            <textarea
              value={config.watchPrompt}
              onChange={(e) => updateConfig({ watchPrompt: e.target.value })}
              rows={8}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-xs text-neutral-700 font-mono resize-y focus:outline-none focus:border-[var(--primary-500)]"
              placeholder={t('settings.multimodal.prompt_placeholder')}
            />
            <div className="text-xs text-neutral-400 mt-1">
              {t('settings.multimodal.prompt_tip')}
            </div>
          </div>
        </div>
      </Section>

      {/* 保存提示 */}
      <div className="mt-4 p-3 rounded-lg bg-neutral-50 border border-neutral-100">
        <div className="flex items-start gap-2">
          <Icon
            icon="solar:info-circle-bold-duotone"
            className="text-base text-neutral-400 shrink-0 mt-0.5"
          />
          <div className="text-xs text-neutral-500 leading-relaxed">
            {t('settings.multimodal.tip')}
          </div>
        </div>

        <Section title={t('settings.related_settings')}>
          <div className="p-4">
            <SettingsJumpButton
              to="/settings/services/llm"
              label={t('settings.services_section.llm')}
              icon="solar:chat-square-code-bold-duotone"
              hint={t('settings.services_section.related_llm_hint')}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

export default MultimodalPage;
