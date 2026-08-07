import { useTranslation } from 'react-i18next';
import { IconItem } from '../../components';

/**
 * 服务来源模块二级入口列表。
 */
export function ServicesIndex() {
  const { t } = useTranslation();

  const entries = [
    {
      icon: 'solar:chat-round-dots-bold-duotone',
      title: t('settings.services_section.llm'),
      description: t('settings.services_section.llm_desc'),
      to: '/settings/services/llm',
    },
    {
      icon: 'solar:speaker-bold-duotone',
      title: t('settings.services_section.tts'),
      description: t('settings.services_section.tts_desc'),
      to: '/settings/services/tts',
    },
    {
      icon: 'solar:microphone-bold-duotone',
      title: t('settings.services_section.stt'),
      description: t('settings.services_section.stt_desc'),
      to: '/settings/services/stt',
    },
    {
      icon: 'solar:database-bold-duotone',
      title: t('settings.services_section.embedding', 'Embedding'),
      description: t('settings.services_section.embedding_desc', '向量模型配置，用于混合检索'),
      to: '/settings/services/embedding',
    },
    {
      icon: 'solar:camera-bold-duotone',
      title: t('settings.services_section.multimodal'),
      description: t('settings.services_section.multimodal_desc'),
      to: '/settings/services/multimodal',
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

export default ServicesIndex;
