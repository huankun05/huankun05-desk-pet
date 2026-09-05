/**
 * 技能服务 IPC 处理器
 *
 * 注册技能服务相关的 IPC 通道，供渲染进程调用：
 * - 获取可安装的技能目录
 * - 搜索技能目录
 * - 推荐技能（含未安装）
 * - 安装/卸载技能
 * - 触发技能安装提示框（main → renderer）
 */

import { ipcMain, BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { SkillService } from "../skills/skill-service";
import type { SkillEntry, SkillMode } from "../skills/types";

// ── 类型定义 ────────────────────────────────────────────────

/** 技能安装提示的参数（发送给渲染进程） */
export interface SkillInstallPromptData {
  skillId: string;
  skillName: string;
  description: string;
  category: string;
  reason?: string;
}

// ── IPC 处理器注册 ──────────────────────────────────────────

/**
 * 注册技能服务的 IPC 处理器。
 *
 * @param skillService 技能服务实例
 * @returns 取消注册函数
 */
export function registerSkillServiceIpcHandlers(skillService: SkillService): () => void {
  const handlers: Array<() => void> = [];

  // 获取可安装的技能目录
  ipcMain.handle(IPC.SKILL_GET_AVAILABLE_CATALOG, (_event, category?: string) => {
    return skillService.getSkillCatalog(category);
  });

  // 搜索技能目录
  ipcMain.handle(IPC.SKILL_SEARCH_CATALOG, (_event, query: string) => {
    return skillService.searchCatalog(query);
  });

  // 推荐技能（含未安装）
  ipcMain.handle(
    IPC.SKILL_RECOMMEND,
    (
      _event,
      userInput: string,
      options?: { limit?: number; mode?: SkillMode; includeNotInstalled?: boolean },
    ) => {
      return skillService.recommendSkills(userInput, options);
    },
  );

  // 安装技能
  ipcMain.handle(IPC.SKILL_INSTALL, async (_event, skillId: string) => {
    return skillService.installSkill(skillId);
  });

  // 卸载技能
  ipcMain.handle(IPC.SKILL_UNINSTALL, async (_event, skillId: string) => {
    return skillService.uninstallSkill(skillId);
  });

  // 返回取消注册函数（移除所有处理器）
  return () => {
    ipcMain.removeHandler(IPC.SKILL_GET_AVAILABLE_CATALOG);
    ipcMain.removeHandler(IPC.SKILL_SEARCH_CATALOG);
    ipcMain.removeHandler(IPC.SKILL_RECOMMEND);
    ipcMain.removeHandler(IPC.SKILL_INSTALL);
    ipcMain.removeHandler(IPC.SKILL_UNINSTALL);
    for (const cleanup of handlers) {
      cleanup();
    }
  };
}

/**
 * 向渲染进程发送技能安装提示。
 *
 * 当大模型推荐未安装的技能时，调用此函数触发渲染进程显示提示框。
 *
 * @param window 目标 BrowserWindow
 * @param data 技能信息
 */
export function sendSkillInstallPrompt(
  window: BrowserWindow | null,
  data: SkillInstallPromptData,
): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(IPC.SKILL_INSTALL_PROMPT, data);
}

/**
 * 创建技能服务实例。
 *
 * @param userSkillsDir 用户技能目录路径
 * @param installedSkills 已安装的技能列表
 * @returns SkillService 实例
 */
export function createSkillService(
  userSkillsDir: string,
  installedSkills: SkillEntry[],
): SkillService {
  return new SkillService({
    userSkillsDir,
    installedSkills,
  });
}
