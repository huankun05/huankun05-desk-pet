// consolidation —— 自进化技能系统的 LLM 整合（伞技能合并）模块。
// 参考 Hermes Agent 的 Curator LLM consolidation 设计：
// 用辅助模型审查自成长技能，识别功能相似/重叠的技能组，合并成"伞技能"（umbrella），
// 原技能打归档标签（不删除，用户可手动清理）。
//
// 保守合并策略：
// - 只合并 source=self-grown/forked/umbrella 的技能（external 不碰）
// - 至少一个技能有实际使用记录
// - 描述高度相似 + 功能领域相同才合并
// - 合并前自动备份，原技能打归档标签不删除

import { logger, LogTag } from "../logger";
import { loadAuxiliaryConfig } from "../settings/model-settings";
import { listSkills, getSkill, createSkill, updateUsageRecord, getUsageRecord } from "./skill-store";
import type { SkillListItem, SkillSource } from "./skill-types";
import { backupSkills } from "./curator";

/** 合并建议：一组相似技能合并成一个伞技能。 */
export interface MergeSuggestion {
  /** 伞技能名称（小写字母数字连字符）。 */
  umbrellaName: string;
  /** 伞技能描述。 */
  umbrellaDescription: string;
  /** 伞技能分类。 */
  category?: string;
  /** 要合并的原技能名称列表。 */
  sourceSkills: string[];
  /** 合并理由（辅助模型给出的解释）。 */
  reason: string;
}

/** LLM 整合结果。 */
export interface ConsolidationResult {
  success: boolean;
  reviewed: number;
  proposed: number;
  executed: number;
  umbrellaCreated: string[];
  archived: string[];
  message: string;
}

/**
 * 调用辅助模型（OpenAI 兼容或 Anthropic 兼容）。
 * 简化实现：直接用 fetch 调用，不接入复杂的 vendor adapter。
 */
