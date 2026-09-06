// checkpoint-manager.ts —— 透明文件系统快照 + /rollback 回滚（移植 Hermes tools/checkpoint_manager.py）
//
// 语义与 Hermes CheckpointManager 对齐：
// - 在文件修改类工具（write_file / patch / edit_file / run_shell 等）执行前自动对
//   工作目录打快照，每个 conversation turn 每个目录最多一次（newTurn 重置去重）。
// - 这是透明基础设施，不是工具：LLM 永远看不到它；由 harness 每轮调用 newTurn()，
//   工具执行层在 dispatch 前调用 ensureCheckpoint()。
// - 存储布局（对齐 Hermes v2 单一共享 store）：
//
//     <userData>/checkpoints/
//         store/                       — 单一 bare git 仓库（跨项目共享对象库）
//             HEAD, config, objects/   — 标准 git 内部结构
//             refs/hermes/<hash16>     — 每项目分支 tip
//             indexes/<hash16>         — 每项目 git index（多项目并发互不干扰）
//             projects/<hash16>.json   — {workdir, created_at, last_touch}
//             info/exclude             — 默认排除规则（共享）
//
// - 用 GIT_DIR + GIT_WORK_TREE + GIT_INDEX_FILE + GIT_CONFIG_* 隔离 git 状态，
//   绝不把快照写进用户项目目录，也绝不继承用户全局 git 配置（gpgsign/凭据/钩子）。
// - 回滚（restore）前自动打一个 "pre-rollback" 快照，可以撤销撤销。
//
// 设计约束：
// - 纯模块 + git CLI 子进程，不依赖 Electron（userDataRoot 由调用方注入）；可单测
// - 所有 git 调用带超时、失败静默降级（返回 false / 错误对象），不影响 Agent 主链路
// - Windows 兼容：路径统一 realpathSync.native 展开长路径（避免 8.3 短路径问题）；
//   全局配置隔离用 NUL 设备（对应 POSIX /dev/null）

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

// ── 常量 ───────────────────────────────────────────────

/** 快照存储根（相对 userDataRoot）。 */
const CHECKPOINTS_DIR = "checkpoints";
/** 单一共享 shadow store 目录名。 */
const STORE_DIRNAME = "store";
/** store 内 refs 前缀。 */
const REFS_PREFIX = "refs/cyrene";
const INDEXES_DIRNAME = "indexes";
const PROJECTS_DIRNAME = "projects";

/** 快照时默认排除的文件/目录（对齐 Hermes DEFAULT_EXCLUDES）。 */
const DEFAULT_EXCLUDES = [
  // 依赖 / 构建产物
  "node_modules/",
  "dist/",
  "build/",
  "target/",
  "out/",
  ".next/",
  ".nuxt/",
  // 缓存
  "__pycache__/",
  "*.pyc",
  "*.pyo",
  ".cache/",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  "coverage/",
  ".coverage",
  // 虚拟环境
  ".venv/",
  "venv/",
  "env/",
  // VCS
  ".git/",
  ".hg/",
  ".svn/",
  // Worktree（Cyrene 约定 —— 不递归快照兄弟 worktree）
  ".worktrees/",
  // 原生 / 编译二进制
  "*.so",
  "*.dylib",
  "*.dll",
  "*.o",
  "*.a",
  "*.jar",
  "*.class",
  "*.exe",
  "*.obj",
  // 媒体 / 大二进制
  "*.mp4",
  "*.mov",
  "*.mkv",
  "*.webm",
  "*.zip",
  "*.tar",
  "*.tar.gz",
  "*.tgz",
  "*.7z",
  "*.rar",
  "*.iso",
  // 凭据
  ".env",
  ".env.*",
  ".env.local",
  ".env.*.local",
  // 系统垃圾
  ".DS_Store",
  "Thumbs.db",
  // 日志
  "*.log",
  // Cyrene 临时目录
  ".cyrene-temp/",
];

/** git 子进程超时（毫秒，默认 30s）。 */
const GIT_TIMEOUT_MS = 30_000;
/** 快照的最大文件数（超过则跳过，避免拖慢）。 */
const MAX_FILES = 50_000;
/** 合法 git commit hash 模式（4–64 位十六进制，防止 git 参数注入）。 */
const COMMIT_HASH_RE = /^[0-9a-fA-F]{4,64}$/;

/** 空设备路径：Windows 用 NUL，POSIX 用 /dev/null（对齐 Python os.devnull）。 */
const DEV_NULL = process.platform === "win32" ? "NUL" : "/dev/null";

/** 判定"项目根"的标记文件（getWorkingDirForPath 向上查找用）。 */
const PROJECT_MARKERS = [
  ".git",
  "pyproject.toml",
  "package.json",
  "Cargo.toml",
  "go.mod",
  "Makefile",
  "pom.xml",
  ".hg",
  "Gemfile",
];

