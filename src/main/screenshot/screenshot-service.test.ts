import { describe, expect, it, vi } from "vitest";
import type { ScreenshotHelperClient, ScreenshotResult } from "./helper-client";
import {
  createScreenshotService,
  validateScreenshotInsert,
} from "./screenshot-service";

function result(overrides: Partial<ScreenshotResult> = {}): ScreenshotResult {
  return {
    requestId: "request-1",
    filePath: null,
    width: 800,
    height: 600,
    mime: "image/png",
    clipboardWritten: true,
    hasAnnotations: false,
    ...overrides,
  };
}

function createHarness() {
  const client = {
    processState: "stopped",
    captureState: "idle",
    pendingRequests: new Map(),
    ensureStarted: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(),
    cancel: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as ScreenshotHelperClient;
  const sendInsert = vi.fn();
  const service = createScreenshotService({
    client,
    sendInsert,
  });
  return {
    client,
    sendInsert,
    service,
  };
}

describe("createScreenshotService", () => {
  it("maps the chat button to clipboard-and-file with a renderer-safe preview URL", async () => {
    const harness = createHarness();
    vi.mocked(harness.client.start).mockResolvedValueOnce(
      result({
        requestId: "request-2",
        filePath: "C:\\shots\\valid.png",
        hasAnnotations: true,
      }),
    );

    await expect(harness.service.startFromChatButton()).resolves.toEqual({ ok: true });

    expect(harness.client.start).toHaveBeenCalledWith("clipboard-and-file", "chat-button");
    expect(harness.sendInsert).toHaveBeenCalledWith({
      filePath: "C:\\shots\\valid.png",
      width: 800,
      height: 600,
      mime: "image/png",
      previewUrl: "file:///C:/shots/valid.png",
      hasAnnotations: true,
    });
  });

  it("can return a button capture to the renderer that requested it", async () => {
    const harness = createHarness();
    const requestSender = vi.fn();
    vi.mocked(harness.client.start).mockResolvedValueOnce(
      result({ filePath: "C:\\shots\\react-preview.png" }),
    );

    await expect(harness.service.startFromChatButton(requestSender)).resolves.toEqual({ ok: true });

    expect(requestSender).toHaveBeenCalledOnce();
    expect(harness.sendInsert).not.toHaveBeenCalled();
  });

  it("rejects a chat result that completed without a file path", async () => {
    const harness = createHarness();
    vi.mocked(harness.client.start).mockResolvedValueOnce(result());

    await expect(harness.service.startFromChatButton()).resolves.toEqual({
      ok: false,
      reason: "SCREENSHOT_FILE_PATH_REQUIRED",
    });
    expect(harness.sendInsert).not.toHaveBeenCalled();
  });

  it("does not reject app startup when helper prewarm fails", async () => {
    const harness = createHarness();
    vi.mocked(harness.client.ensureStarted).mockRejectedValueOnce(new Error("missing helper"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(harness.service.prewarm()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[Screenshot] native helper prewarm failed:",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});

describe("validateScreenshotInsert", () => {
  it("accepts only a non-empty PNG inside the fixed screenshot directory", () => {
    const data = {
      filePath: "C:\\user-data\\screenshots\\capture.png",
      width: 800,
      height: 600,
      mime: "image/png" as const,
      hasAnnotations: false,
    };

    expect(
      validateScreenshotInsert(data, "C:\\user-data\\screenshots", () => ({
        isEmpty: () => false,
        getSize: () => ({ width: 800, height: 600 }),
      })),
    ).toEqual({
      ...data,
      previewUrl: "file:///C:/user-data/screenshots/capture.png",
    });
  });

  it("rejects files outside the screenshot directory and mismatched image dimensions", () => {
    const loadImage = vi.fn(() => ({
      isEmpty: () => false,
      getSize: () => ({ width: 640, height: 480 }),
    }));

    expect(
      validateScreenshotInsert(
        {
          filePath: "C:\\user-data\\other\\capture.png",
          width: 800,
          height: 600,
          mime: "image/png",
          hasAnnotations: false,
        },
        "C:\\user-data\\screenshots",
        loadImage,
      ),
    ).toBeNull();
    expect(loadImage).not.toHaveBeenCalled();

    expect(
      validateScreenshotInsert(
        {
          filePath: "C:\\user-data\\screenshots\\capture.png",
          width: 800,
          height: 600,
          mime: "image/png",
          hasAnnotations: false,
        },
        "C:\\user-data\\screenshots",
        loadImage,
      ),
    ).toBeNull();
  });

  it("does not confuse a valid dot-prefixed file name with parent traversal", () => {
    const data = {
      filePath: "C:\\user-data\\screenshots\\..capture.png",
      width: 20,
      height: 10,
      mime: "image/png" as const,
      hasAnnotations: false,
    };

    expect(
      validateScreenshotInsert(data, "C:\\user-data\\screenshots", () => ({
        isEmpty: () => false,
        getSize: () => ({ width: 20, height: 10 }),
      })),
    ).toEqual({
      ...data,
      previewUrl: "file:///C:/user-data/screenshots/..capture.png",
    });
  });
});
