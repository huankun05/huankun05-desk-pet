import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, Modal, useToast, useConfirm, ProviderStatusBadge } from '../../components';
import { providerManager } from '../../../services/provider/manager';
import {
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from '../../../services/provider/embedding';
import type { EmbeddingProviderConfig } from '../../../services/provider/types';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
interface TestResult {
  status: TestStatus;
  message?: string;
}

const inputClass =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]';

const defaultForm: Omit<EmbeddingProviderConfig, 'id' | 'type'> = {
  name: '',
  enable: true,
  apiBase: 'http://localhost:11434',
  model: 'nomic-embed-text',
};

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<EmbeddingProviderConfig, 'id' | 'type'>>(defaultForm);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

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
    setEditingId(null);
    setForm({ ...defaultForm });
    setShowModal(true);
  };

  const openEditModal = (config: EmbeddingProviderConfig) => {
    setEditingId(config.id);
    setForm({
      name: config.name,
      enable: config.enable,
      apiBase: config.apiBase ?? '',
      model: config.model ?? '',
      apiKey: config.apiKey,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      showToast(t('settings.services.validation_required'), 'warning');
      return;
    }

    if (!(form.apiBase ?? '').trim()) {
      showToast(t('settings.services.validation_required'), 'warning');
      return;
    }

    if (editingId) {
      providerManager.updateProvider(editingId, form);
    } else {
      const newConfig: EmbeddingProviderConfig = {
        ...form,
        id: `embedding-${crypto.randomUUID()}`,
        type: 'embedding',
      };
      const ok = providerManager.addProvider(newConfig);
      if (!ok) {
        showToast(t('settings.services.add_failed'), 'error');
        return;
      }
      setActiveId(newConfig.id);
    }

    loadConfigs();
    showToast(t('settings.services.saved'), 'success');
    closeModal();
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
      await providerManager.ready;
      const base = (config.apiBase || '').replace(/\/+$/, '');
      const model = config.model || 'nomic-embed-text';
      const provider =
        base.includes('localhost') || base.includes('127.0.0.1') || base.includes('11434')
          ? new OllamaEmbeddingProvider({ ...config, apiBase: base, model })
          : new OpenAIEmbeddingProvider({ ...config, apiBase: base, model });
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

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.services.embedding_section_title', 'Embedding')}
        description={t('settings.services.embedding_section_desc', '向量模型配置，用于混合检索')}
      >
        <div className="p-4">
          <div className="grid gap-3">
            {configs.length === 0 && (
              <div className="text-center py-8 text-neutral-400 text-sm">
                {t('settings.services.no_providers')}
              </div>
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

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={
          editingId ? t('settings.services.edit_provider') : t('settings.services.add_provider')
        }
        maxWidth="max-w-lg"
        footer={
          <>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)]"
            >
              {t('settings.save')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-neutral-800">
              {t('settings.services.provider_name')}
            </label>
            <input
              type="text"
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={t('settings.services.my_embedding_provider', '我的 Embedding')}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-neutral-800">
              {t('settings.services.api_address')}
            </label>
            <input
              type="text"
              className={inputClass}
              value={form.apiBase}
              onChange={(e) => setForm((prev) => ({ ...prev, apiBase: e.target.value }))}
              placeholder="http://localhost:11434"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-neutral-800">
              {t('settings.services.model')}
            </label>
            <input
              type="text"
              className={inputClass}
              value={form.model}
              onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
              placeholder="nomic-embed-text"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-neutral-800">
              {t('settings.services.api_key')}
            </label>
            <input
              type="password"
              className={inputClass}
              value={form.apiKey ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="sk-..."
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default EmbeddingPage;
