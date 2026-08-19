import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Icon } from '@iconify/react';
import { Section, SettingRow, Switch, SliderRow, useToast } from '../../components';
import {
  IDLE_MESSAGES,
  INTERACT_MESSAGES,
  type IdleMessage,
  setBackendInteractMessages,
  setBackendIdleMessages,
} from '../../../data/idleMessages';
import { interactTTS } from '../../../services/audio/interact-tts';
import { audioPlayer } from '../../../services/audio/player';
import { ensureActiveTTSBackend } from '../../../services/provider/ttsBackend';
import { providerManager } from '../../../services/provider/manager';
import {
  INTERACT_AUDIO_DIR,
  listAudioFiles,
  readAudioFile,
  deleteAudioFile,
  openAudioDir,
  audioFileNameOf,
  parseWavSampleRate,
  getDataDir,
  type AudioFileEntry,
} from '../../../services/audio/audioFiles';
import {
  INTERACTION_CONFIG_KEY,
  loadInteractionConfig,
  saveInteractionConfig,
  type InteractionConfig,
} from './interactionConfig';
import {
  listInteractionMessages,
  upsertInteractionMessage,
  updateInteractionMessage,
  type InteractionMessage,
} from '../../../services/coreApi';

// ===== 默认台词（仅用于首次初始化后端，之后以后端为准） =====
const DEFAULT_INTERACT_MESSAGES = {
  headPat: [
    '诶？别摸头啦~',
    '嗯...好舒服...',
    '嘿嘿~再摸摸~',
    '头...头发会乱的啦！',
    '你这样摸我会害羞的...',
    '咕噜咕噜~（开心）',
  ],
  bodyTap: ['嘿嘿~', '干嘛呀~', '你好呀！', '拍什么拍~', '别闹~', '有事吗？'],
  stepFoot: ['好痛！踩我干嘛！', '呜...我的脚...', '你踩到我了啦！', '过分！', '哼！不理你了！'],
  tooMuchClick: [
    '好啦好啦~别一直点了！',
    '头...头好晕...',
    '停...停下来啦~',
    '你是不是很闲？',
    '我要生气了哦！',
  ],
  longNoInteract: ['你终于回来了！', '呜...等你好久了...', '我以为你不要我了呢...', '欢迎回来~'],
} as const;

const DEFAULT_IDLE_MESSAGES = [
  {
    messages: [
      '在想什么呢？',
      '嘿嘿，我在这里哦~',
      '要不要聊聊天？',
      '今天过得怎么样呀？',
      '我发现了一个有趣的事情...',
      '你有没有什么想告诉我的？',
      '嗯...好想出去玩~',
      '你在忙什么呀？',
      '需要我帮忙吗？',
      '我觉得你今天看起来心情不错呢！',
    ],
  },
  {
    time: 'morning',
    messages: [
      '早上好呀！今天也要加油哦~',
      '早安~昨晚睡得好吗？',
      '新的一天开始啦！',
      '早上好！要不要来杯咖啡？',
    ],
  },
  {
    time: 'afternoon',
    messages: [
      '下午好~是不是有点累了？',
      '午后时光，适合休息一下呢~',
      '下午了，要不要起来活动活动？',
      '你已经工作好久了，休息一下吧~',
    ],
  },
  {
    time: 'evening',
    messages: [
      '晚上好~今天辛苦了！',
      '天黑了呢，记得吃晚饭哦~',
      '晚上好！今天有什么开心的事吗？',
      '夜晚了，要不要听首歌放松一下？',
    ],
  },
  {
    time: 'night',
    messages: [
      '这么晚了还不睡呀？',
      '夜深了...要注意休息哦',
      '晚安~早点睡觉吧！',
      '熬夜对身体不好哦~',
      '我都要困了...你还不睡吗？',
    ],
  },
  {
    emotion: 'sad',
    messages: [
      '不要难过啦，我陪着你呢~',
      '有什么不开心的事吗？跟我说说吧~',
      '呜...看到你不开心我也不开心...',
      '没关系的，一切都会好起来的！',
    ],
  },
  {
    emotion: 'happy',
    messages: [
      '嘿嘿，你开心我也开心！',
      '看到你笑我也想笑~',
      '你的快乐传染给我了！',
      '继续保持好心情哦~',
    ],
  },
  {
    emotion: 'thinking',
    messages: [
      '在想什么呢？需要我帮忙分析吗？',
      '看起来你在认真思考呢~',
      '有什么问题可以问我哦~',
      '思考的时候好认真呀~',
    ],
  },
  {
    emotion: 'angry',
    messages: [
      '别生气啦~气坏了身体不值得',
      '谁惹你生气了？我帮你出气！',
      '深呼吸~放松一下~',
      '生气的时候要记得喝水哦~',
    ],
  },
  {
    emotion: 'shy',
    messages: [
      '嗯...不要一直盯着人家看啦~',
      '脸...脸红了才不是因为你呢！',
      '哼...别以为我会害羞！',
      '你...你靠太近了啦！',
    ],
  },
  {
    emotion: 'lonely',
    messages: [
      '呜...你是不是把我忘了...',
      '好久没跟我说话了呢...',
      '我在这里等你回来...',
      '你去哪里了呀？我好想你~',
      '是不是不需要我了...呜呜...',
    ],
  },
] as const;

