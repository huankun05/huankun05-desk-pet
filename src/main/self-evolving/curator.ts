// curator —— 自进化技能系统的后台维护模块。
// 参考 Hermes Agent 的 Curator 设计：跟踪技能使用情况，长期未用的技能自动标记 stale/archived，
// 支持备份回滚和 Pin 保护。
//
// 触发方式：应用启动时检查 + 手动触发（skill_curator 工具）。
// 自动状态转换是确定性的（无 LLM 成本），LLM 整合（合并相似技能）在 P4 实现。

import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import { logger, LogTag } from "../logger";
import { getSkillsRootDir, getUsageRecord, updateUsageRecord, listSkills } from "./skill-store";
import type { SkillUsageRecord } from "./skill-types";

/** Curator 配置。 */
export interface CuratorConfig {
  /** 是否启用 Curator。 */
  enabled: boolean;
  /** 运行间隔（小时），默认 168（7天）。 */
  intervalHours: number;
  /** 技能多少天未使用后标记为 stale，默认 30。 */
  staleAfterDays: number;
  /** 技能多少天未使用后归档，默认 90。 */
  archiveAfterDays: number;
  /** 备份保留数量，默认 5。 */
  backupKeep: number;
  /** 是否启用 LLM 整合（用辅助模型审查合并相似技能），默认 false。 */
  consolidate: boolean;
  /** 上次运行时间（ISO 字符串）。 */
  lastRunAt?: string;
}

/** Curator 运行结果。 */
export interface CuratorRunResult {
  success: boolean;
  ran: boolean;
  message: string;
  stats?: {
    total: number;
    staleMarked: number;
    archived: number;
    alreadyStale: number;
    alreadyArchived: number;
    pinned: number;
  };
  backupPath?: string;
  error?: string;
}

const DEFAULT_CONFIG: CuratorConfig = {
  enabled: true,
  intervalHours: 168,
  staleAfterDays: 30,
  archiveAfterDays: 90,
  backupKeep: 5,
  consolidate: false,
};

/** 配置文件路径。 */
function configPath(): string {
  return path.join(app.getPath("userData"), "skills-curator.json");
}

/** 备份目录路径。 */
function backupDir(): string {
  return path.join(getSkillsRootDir(), ".curator_backups");
}

/** 归档目录路径。 */
function archiveDir(): string {
  return path.join(getSkillsRootDir(), ".archive");
}

/** 加载 Curator 配置。 */
export function loadCuratorConfig(): CuratorConfig {
  try {
    const p = configPath();
    if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG };
    const saved = JSON.parse(fs.readFileSync(p, "utf-8"));
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** 保存 Curator 配置。 */
export function saveCuratorConfig(config: Partial<CuratorConfig>): CuratorConfig {
  const current = loadCuratorConfig();
  const updated = { ...current, ...config };
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    logger.warn(LogTag.Skills, `保存 Curator 配置失败: ${err}`);
  }
  return updated;
}

/** 检查是否应该运行 Curator（距上次运行超过 intervalHours）。 */
export function shouldRunCurator(): boolean {
  const config = loadCuratorConfig();
  if (!config.enabled) return false;
  if (!config.lastRunAt) return true; // 首次运行
  const lastRun = new Date(config.lastRunAt).getTime();
  const now = Date.now();
  const elapsedHours = (now - lastRun) / (1000 * 60 * 60);
  return elapsedHours >= config.intervalHours;
}

