// vision-captioner —— 唯一接触多模态协议的地方。
// 通用视觉服务：给图片+用户问题→调视觉模型→返回文本。
// 不关心图片来源（read_image 只是调用者之一），不碰文件系统。
// 永远走 OpenAI 兼容 image_url 格式，不分 transport。
//
// 判断全交给视觉模型：不本地判断"具体vs泛泛"，把用户原话+图片一起发，
// 用框架指令让视觉模型自己理解任务。

import { resolveTimeoutPolicy } from "../runtime-policy";
import { extractText } from "./ocr-service";
import { ensureOllamaRunning, isLocalOllamaUrl } from "./ollama-service";

/** 视觉模型配置（OpenAI 兼容）。 */
export interface VisionConfig {
  baseUrl: string;  // 如 https://api.openai.com/v1
  apiKey: string;
  model: string;    // 如 gpt-4o / glm-5v-turbo / qwen-vl-max
  /** 是否启用本地 OCR 预处理（提取图片文字补充给视觉模型）。 */
  ocrEnabled?: boolean;
}

/** 图片数据（不含 data: 前缀的纯 base64）。 */
export interface VisionImage {
  base64: string;
  mime: string;  // 如 "image/png"
}

const VISION_TIMEOUT_MS = resolveTimeoutPolicy({ stage: "vision-caption" }).totalMs;

/**
 * 构造框架指令。判断全交给视觉模型——它本身是语言模型，
 * 理解"几只猫"是要数数、"有没有错别字"是 OCR，比本地正则/分类都准。
 * 指令含简洁约束，防止长文本回灌撑爆主模型上下文（连续看多图时尤其关键）。
 */
function buildInstruction(userQuery: string): string {
  if (userQuery && userQuery.trim()) {
    return (
      "你是图片分析助手。用户给你一张图，用户的问题如下：\n" +
      '"' + userQuery + '"\n' +
      "请基于图片直接回答用户的问题。回答务必简洁，直接针对问题给出结论，不要过度展开无关细节。"
    );
  }
  return (
    "你是图片分析助手。用户给你一张图，但没有提出具体问题。\n" +
    "请客观描述这张图片：主要物体、场景、可见文字和重要细节，不要无依据猜测。描述控制在 200 字以内。"
  );
}

/**
 * 调视觉模型分析图片。
 * @param image 图片数据
 * @param userQuery 用户当前问题；空串表示无明确问题（走通用描述）
 * @param config 视觉模型配置
 * @returns 视觉模型的文本回答；失败返回 [错误·...] 字符串
 */
export async function captionImage(
  image: VisionImage,
  userQuery: string,
  config: VisionConfig,
): Promise<string> {
  let instruction = buildInstruction(userQuery);

  // OCR 预处理：仅在配置启用时执行。
  // 提取图片中的文字补充给视觉模型，解决 moondream 等纯视觉模型没有 OCR 能力的问题。
  // OCR 失败或无文字时不影响主流程，走纯视觉分析。
  if (config.ocrEnabled === true) {
    try {
      console.log("[Vision] OCR 已启用，开始 OCR 预处理...");
      const ocrStart = Date.now();
      const ocrResult = await extractText(image);
      console.log("[Vision] OCR 预处理完成，耗时=" + (Date.now() - ocrStart) + "ms");

      if (ocrResult.success && ocrResult.text.length > 20) {
        // 有足够文字（超过20字符），把 OCR 结果补充到 instruction 中
        // 阈值过滤：避免只有 "1/10" 这类编号干扰视觉模型描述图片内容
        instruction =
          instruction +
          "\n\n另外，通过 OCR 识别到图片中的文字如下（仅供参考，可能存在识别错误）：\n" +
          '"""' +
          ocrResult.text +
          '"""\n' +
          "请结合图片内容和上述文字回答用户问题。如果 OCR 结果与图片实际内容不符，请以图片实际内容为准。";
        console.log("[Vision] 图片含文字，已补充 OCR 结果，长度=" + ocrResult.text.length);
      } else {
        console.log("[Vision] 图片未识别到足够文字（长度=" + (ocrResult.text?.length || 0) + "）或 OCR 失败，走纯视觉分析");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[Vision] OCR 预处理异常，跳过:", msg);
    }
  } else {
    console.log("[Vision] OCR 未启用，走纯视觉分析");
  }

  const dataUrl = "data:" + image.mime + ";base64," + image.base64;

  // 永远 OpenAI 兼容格式：image_url content block
  const body = {
    model: config.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: instruction },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    // 不传 temperature：不同模型约束不同（如 Kimi k2.6 只允许 1），
    // 传固定值会在某些模型上报错。让各家用自己的默认值，可用性优先于确定性。
    // 确定性由 buildInstruction 里的"简洁/直接"指令约束保证。
    // 视觉描述用不到 4096 默认值，512 够用且防回灌撑爆主模型上下文。
    // 只传 max_tokens（最通用）。不传 max_completion_tokens——火山不允许两者同时设，
    // MiniMax 虽标 max_tokens 弃用但仍兼容（弃用≠删除）。
    max_tokens: 512,
    stream: false,
  };

  const url = buildChatCompletionsUrl(config.baseUrl);

  // 进度信号（实现要求，非可选）：调用期间界面可能"卡住"30s，必须留日志
  console.log("[Vision] 调用视觉模型:", config.model, "url=" + url, "query.len=" + userQuery.length);
  const startMs = Date.now();

  // 实际的视觉模型请求逻辑（提取成内部函数，方便重试）
  const doRequest = async (): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + config.apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.error("[Vision] 请求失败 HTTP " + resp.status, errText.slice(0, 200));
        return "[错误·运行时] 视觉模型请求失败：HTTP " + resp.status + " " + errText.slice(0, 200);
      }

      const data = await resp.json() as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text) {
        console.error("[Vision] 视觉模型未返回有效内容");
        return "[错误·运行时] 视觉模型未返回有效内容";
      }

      console.log("[Vision] 完成，耗时=" + (Date.now() - startMs) + "ms，返回长度=" + text.length);
      return text;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.error("[Vision] 请求超时");
        return "[错误·运行时] 视觉模型请求超时";
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Vision] 请求异常:", msg);
      return "[错误·运行时] 视觉模型请求异常：" + msg;
    } finally {
      clearTimeout(timer);
    }
  };

  // 第一次请求
  let result = await doRequest();

  // 如果请求失败（fetch failed）且是本地 Ollama 地址，尝试自动启动 Ollama 并重试一次
  if (result.startsWith("[错误·运行时] 视觉模型请求异常：fetch failed") && isLocalOllamaUrl(config.baseUrl)) {
    console.log("[Vision] 检测到本地 Ollama 未运行，尝试自动启动...");
    const ollamaStarted = await ensureOllamaRunning();
    if (ollamaStarted) {
      console.log("[Vision] Ollama 已启动，重试视觉模型请求...");
      result = await doRequest();
    } else {
      console.error("[Vision] Ollama 自动启动失败，请手动启动 Ollama");
      result = "[错误·运行时] 本地 Ollama 未运行且自动启动失败，请手动启动 Ollama 后重试";
    }
  }

  return result;
}

/** 拼接 baseUrl + /chat/completions，兼容用户填的带或不带尾斜杠。 */
function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return trimmed + "/chat/completions";
}
