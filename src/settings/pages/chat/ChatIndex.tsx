import { useTranslation } from 'react-i18next';
import { IconItem } from '../../components';

/**
 * 聊天设置总入口。
 *
 * 这里管理的是「控制面板里的聊天窗口」，与桌宠气泡 / 全局主题是两套独立配置：
 * 聊天外观只影响聊天窗口，桌宠气泡请走 设置 → 外观 → 气泡。
 */
export function ChatIndex() {
  const { t } = useTranslation();

  const entries = [
    {
      icon: 'solar:pallete-2-bold-duotone',
      title: t('settings.chat.appearance_title', { defaultValue: '聊天外观' }),
      description: t('settings.chat.appearance_desc', {
        defaultValue: '头像、气泡、背景、配色与字号',
      }),
      to: '/settings/chat/appearance',
    },
    {
      icon: 'solar:keyboard-bold-duotone',
      title: t('settings.chat.input_title', { defaultValue: '输入与命令' }),
      description: t('settings.chat.input_desc', {
        defaultValue: '发送快捷键、Slash 自动补全、附件行为',
      }),
      to: '/settings/chat/input',
    },
    {
      icon: 'solar:microphone-bold-duotone',
      title: t('settings.chat.voice_title', { defaultValue: '语音' }),
      description: t('settings.chat.voice_desc', { defaultValue: 'TTS、STT、唤醒词' }),
      to: '/settings/chat/voice',
    },
    {
      icon: 'solar:settings-bold-duotone',
      title: t('settings.chat.modes_title', { defaultValue: '模式' }),
      description: t('settings.chat.modes_desc', { defaultValue: '工作模式/聊天模式切换' }),
      to: '/settings/chat/modes',
    },
    {
      icon: 'solar:folder-with-files-bold-duotone',
      title: t('settings.chat.session_title', { defaultValue: '会话与数据' }),
      description: t('settings.chat.session_desc', {
        defaultValue: '历史会话、收藏消息、数据清理',
      }),
      to: '/settings/chat/session',
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

export default ChatIndex;