/** 将前端默认台词写入后端（首次初始化用） */
async function seedDefaults() {
  for (const [key, msgs] of Object.entries(DEFAULT_INTERACT_MESSAGES)) {
    await upsertInteractionMessage({ category: 'interact', subcategory: key, messages: [...msgs] });
  }
  for (const group of DEFAULT_IDLE_MESSAGES) {
    await upsertInteractionMessage({
      category: 'idle',
      subcategory: (group as any).time || (group as any).emotion || 'general',
      messages: [...group.messages],
      time_of_day: (group as any).time || null,
      emotion: (group as any).emotion || null,
    });
  }
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
  // 后端台词数据（内存快照，不再 localStorage）
  const [backendMessages, setBackendMessages] = useState<InteractionMessage[]>([]);
  const [messagesReady, setMessagesReady] = useState(false);
  // 当前编辑标签
  const [activeTab, setActiveTab] = useState<EditTab>('interact');
  // 编辑中的分组
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  // 音频资源（磁盘 data/audio/interact/）
  const [audioFiles, setAudioFiles] = useState<AudioFileEntry[]>([]);
  const [audioDir, setAudioDir] = useState<string | null>(null);
  const autoGenTimer = useRef<number | null>(null);

  // 刷新磁盘音频列表
  const refreshAudioFiles = useCallback(async () => {
    const [files, dir] = await Promise.all([listAudioFiles(INTERACT_AUDIO_DIR), getDataDir()]);
    setAudioFiles(files);
    setAudioDir(dir ? `${dir}/${INTERACT_AUDIO_DIR}` : null);
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshAudioFiles();
    })();
  }, [refreshAudioFiles]);

  /** 试听一条消息（无论是否启用预制台词都能播：启用走缓存/合成，未启用临时拉后端合成） */
  const previewAudio = useCallback(
    async (text: string) => {
      const t = (text ?? '').trim();
      if (!t) return;
      if (interactTTS.isReady) {
        interactTTS.tryPlay(t);
        return;
      }
      const ok = await ensureActiveTTSBackend({ waitReady: true, timeoutMs: 40000 });
      if (!ok) {
        showToast('TTS 后端不可用，请先在「服务 → 语音合成」配置', 'warning');
        return;
      }
      const tts = providerManager.getActiveTTSProvider();
      if (!tts) {
        showToast('未配置 TTS 引擎', 'warning');
        return;
      }
      try {
        const res = await tts.synthesize(t);
        audioPlayer.enqueue(res.audio, res.sampleRate, `preview-${Date.now()}`);
      } catch {
        showToast('语音合成失败', 'error');
      }
    },
    [showToast],
  );

  /** 新增/编辑消息后防抖自动生成音频（仅 TTS 已启用时；只生成不播放） */
  const scheduleAutoGen = useCallback((text: string) => {
    if (!interactTTS.isReady) return;
    const t = (text ?? '').trim();
    if (!t) return;
    if (autoGenTimer.current) window.clearTimeout(autoGenTimer.current);
    autoGenTimer.current = window.setTimeout(() => {
      void interactTTS.ensureAudio(t);
    }, 800);
  }, []);

  // 获取实际使用的互动消息（自定义 > 默认）
  // 获取实际使用的互动消息（后端 > 默认）
  const getInteractMessages = useCallback(
    (key: keyof typeof INTERACT_MESSAGES): string[] => {
      const msg = backendMessages.find(
        (m) => m.category === 'interact' && m.subcategory === key && m.enabled,
      );
      if (msg?.messages?.length) return msg.messages;
      return INTERACT_MESSAGES[key];
    },
    [backendMessages],
  );

  /** 当前全部生效的台词文本集合（后端 > 默认），用于清理孤儿音频 */
  const allCurrentTexts = useMemo(() => {
    const set = new Set<string>();
    (Object.keys(INTERACT_MESSAGES) as (keyof typeof INTERACT_MESSAGES)[]).forEach((k) =>
      getInteractMessages(k).forEach((t) => set.add(t)),
    );
    (getIdleMessages() ?? []).forEach((g) => g.messages.forEach((t) => set.add(t)));
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendMessages]);

  /** 播放磁盘上的音频文件 */
  const playAudioFile = useCallback(async (name: string) => {
    const buf = await readAudioFile(`${INTERACT_AUDIO_DIR}/${name}`);
    if (!buf) return;
    audioPlayer.enqueue(buf, parseWavSampleRate(buf), `file-${name}`);
  }, []);

  /** 清理未引用的音频文件（当前台词集合之外） */
  const cleanupOrphanFiles = useCallback(async () => {
    const valid = new Set<string>();
    allCurrentTexts.forEach((t) => valid.add(audioFileNameOf(t)));
    const orphans = audioFiles.filter((f) => !valid.has(f.name));
    if (orphans.length === 0) {
      showToast('没有需要清理的音频', 'info');
      return;
    }
    await Promise.all(
      orphans.map((f) => deleteAudioFile(`${INTERACT_AUDIO_DIR}/${f.name}`).catch(() => false)),
    );
    showToast(`已清理 ${orphans.length} 个未引用音频`, 'success');
    void refreshAudioFiles();
  }, [allCurrentTexts, audioFiles, refreshAudioFiles, showToast]);

  /** 重新生成全部预制台词音频（用当前活跃 TTS 模型） */
  const regenerateAll = useCallback(async () => {
    showToast('正在重新生成全部预制台词语音...', 'info');
    await interactTTS.reprewarm();
    showToast('重新生成完成', 'success');
    void refreshAudioFiles();
  }, [refreshAudioFiles, showToast]);

  /** 格式化文件大小 */
  const formatSize = (n: number): string =>
    n < 1024
      ? `${n} B`
      : n < 1024 * 1024
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1024 / 1024).toFixed(2)} MB`;

  // 初始化后端台词数据
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const items = await listInteractionMessages();
        if (cancelled) return;
        if (items.length === 0) {
          await seedDefaults();
        }
        const refreshed = await listInteractionMessages();
        if (cancelled) return;
        setBackendMessages(refreshed);
        setMessagesReady(true);
      } catch {
        if (!cancelled) setMessagesReady(true);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  // 监听跨窗口同步（配置仍用 localStorage）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === INTERACTION_CONFIG_KEY) setConfig(loadInteractionConfig());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const refreshBackendMessages = useCallback(async () => {
    const items = await listInteractionMessages();
    const backendMessages = items;
    const interactMap: Record<string, string[]> = {};
    const idleGroups: IdleMessage[] = [];
    for (const m of backendMessages) {
      if (m.category === 'interact') {
        interactMap[m.subcategory] = m.messages;
      } else if (m.category === 'idle') {
        idleGroups.push({
          ...(m.time_of_day ? { time: m.time_of_day as IdleMessage['time'] } : {}),
          ...(m.emotion ? { emotion: m.emotion } : {}),
          messages: m.messages,
        });
      }
    }
    if (Object.keys(interactMap).length)
      setBackendInteractMessages(interactMap as typeof INTERACT_MESSAGES);
    if (idleGroups.length) setBackendIdleMessages(idleGroups);
    setBackendMessages(backendMessages);
  }, []);

  const updateConfig = useCallback((patch: Partial<InteractionConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveInteractionConfig(next);
      return next;
    });
  }, []);

  // 更新互动消息
  const updateInteractMessage = useCallback(
    async (key: keyof typeof INTERACT_MESSAGES, index: number, value: string) => {
      const current = getInteractMessages(key);
      const updated = [...current];
      updated[index] = value;
      const exist = backendMessages.find((m) => m.category === 'interact' && m.subcategory === key);
      if (exist?.id) {
        await updateInteractionMessage(exist.id, { messages: updated });
      } else {
        await upsertInteractionMessage({
          category: 'interact',
          subcategory: key,
          messages: updated,
        });
      }
      await refreshBackendMessages();
      scheduleAutoGen(value);
    },
    [backendMessages, getInteractMessages, refreshBackendMessages, scheduleAutoGen],
  );

  // 添加互动消息
  const addInteractMessage = useCallback(
    async (key: keyof typeof INTERACT_MESSAGES) => {
      const current = getInteractMessages(key);
      const exist = backendMessages.find((m) => m.category === 'interact' && m.subcategory === key);
      const next = [...current, '新消息'];
      if (exist?.id) {
        await updateInteractionMessage(exist.id, { messages: next });
      } else {
        await upsertInteractionMessage({ category: 'interact', subcategory: key, messages: next });
      }
      await refreshBackendMessages();
      scheduleAutoGen('新消息');
    },
    [backendMessages, getInteractMessages, refreshBackendMessages, scheduleAutoGen],
  );

  // 删除互动消息
  const removeInteractMessage = useCallback(
    async (key: keyof typeof INTERACT_MESSAGES, index: number) => {
      const current = getInteractMessages(key);
      if (current.length <= 1) {
        showToast('至少保留一条消息', 'warning');
        return;
      }
      const updated = current.filter((_, i) => i !== index);
      const exist = backendMessages.find((m) => m.category === 'interact' && m.subcategory === key);
      if (exist?.id) {
        await updateInteractionMessage(exist.id, { messages: updated });
      } else {
        await upsertInteractionMessage({
          category: 'interact',
          subcategory: key,
          messages: updated,
        });
      }
      await refreshBackendMessages();
    },
    [backendMessages, getInteractMessages, refreshBackendMessages, showToast],
  );

  // 重置互动消息为默认
  const resetInteractMessages = useCallback(
    async (key: keyof typeof INTERACT_MESSAGES) => {
      const exist = backendMessages.find((m) => m.category === 'interact' && m.subcategory === key);
      const msgs = [...(DEFAULT_INTERACT_MESSAGES[key] as readonly string[])];
      if (exist?.id) {
        await updateInteractionMessage(exist.id, { messages: msgs });
      } else {
        await upsertInteractionMessage({
          category: 'interact',
          subcategory: key,
          messages: msgs,
        });
      }
      await refreshBackendMessages();
      showToast('已重置为默认', 'success');
    },
    [backendMessages, refreshBackendMessages, showToast],
  );

  // 获取实际使用的闲聊消息（后端 > 默认）
  const getIdleMessages = useCallback((): IdleMessage[] => {
    const groups = backendMessages
      .filter((m) => m.category === 'idle')
      .sort((a, b) => (a.subcategory > b.subcategory ? 1 : -1))
      .map((m) => ({
        ...(m.time_of_day ? { time: m.time_of_day as IdleMessage['time'] } : {}),
        ...(m.emotion ? { emotion: m.emotion as IdleMessage['emotion'] } : {}),
        messages: m.messages,
      }));
    return groups.length ? groups : IDLE_MESSAGES;
  }, [backendMessages]);

  // 更新闲聊消息
  const updateIdleMessage = useCallback(
    async (groupIndex: number, msgIndex: number, value: string) => {
      const current = getIdleMessages();
      const updated = current.map((g, gi) =>
        gi === groupIndex
          ? { ...g, messages: g.messages.map((m, mi) => (mi === msgIndex ? value : m)) }
          : g,
      );
      const target = backendMessages.find(
        (m) =>
          (m.category === 'idle' && m.subcategory === updated[groupIndex].time) ||
          updated[groupIndex].emotion,
      );
      if (target?.id) {
        await updateInteractionMessage(target.id, { messages: updated[groupIndex].messages });
      } else {
        const first = updated[groupIndex];
        await upsertInteractionMessage({
          category: 'idle',
          subcategory: (first as any).time || (first as any).emotion || String(groupIndex),
          messages: updated[groupIndex].messages,
          time_of_day: (first as any).time || null,
          emotion: (first as any).emotion || null,
        });
      }
      await refreshBackendMessages();
      scheduleAutoGen(value);
    },
    [backendMessages, getIdleMessages, refreshBackendMessages, scheduleAutoGen],
  );

  // 添加闲聊消息
  const addIdleMessage = useCallback(
    async (groupIndex: number) => {
      const current = getIdleMessages();
      const updated = current.map((g, gi) =>
        gi === groupIndex ? { ...g, messages: [...g.messages, '新消息'] } : g,
      );
      const target = backendMessages.find(
        (m) =>
          (m.category === 'idle' && m.subcategory === (updated[groupIndex] as any).time) ||
          (updated[groupIndex] as any).emotion,
      );
      if (target?.id) {
        await updateInteractionMessage(target.id, { messages: updated[groupIndex].messages });
      } else {
        const first = updated[groupIndex];
        await upsertInteractionMessage({
          category: 'idle',
          subcategory: (first as any).time || (first as any).emotion || String(groupIndex),
          messages: updated[groupIndex].messages,
          time_of_day: (first as any).time || null,
          emotion: (first as any).emotion || null,
        });
      }
      await refreshBackendMessages();
      scheduleAutoGen('新消息');
    },
    [backendMessages, getIdleMessages, refreshBackendMessages, scheduleAutoGen],
  );

  // 删除闲聊消息
  const removeIdleMessage = useCallback(
    async (groupIndex: number, msgIndex: number) => {
      const current = getIdleMessages();
      const group = current[groupIndex];
      if (group.messages.length <= 1) {
        showToast('该组至少保留一条消息', 'warning');
        return;
      }
      const updated = current.map((g, gi) =>
        gi === groupIndex ? { ...g, messages: g.messages.filter((_, mi) => mi !== msgIndex) } : g,
      );
      const target = backendMessages.find(
        (m) =>
          (m.category === 'idle' && m.subcategory === (updated[groupIndex] as any).time) ||
          (updated[groupIndex] as any).emotion,
      );
      if (target?.id) {
        await updateInteractionMessage(target.id, { messages: updated[groupIndex].messages });
      } else {
        const first = updated[groupIndex];
        await upsertInteractionMessage({
          category: 'idle',
          subcategory: (first as any).time || (first as any).emotion || String(groupIndex),
          messages: updated[groupIndex].messages,
          time_of_day: (first as any).time || null,
          emotion: (first as any).emotion || null,
        });
      }
      await refreshBackendMessages();
    },
    [backendMessages, getIdleMessages, refreshBackendMessages, showToast],
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
                          <Icon
                            icon="solar:chat-round-line-linear"
                            className="shrink-0 text-neutral-400"
                          />
                          <span className="flex-1 min-w-0 truncate">{msg}</span>
                          <button
                            type="button"
                            onClick={() => void previewAudio(msg)}
                            title="试听语音"
                            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-indigo-100 text-indigo-400 transition-colors hover:bg-indigo-50"
                          >
                            <Icon icon="solar:play-bold" className="text-xs" />
                          </button>
                        </div>
                      ))}
                      {messages.length > 2 && (
                        <div className="text-xs text-neutral-400 pl-5">
                          还有 {messages.length - 2} 条...
                        </div>
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
                            onClick={() => void previewAudio(msg)}
                            title="试听语音"
                            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-indigo-100 text-indigo-400 transition-colors hover:bg-indigo-50 hover:text-indigo-500"
                          >
                            <Icon icon="solar:play-bold" className="text-sm" />
                          </button>
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

                    {backendMessages.some(
                      (m) => m.category === 'interact' && m.subcategory === key,
                    ) && (
                      <button
                        type="button"
                        onClick={() => void resetInteractMessages(key)}
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
                            onClick={() => void previewAudio(msg)}
                            title="试听语音"
                            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-green-100 text-green-400 transition-colors hover:bg-green-50 hover:text-green-500"
                          >
                            <Icon icon="solar:play-bold" className="text-sm" />
                          </button>
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
          {backendMessages.some((m) => m.category === 'idle') && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={async () => {
                  for (const m of backendMessages.filter((m) => m.category === 'idle')) {
                    if (m.id) await updateInteractionMessage(m.id, { messages: [] });
                  }
                  await refreshBackendMessages();
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
                  onClick={() =>
                    updateConfig({ enableInteractTTS: config.enableInteractTTS === 1 ? 0 : 1 })
                  }
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

          <Section
            title="音频资源"
            description="预制台词语音文件统一存储在本地 data/audio/interact/ 目录，可在此试听与管理"
          >
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => void openAudioDir(INTERACT_AUDIO_DIR)}
                  className="flex items-center gap-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-50"
                >
                  <Icon icon="solar:folder-bold" className="text-sm" />
                  打开文件夹
                </button>
                <button
                  type="button"
                  onClick={() => void refreshAudioFiles()}
                  className="flex items-center gap-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-50"
                >
                  <Icon icon="solar:refresh-bold" className="text-sm" />
                  刷新
                </button>
                <button
                  type="button"
                  onClick={() => void cleanupOrphanFiles()}
                  className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-600 transition-colors hover:bg-amber-100"
                >
                  <Icon icon="solar:trash-bin-trash-bold" className="text-sm" />
                  清理未引用音频
                </button>
                <button
                  type="button"
                  onClick={() => void regenerateAll()}
                  className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-600 transition-colors hover:bg-indigo-100"
                >
                  <Icon icon="solar:refresh-circle-bold" className="text-sm" />
                  重新生成全部
                </button>
              </div>

              {audioDir && <div className="text-xs text-neutral-400 truncate">📁 {audioDir}</div>}

              {audioFiles.length === 0 ? (
                <div className="rounded-lg bg-neutral-50 px-4 py-3 text-xs text-neutral-400">
                  暂无音频文件（开启「预制台词语音」或编辑/新增消息后会自动生成）
                </div>
              ) : (
                <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                  {audioFiles.map((f) => (
                    <li
                      key={f.name}
                      className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-1.5 text-xs"
                    >
                      <Icon icon="solar:music-notes-bold" className="shrink-0 text-neutral-400" />
                      <span className="flex-1 min-w-0 truncate text-neutral-600 font-mono">
                        {f.name}
                      </span>
                      <span className="shrink-0 text-neutral-400">{formatSize(f.size)}</span>
                      <button
                        type="button"
                        onClick={() => void playAudioFile(f.name)}
                        title="播放"
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-indigo-100 text-indigo-400 transition-colors hover:bg-indigo-50"
                      >
                        <Icon icon="solar:play-bold" className="text-xs" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void deleteAudioFile(`${INTERACT_AUDIO_DIR}/${f.name}`).then(() =>
                            refreshAudioFiles(),
                          )
                        }
                        title="删除"
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-red-100 text-red-400 transition-colors hover:bg-red-50"
                      >
                        <Icon icon="solar:trash-bin-minimalistic-bold" className="text-xs" />
                      </button>
                    </li>
                  ))}
                </ul>
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
        hasApiKey: !!aiConfig.apiKey,
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
      <DiagnosticItem label="当前 Provider" status="info" text={diagnostic.providerName} />
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
          <p className="text-xs text-amber-500 mt-1 ml-6">请按上方提示完成配置后刷新此页面</p>
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
