/**
 * useVoiceCall — 聊天窗口「语音通话」状态机（像 QQ 语音通话）
 *
 * 流程：
 *   点击通话按钮 → 发 voice:start 让网关按需拉起本地 STT/TTS 服务（不用时常驻）
 *   → 进入通话态：持续「听(静音自动停) → STT 识别 → 发聊天LLM(气泡显示) → 宠物TTS回话」
 *   → 挂断 → 发 voice:stop 释放本地服务
 *
 * 复用：AudioRecorder（前端录音 + 静音自动停）、providerManager（STT/TTS）、
 *      useHermesGateway.sendMessage（聊天 + 气泡渲染）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioRecorder } from '../services/audio/recorder';
import { providerManager } from '../services/provider/manager';
import { transcribeViaBrain } from '../services/provider/sttBackend';
import { StreamingTTSPlayer } from '../services/audio/streaming-tts';
import { getHermesGatewayClient } from '../services/hermesGateway';
import { type SendMessageFn } from '../hooks/useHermesGateway';
import { eventBus } from '../services/eventBus';
import { createCallSummary } from '../services/callSummaries';
import { createLogger } from '../utils/logger';

const log = createLogger('VoiceCall');

/**
 * 沉默提醒（wall-clock）：进入聆听态后，若用户持续沉默达到此毫秒数，
 * 做一次温柔提醒（"还在吗"），之后继续安静等待，不连环追问。
 * 采用真实墙钟计时（而非「空音频次数 × 单次静音耗时」），保证间隔可预期。
 */
const INQUIRY_DELAY_MS = 30000;

/**
 * 打断（barge-in）阈值：AI 播报途中，若检测到用户持续说话，则立即打断 AI 并开始聆听。
 * - BARGE_GRACE_MS：播报开始后的宽限期，避开开局回声/爆音。
 * - BARGE_THRESHOLD：RMS 阈值，明显高于环境噪声与被回声消除后的残留，避免 AI 自己打断自己。
 * - BARGE_FRAMES：需连续多少帧（~100ms/帧）超过阈值才判定为用户说话，过滤瞬态杂音。
 */
const BARGE_GRACE_MS = 600;
const BARGE_THRESHOLD = 0.04;
const BARGE_FRAMES = 6;

/**
 * 按尝试次数生成情绪递进的「你在吗」询问文案：
 * 1 温柔提醒 → 2 略带委屈/小抱怨 → 3 撒娇式「生气」/不舍 → 4 告别。
 * 当前为离线模板；人设化（傲娇/温柔/活泼差异化）可由 LLM 据角色 personality 生成进一步增强。
 */
function buildInquiry(level: number): string {
  const pools: Record<number, string[]> = {
    1: ['还在吗？我等你哦~', '诶？人呢？我在这儿呢', '怎么不说话啦，在听吗？'],
    2: ['人去哪儿啦……又不理我了？', '喂喂，你是不是走神了呀', '你怎么又不说话了，我会难过的诶'],
    3: [
      '不理我，那我先挂啦啊，想聊随时找我~',
      '哼，你都不理我，那我先撤了哦',
      '再不理我我可真生气了……算了，先挂啦',
    ],
    4: ['那我先挂啦，想聊了随时喊我~', '好啦不逗你了，我先撤，拜拜~'],
  };
  const arr = pools[level] ?? pools[3];
  return arr[Math.floor(Math.random() * arr.length)];
}

export type VoiceCallState = 'idle' | 'connecting' | 'incall' | 'listening' | 'speaking' | 'error';

export interface UseVoiceCallOptions {
  /** 发送消息到聊天（含 LLM + 工具 + 气泡渲染） */
  sendMessage: SendMessageFn;
  /** 当前聊天模式（工作/聊天），通话轮次透传，工具行为与打字聊天一致 */
  mode?: 'auto' | 'work' | 'chat';
  /** 通话状态变化回调（用于 UI） */
  onStateChange?: (s: VoiceCallState) => void;
  /** 错误提示 */
  showError?: (msg: string) => void;
}

interface CallTranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface UseVoiceCallReturn {
  state: VoiceCallState;
  /** 通话秒数 */
  seconds: number;
  /** 是否通话中（incall/listening/speaking） */
  active: boolean;
  /** 切换通话（开/关） */
  toggle: () => void;
}

