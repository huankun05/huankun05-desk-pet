import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Modal, useToast } from './';
import { invoke } from '@tauri-apps/api/core';
import type { ProviderMeta, ProviderType } from '../../services/provider/types';
import { isTauriEnv } from '../../utils/tauriEnv';
import { pickFolder } from '../../utils/pickFolder';
import { ServiceSetupGuide, type SetupEngineInfo } from './ServiceSetupGuide';

type Step = 1 | 2 | 3;
type TestStatus = 'idle' | 'testing' | 'success' | 'error';

export interface ServiceWizardProps<T extends Record<string, unknown>> {
  /** 是否打开弹窗 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 添加时弹窗标题 */
  addTitle: string;
  /** 编辑时弹窗标题 */
  editTitle: string;
  /** 空状态指引标题 */
  guideTitle: string;
  /** 空状态指引说明 */
  guideIntro: string;
  /** 指引面板中各引擎的资源需求信息 */
  engines: SetupEngineInfo[];
  /** 引擎需求说明的 i18n key 构造器；返回空串表示无说明 */
  engineReqKey?: (typeName: string) => string;
  /** 可选适配器类型列表（为空则跳过“选引擎”步骤） */
  types: ProviderMeta[];
  /** 表单默认值（不含 id/type） */
  defaultForm: T;
  /** 各适配器默认 API 地址 */
  defaultEndpoints?: Record<string, string>;
  /** 需要本地权重的适配器类型名 */
  localEngines?: string[];
  /** 权重已随软件内置、无需用户手动放置的适配器类型名 */
  bundledEngines?: string[];
  /** 各适配器的固定权重目录（相对应用根） */
  weightsDirs?: Record<string, string>;
  /** 隐藏“适配器类型”字段（Embedding 按 apiBase 自动选择实现，无 typeName） */
  hideTypeField?: boolean;
  /** 第 2 步中除通用字段外的额外字段（apiKey / model / voice / speed ...） */
  extraFields?: (form: T, patch: (p: Partial<T>) => void, typeName: string) => ReactNode;
  /** 测试连接；失败抛出可读错误 */
  validate: (cfg: T & { id: string; type: string }) => Promise<void>;
  /** 持久化；返回 false 表示失败（中止关闭） */
  save: (cfg: T, editingId: string | null) => boolean;
  /** 成功“新增”（非编辑）后回调，用于自动启动后端 */
  onAdded?: (cfg: T) => void;
  /** 编辑态时传入的当前配置 */
  editingConfig?: (T & { id: string }) | null;
  /** id 前缀，如 'tts' / 'llm' */
  idPrefix: string;
  /** provider 类型值，如 'tts' / 'chat' */
  typeValue: ProviderType;
}

const inputClass =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]';

