import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let appPath = "";
vi.mock("electron", () => ({
  app: { getAppPath: () => appPath },
}));

import { getDevServerBaseUrl } from "./dev-server-url";

/** 写入 vite 探测文件（目录不存在时自动创建）。 */
function writeProbe(url: string): void {
  const file = join(appPath, "dist", "main", ".vite-dev-url.json");
  mkdirSync(join(appPath, "dist", "main"), { recursive: true });
  writeFileSync(file, url);
}

describe("getDevServerBaseUrl", () => {
  beforeEach(() => {
    appPath = mkdtempSync(join(tmpdir(), "cyrene-dev-url-"));
  });

  afterEach(() => {
    if (appPath) rmSync(appPath, { recursive: true, force: true });
  });

  it("reads the actual port from the vite probe file", () => {
    writeProbe(JSON.stringify({ url: "http://localhost:5174" }));
    expect(getDevServerBaseUrl(true)).toBe("http://localhost:5174");
  });

  it("strips trailing slashes from the probe url", () => {
    writeProbe(JSON.stringify({ url: "http://localhost:5174/" }));
    expect(getDevServerBaseUrl(true)).toBe("http://localhost:5174");
  });

  it("falls back to the default port when the probe file is missing", () => {
    expect(getDevServerBaseUrl(true)).toBe("http://localhost:5173");
  });

  it("falls back when the probe file is malformed", () => {
    writeProbe("{ not json");
    expect(getDevServerBaseUrl(true)).toBe("http://localhost:5173");
  });

  it("returns empty string in production", () => {
    expect(getDevServerBaseUrl(false)).toBe("");
  });
});
