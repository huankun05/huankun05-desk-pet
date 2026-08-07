import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, SettingRow, SliderRow, Segmented, SettingsJumpButton } from '../../components';
import {
  CHAT_ACCENT_PRESETS,
  isSystemDark,
  readAppearance,
  writeAppearanceConfig,
  type ChatTheme,
} from '../../appearanceConfig';
import { ChatAvatar } from '../../../components/Chat/ChatAvatar';
import '../../../components/Chat/chat-theme.css';

const AVATAR_MAX_BYTES = 1024 * 1024; // 1MB
const BG_MAX_BYTES = 4 * 1024 * 1024; // 4MB

/** 读取本地图片为 data URL；超过上限返回 null */
function readImageAsDataUrl(file: File, maxBytes: number): Promise<string | null> {
  if (file.size > maxBytes) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/** 小尺寸操作按钮（与设置页整体风格一致） */
function MiniButton({
  children,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        tone === 'danger'
          ? 'rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-50'
          : 'rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-50'
      }
    >
      {children}
    </button>
  );
}

/**
 * 聊天外观设置。
 *
 * ⚠️ 与「设置 → 外观 → 气泡」是两套完全独立的配置：
 * 那边控制的是桌宠头顶飘出来的说话气泡，这里控制的是控制面板里的聊天窗口。
 * 之前这页错误地跳到了桌宠气泡页，已改为在页面底部作为「相关设置」明确区分。
 */
