import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, useToast, useConfirm, ProviderStatusBadge } from '../../components';
import { providerManager } from '../../../services/provider/manager';
import {
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from '../../../services/provider/embedding';
import type { EmbeddingProviderConfig } from '../../../services/provider/types';
import { ServiceSetupGuide, type SetupEngineInfo } from '../../components/ServiceSetupGuide';
import { ServiceWizard } from '../../components/ServiceWizard';

type FormShape = Omit<EmbeddingProviderConfig, 'id' | 'type'>;

const defaultForm: FormShape = {
  name: '',
  enable: true,
  apiBase: 'http://localhost:11434',
  model: 'nomic-embed-text',
};

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
interface TestResult {
  status: TestStatus;
  message?: string;
}

export function EmbeddingPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [configs, setConfigs] = useState<EmbeddingProviderConfig[]>(
    () => providerManager.listProviders('embedding') as EmbeddingProviderConfig[],
  );
  const [activeId, setActiveId] = useState<string | null>(() => {
    const all = providerManager.listProviders('embedding') as EmbeddingProviderConfig[];
    const first = all.find((c) => c.enable);
    return first?.id ?? null;
  });
  const [showModal, setShowModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<EmbeddingProviderConfig | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const embeddingEngines: SetupEngineInfo[] = [
    { typeName: 'embedding', displayName: t('settings.services.embedding'), needsWeights: false },
  ];

  const loadConfigs = () => {
    const all = providerManager.listProviders('embedding') as EmbeddingProviderConfig[];
    setConfigs(all);
    setActiveId((prev) => {
      if (prev && all.some((c) => c.id === prev && c.enable)) return prev;
      const first = all.find((c) => c.enable);
      return first?.id ?? null;
    });
  };

  const openAddModal = () => {
    setEditingConfig(null);
    setShowModal(true);
  };
  const openEditModal = (config: EmbeddingProviderConfig) => {
    setEditingConfig(config);
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setEditingConfig(null);
  };

  const wizardSave = (cfg: FormShape, editingId: string | null): boolean => {
    if (editingId) {
      providerManager.updateProvider(editingId, cfg as Partial<EmbeddingProviderConfig>);
    } else {
      const newConfig: EmbeddingProviderConfig = {
        ...cfg,
        id: `embedding-${crypto.randomUUID()}`,
        type: 'embedding',
      } as EmbeddingProviderConfig;
      const ok = providerManager.addProvider(newConfig);
      if (!ok) {
        showToast(t('settings.services.add_failed'), 'error');
        return false;
      }
      setActiveId(newConfig.id);
    }
    loadConfigs();
    showToast(t('settings.services.saved'), 'success');
    return true;
  };

  /** Embedding 校验：按 apiBase 在 Ollama / OpenAI 之间二选一（不走注册表） */
  const validateEmbedding = async (cfg: EmbeddingProviderConfig): Promise<void> => {
    await providerManager.ready;
    const base = (cfg.apiBase || '').replace(/\/+$/, '');
    const model = cfg.model || 'nomic-embed-text';
    const provider =
      base.includes('localhost') || base.includes('127.0.0.1') || base.includes('11434')
        ? new OllamaEmbeddingProvider({ ...cfg, apiBase: base, model })
        : new OpenAIEmbeddingProvider({ ...cfg, apiBase: base, model });
    await provider.validate();
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
    setActiveId(id);
    showToast(t('settings.services.activated'), 'success');
  };

  const runValidation = async (
    config: EmbeddingProviderConfig,
    opts: { toast?: boolean; key?: string } = {},
  ) => {
    const id = opts.key ?? config.id;
    setTestingId(config.id);
    setTestResults((prev) => ({ ...prev, [id]: { status: 'testing' } }));
    try {
      await validateEmbedding(config);
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

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.services.embedding_section_title', 'Embedding')}
        description={t('settings.services.embedding_section_desc', '向量模型配置，用于混合检索')}
      >
        <div className="p-4">
          <div className="grid gap-3">
            {configs.length === 0 && (
              <ServiceSetupGuide
                title={t('settings.services.setup_guide_title')}
                intro={t('settings.services.setup_guide_intro')}
                engines={embeddingEngines}
                onAdd={openAddModal}
              />
            )}
            {configs.map((config) => (
              <div
                key={config.id}
                onClick={() => handleSetActive(config.id)}
                className={`relative p-4 rounded-xl border-2 select-none transition-all duration-200 cursor-pointer ${
                  activeId === config.id
                    ? 'border-[var(--primary-500)] bg-[var(--primary-50)]/50'
                    : 'border-neutral-200 bg-white hover:border-neutral-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div
                      className={`mt-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        activeId === config.id
                          ? 'border-[var(--primary-500)] bg-[var(--primary-500)]'
                          : 'border-neutral-300 bg-white'
                      }`}
                    >
                      {activeId === config.id && <div className="h-2 w-2 rounded-full bg-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-neutral-800 truncate">
                          {config.name}
                        </span>
                        {activeId === config.id && (
                          <span className="shrink-0 rounded-full bg-[var(--primary-100)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary-600)]">
                            {t('settings.services.active_label')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-neutral-400 mt-0.5">
                        {config.apiBase}/{config.model}
                      </div>
                      <ProviderStatusBadge result={testResults[config.id]} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-3 shrink-0">
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
                        icon={
                          testingId === config.id
                            ? 'solar:restart-bold'
                            : 'solar:refresh-circle-bold'
                        }
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
              </div>
            ))}
            <button
              type="button"
              onClick={openAddModal}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 py-3 text-sm font-medium text-neutral-500 hover:border-[var(--primary-300)] hover:text-[var(--primary-500)] hover:bg-[var(--primary-50)]/50 transition-colors"
            >
              <Icon icon="solar:add-circle-bold" className="text-base" />
              {t('settings.services.add_provider')}
            </button>
          </div>
        </div>
      </Section>

      <ServiceWizard<FormShape>
        open={showModal}
        onClose={closeModal}
        addTitle={t('settings.services.add_provider')}
        editTitle={t('settings.services.edit_provider')}
        guideTitle={t('settings.services.setup_guide_title')}
        guideIntro={t('settings.services.setup_guide_intro')}
        engines={embeddingEngines}
        types={[]}
        hideTypeField
        defaultForm={defaultForm}
        validate={(cfg) => validateEmbedding(cfg as EmbeddingProviderConfig)}
        save={wizardSave}
        editingConfig={editingConfig}
        idPrefix="embedding"
        typeValue="embedding"
        extraFields={(form, patch) => (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                {t('settings.services.model')}
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]"
                value={(form.model as string) ?? ''}
                onChange={(e) => patch({ model: e.target.value } as Partial<FormShape>)}
                placeholder="nomic-embed-text"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                {t('settings.services.api_key')}
              </label>
              <input
                type="password"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]"
                value={(form.apiKey as string) ?? ''}
                onChange={(e) => patch({ apiKey: e.target.value } as Partial<FormShape>)}
                placeholder="sk-..."
              />
            </div>
          </>
        )}
      />
    </div>
  );
}

export default EmbeddingPage;
