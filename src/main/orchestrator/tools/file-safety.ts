// File Safety — 文件安全黑名单（移植自 Hermes agent/file_safety.py）
//
// 核心目标：防止 Agent 误写/误读敏感文件（SSH 私钥、环境变量、凭据文件等）。
//
// 设计原则：
// - 纯函数，不依赖 Electron/磁盘，可独立测试
// - 防御性深度（defense-in-depth）：不是安全边界（Agent 仍可通过 run_shell 绕过），
//   但能阻止大多数误操作，并在日志中留下审计痕迹
// - 适配 Windows 路径（Cyrene 是 Windows 桌面应用）
//
// 两类检查：
// 1. 写入拒绝（isWriteDenied）：精确敏感路径 + 敏感目录前缀
// 2. 读取拒绝（getReadBlockError）：项目级 .env 文件等敏感文件

import * as path from "path";
import * as os from "os";

// ── 路径工具 ───────────────────────────────────────────────

/** 获取用户主目录（Windows: C:\Users\<user>） */
function getHomeDir(): string {
  return os.homedir();
}

/** 规范化路径为可比较的形式（解析 ~、相对路径、符号链接） */
function resolvePath(inputPath: string): string {
  let p = inputPath;
  // 展开 ~
  if (p === "~" || p.startsWith("~" + path.sep) || p.startsWith("~/")) {
    p = path.join(getHomeDir(), p.slice(1));
  }
  try {
    return path.resolve(p);
  } catch {
    return p;
  }
}

/** 路径分隔符规范化（Windows 下同时支持 / 和 \） */
function normalizeSeparators(p: string): string {
  return p.replace(/[\\/]/g, path.sep);
}

// ── 写入拒绝：精确敏感路径 ─────────────────────────────────

/**
 * 构建精确敏感路径列表（禁止写入）。
 * 移植自 Hermes build_write_denied_paths，适配 Windows。
 */
export function buildWriteDeniedPaths(): string[] {
  const home = getHomeDir();
  const paths: string[] = [
    // SSH 密钥和配置
    path.join(home, ".ssh", "authorized_keys"),
    path.join(home, ".ssh", "id_rsa"),
    path.join(home, ".ssh", "id_ed25519"),
    path.join(home, ".ssh", "id_ecdsa"),
    path.join(home, ".ssh", "id_dsa"),
    path.join(home, ".ssh", "config"),
    path.join(home, ".ssh", "known_hosts"),

    // 凭据文件
    path.join(home, ".netrc"),
    path.join(home, ".pgpass"),
    path.join(home, ".npmrc"),
    path.join(home, ".pypirc"),
    path.join(home, ".git-credentials"),
    path.join(home, ".gitconfig"),

    // 云服务凭据
    path.join(home, ".aws", "credentials"),
    path.join(home, ".aws", "config"),
    path.join(home, ".gnupg", "secring.gpg"),
    path.join(home, ".gnupg", "pubring.gpg"),
    path.join(home, ".kube", "config"),
    path.join(home, ".docker", "config.json"),
    path.join(home, ".azure", "accessTokens.json"),
    path.join(home, ".azure", "azureProfile.json"),

    // Windows 特定敏感路径
    path.join(home, "AppData", "Roaming", "Microsoft", "Credentials"),
    path.join(home, "AppData", "Local", "Microsoft", "Credentials"),
  ];

  return paths.map(resolvePath);
}

// ── 写入拒绝：敏感目录前缀 ─────────────────────────────────

/**
 * 构建敏感目录前缀列表（禁止写入目录下任何文件）。
 * 移植自 Hermes build_write_denied_prefixes，适配 Windows。
 */
export function buildWriteDeniedPrefixes(): string[] {
  const home = getHomeDir();
  const dirs: string[] = [
    // SSH / GPG / 云服务 / 容器 配置目录
    path.join(home, ".ssh"),
    path.join(home, ".aws"),
    path.join(home, ".gnupg"),
    path.join(home, ".kube"),
    path.join(home, ".docker"),
    path.join(home, ".azure"),
    path.join(home, ".config", "gh"),
    path.join(home, ".config", "gcloud"),

    // Windows 特定
    path.join(home, "AppData", "Roaming", "Microsoft", "Credentials"),
    path.join(home, "AppData", "Local", "Microsoft", "Credentials"),
    path.join(home, "AppData", "Roaming", "Microsoft", "Crypto"),
  ];

  return dirs.map((d) => resolvePath(d) + path.sep);
}