export function ChatAppearancePage() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState(() => readAppearance());
  const bgRef = useRef<HTMLInputElement>(null);
  const userAvatarRef = useRef<HTMLInputElement>(null);
  const aiAvatarRef = useRef<HTMLInputElement>(null);

  const update = (patch: Parameters<typeof writeAppearanceConfig>[0]) => {
    setCfg((prev) => ({ ...prev, ...patch }));
    writeAppearanceConfig(patch);
  };

  const pickImage = async (
    e: React.ChangeEvent<HTMLInputElement>,
    maxBytes: number,
    apply: (dataUrl: string) => void,
    tooLargeMsg: string,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await readImageAsDataUrl(file, maxBytes);
    if (!dataUrl) {
      alert(tooLargeMsg);
      return;
    }
    apply(dataUrl);
  };

  const resolvedTheme: 'light' | 'dark' =
    cfg.chatTheme === 'follow' ? (isSystemDark() ? 'dark' : 'light') : cfg.chatTheme;

  const themeOptions: { value: ChatTheme; label: string }[] = [
    { value: 'follow', label: t('settings.chat.theme_follow', { defaultValue: '跟随系统' }) },
    { value: 'light', label: t('settings.chat.theme_light', { defaultValue: '浅色' }) },
    { value: 'dark', label: t('settings.chat.theme_dark', { defaultValue: '深色' }) },
  ];

  const bubbleStyle = (isUser: boolean): React.CSSProperties => ({
    padding: '8px 12px',
    borderRadius: `${cfg.chatBubbleRadius}px`,
    background: isUser ? 'var(--bubble-user-bg)' : 'var(--bubble-ai-bg)',
    color: isUser ? 'var(--bubble-user-text)' : 'var(--bubble-ai-text)',
    border: isUser ? '1px solid transparent' : '1px solid var(--glass-border)',
    boxShadow: 'var(--shadow-sm)',
    fontSize: `${cfg.chatFontSize}px`,
    lineHeight: 1.55,
    maxWidth: '72%',
  });

  const bubbleClass = (isUser: boolean) =>
    `chat-bubble ${isUser ? 'chat-bubble--user' : 'chat-bubble--ai'}${
      cfg.chatBubbleTail ? '' : ' chat-bubble--flat'
    }`;

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 明确边界：这页只管聊天窗口 */}
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-[var(--primary-200)] bg-[var(--primary-50)]/60 px-4 py-3">
        <Icon
          icon="solar:info-circle-bold"
          className="mt-0.5 shrink-0 text-base text-[var(--primary-500)]"
        />
        <p className="text-xs leading-relaxed text-neutral-600">
          {t('settings.chat.appearance_scope_hint', {
            defaultValue:
              '这里的设置只作用于控制面板中的「聊天窗口」，与桌宠头顶的说话气泡、以及应用全局主题互不影响。',
          })}
        </p>
      </div>

      {/* 实时预览：直接复用聊天窗口的 CSS 变量，所见即所得 */}
      <Section
        title={t('settings.chat.preview_title', { defaultValue: '实时预览' })}
        description={t('settings.chat.preview_desc', {
          defaultValue: '下方效果与聊天窗口完全一致',
        })}
      >
        <div className="p-4">
          <div
            className="chat-root overflow-hidden rounded-xl border border-neutral-200"
            data-chat-theme={resolvedTheme}
            style={{ ['--accent' as string]: cfg.chatAccent }}
          >
            <div
              style={{
                background: 'var(--chat-bg)',
                backgroundImage: cfg.chatBackgroundImage
                  ? `url(${cfg.chatBackgroundImage})`
                  : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                padding: '14px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                {cfg.chatShowAvatar && <ChatAvatar role="assistant" src={cfg.chatAiAvatar} />}
                <div className={bubbleClass(false)} style={bubbleStyle(false)}>
                  {t('settings.chat.preview_ai', { defaultValue: '在的，有什么可以帮你的吗？' })}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row-reverse',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                {cfg.chatShowAvatar && <ChatAvatar role="user" src={cfg.chatUserAvatar} />}
                <div className={bubbleClass(true)} style={bubbleStyle(true)}>
                  {t('settings.chat.preview_user', { defaultValue: '帮我总结一下今天的待办' })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* 配色 */}
      <Section
        title={t('settings.chat.color_title', { defaultValue: '配色' })}
        description={t('settings.chat.color_desc', { defaultValue: '聊天窗口的深浅配色与主色' })}
      >
        <SettingRow
          title={t('settings.chat.theme', { defaultValue: '窗口配色' })}
          description={t('settings.chat.theme_desc', {
            defaultValue: '默认浅色；选择「跟随系统」时随系统深浅色切换',
          })}
        >
          <Segmented
            options={themeOptions}
            value={cfg.chatTheme}
            onChange={(v) => update({ chatTheme: v })}
          />
        </SettingRow>

        <SettingRow
          title={t('settings.chat.accent', { defaultValue: '主色' })}
          description={t('settings.chat.accent_desc', {
            defaultValue: '用于自己发出的气泡、按钮高亮等',
          })}
        >
          <div className="flex items-center gap-2">
            {CHAT_ACCENT_PRESETS.map((preset) => {
              const active = cfg.chatAccent.toLowerCase() === preset.value.toLowerCase();
              return (
                <button
                  key={preset.value}
                  type="button"
                  title={preset.label}
                  onClick={() => update({ chatAccent: preset.value })}
                  className={`h-6 w-6 rounded-full transition-transform ${
                    active
                      ? 'ring-2 ring-offset-2 ring-neutral-400 scale-110'
                      : 'hover:scale-110 opacity-80'
                  }`}
                  style={{ background: preset.value }}
                />
              );
            })}
            <input
              type="color"
              value={cfg.chatAccent}
              onChange={(e) => update({ chatAccent: e.target.value })}
              title={t('settings.chat.accent_custom', { defaultValue: '自定义颜色' })}
              className="h-6 w-8 cursor-pointer rounded border border-neutral-200 bg-white p-0.5"
            />
          </div>
        </SettingRow>
      </Section>

      {/* 气泡与字号 */}
      <Section
        title={t('settings.chat.bubble_style_title', { defaultValue: '气泡与字号' })}
        description={t('settings.chat.bubble_style_desc', {
          defaultValue: '聊天气泡的圆角、尾巴与文字大小',
        })}
      >
        <SliderRow
          label={t('settings.chat.bubble_radius', { defaultValue: '气泡圆角' })}
          desc={t('settings.chat.bubble_radius_desc', {
            defaultValue: '数值越大越圆润，QQ 默认 12px',
          })}
          min={4}
          max={20}
          step={1}
          unit="px"
          value={cfg.chatBubbleRadius}
          onChange={(v) => update({ chatBubbleRadius: v })}
        />
        <SettingRow
          title={t('settings.chat.bubble_tail', { defaultValue: '气泡尾巴' })}
          description={t('settings.chat.bubble_tail_desc', {
            defaultValue: '在气泡靠近头像的一侧显示小尖角',
          })}
        >
          <button
            type="button"
            onClick={() => update({ chatBubbleTail: !cfg.chatBubbleTail })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              cfg.chatBubbleTail ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                cfg.chatBubbleTail ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </SettingRow>
        <SliderRow
          label={t('settings.chat.font_size', { defaultValue: '聊天字体大小' })}
          desc={t('settings.chat.font_size_desc', { defaultValue: '调整聊天窗口字体大小' })}
          min={12}
          max={22}
          step={1}
          unit="px"
          value={cfg.chatFontSize}
          onChange={(v) => update({ chatFontSize: v })}
        />
      </Section>

      {/* 头像 */}
      <Section
        title={t('settings.chat.avatar_title', { defaultValue: '头像' })}
        description={t('settings.chat.avatar_desc', {
          defaultValue: 'AI 默认使用桌宠形象，用户头像可自行上传',
        })}
      >
        <SettingRow
          title={t('settings.chat.show_avatar', { defaultValue: '显示头像' })}
          description={t('settings.chat.show_avatar_desc', {
            defaultValue: '关闭后消息将紧贴窗口边缘，更紧凑',
          })}
        >
          <button
            type="button"
            onClick={() => update({ chatShowAvatar: !cfg.chatShowAvatar })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              cfg.chatShowAvatar ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                cfg.chatShowAvatar ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </SettingRow>

        <SettingRow
          title={t('settings.chat.user_avatar', { defaultValue: '我的头像' })}
          description={t('settings.chat.user_avatar_desc', {
            defaultValue: '支持 jpg/png，建议 1MB 以内的方形图片',
          })}
        >
          <div className="flex items-center gap-2">
            <ChatAvatar role="user" src={cfg.chatUserAvatar} size={32} />
            <MiniButton onClick={() => userAvatarRef.current?.click()}>
              {t('settings.chat.upload', { defaultValue: '上传图片' })}
            </MiniButton>
            {cfg.chatUserAvatar && (
              <MiniButton tone="danger" onClick={() => update({ chatUserAvatar: '' })}>
                {t('settings.chat.reset_avatar', { defaultValue: '恢复默认' })}
              </MiniButton>
            )}
            <input
              ref={userAvatarRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) =>
                void pickImage(
                  e,
                  AVATAR_MAX_BYTES,
                  (url) => update({ chatUserAvatar: url }),
                  t('settings.chat.avatar_too_large', {
                    defaultValue: '头像图片过大，建议 1MB 以内',
                  }),
                )
              }
            />
          </div>
        </SettingRow>

        <SettingRow
          title={t('settings.chat.ai_avatar', { defaultValue: 'AI 头像' })}
          description={t('settings.chat.ai_avatar_desc', {
            defaultValue: '留空则使用当前桌宠形象',
          })}
        >
          <div className="flex items-center gap-2">
            <ChatAvatar role="assistant" src={cfg.chatAiAvatar} size={32} />
            <MiniButton onClick={() => aiAvatarRef.current?.click()}>
              {t('settings.chat.upload', { defaultValue: '上传图片' })}
            </MiniButton>
            {cfg.chatAiAvatar && (
              <MiniButton tone="danger" onClick={() => update({ chatAiAvatar: '' })}>
                {t('settings.chat.use_pet_avatar', { defaultValue: '用桌宠形象' })}
              </MiniButton>
            )}
            <input
              ref={aiAvatarRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) =>
                void pickImage(
                  e,
                  AVATAR_MAX_BYTES,
                  (url) => update({ chatAiAvatar: url }),
                  t('settings.chat.avatar_too_large', {
                    defaultValue: '头像图片过大，建议 1MB 以内',
                  }),
                )
              }
            />
          </div>
        </SettingRow>
      </Section>

      {/* 聊天背景 */}
      <Section
        title={t('settings.chat.bg_title', { defaultValue: '聊天背景' })}
        description={t('settings.chat.bg_desc', { defaultValue: '自定义聊天背景图片' })}
      >
        <SettingRow
          title={t('settings.chat.bg_upload', { defaultValue: '上传背景' })}
          description={t('settings.chat.bg_upload_desc', {
            defaultValue: '支持 jpg/png，建议 4MB 以内',
          })}
        >
          <div className="flex items-center gap-2">
            {cfg.chatBackgroundImage && (
              <div
                className="h-8 w-12 rounded border border-neutral-200 bg-cover bg-center"
                style={{ backgroundImage: `url(${cfg.chatBackgroundImage})` }}
              />
            )}
            <MiniButton onClick={() => bgRef.current?.click()}>
              {t('settings.chat.upload', { defaultValue: '上传图片' })}
            </MiniButton>
            {cfg.chatBackgroundImage && (
              <MiniButton tone="danger" onClick={() => update({ chatBackgroundImage: '' })}>
                {t('settings.chat.remove_bg', { defaultValue: '移除背景' })}
              </MiniButton>
            )}
            <input
              ref={bgRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) =>
                void pickImage(
                  e,
                  BG_MAX_BYTES,
                  (url) => update({ chatBackgroundImage: url }),
                  t('settings.chat.bg_too_large', {
                    defaultValue: '背景图片过大，建议 4MB 以内',
                  }),
                )
              }
            />
          </div>
        </SettingRow>
      </Section>

      {/* 相关设置：明确区分「聊天气泡」与「桌宠气泡」 */}
      <Section
        title={t('settings.related_settings', { defaultValue: '相关设置' })}
        description={t('settings.chat.related_desc', {
          defaultValue: '以下设置不属于聊天窗口，但常被一起调整',
        })}
      >
        <div className="space-y-2 p-4">
          <SettingsJumpButton
            to="/settings/appearance/bubble"
            label={t('settings.appearance_section.bubble', { defaultValue: '桌宠气泡' })}
            icon="solar:chat-square-quote-bold-duotone"
            hint={t('settings.chat.jump_pet_bubble_hint', {
              defaultValue: '桌宠头顶飘出的说话气泡（与聊天窗口气泡是两套配置）',
            })}
          />
          <SettingsJumpButton
            to="/settings/appearance/general"
            label={t('settings.chat.jump_global_theme', { defaultValue: '应用主题' })}
            icon="solar:pallete-2-bold-duotone"
            hint={t('settings.chat.jump_global_theme_hint', {
              defaultValue: '设置窗口与控制面板的整体配色',
            })}
          />
          <SettingsJumpButton
            to="/settings/services/llm"
            label={t('settings.chat.jump_model', { defaultValue: '模型服务' })}
            icon="solar:cpu-bolt-bold-duotone"
            hint={t('settings.chat.jump_model_hint', {
              defaultValue: '聊天使用的大模型、API Key 与参数',
            })}
          />
        </div>
      </Section>
    </div>
  );
}

export default ChatAppearancePage;
