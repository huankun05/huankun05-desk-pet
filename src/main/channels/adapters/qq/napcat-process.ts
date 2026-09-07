/**
 * napcat-process —— 应用启动时自动拉起 NapCat（注入 QQ）的辅助模块。
 *
 * 背景：QQ 渠道（NapCat/OneBot）依赖本机 NapCatShell 注入 QQ 进程。
 * 之前需要用户手动运行 launcher-user.bat；本模块在 QQ 渠道 enabled 时
 * 由 NapCatAdapter.start() 调用，自动完成：
 *   1. 检测 QQ / NapCatWinBootMain 是否已在运行（避免重复拉起）
 *   2. 定位 NapCatShell 目录（优先配置 napcatPath，其次应用目录上级约定）
 *   3. 从注册表读取 QQ 安装路径（与 launcher-user.bat 同源）
 *   4. 重写 loadNapCat.js 并 spawn NapCatWinBootMain.exe（detached，不随应用退出）
 *
 * 所有函数均支持注入以便单测；失败只记日志，绝不阻塞应用启动。
 */
import { spawn, execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { logger, LogTag } from "../../../logger";

const REG_QQ_UNINSTALL =
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ";

const NAPCAT_MAIN_FILES = [
  "NapCatWinBootMain.exe",
  "NapCatWinBootHook.dll",
  "napcat.mjs",
  "qqnt.json",
  "loadNapCat.js",
] as const;

export interface EnsureNapCatOptions {
  /** 用户配置的 NapCatShell 目录（settings.qq.napcatPath），空则走自动探测 */
  napcatPath?: string;
  /** 应用根目录（默认 Electron app.getAppPath()），用于 dev 场景定位上级 NapCatShell */
  appPath?: string;
  /** 检测进程是否存在的函数（可注入以便测试） */
  checkRunning?: () => Promise<boolean>;
  /** 读取注册表 UninstallString 的函数（可注入以便测试） */
  readQqUninstallString?: () => Promise<string | null>;
  /** 实际执行 spawn 的函数（可注入以便测试） */
  spawnFn?: (exe: string, args: string[], env: NodeJS.ProcessEnv) => void;
  /** 写 loadNapCat.js 的函数（可注入以便测试） */
  writeLoader?: (shellDir: string) => void;
}

export interface EnsureNapCatResult {
  launched: boolean;
  reason?: string;
}

/** 解析 `reg query` 的 UninstallString 输出 → 完整卸载器路径（去引号）。 */
export function parseRegUninstallString(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/UninstallString\s+REG_SZ\s+(.+)/i);
    if (match) {
      const raw = match[1].trim();
      const cleaned = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
      if (cleaned) return cleaned;
    }
  }
  return null;
}

/** 由卸载器路径推导 QQ.exe 路径（同 launcher-user.bat：取目录 + QQ.exe）。 */
export function qqExecutableFromUninstallString(uninstallString: string): string | null {
  if (!uninstallString) return null;
  const dir = path.dirname(uninstallString.trim());
  if (!dir || dir === "." || dir === "/") return null;
  return path.join(dir, "QQ.exe");
}

/** 应用目录的上级目录 + NapCatShell 约定（dev 场景：项目根下的 NapCatShell）。 */
export function defaultNapCatShellCandidates(appPath: string): string[] {
  const parent = path.dirname(appPath);
  return [
    path.join(parent, "NapCatShell"),
    path.join(parent, "napcat"),
    path.join(parent, "NapCat"),
  ];
}

/** 在候选目录中找含 NapCat 主程序的目录；找不到返回 null。 */
export function resolveNapCatShellDir(
  candidates: string[],
  stat: (p: string) => fs.Stats = fs.statSync,
): string | null {
  for (const dir of candidates) {
    if (!dir) continue;
    let ok = true;
    for (const file of NAPCAT_MAIN_FILES) {
      try {
        stat(path.join(dir, file));
      } catch {
        ok = false;
        break;
      }
    }
    if (ok) return dir;
  }
  return null;
}

/** 重写 loadNapCat.js（与 launcher-user.bat 的写法保持一致，路径转 file:// 正斜杠）。 */
export function writeLoadNapCatJs(shellDir: string, writeFile = fs.writeFileSync): void {
  const mainPath = path.join(shellDir, "napcat.mjs").replace(/\\/g, "/");
  const loader = `(async () => {await import("file:///${mainPath}")})()`;
  writeFile(path.join(shellDir, "loadNapCat.js"), loader, "utf8");
}

function execFileAsync(cmd: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve({ stdout });
    });
  });
}

/** Windows 下按进程名查 tasklist，判断是否已有该进程。 */
export function hasWindowsProcess(
  imageName: string,
  exec: (cmd: string, args: string[]) => Promise<{ stdout: string }> = execFileAsync,
): Promise<boolean> {
  return exec("tasklist", ["/FI", `IMAGENAME eq ${imageName}`, "/NH"]).then(
    (r) => /^\s*[^\s]+\s+\d+/.test(r.stdout) || r.stdout.toLowerCase().includes(imageName.toLowerCase()),
    () => false,
  );
}

