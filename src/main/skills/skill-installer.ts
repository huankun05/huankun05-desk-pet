// 技能安装器 —— 从技能目录安装技能到用户技能目录。
//
// 负责：
// - 检查技能是否已安装
// - 创建技能目录和 SKILL.md 文件
// - 生成技能模板内容
// - 安装后的技能会被 skill-scanner 自动扫描到

import * as fs from "node:fs";
import * as path from "node:path";
import { SKILL_CATALOG, findSkillInCatalog, type SkillCatalogItem } from "./skill-catalog-store";

// ── 类型定义 ────────────────────────────────────────────────

/** 安装结果 */
export interface InstallResult {
  success: boolean;
  skillId: string;
  message: string;
  skillPath?: string;
  error?: string;
}

/** 技能安装器配置 */
export interface SkillInstallerConfig {
  /** 用户技能目录路径 */
  userSkillsDir: string;
  /** 已安装技能的 id 列表（用于检查重复安装） */
  installedSkillIds: string[];
}

// ── 技能模板生成 ────────────────────────────────────────────

/**
 * 生成 SKILL.md 文件内容。
 *
 * 基于技能目录元数据生成标准的 SKILL.md 模板，包含 frontmatter 和正文。
 */
function generateSkillMarkdown(item: SkillCatalogItem): string {
  const toolsList = item.tools?.length ? item.tools.join(", ") : "";
  const modesList = item.modes?.length ? item.modes.join(", ") : "work, code, learn";
  const tagsList = item.tags.join(", ");

  return `---
name: ${item.name}
description: ${item.description}
version: ${item.version}
category: ${item.category}
tags: [${tagsList}]
tools: [${toolsList}]
modes: [${modesList}]
---

# ${item.name}

## 概述

${item.description}

## 使用场景

- 当用户需要完成与「${item.category}」相关的任务时
- 当用户的问题涉及以下关键词时：${item.tags.slice(0, 5).join("、")}

## 能力说明

本技能提供以下能力：

1. **核心能力**：${item.description}
2. **适用模式**：${modesList}
3. **关联工具**：${toolsList || "无特定工具依赖"}

## 使用指南

### 何时调用

当用户的任务匹配以下条件时，应先调用 \`invoke_skill("${item.id}")\` 加载本技能：

- 任务描述中包含本技能的关键词
- 任务类型属于「${item.category}」分类
- 用户明确要求使用本技能

### 调用后行为

加载本技能后，应：

1. 仔细阅读技能的完整规则和约束
2. 按照技能指南执行任务
3. 任务完成后总结结果

## 注意事项

- 本技能为模板技能，安装后可根据实际需求自定义修改
- 技能文件位于用户技能目录，可随时编辑和扩展
- 如遇问题，请检查技能目录下的 SKILL.md 文件

---

*本技能由 CyreneHarness 技能目录自动生成，版本 ${item.version}*
`;
}

// ── 技能安装器 ──────────────────────────────────────────────

export class SkillInstaller {
  private config: SkillInstallerConfig;

  constructor(config: SkillInstallerConfig) {
    this.config = config;
  }

  /**
   * 检查技能是否已安装。
   */
  isInstalled(skillId: string): boolean {
    return this.config.installedSkillIds.includes(skillId);
  }

  /**
   * 检查技能是否在目录中可用。
   */
  isAvailable(skillId: string): boolean {
    return findSkillInCatalog(skillId) !== undefined;
  }

  /**
   * 获取可安装的技能列表（排除已安装的）。
   */
  getAvailableSkills(): SkillCatalogItem[] {
    return SKILL_CATALOG.filter((s) => !this.isInstalled(s.id));
  }

  /**
   * 安装技能。
   *
   * @param skillId 技能 id
   * @returns Promise<InstallResult> 安装结果
   */
  async install(skillId: string): Promise<InstallResult> {
    // 检查技能是否在目录中
    const item = findSkillInCatalog(skillId);
    if (!item) {
      return {
        success: false,
        skillId,
        message: `技能 "${skillId}" 不在技能目录中`,
        error: "SKILL_NOT_FOUND",
      };
    }

    // 检查是否已安装
    if (this.isInstalled(skillId)) {
      return {
        success: false,
        skillId,
        message: `技能 "${skillId}" 已安装`,
        error: "ALREADY_INSTALLED",
      };
    }

    try {
      // 确保用户技能目录存在
      if (!fs.existsSync(this.config.userSkillsDir)) {
        fs.mkdirSync(this.config.userSkillsDir, { recursive: true });
      }

      // 创建技能目录
      const skillDir = path.join(this.config.userSkillsDir, skillId);
      if (fs.existsSync(skillDir)) {
        return {
          success: false,
          skillId,
          message: `技能目录已存在: ${skillDir}`,
          error: "DIR_EXISTS",
        };
      }
      fs.mkdirSync(skillDir, { recursive: true });

      // 生成 SKILL.md 文件
      const skillMdPath = path.join(skillDir, "SKILL.md");
      const skillMdContent = generateSkillMarkdown(item);
      fs.writeFileSync(skillMdPath, skillMdContent, "utf-8");

      // 创建 references 目录（可选）
      const referencesDir = path.join(skillDir, "references");
      if (!fs.existsSync(referencesDir)) {
        fs.mkdirSync(referencesDir, { recursive: true });
      }

      // 更新已安装列表
      this.config.installedSkillIds.push(skillId);

      return {
        success: true,
        skillId,
        message: `技能 "${item.name}" 安装成功`,
        skillPath: skillDir,
      };
    } catch (error) {
      return {
        success: false,
        skillId,
        message: `安装失败: ${(error as Error).message}`,
        error: "INSTALL_ERROR",
      };
    }
  }

  /**
   * 卸载技能（删除技能目录）。
   *
   * @param skillId 技能 id
   * @returns Promise<InstallResult> 卸载结果
   */
  async uninstall(skillId: string): Promise<InstallResult> {
    if (!this.isInstalled(skillId)) {
      return {
        success: false,
        skillId,
        message: `技能 "${skillId}" 未安装`,
        error: "NOT_INSTALLED",
      };
    }

    try {
      const skillDir = path.join(this.config.userSkillsDir, skillId);
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
      }

      // 从已安装列表移除
      const index = this.config.installedSkillIds.indexOf(skillId);
      if (index > -1) {
        this.config.installedSkillIds.splice(index, 1);
      }

      return {
        success: true,
        skillId,
        message: `技能 "${skillId}" 卸载成功`,
      };
    } catch (error) {
      return {
        success: false,
        skillId,
        message: `卸载失败: ${(error as Error).message}`,
        error: "UNINSTALL_ERROR",
      };
    }
  }
}