// ── 类型 ───────────────────────────────────────────────

export interface CheckpointManagerOptions {
  /** 总开关（默认 true）。 */
  enabled?: boolean;
  /** 每目录最多保留的快照数（默认 20）。 */
  maxSnapshots?: number;
  /** store 总大小硬上限（MB，默认 500；0 = 不限制）。 */
  maxTotalSizeMb?: number;
  /** 单个文件超过此大小（MB）不纳入快照（默认 10；0 = 不限制）。 */
  maxFileSizeMb?: number;
  /** git 命令超时（毫秒，默认 30000）。 */
  gitTimeoutMs?: number;
}

/** 一个可用回滚点（最近在前）。 */
export interface CheckpointInfo {
  hash: string;
  shortHash: string;
  timestamp: string;
  reason: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface CheckpointDiffResult {
  success: boolean;
  stat?: string;
  diff?: string;
  error?: string;
}

export interface CheckpointRestoreResult {
  success: boolean;
  restoredTo?: string;
  reason?: string;
  directory?: string;
  file?: string;
  error?: string;
  /** 供排障的内部 git stderr（不展示给用户）。 */
  debug?: string;
}

interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// ── 路径 / 哈希辅助 ────────────────────────────────────

/** 返回规范化绝对路径：realpathSync.native 展开 Windows 8.3 短路径，失败回退 path.resolve。 */
function normalizePath(p: string): string {
  try {
    return fs.realpathSync.native(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

/** 确定性项目哈希：sha256(规范化绝对路径)[:16]。 */
function projectHash(workingDir: string): string {
  return createHash("sha256").update(normalizePath(workingDir)).digest("hex").slice(0, 16);
}

function storePath(userDataRoot: string): string {
  return path.join(userDataRoot, CHECKPOINTS_DIR, STORE_DIRNAME);
}

function indexPath(store: string, dirHash: string): string {
  return path.join(store, INDEXES_DIRNAME, dirHash);
}

function refName(dirHash: string): string {
  return `${REFS_PREFIX}/${dirHash}`;
}

function projectMetaPath(store: string, dirHash: string): string {
  return path.join(store, PROJECTS_DIRNAME, `${dirHash}.json`);
}

// ── 输入校验（防止 git 参数注入 / 目录穿越） ─────────────

/** 校验 commit hash：以 "-" 开头或非十六进制一律拒绝。 */
function validateCommitHash(commitHash: string): string | null {
  if (!commitHash || !commitHash.trim()) return "Empty commit hash";
  if (commitHash.startsWith("-")) {
    return `Invalid commit hash (must not start with '-'): ${commitHash!}`;
  }
  if (!COMMIT_HASH_RE.test(commitHash)) {
    return `Invalid commit hash (expected 4-64 hex characters): ${commitHash!}`;
  }
  return null;
}

/** 校验相对文件路径：拒绝绝对路径与逃出工作目录的穿越路径。 */
function validateFilePath(filePath: string, workingDir: string): string | null {
  if (!filePath || !filePath.trim()) return "Empty file path";
  if (path.isAbsolute(filePath)) {
    return `File path must be relative, got absolute path: ${filePath}`;
  }
  const absWorkdir = normalizePath(workingDir);
  const resolved = path.resolve(absWorkdir, filePath);
  const rel = path.relative(absWorkdir, resolved);
  if (path.isAbsolute(rel) || rel.startsWith("..")) {
    return `File path escapes the working directory via traversal: ${filePath}`;
  }
  return null;
}

// ── git 子进程（隔离 env） ─────────────────────────────

/**
 * 运行 git 命令，全部环境指向共享 store，绝不继承用户全局 git 配置。
 *
 * 隔离策略（对齐 Hermes _git_env）：
 * - GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE → 重定向到共享 store 与工作目录
 * - GIT_CONFIG_GLOBAL / GIT_CONFIG_SYSTEM → 空设备（忽略 ~/.gitconfig 与 /etc/gitconfig，
 *   防止用户 gpgsign/凭据钩子破坏后台快照或弹出交互窗口）
 * - GIT_CONFIG_NOSYSTEM=1 → 旧版 git 兜底
 */
async function runGit(
  args: string[],
  store: string,
  workingDir: string,
  opts: { timeoutMs?: number; allowedReturnCodes?: ReadonlySet<number>; indexFile?: string } = {},
): Promise<GitRunResult> {
  const normalized = normalizePath(workingDir);
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(normalized);
  } catch {
    /* 不存在 */
  }
  if (!stat || !stat.isDirectory()) {
    return { code: -1, stdout: "", stderr: `working directory not found: ${normalized}` };
  }

  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  env.GIT_DIR = store;
  env.GIT_WORK_TREE = normalized;
  delete env.GIT_NAMESPACE;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  if (opts.indexFile) {
    env.GIT_INDEX_FILE = opts.indexFile;
  } else {
    delete env.GIT_INDEX_FILE;
  }
  env.GIT_CONFIG_GLOBAL = DEV_NULL;
  env.GIT_CONFIG_SYSTEM = DEV_NULL;
  env.GIT_CONFIG_NOSYSTEM = "1";

  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: normalized,
      env,
      windowsHide: true,
      timeout: opts.timeoutMs ?? GIT_TIMEOUT_MS,
      encoding: "utf8",
    });
    return { code: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    if (typeof e.code === "number") {
      const code = e.code;
      // 已知的"预期非零退出"（如 diff --quiet 返回 1）不记错误日志
      if (!opts.allowedReturnCodes?.has(code)) {
        console.warn(`[Checkpoint] git 失败: git ${args.join(" ")} (rc=${code}) stderr=${(e.stderr ?? "").trim()}`);
      }
      return { code, stdout: (e.stdout ?? "").trim(), stderr: (e.stderr ?? "").trim() };
    }
    return { code: -1, stdout: "", stderr: e.message ?? String(err) };
  }
}

// ── store 初始化 ───────────────────────────────────────

/**
 * 初始化共享 shadow store（幂等）。返回错误信息或 null。
 * 注意：git init --bare 不接受 GIT_WORK_TREE，因此这里用裸环境直接子进程调用。
 */
async function initStore(store: string, workingDir: string): Promise<string | null> {
  const base = path.dirname(store);
  try {
    fs.mkdirSync(base, { recursive: true });
    if (!fs.existsSync(path.join(store, "HEAD"))) {
      fs.mkdirSync(store, { recursive: true });
      fs.mkdirSync(path.join(store, INDEXES_DIRNAME), { recursive: true });
      fs.mkdirSync(path.join(store, PROJECTS_DIRNAME), { recursive: true });

      const initEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
      delete initEnv.GIT_DIR;
      delete initEnv.GIT_WORK_TREE;
      delete initEnv.GIT_INDEX_FILE;
      delete initEnv.GIT_NAMESPACE;
      delete initEnv.GIT_ALTERNATE_OBJECT_DIRECTORIES;
      initEnv.GIT_CONFIG_GLOBAL = DEV_NULL;
      initEnv.GIT_CONFIG_SYSTEM = DEV_NULL;
      initEnv.GIT_CONFIG_NOSYSTEM = "1";
      try {
        await execFileAsync("git", ["init", "--bare", store], {
          cwd: base,
          env: initEnv,
          windowsHide: true,
          timeout: GIT_TIMEOUT_MS,
          encoding: "utf8",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Shadow store init failed: ${msg}`;
      }

      // store 级配置（env 已隔离，这里双保险）
      await runGit(["config", "user.email", "cyrene@local"], store, base);
      await runGit(["config", "user.name", "Cyrene Checkpoint"], store, base);
      await runGit(["config", "commit.gpgsign", "false"], store, base);
      await runGit(["config", "tag.gpgSign", "false"], store, base);
      await runGit(["config", "gc.auto", "0"], store, base);

      const infoDir = path.join(store, "info");
      fs.mkdirSync(infoDir, { recursive: true });
      fs.writeFileSync(path.join(infoDir, "exclude"), `${DEFAULT_EXCLUDES.join("\n")}\n`, "utf8");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Checkpoint store init failed: ${msg}`;
  }
  return null;
}

/** 注册 / 更新项目元数据（workdir + created_at + last_touch）。 */
function registerProject(store: string, workingDir: string): void {
  const dirHash = projectHash(workingDir);
  const metaPath = projectMetaPath(store, dirHash);
  const now = Date.now();
  let createdAt = now;
  if (fs.existsSync(metaPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { created_at?: number };
      if (typeof existing.created_at === "number") createdAt = existing.created_at;
    } catch {
      /* 忽略损坏元数据 */
    }
  }
  try {
    fs.mkdirSync(path.dirname(metaPath), { recursive: true });
    fs.writeFileSync(metaPath, JSON.stringify({ workdir: normalizePath(workingDir), created_at: createdAt, last_touch: now }), "utf8");
  } catch (err) {
    console.warn(`[Checkpoint] 写入项目元数据失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── 文件统计辅助 ───────────────────────────────────────

/** 快速文件计数（超过 MAX_FILES 提前返回，避免拖慢大目录）。 */
function dirFileCount(dir: string): number {
  let count = 0;
  try {
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          stack.push(path.join(current, entry.name));
        } else if (entry.isFile()) {
          count++;
          if (count > MAX_FILES) return count;
        }
      }
    }
  } catch {
    /* 忽略权限错误 */
  }
  return count;
}

/** 递归目录大小（字节，失败返回 0）。 */
function dirSizeBytes(dir: string): number {
  let total = 0;
  try {
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const p = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(p);
        } else if (entry.isFile()) {
          try {
            total += fs.statSync(p).size;
          } catch {
            /* 忽略 */
          }
        }
      }
    }
  } catch {
    /* 忽略 */
  }
  return total;
}

// ── CheckpointManager ──────────────────────────────────

/**
 * 管理自动文件系统快照。
 *
 * 生命周期约定：
 * - 每个 conversation turn 开始调用 newTurn()（harness round_start）
 * - 每个文件修改工具 dispatch 前调用 ensureCheckpoint(dir, reason)
 * - 每目录每 turn 至多一次快照（去重）
 *
 * 透明基础设施：LLM 看不到、不参与工具清单。失败一律静默降级。
 */
export class CheckpointManager {
  readonly userDataRoot: string;
  readonly enabled: boolean;
  readonly maxSnapshots: number;
  readonly maxTotalSizeMb: number;
  readonly maxFileSizeMb: number;
  readonly gitTimeoutMs: number;

  private checkpointedDirs = new Set<string>();
  private gitAvailable: boolean | null = null;

  constructor(userDataRoot: string, options: CheckpointManagerOptions = {}) {
    this.userDataRoot = userDataRoot;
    this.enabled = options.enabled !== false;
    this.maxSnapshots = Math.max(1, options.maxSnapshots ?? 20);
    this.maxTotalSizeMb = Math.max(0, options.maxTotalSizeMb ?? 500);
    this.maxFileSizeMb = Math.max(0, options.maxFileSizeMb ?? 10);
    this.gitTimeoutMs = Math.max(1000, options.gitTimeoutMs ?? GIT_TIMEOUT_MS);
  }

  private get store(): string {
    return storePath(this.userDataRoot);
  }

  // ── turn 生命周期 ──────────────────────────────────

  /** 重置每轮去重。每个 conversation turn（harness round）开始调用。 */
  newTurn(): void {
    this.checkpointedDirs.clear();
  }

  // ── 公开 API ────────────────────────────────────────

  /**
   * 如果启用且本轮未对该目录打过快照，则打一张快照。
   * 返回是否实际打了快照。绝不抛异常（所有错误静默降级为 false）。
   */
  async ensureCheckpoint(workingDir: string, reason = "auto"): Promise<boolean> {
    if (!this.enabled) return false;

    if (this.gitAvailable === null) {
      try {
        await execFileAsync("git", ["--version"], { windowsHide: true, timeout: 5000, encoding: "utf8" });
        this.gitAvailable = true;
      } catch {
        this.gitAvailable = false;
        console.warn("[Checkpoint] 快照已禁用：git 不可用");
      }
    }
    if (!this.gitAvailable) return false;

    const absDir = normalizePath(workingDir);
    // 跳过根目录 / 用户主目录等过宽目录
    const home = normalizePath(process.env.USERPROFILE ?? process.env.HOME ?? os_homedir());
    if (absDir === path.parse(absDir).root || absDir === home) {
      console.warn(`[Checkpoint] 跳过快照：目录过宽（${absDir}）`);
      return false;
    }
    if (this.checkpointedDirs.has(absDir)) return false;
    this.checkpointedDirs.add(absDir);

    try {
      return await this.take(absDir, reason);
    } catch (err) {
      console.warn(`[Checkpoint] 快照失败（非致命）: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** 列出某目录可用回滚点（最近在前）。 */
  async listCheckpoints(workingDir: string): Promise<CheckpointInfo[]> {
    const absDir = normalizePath(workingDir);
    const store = this.store;
    if (!fs.existsSync(path.join(store, "HEAD"))) return [];

    const ref = refName(projectHash(absDir));
    const ok = await runGit(
      ["log", ref, "--format=%H|%h|%aI|%s", "-n", String(this.maxSnapshots)],
      store,
      absDir,
      { allowedReturnCodes: new Set([128, 129]) },
    );
    if (ok.code !== 0 || !ok.stdout) return [];

    const results: CheckpointInfo[] = [];
    for (const line of ok.stdout.split(/\r?\n/)) {
      const parts = line.split("|", 4);
      if (parts.length !== 4) continue;
      const entry: CheckpointInfo = {
        hash: parts[0],
        shortHash: parts[1],
        timestamp: parts[2],
        reason: parts[3],
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      };
      const statResult = await runGit(
        ["diff", "--shortstat", `${parts[0]}~1`, parts[0]],
        store,
        absDir,
        { allowedReturnCodes: new Set([128, 129]) },
      );
      if (statResult.code === 0 && statResult.stdout) {
        parseShortstat(statResult.stdout, entry);
      }
      results.push(entry);
    }
    return results;
  }

  /** 展示某快照与当前工作树之间的差异（stat + diff）。 */
  async diff(workingDir: string, commitHash: string): Promise<CheckpointDiffResult> {
    const hashErr = validateCommitHash(commitHash);
    if (hashErr) return { success: false, error: hashErr };

    const absDir = normalizePath(workingDir);
    const store = this.store;
    if (!fs.existsSync(path.join(store, "HEAD"))) {
      return { success: false, error: "No checkpoints exist for this directory" };
    }

    const exists = await runGit(["cat-file", "-t", commitHash], store, absDir);
    if (exists.code !== 0) {
      return { success: false, error: `Checkpoint '${commitHash}' not found` };
    }

    const dirHash = projectHash(absDir);
    const indexFile = indexPath(store, dirHash);

    // 把当前工作树暂存进 per-project index 以便对比
    await runGit(["add", "-A"], store, absDir, { timeoutMs: this.gitTimeoutMs * 2, indexFile });
    const statResult = await runGit(["diff", "--stat", commitHash, "--cached"], store, absDir, { indexFile });
    const diffResult = await runGit(["diff", commitHash, "--cached", "--no-color"], store, absDir, { indexFile });

    // 恢复 index 到项目最后一次快照，避免 index 与 ref 漂移
    const ref = refName(dirHash);
    await runGit(["read-tree", ref], store, absDir, { indexFile, allowedReturnCodes: new Set([128]) });

    if (statResult.code !== 0 && diffResult.code !== 0) {
      return { success: false, error: "Could not generate diff" };
    }
    return {
      success: true,
      stat: statResult.code === 0 ? statResult.stdout : "",
      diff: diffResult.code === 0 ? diffResult.stdout : "",
    };
  }

  /**
   * 把工作树恢复到某快照状态。
   * 恢复前自动打一张 "pre-rollback" 快照（可撤销撤销）；可指定单个相对文件。
   */
  async restore(workingDir: string, commitHash: string, filePath?: string): Promise<CheckpointRestoreResult> {
    const hashErr = validateCommitHash(commitHash);
    if (hashErr) return { success: false, error: hashErr };

    const absDir = normalizePath(workingDir);
    if (filePath) {
      const pathErr = validateFilePath(filePath, absDir);
      if (pathErr) return { success: false, error: pathErr };
    }

    const store = this.store;
    if (!fs.existsSync(path.join(store, "HEAD"))) {
      return { success: false, error: "No checkpoints exist for this directory" };
    }

    const exists = await runGit(["cat-file", "-t", commitHash], store, absDir);
    if (exists.code !== 0) {
      return { success: false, error: `Checkpoint '${commitHash}' not found`, debug: exists.stderr || undefined };
    }

    // 撤销前的安全网：先打一张 pre-rollback 快照
    await this.take(absDir, `pre-rollback snapshot (restoring to ${commitHash.slice(0, 8)})`);

    const dirHash = projectHash(absDir);
    const indexFile = indexPath(store, dirHash);
    const restoreTarget = filePath ?? ".";

    const restoreResult = await runGit(
      ["checkout", commitHash, "--", restoreTarget],
      store,
      absDir,
      { timeoutMs: this.gitTimeoutMs * 2, indexFile },
    );
    if (restoreResult.code !== 0) {
      return { success: false, error: `Restore failed: ${restoreResult.stderr}`, debug: restoreResult.stderr || undefined };
    }

    const reasonResult = await runGit(["log", "--format=%s", "-1", commitHash], store, absDir);
    const reason = reasonResult.code === 0 && reasonResult.stdout ? reasonResult.stdout : "unknown";

    const result: CheckpointRestoreResult = {
      success: true,
      restoredTo: commitHash.slice(0, 8),
      reason,
      directory: absDir,
    };
    if (filePath) result.file = filePath;
    return result;
  }

  /** 从文件路径推导其所属工作目录（向上找项目标记文件，对齐 Hermes）。 */
  getWorkingDirForPath(filePath: string): string {
    const p = normalizePath(filePath);
    let candidate: string;
    try {
      candidate = fs.statSync(p).isDirectory() ? p : path.dirname(p);
    } catch {
      candidate = path.dirname(p);
    }

    let check = candidate;
    for (;;) {
      if (PROJECT_MARKERS.some((marker) => fs.existsSync(path.join(check, marker)))) {
        return check;
      }
      const parent = path.dirname(check);
      if (parent === check) break;
      check = parent;
    }
    return candidate;
  }

  // ── 内部实现 ────────────────────────────────────────

  /** 打一张快照。成功返回 true。 */
  private async take(workingDir: string, reason: string): Promise<boolean> {
    const store = this.store;

    const initErr = await initStore(store, workingDir);
    if (initErr) {
      console.warn(`[Checkpoint] store 初始化失败: ${initErr}`);
      return false;
    }
    registerProject(store, workingDir);

    // 大目录守卫：不尝试快照超大目录
    if (dirFileCount(workingDir) > MAX_FILES) {
      console.warn(`[Checkpoint] 跳过快照：${workingDir} 超过 ${MAX_FILES} 个文件`);
      return false;
    }

    const dirHash = projectHash(workingDir);
    const indexFile = indexPath(store, dirHash);
    const ref = refName(dirHash);

    // 有上次快照则把 index 复位到 ref tip，避免暂存区累积过期路径；
    // 首次快照则清空 index（git add -A 从干净树开始）
    const hasRef = await this.seedIndex(store, workingDir, ref, indexFile);

    // 暂存当前状态（info/exclude 自动过滤默认排除项）
    const addResult = await runGit(["add", "-A"], store, workingDir, { timeoutMs: this.gitTimeoutMs * 2, indexFile });
    if (addResult.code !== 0) {
      console.warn(`[Checkpoint] git add 失败: ${addResult.stderr}`);
      return false;
    }

    if (this.maxFileSizeMb > 0) {
      await this.dropOversizeFromIndex(store, workingDir, indexFile);
    }

    // 与 ref tip 对比：无变化则跳过（避免空快照）
    if (hasRef) {
      const diffQuiet = await runGit(
        ["diff-index", "--cached", "--quiet", ref],
        store,
        workingDir,
        { allowedReturnCodes: new Set([1]), indexFile },
      );
      if (diffQuiet.code === 0) {
        console.warn(`[Checkpoint] 跳过快照：${workingDir} 无变化`);
        return false;
      }
    } else {
      const ls = await runGit(["ls-files", "--cached"], store, workingDir, { indexFile });
      if (ls.code === 0 && !ls.stdout.trim()) {
        console.warn(`[Checkpoint] 跳过快照：${workingDir} 空树`);
        return false;
      }
    }

    // write-tree → commit-tree（parent = 上次 ref tip）
    const treeResult = await runGit(["write-tree"], store, workingDir, { indexFile });
    if (treeResult.code !== 0 || !treeResult.stdout) {
      console.warn(`[Checkpoint] write-tree 失败: ${treeResult.stderr}`);
      return false;
    }
    const treeSha = treeResult.stdout;

    const commitArgs = hasRef
      ? ["commit-tree", treeSha, "-p", ref, "-m", reason, "--no-gpg-sign"]
      : ["commit-tree", treeSha, "-m", reason, "--no-gpg-sign"];
    const commitResult = await runGit(commitArgs, store, workingDir, { indexFile });
    if (commitResult.code !== 0 || !commitResult.stdout) {
      console.warn(`[Checkpoint] commit-tree 失败: ${commitResult.stderr}`);
      return false;
    }
    const newSha = commitResult.stdout;

    const updateArgs = hasRef
      ? ["update-ref", ref, newSha, ref]
      : ["update-ref", ref, newSha];
    const updateResult = await runGit(updateArgs, store, workingDir);
    if (updateResult.code !== 0) {
      console.warn(`[Checkpoint] update-ref 失败: ${updateResult.stderr}`);
      return false;
    }

    console.warn(`[Checkpoint] 已打快照 ${workingDir}: ${reason}（${newSha.slice(0, 8)}）`);

    await this.prune(store, workingDir, ref);
    await this.enforceSizeCap(store);
    return true;
  }

  /**
   * 把 per-project index 复位到 ref tip（有则返回 true），
   * 首次快照时删除 index 让 add -A 从干净树开始（返回 false）。
   */
  private async seedIndex(store: string, workingDir: string, ref: string, indexFile: string): Promise<boolean> {
    if (fs.existsSync(indexFile)) {
      const verify = await runGit(["rev-parse", "--verify", `${ref}^{commit}`], store, workingDir, { allowedReturnCodes: new Set([128]) });
      if (verify.code === 0 && verify.stdout) {
        await runGit(["read-tree", verify.stdout], store, workingDir, { indexFile, allowedReturnCodes: new Set([128]) });
        return true;
      }
      try {
        fs.unlinkSync(indexFile);
      } catch {
        /* 忽略 */
      }
    } else {
      fs.mkdirSync(path.dirname(indexFile), { recursive: true });
    }
    return false;
  }

  /** 从暂存区移除超过 maxFileSizeMb 的文件（保留源码，拒绝吞下数据集/日志/视频）。 */
  private async dropOversizeFromIndex(store: string, workingDir: string, indexFile: string): Promise<void> {
    const cap = this.maxFileSizeMb * 1024 * 1024;
    if (cap <= 0) return;
    const ls = await runGit(["ls-files", "--cached", "-z"], store, workingDir, { indexFile });
    if (ls.code !== 0 || !ls.stdout) return;
    const paths = ls.stdout.split("\0").filter((p) => p.length > 0);
    const absWorkdir = normalizePath(workingDir);
    const oversize: string[] = [];
    for (const rel of paths) {
      try {
        const size = fs.statSync(path.join(absWorkdir, rel)).size;
        if (size > cap) oversize.push(rel);
      } catch {
        /* 忽略 */
      }
    }
    if (oversize.length === 0) return;
    console.warn(`[Checkpoint] 从快照剔除 ${oversize.length} 个超大文件（>${this.maxFileSizeMb}MB）`);
    const BATCH = 200;
    for (let i = 0; i < oversize.length; i += BATCH) {
      await runGit(["rm", "--cached", "--quiet", "--", ...oversize.slice(i, i + BATCH)], store, workingDir, {
        indexFile,
        allowedReturnCodes: new Set([128]),
      });
    }
  }

  /** 每目录最多保留 maxSnapshots 张快照：重写 ref 链并 gc 回收对象。 */
  private async prune(store: string, workingDir: string, ref: string): Promise<void> {
    const countResult = await runGit(["rev-list", "--count", ref], store, workingDir, { allowedReturnCodes: new Set([128]) });
    if (countResult.code !== 0) return;
    const count = parseInt(countResult.stdout, 10);
    if (!Number.isFinite(count) || count <= this.maxSnapshots) return;

    const listResult = await runGit(["rev-list", "--reverse", ref], store, workingDir);
    if (listResult.code !== 0 || !listResult.stdout) return;
    const commits = listResult.stdout.split(/\r?\n/);
    const keep = commits.slice(-this.maxSnapshots);

    // 按 keep 链重放 commit-tree，重建线性链
    let newParent: string | null = null;
    for (const sha of keep) {
      const treeResult = await runGit(["rev-parse", `${sha}^{tree}`], store, workingDir);
      if (treeResult.code !== 0 || !treeResult.stdout) return;
      const msgResult = await runGit(["log", "--format=%s", "-1", sha], store, workingDir);
      const commitMsg = msgResult.code === 0 && msgResult.stdout ? msgResult.stdout : "checkpoint";
      const args = newParent
        ? ["commit-tree", treeResult.stdout, "-p", newParent, "-m", commitMsg, "--no-gpg-sign"]
        : ["commit-tree", treeResult.stdout, "-m", commitMsg, "--no-gpg-sign"];
      const commitResult = await runGit(args, store, workingDir);
      if (commitResult.code !== 0 || !commitResult.stdout) return;
      newParent = commitResult.stdout;
    }
    if (!newParent) return;
    await runGit(["update-ref", ref, newParent], store, workingDir);
    await runGit(["reflog", "expire", "--expire=now", "--all"], store, workingDir);
    await runGit(["gc", "--prune=now", "--quiet"], store, workingDir, { timeoutMs: this.gitTimeoutMs * 3 });
  }

  /** store 总大小超限时，跨项目轮换丢弃最旧快照，直到低于上限。 */
  private async enforceSizeCap(store: string): Promise<void> {
    if (this.maxTotalSizeMb <= 0) return;
    const capBytes = this.maxTotalSizeMb * 1024 * 1024;
    if (dirSizeBytes(store) <= capBytes) return;

    const refsResult = await runGit(["for-each-ref", "--format=%(refname)", REFS_PREFIX], store, path.dirname(store), {
      allowedReturnCodes: new Set([128]),
    });
    if (refsResult.code !== 0 || !refsResult.stdout) return;
    const refs = refsResult.stdout.split(/\r?\n/).filter((r) => r.trim().length > 0);
    const storeParent = path.dirname(store);

    let anyDropped = false;
    // 硬上限 20 轮，避免病态循环
    for (let i = 0; i < 20; i++) {
      if (dirSizeBytes(store) <= capBytes) break;
      let droppedInPass = false;
      for (const ref of refs) {
        const countResult = await runGit(["rev-list", "--count", ref], store, storeParent, { allowedReturnCodes: new Set([128]) });
        let count = 0;
        try {
          count = parseInt(countResult.stdout, 10);
        } catch {
          count = 0;
        }
        if (!Number.isFinite(count) || count <= 1) continue; // 每项目至少保留一张
        const listResult = await runGit(["rev-list", "--reverse", ref], store, storeParent);
        if (listResult.code !== 0 || !listResult.stdout) continue;
        const commits = listResult.stdout.split(/\r?\n/);
        const keep = commits.slice(1); // 丢弃最旧
        let newParent: string | null = null;
        let fail = false;
        for (const sha of keep) {
          const treeResult = await runGit(["rev-parse", `${sha}^{tree}`], store, storeParent);
          if (treeResult.code !== 0 || !treeResult.stdout) {
            fail = true;
            break;
          }
          const msgResult = await runGit(["log", "--format=%s", "-1", sha], store, storeParent);
          const commitMsg = msgResult.code === 0 && msgResult.stdout ? msgResult.stdout : "checkpoint";
          const args = newParent
            ? ["commit-tree", treeResult.stdout, "-p", newParent, "-m", commitMsg, "--no-gpg-sign"]
            : ["commit-tree", treeResult.stdout, "-m", commitMsg, "--no-gpg-sign"];
          const commitResult = await runGit(args, store, storeParent);
          if (commitResult.code !== 0 || !commitResult.stdout) {
            fail = true;
            break;
          }
          newParent = commitResult.stdout;
        }
        if (fail || !newParent) continue;
        await runGit(["update-ref", ref, newParent], store, storeParent);
        anyDropped = true;
        droppedInPass = true;
      }
      if (!droppedInPass) break;
    }

    if (anyDropped) {
      await runGit(["reflog", "expire", "--expire=now", "--all"], store, storeParent);
      await runGit(["gc", "--prune=now", "--quiet"], store, storeParent, { timeoutMs: this.gitTimeoutMs * 3 });
    }
  }
}

// ── 工具函数 ──────────────────────────────────────────

/**
 * 判定工具是否会修改文件系统或执行命令（dispatch 前自动打快照的依据）。
 * 数据驱动而非硬编码工具名：registry 中所有 `fs-write` / `shell` 风险工具
 * （write_file / apply_patch / str_replace / ast_grep_replace / git_* 修改类 /
 * run_shell / execute_code / 文档写出等）都会触发快照，新工具注册后自动覆盖。
 */
export function isFileMutatingTool(risk: string | undefined): boolean {
  return risk === "fs-write" || risk === "shell";
}

/** 解析 git --shortstat 输出进 CheckpointInfo。 */
function parseShortstat(statLine: string, entry: CheckpointInfo): void {
  const filesMatch = /(\d+) file/.exec(statLine);
  if (filesMatch) entry.filesChanged = parseInt(filesMatch[1], 10);
  const insMatch = /(\d+) insertion/.exec(statLine);
  if (insMatch) entry.insertions = parseInt(insMatch[1], 10);
  const delMatch = /(\d+) deletion/.exec(statLine);
  if (delMatch) entry.deletions = parseInt(delMatch[1], 10);
}

/** 格式化快照列表用于用户展示（/rollback 交互）。 */
export function formatCheckpointList(checkpoints: CheckpointInfo[], directory: string): string {
  if (checkpoints.length === 0) {
    return `当前工作目录还没有可回滚的快照（${directory}）。\n提示：Agent 每次修改文件前会自动打快照，之后即可用 /rollback 回滚。`;
  }

  const lines: string[] = [`📸 ${directory} 的可回滚快照：\n`];
  checkpoints.forEach((cp, i) => {
    let ts = cp.timestamp;
    if (ts.includes("T")) {
      const [date] = ts.split("T");
      const time = ts.split("T")[1]?.split(/[+-]/)[0]?.slice(0, 5) ?? "";
      ts = `${date} ${time}`;
    }
    const statPart =
      cp.filesChanged > 0
        ? `  (${cp.filesChanged} 个文件, +${cp.insertions}/-${cp.deletions})`
        : "";
    lines.push(`  ${i + 1}. ${cp.shortHash}  ${ts}  ${cp.reason}${statPart}`);
  });
  lines.push("\n  /rollback <N>             恢复到第 N 个快照");
  lines.push("  /rollback diff <N>        预览自第 N 个快照以来的改动");
  lines.push("  /rollback <N> <file>      从第 N 个快照恢复单个文件");
  return lines.join("\n");
}

// ── 单例 ──────────────────────────────────────────────

/** 从快照列表中取第 n 张（1-based）或直接按 hash 取。 */
export function resolveCheckpointTarget(checkpoints: CheckpointInfo[], target: string): string | null {
  if (/^\d+$/.test(target)) {
    const idx = parseInt(target, 10);
    if (idx >= 1 && idx <= checkpoints.length) return checkpoints[idx - 1].hash;
    return null;
  }
  const matched = checkpoints.find((cp) => cp.shortHash.startsWith(target) || cp.hash.startsWith(target));
  return matched ? matched.hash : null;
}

/** 获取主进程单例（对齐 getRunReviewTracker 模式，按 userDataRoot 缓存）。 */
const managerCache = new Map<string, CheckpointManager>();

export function getCheckpointManager(userDataRoot: string, options?: CheckpointManagerOptions): CheckpointManager {
  const key = path.resolve(userDataRoot);
  let manager = managerCache.get(key);
  if (!manager) {
    manager = new CheckpointManager(key, options);
    managerCache.set(key, manager);
  }
  return manager;
}

// 小工具：兼容无 os 导入时取主目录
function os_homedir(): string {
  return process.env.HOME ?? "C:\\";
}