export function ServiceWizard<T extends Record<string, unknown>>(props: ServiceWizardProps<T>) {
  const {
    open,
    onClose,
    addTitle,
    editTitle,
    guideTitle,
    guideIntro,
    engines,
    engineReqKey,
    types,
    defaultForm,
    defaultEndpoints,
    localEngines,
    bundledEngines,
    weightsDirs,
    hideTypeField,
    extraFields,
    validate,
    save,
    onAdded,
    editingConfig,
    idPrefix,
    typeValue,
  } = props;

  const { t } = useTranslation();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>(types.length > 0 ? 1 : 2);
  const [form, setForm] = useState<T>(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMsg, setTestMsg] = useState<string>('');

  // 每次打开时根据 新增/编辑 初始化
  useEffect(() => {
    if (!open) return;
    if (editingConfig) {
      const { id, type, ...rest } = editingConfig as Record<string, unknown>;
      void id;
      void type;
      setForm(rest as T);
      setEditingId((editingConfig as { id: string }).id);
      setStep(2);
    } else {
      setForm({ ...defaultForm });
      setEditingId(null);
      setStep(types.length > 0 ? 1 : 2);
    }
    setTestStatus('idle');
    setTestMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (p: Partial<T>) => setForm((prev) => ({ ...prev, ...p }));

  const getTypeNameDisplay = (typeName: string) => {
    const meta = types.find((x) => x.typeName === typeName);
    return meta?.displayName || typeName;
  };

  const pickEngine = (typeName: string) => {
    const meta = types.find((x) => x.typeName === typeName);
    setForm(
      (prev) =>
        ({
          ...prev,
          typeName,
          name: (prev.name as string)?.trim() || (meta?.displayName ?? typeName),
          apiBase: (prev.apiBase as string)?.trim() || (defaultEndpoints?.[typeName] ?? ''),
        }) as T,
    );
    setStep(2);
  };

  const openWeightsFolder = async (typeName: string) => {
    const subdir = weightsDirs?.[typeName];
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

  const browseWeights = async (typeName: string) => {
    if (!isTauriEnv()) {
      showToast(t('settings.services.open_folder_desktop_only'), 'info');
      return;
    }
    const def = (form.weightsPath as string) || weightsDirs?.[typeName] || '';
    const picked = await pickFolder(def || undefined);
    if (picked) patch({ weightsPath: picked } as unknown as Partial<T>);
  };

  const runTest = async () => {
    setTestStatus('testing');
    setTestMsg('');
    try {
      await validate({ ...form, id: '__wizard__', type: typeValue } as T & {
        id: string;
        type: string;
      });
      setTestStatus('success');
      setTestMsg(t('settings.services.connection_success'));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setTestStatus('error');
      setTestMsg(t('settings.services.connection_failed_detail', { error: msg }));
    }
  };

  const finish = () => {
    if (!((form.name as string) ?? '').trim()) {
      showToast(t('settings.services.validation_required'), 'warning');
      return;
    }
    if (!((form.apiBase as string) ?? '').trim()) {
      showToast(t('settings.services.validation_required'), 'warning');
      return;
    }
    const ok = save(form, editingId);
    if (!ok) {
      showToast(t('settings.services.add_failed'), 'error');
      return;
    }
    if (!editingId && onAdded) onAdded(form);
    onClose();
  };

  const currentType = (form.typeName as string) || types[0]?.typeName || '';
  const isLocal = (localEngines ?? []).includes(currentType);
  const isBundled = (bundledEngines ?? []).includes(currentType);
  const fixedWeightsDir = weightsDirs?.[currentType];

  const renderFooter = () => {
    if (step === 1) {
      return (
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => setStep(2)}
            disabled={!currentType}
            className="rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('settings.services.wizard_next')}
          </button>
        </>
      );
    }
    if (step === 2) {
      return (
        <>
          {!editingId && (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              {t('settings.services.wizard_prev')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setStep(3)}
            className="ml-auto rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)]"
          >
            {t('settings.services.wizard_next')}
          </button>
        </>
      );
    }
    return (
      <>
        {testStatus !== 'idle' && (
          <div
            className={`mr-auto rounded-lg px-3 py-2 text-xs ${
              testStatus === 'success'
                ? 'bg-green-50 text-green-600'
                : testStatus === 'error'
                  ? 'bg-red-50 text-red-600'
                  : 'bg-neutral-50 text-neutral-600'
            }`}
          >
            {testMsg}
          </div>
        )}
        {!editingId && (
          <button
            type="button"
            onClick={() => setStep(2)}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            {t('settings.services.wizard_prev')}
          </button>
        )}
        <button
          type="button"
          onClick={runTest}
          disabled={testStatus === 'testing'}
          className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {testStatus === 'testing' && (
            <Icon icon="solar:restart-bold" className="text-base animate-spin" />
          )}
          {t('settings.test_connection')}
        </button>
        <button
          type="button"
          onClick={finish}
          className="rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)]"
        >
          {editingId ? t('settings.save') : t('settings.services.wizard_finish')}
        </button>
      </>
    );
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={editingId ? editTitle : addTitle}
      maxWidth="max-w-lg"
      footer={renderFooter()}
    >
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">{t('settings.services.wizard_pick_hint')}</p>
          <div className="grid gap-2">
            {engines.map((e) => {
              const reqKey = engineReqKey?.(e.typeName);
              const reqText = reqKey ? t(reqKey) : '';
              const requirement = reqText === reqKey ? '' : reqText;
              const selected = currentType === e.typeName;
              return (
                <button
                  key={e.typeName}
                  type="button"
                  onClick={() => pickEngine(e.typeName)}
                  className={`flex items-start justify-between gap-3 rounded-xl border-2 p-3 text-left transition-colors ${
                    selected
                      ? 'border-[var(--primary-500)] bg-[var(--primary-50)]/50'
                      : 'border-neutral-200 bg-white hover:border-neutral-300'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-neutral-800">{e.displayName}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        e.bundled
                          ? 'bg-blue-50 text-blue-600'
                          : e.needsWeights
                            ? 'bg-amber-50 text-amber-600'
                            : 'bg-green-50 text-green-600'
                      }`}
                    >
                      {e.bundled
                        ? t('settings.services.engine_tag_bundled')
                        : e.needsWeights
                          ? t('settings.services.engine_tag_weights')
                          : t('settings.services.engine_tag_online')}
                    </span>
                    </div>
                    {requirement && (
                      <p className="mt-1 text-xs leading-relaxed text-neutral-500">{requirement}</p>
                    )}
                  </div>
                  <Icon
                    icon="solar:alt-arrow-right-bold"
                    className="mt-1 shrink-0 text-base text-neutral-300"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-neutral-800">
              {t('settings.services.provider_name')}
            </label>
            <input
              type="text"
              className={inputClass}
              value={(form.name as string) ?? ''}
              onChange={(e) => patch({ name: e.target.value } as unknown as Partial<T>)}
              placeholder={t('settings.services.my_tts_provider')}
            />
          </div>

          {!hideTypeField && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                {t('settings.services.adapter_type')}
              </label>
              <select
                className={inputClass}
                value={currentType}
                onChange={(e) => patch({ typeName: e.target.value } as unknown as Partial<T>)}
              >
                {types.map((tp) => (
                  <option key={tp.typeName} value={tp.typeName}>
                    {tp.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-neutral-800">
              {t('settings.services.api_address')}
            </label>
            <input
              type="text"
              className={inputClass}
              value={(form.apiBase as string) ?? ''}
              onChange={(e) => patch({ apiBase: e.target.value } as unknown as Partial<T>)}
              placeholder="http://localhost:8001"
            />
            {currentType === 'edge_tts' && (
              <p className="mt-1 text-xs text-neutral-400">
                {t('settings.services.wizard_edge_hint')}
              </p>
            )}
          </div>

          {isBundled && (
            <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50/60 p-3">
              <Icon icon="solar:check-circle-bold" className="mt-0.5 shrink-0 text-base text-blue-500" />
              <div className="text-xs leading-relaxed text-blue-700">
                {t('settings.services.wizard_bundled_note')}
              </div>
            </div>
          )}

          {isLocal && !isBundled && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                {t('settings.services.wizard_weights_dir')}
              </label>
              <p className="mb-2 text-xs leading-relaxed text-neutral-500">
                {t('settings.services.wizard_weights_howto')}
              </p>
              {fixedWeightsDir ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
                    {fixedWeightsDir}
                  </code>
                  <button
                    type="button"
                    onClick={() => openWeightsFolder(currentType)}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs font-medium text-neutral-600 transition-colors hover:border-[var(--primary-300)] hover:text-[var(--primary-500)]"
                    title={t('settings.services.open_weights_folder')}
                  >
                    <Icon icon="solar:folder-with-files-bold" className="text-sm" />
                    {t('settings.services.open_weights_folder_short')}
                  </button>
                </div>
              ) : (
                <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-500">
                  {t('settings.services.wizard_no_fixed_weights')}
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  className={inputClass}
                  value={(form.weightsPath as string) ?? ''}
                  onChange={(e) => patch({ weightsPath: e.target.value } as unknown as Partial<T>)}
                  placeholder={t('settings.services.wizard_weights_placeholder')}
                />
                <button
                  type="button"
                  onClick={() => browseWeights(currentType)}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs font-medium text-neutral-600 transition-colors hover:border-[var(--primary-300)] hover:text-[var(--primary-500)]"
                >
                  <Icon icon="solar:folder-bold" className="text-sm" />
                  {t('settings.services.wizard_browse')}
                </button>
              </div>
              {engineReqKey &&
                (() => {
                  const reqKey = engineReqKey(currentType);
                  const reqText = reqKey ? t(reqKey) : '';
                  return reqText !== reqKey ? (
                    <p className="mt-1 text-xs text-neutral-400">{reqText}</p>
                  ) : null;
                })()}
            </div>
          )}

          {extraFields?.(form, patch, currentType)}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 text-sm">
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">{t('settings.services.adapter_type')}</span>
              <span className="font-medium text-neutral-800">
                {getTypeNameDisplay(currentType)}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">{t('settings.services.provider_name')}</span>
              <span className="font-medium text-neutral-800">{(form.name as string) || '-'}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">{t('settings.services.api_address')}</span>
              <span className="max-w-[200px] truncate font-medium text-neutral-800">
                {(form.apiBase as string) || t('settings.services.default_endpoint')}
              </span>
            </div>
          </div>
          <p className="text-xs text-neutral-500">{t('settings.services.wizard_test_hint')}</p>
        </div>
      )}
    </Modal>
  );
}

export default ServiceWizard;
