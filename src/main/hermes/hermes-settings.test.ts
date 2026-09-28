import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

vi.mock("electron", () => ({
  app: { getPath: () => path.join(tmpdir(), "cyrene-hermes-settings-test"), getAppPath: () => path.join(tmpdir(), "cyrene-app") },
}));

import { discoverUvPath } from "./hermes-settings";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cyrene-uv-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("discoverUvPath", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ["UV_PATH", "PATH", "LOCALAPPDATA"] as const;

  function saveEnv(): void {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  }
  function restoreEnv(): void {
    for (const k of ENV_KEYS) {
      const v = savedEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  it("UV_PATH 环境变量优先", () => {
    saveEnv();
    try {
      const dir = makeTempDir();
      const uv = path.join(dir, "uv.exe");
      writeFileSync(uv, "stub");
      process.env.UV_PATH = uv;
      process.env.PATH = "";
      expect(discoverUvPath()).toBe(uv);
    } finally {
      restoreEnv();
    }
  });

  it("沿 PATH 逐目录发现 uv.exe", () => {
    saveEnv();
    try {
      const dir = makeTempDir();
      const uv = path.join(dir, "uv.exe");
      writeFileSync(uv, "stub");
      delete process.env.UV_PATH;
      process.env.PATH = dir + path.delimiter + "C:\\definitely-not-exist";
      expect(discoverUvPath()).toBe(uv);
    } finally {
      restoreEnv();
    }
  });

  it("候选全部落空时回退裸命令 uv（交由 PATH 运行时解析）", () => {
    saveEnv();
    try {
      const empty = makeTempDir();
      const empty2 = makeTempDir();
      delete process.env.UV_PATH;
      process.env.PATH = empty;
      process.env.LOCALAPPDATA = empty2;
      expect(discoverUvPath()).toBe("uv");
    } finally {
      restoreEnv();
    }
  });
});
