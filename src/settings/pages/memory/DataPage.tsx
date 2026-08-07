import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, useToast, useConfirm, SettingsJumpButton } from '../../components';
import { getRAGEngine } from '../../../services/rag/engine';

/**
 * 记忆体 → 数据管理：备份入口 + 本地数据重置。
 * 备份/还原的完整功能已迁移至「备份与恢复」页（/settings/memory/backup）。
 */
export function DataPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [clearing, setClearing] = useState(false);

  const handleClearMemory = async () => {
    const ok = await confirm({
      title: t('settings.data.clear_memory_title'),
      message: t('settings.data.clear_memory_desc'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    setClearing(true);
    try {
      getRAGEngine().wipeAll();
      // 清空所有按角色隔离的记忆键与 RAG 文档键
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('desk_pet_memory_') || key === 'deskpet_rag_docs_v1')) {
          toRemove.push(key);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
      showToast(t('settings.data.cleared'), 'success');
    } catch (e) {
      showToast(
        t('settings.data.clear_failed', { error: e instanceof Error ? e.message : String(e) }),
        'error',
      );
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.data.section_title')}
        description={t('settings.data.section_desc')}
      >
        <div className="p-4">
          <SettingsJumpButton
            to="/settings/memory/backup"
            label={t('settings.memory.backup.title')}
            icon="solar:cloud-upload-bold-duotone"
            hint={t('settings.data.backup_hint')}
          />
        </div>
      </Section>

      <Section title={t('settings.data.danger_title')} description={t('settings.data.danger_desc')}>
        <div className="p-4">
          <button
            type="button"
            onClick={handleClearMemory}
            disabled={clearing}
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {clearing ? (
              <Icon icon="solar:restart-bold" className="text-base animate-spin" />
            ) : (
              <Icon icon="solar:trash-bin-trash-bold-duotone" className="text-base" />
            )}
            {t('settings.data.clear_memory')}
          </button>
        </div>
      </Section>
    </div>
  );
}

export default DataPage;
