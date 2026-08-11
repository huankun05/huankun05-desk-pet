import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { Section, SettingRow, Switch, SliderRow, useToast } from '../../components';
import {
  IDLE_MESSAGES,
  INTERACT_MESSAGES,
  type IdleMessage,
} from '../../../data/idleMessages';

// ===== 持久化键 =====
const INTERACTION_CONFIG_KEY = 'deskpet_interaction_config';

export interface InteractionConfig {
  /** 点击语言冷却时间（毫秒） */
  clickCooldownMs: number;
  /** 是否启用预制台词 TTS */
  enableInteractTTS: number;
}

export const DEFAULT_INTERACTION_CONFIG: InteractionConfig = {
  clickCooldownMs: 3000,
  enableInteractTTS: 0,
};

/** 读取交互配置 */
export function loadInteractionConfig(): InteractionConfig {
  try {
    const raw = localStorage.getItem(INTERACTION_CONFIG_KEY);
    if (raw) return { ...DEFAULT_INTERACTION_CONFIG, ...(JSON.parse(raw) as Partial<InteractionConfig>) };
  } catch { /* ignore */ }
  return { ...DEFAULT_INTERACTION_CONFIG };
}

/** 保存交互配置 */
export function saveInteractionConfig(config: InteractionConfig): void {
  localStorage.setItem(INTERACTION_CONFIG_KEY, JSON.stringify(config));
}

// ===== 自定义消息持久化 =====
const CUSTOM_MESSAGES_KEY = 'deskpet_custom_messages';

interface CustomMessages {
  idle?: IdleMessage[];
  interact?: Partial<typeof INTERACT_MESSAGES>;
}

function loadCustomMessages(): CustomMessages {
  try {
    const raw = localStorage.getItem(CUSTOM_MESSAGES_KEY);
    if (raw) return JSON.parse(raw) as CustomMessages;
  } catch { /* ignore */ }
  return {};
}

function saveCustomMessages(msgs: CustomMessages): void {
  localStorage.setItem(CUSTOM_MESSAGES_KEY, JSON.stringify(msgs));
}

/**
 * 交互消息管理页
 *
 * 功能：
 * 1. 点击反馈消息编辑（摸头/点身体/踩脚/连点/久未互动）
 * 2. 闲聊消息池编辑（通用/时段/情感相关）
 * 3. 点击冷却时间设置
 * 4. 预制台词 TTS 开关
 */

type EditTab = 'interact' | 'idle' | 'settings';

