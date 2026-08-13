import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import {
  Section,
  useToast,
  useConfirm,
  useReorder,
  ProviderStatusBadge,
  SettingsJumpButton,
} from '../../components';
import { invoke } from '@tauri-apps/api/core';
import { providerManager } from '../../../services/provider/manager';
import { providerRegistry } from '../../../services/provider/registry';
import { isTauriEnv } from '../../../utils/tauriEnv';
import type { TTSProviderConfig, ProviderMeta } from '../../../services/provider/types';
import { ServiceSetupGuide, type SetupEngineInfo } from '../../components/ServiceSetupGuide';
import { ServiceWizard } from '../../components/ServiceWizard';
import { validateProviderConfig } from '../../../services/provider/validateProvider';
import { startTTSBackend } from '../../../services/provider/serviceLauncher';

/** 各 TTS 引擎的本地权重目录（相对于应用根目录，打包后为 resources）。
 *  用户可在配置页一键打开该目录放入/查看模型权重。 */
const WEIGHTS_DIRS: Record<string, string> = {
  gpt_sovits: 'server/gpt_sovits/GPT_SoVITS/pretrained_models',
};

/** 需要本地模型权重的 TTS 引擎（决定指引面板显示「需权重」标签）*/
const LOCAL_TTS_ENGINES = new Set(['gpt_sovits', 'cosyvoice', 'piper']);

/** 各 TTS 引擎的默认 API 地址（向导自动填入，用户可改）*/
const DEFAULT_ENDPOINTS: Record<string, string> = {
  edge_tts: '',
  gpt_sovits: 'http://localhost:9880',
  cosyvoice: 'http://localhost:8003',
  piper: 'http://localhost:5000',
};

type FormShape = Omit<TTSProviderConfig, 'id' | 'type'>;

const defaultForm: FormShape = {
  name: '',
  enable: true,
  typeName: 'edge_tts',
  apiBase: '',
  voice: '',
  speed: 1.0,
  sampleRate: 22050,
};

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
interface TestResult {
  status: TestStatus;
  message?: string;
}

