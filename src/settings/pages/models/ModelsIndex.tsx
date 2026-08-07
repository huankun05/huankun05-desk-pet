import { useTranslation } from 'react-i18next';
import { IconItem } from '../../components';

/**
 * 角色模型模块二级入口列表。
 * 已合并模型切换与参数调整为单页面。
 */
export function ModelsIndex() {
  const { t } = useTranslation();

  const entries = [
    {
      icon: 'solar:gallery-bold-duotone',
      title: t('settings.models.live2d'),
      description: t('settings.models.live2d_desc'),
      to: '/settings/models/live2d',
    },
    {
      icon: 'solar:user-circle-bold-duotone',
      title: t('settings.models.character_list_title'),
      description: t('settings.models.character_list_desc'),
      to: '/settings/models/character',
    },
    {
      icon: 'solar:user-heart-bold-duotone',
      title: t('settings.models.behavior'),
      description: t('settings.models.behavior_desc'),
      to: '/settings/models/behavior',
    },
    {
      icon: 'solar:emoji-funny-circle-bold-duotone',
      title: t('settings.models.emotion'),
      description: t('settings.models.emotion_desc'),
      to: '/settings/models/emotion',
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

export default ModelsIndex;
