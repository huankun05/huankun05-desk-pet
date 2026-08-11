import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import {
  Section,
  Modal,
  useToast,
  useConfirm,
  useReorder,
  ProviderStatusBadge,
} from '../../components';
import { SettingsJumpButton } from '../../components/SettingsJumpButton';
import { providerManager } from '../../../services/provider/manager';
import { providerRegistry } from '../../../services/provider/registry';
import { isVisionModel } from '../../../services/provider/ollama/chat';
import type { ChatProviderConfig, ProviderMeta } from '../../../services/provider/types';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
interface TestResult {
  status: TestStatus;
  message?: string;
}

const inputClass =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]';

const defaultForm: Omit<ChatProviderConfig, 'id' | 'type'> = {
  name: '',
  enable: true,
  typeName: 'openai_chat',
  apiKey: '',
  apiBase: 'https://api.openai.com/v1',
  model: 'gpt-3.5-turbo',
};

const DRAFT_KEY = 'deskpet_llm_provider_draft';

export function LLMPage() {
  const [configs, setConfigs] = useState<ChatProviderConfig[]>(
    () => providerManager.listProviders('chat') as ChatProviderConfig[],
  );
  const [activeId, setActiveId] = useState<string | null>(() => {
    const active = providerManager.getActiveChatProvider();
    return active ? active.config.id : null;
  });
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<ChatProviderConfig, 'id' | 'type'>>(defaultForm);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [chatTypes] = useState<ProviderMeta[]>(() => providerRegistry.getRegisteredTypes('chat'));
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const loadConfigs = () => {
    const all = providerManager.listProviders('chat') as ChatProviderConfig[];
    setConfigs(all);
    const active = providerManager.getActiveChatProvider();
    if (active) {
      setActiveId(active.config.id);
    }
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
    setEditingId(null);
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
      try {
        const draft = JSON.parse(saved);
        setForm({
          ...defaultForm,
          ...draft,
          typeName: draft.typeName || chatTypes[0]?.typeName || defaultForm.typeName,
        });
      } catch {
        setForm({
          ...defaultForm,
          typeName: chatTypes[0]?.typeName || defaultForm.typeName,
        });
      }
    } else {
      setForm({
        ...defaultForm,
        typeName: chatTypes[0]?.typeName || defaultForm.typeName,
      });
    }
    setTestResults((prev) => ({ ...prev, __modal__: { status: 'idle' } }));
    setShowModal(true);
  };

  const openEditModal = (config: ChatProviderConfig) => {
    setEditingId(config.id);
    setForm({
      name: config.name,
      enable: config.enable,
      typeName: config.typeName,
      apiKey: config.apiKey,
      apiBase: config.apiBase,
      model: config.model,
    });
    setTestResults((prev) => ({ ...prev, __modal__: { status: 'idle' } }));
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

    if (!form.apiBase.trim()) {
      showToast(t('settings.services.validation_required'), 'warning');
      return;
    }

    if (editingId) {
      providerManager.updateProvider(editingId, form);
    } else {
      const newConfig: ChatProviderConfig = {
        ...form,
        id: `llm-${crypto.randomUUID()}`,
        type: 'chat',
      };
      const ok = providerManager.addProvider(newConfig);
      if (!ok) {
        showToast(t('settings.services.add_failed'), 'error');
        return;
      }
    }

    // 保存/更新已同步写入 ProviderManager 内存状态，无需 reloadProviders() 从磁盘重载
    loadConfigs();
    localStorage.removeItem(DRAFT_KEY);
    showToast(t('settings.services.saved'), 'success');
    closeModal();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm(t('settings.services.confirm_delete')))) return;
    providerManager.removeProvider(id);
    // 删除已同步写入内存状态，直接刷新列表即可
    loadConfigs();
    showToast(t('settings.services.deleted'), 'success');
  };

  const handleSetActive = (id: string) => {
    const config = configs.find((c) => c.id === id);
    // 移除编辑页「启用」开关后，选中即代表使用：若该方案曾被禁用，先启用再激活
    if (config && !config.enable) {
      providerManager.updateProvider(id, { enable: true });
    }
    // 设置活跃方案并持久化（ProviderManager.saveState 同步写 localStorage + 防抖写文件）
    // 注意：不要在设置后调用 reloadProviders()，它会从磁盘读回旧状态覆盖刚写入的活跃 id，
    // 导致返回再进入时「使用中」丢失。
    providerManager.setActiveChatProvider(id);
    setActiveId(id);
    showToast(t('settings.services.activated'), 'success');
    // 选中即校验：当前方案是否可用（卡片显示状态，不弹 toast 打扰）
    if (config) {
      runValidation(config, { toast: false });
    }
  };

  /**
   * 检测某个 provider 配置是否可用。
   * - 选中（handleSetActive）时自动调用（toast:false），在卡片上显示状态；
   * - 手动点“测试连接”按钮时调用（toast:true）。
   * key 用于把结果挂到 testResults：卡片用 config.id，弹窗用 '__modal__'。
   */
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
      if (!provider) {
        throw new Error(t('settings.services.provider_create_failed'));
      }
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

  const patchForm = (p: Partial<typeof form>) => {
    setForm((prev) => {
      const next = { ...prev, ...p };
      if (editingId === null) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const getTypeNameDisplay = (typeName: string) => {
    const meta = chatTypes.find((t) => t.typeName === typeName);
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
          <div className="grid gap-3" ref={containerRef}>
            {visualItems.length === 0 && (
              <div className="text-center py-8 text-neutral-400 text-sm">
                {t('settings.services.no_providers')}
              </div>
            )}
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
            {testResults['__modal__'] && testResults['__modal__'].status !== 'idle' && (
              <div
                className={`mr-auto rounded-lg px-3 py-2 text-xs ${
                  testResults['__modal__'].status === 'success'
                    ? 'bg-green-50 text-green-600'
                    : testResults['__modal__'].status === 'error'
                      ? 'bg-red-50 text-red-600'
                      : 'bg-neutral-50 text-neutral-600'
                }`}
              >
                {testResults['__modal__'].message}
              </div>
            )}
            <button
              type="button"
              onClick={() =>
                runValidation({ ...form, id: '__modal__', type: 'chat' } as ChatProviderConfig, {
                  toast: true,
                  key: '__modal__',
                })
              }
              disabled={testingId === '__modal__'}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testingId === '__modal__' && (
                <Icon icon="solar:restart-bold" className="text-base animate-spin" />
              )}
              {t('settings.test_connection')}
            </button>
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
        <div className="space-y-5">
          <div className="space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              {t('settings.services.connection_settings')}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                {t('settings.services.provider_name')}
              </label>
              <input
                type="text"
                className={inputClass}
                value={form.name}
                onChange={(e) => patchForm({ name: e.target.value })}
                placeholder={t('settings.services.my_llm_provider')}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                {t('settings.services.adapter_type')}
              </label>
              <select
                className={inputClass}
                value={form.typeName}
                onChange={(e) => patchForm({ typeName: e.target.value })}
              >
                {chatTypes.map((t) => (
                  <option key={t.typeName} value={t.typeName}>
                    {t.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                {t('settings.services.api_url')}
              </label>
              <input
                type="text"
                className={inputClass}
                value={form.apiBase}
                onChange={(e) => patchForm({ apiBase: e.target.value })}
                placeholder={t('settings.services.api_url_placeholder')}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                {t('settings.services.api_key')}
              </label>
              <input
                type="password"
                className={inputClass}
                value={form.apiKey}
                onChange={(e) => patchForm({ apiKey: e.target.value })}
                placeholder={t('settings.services.api_key_placeholder')}
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
                onChange={(e) => patchForm({ model: e.target.value })}
                placeholder={t('settings.services.model_placeholder')}
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* 相关设置：语音功能依赖本页配置的 LLM */}
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
