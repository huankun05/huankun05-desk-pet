import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Switch, useToast } from '../../components';
import {
  generatePluginCode,
  generateManifest,
  validatePluginId,
  type PluginTemplate,
} from '../../../services/market';

const CATEGORY_OPTIONS = [
  { value: 'feature', labelKey: 'settings.market.cat_feature' },
  { value: 'behavior', labelKey: 'settings.market.cat_behavior' },
  { value: 'tool', labelKey: 'settings.market.cat_tool' },
];

const PERMISSION_OPTIONS = [
  { value: 'screen:read', label: '读取屏幕', desc: '截屏和分析屏幕内容' },
  { value: 'ai:chat', label: 'AI 对话', desc: '调用 AI 进行对话' },
  { value: 'tts:play', label: '语音播报', desc: '播放 TTS 语音' },
  { value: 'media:play', label: '媒体播放', desc: '播放音频/视频' },
  { value: 'input:simulate', label: '模拟输入', desc: '模拟键盘鼠标操作' },
  { value: 'network:fetch', label: '网络请求', desc: '发起 HTTP 请求' },
];

const FEATURE_KEYS = [
  'onInitialize',
  'onTerminate',
  'onEvent',
  'onSchedule',
  'configPage',
] as const;

export function PluginBuilderPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [template, setTemplate] = useState<PluginTemplate>({
    id: '',
    name: '',
    version: '1.0.0',
    description: '',
    author: '',
    category: 'feature',
    permissions: [],
    features: {
      onInitialize: true,
      onTerminate: true,
      onEvent: false,
      onSchedule: false,
      configPage: false,
    },
  });
  const [generatedCode, setGeneratedCode] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const updateField = <K extends keyof PluginTemplate>(key: K, value: PluginTemplate[K]) => {
    setTemplate((prev) => ({ ...prev, [key]: value }));
  };

  const togglePermission = (perm: string) => {
    setTemplate((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter((p) => p !== perm)
        : [...prev.permissions, perm],
    }));
  };

  const toggleFeature = (key: keyof PluginTemplate['features']) => {
    setTemplate((prev) => ({
      ...prev,
      features: { ...prev.features, [key]: !prev.features[key] },
    }));
  };

  const handleNext = () => {
    if (step === 1) {
      if (!validatePluginId(template.id)) {
        showToast(t('settings.market.invalid_plugin_id'), 'error');
        return;
      }
      if (!template.name) {
        showToast(t('settings.market.plugin_name_required'), 'error');
        return;
      }
    }
    setStep((s) => Math.min(s + 1, 3));
  };

  const handleGenerate = () => {
    const code = generatePluginCode(template);
    setGeneratedCode(code);
    setShowPreview(true);
    showToast(t('settings.market.generated_success'), 'success');
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      showToast(t('settings.market.copied'), 'success');
    } catch {
      showToast(t('settings.market.copy_failed'), 'error');
    }
  };

  const handleDownload = () => {
    const manifest = generateManifest(template);
    const content = `// manifest.json\n${JSON.stringify(manifest, null, 2)}\n\n// index.ts\n${generatedCode}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* 步骤指示 */}
      <div className="flex items-center justify-center gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                step >= s ? 'bg-[var(--primary-500)] text-white' : 'bg-neutral-200 text-neutral-500'
              }`}
            >
              {s}
            </div>
            {s < 3 && (
              <div
                className={`h-0.5 w-12 transition-colors ${step > s ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'}`}
              />
            )}
          </div>
        ))}
      </div>

      {/* 第 1 步：基本信息 */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="mb-2 px-1">
            <h2 className="text-sm font-semibold text-neutral-700">{t('settings.market.step1_title')}</h2>
            <p className="text-xs text-neutral-400 mt-0.5">{t('settings.market.step1_desc')}</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.market.plugin_id')}
              </label>
              <input
                type="text"
                value={template.id}
                onChange={(e) => updateField('id', e.target.value)}
                placeholder="my-plugin"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
              <p className="mt-1 text-xs text-neutral-500">{t('settings.market.plugin_id_hint')}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.market.plugin_name')}
              </label>
              <input
                type="text"
                value={template.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="我的插件"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.market.plugin_desc')}
              </label>
              <textarea
                value={template.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="简短描述插件功能"
                rows={2}
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.market.plugin_author')}
              </label>
              <input
                type="text"
                value={template.author}
                onChange={(e) => updateField('author', e.target.value)}
                placeholder="作者名"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                {t('settings.market.plugin_category')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateField('category', opt.value as PluginTemplate['category'])}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      template.category === opt.value
                        ? 'border-[var(--primary-500)] bg-[var(--primary-50)]'
                        : 'border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    <div className="text-sm font-medium">{t(opt.labelKey)}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={handleNext}
              className="rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--primary-600)]"
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      )}

      {/* 第 2 步：权限和功能 */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="mb-2 px-1">
            <h2 className="text-sm font-semibold text-neutral-700">{t('settings.market.step2_title')}</h2>
            <p className="text-xs text-neutral-400 mt-0.5">{t('settings.market.step2_desc')}</p>
          </div>
          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-700">
                {t('settings.market.required_permissions')}
              </label>
              <div className="space-y-2">
                {PERMISSION_OPTIONS.map((perm) => (
                  <label
                    key={perm.value}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
                      template.permissions.includes(perm.value)
                        ? 'border-[var(--primary-300)] bg-[var(--primary-50)]'
                        : 'border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium">{perm.label}</div>
                      <div className="text-xs text-neutral-500">{perm.desc}</div>
                    </div>
                    <Switch
                      checked={template.permissions.includes(perm.value)}
                      onChange={() => togglePermission(perm.value)}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-700">
                {t('settings.market.features')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {FEATURE_KEYS.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-lg border border-neutral-200 p-3"
                  >
                    <span className="text-sm">{t(`settings.market.feature_${key}`)}</span>
                    <Switch checked={template.features[key]} onChange={() => toggleFeature(key)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              {t('common.prev')}
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--primary-600)]"
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      )}

      {/* 第 3 步：生成代码 */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="mb-2 px-1">
            <h2 className="text-sm font-semibold text-neutral-700">{t('settings.market.step3_title')}</h2>
            <p className="text-xs text-neutral-400 mt-0.5">{t('settings.market.step3_desc')}</p>
          </div>
          {!showPreview ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Icon icon="solar:code-bold-duotone" className="mb-4 h-16 w-16 text-neutral-300" />
              <p className="mb-4 text-neutral-500">{t('settings.market.ready_to_generate')}</p>
              <button
                type="button"
                onClick={handleGenerate}
                className="flex items-center gap-2 rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--primary-600)]"
              >
                <Icon icon="solar:magic-stick-bold" className="h-4 w-4" />
                {t('settings.market.generate_code')}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">{generatedCode.length} chars</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="flex items-center gap-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
                  >
                    <Icon icon="solar:copy-bold" className="h-4 w-4" />
                    {t('common.copy')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="flex items-center gap-1 rounded-lg bg-[var(--primary-500)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--primary-600)]"
                  >
                    <Icon icon="solar:download-bold" className="h-4 w-4" />
                    {t('common.download')}
                  </button>
                </div>
              </div>
              <pre className="max-h-96 overflow-auto rounded-lg bg-neutral-900 p-4 text-xs text-neutral-100">
                <code>{generatedCode}</code>
              </pre>
            </div>
          )}
          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              {t('common.prev')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
