/**
 * 自动技能沉淀（对齐 Hermes CL loop 的「从经验创建技能」）
 *
 * 在 Agent Run 结束后异步判定：这次成功完成的任务是否值得沉淀为可复用技能。
 * 判定链：确定性门槛（成功 + 5+ 次工具调用）→ 辅助 LLM 判定并生成 SKILL.md
 * → 安全扫描 → 写入技能库（skill-store.createSkill）。
 *
 * 与 llm-reviewer 相同模式：LLM 调用抽象为 LLMCallFn，不依赖具体模型客户端；
 * 由调用方（bootstrap/组合根）通过 harness-adapter 注入回调后启用，默认关闭。
 */

import { createSkill, skillExists } from "./skill-store";
import { scanSkillContent } from "./security-scan";
import type { ReviewFileChange, ReviewRunStatus } from "../../shared/review-types";

/** 一次 Run 结束后的轨迹摘要，供沉淀判定使用。 */
export interface SkillCreationInput {
  runId: string;
  /** Run 终止状态 */
  status: ReviewRunStatus;
  /** 模型调用轮数 */
  rounds: number;
  /** 工具调用记录（名称 + 状态） */
  toolCalls: ReadonlyArray<{ toolName: string; status: string }>;
  /** 最终回复（可为空） */
  finalAnswer?: string;
  /** 文件级变更列表 */
  files: ReadonlyArray<ReviewFileChange>;
  /** 对话模式（仅 work/code 触发沉淀） */
  conversationMode?: string;
}

export type LLMCallFn = (prompt: string, systemPrompt?: string) => Promise<string>;

export type SkillCreationSkipReason =
  | "not-completed" // 任务未成功完成
  | "below-threshold" // 工具调用次数不足
  | "chat-mode" // 陪伴模式不沉淀
  | "name-exists" // 同名技能已存在
  | "parse-failed" // LLM 输出无法解析
  | "security-blocked" // 安全扫描拦截
  | "llm-failed"; // LLM 调用失败

export interface SkillCreationOutcome {
  status: "created" | "skipped";
  skipReason?: SkillCreationSkipReason;
  skillName?: string;
  detail?: string;
}

/** 确定性门槛：成功且工具调用 ≥ 5 次的 Run 才进入 LLM 判定（与 Hermes 引导标准一致）。 */
export const MIN_TOOL_CALLS_FOR_CREATION = 5;

/** 参与工具调用次数统计时忽略的交互/只读工具。 */
const NON_TASK_TOOLS = new Set(["ask_user", "skill_list", "skill_view"]);

function countTaskToolCalls(toolCalls: SkillCreationInput["toolCalls"]): number {
  // committed 表示工具调用已成功落定（见 run-store PersistedToolCallStatus）
  return toolCalls.filter((call) => !NON_TASK_TOOLS.has(call.toolName) && call.status === "committed").length;
}

function buildTrajectorySummary(input: SkillCreationInput): string {
  const tools = input.toolCalls
    .slice(0, 40)
    .map((call, i) => `${i + 1}. ${call.toolName} (${call.status})`)
    .join("\n");
  const files = input.files
    .slice(0, 20)
    .map((f) => `- ${f.kind}: ${f.newPath} (+${f.additions}/-${f.deletions})`)
    .join("\n");
  return [
    `## 任务轨迹`,
    `- 终止状态：${input.status}`,
    `- 模型调用轮数：${input.rounds}`,
    `- 工具调用（前 40 条）：`,
    tools || "  （无）",
    ``,
    `## 文件变更（前 20 条）`,
    files || "  （无）",
    ``,
    `## 最终回复`,
    input.finalAnswer ? input.finalAnswer.slice(0, 1500) : "  （无）",
  ].join("\n");
}