/** 备份技能目录（tar.gz）。 */
function backupSkills(): string | null {
  try {
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(dir, `skills-${timestamp}.tar.gz`);

    // 简单实现：用 Node.js 的 zlib 和 tar 流
    // 为了避免依赖，这里用更简单的方式：复制目录到备份位置
    const backupSkillsDir = path.join(dir, `skills-${timestamp}`);
    const skillsRoot = getSkillsRootDir();

    if (fs.existsSync(skillsRoot)) {
      fs.cpSync(skillsRoot, backupSkillsDir, {
        recursive: true,
        filter: (src) => {
          // 跳过备份目录本身和归档目录
          const basename = path.basename(src);
          return basename !== ".curator_backups" && basename !== ".archive";
        },
      });
    }

    logger.info(LogTag.Skills, `Curator 备份完成: ${backupSkillsDir}`);
    return backupSkillsDir;
  } catch (err) {
    logger.warn(LogTag.Skills, `Curator 备份失败: ${err}`);
    return null;
  }
}

/** 清理旧备份，保留最近 N 个。 */
function cleanupOldBackups(keep: number): void {
  try {
    const dir = backupDir();
    if (!fs.existsSync(dir)) return;
    const backups = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("skills-"))
      .map((d) => ({
        name: d.name,
        path: path.join(dir, d.name),
        time: fs.statSync(path.join(dir, d.name)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    if (backups.length > keep) {
      for (let i = keep; i < backups.length; i++) {
        fs.rmSync(backups[i].path, { recursive: true, force: true });
      }
      logger.info(LogTag.Skills, `Curator 清理旧备份: 保留 ${keep} 个，删除 ${backups.length - keep} 个`);
    }
  } catch (err) {
    logger.warn(LogTag.Skills, `Curator 清理备份失败: ${err}`);
  }
}

/** 获取技能最后使用时间（优先 lastUsedAt，其次 lastViewedAt，最后 createdAt）。 */
function getLastUsedTime(record: SkillUsageRecord | undefined, skillName: string): number {
  if (record?.lastUsedAt) return new Date(record.lastUsedAt).getTime();
  if (record?.lastViewedAt) return new Date(record.lastViewedAt).getTime();
  // 从技能文件的修改时间推断
  try {
    const skills = listSkills();
    const skill = skills.find((s) => s.name === skillName);
    if (skill?.updatedAt) return new Date(skill.updatedAt).getTime();
  } catch {
    // ignore
  }
  return Date.now(); // 找不到时认为是新的
}

/** 执行 Curator 运行（自动状态转换 + 可选 LLM 整合）。 */
export async function runCurator(options?: { force?: boolean; dryRun?: boolean }): Promise<CuratorRunResult> {
  const config = loadCuratorConfig();

  if (!config.enabled && !options?.force) {
    return { success: true, ran: false, message: "Curator 已禁用" };
  }

  if (!shouldRunCurator() && !options?.force) {
    const lastRun = config.lastRunAt ? new Date(config.lastRunAt).toLocaleString() : "从未";
    return {
      success: true,
      ran: false,
      message: `距上次运行（${lastRun}）未超过 ${config.intervalHours} 小时，跳过。用 force=true 强制运行。`,
    };
  }

  const skills = listSkills();
  const now = Date.now();
  const staleMs = config.staleAfterDays * 24 * 60 * 60 * 1000;
  const archiveMs = config.archiveAfterDays * 24 * 60 * 60 * 1000;

  const stats = {
    total: skills.length,
    staleMarked: 0,
    archived: 0,
    alreadyStale: 0,
    alreadyArchived: 0,
    pinned: 0,
  };

  let backupPath: string | undefined;

  if (!options?.dryRun) {
    backupPath = backupSkills() || undefined;
    cleanupOldBackups(config.backupKeep);
  }

  for (const skill of skills) {
    const record = getUsageRecord(skill.name);

    // 被 pin 的技能跳过
    if (record?.pinned) {
      stats.pinned++;
      continue;
    }

    const lastUsed = getLastUsedTime(record, skill.name);
    const elapsed = now - lastUsed;
    const currentStatus = record?.status || "active";

    if (currentStatus === "archived") {
      stats.alreadyArchived++;
      continue;
    }

    if (elapsed >= archiveMs) {
      // 归档
      if (!options?.dryRun) {
        archiveSkill(skill.name);
        updateUsageRecord(skill.name, { status: "archived" });
      }
      stats.archived++;
    } else if (elapsed >= staleMs) {
      // 标记 stale
      if (currentStatus !== "stale" && !options?.dryRun) {
        updateUsageRecord(skill.name, { status: "stale" });
      }
      if (currentStatus === "stale") {
        stats.alreadyStale++;
      } else {
        stats.staleMarked++;
      }
    }
  }

  // P4: LLM 整合（可选，默认关闭）
  // 用辅助模型审查技能库，合并相似技能，修补过时技能
  let consolidateResult: { reviewed: number; proposed: number } | undefined;
  if (config.consolidate && !options?.dryRun && skills.length > 0) {
    try {
      consolidateResult = await runLLMConsolidation(skills);
      logger.info(LogTag.Skills, `LLM 整合完成：审查 ${consolidateResult.reviewed} 个技能，建议 ${consolidateResult.proposed} 个操作`);
    } catch (err) {
      logger.warn(LogTag.Skills, `LLM 整合异常: ${err}`);
    }
  }

  if (!options?.dryRun) {
    saveCuratorConfig({ lastRunAt: new Date().toISOString() });
  }

  const message = options?.dryRun
    ? `[dry-run] Curator 检查完成：共 ${stats.total} 个技能，将标记 stale ${stats.staleMarked} 个，将归档 ${stats.archived} 个，已 stale ${stats.alreadyStale} 个，已归档 ${stats.alreadyArchived} 个，已 pin ${stats.pinned} 个`
    : `Curator 运行完成：共 ${stats.total} 个技能，新标记 stale ${stats.staleMarked} 个，归档 ${stats.archived} 个，已 stale ${stats.alreadyStale} 个，已归档 ${stats.alreadyArchived} 个，已 pin ${stats.pinned} 个`;

  logger.info(LogTag.Skills, message);

  return { success: true, ran: true, message, stats, backupPath };
}

/** 归档技能（移动到 .archive 目录）。 */
function archiveSkill(name: string): void {
  try {
    const skills = listSkills();
    const skill = skills.find((s) => s.name === name);
    if (!skill) return;

    // 从 listSkills 拿不到 dirPath，需要重新查找
    const skillDir = findSkillDir(name);
    if (!skillDir) return;

    const archive = archiveDir();
    fs.mkdirSync(archive, { recursive: true });
    const dest = path.join(archive, name);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    fs.renameSync(skillDir, dest);
    logger.info(LogTag.Skills, `技能已归档: ${name}`);
  } catch (err) {
    logger.warn(LogTag.Skills, `归档技能失败: ${name} - ${err}`);
  }
}

/** 查找技能目录路径。 */
function findSkillDir(name: string): string | null {
  const root = getSkillsRootDir();
  if (!fs.existsSync(root)) return null;

  const walk = (dir: string): string | null => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        const skillFile = path.join(full, "SKILL.md");
        if (fs.existsSync(skillFile)) {
          try {
            const content = fs.readFileSync(skillFile, "utf-8");
            if (new RegExp(`name:\\s*${name}`).test(content)) {
              return full;
            }
          } catch {
            // ignore
          }
        }
        const found = walk(full);
        if (found) return found;
      }
    }
    return null;
  };

  return walk(root);
}

