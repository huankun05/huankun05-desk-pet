// worktree.ts —— Git Worktree 隔离（移植 Hermes cli.py 的 _setup_worktree / _worktree_has_unpushed_commits / _cleanup_worktree）
//
// 用途：让 Agent 在隔离的 git worktree 中读写文件，避免直接污染主工作区。
// 语义与 Hermes `hermes -w` 对齐：
// - 在 repoRoot 下创建 .worktrees/cyrene-<8hex>，分支名 cyrene/<name>，从 HEAD 检出
// - 确保 .worktrees/ 已写入 .gitignore
// - 处理 .worktreeinclude（把 gitignore 但 Agent 需要的文件复制进 worktree，
//   目录优先 symlink，Windows 无权限时回退 copytree；拒绝目录穿越与逃逸）
// - 清理：无未推送提交（相对 refs/remotes/*）时删除 worktree 与分支；
//   有未推送提交则保留并提示手动清理
//
// 设计约束：
// - 纯模块 + git CLI 子进程，不依赖 Electron；可单测
// - 所有 git 调用带超时（worktree add 30s / 查询 10s），失败可恢复（返回 null / false）
// - Windows 兼容：symlink 失败回退 copytree（与 Hermes 相同）

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

/** worktree 目录名（仓库根下的相对目录）。 */
export const WORKTREES_DIR = ".worktrees";

/** .worktreeinclude 文件名（仓库根下；列出需要复制进 worktree 的 gitignore 文件）。 */
export const WORKTREE_INCLUDE_FILE = ".worktreeinclude";

/** git worktree add 超时（毫秒）。 */
const WORKTREE_ADD_TIMEOUT_MS = 30_000;
/** 查询类 git 命令超时（毫秒）。 */
const WORKTREE_QUERY_TIMEOUT_MS = 10_000;

/** 一次成功创建后的 worktree 元数据。 */
export interface WorktreeInfo {
  /** worktree 绝对路径。 */
  path: string;
  /** 分支名（cyrene/<name>）。 */
  branch: string;
  /** 仓库根绝对路径。 */
  repoRoot: string;
}

/** cleanupWorktree 的结果。 */
export type WorktreeCleanupOutcome =
  | { kind: "removed"; path: string }
  | { kind: "kept"; path: string; reason: "unpushed-commits" }
  | { kind: "not-found"; path: string };

// ── 子进程辅助 ──────────────────────────────────────────

interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * 运行 git 命令。命令或解析失败时返回 { code: -1, stdout: "", stderr: message }，
 * 不抛异常——调用方按 returncode 判断即可，保持与 Hermes 相同的容错语义。
 */
