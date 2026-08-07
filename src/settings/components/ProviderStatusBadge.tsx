import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';

export type ProviderTestStatus = 'idle' | 'testing' | 'success' | 'error';

export interface ProviderTestResult {
  status: ProviderTestStatus;
  /** 错误/成功详情，hover 或展示用 */
  message?: string;
}

/**
 * 服务方案（LLM/TTS/STT）的校验状态徽标。
 * - idle / 未提供：不渲染
 * - testing：转圈 + “检测中…”
 * - success：绿勾 + “可用”
 * - error：红叉 + “不可用”（title 展示详细错误）
 */
export function ProviderStatusBadge({ result }: { result?: ProviderTestResult }) {
  const { t } = useTranslation();
  if (!result || result.status === 'idle') return null;

  if (result.status === 'testing') {
    return (
      <div className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
        <Icon icon="solar:refresh-circle-bold" className="text-sm animate-spin" />
        <span>{t('settings.services.validating')}</span>
      </div>
    );
  }

  if (result.status === 'success') {
    return (
      <div className="mt-1 flex items-center gap-1 text-xs text-green-600">
        <Icon icon="solar:check-circle-bold" className="text-sm shrink-0" />
        <span>{t('settings.services.available')}</span>
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-1 text-xs text-red-500" title={result.message}>
      <Icon icon="solar:close-circle-bold" className="text-sm shrink-0" />
      <span className="truncate" title={result.message}>
        {t('settings.services.unavailable')}
      </span>
    </div>
  );
}