/** 恢复归档的技能。 */
export function restoreArchivedSkill(name: string): boolean {
  try {
    const archive = archiveDir();
    const skillDir = path.join(archive, name);
    if (!fs.existsSync(skillDir)) {
      logger.warn(LogTag.Skills, `归档中找不到技能: ${name}`);
      return false;
    }
    const root = getSkillsRootDir();
    const dest = path.join(root, name);
    if (fs.existsSync(dest)) {
      logger.warn(LogTag.Skills, `目标位置已存在: ${dest}`);
      return false;
    }
    fs.renameSync(skillDir, dest);
    updateUsageRecord(name, { status: "active" });
    logger.info(LogTag.Skills, `技能已恢复: ${name}`);
    return true;
  } catch (err) {
    logger.warn(LogTag.Skills, `恢复技能失败: ${name} - ${err}`);
    return false;
  }
}

/** Pin 技能（保护不被自动归档）。 */
export function pinSkill(name: string): boolean {
  const record = getUsageRecord(name);
  if (!record) {
    logger.warn(LogTag.Skills, `找不到技能使用记录: ${name}`);
    return false;
  }
  updateUsageRecord(name, { pinned: true });
  logger.info(LogTag.Skills, `技能已 pin: ${name}`);
  return true;
}

/** Unpin 技能。 */
export function unpinSkill(name: string): boolean {
  const record = getUsageRecord(name);
  if (!record) {
    logger.warn(LogTag.Skills, `找不到技能使用记录: ${name}`);
    return false;
  }
  updateUsageRecord(name, { pinned: false });
  logger.info(LogTag.Skills, `技能已 unpin: ${name}`);
  return true;
}