async function runGit(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<GitRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      timeout: timeoutMs,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    // execFile 的错误对象带 code/stdout/stderr 属性（Node 的 ExecFileException）
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    if (typeof e.code === "number") {
      return { code: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
    // 超时 / ENOENT 等：无法拿到退出码，按失败处理并携带原因
    return { code: -1, stdout: "", stderr: e.message ?? String(err) };
  }
}

// ── 路径安全辅助（移植 Hermes _path_is_within_root 语义） ──

/**
 * candidate 是否位于 root 之内。
 * 注意：Node 的 path.relative 对越界路径不会抛错，而是返回 ".." 前缀；
 * 跨盘符时返回绝对路径。因此必须显式检查这两类情况，否则 ../ 逃逸会被放行。
 */
function isWithinRoot(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  if (rel === "") return true; // 完全相同
  if (path.isAbsolute(rel)) return false; // 跨盘符（Windows）
  return !rel.startsWith("..");
}

// ── 仓库检测 ───────────────────────────────────────────

/**
 * 检测 cwd 是否位于 git 仓库内；是则返回仓库根（toplevel），否则 null。
 */
export async function detectGitRepoRoot(cwd: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--show-toplevel"], cwd, WORKTREE_QUERY_TIMEOUT_MS);
  if (result.code !== 0) return null;
  const root = result.stdout.trim();
  if (!root) return null;
  const resolved = path.resolve(root);
  // Windows：git 可能返回 8.3 短路径（如 C:\Users\SHANGM~1\...）。
  // realpath.native 展开为长路径，避免后续 path.relative 因短/长路径混用误判目录逃逸。
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

// ── worktree 创建 ──────────────────────────────────────

/** 把 .worktrees/ 追加进仓库 .gitignore（幂等）。失败静默（不影响主流程）。 */
function ensureWorktreesGitignored(repoRoot: string): void {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  const entry = `${WORKTREES_DIR}/`;
  try {
    const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
    if (existing.split(/\r?\n/).includes(entry)) return;
    const next = existing && !existing.endsWith("\n") ? `${existing}\n` : existing;
    fs.appendFileSync(gitignorePath, `${next}${entry}\n`, "utf8");
  } catch (err) {
    console.warn(`[Worktree] 无法更新 .gitignore: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 处理 .worktreeinclude：把 gitignore 但 Agent 需要的文件复制进 worktree。
 * 目录优先 symlink（省磁盘）；Windows 无权限时回退递归复制。
 * 目录穿越 / 逃逸路径一律拒绝（移植 Hermes worktree_security 语义）。
 */
function copyIncludeEntries(repoRoot: string, worktreePath: string): void {
  const includeFile = path.join(repoRoot, WORKTREE_INCLUDE_FILE);
  if (!fs.existsSync(includeFile)) return;

  const repoRootResolved = path.resolve(repoRoot);
  const wtResolved = path.resolve(worktreePath);
  let lines: string[];
  try {
    lines = fs.readFileSync(includeFile, "utf8").split(/\r?\n/);
  } catch (err) {
    console.warn(`[Worktree] 读取 ${WORKTREE_INCLUDE_FILE} 失败: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  for (const raw of lines) {
    const entry = raw.trim();
    if (!entry || entry.startsWith("#")) continue;
    const src = path.join(repoRoot, entry);
    const dst = path.join(worktreePath, entry);
    let srcResolved: string;
    let dstResolved: string;
    try {
      srcResolved = path.resolve(src);
      dstResolved = path.resolve(dst);
    } catch {
      console.warn(`[Worktree] 跳过无效 ${WORKTREE_INCLUDE_FILE} 条目: ${entry}`);
      continue;
    }
    if (!isWithinRoot(srcResolved, repoRootResolved)) {
      console.warn(`[Worktree] 跳过 ${WORKTREE_INCLUDE_FILE} 中逃出仓库根的条目: ${entry}`);
      continue;
    }
    if (!isWithinRoot(dstResolved, wtResolved)) {
      console.warn(`[Worktree] 跳过 ${WORKTREE_INCLUDE_FILE} 中逃出 worktree 的条目: ${entry}`);
      continue;
    }
    try {
      if (fs.statSync(src).isFile()) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      } else if (fs.statSync(src).isDirectory()) {
        if (fs.existsSync(dst)) continue;
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        try {
          fs.symlinkSync(srcResolved, dst, "junction");
        } catch (symErr) {
          if (process.platform === "win32") {
            console.info(`[Worktree] symlink 失败（${symErr instanceof Error ? symErr.message : String(symErr)}），Windows 回退 copytree`);
            try {
              fs.cpSync(srcResolved, dst, { recursive: true, dereference: true });
            } catch (copyErr) {
              console.warn(`[Worktree] copytree 回退失败 ${entry}: ${copyErr instanceof Error ? copyErr.message : String(copyErr)}`);
            }
          } else {
            throw symErr;
          }
        }
      }
    } catch (err) {
      console.warn(`[Worktree] 处理 ${WORKTREE_INCLUDE_FILE} 条目 ${entry} 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * 创建隔离 worktree。成功返回元数据；任何失败返回 null（调用方自行降级为不用隔离）。
 */
export async function setupWorktree(repoRoot: string): Promise<WorktreeInfo | null> {
  let resolvedRoot: string;
  try {
    resolvedRoot = fs.realpathSync.native(path.resolve(repoRoot));
  } catch {
    resolvedRoot = path.resolve(repoRoot);
  }
  const shortId = randomBytes(4).toString("hex");
  const wtName = `cyrene-${shortId}`;
  const branchName = `cyrene/${wtName}`;

  let worktreesDir: string;
  try {
    worktreesDir = path.join(resolvedRoot, WORKTREES_DIR);
    fs.mkdirSync(worktreesDir, { recursive: true });
  } catch (err) {
    console.warn(`[Worktree] 创建 ${WORKTREES_DIR} 失败: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  ensureWorktreesGitignored(resolvedRoot);

  const wtPath = path.join(worktreesDir, wtName);
  const result = await runGit(
    ["worktree", "add", wtPath, "-b", branchName, "HEAD"],
    resolvedRoot,
    WORKTREE_ADD_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    console.warn(`[Worktree] 创建失败: ${result.stderr.trim() || "git worktree add 失败"}`);
    return null;
  }

  copyIncludeEntries(resolvedRoot, wtPath);

  console.log(`[Worktree] 已创建隔离工作区: ${wtPath}（分支 ${branchName}）`);
  return { path: wtPath, branch: branchName, repoRoot: resolvedRoot };
}

// ── worktree 清理 ──────────────────────────────────────

/**
 * worktree 是否有未推送提交（相对 refs/remotes/*）。
 * 与 Hermes 一致：无 remote-tracking refs 时视为"无未推送提交"（没有可比对的远端基线）。
 */
export async function worktreeHasUnpushedCommits(worktreePath: string): Promise<boolean> {
  const remoteRefs = await runGit(
    ["for-each-ref", "--format=%(refname)", "refs/remotes"],
    worktreePath,
    WORKTREE_QUERY_TIMEOUT_MS,
  );
  if (remoteRefs.code !== 0) return true;
  if (!remoteRefs.stdout.trim()) return false;

  const log = await runGit(
    ["log", "--oneline", "HEAD", "--not", "--remotes"],
    worktreePath,
    WORKTREE_QUERY_TIMEOUT_MS,
  );
  if (log.code !== 0) return true;
  return Boolean(log.stdout.trim());
}

/**
 * 清理 worktree 与分支。有未推送提交时保留（真实工作成果不应被静默删除）。
 * 未提交改动（untracked/测试产物）不足以保留——Agent 的成果活在提交里，不在工作树。
 */
export async function cleanupWorktree(info: WorktreeInfo): Promise<WorktreeCleanupOutcome> {
  const { path: wtPath, branch, repoRoot } = info;
  if (!fs.existsSync(wtPath)) {
    return { kind: "not-found", path: wtPath };
  }

  const hasUnpushed = await worktreeHasUnpushedCommits(wtPath);
  if (hasUnpushed) {
    console.warn(`[Worktree] ${wtPath} 存在未推送提交，保留该 worktree（手动清理: git worktree remove --force ${wtPath}）`);
    return { kind: "kept", path: wtPath, reason: "unpushed-commits" };
  }

  await runGit(["worktree", "remove", wtPath, "--force"], repoRoot, 15_000);
  await runGit(["branch", "-D", branch], repoRoot, WORKTREE_QUERY_TIMEOUT_MS);
  console.log(`[Worktree] 已清理隔离工作区: ${wtPath}`);
  return { kind: "removed", path: wtPath };
}
