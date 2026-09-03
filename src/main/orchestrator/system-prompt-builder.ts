import fs from "node:fs";
import { loadPromptFile } from "../prompts/prompt-loader";
import {
  STYLE_FILE_BY_ID,
  resolveStylePreference,
  type CustomStyleConfig,
  type StyleId,
} from "../../shared/style-sampling";
import { ensureCustomStylePrompt } from "../style-prompt";
import { getCapabilityOrOpenAI } from "./vendors/capabilities";
import { resolveApprovedStyleSampling } from "./vendors/style-sampling";
import type { ReasoningPreference } from "../../shared/reasoning";
import { buildToolCatalog } from "./tools/registry/tool-catalog";
import type { ToolDefinition } from "./tools/registry/tool-registry";
import type { ConversationMode } from "../../shared/chat-types";
import { buildModePrompt } from "./mode-prompt-profile";
import { listSkills } from "../self-evolving/skill-store";

export function readStylePrompt(styleId: StyleId): string {
  if (styleId === "custom") {
    const filePath = ensureCustomStylePrompt();
    return fs.readFileSync(filePath, "utf8").trim();
  }
  return loadPromptFile("styles/" + STYLE_FILE_BY_ID[styleId]);
}

export function resolveSoulSamplingForStyle(input: {
  styleId: StyleId;
  settings: { provider: string; model: string; reasoning?: ReasoningPreference };
  customStyle: CustomStyleConfig;
}) {
  const capability = getCapabilityOrOpenAI(input.settings.provider);
  const preference = resolveStylePreference(input.styleId, input.customStyle);
  return resolveApprovedStyleSampling({
    providerId: capability.id,
    model: input.settings.model,
    reasoning: input.settings.reasoning ?? { mode: "auto" },
    preference,
  });
}

/**
 * @deprecated 新运行链路必须使用 buildModePrompt(mode)。
 * 仅供尚未迁移的调用方兼容，绝不再根据 Work 默认拼接 Code 或 soul。
 */
export function buildSystemPrompt(styleFile: string, includeStyle = true): string {
  const mode: ConversationMode = styleFile.startsWith("chat") || styleFile.startsWith("talk")
    ? "chat"
    : styleFile.startsWith("learn")
      ? "learn"
      : "work";
  const parts = [buildModePrompt(mode)];

  // 风格采样提示词是历史调用方的可选附加项；生产运行链路在 build-options 单独注入。
  if (includeStyle && mode === "work") {
    const style = loadPromptFile("styles/" + styleFile);
    if (style) parts.push(style);
  }

  return parts.filter(Boolean).join("\n\n---\n\n");
}

/**
 * 工具规则与目录 system prompt（进入 harness stablePrefix）。
 * 仅含运行时生成的工具目录——
 * 不放任何人格 / 环境 / 记忆，避免人设污染工具决策。
 */
export function buildToolSystemPrompt(
  _mode: ConversationMode,
  enabledTools: ReadonlyArray<ToolDefinition>,
): string {
  const catalog = buildToolCatalog(enabledTools as ToolDefinition[]);
  const parts = [
    "## 当前可用工具",
    catalog,
  ];

  // 始终注入技能系统引导（程序性记忆），让 Agent 知道有自进化能力
  try {
    const skills = listSkills();
    const skillSectionLines = [
      "## 技能系统（程序性记忆 · 自进化）",
      "",
      "技能是你从成功经验中沉淀的可复用流程。每次完成复杂任务后，主动评估是否值得沉淀为技能。",
      "",
      "**工作流：**",
      "1. 开始任务前 → 用 `skill_list` 查看是否有相关技能可复用",
      "2. 有相关技能 → 用 `skill_view` 读取具体步骤，按验证过的流程执行",
      "3. 完成任务后 → 如果流程可复用，用 `skill_manage create` 沉淀为新技能",
      "4. 使用技能时发现问题 → 用 `skill_manage edit` 修补优化",
      "",
      "**必须创建技能的场景：**",
      "- 完成了 5+ 次工具调用的复杂任务，流程可复用",
      "- 克服了报错/陷阱，找到了正确方法",
      "- 用户纠正了你的做法，新方法有效",
      "- 发现了非平凡的工作流或配置技巧",
      "- 用户明确要求\"记住这个流程\"",
      "",
      "**好技能的标准：** 明确触发条件 + 带精确命令的编号步骤 + 常见陷阱 + 验证方法。",
    ];
    if (skills.length > 0) {
      skillSectionLines.push("");
      skillSectionLines.push(`**当前已保存 ${skills.length} 个技能：**`);
      for (const s of skills) {
        const creator = s.createdBy === "agent" ? " [自进化]" : "";
        skillSectionLines.push(`- **${s.name}**${creator}: ${s.description}`);
      }
    } else {
      skillSectionLines.push("");
      skillSectionLines.push("（暂无已保存技能——完成第一个复杂任务后主动创建吧）");
    }
    parts.push(skillSectionLines.join("\n"));
  } catch {
    // 技能系统初始化失败不影响工具目录
  }

  return parts.filter(Boolean).join("\n\n");
}

/**
 * 人设基础 system prompt（进入 stablePrefix）。
 * 仅包含按模式选取的人设基础；环境/记忆/关系/附件等动态内容走
 * soulRuntimeContext，随请求尾部注入。
 * 注意：工具结果（`role: "tool"` 消息）在单循环 transcript 中已携带，本函数不重复注入。
 */
export function buildSoulSystemBasePrompt(styleFile: string): string {
  return buildSystemPrompt(styleFile, false);
}

export function loadSoulFeelingContext(): string {
  return loadPromptFile("soul.md");
}
