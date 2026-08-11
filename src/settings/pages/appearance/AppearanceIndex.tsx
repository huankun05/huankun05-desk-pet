import { useTranslation } from 'react-i18next';
import { IconItem } from '../../components';

/**
 * 外观模块二级入口列表。
 */
export function AppearanceIndex() {
  const { t } = useTranslation();

  const entries = [
    {
      icon: 'solar:emoji-funny-square-bold-duotone',
      title: t('settings.appearance_section.general'),
      description: t('settings.appearance_section.general_desc'),
      to: '/settings/appearance/general',
    },
    {
      icon: 'solar:hand-stars-bold-duotone',
      title: t('settings.appearance_section.interaction'),
      description: t('settings.appearance_section.interaction_desc'),
      to: '/settings/appearance/interaction',
    },
    {
      icon: 'solar:document-text-bold-duotone',
      title: t('settings.appearance_section.bubble'),
      description: t('settings.appearance_section.bubble_desc'),
      to: '/settings/appearance/bubble',
    },
    {
      icon: 'solar:monitor-bold-duotone',
      title: t('settings.appearance_section.performance'),
      description: t('settings.appearance_section.performance_desc'),
      to: '/settings/appearance/performance',
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

export default AppearanceIndex;
