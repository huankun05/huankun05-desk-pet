// 商汤 SenseAudio TTS 引擎
//
// API 参考：https://docs.senseaudio.cn/api-reference/endpoint/tts/synthesize
// 鉴权：Authorization: Bearer {API_KEY}
// 接口：POST https://api.senseaudio.cn/v1/t2a_v2

import { resolveTimeoutPolicy } from "../runtime-policy";

const BASE_URL = "https://api.senseaudio.cn";
const DEFAULT_MODEL = "senseaudio-tts-1.5-260319";
const DEFAULT_VOICE_ID = "female_0033_b";

export interface SenseAudioSynthesizeOptions {
  apiKey: string;
  text: string;
  voiceId?: string;
  speed?: number;
  model?: string;
  timeoutMs?: number;
  debugLog?: (entry: Record<string, unknown>) => void;
}

export interface SenseAudioSynthesizeResult {
  audio: Buffer;
  format: "wav" | "mp3";
  sampleRate?: number;
  bitrate?: number;
  channels?: number;
  durationMs?: number;
}

const DEFAULT_TIMEOUT_MS = resolveTimeoutPolicy({ stage: "tts-custom-cloud" }).totalMs;

export async function synthesize(
  opts: SenseAudioSynthesizeOptions,
): Promise<SenseAudioSynthesizeResult> {
  const apiKey = opts.apiKey?.trim();
  const text = opts.text?.trim();
  const voiceId = opts.voiceId?.trim() || DEFAULT_VOICE_ID;
  const speed = opts.speed ?? 1;
  const model = opts.model?.trim() || DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestId = `senseaudio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  const log = (entry: Record<string, unknown>) => {
    try {
      opts.debugLog?.({ requestId, ts: new Date().toISOString(), ...entry });
    } catch {
      /* ignore */
    }
  };

  if (!apiKey) throw new Error("缺少商汤 SenseAudio API Key");
  if (!text) throw new Error("缺少合成文本");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  log({
    phase: "request.begin",
    endpoint: `${BASE_URL}/v1/t2a_v2`,
    model,
    voiceId,
    speed,
    textChars: Array.from(text).length,
    timeoutMs,
  });

  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}/v1/t2a_v2`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        text,
        stream: false,
        voice_setting: {
          voice_id: voiceId,
          speed,
        },
        audio_setting: {
          format: "mp3",
          sample_rate: 32000,
          bitrate: 128000,
          channel: 2,
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      log({ phase: "error", error: `合成超时（${timeoutMs}ms）`, durationMs: Date.now() - startedAt });
      throw new Error(`商汤 SenseAudio TTS 合成超时（${timeoutMs}ms）`);
    }
    log({
      phase: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`商汤 SenseAudio TTS 请求失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const preview = (await resp.text().catch(() => "")).slice(0, 500);
    log({
      phase: "error",
      status: resp.status,
      bodyPreview: preview,
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`商汤 SenseAudio TTS 合成失败: ${resp.status} ${preview}`.trim());
  }

  const contentType = resp.headers.get("content-type") || "";
  log({
    phase: "response.received",
    status: resp.status,
    contentType,
    durationMs: Date.now() - startedAt,
  });

  // 解析响应
  const data = (await resp.json()) as {
    data?: {
      audio?: string;
      status?: number;
    };
    extra_info?: {
      audio_length?: number;
      audio_sample_rate?: number;
      audio_size?: number;
      bitrate?: number;
      audio_format?: string;
      audio_channel?: number;
    };
    code?: number;
    message?: string;
  };

  if (data.code !== undefined && data.code !== 0 && data.code !== 200) {
    log({
      phase: "error",
      code: data.code,
      message: data.message,
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`商汤 SenseAudio TTS 合成失败: ${data.code} ${data.message || ""}`.trim());
  }

  if (!data.data?.audio) {
    log({
      phase: "error",
      error: "响应中没有音频数据",
      response: JSON.stringify(data).slice(0, 500),
      durationMs: Date.now() - startedAt,
    });
    throw new Error("商汤 SenseAudio TTS 响应中没有音频数据");
  }

  // 解码十六进制音频（商汤 TTS 返回的是十六进制编码，不是 base64）
  let audioBuffer: Buffer;
  try {
    audioBuffer = Buffer.from(data.data.audio, "hex");
  } catch (err) {
    log({
      phase: "error",
      error: "十六进制解码失败",
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`商汤 SenseAudio TTS 音频解码失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 判断音频格式
  const format = (data.extra_info?.audio_format?.toLowerCase().includes("wav") ? "wav" : "mp3") as
    | "wav"
    | "mp3";

  log({
    phase: "success",
    audioSize: audioBuffer.length,
    format,
    sampleRate: data.extra_info?.audio_sample_rate,
    bitrate: data.extra_info?.bitrate,
    channels: data.extra_info?.audio_channel,
    durationMs: data.extra_info?.audio_length,
    totalDurationMs: Date.now() - startedAt,
  });

  return {
    audio: audioBuffer,
    format,
    sampleRate: data.extra_info?.audio_sample_rate,
    bitrate: data.extra_info?.bitrate,
    channels: data.extra_info?.audio_channel,
    durationMs: data.extra_info?.audio_length,
  };
}

/**
 * 查询可用音色列表
 * API 参考：https://docs.senseaudio.cn/api-reference/endpoint/voice/list
 */
export interface SenseAudioVoiceItem {
  voice_id: string;
  voice_name?: string;
  description?: string[];
  created_time?: string;
}

export interface SenseAudioVoiceList {
  system_voice?: SenseAudioVoiceItem[];
  voice_cloning?: SenseAudioVoiceItem[];
  voice_generation?: SenseAudioVoiceItem[];
}

export async function listVoices(
  apiKey: string,
  voiceType: "system" | "voice_clone" | "voice_generation" | "all" = "all",
  timeoutMs?: number,
): Promise<SenseAudioVoiceList> {
  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const resp = await fetch(`${BASE_URL}/v1/get_voice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ voice_type: voiceType }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const preview = (await resp.text().catch(() => "")).slice(0, 500);
      throw new Error(`查询音色列表失败: ${resp.status} ${preview}`.trim());
    }

    const data = (await resp.json()) as SenseAudioVoiceList & {
      base_resp?: { status_code?: number; status_msg?: string };
    };

    if (data.base_resp?.status_code !== undefined && data.base_resp.status_code !== 0) {
      throw new Error(`查询音色列表失败: ${data.base_resp.status_code} ${data.base_resp.status_msg || ""}`.trim());
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}