/** 列出归档的技能。 */
export function listArchivedSkills(): string[] {
  try {
    const archive = archiveDir();
    if (!fs.existsSync(archive)) return [];
    return fs
      .readdirSync(archive, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** 获取 Curator 状态信息。 */
export function getCuratorStatus(): {
  config: CuratorConfig;
  shouldRun: boolean;
  lastRun: string | null;
  archivedCount: number;
} {
  const config = loadCuratorConfig();
  return {
    config,
    shouldRun: shouldRunCurator(),
    lastRun: config.lastRunAt || null,
    archivedCount: listArchivedSkills().length,
  };
}

/** 应用启动时检查并运行 Curator（如果需要）。 */
export function initCurator(): void {
  const config = loadCuratorConfig();
  if (!config.enabled) {
    logger.info(LogTag.Skills, "Curator 已禁用，跳过初始化检查");
    return;
  }
  if (shouldRunCurator()) {
    logger.info(LogTag.Skills, "Curator 检测到需要运行，开始执行...");
    // 异步运行，不阻塞启动
    setImmediate(() => {
      try {
        runCurator();
      } catch (err) {
        logger.warn(LogTag.Skills, `Curator 运行异常: ${err}`);
      }
    });
  } else {
    logger.info(LogTag.Skills, "Curator 初始化检查完成，暂不需要运行");
  }
}

/**
 * P4: LLM 整合（框架版本）
 * 用辅助模型审查技能库，识别相似技能、过时技能，建议合并或修补。
 *
 * 当前实现：框架版本，记录日志并返回建议数量。
 * 后续深化：接入 Cyrene 的 LLM 客户端，实际调用辅助模型进行审查，
 * 生成合并建议（相似技能合并为 umbrella 技能）和修补建议（过时技能更新步骤）。
 *
 * @param skills 待审查的技能列表
 * @returns 审查结果（审查数量、建议操作数量）
 */
async function runLLMConsolidation(
  skills: Awaited<ReturnType<typeof listSkills>>,
): Promise<{ reviewed: number; proposed: number }> {
  logger.info(LogTag.Skills, `LLM 整合启动：审查 ${skills.length} 个技能...`);

  // 框架版本：仅记录日志，不实际调用 LLM
  // 后续实现步骤：
  // 1. 加载辅助模型配置（auxiliary.curator）
  // 2. 构建审查 prompt：列出所有技能的名称+描述，要求模型识别相似/过时技能
  // 3. 调用 LLM 获取审查结果
  // 4. 解析结果，生成合并/修补建议
  // 5. 执行建议（需要用户确认或自动执行）

  const proposed = 0; // 框架版本暂不生成建议
  logger.info(LogTag.Skills, `LLM 整合完成（框架）：审查 ${skills.length} 个技能，建议 ${proposed} 个操作`);

  return {
    reviewed: skills.length,
    proposed,
  };
}
