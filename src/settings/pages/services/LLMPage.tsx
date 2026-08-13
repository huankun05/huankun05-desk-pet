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
import { providerManager } from '../../../services/provider/manager';
import { providerRegistry } from '../../../services/provider/registry';
import { isVisionModel } from '../../../services/provider/ollama/chat';
import type { ChatProviderConfig, ProviderMeta } from '../../../services/provider/types';
import { ServiceSetupGuide, type SetupEngineInfo } from '../../components/ServiceSetupGuide';
import { ServiceWizard } from '../../components/ServiceWizard';
import { validateProviderConfig } from '../../../services/provider/validateProvider';

type FormShape = Omit<ChatProviderConfig, 'id' | 'type'>;

const defaultForm: FormShape = {
  name: '',
  enable: true,
  typeName: 'openai_chat',
  apiKey: '',
  apiBase: 'https://api.openai.com/v1',
  model: 'gpt-3.5-turbo',
};

const DEFAULT_ENDPOINTS: Record<string, string> = {
  openai_chat: 'https://api.openai.com/v1',
};

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
interface TestResult {
  status: TestStatus;
  message?: string;
}

export function LLMPage() {
  const [configs, setConfigs] = useState<ChatProviderConfig[]>(
    () => providerManager.listProviders('chat') as ChatProviderConfig[],
  );
  const [activeId, setActiveId] = useState<string | null>(() => {
    const active = providerManager.getActiveChatProvider();
    return active ? active.config.id : null;
  });
  const [showModal, setShowModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ChatProviderConfig | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [chatTypes] = useState<ProviderMeta[]>(() => providerRegistry.getRegisteredTypes('chat'));
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const llmEngines: SetupEngineInfo[] = chatTypes.map((m) => ({
    typeName: m.typeName,
    displayName: m.displayName,
    needsWeights: false,
  }));

  const loadConfigs = () => {
    const all = providerManager.listProviders('chat') as ChatProviderConfig[];
    setConfigs(all);
    const active = providerManager.getActiveChatProvider();
    if (active) setActiveId(active.config.id);
  };

  const { handlePointerDown, draggingId, dragPos, dragSize, visualItems, containerRef } =
    useReorder(configs, {
      onReorder: (orderedIds) => {
        providerManager.reorderProviders('chat', orderedIds);
        loadConfigs();
      },
      onSelect: (id) => handleSetActive(id),
    });

  const draggingConfig = configs.find((c) => c.id === draggingId);

  const openAddModal = () => {
    setEditingConfig(null);
    setShowModal(true);
  };
  const openEditModal = (config: ChatProviderConfig) => {
    setEditingConfig(config);
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setEditingConfig(null);
  };

  const wizardSave = (cfg: FormShape, editingId: string | null): boolean => {
    if (editingId) {
      providerManager.updateProvider(editingId, cfg as Partial<ChatProviderConfig>);
    } else {
      const newConfig: ChatProviderConfig = {
        ...cfg,
        id: `llm-${crypto.randomUUID()}`,
        type: 'chat',
      } as ChatProviderConfig;
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
    providerManager.setActiveChatProvider(id);
    setActiveId(id);
    showToast(t('settings.services.activated'), 'success');
    if (config) runValidation(config, { toast: false });
  };

  const runValidation = async (
    config: ChatProviderConfig,
    opts: { toast?: boolean; key?: string } = {},
  ) => {
    const id = opts.key ?? config.id;
    setTestingId(config.id);
    setTestResults((prev) => ({ ...prev, [id]: { status: 'testing' } }));
    try {
      const tempId = `temp-test-${crypto.randomUUID()}`;
      const testConfig: ChatProviderConfig = { ...config, id: tempId, enable: true };
      const provider = providerRegistry.createChatProvider(config.typeName, testConfig);
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

  const getTypeNameDisplay = (typeName: string) => {
    const meta = chatTypes.find((x) => x.typeName === typeName);
    return meta?.displayName || typeName;
  };

  const renderCardContent = (config: ChatProviderConfig) => (
    <div className="flex items-start justify-between">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div
          className={`mt-2.5 flex h-5 w-5 shrink-0 items-center justify-center text-neutral-300 transition-opacity ${
            draggingId === config.id ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Icon icon="solar:list-bold-duotone" className="text-base" />
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
          <Icon icon="solar:chat-square-like-bold-duotone" className="text-xl" />
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
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs text-neutral-400 truncate">{config.model}</span>
            {isVisionModel(config.model) && (
              <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                <Icon icon="solar:camera-bold" className="text-[10px]" />
                {t('common.vision')}
              </span>
            )}
          </div>
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
        title={t('settings.services.llm_section_title')}
        description={t('settings.services.llm_section_desc')}
      >
        <div className="p-4">
          {visualItems.length === 0 ? (
            <ServiceSetupGuide
              title={t('settings.services.setup_guide_title')}
              intro={t('settings.services.setup_guide_intro')}
              engines={llmEngines}
              onAdd={openAddModal}
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
                          ? 'border-[var(--primary-500)] bg-[var(--primary-50)]/50 ring-2 ring-[var(--primary-100)]'
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

      <ServiceWizard<FormShape>
        open={showModal}
        onClose={closeModal}
        addTitle={t('settings.services.add_provider')}
        editTitle={t('settings.services.edit_provider')}
        guideTitle={t('settings.services.setup_guide_title')}
        guideIntro={t('settings.services.setup_guide_intro')}
        engines={llmEngines}
        types={chatTypes}
        defaultForm={defaultForm}
        defaultEndpoints={DEFAULT_ENDPOINTS}
        validate={(cfg) => validateProviderConfig('chat', cfg as ChatProviderConfig)}
        save={wizardSave}
        editingConfig={editingConfig}
        idPrefix="llm"
        typeValue="chat"
        extraFields={(form, patch) => (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                {t('settings.services.api_key')}
              </label>
              <input
                type="password"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]"
                value={(form.apiKey as string) ?? ''}
                onChange={(e) => patch({ apiKey: e.target.value } as Partial<FormShape>)}
                placeholder={t('settings.services.api_key_placeholder')}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                {t('settings.services.model')}
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]"
                value={(form.model as string) ?? ''}
                onChange={(e) => patch({ model: e.target.value } as Partial<FormShape>)}
                placeholder={t('settings.services.model_placeholder')}
              />
            </div>
          </>
        )}
      />

      <Section title={t('settings.related_settings')}>
        <div className="space-y-2 p-4">
          <SettingsJumpButton
            to="/settings/services/tts"
            label={t('settings.services_section.tts')}
            icon="solar:speaker-bold-duotone"
            hint={t('settings.services_section.related_tts_hint')}
          />
          <SettingsJumpButton
            to="/settings/services/stt"
            label={t('settings.services_section.stt')}
            icon="solar:microphone-bold-duotone"
            hint={t('settings.services_section.related_stt_hint')}
          />
        </div>
      </Section>
    </div>
  );
}

export default LLMPage;
