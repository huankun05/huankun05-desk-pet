import { useTranslation } from 'react-i18next';
import { IconItem } from '../../components';

/**
 * 扩展模块二级入口列表（MCP、语音唤醒、插件）。
 */
export function ExtensionsIndex() {
  const { t } = useTranslation();

  const entries = [
    {
      icon: 'solar:server-square-cloud-bold-duotone',
      title: t('settings.services_section.mcp'),
      description: t('settings.services_section.mcp_desc'),
      to: '/settings/extensions/mcp',
    },
    {
      icon: 'solar:soundwave-bold-duotone',
      title: t('settings.services_section.wake_word'),
      description: t('settings.services_section.wake_word_desc'),
      to: '/settings/extensions/wake-word',
    },
    {
      icon: 'solar:plug-circle-bold-duotone',
      title: t('settings.plugins_section.title'),
      description: t('settings.plugins_section.desc'),
      to: '/settings/extensions/plugins',
    },
    {
      icon: 'solar:widget-5-bold-duotone',
      title: t('settings.tools.title'),
      description: t('settings.tools.desc'),
      to: '/settings/extensions/tools',
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

export default ExtensionsIndex;