async function callAuxiliaryLLM(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  const config = loadAuxiliaryConfig();
  if (!config) {
    logger.warn(LogTag.Skills, "LLM 整合：辅助模型配置不可用，跳过");
    return null;
  }

  const isAnthropic = config.explicitTransport === "anthropic" ||
    config.baseUrl.includes("/anthropic") ||
    config.baseUrl.includes("/v1/messages");

  try {
    if (isAnthropic) {
      // Anthropic Messages API
      const url = config.baseUrl.endsWith("/v1/messages")
        ? config.baseUrl
        : `${config.baseUrl.replace(/\/+$/, "")}/v1/messages`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (!resp.ok) {
        logger.warn(LogTag.Skills, `LLM 整合：Anthropic API 错误 ${resp.status}`);
        return null;
      }
      const data = await resp.json() as { content?: Array<{ text?: string }> };
      return data.content?.[0]?.text ?? null;
    }

    // OpenAI 兼容 Chat Completions API
    const url = config.baseUrl.endsWith("/chat/completions")
      ? config.baseUrl
      : `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });
    if (!resp.ok) {
      logger.warn(LogTag.Skills, `LLM 整合：OpenAI API 错误 ${resp.status}`);
      return null;
    }
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    logger.warn(LogTag.Skills, `LLM 整合：调用失败 ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * 过滤待审查的技能：
 * - 只看 source=self-grown/forked/umbrella（external 不碰）
 * - 至少一个技能有实际使用记录（viewCount > 0 或 useCount > 0）
 * - 排除已归档的
 */
function filterSkillsForConsolidation(skills: SkillListItem[]): SkillListItem[] {
  const eligibleSources: SkillSource[] = ["self-grown", "forked", "umbrella"];
  return skills.filter((s) => {
    if (s.source && !eligibleSources.includes(s.source)) return false;
    const usage = getUsageRecord(s.name);
    // 至少有使用记录才考虑合并（没被用过的可能是备用的，保守不合并）
    if (usage && (usage.viewCount > 0 || usage.useCount > 0)) return true;
    return false;
  });
}

/**
 * 用辅助模型生成合并建议。
 * 输入：待审查的技能列表（名称+描述+来源）
 * 输出：JSON 格式的合并建议数组
 */
async function generateMergeSuggestions(skills: SkillListItem[]): Promise<MergeSuggestion[]> {
  if (skills.length < 2) return [];

  const systemPrompt = `你是一个技能库整理助手。你的任务是审查用户的自成长技能列表，识别功能高度相似或重叠的技能组，建议合并成"伞技能"（umbrella skill）。

伞技能的定义：把多个功能相似的技能的公共流程抽象成一个更通用的大技能，同时保留各技能的特殊细节。

保守合并原则（必须严格遵守）：
1. 只合并"功能领域相同 + 描述高度相似 + 步骤重叠度高"的技能
2. 描述模糊、拿不准的一律不合并
3. 每个合并组至少 2 个技能
4. 伞技能名称用小写字母数字连字符，如 "deploy-server"
5. 伞技能描述要清晰说明它覆盖了哪些原技能的功能

输出严格的 JSON 数组格式，不要输出其他文字：
[
  {
    "umbrellaName": "技能名",
    "umbrellaDescription": "描述",
    "category": "分类（可选）",
    "sourceSkills": ["原技能1", "原技能2"],
    "reason": "合并理由"
  }
]
如果没有值得合并的技能，输出空数组 []。`;

  const skillListText = skills.map((s) =>
    `- ${s.name} [${s.source ?? "unknown"}]：${s.description}${s.category ? `（分类：${s.category}）` : ""}`
  ).join("\n");

  const userPrompt = `请审查以下 ${skills.length} 个自成长技能，识别功能高度相似或重叠的技能组，建议合并成伞技能：

${skillListText}

请输出合并建议的 JSON 数组。`;

  const response = await callAuxiliaryLLM(systemPrompt, userPrompt);
  if (!response) return [];

  // 解析 JSON（尝试提取 JSON 数组）
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const suggestions = JSON.parse(jsonMatch[0]) as MergeSuggestion[];
    // 验证建议格式
    return suggestions.filter((s) =>
      typeof s.umbrellaName === "string" &&
      typeof s.umbrellaDescription === "string" &&
      Array.isArray(s.sourceSkills) &&
      s.sourceSkills.length >= 2
    );
  } catch {
    logger.warn(LogTag.Skills, "LLM 整合：解析合并建议 JSON 失败");
    return [];
  }
}

/**
 * 用辅助模型生成伞技能的 SKILL.md 内容。
 */
async function generateUmbrellaSkillContent(
  suggestion: MergeSuggestion,
  sourceSkillContents: Array<{ name: string; content: string }>,
): Promise<string | null> {
  const systemPrompt = `你是一个技能编写助手。你的任务是根据多个功能相似的原技能，编写一个"伞技能"（umbrella skill）的 SKILL.md 文件。

伞技能的要求：
1. 把多个原技能的公共流程抽象成一个更通用的大技能
2. 保留各原技能的特殊细节（作为分支或特例说明）
3. 结构清晰：frontmatter（name/description/source/category/version/tags/createdBy）+ 用途说明 + 操作步骤 + 注意事项
4. source 字段必须是 "umbrella"
5. createdBy 是 "agent"
6. 内容要实用、可执行，不要空洞

SKILL.md 格式：
---
name: 技能名
description: 一句话描述
source: umbrella
category: 分类
version: 1.0.0
tags: [标签1, 标签2]
createdBy: agent
---

# 技能名

## 用途
...

## 操作步骤
...

## 注意事项
...`;

  const sourceContentsText = sourceSkillContents.map((s) =>
    `=== 原技能：${s.name} ===\n${s.content}`
  ).join("\n\n");

  const userPrompt = `请根据以下合并建议，编写伞技能的 SKILL.md 内容。

合并建议：
- 伞技能名：${suggestion.umbrellaName}
- 伞技能描述：${suggestion.umbrellaDescription}
- 合并理由：${suggestion.reason}
- 原技能：${suggestion.sourceSkills.join(", ")}

原技能内容：
${sourceContentsText}

请输出完整的 SKILL.md 内容（从 --- 开始），不要输出其他文字。`;

  const response = await callAuxiliaryLLM(systemPrompt, userPrompt);
  if (!response) return null;

  // 提取 SKILL.md 内容（从 --- 开始）
  const startIdx = response.indexOf("---");
  if (startIdx === -1) return null;
  return response.slice(startIdx).trim();
}

/**
 * 执行一个合并建议：创建伞技能 + 原技能打归档标签。
 */
async function executeMergeSuggestion(suggestion: MergeSuggestion): Promise<{
  success: boolean;
  umbrellaName?: string;
  archived?: string[];
  error?: string;
}> {
  // 1. 读取原技能内容
  const sourceSkillContents: Array<{ name: string; content: string }> = [];
  for (const name of suggestion.sourceSkills) {
    const skill = getSkill(name);
    if (!skill) {
      return { success: false, error: `原技能 '${name}' 不存在` };
    }
    sourceSkillContents.push({ name, content: skill.content });
  }

  // 2. 检查伞技能是否已存在
  const existing = getSkill(suggestion.umbrellaName);
  if (existing) {
    return { success: false, error: `伞技能 '${suggestion.umbrellaName}' 已存在` };
  }

  // 3. 生成伞技能内容
  const umbrellaContent = await generateUmbrellaSkillContent(suggestion, sourceSkillContents);
  if (!umbrellaContent) {
    return { success: false, error: "生成伞技能内容失败" };
  }

  // 4. 创建伞技能
  const createResult = createSkill(suggestion.umbrellaName, umbrellaContent);
  if (!createResult.success) {
    return { success: false, error: createResult.error ?? "创建伞技能失败" };
  }

  // 5. 原技能打归档标签（不删除）
  const archived: string[] = [];
  for (const name of suggestion.sourceSkills) {
    updateUsageRecord(name, {
      status: "archived",
      mergedInto: suggestion.umbrellaName,
    });
    archived.push(name);
  }

  logger.info(LogTag.Skills, `LLM 整合：合并 ${suggestion.sourceSkills.join("+")} → ${suggestion.umbrellaName}`);

  return { success: true, umbrellaName: suggestion.umbrellaName, archived };
}

/**
 * 运行 LLM 整合（伞技能合并）。
 * 主入口：加载配置、过滤技能、生成建议、执行合并、备份。
 */
export async function runConsolidation(): Promise<ConsolidationResult> {
  logger.info(LogTag.Skills, "LLM 整合（伞技能合并）启动...");

  // 1. 加载所有技能（不含已归档的）
  const allSkills = listSkills();
  logger.info(LogTag.Skills, `LLM 整合：共 ${allSkills.length} 个活跃技能`);

  // 2. 过滤待审查的技能
  const eligibleSkills = filterSkillsForConsolidation(allSkills);
  logger.info(LogTag.Skills, `LLM 整合：${eligibleSkills.length} 个技能符合审查条件（自成长+有使用记录）`);

  if (eligibleSkills.length < 2) {
    return {
      success: true,
      reviewed: eligibleSkills.length,
      proposed: 0,
      executed: 0,
      umbrellaCreated: [],
      archived: [],
      message: `符合条件的技能不足 2 个（${eligibleSkills.length} 个），跳过合并`,
    };
  }

  // 3. 备份（合并前自动备份）
  let backupPath: string | null = null;
  try {
    backupPath = backupSkills();
    logger.info(LogTag.Skills, `LLM 整合：已备份技能目录 → ${backupPath}`);
  } catch (err) {
    logger.warn(LogTag.Skills, `LLM 整合：备份失败 ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. 生成合并建议
  const suggestions = await generateMergeSuggestions(eligibleSkills);
  logger.info(LogTag.Skills, `LLM 整合：生成 ${suggestions.length} 个合并建议`);

  if (suggestions.length === 0) {
    return {
      success: true,
      reviewed: eligibleSkills.length,
      proposed: 0,
      executed: 0,
      umbrellaCreated: [],
      archived: [],
      message: "辅助模型未发现值得合并的技能组",
    };
  }

  // 5. 执行合并建议
  const umbrellaCreated: string[] = [];
  const archived: string[] = [];
  let executed = 0;

  for (const suggestion of suggestions) {
    const result = await executeMergeSuggestion(suggestion);
    if (result.success && result.umbrellaName) {
      executed++;
      umbrellaCreated.push(result.umbrellaName);
      if (result.archived) archived.push(...result.archived);
    } else {
      logger.warn(LogTag.Skills, `LLM 整合：合并建议执行失败 - ${suggestion.umbrellaName}: ${result.error}`);
    }
  }

  const message = `审查 ${eligibleSkills.length} 个技能，建议 ${suggestions.length} 组合并，成功执行 ${executed} 组，创建伞技能 ${umbrellaCreated.length} 个，归档原技能 ${archived.length} 个`;

  logger.info(LogTag.Skills, `LLM 整合完成：${message}`);

  return {
    success: true,
    reviewed: eligibleSkills.length,
    proposed: suggestions.length,
    executed,
    umbrellaCreated,
    archived,
    message,
  };
}