/** 检测 QQ / NapCat 是否已在运行（任一存在即视为已挂起）。 */
export async function isNapCatProcessRunning(
  has: (name: string) => Promise<boolean> = hasWindowsProcess,
): Promise<boolean> {
  const names = ["QQ.exe", "NapCatWinBootMain.exe"];
  for (const name of names) {
    if (await has(name)) return true;
  }
  return false;
}

/** 从注册表读取 QQ UninstallString；读取失败/缺失返回 null。 */
export async function readQqUninstallStringFromRegistry(
  exec: (cmd: string, args: string[]) => Promise<{ stdout: string }> = execFileAsync,
): Promise<string | null> {
  try {
    const { stdout } = await exec("reg", ["query", REG_QQ_UNINSTALL, "/v", "UninstallString"]);
    return parseRegUninstallString(stdout);
  } catch {
    return null;
  }
}

function spawnNapCat(exe: string, args: string[], env: NodeJS.ProcessEnv): void {
  const child = spawn(exe, args, {
    env,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
}

/**
 * 主入口：确保 NapCat 已注入运行。进程在跑 → 直接返回；否则自动拉起。
 * 任何失败都只返回原因，不抛错，绝不阻塞应用启动。
 */
export async function ensureNapCatRunning(options: EnsureNapCatOptions = {}): Promise<EnsureNapCatResult> {
  if (process.platform !== "win32") {
    return { launched: false, reason: "仅支持 Windows 平台" };
  }
  // 测试环境跳过真实进程操作；但调用方已注入依赖（单测）时放行以便验证逻辑
  const hasInjection = Boolean(
    options.checkRunning || options.spawnFn || options.readQqUninstallString || options.writeLoader,
  );
  if (process.env.VITEST && !hasInjection) {
    return { launched: false, reason: "测试环境跳过自动拉起" };
  }

  // 1. 已在运行则跳过（幂等：渠道 restart / 应用重启都不会重复拉起）
  const checkRunning = options.checkRunning ?? isNapCatProcessRunning;
  try {
    if (await checkRunning()) {
      return { launched: false, reason: "NapCat/QQ 已在运行" };
    }
  } catch (error) {
    logger.warn(LogTag.Channels, "[NapCatProcess] 进程检测失败，继续尝试拉起:", String(error));
  }

  // 2. 定位 NapCatShell 目录
  const appPath = options.appPath ?? "";
  const candidates = [
    options.napcatPath?.trim(),
    ...(appPath ? defaultNapCatShellCandidates(appPath) : []),
  ].filter((v): v is string => Boolean(v));
  const shellDir = resolveNapCatShellDir(candidates);
  if (!shellDir) {
    return {
      launched: false,
      reason: "未找到 NapCatShell 目录（可在 QQ 渠道设置中配置 NapCat 目录）",
    };
  }

  // 3. 读取 QQ 安装路径（注册表，同 launcher-user.bat）
  const readUninstall = options.readQqUninstallString ?? readQqUninstallStringFromRegistry;
  const uninstallString = await readUninstall();
  const qqPath = uninstallString ? qqExecutableFromUninstallString(uninstallString) : null;
  if (!qqPath || !fs.existsSync(qqPath)) {
    return { launched: false, reason: "未找到 QQ 安装路径（注册表 Uninstall 项缺失或指向无效）" };
  }

  // 4. 重写 loader 并 spawn（detached 使 NapCat 不随应用退出，避免频繁重登）
  const writeLoader = options.writeLoader ?? writeLoadNapCatJs;
  try {
    writeLoader(shellDir);
  } catch (error) {
    return { launched: false, reason: `写 loadNapCat.js 失败: ${String(error)}` };
  }

  const exe = path.join(shellDir, "NapCatWinBootMain.exe");
  const hookDll = path.join(shellDir, "NapCatWinBootHook.dll");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NAPCAT_PATCH_PACKAGE: path.join(shellDir, "qqnt.json"),
    NAPCAT_LOAD_PATH: path.join(shellDir, "loadNapCat.js"),
    NAPCAT_INJECT_PATH: hookDll,
    NAPCAT_LAUNCHER_PATH: exe,
    NAPCAT_MAIN_PATH: path.join(shellDir, "napcat.mjs"),
  };
  const doSpawn = options.spawnFn ?? spawnNapCat;
  try {
    doSpawn(exe, [qqPath, hookDll], env);
    logger.info(LogTag.Channels, `[NapCatProcess] 已自动拉起 NapCat: ${exe} → ${qqPath}`);
    return { launched: true };
  } catch (error) {
    return { launched: false, reason: `启动 NapCat 失败: ${String(error)}` };
  }
}
