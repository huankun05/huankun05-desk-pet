/**
 * 技能安装提示框
 *
 * 当大模型推荐未安装的技能时，通过 IPC 触发此提示框，询问用户是否安装。
 * 使用项目现有的 cy-modal 风格，保持 UI 统一。
 *
 * 通过 preload 暴露的 window.skillService API 与主进程通信。
 */

import { showModal } from "../ui/modal";

// ── 类型定义 ────────────────────────────────────────────────

/** 技能安装提示的参数 */
export interface SkillInstallPromptData {
  skillId: string;
  skillName: string;
  description: string;
  category: string;
  reason?: string;
}

/** 技能安装结果 */
export interface SkillInstallResult {
  success: boolean;
  skillId: string;
  message: string;
  error?: string;
}

/** window.skillService API 类型 */
interface SkillServiceApi {
  getAvailableCatalog: (category?: string) => Promise<unknown[]>;
  searchCatalog: (query: string) => Promise<unknown[]>;
  recommend: (
    userInput: string,
    options?: { limit?: number; mode?: string; includeNotInstalled?: boolean },
  ) => Promise<unknown[]>;
  install: (skillId: string) => Promise<SkillInstallResult>;
  uninstall: (skillId: string) => Promise<SkillInstallResult>;
  onInstallPrompt: (
    callback: (data: SkillInstallPromptData) => void,
  ) => () => void;
  rescan: () => void;
}

// 获取 skillService API（preload 暴露）
function getSkillService(): SkillServiceApi | undefined {
  return (window as unknown as { skillService?: SkillServiceApi }).skillService;
}

// ── 提示框逻辑 ──────────────────────────────────────────────

/**
 * 显示技能安装提示框。
 *
 * @param data 技能信息
 * @returns Promise<boolean> 用户是否点击了"安装"
 */
export async function showSkillInstallPrompt(data: SkillInstallPromptData): Promise<boolean> {
  const message = [
    `检测到适合当前任务的技能：「${data.skillName}」`,
    "",
    `描述：${data.description}`,
    `分类：${data.category}`,
    data.reason ? `推荐原因：${data.reason}` : "",
    "",
    "是否安装此技能？安装后可在设置-技能管理中查看和管理。",
  ]
    .filter(Boolean)
    .join("\n");

  const confirmed = await showModal({
    title: "技能推荐",
    message,
    icon: "\u{1F4E6}", // 📦
    confirmText: "安装",
    cancelText: "暂不安装",
  });

  return confirmed;
}

/**
 * 执行技能安装。
 *
 * @param skillId 技能 id
 * @returns Promise<SkillInstallResult> 安装结果
 */
export async function installSkill(skillId: string): Promise<SkillInstallResult> {
  const service = getSkillService();
  if (!service) {
    return {
      success: false,
      skillId,
      message: "安装失败：skillService API 不可用",
      error: "API_UNAVAILABLE",
    };
  }

  try {
    const result = await service.install(skillId);
    return result;
  } catch (error) {
    return {
      success: false,
      skillId,
      message: `安装失败：${(error as Error).message}`,
      error: "INSTALL_ERROR",
    };
  }
}

/**
 * 显示安装结果提示。
 *
 * @param result 安装结果
 */
export async function showInstallResult(result: SkillInstallResult): Promise<void> {
  await showModal({
    title: result.success ? "安装成功" : "安装失败",
    message: result.message,
    icon: result.success ? "\u2705" : "\u274C",
    confirmText: "确定",
    cancelText: "",
  });
}

/**
 * 初始化技能安装提示框的 IPC 监听。
 *
 * 监听主进程发送的技能安装提示，显示提示框，
 * 用户确认后执行安装并显示结果。
 *
 * @returns 取消监听函数
 */
export function initSkillInstallPrompt(): () => void {
  const service = getSkillService();
  if (!service) {
    console.warn("[skill-install-prompt] skillService API not available, skipping init");
    return () => {};
  }

  return service.onInstallPrompt(async (data: SkillInstallPromptData) => {
    try {
      const confirmed = await showSkillInstallPrompt(data);
      if (!confirmed) return;

      const result = await installSkill(data.skillId);
      await showInstallResult(result);

      // 安装成功后触发技能重新扫描
      if (result.success) {
        service.rescan();
      }
    } catch (error) {
      console.error("[skill-install-prompt] Failed to handle install prompt", error);
    }
  });
}