const CREATION_SYSTEM_PROMPT = [
  "你是技能提炼专家。根据给定的 Agent 任务轨迹，判断这次任务是否值得沉淀为可复用技能。",
  "技能 = 可复用的操作流程（触发条件 + 步骤 + 陷阱 + 验证方法），不是一次性任务描述。",
  "",
  "值得创建技能的场景：",
  "- 多步骤、非平凡的工作流（构建/部署/数据处理/迁移等）",
  "- 克服了报错并找到正确方法",
  "- 用户纠正后新方法有效",
  "- 流程明确、可复现",
  "",
  "不值得创建技能的场景：",
  "- 一次性问答、闲聊、简单单步操作",
  "- 结果高度依赖上下文（如某个具体文件的某个具体 bug）",
  "- 工具调用次数少、无固定流程",
  "",
  "输出要求：只返回一个 JSON 对象，不要任何额外文字：",
  '{"shouldCreate": true, "name": "技能名(kebab-case)", "description": "一句话描述", "content": "完整 SKILL.md 内容（含 YAML frontmatter，name 和 description 必填）"}',
  '若不应创建：{"shouldCreate": false, "reason": "简短原因"}',
].join("\n");

function parseCreationResponse(raw: string): { shouldCreate: boolean; name?: string; description?: string; content?: string; reason?: string } {
  const text = raw.trim();
  // 优先取 ```json 代码块，其次尝试整体 JSON
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text;
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    if (typeof parsed.shouldCreate !== "boolean") throw new Error("missing shouldCreate");
    if (!parsed.shouldCreate) {
      return { shouldCreate: false, reason: typeof parsed.reason === "string" ? parsed.reason : "模型判定不值得创建" };
    }
    if (typeof parsed.name !== "string" || typeof parsed.description !== "string" || typeof parsed.content !== "string") {
      throw new Error("missing name/description/content");
    }
    return { shouldCreate: true, name: parsed.name, description: parsed.description, content: parsed.content };
  } catch {
    // 容错：模型可能直接返回 SKILL.md 文本
    if (/^---\s*$/.test(text) && /name:/.test(text)) {
      return { shouldCreate: true, name: "auto", description: "自动沉淀技能", content: text };
    }
    throw new Error("无法解析模型输出");
  }
}

/**
 * 执行一次技能沉淀判定与创建。
 *
 * @param input Run 轨迹摘要
 * @param llmCall LLM 调用函数
 * @returns 沉淀结果
 */
export async function runSkillCreation(
  input: SkillCreationInput,
  llmCall: LLMCallFn,
): Promise<SkillCreationOutcome> {
  // 1) 确定性门槛
  if (input.conversationMode && input.conversationMode !== "work" && input.conversationMode !== "code") {
    return { status: "skipped", skipReason: "chat-mode", detail: "仅 Work/Code 模式沉淀技能" };
  }
  if (input.status !== "completed") {
    return { status: "skipped", skipReason: "not-completed", detail: `Run 状态为 ${input.status}` };
  }
  const taskToolCount = countTaskToolCalls(input.toolCalls);
  if (taskToolCount < MIN_TOOL_CALLS_FOR_CREATION) {
    return { status: "skipped", skipReason: "below-threshold", detail: `有效工具调用 ${taskToolCount} 次 < ${MIN_TOOL_CALLS_FOR_CREATION}` };
  }

  // 2) LLM 判定与内容生成
  let parsed: ReturnType<typeof parseCreationResponse>;
  try {
    const raw = await llmCall(buildTrajectorySummary(input), CREATION_SYSTEM_PROMPT);
    parsed = parseCreationResponse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "skipped", skipReason: "llm-failed", detail: msg };
  }

  if (!parsed.shouldCreate) {
    return { status: "skipped", skipReason: "parse-failed", detail: parsed.reason ?? "模型判定不值得创建" };
  }
  const name = parsed.name!;
  const content = parsed.content!;

  // 3) 幂等检查
  if (skillExists(name)) {
    return { status: "skipped", skipReason: "name-exists", skillName: name, detail: "同名技能已存在" };
  }

  // 4) 安全扫描
  const scan = scanSkillContent(content);
  if (!scan.allowed) {
    return { status: "skipped", skipReason: "security-blocked", skillName: name, detail: scan.reason };
  }

  // 5) 写入技能库
  const result = createSkill(name, content);
  if (!result.success) {
    return { status: "skipped", skipReason: "parse-failed", skillName: name, detail: result.error ?? result.message };
  }
  return { status: "created", skillName: name, detail: `已沉淀技能 ${name}` };
}
