// skill-recommend-tool —— 技能推荐工具 + 安装确认提示接线。
//
// 链路：模型调用 recommend_skill → SkillService.recommendSkills 返回推荐 →
// 若存在达到阈值的未安装技能，主进程向聊天窗口发送 SKILL_INSTALL_PROMPT →
// 渲染进程弹出确认框 → 用户允许则调用 installSkill 安装。
//
// 服务实例在 bootstrap（registerCoreIpc）中注入：setSkillRecommendService +
// setSkillPromptWindowGetter。工具注册只定义 spec，执行时惰性读取，不依赖注入顺序。

import type { BrowserWindow } from "electron";
import type { ToolDefinition } from "../orchestrator/tools/registry/tool-registry";
import { SkillService } from "./skill-service";
import { sendSkillInstallPrompt } from "./skill-service-ipc";

// ── 可注入依赖（bootstrap 阶段注入） ─────────────────────────

let skillService: SkillService | null = null;
let promptWindowGetter: (() => BrowserWindow | null) | null = null;

/** 注入技能服务实例（bootstrap 中与 skill-service IPC 共用同一个实例）。 */
export function setSkillRecommendService(service: SkillService | null): void {
  skillService = service;
}

/** 注入聊天窗口 getter（用于发送安装确认提示）。 */
export function setSkillPromptWindowGetter(getter: (() => BrowserWindow | null) | null): void {
  promptWindowGetter = getter;
}

/** 达到此分数才自动弹安装确认框，避免低相关推荐打扰用户。 */
const MIN_INSTALL_PROMPT_SCORE = 50;

/** 会话内已弹过提示的技能 id（同一技能不重复弹，避免模型反复调用时刷屏）。 */
const promptedSkillIds = new Set<string>();

// ── 工具实现 ────────────────────────────────────────────────

async function executeRecommendSkill(args: Record<string, unknown>): Promise<string> {
  const service = skillService;
  if (!service) {
    return JSON.stringify({ success: false, error: "技能服务尚未初始化，请稍后再试" });
  }

  const userInput = String(args.query ?? "").trim();
  if (!userInput) {
    return JSON.stringify({ success: false, error: "query 参数必填，描述当前任务或用户需求" });
  }

  const limit = typeof args.limit === "number" ? Math.max(1, Math.min(20, Math.floor(args.limit))) : 5;
  const mode = typeof args.mode === "string" && args.mode ? (args.mode as "work" | "code" | "learn") : undefined;

  const recommendations = service.recommendSkills(userInput, {
    limit,
    mode,
    includeNotInstalled: true,
  });

  // 未安装且达到阈值的技能 → 触发安装确认提示（每技能每会话一次）
  const topUninstalled = recommendations.find((r) => !r.installed && r.score >= MIN_INSTALL_PROMPT_SCORE);
  if (topUninstalled && !promptedSkillIds.has(topUninstalled.skillId) && promptWindowGetter) {
    promptedSkillIds.add(topUninstalled.skillId);
    sendSkillInstallPrompt(promptWindowGetter(), {
      skillId: topUninstalled.skillId,
      skillName: topUninstalled.name,
      description: topUninstalled.description,
      category: topUninstalled.category,
      reason: topUninstalled.reason,
    });
  }

  return JSON.stringify({
    success: true,
    count: recommendations.length,
    recommendations: recommendations.map((r) => ({
      skillId: r.skillId,
      name: r.name,
      description: r.description,
      category: r.category,
      installed: r.installed,
      score: r.score,
      reason: r.reason,
    })),
  });
}

export const recommendSkillTool: ToolDefinition = {
  id: "recommend_skill",
  name: "推荐技能",
  description:
    "根据当前任务/用户需求推荐适合的技能（含未安装的技能）。\n\n" +
    "何时用：\n" +
    "- 任务开始前，判断是否有适合当前任务的技能可以直接复用\n" +
    "- 用户问'有没有适合 xxx 的技能'或'推荐个技能'\n" +
    "- 发现任务缺少对应能力，需要查目录里是否有可安装的技能\n\n" +
    "参数：query（必填，任务/需求描述），limit（可选，返回数量，默认 5），" +
    "mode（可选，会话模式：work/code/learn）。\n\n" +
    "注意：若推荐结果中包含未安装且匹配度高的技能，会自动向用户弹出安装确认框，无需重复推荐。",
  enabled: true,
  risk: "safe",
  effectKind: "read",
  verificationPolicy: "none",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "任务或用户需求的描述" },
      limit: { type: "number", description: "返回的推荐数量（1-20，默认 5）" },
      mode: { type: "string", enum: ["work", "code", "learn"], description: "会话模式（可选）" },
    },
    required: ["query"],
  },
  execute: executeRecommendSkill,
};
