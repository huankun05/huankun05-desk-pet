/**
 * 备份管理模块
 * 支持备份/恢复人设、风格、角色配置、应用配置
 * 支持手动备份和自动备份
 */

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { logger, LogTag } from "../logger";

// ========== 类型定义 ==========

export type BackupCategory = "all" | "soul" | "styles" | "characters" | "settings" | "skills";

export type BackupType = "manual" | "auto";

export interface BackupMetadata {
  backupId: string;
  type: BackupType;
  category: BackupCategory;
  timestamp: string;
  description: string;
  items: string[];
}

export interface BackupInfo {
  metadata: BackupMetadata;
  dirPath: string;
}

// ========== 路径工具 ==========

function getBackupRootDir(): string {
  return path.join(app.getPath("userData"), "backups");
}

function getTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function generateBackupId(type: BackupType, category: BackupCategory): string {
  return `${type}-${category}-${getTimestamp()}`;
}

// ========== 备份项路径 ==========

function getSoulPath(): string {
  return path.join(process.cwd(), "prompts", "soul.md");
}

function getStylesDir(): string {
  return path.join(process.cwd(), "prompts", "styles");
}

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "app-settings.json");
}

function getSkillsDir(): string {
  return path.join(app.getPath("userData"), "skills");
}

// ========== 核心功能 ==========

/**
 * 创建备份
 * @param category 备份类别
 * @param type 备份类型
 * @param description 描述
 * @returns 备份信息
 */
