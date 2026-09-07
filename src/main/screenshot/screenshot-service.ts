import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { ScreenshotInsertPayload } from "../../shared/ipc-channels";
import type { ScreenshotHelperClient } from "./helper-client";

export type ScreenshotInsertData = ScreenshotInsertPayload;
export type ScreenshotInsertCandidate =
  Omit<ScreenshotInsertPayload, "previewUrl">
  & { previewUrl?: string };

export interface ScreenshotService {
  prewarm(): Promise<void>;
  startFromChatButton(sendInsert?: (data: ScreenshotInsertData) => void): Promise<{ ok: boolean; reason?: string }>;
  shutdown(): Promise<void>;
}

export interface ScreenshotServiceDeps {
  client: ScreenshotHelperClient;
  sendInsert(data: ScreenshotInsertData): void;
}

export interface ScreenshotImageProbe {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
}

export function validateScreenshotInsert(
  data: ScreenshotInsertCandidate,
  screenshotDirectory: string,
  loadImage: (filePath: string) => ScreenshotImageProbe,
): ScreenshotInsertData | null {
  const root = path.win32.resolve(screenshotDirectory);
  const filePath = path.win32.resolve(data.filePath);
  const relative = path.win32.relative(root, filePath);
  if (
    relative.length === 0
    || relative === ".."
    || relative.startsWith(`..${path.win32.sep}`)
    || path.win32.isAbsolute(relative)
    || path.win32.extname(filePath).toLowerCase() !== ".png"
  ) {
    return null;
  }

  const image = loadImage(filePath);
  if (image.isEmpty()) return null;
  const size = image.getSize();
  if (
    size.width <= 0
    || size.height <= 0
    || size.width !== data.width
    || size.height !== data.height
  ) {
    return null;
  }
  return {
    ...data,
    filePath,
    previewUrl: pathToFileURL(filePath).toString(),
  };
}

function reasonFrom(error: unknown): string {
  return error instanceof Error ? error.message : "SCREENSHOT_FAILED";
}

export function createScreenshotService(deps: ScreenshotServiceDeps): ScreenshotService {
  const startFromChatButton = async (
    sendInsert: (data: ScreenshotInsertData) => void = deps.sendInsert,
  ): Promise<{ ok: boolean; reason?: string }> => {
    try {
      const result = await deps.client.start("clipboard-and-file", "chat-button");
      if (!result.filePath) {
        return { ok: false, reason: "SCREENSHOT_FILE_PATH_REQUIRED" };
      }
      sendInsert({
        filePath: result.filePath,
        width: result.width,
        height: result.height,
        mime: result.mime,
        previewUrl: pathToFileURL(result.filePath).toString(),
        hasAnnotations: result.hasAnnotations,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: reasonFrom(error) };
    }
  };

  return {
    async prewarm() {
      try {
        await deps.client.ensureStarted();
      } catch (error) {
        // Helper availability is optional at app startup. A later screenshot
        // request will retry through ScreenshotHelperClient.start().
        console.warn("[Screenshot] native helper prewarm failed:", error);
      }
    },
    startFromChatButton,
    async shutdown() {
      await deps.client.shutdown();
    },
  };
}
