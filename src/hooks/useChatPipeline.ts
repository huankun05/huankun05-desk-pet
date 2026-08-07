import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  initChatStorage,
  getOrCreateActiveSession,
  createSession,
  saveMessage,
  type ChatSession,
} from '../services/chatStorage';
import { useMemory } from './useMemory';
import { type EmotionState } from './useEmotion';
import { aiService } from '../services/ai';
import { audioPlayer } from '../services/audio/player';
import { StreamingTTSController } from '../services/audio/streaming-tts';
import { providerManager } from '../services/provider/manager';
import {
  PipelineScheduler,
  PipelineAbortError,
  ContextStage,
  ContentSafetyStage,
  LLMStage,
  EmotionFinalizeStage,
  ThinkParseStage,
  TTSStage,
  PersonalityInjectStage,
  BehaviorDecorateStage,
  IdleDetectStage,
  UnifiedMemoryStage,
} from '../services/pipeline';
import type { MessageContext, PipelineCallbacks } from '../services/pipeline';
import type { EmotionContext } from '../services/provider/types';
import { eventBus } from '../services/eventBus';
import { initContextManager } from '../services/context';
import type { ContextConfig } from '../services/context';
import { useStorageEvents } from './useStorageEvent';
import { useSttBridge } from './useSttBridge';
import { useRagPersistence } from './useRagPersistence';
import { createLogger } from '../utils/logger';
import type { Message } from '../components/Chat/ChatWindow';

const log = createLogger('ChatPipeline');

const CONTEXT_CONFIG_KEY = 'deskpet_contextConfig';

interface StoredContextConfig {
  compressionEnabled: boolean;
  maxContextTokens: number;
  compressionThreshold: number; // 存储为整数百分比 (50-95)
  enforceMaxTurns: number;
}

const DEFAULT_STORED_CTX: StoredContextConfig = {
  compressionEnabled: true,
  maxContextTokens: 8000,
  compressionThreshold: 85,
  enforceMaxTurns: 30,
};

function loadContextConfig(): ContextConfig {
  try {
    const raw = localStorage.getItem(CONTEXT_CONFIG_KEY);
    if (raw) {
      const stored = { ...DEFAULT_STORED_CTX, ...JSON.parse(raw) } as StoredContextConfig;
      return {
        compressionEnabled: stored.compressionEnabled,
        maxContextTokens: stored.maxContextTokens,
        compressionThreshold: stored.compressionThreshold / 100,
        enforceMaxTurns: stored.enforceMaxTurns,
      };
    }
  } catch {
    // ignore
  }
  return {
    compressionEnabled: DEFAULT_STORED_CTX.compressionEnabled,
    maxContextTokens: DEFAULT_STORED_CTX.maxContextTokens,
    compressionThreshold: DEFAULT_STORED_CTX.compressionThreshold / 100,
    enforceMaxTurns: DEFAULT_STORED_CTX.enforceMaxTurns,
  };
}

export interface UseChatPipelineOptions {
  emotionCtxRef: React.MutableRefObject<EmotionState>;
  setTalkingEmotion: () => void;
  setEmotionFromResponse: (text: string) => void;
  updateFromVoice: (text: string, voiceEmotion?: string) => void;
  showBubble: (text: string, duration?: number) => void;
}

export interface ChatPipelineState {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  sendMessage: (content: string) => Promise<void>;
  interruptResponse: () => void;
  newChat: () => void;
  cancelStream: () => void;
}

