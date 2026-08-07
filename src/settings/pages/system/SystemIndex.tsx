import { useTranslation } from 'react-i18next';
import { IconItem } from '../../components';

/**
 * 系统模块二级入口列表。
 */
export function SystemIndex() {
  const { t } = useTranslation();

  const entries = [
    {
      icon: 'solar:emoji-funny-square-bold-duotone',
      title: t('settings.system_section.general'),
      description: t('settings.system_section.general_desc'),
      to: '/settings/system/general',
    },
    {
      icon: 'solar:code-bold-duotone',
      title: t('settings.system_section.developer'),
      description: t('settings.system_section.developer_desc'),
      to: '/settings/system/developer',
    },
    {
      icon: 'solar:clock-circle-bold-duotone',
      title: t('settings.system_section.automation'),
      description: t('settings.system_section.automation_desc'),
      to: '/settings/system/automation',
    },
    {
      icon: 'solar:keyboard-bold-duotone',
      title: t('settings.system_section.shortcuts'),
      description: t('settings.system_section.shortcuts_desc'),
      to: '/settings/system/shortcuts',
    },
    {
      icon: 'solar:folder-bold-duotone',
      title: t('settings.system_section.files'),
      description: t('settings.system_section.files_desc'),
      to: '/settings/system/files',
    },
    {
      icon: 'solar:box-bold-duotone',
      title: t('settings.system_section.storage'),
      description: t('settings.system_section.storage_desc'),
      to: '/settings/system/storage',
    },
    {
      icon: 'solar:info-circle-bold-duotone',
      title: t('settings.system_section.about'),
      description: t('settings.system_section.about_desc'),
      to: '/settings/system/about',
    },
  ];

  return (
    <div className="flex flex-col gap-4 font-normal pb-4 animate-[fade-in-up_0.3s_ease-out]">
      <div className="h-4" />
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

export default SystemIndex;