// ── 写入拒绝检查 ───────────────────────────────────────────

/**
 * 检查路径是否被写入拒绝。
 * @returns true 表示禁止写入，false 表示允许
 */
export function isWriteDenied(inputPath: string): boolean {
  const resolved = resolvePath(inputPath);
  const normalized = normalizeSeparators(resolved);

  // 精确路径匹配
  const deniedPaths = buildWriteDeniedPaths();
  for (const denied of deniedPaths) {
    if (normalized === normalizeSeparators(denied)) {
      return true;
    }
  }

  // 目录前缀匹配
  const deniedPrefixes = buildWriteDeniedPrefixes();
  for (const prefix of deniedPrefixes) {
    if (normalized.startsWith(normalizeSeparators(prefix))) {
      return true;
    }
  }

  return false;
}

/**
 * 获取写入拒绝的错误信息（如果路径被拒绝）。
 * @returns 错误信息字符串；null 表示允许写入
 */
export function getWriteDeniedError(inputPath: string): string | null {
  if (!isWriteDenied(inputPath)) return null;

  const resolved = resolvePath(inputPath);
  return (
    `[拒绝] 路径 ${resolved} 是敏感文件/目录，禁止写入。\n` +
    `这是防御性深度检查（不是安全边界，run_shell 仍可绕过），目的是防止误操作。\n` +
    `如果确实需要修改此文件，请确认操作意图后使用 run_shell 手动执行。`
  );
}

// ── 读取拒绝检查 ───────────────────────────────────────────

/** 项目级敏感环境文件名（禁止读取，防止凭据泄露） */
const BLOCKED_PROJECT_ENV_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".env.staging",
  ".envrc",
  ".env.example", // 示例文件通常不含真实凭据，但也保守阻止
]);

/**
 * 检查路径是否被读取拒绝。
 * 移植自 Hermes get_read_block_error，聚焦于项目级 .env 文件。
 *
 * 注意：这不是安全边界（Agent 仍可通过 run_shell cat 绕过），
 * 但能阻止大多数误操作，并在日志中留下审计痕迹。
 *
 * @returns 错误信息字符串；null 表示允许读取
 */
export function getReadBlockError(inputPath: string): string | null {
  const resolved = resolvePath(inputPath);
  const basename = path.basename(resolved);

  // 项目级 .env 文件
  if (BLOCKED_PROJECT_ENV_BASENAMES.has(basename)) {
    return (
      `[拒绝] ${resolved} 是敏感环境文件，禁止直接读取，防止凭据泄露。\n` +
      `如果需要检查文件结构，请读取 .env.example（如果存在）。\n` +
      `这是防御性深度检查（不是安全边界，run_shell 仍可绕过）。`
    );
  }

  // SSH 私钥文件
  if (basename.startsWith("id_") || basename === "authorized_keys") {
    const dirname = path.basename(path.dirname(resolved));
    if (dirname === ".ssh") {
      return (
        `[拒绝] ${resolved} 是 SSH 密钥文件，禁止直接读取。\n` +
        `这是防御性深度检查（不是安全边界，run_shell 仍可绕过）。`
      );
    }
  }

  return null;
}

// ── 工具函数 ───────────────────────────────────────────────

/**
 * 检查路径是否在工作区内（用于判断是否是项目级文件）。
 * @param filePath 要检查的路径
 * @param workspaceRoot 工作区根目录
 * @returns true 表示在工作区内
 */
export function isPathInWorkspace(filePath: string, workspaceRoot: string): boolean {
  const resolvedFile = normalizeSeparators(resolvePath(filePath));
  const resolvedRoot = normalizeSeparators(resolvePath(workspaceRoot));
  return resolvedFile.startsWith(resolvedRoot + path.sep) || resolvedFile === resolvedRoot;
}
