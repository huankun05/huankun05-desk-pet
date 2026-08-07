import { useTranslation } from 'react-i18next';
import { IconItem } from '../../components';

/**
 * 记忆体模块二级入口列表。
 */
export function MemoryIndex() {
  const { t } = useTranslation();

  // 顺序：策略在前（上下文 → 长期记忆 → 规则），内容在后（查看 → 会话 → 数据 → 备份）
  // 注意：本列表与 routes.tsx 的 settingsTree 需保持同步，新增页面时两处都要加。
  const entries = [
    {
      icon: 'solar:documents-bold-duotone',
      title: t('settings.memory.context'),
      description: t('settings.memory.context_desc'),
      to: '/settings/memory/context',
    },
    {
      icon: 'solar:brain-bold-duotone',
      title: t('settings.memory.long_term'),
      description: t('settings.memory.long_term_desc'),
      to: '/settings/memory/long-term',
    },
    {
      icon: 'solar:clipboard-list-bold-duotone',
      title: t('settings.memory.rules'),
      description: t('settings.memory.rules_desc'),
      to: '/settings/memory/rules',
    },
    {
      icon: 'solar:eye-bold-duotone',
      title: t('settings.memoryview.title'),
      description: t('settings.memoryview.desc'),
      to: '/settings/memory/view',
    },
    {
      icon: 'solar:document-text-bold-duotone',
      title: t('settings.memory.sessions'),
      description: t('settings.memory.sessions_desc'),
      to: '/settings/memory/sessions',
    },
    {
      icon: 'solar:archive-bold-duotone',
      title: t('settings.memory.data'),
      description: t('settings.memory.data_desc'),
      to: '/settings/memory/data',
    },
    {
      icon: 'solar:cloud-upload-bold-duotone',
      title: t('settings.memory.backup.title'),
      description: t('settings.memory.backup.entry_desc'),
      to: '/settings/memory/backup',
    },
    {
      icon: 'solar:graph-new-bold-duotone',
      title: t('settings.memory.growth.title'),
      description: t('settings.memory.growth.desc'),
      to: '/settings/memory/growth',
    },
  ];

  return (
    <div className="flex flex-col gap-4 font-normal pb-4 animate-[fade-in-up_0.3s_ease-out]">
      <div className="flex flex-col gap-4">
        {entries.map((entry, index) => (
          <IconItem
            key={entry.to}
            icon={entry.icon}
            title={entry.title}
            description={entry.description}
            to={entry.to}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}

export default MemoryIndex;
