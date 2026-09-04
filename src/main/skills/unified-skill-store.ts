// unified-skill-store —— 统一技能存储，合并 Cyrene 原有技能和自进化技能。
// 提供统一的列表、启用/禁用、获取、删除、编辑接口。
// ID 格式：cyrene:<id>（Cyrene 原有技能）/ self:<name>（自进化技能）

import { listSkillsForUi, setSkillEnabled as setCyreneSkillEnabled } from "./index";
import {
  listSkills as listSelfSkills,
  getSkill as getSelfSkill,
  setSkillEnabled as setSelfSkillEnabled,
  deleteSkill as deleteSelfSkill,
  editSkill as editSelfSkill,
} from "../self-evolving/skill-store";
import type { SkillSource } from "../self-evolving/skill-types";

/** 技能来源系统。 */
export type SkillSystem = "cyrene-builtin" | "self-evolving";

/** 统一技能列表项。 */
export interface UnifiedSkill {
  /** 统一 ID：cyrene:<id> 或 self:<name> */
  id: string;
  /** 技能名称。 */
  name: string;
  /** 技能描述。 */
  description: string;
  /** 来源系统。 */
  system: SkillSystem;
  /** 技能来源：self-grown / external / forked / umbrella。Cyrene 原有技能统一为 external。 */
  source: SkillSource;
  /** 是否启用。 */
  enabled: boolean;
  /** 是否受保护（无法删除）。Cyrene 原有技能都是受保护的。 */
  protected: boolean;
  /** 分类标签。 */
  category?: string;
  /** 关联的工具 ID 列表（Cyrene 原有技能有）。 */
  tools?: string[];
  /** 版本。 */
  version?: string;
  /** 最后修改时间（ISO 字符串）。 */
  updatedAt?: string;
  /** 外部来源 URL（自进化技能有）。 */
  sourceUrl?: string;
  /** 创建者（自进化技能有）。 */
  createdBy?: "user" | "agent";
}

/**
 * 列出所有技能（合并 Cyrene 原有 + 自进化）。
 * 按名称排序。
 */
export function listAllSkills(): UnifiedSkill[] {
  const skills: UnifiedSkill[] = [];

  // 1. Cyrene 原有技能
  try {
    const cyreneSkills = listSkillsForUi();
    for (const s of cyreneSkills) {
      skills.push({
        id: `cyrene:${s.id}`,
        name: s.name || s.id,
        description: s.description || "",
        system: "cyrene-builtin",
        source: "external",
        enabled: s.enabled,
        protected: true, // Cyrene 原有技能都是受保护的
        tools: s.tools,
        version: s.version,
      });
    }
  } catch (err) {
    console.warn("[UnifiedSkills] 获取 Cyrene 原有技能失败:", err);
  }

  // 2. 自进化技能
  try {
    const selfSkills = listSelfSkills();
    for (const s of selfSkills) {
      skills.push({
        id: `self:${s.name}`,
        name: s.name,
        description: s.description,
        system: "self-evolving",
        source: (s.source as SkillSource) || "external",
        enabled: s.enabled !== false,
        protected: s.protected === true,
        category: s.category,
        updatedAt: s.updatedAt,
        createdBy: s.createdBy,
      });
    }
  } catch (err) {
    console.warn("[UnifiedSkills] 获取自进化技能失败:", err);
  }

  // 按名称排序
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 解析统一 ID，返回系统和原始 ID。
 */
function parseUnifiedId(id: string): { system: SkillSystem; originalId: string } | null {
  if (id.startsWith("cyrene:")) {
    return { system: "cyrene-builtin", originalId: id.slice("cyrene:".length) };
  }
  if (id.startsWith("self:")) {
    return { system: "self-evolving", originalId: id.slice("self:".length) };
  }
  return null;
}

/**
 * 设置技能启用/禁用状态。
 */
export function setSkillEnabled(
  id: string,
  enabled: boolean
): { success: boolean; message?: string; error?: string } {
  const parsed = parseUnifiedId(id);
  if (!parsed) {
    return { success: false, error: `无效的技能 ID: ${id}` };
  }

  try {
    if (parsed.system === "cyrene-builtin") {
      setCyreneSkillEnabled(parsed.originalId, enabled);
    } else {
      const result = setSelfSkillEnabled(parsed.originalId, enabled);
      if (!result.success) return result;
    }
    return {
      success: true,
      message: `技能已${enabled ? "启用" : "禁用"}`,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * 获取技能完整内容。
 */
export function getSkill(
  id: string
): { success: boolean; skill?: { name: string; description: string; content: string; source?: SkillSource; sourceUrl?: string; enabled?: boolean }; error?: string } {
  const parsed = parseUnifiedId(id);
  if (!parsed) {
    return { success: false, error: `无效的技能 ID: ${id}` };
  }

  if (parsed.system === "self-evolving") {
    const skill = getSelfSkill(parsed.originalId);
    if (!skill) {
      return { success: false, error: `技能 '${parsed.originalId}' 不存在` };
    }
    return {
      success: true,
      skill: {
        name: skill.name,
        description: skill.description,
        content: skill.content,
        source: skill.source,
        sourceUrl: skill.sourceUrl,
        enabled: skill.enabled !== false,
      },
    };
  }

  // Cyrene 原有技能：读取 SKILL.md 文件
  try {
    const cyreneSkills = listSkillsForUi();
    const s = cyreneSkills.find((x) => x.id === parsed.originalId);
    if (!s) {
      return { success: false, error: `技能 '${parsed.originalId}' 不存在` };
    }
    // Cyrene 原有技能的 SKILL.md 路径需要从 registry 获取
    // 这里暂时返回基本信息，内容需要额外处理
    return {
      success: true,
      skill: {
        name: s.name || s.id,
        description: s.description || "",
        content: `# ${s.name || s.id}\n\n${s.description || ""}\n\n（Cyrene 原有技能，完整内容请查看源码目录）`,
        source: "external",
        enabled: s.enabled,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * 删除技能。
 * Cyrene 原有技能受保护，无法删除。
 */
export function deleteSkill(
  id: string
): { success: boolean; message?: string; error?: string } {
  const parsed = parseUnifiedId(id);
  if (!parsed) {
    return { success: false, error: `无效的技能 ID: ${id}` };
  }

  if (parsed.system === "cyrene-builtin") {
    return { success: false, error: "Cyrene 原有技能受保护，无法删除" };
  }

  const result = deleteSelfSkill(parsed.originalId);
  return result;
}

/**
 * 编辑技能内容。
 */
export function editSkill(
  id: string,
  content: string
): { success: boolean; message?: string; error?: string } {
  const parsed = parseUnifiedId(id);
  if (!parsed) {
    return { success: false, error: `无效的技能 ID: ${id}` };
  }

  if (parsed.system === "cyrene-builtin") {
    return { success: false, error: "Cyrene 原有技能暂不支持在线编辑，请修改源码文件" };
  }

  const result = editSelfSkill(parsed.originalId, content);
  return result;
}
