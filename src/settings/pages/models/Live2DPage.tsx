import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, SliderRow, useToast } from '../../components';
import { fetchWithTimeout } from '../../../utils/fetch';

interface ModelInfo {
  id: string;
  name: string;
  model3Json: string;
  configJson: string;
  icon: string;
}

interface ParamConfig {
  scale: number;
  feetOffset: number;
  bubbleHeight: number;
  modelWidthRatio: number;
  idleTimeout: number;
  mouseSensitivity: number;
}

const CURRENT_MODEL_KEY = 'desk-pet-current-model';
const PARAMS_KEY = 'desk-pet-model-params';

const DEFAULT_PARAMS: ParamConfig = {
  scale: 1.0,
  feetOffset: 0,
  bubbleHeight: 70,
  modelWidthRatio: 1.0,
  idleTimeout: 5,
  mouseSensitivity: 1.0,
};

function loadParams(): ParamConfig {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ParamConfig>;
      return { ...DEFAULT_PARAMS, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PARAMS;
}

function saveParams(cfg: ParamConfig) {
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

/**
 * 角色模型 → Live2D：模型切换 + 参数调整（合并页面）。
 * 顶部：已安装模型列表（卡片网格）
 * 底部：模型参数滑块（缩放、偏移、气泡高度、宽度比例）
 */
export function Live2DPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentId, setCurrentId] = useState<string>(() => {
    try {
      return localStorage.getItem(CURRENT_MODEL_KEY) || 'nahida';
    } catch {
      return 'nahida';
    }
  });
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useState<ParamConfig>(() => loadParams());

  useEffect(() => {
    let cancelled = false;
    fetchWithTimeout('/models/index.json', {}, 5000)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.models && Array.isArray(json.models)) {
          setModels(json.models);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setModels([
          {
            id: 'nahida',
            name: '纳西妲',
            model3Json: '/models/nahida/Nahida_1080.model3.json',
            configJson: '/models/nahida/config.json',
            icon: '/models/nahida/icon.jpg',
          },
        ]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = (id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(CURRENT_MODEL_KEY, id);
    } catch {
      /* ignore */
    }
    const model = models.find((m) => m.id === id);
    if (model) {
      showToast(t('settings.live2d.model_switched', { name: model.name }), 'success');
    }
  };

  const updateParam = (patch: Partial<ParamConfig>) => {
    const next = { ...params, ...patch };
    setParams(next);
    saveParams(next);
  };

  return (
    <div className="flex flex-col gap-4 pb-12 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.live2d.installed_models')}
        description={t('settings.live2d.click_to_switch')}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-500">
            <Icon icon="solar:restart-bold" className="text-lg animate-spin" />
            <span>{t('common.loading')}</span>
          </div>
        ) : models.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-500">{t('common.no_data')}</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4">
            {models.map((model) => {
              const active = model.id === currentId;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleSelect(model.id)}
                  className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all ${
                    active
                      ? 'border-neutral-800 bg-neutral-100 shadow-sm'
                      : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50'
                  }`}
                >
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-neutral-100">
                    {model.icon ? (
                      <img
                        src={model.icon}
                        alt={model.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Icon
                        icon="solar:gallery-bold-duotone"
                        className="text-2xl text-neutral-400"
                      />
                    )}
                  </div>
                  <div className="flex w-full items-center justify-center gap-1">
                    <span className="text-sm font-medium text-neutral-800">{model.name}</span>
                    {active && (
                      <Icon
                        icon="solar:check-circle-bold-duotone"
                        className="text-base text-neutral-800"
                      />
                    )}
                  </div>
                  <span className="truncate text-[11px] text-neutral-400">{model.id}</span>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title={t('settings.live2d.size_and_position')}
        description={t('settings.live2d.size_desc')}
      >
        <SliderRow
          label={t('settings.live2d.scale')}
          desc={t('settings.live2d.scale_desc')}
          min={0.5}
          max={2.0}
          step={0.05}
          value={params.scale}
          formatter={(v) => v.toFixed(2)}
          onChange={(v) => updateParam({ scale: v })}
        />
        <SliderRow
          label={t('settings.live2d.feet_offset')}
          desc={t('settings.live2d.feet_offset_desc')}
          unit={t('settings.live2d.pixel_unit')}
          min={0}
          max={300}
          step={1}
          value={params.feetOffset}
          onChange={(v) => updateParam({ feetOffset: v })}
        />
        <SliderRow
          label={t('settings.live2d.bubble_height')}
          desc={t('settings.live2d.bubble_height_desc')}
          unit={t('settings.live2d.pixel_unit')}
          min={60}
          max={150}
          step={1}
          value={params.bubbleHeight}
          onChange={(v) => updateParam({ bubbleHeight: v })}
        />
        <SliderRow
          label={t('settings.live2d.width_ratio')}
          desc={t('settings.live2d.width_ratio_desc')}
          min={0.5}
          max={1.5}
          step={0.05}
          value={params.modelWidthRatio}
          formatter={(v) => v.toFixed(2)}
          onChange={(v) => updateParam({ modelWidthRatio: v })}
        />
      </Section>

      <Section
        title={t('settings.live2d.behavior_params')}
        description={t('settings.live2d.idle_timeout_desc')}
      >
        <SliderRow
          label={t('settings.live2d.idle_timeout')}
          desc={t('settings.live2d.idle_timeout_desc')}
          min={2}
          max={30}
          step={1}
          value={params.idleTimeout}
          formatter={(v) => t('settings.interaction.idle_timeout_seconds', { count: v })}
          onChange={(v) => updateParam({ idleTimeout: v })}
        />
        <SliderRow
          label={t('settings.live2d.mouse_sensitivity')}
          desc={t('settings.live2d.mouse_sensitivity_desc')}
          min={0.1}
          max={3.0}
          step={0.1}
          value={params.mouseSensitivity}
          formatter={(v) => v.toFixed(1)}
          onChange={(v) => updateParam({ mouseSensitivity: v })}
        />
      </Section>
    </div>
  );
}

export default Live2DPage;