export function createBackup(
  category: BackupCategory = "all",
  type: BackupType = "manual",
  description: string = ""
): BackupInfo | null {
  try {
    const backupId = generateBackupId(type, category);
    const backupDir = path.join(getBackupRootDir(), backupId);
    fs.mkdirSync(backupDir, { recursive: true });

    const items: string[] = [];

    // 备份人设
    if (category === "all" || category === "soul") {
      const soulPath = getSoulPath();
      if (fs.existsSync(soulPath)) {
        const destPath = path.join(backupDir, "soul.md");
        fs.copyFileSync(soulPath, destPath);
        items.push("soul.md");
        logger.info(LogTag.Skills, `备份: soul.md`);
      }
    }

    // 备份风格
    if (category === "all" || category === "styles") {
      const stylesDir = getStylesDir();
      if (fs.existsSync(stylesDir)) {
        const destDir = path.join(backupDir, "styles");
        fs.cpSync(stylesDir, destDir, { recursive: true });
        const styleFiles = fs.readdirSync(stylesDir).filter((f) => f.endsWith(".md"));
        items.push(...styleFiles.map((f) => `styles/${f}`));
        logger.info(LogTag.Skills, `备份: styles/ (${styleFiles.length} 个文件)`);
      }
    }

    // 备份角色配置和应用配置（都在 app-settings.json 中）
    if (category === "all" || category === "characters" || category === "settings") {
      const settingsPath = getSettingsPath();
      if (fs.existsSync(settingsPath)) {
        const destPath = path.join(backupDir, "app-settings.json");
        fs.copyFileSync(settingsPath, destPath);
        items.push("app-settings.json");
        logger.info(LogTag.Skills, `备份: app-settings.json`);
      }
    }

    // 备份技能目录
    if (category === "all" || category === "skills") {
      const skillsDir = getSkillsDir();
      if (fs.existsSync(skillsDir)) {
        const destDir = path.join(backupDir, "skills");
        fs.cpSync(skillsDir, destDir, {
          recursive: true,
          filter: (src) => {
            const basename = path.basename(src);
            return basename !== ".curator_backups" && basename !== ".archive";
          },
        });
        const skillCount = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory()).length;
        items.push(`skills/ (${skillCount} 个技能)`);
        logger.info(LogTag.Skills, `备份: skills/ (${skillCount} 个技能)`);
      }
    }

    // 写入元数据
    const metadata: BackupMetadata = {
      backupId,
      type,
      category,
      timestamp: new Date().toISOString(),
      description: description || `${type === "manual" ? "手动备份" : "自动备份"} - ${category}`,
      items,
    };
    fs.writeFileSync(path.join(backupDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

    logger.info(LogTag.Skills, `备份完成: ${backupId} (${items.length} 个项)`);
    return { metadata, dirPath: backupDir };
  } catch (error) {
    logger.error(LogTag.Skills, `备份失败: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * 列出所有备份
 * @returns 备份信息列表（按时间倒序）
 */
export function listBackups(): BackupInfo[] {
  try {
    const rootDir = getBackupRootDir();
    if (!fs.existsSync(rootDir)) return [];

    const backups: BackupInfo[] = [];
    const dirs = fs.readdirSync(rootDir, { withFileTypes: true }).filter((d) => d.isDirectory());

    for (const dir of dirs) {
      const metadataPath = path.join(rootDir, dir.name, "metadata.json");
      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as BackupMetadata;
          backups.push({ metadata, dirPath: path.join(rootDir, dir.name) });
        } catch {
          // 跳过无效的备份
        }
      }
    }

    // 按时间倒序
    backups.sort((a, b) => b.metadata.timestamp.localeCompare(a.metadata.timestamp));
    return backups;
  } catch (error) {
    logger.error(LogTag.Skills, `列出备份失败: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * 恢复备份
 * @param backupId 备份ID
 * @returns 是否成功
 */
export function restoreBackup(backupId: string): boolean {
  try {
    const backups = listBackups();
    const backup = backups.find((b) => b.metadata.backupId === backupId);
    if (!backup) {
      logger.error(LogTag.Skills, `恢复失败: 未找到备份 ${backupId}`);
      return false;
    }

    const { metadata, dirPath } = backup;
    logger.info(LogTag.Skills, `开始恢复备份: ${backupId}`);

    // 恢复前先自动备份当前状态
    createBackup(metadata.category, "auto", `恢复前自动备份 - 即将恢复 ${backupId}`);

    // 恢复人设
    if (metadata.items.includes("soul.md")) {
      const srcPath = path.join(dirPath, "soul.md");
      const destPath = getSoulPath();
      if (fs.existsSync(srcPath)) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
        logger.info(LogTag.Skills, `恢复: soul.md`);
      }
    }

    // 恢复风格
    const styleItems = metadata.items.filter((i) => i.startsWith("styles/"));
    if (styleItems.length > 0) {
      const srcDir = path.join(dirPath, "styles");
      const destDir = getStylesDir();
      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.cpSync(srcDir, destDir, { recursive: true });
        logger.info(LogTag.Skills, `恢复: styles/ (${styleItems.length} 个文件)`);
      }
    }

    // 恢复配置
    if (metadata.items.includes("app-settings.json")) {
      const srcPath = path.join(dirPath, "app-settings.json");
      const destPath = getSettingsPath();
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        logger.info(LogTag.Skills, `恢复: app-settings.json`);
      }
    }

    // 恢复技能目录
    const hasSkillsBackup = metadata.items.some((item: string) => item.startsWith("skills/"));
    if (hasSkillsBackup) {
      const srcDir = path.join(dirPath, "skills");
      const destDir = getSkillsDir();
      if (fs.existsSync(srcDir)) {
        // 先备份当前技能目录
        const tempDir = destDir + "_restore_backup_" + Date.now();
        if (fs.existsSync(destDir)) {
          fs.renameSync(destDir, tempDir);
        }
        try {
          fs.cpSync(srcDir, destDir, { recursive: true });
          logger.info(LogTag.Skills, `恢复: skills/`);
          // 恢复成功后删除临时备份
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch (err) {
          // 恢复失败，回滚
          if (fs.existsSync(tempDir)) {
            if (fs.existsSync(destDir)) {
              fs.rmSync(destDir, { recursive: true, force: true });
            }
            fs.renameSync(tempDir, destDir);
          }
          throw err;
        }
      }
    }

    logger.info(LogTag.Skills, `恢复完成: ${backupId}`);
    return true;
  } catch (error) {
    logger.error(LogTag.Skills, `恢复失败: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * 删除备份
 * @param backupId 备份ID
 * @returns 是否成功
 */
export function deleteBackup(backupId: string): boolean {
  try {
    const backups = listBackups();
    const backup = backups.find((b) => b.metadata.backupId === backupId);
    if (!backup) {
      logger.error(LogTag.Skills, `删除失败: 未找到备份 ${backupId}`);
      return false;
    }

    fs.rmSync(backup.dirPath, { recursive: true, force: true });
    logger.info(LogTag.Skills, `删除备份: ${backupId}`);
    return true;
  } catch (error) {
    logger.error(LogTag.Skills, `删除备份失败: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * 清理旧备份，保留最近 N 个
 * @param keepCount 保留数量
 * @param category 可选，只清理指定类别的备份
 */
export function cleanupOldBackups(keepCount: number = 10, category?: BackupCategory): void {
  try {
    let backups = listBackups();
    if (category) {
      backups = backups.filter((b) => b.metadata.category === category);
    }

    if (backups.length <= keepCount) return;

    const toDelete = backups.slice(keepCount);
    for (const backup of toDelete) {
      deleteBackup(backup.metadata.backupId);
    }

    logger.info(LogTag.Skills, `清理旧备份: 删除 ${toDelete.length} 个，保留 ${keepCount} 个`);
  } catch (error) {
    logger.error(LogTag.Skills, `清理旧备份失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 自动备份（用于修改前调用）
 * @param category 备份类别
 */
export function autoBackup(category: BackupCategory): void {
  try {
    createBackup(category, "auto", `修改前自动备份 - ${category}`);
    // 自动清理旧的自动备份，保留最近 5 个
    cleanupOldBackups(5, category);
  } catch (error) {
    logger.warn(LogTag.Skills, `自动备份失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}
