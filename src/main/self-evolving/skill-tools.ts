// skill-tools —— 自进化技能系统的工具实现。
// 提供 skill_list（列出技能）、skill_view（查看技能）、skill_manage（创建/编辑/删除技能）三个工具。
// 参考 Hermes Agent 的 skill_manage 工具设计，移植到 Cyrene。

import type { ToolDefinition } from "../orchestrator/tools/registry/tool-registry";
import { logger, LogTag } from "../logger";
import {
  listSkills,
  getSkill,
  createSkill,
  editSkill,
  deleteSkill,
  recordSkillViewed,
  recordSkillUsed,
} from "./skill-store";

// ── skill_list：列出所有技能 ────────────────────────────────

async function executeSkillList(): Promise<string> {
  const skills = listSkills();
  if (skills.length === 0) {
    return JSON.stringify({
      success: true,
      count: 0,
      skills: [],
      message: "暂无已保存的技能。完成复杂任务后，可以用 skill_manage 创建可复用技能。",
    });
  }
  return JSON.stringify({
    success: true,
    count: skills.length,
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      category: s.category,
      createdBy: s.createdBy,
    })),
  });
}

export const skillListTool: ToolDefinition = {
  id: "skill_list",
  name: "列出技能",
  description:
    "列出所有已保存的可复用技能（程序性记忆）。每个技能包含名称和描述。\n\n" +
    "何时用：\n" +
    "- 开始任务前，查看是否有相关的已保存技能可以直接复用\n" +
    "- 用户问'你会做什么'或'你有什么技能'\n" +
    "- 不确定某个流程是否已经被沉淀为技能\n\n" +
    "不要用于：\n" +
    "- 查看某个技能的具体内容 → 用 skill_view\n" +
    "- 创建/修改/删除技能 → 用 skill_manage",
  enabled: true,
  risk: "safe",
  effectKind: "read",
  verificationPolicy: "none",
  inputSchema: {
    type: "object",
    properties: {},
  },
  execute: executeSkillList,
};

// ── skill_view：查看单个技能完整内容 ────────────────────────

async function executeSkillView(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name || "").trim();
  if (!name) {
    return JSON.stringify({ success: false, error: "name 参数必填，指定要查看的技能名称" });
  }
  const skill = getSkill(name);
  if (!skill) {
    return JSON.stringify({
      success: false,
      error: `技能 '${name}' 不存在。用 skill_list 查看所有可用技能。`,
    });
  }
  recordSkillViewed(name);
  return JSON.stringify({
    success: true,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    content: skill.content,
  });
}

export const skillViewTool: ToolDefinition = {
  id: "skill_view",
  name: "查看技能",
  description:
    "查看单个技能的完整内容（SKILL.md），包含操作步骤、注意事项、模板等。\n\n" +
    "何时用：\n" +
    "- 要用 skill_list 找到的某个技能，需要看具体步骤\n" +
    "- 执行某类任务前，查看是否有已沉淀的标准流程\n" +
    "- 修改技能前，先查看当前内容\n\n" +
    "参数：name（必填，技能名称）",
  enabled: true,
  risk: "safe",
  effectKind: "read",
  verificationPolicy: "none",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "技能名称（用 skill_list 查看可用名称）" },
    },
    required: ["name"],
  },
  execute: executeSkillView,
};

// ── skill_manage：创建/编辑/删除技能 ────────────────────────

async function executeSkillManage(args: Record<string, unknown>): Promise<string> {
  const action = String(args.action || "").trim();
  const name = String(args.name || "").trim();
  const content = args.content !== undefined ? String(args.content) : "";

  if (!action) {
    return JSON.stringify({ success: false, error: "action 参数必填，可选：create / edit / delete" });
  }
  if (!name) {
    return JSON.stringify({ success: false, error: "name 参数必填" });
  }

  let result: { success: boolean; message?: string; error?: string };

  switch (action) {
    case "create":
      if (!content) {
        return JSON.stringify({ success: false, error: "create 操作需要 content 参数（完整的 SKILL.md 内容）" });
      }
      result = createSkill(name, content);
      if (result.success) {
        logger.info(LogTag.Skills, `技能创建成功: ${name}`);
      } else {
        logger.warn(LogTag.Skills, `技能创建失败: ${name} - ${result.error}`);
      }
      break;
    case "edit":
      if (!content) {
        return JSON.stringify({ success: false, error: "edit 操作需要 content 参数（完整的更新后 SKILL.md 内容）" });
      }
      result = editSkill(name, content);
      if (result.success) {
        logger.info(LogTag.Skills, `技能更新成功: ${name}`);
      } else {
        logger.warn(LogTag.Skills, `技能更新失败: ${name} - ${result.error}`);
      }
      break;
    case "delete":
      result = deleteSkill(name);
      if (result.success) {
        logger.info(LogTag.Skills, `技能删除成功: ${name}`);
      } else {
        logger.warn(LogTag.Skills, `技能删除失败: ${name} - ${result.error}`);
      }
      break;
    default:
      return JSON.stringify({ success: false, error: `未知 action '${action}'，可选：create / edit / delete` });
  }

  return JSON.stringify(result);
}

export const skillManageTool: ToolDefinition = {
  id: "skill_manage",
  name: "管理技能",
  description:
    "管理可复用技能（程序性记忆）：创建、编辑、删除。\n\n" +
    "技能是你从成功经验中沉淀的可复用流程。每个技能是一个 SKILL.md 文件，包含 YAML frontmatter（name/description）和 Markdown 操作步骤。\n\n" +
    "Actions:\n" +
    "- create — 创建新技能（需要完整 SKILL.md 内容）\n" +
    "- edit — 完整替换现有技能的 SKILL.md 内容\n" +
    "- delete — 删除技能（被 pin 的技能不能删除）\n\n" +
    "何时创建技能：\n" +
    "- 完成了复杂任务（5+ 次工具调用），流程可复用\n" +
    "- 克服了错误，找到了正确方法\n" +
    "- 用户纠正了你的做法，新方法有效\n" +
    "- 发现了非平凡的工作流\n" +
    "- 用户明确要求'记住这个流程'\n\n" +
    "何时编辑技能：\n" +
    "- 使用技能时发现步骤过时/错误\n" +
    "- 发现了遗漏的步骤或陷阱\n" +
    "- 操作系统特定的失败需要补充说明\n\n" +
    "好的技能应包含：触发条件、带精确命令的编号步骤、常见陷阱、验证方法。",
  enabled: true,
  risk: "fs-write",
  effectKind: "mutation",
  verificationPolicy: "none",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "edit", "delete"],
        description: "操作类型",
      },
      name: { type: "string", description: "技能名称（小写字母数字连字符，如 deploy-to-server）" },
      content: {
        type: "string",
        description: "完整的 SKILL.md 内容（YAML frontmatter + Markdown）。create 和 edit 时必填。",
      },
    },
    required: ["action", "name"],
  },
  execute: executeSkillManage,
};

// ── 注册所有技能工具 ──────────────────────────────────────────

import { toolRegistry } from "../orchestrator/tools/registry/tool-registry";

export function registerSkillTools(): void {
  toolRegistry.register(skillListTool);
  toolRegistry.register(skillViewTool);
  toolRegistry.register(skillManageTool);
}