export function useVoiceCall({
  sendMessage,
  mode,
  onStateChange,
  showError,
}: UseVoiceCallOptions): UseVoiceCallReturn {
  const [state, setState] = useState<VoiceCallState>('idle');
  const [seconds, setSeconds] = useState(0);

  const activeRef = useRef(false);
  const stateRef = useRef<VoiceCallState>('idle');
  const recorderRef = useRef<AudioRecorder | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceStartResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const modeRef = useRef<'auto' | 'work' | 'chat' | undefined>(mode);
  const transcriptRef = useRef<CallTranscriptTurn[]>([]);
  const callStartRef = useRef<number>(0);
  /** 沉默提醒定时器（wall-clock）：用户持续沉默达到 INQUIRY_DELAY_MS 触发一次提醒 */
  const inquiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 当前沉默段是否已提醒过（用户开口则重置，实现「每段沉默最多提醒一次」） */
  const inquiryFiredRef = useRef(false);
  /** 打断监听录音器（AI 播报时并行监听麦克风，检测用户插话） */
  const monitorRecRef = useRef<AudioRecorder | null>(null);
  /** 是否希望开启打断监听（进入播报态置 true，退出/挂断置 false） */
  const bargeWantRef = useRef(false);
  /** 连续超过打断阈值的帧数计数 */
  const bargeRmsRef = useRef(0);
  /** 打断触发锁，防止一次插话重复触发 */
  const bargeGuardRef = useRef(false);
  /** 标记一次打断已发生，随后到达的 hermes:done 不应再开启聆听（避免重复） */
  const bargeSkipDoneRef = useRef(false);
  /** startTurn 递归续听经由此 ref 调用，避免 useCallback 自引用 TDZ */
  const startTurnRef = useRef<() => void>(() => {});
  /**
   * 当前轮次的流式 TTS 播放器：LLM token 一到就喂入合成，首句边生成边播。
   * 原实现等 hermes:done（LLM 全部完成）才开始合成第一句，
   * 用户感知为「说一句话要等很久才有语音回复」。
   */
  const ttsStreamRef = useRef<StreamingTTSPlayer | null>(null);

  // 同步当前模式（通话轮次透传，使工具行为与打字聊天一致）
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const setCallState = useCallback(
    (s: VoiceCallState) => {
      stateRef.current = s;
      setState(s);
      onStateChange?.(s);
    },
    [onStateChange],
  );

  const stopTts = useCallback(() => {
    const a = ttsAudioRef.current;
    if (a) {
      try {
        a.pause();
        a.src = '';
      } catch {
        /* ignore */
      }
      ttsAudioRef.current = null;
    }
  }, []);

  /** 创建流式 TTS 播放器：逐句合成、顺序播放（播放结束才 resolve 当前句） */
  const createStreamPlayer = useCallback(() => {
    return new StreamingTTSPlayer((audio, _sr) => {
      return new Promise<void>((res) => {
        const blob = new Blob([audio], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audioEl = new Audio(url);
        ttsAudioRef.current = audioEl;
        const done = () => {
          URL.revokeObjectURL(url);
          if (ttsAudioRef.current === audioEl) ttsAudioRef.current = null;
          res();
        };
        audioEl.onended = done;
        audioEl.onerror = done;
        audioEl.play().catch(() => res());
      });
    });
  }, []);

  /** 合成并播放宠物语音（整段文本），返回播放结束的 Promise（流式：逐句合成+顺序播） */
  const playTts = useCallback(
    (text: string): Promise<void> => {
      return new Promise((resolve) => {
        if (!text?.trim()) {
          resolve();
          return;
        }
        const player = createStreamPlayer();
        player.push(text);
        player.finish();
        player.whenDone().then(() => resolve());
      });
    },
    [createStreamPlayer],
  );

  /** 用当前 LLM 跑一次纯文本补全（不通工具、不渲染），返回文本 */
  const askLlmOnce = (prompt: string): Promise<string> =>
    new Promise((resolve) => {
      try {
        getHermesGatewayClient().sendChat(
          prompt,
          {
            frontendTools: [],
            onDone: (t) => resolve(t),
            onError: () => resolve(''),
          },
          modeRef.current,
        );
      } catch {
        resolve('');
      }
    });

  /** 挂断后生成口语化通话总结并落库（开关关闭或无内容时跳过） */
  const generateSummary = useCallback(async () => {
    let enabled: boolean;
    try {
      enabled = localStorage.getItem('deskpet_call_summary_enabled') !== 'false';
    } catch {
      enabled = true;
    }
    const turns = transcriptRef.current;
    if (!enabled || turns.length === 0) return;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const duration = callStartRef.current
      ? Math.max(0, Math.round((Date.now() - callStartRef.current) / 1000))
      : 0;
    const transcriptText = turns
      .map((t) => `${t.role === 'user' ? '我' : '你'}：${t.text}`)
      .join('\n');

    const prompt =
      '我们刚用语音聊了一会儿天。下面是我们这段对话的内容。\n' +
      '请用轻松、亲切、像朋友之间聊完天后的口吻，写一段简短的复盘总结（不要正式、不要像会议纪要），' +
      '2 到 5 句话即可，可以提我们聊了什么、有什么好玩的、或者你记住了什么小事。\n\n对话内容：\n' +
      transcriptText;

    try {
      const summaryText = await askLlmOnce(prompt);
      if (!summaryText) return;
      await createCallSummary({
        title: `通话 · ${dateStr}`,
        call_date: dateStr,
        duration_seconds: duration,
        summary_text: summaryText,
        transcript_json: JSON.stringify(turns),
      });
    } catch (e) {
      log.warn('通话总结生成失败', e);
    }
  }, []);

  /** 清除沉默提醒定时器 */
  const clearInquiryTimer = useCallback(() => {
    if (inquiryTimerRef.current) {
      clearTimeout(inquiryTimerRef.current);
      inquiryTimerRef.current = null;
    }
  }, []);

  /** 停止打断监听（取消并行麦克风、复位计数） */
  const stopBargeMonitor = useCallback(() => {
    bargeWantRef.current = false;
    bargeRmsRef.current = 0;
    if (monitorRecRef.current) {
      try {
        monitorRecRef.current.cancel();
      } catch {
        /* ignore */
      }
      monitorRecRef.current = null;
    }
  }, []);

  /** 触发打断：立即停止 AI 播报，转入聆听，忽略随后到达的 LLM 完成事件 */
  const triggerBargeIn = useCallback(() => {
    if (!activeRef.current || bargeGuardRef.current) return;
    bargeGuardRef.current = true;
    stopBargeMonitor();
    stopTts();
    if (ttsStreamRef.current) {
      ttsStreamRef.current.stop();
      ttsStreamRef.current = null;
    }
    bargeSkipDoneRef.current = true; // 随后的 hermes:done 不再开启聆听
    clearInquiryTimer();
    if (activeRef.current) startTurnRef.current();
    setTimeout(() => {
      bargeGuardRef.current = false;
    }, 1000);
  }, [stopTts, stopBargeMonitor, clearInquiryTimer]);

  /** 打断监听的实时音频回调：用 RMS 检测用户是否持续说话 */
  const handleMonitorChunk = useCallback(
    (chunk: Float32Array) => {
      if (!activeRef.current || bargeGuardRef.current || !bargeWantRef.current) return;
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      const rms = Math.sqrt(sum / chunk.length);
      if (rms > BARGE_THRESHOLD) bargeRmsRef.current += 1;
      else bargeRmsRef.current = 0;
      if (bargeRmsRef.current >= BARGE_FRAMES) triggerBargeIn();
    },
    [triggerBargeIn],
  );

  /** 进入 AI 播报后，宽限期后开启打断监听 */
  const startBargeMonitor = useCallback(() => {
    if (!activeRef.current) return;
    bargeWantRef.current = true;
    setTimeout(() => {
      if (!bargeWantRef.current || !activeRef.current || monitorRecRef.current) return;
      const rec = new AudioRecorder({
        sampleRate: 16000,
        silenceTimeout: 1e9, // 不自动停（由本 hook 主动 cancel）
        autoStopOnSilence: true, // 仍需开启静音检测以驱动 onAudioChunk
        onAudioChunk: handleMonitorChunk,
      });
      monitorRecRef.current = rec;
      rec.start().catch(() => {
        monitorRecRef.current = null;
      });
    }, BARGE_GRACE_MS);
  }, [handleMonitorChunk]);

  /**
   * 安排一次沉默提醒：进入聆听态后，若用户在 INQUIRY_DELAY_MS 内始终未开口，
   * 温柔提醒一次；提醒后本段沉默不再重复（用户开口会重置）。
   */
  const scheduleInquiry = useCallback(() => {
    clearInquiryTimer();
    if (inquiryFiredRef.current) return;
    inquiryTimerRef.current = setTimeout(() => {
      inquiryTimerRef.current = null;
      if (!activeRef.current || inquiryFiredRef.current) return;
      inquiryFiredRef.current = true;
      const line = buildInquiry(1);
      setCallState('speaking');
      void playTts(line).then(() => {
        if (activeRef.current) startTurnRef.current();
      });
    }, INQUIRY_DELAY_MS);
  }, [clearInquiryTimer, playTts, setCallState]);

  // 停止通话的内部实现（声明在 startTurn 之前，供其 catch 调用，避免 TDZ）
  const stopCallInternal = useCallback(() => {
    if (!activeRef.current && stateRef.current === 'idle') return;
    activeRef.current = false;
    try {
      recorderRef.current?.cancel();
    } catch {
      /* ignore */
    }
    recorderRef.current = null;
    // 丢弃在途的流式合成，避免挂断后还继续出声
    ttsStreamRef.current?.stop();
    ttsStreamRef.current = null;
    stopTts();
    // 清理沉默提醒定时器与打断监听
    clearInquiryTimer();
    stopBargeMonitor();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setSeconds(0);
    getHermesGatewayClient().sendVoice('stop');
    setCallState('idle');
    // 挂断后生成口语化总结（fire-and-forget，失败仅记日志）
    void generateSummary();
    transcriptRef.current = [];
    callStartRef.current = 0;
  }, [stopTts, setCallState, generateSummary, clearInquiryTimer, stopBargeMonitor]);

  /** 开始一轮聆听 */
  const startTurn = useCallback(async () => {
    if (!activeRef.current) return;
    setCallState('listening');
    // 进入聆听即停止上一轮可能的打断监听，并按段安排沉默提醒
    stopBargeMonitor();
    scheduleInquiry();
    // 顶部刘海字幕：通话聆听态
    eventBus.emit('subtitle:update', { phase: 'listening', text: '正在聆听…' });

    // 取消上一轮可能仍在运行的录音器，避免叠加
    try {
      recorderRef.current?.cancel();
    } catch {
      /* ignore */
    }
    // 静音超时 0.7s（原 1s）：缩短「说完话→开始识别」的固定等待；
    // 0.7s 是日常语速句间停顿（通常 <0.7s）与误截断的平衡点，偏低可让回合更快切换。
    const rec = new AudioRecorder({ sampleRate: 16000, silenceTimeout: 700 });
    recorderRef.current = rec;
    rec.onAutoStop = async (audio: ArrayBuffer) => {
      if (!activeRef.current) return;
      try {
        const result = await transcribeViaBrain(audio, 'wav');
        const text = result?.text?.trim();
        if (text) {
          // 用户开口：取消本段沉默提醒并重置；清除可能残留的打断跳过标志
          clearInquiryTimer();
          inquiryFiredRef.current = false;
          bargeSkipDoneRef.current = false;
          transcriptRef.current = [...transcriptRef.current, { role: 'user', text }];
          // 顶部刘海字幕：显示用户说的（recognized 态）
          eventBus.emit('subtitle:update', { phase: 'recognized', text });
          setCallState('speaking');
          // 流式 TTS：播放器先建好，LLM token 一到即喂入合成，首句边生成边播
          ttsStreamRef.current = createStreamPlayer();
          // 开启打断监听：AI 播报途中用户可随时插话
          startBargeMonitor();
          // 发到聊天管线（silent：LLM 照常跑、回复照常回传，但不落聊天历史/不渲染气泡）
          await sendMessage(text, modeRef.current, {
            silent: true,
            onToken: (token) => {
              ttsStreamRef.current?.push(token);
            },
          });
          return;
        }
        // 空音频（静音超时，未检测到语音）：安静继续聆听，把发言权交还用户。
        // 温柔提醒由 wall-clock 定时器（INQUIRY_DELAY_MS）统一负责，这里不连环追问。
        if (activeRef.current) {
          startTurnRef.current();
        }
      } catch (e) {
        log.error('stt transcribe failed', e);
        if (activeRef.current) startTurnRef.current();
      }
      // 下一轮聆听由 TTS 播放结束（或异常）后触发，避免抢话
    };
    try {
      await rec.start();
    } catch (e) {
      log.error('recorder start failed', e);
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('Permission') || errMsg.includes('denied')) {
        showError?.('麦克风权限被拒绝，请在系统设置中允许~');
      } else {
        showError?.('麦克风启动失败~');
      }
      stopCallInternal();
    }
  }, [
    sendMessage,
    setCallState,
    showError,
    stopCallInternal,
    createStreamPlayer,
    scheduleInquiry,
    stopBargeMonitor,
    startBargeMonitor,
    clearInquiryTimer,
  ]);

  // startTurn 递归续听走 ref（见 startTurnRef 声明处注释）
  useEffect(() => {
    startTurnRef.current = startTurn;
  }, [startTurn]);

  const startCall = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setSeconds(0);
    inquiryFiredRef.current = false;
    bargeSkipDoneRef.current = false;
    callStartRef.current = Date.now();
    setCallState('connecting');

    // 计时
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);

    // 让网关按需拉起本地 STT/TTS 服务（按前端活跃 TTS 引擎选择，避免多起闲置 Edge :8001）
    const activeTts = providerManager.getActiveTTSConfig();
    const ready = await new Promise<boolean>((resolve) => {
      voiceStartResolveRef.current = resolve;
      getHermesGatewayClient().sendVoice('start', { typeName: activeTts?.typeName });
      // 兜底：10s 内未收到响应则按"已尝试"继续
      setTimeout(() => {
        if (voiceStartResolveRef.current) {
          voiceStartResolveRef.current(true);
          voiceStartResolveRef.current = null;
        }
      }, 10000);
    });

    if (!ready) {
      stopCallInternal();
      showError?.('本地语音服务启动失败，请检查 STT/TTS 服务配置~');
      return;
    }

    // 服务就绪（STT 是关键），开始通话循环
    const stt = providerManager.getActiveSTTProvider();
    if (!stt) {
      stopCallInternal();
      showError?.('请先在设置中配置语音识别 (STT) 服务~');
      return;
    }
    setCallState('incall');
    startTurn();
  }, [startTurn, stopCallInternal, showError, setCallState]);

  const toggle = useCallback(() => {
    if (activeRef.current) {
      stopCallInternal();
    } else {
      void startCall();
    }
  }, [startCall, stopCallInternal]);

  // 监听网关 voice 状态 + 助手回复（触发 TTS）
  useEffect(() => {
    const offVoice = eventBus.on('hermes:voice', (data: Record<string, unknown>) => {
      const action = data.action as string;
      if (action === 'start') {
        // all_ready = STT + Edge TTS 均已就绪（通话关键服务）；缺则降级为仅看 STT
        const allReady = typeof data.all_ready === 'boolean' ? data.all_ready : undefined;
        const services = (data.services as Record<string, { ok?: boolean }>) || {};
        const sttOk = services.stt ? Boolean(services.stt.ok) : false;
        const ttsOk = services.tts ? Boolean(services.tts.ok) : false;
        const ok = allReady ?? (sttOk && ttsOk);
        const resolve = voiceStartResolveRef.current;
        if (resolve) {
          voiceStartResolveRef.current = null;
          resolve(ok);
        }
      }
    });

    const offDone = eventBus.on('hermes:done', (data: Record<string, unknown>) => {
      if (!activeRef.current) return;
      // 打断已发生：本次 LLM 完成事件忽略，避免重复开启聆听
      if (bargeSkipDoneRef.current) {
        bargeSkipDoneRef.current = false;
        return;
      }
      if (stateRef.current !== 'speaking') return;
      const full = (data.fullResponse as string) || '';
      if (full.trim()) {
        transcriptRef.current = [...transcriptRef.current, { role: 'assistant', text: full }];
      }
      // 流式合成收尾：把残留文本作为最后一句合成播放，播完再进入下一轮聆听。
      // （token 期间已边到边播，这里不再整段重复合成）
      const stream = ttsStreamRef.current;
      ttsStreamRef.current = null;
      if (stream) {
        stream.finish();
        void stream.whenDone().then(() => {
          if (activeRef.current) startTurn();
        });
      } else if (activeRef.current) {
        // 没有任何 token（空回复/异常）→ 直接进入下一轮聆听
        startTurn();
      }
    });

    return () => {
      offVoice();
      offDone();
    };
  }, [startTurn]);

  // 卸载时清理
  useEffect(() => {
    return () => {
      // 若通话仍在进行（未正常挂断），通知网关释放 STT/TTS 服务，避免显存/内存泄漏
      if (activeRef.current) {
        try {
          getHermesGatewayClient().sendVoice('stop');
        } catch {
          /* ignore */
        }
      }
      activeRef.current = false;
      try {
        recorderRef.current?.cancel();
      } catch {
        /* ignore */
      }
      ttsStreamRef.current?.stop();
      ttsStreamRef.current = null;
      stopTts();
      clearInquiryTimer();
      stopBargeMonitor();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stopTts, clearInquiryTimer, stopBargeMonitor]);

  const active = state === 'incall' || state === 'listening' || state === 'speaking';

  return { state, seconds, active, toggle };
}
