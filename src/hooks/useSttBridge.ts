import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { providerManager } from '../services/provider/manager';
import { isTauriEnv } from '../utils/tauriEnv';
import type { ChatSession } from '../services/chatStorage';

export interface UseSttBridgeOptions {
  handleSendMessage: (content: string) => Promise<void> | void;
  updateFromVoice: (text: string, voiceEmotion?: string) => void;
  sessionRef: React.MutableRefObject<ChatSession | null>;
}

/** 兜底轮询间隔：事件正常时用不到，仅防止事件丢失导致录音卡死 */
const FALLBACK_POLL_MS = 3000;

/**
 * STT 桥：聊天面板窗录完音后写入 localStorage 并发 `stt-audio-ready` 事件，
 * 本 hook 收到事件后立即取走音频、调用 STT provider 转写并发送。
 *
 * 为什么不用 storage 事件：Tauri 多 webview 下 localStorage 数据是共享的，但
 * storage 事件不跨 webview 传播，主窗根本收不到，因此改用 Tauri 事件通知。
 * 另保留一个低频兜底轮询，确保事件万一丢失时录音不会一直滞留。
 */
export function useSttBridge({
  handleSendMessage,
  updateFromVoice,
  sessionRef,
}: UseSttBridgeOptions): void {
  useEffect(() => {
    // 防止事件与兜底轮询同时进入导致同一段音频被转写两次
    let draining = false;

    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        const raw = localStorage.getItem('deskpet_sttAudio');
        if (!raw) return;
        localStorage.removeItem('deskpet_sttAudio');

        const sid = sessionRef.current?.id;
        const sttProvider = sid
          ? providerManager.getSessionSTTProvider(sid)
          : providerManager.getActiveSTTProvider();
        if (!sttProvider) return;

        const binaryStr = atob(raw);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const audio = bytes.buffer;

        const result = await sttProvider.transcribe(audio, 'wav');
        if (result.text.trim()) {
          if (result.emotion) updateFromVoice(result.text, result.emotion);
          handleSendMessage(result.text.trim());
        }
      } catch (err) {
        console.error('[STT Bridge] failed:', err);
      } finally {
        draining = false;
      }
    };

    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (isTauriEnv()) {
      listen('stt-audio-ready', () => void drain())
        .then((fn) => {
          // 卸载可能早于 listen resolve，此时直接注销避免监听器泄漏
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => {
          /* 事件不可用时退化为纯轮询 */
        });
    }

    const timer = setInterval(() => void drain(), FALLBACK_POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
      unlisten?.();
    };
  }, [handleSendMessage, updateFromVoice, sessionRef]);
}
