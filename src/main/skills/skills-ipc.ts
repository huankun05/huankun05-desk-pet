// skills-ipc —— 自进化技能管理 UI 的 IPC handler。
// 提供渲染进程（设置面板）调用主进程技能管理功能的通道。

import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import {
  listSkills,
  getSkill,
  createSkill,
  editSkill,
  deleteSkill,
  installSkillFromUrl,
  checkSkillUpdate,
  updateSkill,
} from "../self-evolving/skill-store";
import {
  backupSkills,
  listBackups,
  restoreBackup,
  deleteBackup,
} from "../self-evolving/curator";
import { listAllSkills, setSkillEnabled as setUnifiedSkillEnabled } from "./unified-skill-store";
import { logger, LogTag } from "../logger";

/**
 * 注册技能管理 IPC handler。
 * 在应用启动时调用一次。
 */
export function registerSkillsIpc(): void {
  // 列出所有技能
  ipcMain.handle(IPC.SKILLS_LIST, (_event, options?: { includeArchived?: boolean }) => {
    try {
      const skills = listSkills(options);
      // 补充使用统计信息
      return {
        success: true,
        skills: skills.map((s) => ({
          ...s,
          // 使用记录在渲染进程按需获取，这里先返回基本信息
        })),
      };
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:list 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 获取单个技能详情
  ipcMain.handle(IPC.SKILLS_GET, (_event, name: string) => {
    try {
      const skill = getSkill(name);
      if (!skill) {
        return { success: false, error: `技能 '${name}' 不存在` };
      }
      return { success: true, skill };
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:get 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 创建技能
  ipcMain.handle(IPC.SKILLS_CREATE, (_event, name: string, content: string) => {
    try {
      const result = createSkill(name, content);
      return result;
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:create 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 编辑技能
  ipcMain.handle(IPC.SKILLS_EDIT, (_event, name: string, content: string) => {
    try {
      const result = editSkill(name, content);
      return result;
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:edit 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 删除技能
  ipcMain.handle(IPC.SKILLS_DELETE, (_event, name: string) => {
    try {
      const result = deleteSkill(name);
      return result;
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:delete 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 安装外部技能
  ipcMain.handle(IPC.SKILLS_INSTALL, async (_event, url: string) => {
    try {
      const result = await installSkillFromUrl(url);
      return result;
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:install 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 检查技能更新
  ipcMain.handle(IPC.SKILLS_CHECK_UPDATE, async (_event, name: string) => {
    try {
      const result = await checkSkillUpdate(name);
      return result;
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:check-update 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 更新技能
  ipcMain.handle(IPC.SKILLS_UPDATE, async (_event, name: string) => {
    try {
      const result = await updateSkill(name);
      return result;
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:update 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 备份技能
  ipcMain.handle(IPC.SKILLS_BACKUP, () => {
    try {
      const backupPath = backupSkills();
      if (backupPath) {
        return { success: true, message: "备份成功", backupPath };
      } else {
        return { success: false, error: "备份失败" };
      }
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:backup 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 列出备份
  ipcMain.handle(IPC.SKILLS_LIST_BACKUPS, () => {
    try {
      const backups = listBackups();
      return { success: true, backups };
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:list-backups 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 恢复备份
  ipcMain.handle(IPC.SKILLS_RESTORE, (_event, backupName: string) => {
    try {
      const result = restoreBackup(backupName);
      return result;
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:restore 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 删除备份
  ipcMain.handle(IPC.SKILLS_DELETE_BACKUP, (_event, backupName: string) => {
    try {
      const result = deleteBackup(backupName);
      return result;
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:delete-backup 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 列出所有技能（统一列表：Cyrene 原有 + 自进化）
  ipcMain.handle(IPC.SKILLS_LIST_ALL, () => {
    try {
      const skills = listAllSkills();
      return { success: true, skills };
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:list-all 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  // 设置技能启用/禁用（统一接口）
  ipcMain.handle(IPC.SKILLS_SET_ENABLED, (_event, payload: { id: string; enabled: boolean }) => {
    try {
      const result = setUnifiedSkillEnabled(payload.id, payload.enabled);
      return result;
    } catch (err) {
      logger.warn(LogTag.Skills, `IPC skills:set-enabled 失败: ${err}`);
      return { success: false, error: String(err) };
    }
  });

  logger.info(LogTag.Skills, "技能管理 IPC handler 已注册");
}
