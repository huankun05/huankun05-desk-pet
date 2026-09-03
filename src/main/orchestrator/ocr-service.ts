// ocr-service —— 本地 OCR 服务，用于提取图片中的文字。
// 配合视觉模型使用：有文字的图片先 OCR 提取文字，再把文字+图片一起传给视觉模型分析。
// 解决 moondream 等纯视觉模型没有 OCR 能力的问题。

import { createWorker, type Worker } from "tesseract.js";
import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import type { VisionImage } from "./vision-captioner";

/** OCR 识别结果 */
export interface OcrResult {
  text: string;        // 识别到的文字（已 trim）
  confidence: number;   // 置信度（0-100）
  success: boolean;     // 是否成功
}

let worker: Worker | null = null;
let workerInitializing: Promise<Worker> | null = null;

/**
 * 获取持久化的语言包目录（用户数据目录/tessdata）。
 * 确保下载的语言包不会在应用重启后丢失，无需每次重新下载。
 */
function getTessdataDir(): string {
  const userDataDir = app.getPath("userData");
  const tessdataDir = path.join(userDataDir, "tessdata");
  if (!fs.existsSync(tessdataDir)) {
    fs.mkdirSync(tessdataDir, { recursive: true });
  }
  return tessdataDir;
}

/**
 * 获取或初始化 Tesseract worker（单例）。
 * 首次调用会下载语言包到持久化目录，后续启动直接复用本地缓存。
 */
async function getWorker(): Promise<Worker> {
  if (worker) return worker;
  if (workerInitializing) return workerInitializing;

  workerInitializing = (async () => {
    const tessdataDir = getTessdataDir();
    console.log("[OCR] 初始化 Tesseract worker，语言: chi_sim+eng，缓存目录: " + tessdataDir);
    const startMs = Date.now();
    // cachePath → 下载后缓存到用户数据目录，持久化避免每次重新下载
    // langPath 不设置 → 使用默认 CDN 下载语言包
    const w = await createWorker(["chi_sim", "eng"], 1, {
      cachePath: tessdataDir,
    });
    worker = w;
    console.log("[OCR] Tesseract worker 初始化完成，耗时=" + (Date.now() - startMs) + "ms");
    return w;
  })();

  try {
    return await workerInitializing;
  } finally {
    workerInitializing = null;
  }
}

/**
 * 识别图片中的文字。
 * @param image 图片数据（base64 + mime）
 * @returns OCR 识别结果；失败返回 success=false，text 为空
 */
export async function extractText(image: VisionImage): Promise<OcrResult> {
  try {
    const w = await getWorker();
    const dataUrl = "data:" + image.mime + ";base64," + image.base64;

    console.log("[OCR] 开始识别图片...");
    const startMs = Date.now();
    const { data } = await w.recognize(dataUrl);
    const elapsed = Date.now() - startMs;

    const text = (data.text || "").trim();
    console.log(
      "[OCR] 识别完成，耗时=" + elapsed + "ms，置信度=" +
      (data.confidence ?? 0) + "%，文字长度=" + text.length
    );

    return {
      text,
      confidence: data.confidence ?? 0,
      success: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[OCR] 识别失败:", msg);
    return { text: "", confidence: 0, success: false };
  }
}

/**
 * 释放 worker 资源（应用退出时调用，可选）。
 */
export async function terminateOcrWorker(): Promise<void> {
  if (worker) {
    try {
      await worker.terminate();
    } catch {
      // 忽略释放时的错误
    }
    worker = null;
  }
}