export function InteractionPage() {
  const { showToast } = useToast();

  // 配置状态
  const [config, setConfig] = useState<InteractionConfig>(() => loadInteractionConfig());
  // 自定义消息
  const [customMessages, setCustomMessages] = useState<CustomMessages>(() => loadCustomMessages());
  // 当前编辑标签
  const [activeTab, setActiveTab] = useState<EditTab>('interact');
  // 编辑中的分组
  const [editingGroup, setEditingGroup] = useState<string | null>(null);

  // 监听跨窗口同步
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === INTERACTION_CONFIG_KEY) setConfig(loadInteractionConfig());
      if (e.key === CUSTOM_MESSAGES_KEY) setCustomMessages(loadCustomMessages());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updateConfig = useCallback((patch: Partial<InteractionConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveInteractionConfig(next);
      return next;
    });
  }, []);

  // 获取实际使用的互动消息（自定义 > 默认）
  const getInteractMessages = useCallback(
    (key: keyof typeof INTERACT_MESSAGES): string[] => {
      return customMessages.interact?.[key] ?? INTERACT_MESSAGES[key];
    },
    [customMessages.interact],
  );

  // 更新互动消息
  const updateInteractMessage = useCallback(
    (key: keyof typeof INTERACT_MESSAGES, index: number, value: string) => {
      const current = getInteractMessages(key);
      const updated = [...current];
      updated[index] = value;
      const next = { ...customMessages, interact: { ...customMessages.interact, [key]: updated } };
      setCustomMessages(next);
      saveCustomMessages(next);
    },
    [customMessages, getInteractMessages],
  );

  // 添加互动消息
  const addInteractMessage = useCallback(
    (key: keyof typeof INTERACT_MESSAGES) => {
      const current = getInteractMessages(key);
      const next = {
        ...customMessages,
        interact: { ...customMessages.interact, [key]: [...current, '新消息'] },
      };
      setCustomMessages(next);
      saveCustomMessages(next);
    },
    [customMessages, getInteractMessages],
  );

  // 删除互动消息
  const removeInteractMessage = useCallback(
    (key: keyof typeof INTERACT_MESSAGES, index: number) => {
      const current = getInteractMessages(key);
      if (current.length <= 1) {
        showToast('至少保留一条消息', 'warning');
        return;
      }
      const updated = current.filter((_, i) => i !== index);
      const next = { ...customMessages, interact: { ...customMessages.interact, [key]: updated } };
      setCustomMessages(next);
      saveCustomMessages(next);
    },
    [customMessages, getInteractMessages, showToast],
  );

  // 重置互动消息为默认
  const resetInteractMessages = useCallback(
    (key: keyof typeof INTERACT_MESSAGES) => {
      const next = { ...customMessages, interact: { ...customMessages.interact, [key]: undefined } };
      delete next.interact![key];
      setCustomMessages(next);
      saveCustomMessages(next);
      showToast('已重置为默认', 'success');
    },
    [customMessages, showToast],
  );

  // 获取实际使用的闲聊消息
  const getIdleMessages = useCallback((): IdleMessage[] => {
    return customMessages.idle ?? IDLE_MESSAGES;
  }, [customMessages.idle]);

  // 更新闲聊消息
  const updateIdleMessage = useCallback(
    (groupIndex: number, msgIndex: number, value: string) => {
      const current = getIdleMessages();
      const updated = current.map((g, gi) =>
        gi === groupIndex ? { ...g, messages: g.messages.map((m, mi) => (mi === msgIndex ? value : m)) } : g,
      );
      const next = { ...customMessages, idle: updated };
      setCustomMessages(next);
      saveCustomMessages(next);
    },
    [customMessages, getIdleMessages],
  );

  // 添加闲聊消息
  const addIdleMessage = useCallback(
    (groupIndex: number) => {
      const current = getIdleMessages();
      const updated = current.map((g, gi) =>
        gi === groupIndex ? { ...g, messages: [...g.messages, '新消息'] } : g,
      );
      const next = { ...customMessages, idle: updated };
      setCustomMessages(next);
      saveCustomMessages(next);
    },
    [customMessages, getIdleMessages],
  );

  // 删除闲聊消息
  const removeIdleMessage = useCallback(
    (groupIndex: number, msgIndex: number) => {
      const current = getIdleMessages();
      const group = current[groupIndex];
      if (group.messages.length <= 1) {
        showToast('该组至少保留一条消息', 'warning');
        return;
      }
      const updated = current.map((g, gi) =>
        gi === groupIndex ? { ...g, messages: g.messages.filter((_, mi) => mi !== msgIndex) } : g,
      );
      const next = { ...customMessages, idle: updated };
      setCustomMessages(next);
      saveCustomMessages(next);
    },
    [customMessages, getIdleMessages, showToast],
  );

  const tabs: { key: EditTab; label: string; icon: string }[] = [
    { key: 'interact', label: '点击反馈', icon: 'solar:hand-stars-bold-duotone' },
    { key: 'idle', label: '闲聊消息', icon: 'solar:document-text-bold-duotone' },
    { key: 'settings', label: '交互设置', icon: 'solar:settings-bold-duotone' },
  ];

  const interactKeys: { key: keyof typeof INTERACT_MESSAGES; label: string; desc: string }[] = [
    { key: 'headPat', label: '摸头反馈', desc: '点击角色头部时显示的消息' },
    { key: 'bodyTap', label: '点身体反馈', desc: '点击角色身体时显示的消息' },
    { key: 'stepFoot', label: '踩脚反馈', desc: '点击角色脚部时显示的消息' },
    { key: 'tooMuchClick', label: '连点反馈', desc: '短时间内连续点击过多时显示' },
    { key: 'longNoInteract', label: '久未互动', desc: '长时间未与角色互动时显示' },
  ];

  return (
    <div className="flex flex-col gap-5 pb-12 animate-[fade-in-up_0.3s_ease-out]">
      {/* 标签切换 */}
      <div className="rounded-xl border border-neutral-200 bg-white p-1 flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-indigo-50 text-indigo-600'
                : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700'
            }`}
          >
            <Icon icon={tab.icon} className="text-base" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===== 点击反馈消息编辑 ===== */}
      {activeTab === 'interact' && (
        <>
          {interactKeys.map(({ key, label, desc }) => {
            const messages = getInteractMessages(key);
            const isExpanded = editingGroup === key;

            return (
              <Section key={key} title={label} description={desc}>
                <div className="p-4 space-y-2">
                  {/* 预览：折叠时只显示前两条 */}
                  {!isExpanded && (
                    <div className="space-y-1.5">
                      {messages.slice(0, 2).map((msg, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600"
                        >
                          <Icon icon="solar:chat-round-line-linear" className="shrink-0 text-neutral-400" />
                          <span className="truncate">{msg}</span>
                        </div>
                      ))}
                      {messages.length > 2 && (
                        <div className="text-xs text-neutral-400 pl-5">还有 {messages.length - 2} 条...</div>
                      )}
                    </div>
                  )}

                  {/* 展开：完整编辑列表 */}
                  {isExpanded && (
                    <div className="space-y-2">
                      {messages.map((msg, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md bg-indigo-50 text-xs font-medium text-indigo-500">
                            {i + 1}
                          </span>
                          <input
                            value={msg}
                            onChange={(e) => updateInteractMessage(key, i, e.target.value)}
                            className="flex-1 min-w-0 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none transition-colors focus:border-indigo-300"
                            placeholder={`消息 ${i + 1}`}
                          />
                          <button
                            type="button"
                            onClick={() => removeInteractMessage(key, i)}
                            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-red-100 text-red-400 transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <Icon icon="solar:trash-bin-minimalistic-bold" className="text-sm" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addInteractMessage(key)}
                        className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-600 transition-colors"
                      >
                        <Icon icon="solar:add-circle-bold" className="text-sm" />
                        添加消息
                      </button>
                    </div>
                  )}

                  {/* 操作按钮行 */}
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingGroup(isExpanded ? null : key)}
                      className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
                    >
                      <Icon
                        icon={isExpanded ? 'solar:alt-arrow-up-bold' : 'solar:alt-arrow-down-bold'}
                        className="text-sm"
                      />
                      {isExpanded ? '收起' : `编辑 (${messages.length} 条)`}
                    </button>

                    {customMessages.interact?.[key] && (
                      <button
                        type="button"
                        onClick={() => resetInteractMessages(key)}
                        className="flex items-center gap-1 text-xs text-amber-500 hover:text-amber-600 transition-colors"
                      >
                        <Icon icon="solar:refresh-bold" className="text-sm" />
                        重置默认
                      </button>
                    )}
                  </div>
                </div>
              </Section>
            );
          })}
        </>
      )}

      {/* ===== 闲聊消息池编辑 ===== */}
      {activeTab === 'idle' && (
        <>
          {getIdleMessages().map((group, gi) => {
            const isExpanded = editingGroup === `idle-${gi}`;
            const groupLabel =
              group.time ?? group.emotion ?? (gi === 0 ? '通用闲聊' : `分组 ${gi + 1}`);
            const groupEmoji = group.time
              ? getTimeEmoji(group.time)
              : group.emotion
                ? getEmotionEmoji(group.emotion)
                : '💬';

            return (
              <Section
                key={gi}
                title={`${groupEmoji} ${groupLabel}`}
                description={`${group.messages.length} 条消息`}
              >
                <div className="p-4 space-y-2">
                  {isExpanded && (
                    <div className="space-y-2">
                      {group.messages.map((msg, mi) => (
                        <div key={mi} className="flex items-center gap-2">
                          <span className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md bg-green-50 text-xs font-medium text-green-500">
                            {mi + 1}
                          </span>
                          <input
                            value={msg}
                            onChange={(e) => updateIdleMessage(gi, mi, e.target.value)}
                            className="flex-1 min-w-0 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none transition-colors focus:border-green-300"
                            placeholder="输入闲聊消息..."
                          />
                          <button
                            type="button"
                            onClick={() => removeIdleMessage(gi, mi)}
                            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-red-100 text-red-400 transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <Icon icon="solar:trash-bin-minimalistic-bold" className="text-sm" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addIdleMessage(gi)}
                        className="flex items-center gap-1.5 text-xs text-green-500 hover:text-green-600 transition-colors"
                      >
                        <Icon icon="solar:add-circle-bold" className="text-sm" />
                        添加消息
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingGroup(isExpanded ? null : `idle-${gi}`)}
                      className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
                    >
                      <Icon
                        icon={isExpanded ? 'solar:alt-arrow-up-bold' : 'solar:alt-arrow-down-bold'}
                        className="text-sm"
                      />
                      {isExpanded ? '收起' : '编辑'}
                    </button>
                  </div>
                </div>
              </Section>
            );
          })}

          {/* 全部重置按钮 */}
          {customMessages.idle && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => {
                  const next = { ...customMessages, idle: undefined };
                  setCustomMessages(next);
                  saveCustomMessages(next);
                  showToast('已重置所有闲聊消息为默认', 'success');
                }}
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-600 transition-colors hover:bg-amber-100"
              >
                <Icon icon="solar:refresh-bold" className="inline mr-1" />
                重置全部为默认
              </button>
            </div>
          )}
        </>
      )}

      {/* ===== 交互设置 ===== */}
      {activeTab === 'settings' && (
        <>
          <Section
            title="点击冷却"
            description="连续点击时的语言触发间隔，冷却期内动作仍生效但不重复播放语音气泡"
          >
            <SliderRow
              label="冷却时间"
              value={config.clickCooldownMs}
              min={1000}
              max={10000}
              step={500}
              unit="ms"
              desc="3000ms = 3秒内只触发一次语言"
              onChange={(v) => updateConfig({ clickCooldownMs: v })}
            />
          </Section>

          <Section
            title="预制台词语音"
            description="开启后，点击反馈和闲聊消息会通过 TTS 引擎预生成音频，在显示气泡时同时播放语音"
          >
            <div className="p-4 space-y-3">
              <SettingRow title="启用预制台词 TTS" description="需要先配置 TTS 引擎">
                <Switch
                  checked={config.enableInteractTTS === 1}
                  onClick={() => updateConfig({ enableInteractTTS: config.enableInteractTTS === 1 ? 0 : 1 })}
                />
              </SettingRow>

              {config.enableInteractTTS === 1 && (
                <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <Icon icon="solar:info-circle-bold" className="text-indigo-400 mt-0.5" />
                    <div className="text-xs text-indigo-600 leading-relaxed">
                      <p className="font-medium mb-1">TTS 预生成说明</p>
                      <ul className="list-disc list-inside space-y-0.5 text-indigo-500">
                        <li>首次使用时会批量生成所有预制台词的音频</li>
                        <li>修改消息内容后会自动重新生成对应音频</li>
                        <li>音频缓存于本地，无需每次联网</li>
                        <li>可在「服务 → 语音合成」中配置 TTS 引擎</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Section>

          <Section title="LLM 主动闲聊诊断" description="检查 LLM 主动聊天功能是否正常工作">
            <div className="p-4 space-y-3">
              <LLMChatDiagnostic />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

// ===== 辅助组件 =====

function LLMChatDiagnostic() {
  const computeDiagnostic = useCallback((): {
    smartChatEnabled: boolean;
    hasApiKey: boolean;
    providerName: string;
    dailyUsed: number;
    dailyLimit: number;
  } | null => {
    try {
      const behaviorRaw = localStorage.getItem('deskpet_behaviorConfig');
      const behavior = behaviorRaw ? JSON.parse(behaviorRaw) : {};
      const aiConfigRaw = localStorage.getItem('deskpet_ai_config');
      const aiConfig = aiConfigRaw ? JSON.parse(aiConfigRaw) : {};
      const countRaw = localStorage.getItem('deskpet_smartChatCount');
      const dateRaw = localStorage.getItem('deskpet_smartChatDate');
      const today = new Date().toDateString();
      const used = dateRaw === today ? parseInt(countRaw || '0', 10) : 0;

      return {
        smartChatEnabled: behavior.enableSmartChat === true,
        hasApiKey: !!(aiConfig.apiKey),
        providerName: aiConfig.provider || '未配置',
        dailyUsed: used,
        dailyLimit: behavior.smartChatDailyLimit ?? 20,
      };
    } catch {
      return null;
    }
  }, []);

  // 用 lazy initializer 避免在 effect 中 setState
  const [diagnostic, setDiagnostic] = useState<ReturnType<typeof computeDiagnostic>>(() =>
    computeDiagnostic(),
  );

  // 跨窗口同步：focus 时刷新
  useEffect(() => {
    const onFocus = () => setDiagnostic(computeDiagnostic());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [computeDiagnostic]);

  if (!diagnostic) return <div className="text-xs text-neutral-400">检测中...</div>;

  const allGood = diagnostic.smartChatEnabled && diagnostic.hasApiKey;

  return (
    <div className="space-y-2">
      <DiagnosticItem
        label="主动聊天开关"
        status={diagnostic.smartChatEnabled ? 'ok' : 'warn'}
        text={diagnostic.smartChatEnabled ? '已开启' : '❌ 未开启（在「角色行为」页打开）'}
      />
      <DiagnosticItem
        label="LLM API Key"
        status={diagnostic.hasApiKey ? 'ok' : 'error'}
        text={diagnostic.hasApiKey ? '已配置' : '❌ 未配置（在「语言模型」页设置）'}
      />
      <DiagnosticItem
        label="当前 Provider"
        status="info"
        text={diagnostic.providerName}
      />
      <DiagnosticItem
        label="今日使用量"
        status="info"
        text={`${diagnostic.dailyUsed} / ${diagnostic.dailyLimit} 次`}
      />

      {allGood ? (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 mt-2">
          <div className="flex items-center gap-2 text-sm text-green-600">
            <Icon icon="solar:check-circle-bold" />
            <span className="font-medium">LLM 主动闲聊应该正常工作</span>
          </div>
          <p className="text-xs text-green-500 mt-1 ml-6">
            如果仍然没看到闲聊消息，请确认距离上次互动已超过 60 秒
          </p>
        </div>
      ) : (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 mt-2">
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <Icon icon="solar:danger-triangle-bold" />
            <span className="font-medium">LLM 主动闲聊未就绪</span>
          </div>
          <p className="text-xs text-amber-500 mt-1 ml-6">
            请按上方提示完成配置后刷新此页面
          </p>
        </div>
      )}
    </div>
  );
}

function DiagnosticItem({
  label,
  status,
  text,
}: {
  label: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  text: string;
}) {
  const colors = {
    ok: 'text-green-600 bg-green-50',
    warn: 'text-amber-600 bg-amber-50',
    error: 'text-red-600 bg-red-50',
    info: 'text-neutral-600 bg-neutral-50',
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-neutral-100 px-3 py-2">
      <span className="text-sm text-neutral-600">{label}</span>
      <span className={`text-xs px-2 py-1 rounded-md ${colors[status]}`}>{text}</span>
    </div>
  );
}

function getTimeEmoji(time: string): string {
  switch (time) {
    case 'morning':
      return '🌅';
    case 'afternoon':
      return '☀️';
    case 'evening':
      return '🌆';
    case 'night':
      return '🌙';
    default:
      return '📝';
  }
}

function getEmotionEmoji(emotion: string): string {
  const map: Record<string, string> = {
    sad: '😢',
    happy: '😊',
    thinking: '🤔',
    angry: '😠',
    shy: '😳',
    lonely: '💔',
  };
  return map[emotion] || '📝';
}

export default InteractionPage;
