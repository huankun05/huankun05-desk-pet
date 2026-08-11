import { useTranslation } from 'react-i18next';
import { IconItem } from '../components';

/**
 * 设置首页：列出所有一级设置入口（按 order 排序）。
 * 右下角附带装饰性大齿轮图标（旋转入场动画）。
 */
export function IndexPage() {
  const { t } = useTranslation();

  const entries = [
    {
      order: 1,
      icon: 'solar:pallete-2-bold-duotone',
      title: t('settings.nav.appearance'),
      description: t('settings.index.appearance_desc'),
      to: '/settings/appearance',
    },
    {
      order: 2,
      icon: 'solar:document-text-bold-duotone',
      title: t('settings.nav.chat'),
      description: t('settings.index.chat_desc'),
      to: '/settings/chat',
    },
    {
      order: 3,
      icon: 'solar:document-add-bold-duotone',
      title: t('settings.nav.models'),
      description: t('settings.index.models_desc'),
      to: '/settings/models',
    },
    {
      order: 4,
      icon: 'solar:server-bold-duotone',
      title: t('settings.nav.services'),
      description: t('settings.index.services_desc'),
      to: '/settings/services',
    },
    {
      order: 5,
      icon: 'solar:widget-5-bold-duotone',
      title: t('settings.nav.extensions'),
      description: t('settings.index.extensions_desc'),
      to: '/settings/extensions',
    },
    {
      order: 6,
      icon: 'solar:database-bold-duotone',
      title: t('settings.nav.memory'),
      description: t('settings.index.memory_desc'),
      to: '/settings/memory',
    },
    {
      order: 7,
      icon: 'solar:filters-bold-duotone',
      title: t('settings.nav.system'),
      description: t('settings.index.system_desc'),
      to: '/settings/system',
    },
  ];

  const sorted = [...entries].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col gap-4 font-normal pb-12 animate-[fade-in-up_0.3s_ease-out]">
      <div />
      <div className="flex flex-col gap-4">
        {sorted.map((entry, index) => (
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

export default IndexPage;
