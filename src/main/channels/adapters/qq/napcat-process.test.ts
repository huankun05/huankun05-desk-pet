import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureNapCatRunning,
  isNapCatProcessRunning,
  parseRegUninstallString,
  qqExecutableFromUninstallString,
  resolveNapCatShellDir,
  writeLoadNapCatJs,
} from "./napcat-process";

describe("parseRegUninstallString", () => {
  it("parses a quoted REG_SZ value", () => {
    const out = [
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ",
      "    UninstallString    REG_SZ    \"E:\\software\\QQ\\Uninstall.exe\"",
      "",
    ].join("\r\n");
    expect(parseRegUninstallString(out)).toBe("E:\\software\\QQ\\Uninstall.exe");
  });

  it("parses an unquoted value", () => {
    const out = "    UninstallString    REG_SZ    C:\\Program Files\\Tencent\\QQNT\\Uninstall.exe\r\n";
    expect(parseRegUninstallString(out)).toBe("C:\\Program Files\\Tencent\\QQNT\\Uninstall.exe");
  });

  it("returns null when key is missing", () => {
    expect(parseRegUninstallString("ERROR: The system was unable to find the specified registry key")).toBeNull();
  });
});

describe("qqExecutableFromUninstallString", () => {
  it("derives QQ.exe from uninstaller path", () => {
    expect(qqExecutableFromUninstallString("E:\\software\\QQ\\Uninstall.exe")).toBe("E:\\software\\QQ\\QQ.exe");
  });

  it("returns null for empty input", () => {
    expect(qqExecutableFromUninstallString("")).toBeNull();
    expect(qqExecutableFromUninstallString("  ")).toBeNull();
  });
});

describe("resolveNapCatShellDir", () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("finds the directory containing all NapCat main files", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "napcat-test-"));
    for (const file of ["NapCatWinBootMain.exe", "NapCatWinBootHook.dll", "napcat.mjs", "qqnt.json", "loadNapCat.js"]) {
      fs.writeFileSync(path.join(dir, file), "x");
    }
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), "napcat-bad-"));
    expect(resolveNapCatShellDir([bad, dir])).toBe(dir);
    fs.rmSync(bad, { recursive: true, force: true });
  });

  it("returns null when nothing matches", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "napcat-none-"));
    expect(resolveNapCatShellDir([dir])).toBeNull();
  });
});

describe("writeLoadNapCatJs", () => {
  it("writes a file:// loader with forward slashes", () => {
    const writeFile = vi.fn();
    writeLoadNapCatJs("F:\\Work\\Create\\desk_pet\\NapCatShell", writeFile);
    expect(writeFile).toHaveBeenCalledWith(
      path.join("F:\\Work\\Create\\desk_pet\\NapCatShell", "loadNapCat.js"),
      '(async () => {await import("file:///F:/Work/Create/desk_pet/NapCatShell/napcat.mjs")})()',
      "utf8",
    );
  });
});

describe("isNapCatProcessRunning", () => {
  it("returns true when QQ.exe is running", async () => {
    const has = vi.fn(async (name: string) => name === "QQ.exe");
    expect(await isNapCatProcessRunning(has)).toBe(true);
  });

  it("returns true when NapCatWinBootMain is running", async () => {
    const has = vi.fn(async (name: string) => name === "NapCatWinBootMain.exe");
    expect(await isNapCatProcessRunning(has)).toBe(true);
  });

  it("returns false when neither is running", async () => {
    const has = vi.fn(async () => false);
    expect(await isNapCatProcessRunning(has)).toBe(false);
  });
});

describe("ensureNapCatRunning", () => {
  it("skips when NapCat/QQ is already running", async () => {
    const result = await ensureNapCatRunning({ checkRunning: async () => true });
    expect(result).toEqual({ launched: false, reason: "NapCat/QQ 已在运行" });
  });

  it("reports missing NapCatShell directory", async () => {
    const result = await ensureNapCatRunning({
      checkRunning: async () => false,
      appPath: "C:\\dev\\desk-pet\\app",
      napcatPath: "Z:\\nonexistent",
    });
    expect(result.launched).toBe(false);
    expect(result.reason).toContain("未找到 NapCatShell");
  });

  it("spawns NapCat with env and QQ path when all pieces resolve", async () => {
    let dir: string;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "napcat-spawn-"));
    try {
      for (const file of ["NapCatWinBootMain.exe", "NapCatWinBootHook.dll", "napcat.mjs", "qqnt.json", "loadNapCat.js"]) {
        fs.writeFileSync(path.join(dir, file), "x");
      }
      fs.writeFileSync(path.join(dir, "..", "QQ.exe"), "x");
      const qqPath = path.join(dir, "..", "QQ.exe");
      const spawnFn = vi.fn();
      const readQqUninstallString = vi.fn(async () => `${path.dirname(qqPath)}\\Uninstall.exe`);
      const result = await ensureNapCatRunning({
        checkRunning: async () => false,
        napcatPath: dir,
        readQqUninstallString,
        spawnFn,
      });
      expect(result.launched).toBe(true);
      expect(spawnFn).toHaveBeenCalledTimes(1);
      const [exe, args, env] = spawnFn.mock.calls[0];
      expect(exe).toBe(path.join(dir, "NapCatWinBootMain.exe"));
      expect(args).toEqual([qqPath, path.join(dir, "NapCatWinBootHook.dll")]);
      expect(env.NAPCAT_MAIN_PATH).toBe(path.join(dir, "napcat.mjs"));
      expect(env.NAPCAT_PATCH_PACKAGE).toBe(path.join(dir, "qqnt.json"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports missing QQ installation", async () => {
    let dir: string;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "napcat-noqq-"));
    try {
      for (const file of ["NapCatWinBootMain.exe", "NapCatWinBootHook.dll", "napcat.mjs", "qqnt.json", "loadNapCat.js"]) {
        fs.writeFileSync(path.join(dir, file), "x");
      }
      const result = await ensureNapCatRunning({
        checkRunning: async () => false,
        napcatPath: dir,
        readQqUninstallString: async () => null,
      });
      expect(result.launched).toBe(false);
      expect(result.reason).toContain("未找到 QQ 安装路径");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