export function TTSPage() {
  const [configs, setConfigs] = useState<TTSProviderConfig[]>(
    () => providerManager.listProviders('tts') as TTSProviderConfig[],
  );
  const [activeId, setActiveId] = useState<string | null>(() => {
    const active = providerManager.getActiveTTSProvider();
    return active ? active.config.id : null;
  });
  const [showModal, setShowModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<TTSProviderConfig | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [ttsTypes] = useState<ProviderMeta[]>(() => providerRegistry.getRegisteredTypes('tts'));
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const ttsEngines: SetupEngineInfo[] = ttsTypes.map((m) => ({
    typeName: m.typeName,
    displayName: m.displayName,
    needsWeights: LOCAL_TTS_ENGINES.has(m.typeName),
    weightsDir: WEIGHTS_DIRS[m.typeName],
  }));

  const loadConfigs = () => {
    const all = providerManager.listProviders('tts') as TTSProviderConfig[];
    setConfigs(all);
    const active = providerManager.getActiveTTSProvider();
    if (active) setActiveId(active.config.id);
  };

  const { handlePointerDown, draggingId, dragPos, dragSize, visualItems, containerRef } =
    useReorder(configs, {
      onReorder: (orderedIds) => {
        providerManager.reorderProviders('tts', orderedIds);
        loadConfigs();
      },
      onSelect: (id) => handleSetActive(id),
    });

  const draggingConfig = configs.find((c) => c.id === draggingId);

  const openAddModal = () => {
    setEditingConfig(null);
    setShowModal(true);
  };

  const openEditModal = (config: TTSProviderConfig) => {
    setEditingConfig(config);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingConfig(null);
  };

  /** 向导「保存」：新增或更新 provider；返回 true 表示成功 */
  const wizardSave = (cfg: FormShape, editingId: string | null): boolean => {
    if (editingId) {
      providerManager.updateProvider(editingId, cfg as Partial<TTSProviderConfig>);
    } else {
      const newConfig: TTSProviderConfig = {
        ...cfg,
        id: `tts-${crypto.randomUUID()}`,
        type: 'tts',
      } as TTSProviderConfig;
      const ok = providerManager.addProvider(newConfig);
      if (!ok) {
        showToast(t('settings.services.add_failed'), 'error');
        return false;
      }
    }
    loadConfigs();
    showToast(t('settings.services.saved'), 'success');
    return true;
  };

  /** 向导「新增成功」后：自动拉起对应后端，实现“选好权重就能直接运行” */
  const wizardOnAdded = (cfg: FormShape) => {
    const tn = (cfg.typeName as string) || '';
    void startTTSBackend(tn).then((ok) => {
      if (ok) showToast(t('settings.services.backend_started'), 'success');
      else showToast(t('settings.services.backend_start_failed'), 'info');
    });
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm(t('settings.services.confirm_delete')))) return;
    providerManager.removeProvider(id);
    loadConfigs();
    showToast(t('settings.services.deleted'), 'success');
  };

  const handleSetActive = (id: string) => {
    const config = configs.find((c) => c.id === id);
    if (config && !config.enable) {
      providerManager.updateProvider(id, { enable: true });
    }
    providerManager.setActiveTTSProvider(id);
    setActiveId(id);
    showToast(t('settings.services.activated'), 'success');
    if (config) runValidation(config, { toast: false });
  };

  /**
   * 检测某个 provider 配置是否可用（卡片状态 + 手动测试按钮共用）。
   */
  const runValidation = async (
    config: TTSProviderConfig,
    opts: { toast?: boolean; key?: string } = {},
  ) => {
    const id = opts.key ?? config.id;
    setTestingId(config.id);
    setTestResults((prev) => ({ ...prev, [id]: { status: 'testing' } }));
    try {
      const tempId = `temp-test-${crypto.randomUUID()}`;
      const testConfig: TTSProviderConfig = { ...config, id: tempId, enable: true };
      const provider = providerRegistry.createTTSProvider(config.typeName, testConfig);
      if (!provider) throw new Error(t('settings.services.provider_create_failed'));
      await provider.validate();
      const msg = t('settings.services.connection_success');
      setTestResults((prev) => ({ ...prev, [id]: { status: 'success', message: msg } }));
      if (opts.toast) showToast(t('settings.services.test_success'), 'success');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const msg = t('settings.services.connection_failed_detail', { error: errorMsg });
      setTestResults((prev) => ({ ...prev, [id]: { status: 'error', message: msg } }));
      if (opts.toast) showToast(t('settings.services.test_failed', { error: errorMsg }), 'error');
    } finally {
      setTestingId((cur) => (cur === config.id ? null : cur));
    }
  };

  /** 卡片上的「打开权重文件夹」按钮 */
  const openWeightsFolder = async (typeName: string) => {
    const subdir = WEIGHTS_DIRS[typeName];
    if (!subdir) {
      showToast(t('settings.services.no_local_weights_dir'), 'info');
      return;
    }
    if (!isTauriEnv()) {
      showToast(t('settings.services.open_folder_desktop_only'), 'info');
      return;
    }
    try {
      await invoke('open_server_dir', { subdir });
    } catch (err) {
      showToast(t('settings.services.open_folder_failed', { error: String(err) }), 'error');
    }
  };

  const getTypeNameDisplay = (typeName: string) => {
    const meta = ttsTypes.find((x) => x.typeName === typeName);
    return meta?.displayName || typeName;
  };

  const renderCardContent = (config: TTSProviderConfig) => (
    <div className="flex items-start justify-between">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div
          className={`mt-2.5 flex h-10 w-5 shrink-0 items-center justify-center text-neutral-300 transition-opacity ${
            draggingId === config.id ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Icon icon="solar:list-bold-duotone" className="text-lg" />
        </div>
        <div
          className={`mt-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            activeId === config.id
              ? 'border-[var(--primary-500)] bg-[var(--primary-500)]'
              : 'border-neutral-300 bg-white'
          }`}
        >
          {activeId === config.id && <div className="h-2 w-2 rounded-full bg-white" />}
        </div>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            activeId === config.id
              ? 'bg-[var(--primary-500)] text-white'
              : 'bg-neutral-100 text-neutral-500'
          }`}
        >
          <Icon icon="solar:speaker-bold-duotone" className="text-xl" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-neutral-800 truncate">{config.name}</span>
            {activeId === config.id && (
              <span className="shrink-0 rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary-600)]">
                {t('settings.services.active_label')}
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-400 mt-0.5">
            {getTypeNameDisplay(config.typeName)}
          </div>
          <ProviderStatusBadge result={testResults[config.id]} />
          <div className="text-xs text-neutral-400 mt-1 truncate">
            {config.voice || t('settings.services.default_voice')}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 ml-3 shrink-0">
        {WEIGHTS_DIRS[config.typeName] && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openWeightsFolder(config.typeName);
            }}
            className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
            title={t('settings.services.open_weights_folder')}
          >
            <Icon icon="solar:folder-with-files-bold" className="text-base" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            runValidation(config, { toast: true });
          }}
          disabled={testingId === config.id}
          className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
          title={t('settings.test_connection')}
        >
          <Icon
            icon={testingId === config.id ? 'solar:restart-bold' : 'solar:refresh-circle-bold'}
            className={`text-base ${testingId === config.id ? 'animate-spin' : ''}`}
          />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openEditModal(config);
          }}
          className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
          title={t('common.edit')}
        >
          <Icon icon="solar:pen-bold" className="text-base" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(config.id);
          }}
          className="p-2 rounded-lg text-neutral-500 hover:bg-red-50 hover:text-red-500 transition-colors"
          title={t('common.delete')}
        >
          <Icon icon="solar:trash-bin-trash-bold" className="text-base" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.services.tts_section_title')}
        description={t('settings.services.tts_section_desc')}
      >
        <div className="p-4">
          {visualItems.length === 0 ? (
            <ServiceSetupGuide
              title={t('settings.services.setup_guide_title')}
              intro={t('settings.services.setup_guide_intro')}
              engines={ttsEngines}
              onAdd={openAddModal}
              onOpenWeights={openWeightsFolder}
            />
          ) : (
            <>
              <div className="grid gap-3" ref={containerRef}>
                {visualItems.map((config) => {
                  const isDragging = draggingId === config.id;
                  if (isDragging) {
                    return (
                      <div
                        key={config.id}
                        data-reorder-item={config.id}
                        className="rounded-xl border-2 border-dashed border-[var(--primary-300)] bg-[var(--primary-50)]/40 transition-all"
                        style={{ height: dragSize.height || 'auto' }}
                      />
                    );
                  }
                  return (
                    <div
                      key={config.id}
                      data-reorder-item={config.id}
                      onPointerDown={handlePointerDown(config.id)}
                      className={`relative p-4 rounded-xl border-2 select-none transition-all duration-200 cursor-pointer ${
                        activeId === config.id
                          ? 'border-[var(--primary-500)] bg-[var(--primary-50)]/50'
                          : 'border-neutral-200 bg-white hover:border-neutral-300'
                      }`}
                    >
                      {renderCardContent(config)}
                    </div>
                  );
                })}
                {draggingConfig && (
                  <div
                    className="fixed p-4 rounded-xl border-2 border-[var(--primary-500)] bg-white opacity-90 scale-[1.02] shadow-xl z-50 pointer-events-none select-none cursor-grabbing"
                    style={{ left: dragPos.x, top: dragPos.y, width: dragSize.width }}
                  >
                    {renderCardContent(draggingConfig)}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={openAddModal}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 py-3 text-sm font-medium text-neutral-500 hover:border-[var(--primary-300)] hover:text-[var(--primary-500)] hover:bg-[var(--primary-50)]/50 transition-colors"
              >
                <Icon icon="solar:add-circle-bold" className="text-base" />
                {t('settings.services.add_provider')}
              </button>
            </>
          )}
        </div>
      </Section>

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

      <ServiceWizard<FormShape>
        open={showModal}
        onClose={closeModal}
        addTitle={t('settings.services.add_provider')}
        editTitle={t('settings.services.edit_provider')}
        guideTitle={t('settings.services.setup_guide_title')}
        guideIntro={t('settings.services.setup_guide_intro')}
        engines={ttsEngines}
        engineReqKey={(tn) => `settings.services.engine_req_${tn}`}
        types={ttsTypes}
        defaultForm={defaultForm}
        defaultEndpoints={DEFAULT_ENDPOINTS}
        localEngines={[...LOCAL_TTS_ENGINES]}
        weightsDirs={WEIGHTS_DIRS}
        validate={(cfg) => validateProviderConfig('tts', cfg as TTSProviderConfig)}
        save={wizardSave}
        onAdded={wizardOnAdded}
        editingConfig={editingConfig}
        idPrefix="tts"
        typeValue="tts"
        extraFields={(form, patch) => (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                {t('settings.services.voice_name')}
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]"
                value={(form.voice as string) ?? ''}
                onChange={(e) => patch({ voice: e.target.value } as Partial<FormShape>)}
                placeholder={t('settings.services.default_voice')}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                  {t('settings.services.speech_rate')}
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="2"
                  className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]"
                  value={(form.speed as number) ?? 1.0}
                  onChange={(e) => patch({ speed: parseFloat(e.target.value) } as Partial<FormShape>)}
                  placeholder="1.0"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                  {t('settings.services.sample_rate')}
                </label>
                <input
                  type="number"
                  className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]"
                  value={(form.sampleRate as number) ?? 22050}
                  onChange={(e) =>
                    patch({ sampleRate: parseInt(e.target.value) } as Partial<FormShape>)
                  }
                  placeholder="22050"
                />
              </div>
            </div>
          </>
        )}
      />
    </div>
  );
}

export default TTSPage;