export function useChatPipeline({
  emotionCtxRef,
  setTalkingEmotion,
  setEmotionFromResponse,
  updateFromVoice,
  showBubble,
}: UseChatPipelineOptions): ChatPipelineState {
  const { t } = useTranslation();
  const { getContext } = useMemory();
  const { addToRag } = useRagPersistence();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ctxConfigVer, setCtxConfigVer] = useState(0);

  const sessionRef = useRef<ChatSession | null>(null);
  const streamingTTSController = useRef(new StreamingTTSController());
  const pipelineCtxRef = useRef<MessageContext | null>(null);
  // TTS 不可用提示节流：避免每条消息都弹气泡刷屏
  const lastTtsWarnRef = useRef(0);

  const notifyTtsIssue = useCallback(
    (msg: string) => {
      const now = Date.now();
      if (now - lastTtsWarnRef.current > 30000) {
        lastTtsWarnRef.current = now;
        showBubble(msg, 4000);
      }
    },
    [showBubble],
  );

  // 监听上下文配置变更（跨窗口：设置窗口 → 主窗口）
  useStorageEvents(
    [CONTEXT_CONFIG_KEY],
    () => {
      setCtxConfigVer((v) => v + 1);
    },
    [],
  );

  const contextManager = useMemo(() => {
    // ctxConfigVer is intentionally used here to invalidate memo when config changes
    void ctxConfigVer;
    return initContextManager(loadContextConfig());
  }, [ctxConfigVer]);

  const idleDetect = useMemo(() => new IdleDetectStage(), []);

  const unifiedMemoryStage = useMemo(() => new UnifiedMemoryStage(getContext), [getContext]);

  const pipeline = useMemo(
    () =>
      new PipelineScheduler()
        .addStage(unifiedMemoryStage)
        .addStage(idleDetect)
        .addStage(new PersonalityInjectStage())
        .addStage(new ContextStage(contextManager))
        .addStage(new ContentSafetyStage())
        .addStage(new LLMStage(aiService))
        .addStage(new EmotionFinalizeStage())
        .addStage(new ThinkParseStage())
        .addStage(new TTSStage(providerManager))
        .addStage(new BehaviorDecorateStage()),
    [unifiedMemoryStage, contextManager, idleDetect],
  );

  const analyzeIncrementalEmotion = useCallback(
    (text: string) => {
      const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
      const sentences = cleaned.split(/(?<=[。！？\n])/);
      let lastSentence = '';
      for (const s of sentences) {
        if (s.trim()) lastSentence = s;
      }
      if (lastSentence) {
        setEmotionFromResponse(lastSentence);
      }
    },
    [setEmotionFromResponse],
  );

  const interruptCurrentResponse = useCallback(() => {
    audioPlayer.stop();
    streamingTTSController.current.reset();
    if (pipelineCtxRef.current) {
      pipelineCtxRef.current.aborted = true;
    }
    aiService.abortChat();
    setIsStreaming(false);
    setIsLoading(false);
    setMessages((p) => {
      const last = p[p.length - 1];
      if (last?.role === 'assistant' && last.content) {
        saveMessage(last);
      }
      return p;
    });
    log.info('Response interrupted');
  }, []);

  const handleSendMessage = useCallback(
    async (content: string) => {
      const session = sessionRef.current;
      if (!session) return;

      log.info('Message sent', { length: content.length, preview: content.slice(0, 50) });

      audioPlayer.stop();

      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: new Date(),
      };
      saveMessage(userMessage);
      setMessages((p) => [...p, userMessage]);
      setTalkingEmotion();

      const assistantId = (Date.now() + 1).toString();
      const assistantMessage: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };
      setMessages((p) => [...p, assistantMessage]);

      const ctx: MessageContext = {
        userText: content,
        session,
        assistantMessageId: assistantId,
        accumulated: '',
        sentenceBuffer: '',
        emotionSnapshot: {
          mood: emotionCtxRef.current.mood,
          moodIntensity: emotionCtxRef.current.moodIntensity,
          emotion: emotionCtxRef.current.emotion,
          emotionIntensity: emotionCtxRef.current.emotionIntensity,
          favorability: emotionCtxRef.current.favorability,
          personality: emotionCtxRef.current.personality,
        } as unknown as EmotionContext,
        memoryContext: '',
        speakableText: '',
        ttsAudio: null,
        ttsSampleRate: 0,
        aborted: false,
      };
      pipelineCtxRef.current = ctx;

      const ttsController = streamingTTSController.current;
      ttsController.reset();
      const ttsProvider = providerManager.getSessionTTSProvider(session.id);
      if (ttsProvider) {
        try {
          if (ttsProvider.validate) {
            const ok = await ttsProvider.validate();
            if (!ok) {
              log.warn('TTS provider validation failed', { sessionId: session.id });
              notifyTtsIssue('语音合成暂不可用，请在设置中检查 TTS 配置~');
            }
          }
          const currentEmotion = emotionCtxRef.current.emotion;
          ttsController.setup(ttsProvider, currentEmotion !== 'idle' ? currentEmotion : undefined);
        } catch (err) {
          log.warn('TTS provider setup failed', { err: String(err) });
          notifyTtsIssue('语音合成初始化失败，请在设置中检查 TTS 配置~');
        }
      }

      const callbacks: PipelineCallbacks = {
        onStreamChunk: (id, text) =>
          setMessages((p) => p.map((m) => (m.id === id ? { ...m, content: text } : m))),
        onEmotionAnalyze: analyzeIncrementalEmotion,
        onStreamingTTS: (text) => ttsController.addSentence(text),
        onSaveMessage: saveMessage,
        onToolCall: (call) => {
          log.info('Tool call', { name: call.name, args: call.arguments });
        },
        onToolResult: (result) => {
          log.info('Tool result', {
            name: result.name,
            isError: result.isError,
            preview: result.content.slice(0, 100),
          });
        },
        getLatestEmotion: () =>
          ({
            mood: emotionCtxRef.current.mood,
            moodIntensity: emotionCtxRef.current.moodIntensity,
            emotion: emotionCtxRef.current.emotion,
            emotionIntensity: emotionCtxRef.current.emotionIntensity,
            favorability: emotionCtxRef.current.favorability,
            personality: emotionCtxRef.current.personality,
          }) as unknown as EmotionContext,
      };

      setIsLoading(true);
      setIsStreaming(true);
      idleDetect.recordInteraction();
      eventBus.emit('message:sent', { text: content, sessionId: session.id });

      try {
        await pipeline.execute(ctx, callbacks);

        // 仅当管道正常完成（未 abort）时才 emit 事件 + upsert RAG
        if (!ctx.aborted) {
          eventBus.emit('message:response', { text: ctx.accumulated, sessionId: session.id });

          // RAG 长期记忆 upsert（仅当有有效内容时写入）
          await addToRag(content, ctx.accumulated, {
            userMessageId: userMessage.id,
            assistantMessageId: ctx.assistantMessageId,
            sessionId: session.id,
          });
        }

        const streamingResults = await ttsController.synthesizeAll();
        if (streamingResults.length > 0) {
          for (const result of streamingResults) {
            try {
              audioPlayer.enqueue(
                result.audio,
                result.sampleRate,
                `${assistantId}-seg-${result.seq}`,
              );
            } catch (audioErr) {
              log.warn('Streaming TTS segment playback failed', { seq: result.seq, err: audioErr });
            }
          }
          log.info('Streaming TTS: 播放完成', { segments: streamingResults.length });
        } else if (ctx.ttsAudio) {
          try {
            audioPlayer.enqueue(ctx.ttsAudio, ctx.ttsSampleRate, assistantId);
          } catch (audioErr) {
            console.warn('[TTS] Audio playback failed (non-fatal):', audioErr);
          }
        }
      } catch (error: unknown) {
        if (
          error instanceof PipelineAbortError ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          interruptCurrentResponse();
        } else {
          const errorMessage: Message = {
            id: assistantId,
            role: 'assistant',
            content: t('app.error_api_key', {
              message: error instanceof Error ? error.message : 'Unknown error',
            }),
            timestamp: new Date(),
          };
          setMessages((p) => p.map((m) => (m.id === assistantId ? errorMessage : m)));
        }
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
        pipelineCtxRef.current = null;
        streamingTTSController.current.reset();
      }
    },
    [
      analyzeIncrementalEmotion,
      pipeline,
      t,
      emotionCtxRef,
      setTalkingEmotion,
      interruptCurrentResponse,
      idleDetect,
      addToRag,
      notifyTtsIssue,
    ],
  );

  const handleNewChat = useCallback(() => {
    aiService.abortChat();
    setIsLoading(false);
    setIsStreaming(false);
    const session = createSession();
    sessionRef.current = session;
    setMessages([]);
  }, []);

  const handleCancelStream = useCallback(() => {
    interruptCurrentResponse();
  }, [interruptCurrentResponse]);

  useEffect(() => {
    Promise.all([aiService.ready, initChatStorage()])
      .then(() => {
        const session = getOrCreateActiveSession();
        sessionRef.current = session;
        setMessages(session.messages);
      })
      .catch((err) => {
        log.error('Chat pipeline initialization failed', err);
      });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('deskpet_messages', JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem('deskpet_chatLoading', String(isLoading));
      localStorage.setItem('deskpet_chatStreaming', String(isStreaming));
    } catch {
      /* ignore */
    }
  }, [isLoading, isStreaming]);

  useStorageEvents(
    ['deskpet_chatPending', 'deskpet_chatCancel', 'deskpet_chatNewSession'],
    (key, newValue) => {
      if (newValue === null) return;
      try {
        if (key === 'deskpet_chatPending' && newValue) {
          localStorage.removeItem('deskpet_chatPending');
          handleSendMessage(newValue);
        } else if (key === 'deskpet_chatCancel' && newValue === 'true') {
          localStorage.removeItem('deskpet_chatCancel');
          handleCancelStream();
        } else if (key === 'deskpet_chatNewSession' && newValue === 'true') {
          localStorage.removeItem('deskpet_chatNewSession');
          handleNewChat();
        }
      } catch {
        /* ignore */
      }
    },
    [handleSendMessage, handleCancelStream, handleNewChat],
  );

  useSttBridge({ handleSendMessage, updateFromVoice, sessionRef });

  return {
    messages,
    isLoading,
    isStreaming,
    sendMessage: handleSendMessage,
    interruptResponse: interruptCurrentResponse,
    newChat: handleNewChat,
    cancelStream: handleCancelStream,
  };
}
