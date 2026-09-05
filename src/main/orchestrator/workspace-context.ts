import fs from "node:fs";
import path from "node:path";

/**
 * AGENTS.md 工作区上下文加载器（Hermes context files 的等价物）。
 *
 * Code / 绑定工作目录的 Work 模式启动 run 时读取工作区根目录的 AGENTS.md，
 * 一次性物化为启动 transcript 的一部分，让模型每轮都能看到项目级约定
 * （构建/测试命令、架构、约束）。无 AGENTS.md 或不可读时静默返回 undefined，
 * 保证零侵入。
 */

export const WORKSPACE_CONTEXT_FILE = "AGENTS.md";
/** 超长上限（字符）；超过则截断并标注，避免项目文件把上下文窗口占满。 */
export const MAX_WORKSPACE_CONTEXT_CHARS = 16_384;

const WORKSPACE_CONTEXT_TRUNCATION_MARK =
  "\n\n[... 工作区上下文超长，已截断；请让 AGENTS.md 只保留对 Agent 行为有实质影响的约定 ...]";

export function loadWorkspaceContext(workspaceRoot?: string): string | undefined {
  if (!workspaceRoot) return undefined;
  let content: string;
  try {
    content = fs.readFileSync(path.join(workspaceRoot, WORKSPACE_CONTEXT_FILE), "utf8");
  } catch {
    // 文件不存在 / 不可读 → 跳过，与现状完全一致
    return undefined;
  }
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  const bounded = trimmed.length > MAX_WORKSPACE_CONTEXT_CHARS
    ? `${trimmed.slice(0, MAX_WORKSPACE_CONTEXT_CHARS)}${WORKSPACE_CONTEXT_TRUNCATION_MARK}`
    : trimmed;
  return `[WORKSPACE_CONTEXT]\n${bounded}`;
}
