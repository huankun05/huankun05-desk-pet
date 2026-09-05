// 技能服务 —— 整合技能推荐、查询和安装功能。
//
// 提供统一的技能服务接口，供大模型工具调用：
// - listSkills：列出已安装的技能
// - recommendSkills：根据用户需求推荐技能（包括已安装和未安装的）
// - installSkill：安装技能
// - getSkillCatalog：获取可安装的技能目录

import { recommendSkills, type SkillRecommendation } from "./skill-recommender";
import { SKILL_CATALOG, searchSkillCatalog, type SkillCatalogItem } from "./skill-catalog-store";
import { SkillInstaller, type InstallResult } from "./skill-installer";
import type { SkillEntry, SkillMode } from "./types";

// ── 类型定义 ────────────────────────────────────────────────

/** 技能推荐结果（包含已安装和未安装的技能） */
export interface SkillServiceRecommendation {
  /** 技能 id */
  skillId: string;
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 匹配分数（0-100） */
  score: number;
  /** 匹配的关键词 */
  matchedKeywords: string[];
  /** 是否已安装 */
  installed: boolean;
  /** 技能分类 */
  category: string;
  /** 推荐原因 */
  reason: string;
}

/** 技能服务配置 */
export interface SkillServiceConfig {
  /** 用户技能目录路径 */
  userSkillsDir: string;
  /** 已安装的技能列表 */
  installedSkills: SkillEntry[];
}

// ── 技能服务 ─────────────────────────────────────────────────

export class SkillService {
  private config: SkillServiceConfig;
  private installer: SkillInstaller;

  constructor(config: SkillServiceConfig) {
    this.config = config;
    this.installer = new SkillInstaller({
      userSkillsDir: config.userSkillsDir,
      installedSkillIds: config.installedSkills.map((s) => s.id),
    });
  }

  /**
   * 列出已安装的技能。
   *
   * @param mode 按模式过滤（可选）
   * @returns 已安装的技能列表
   */
  listSkills(mode?: SkillMode): SkillEntry[] {
    let skills = this.config.installedSkills.filter((s) => s.enabled);
    if (mode) {
      skills = skills.filter((s) => !s.modes || s.modes.includes(mode));
    }
    return skills;
  }

  /**
   * 根据用户需求推荐技能。
   *
   * 同时推荐已安装和未安装的技能：
   * - 已安装的技能：使用 skill-recommender 进行关键词匹配
   * - 未安装的技能：从技能目录中搜索匹配的技能
   *
   * @param userInput 用户需求描述
   * @param options 推荐选项
   * @returns 推荐结果列表，按分数降序排列
   */
  recommendSkills(
    userInput: string,
    options: {
      limit?: number;
      mode?: SkillMode;
      includeNotInstalled?: boolean;
    } = {},
  ): SkillServiceRecommendation[] {
    const { limit = 10, mode, includeNotInstalled = true } = options;
    const results: SkillServiceRecommendation[] = [];

    // 1. 推荐已安装的技能
    const installedRecommendations = recommendSkills(userInput, this.config.installedSkills, {
      limit: limit,
      mode,
      onlyEnabled: true,
    });

    for (const rec of installedRecommendations) {
      results.push({
        skillId: rec.skill.id,
        name: rec.skill.name,
        description: rec.skill.description,
        score: rec.score,
        matchedKeywords: rec.matchedKeywords,
        installed: true,
        category: rec.skill.id, // 已安装技能没有 category 字段，用 id 代替
        reason: rec.reason,
      });
    }

    // 2. 推荐未安装的技能（从技能目录中搜索）
    if (includeNotInstalled) {
      const installedIds = new Set(this.config.installedSkills.map((s) => s.id));
      const availableSkills = SKILL_CATALOG.filter((s) => !installedIds.has(s.id));

      // 将目录项转换为 SkillEntry 格式，用于推荐
      const catalogAsSkills: SkillEntry[] = availableSkills.map((item) => ({
        id: item.id,
        name: item.name,
        description: `${item.description} 标签：${item.tags.join(" ")}`,
        dirPath: "",
        bodyPath: "",
        references: [],
        enabled: true,
        source: "user",
        modes: item.modes,
      }));

      const catalogRecommendations = recommendSkills(userInput, catalogAsSkills, {
        limit: limit,
        mode,
        onlyEnabled: true,
      });

      for (const rec of catalogRecommendations) {
        const catalogItem = availableSkills.find((s) => s.id === rec.skill.id);
        if (catalogItem) {
          results.push({
            skillId: rec.skill.id,
            name: catalogItem.name,
            description: catalogItem.description,
            score: rec.score * 0.8, // 未安装的技能分数稍低
            matchedKeywords: rec.matchedKeywords,
            installed: false,
            category: catalogItem.category,
            reason: `未安装技能：${rec.reason}`,
          });
        }
      }
    }

    // 按分数降序排列
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * 获取可安装的技能目录。
   *
   * @param category 按分类筛选（可选）
   * @returns 可安装的技能列表
   */
  getSkillCatalog(category?: string): SkillCatalogItem[] {
    if (category) {
      return SKILL_CATALOG.filter((s) => s.category === category);
    }
    return SKILL_CATALOG;
  }

  /**
   * 搜索技能目录。
   *
   * @param query 搜索关键词
   * @returns 匹配的技能列表
   */
  searchCatalog(query: string): SkillCatalogItem[] {
    return searchSkillCatalog(query);
  }

  /**
   * 安装技能。
   *
   * @param skillId 技能 id
   * @returns Promise<InstallResult> 安装结果
   */
  async installSkill(skillId: string): Promise<InstallResult> {
    return this.installer.install(skillId);
  }

  /**
   * 卸载技能。
   *
   * @param skillId 技能 id
   * @returns Promise<InstallResult> 卸载结果
   */
  async uninstallSkill(skillId: string): Promise<InstallResult> {
    return this.installer.uninstall(skillId);
  }

  /**
   * 检查技能是否已安装。
   */
  isInstalled(skillId: string): boolean {
    return this.installer.isInstalled(skillId);
  }

  /**
   * 检查技能是否在目录中可用。
   */
  isAvailable(skillId: string): boolean {
    return this.installer.isAvailable(skillId);
  }
}
