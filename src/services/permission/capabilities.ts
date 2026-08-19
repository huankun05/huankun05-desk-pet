/**
 * 能力注册表
 *
 * 把"工具名"映射到"能力（含风险等级 + 默认授权）"。既覆盖当前已有的内置工具，
 * 也预置 P2 将新增的动作工具（open_app / run_command / media_control），便于权限网关
 * 在工具注册后即可直接管控。
 */

import type { CapabilityDef, RiskLevel, AuthMode } from './types';

/**
 * 操作能力（助手被授权后能替你执行的动作）。
 * 默认授权按风险给出：低危→始终允许、中危→每次询问、高危→每次询问。
 */
export const ACTION_CAPABILITIES: CapabilityDef[] = [
  // ===== 低危（只读 / 无害，默认始终允许） =====
  {
    id: 'web_search',
    toolName: 'web_search',
    risk: 'low',
    defaultMode: 'always',
    label: '联网搜索',
    description: '让助手联网搜索实时信息（新闻、天气、资料）。',
    group: 'action',
  },
  {
    id: 'read_clipboard',
    toolName: 'read_clipboard',
    risk: 'low',
    defaultMode: 'always',
    label: '读取剪贴板',
    description: '读取你复制的文本或图片内容。',
    group: 'action',
  },
  {
    id: 'list_directory',
    toolName: 'list_directory',
    risk: 'low',
    defaultMode: 'always',
    label: '浏览目录',
    description: '列出本地文件夹的内容。',
    group: 'action',
  },
  {
    id: 'read_file',
    toolName: 'read_file',
    risk: 'low',
    defaultMode: 'always',
    label: '读取文件',
    description: '读取本地文本文件内容。',
    group: 'action',
  },
  {
    id: 'system_info',
    toolName: 'system_info',
    risk: 'low',
    defaultMode: 'always',
    label: '系统信息',
    description: '读取系统基础信息（平台、语言等）。',
    group: 'action',
  },
  {
    id: 'get_time',
    toolName: 'get_time',
    risk: 'low',
    defaultMode: 'always',
    label: '获取时间',
    description: '获取当前系统日期与时间。',
    group: 'action',
  },
  {
    id: 'write_clipboard',
    toolName: 'write_clipboard',
    risk: 'low',
    defaultMode: 'always',
    label: '写入剪贴板',
    description: '把文本写入系统剪贴板。',
    group: 'action',
  },
  {
    id: 'open_folder',
    toolName: 'open_folder',
    risk: 'low',
    defaultMode: 'always',
    label: '打开文件夹',
    description: '在系统文件管理器中打开指定文件夹。',
    group: 'action',
  },
  {
    id: 'get_battery',
    toolName: 'get_battery',
    risk: 'low',
    defaultMode: 'always',
    label: '读取电量',
    description: '读取设备电量与电源状态。',
    group: 'action',
  },
  {
    id: 'get_volume',
    toolName: 'get_volume',
    risk: 'low',
    defaultMode: 'always',
    label: '读取音量',
    description: '读取系统主音量。',
    group: 'action',
  },
  {
    id: 'notify',
    toolName: 'notify',
    risk: 'low',
    defaultMode: 'always',
    label: '系统通知',
    description: '弹出系统级通知（Toast）。',
    group: 'action',
  },

  // ===== 中危（有副作用但可逆，默认每次询问） =====
  {
    id: 'open_url',
    toolName: 'open_url',
    risk: 'medium',
    defaultMode: 'ask',
    label: '打开网页',
    description: '用系统默认浏览器打开外部网址。',
    group: 'action',
  },
  {
    id: 'screenshot',
    toolName: 'screenshot',
    risk: 'medium',
    defaultMode: 'ask',
    label: '屏幕截图',
    description: '截取当前屏幕（可能包含隐私内容）。',
    group: 'action',
  },
  {
    id: 'save_to_desktop',
    toolName: 'save_to_desktop',
    risk: 'medium',
    defaultMode: 'ask',
    label: '保存到桌面',
    description: '在桌面生成文件（如整理好的文档）。',
    group: 'action',
  },
  {
    id: 'write_file',
    toolName: 'write_file',
    risk: 'medium',
    defaultMode: 'ask',
    label: '写入文件',
    description: '在本地写入或修改文件。',
    group: 'action',
  },
  {
    id: 'open_app',
    toolName: 'open_app',
    risk: 'medium',
    defaultMode: 'ask',
    label: '打开应用',
    description: '启动本地应用程序（如网易云音乐）。',
    group: 'action',
  },
  {
    id: 'media_control',
    toolName: 'media_control',
    risk: 'medium',
    defaultMode: 'ask',
    label: '媒体控制',
    description: '控制系统媒体播放（播放 / 暂停 / 切歌）。',
    group: 'action',
  },
  {
    id: 'open_file',
    toolName: 'open_file',
    risk: 'medium',
    defaultMode: 'ask',
    label: '打开文件',
    description: '用系统默认程序打开本地文件。',
    group: 'action',
  },
  {
    id: 'lock_screen',
    toolName: 'lock_screen',
    risk: 'medium',
    defaultMode: 'ask',
    label: '锁定屏幕',
    description: '锁定当前电脑屏幕。',
    group: 'action',
  },
  {
    id: 'set_volume',
    toolName: 'set_volume',
    risk: 'medium',
    defaultMode: 'ask',
    label: '设置音量',
    description: '设置系统主音量（0-100）。',
    group: 'action',
  },

  // ===== 高危（不可逆 / 系统级，默认每次询问 + 红色警示） =====
  {
    id: 'run_command',
    toolName: 'run_command',
    risk: 'high',
    defaultMode: 'ask',
    label: '执行命令',
    description: '在系统上执行命令行指令，可能影响系统安全。',
    group: 'action',
  },
];

/**
 * 系统能力（应用运转所需的 OS 权限）。仅用于设置页展示授权状态，
 * 不由权限网关管控"动作执行"，但会随操作能力一同展示。
 */
export const SYSTEM_CAPABILITIES: CapabilityDef[] = [
  {
    id: 'sys.microphone',
    risk: 'medium',
    defaultMode: 'ask',
    label: '麦克风',
    description: '语音识别（STT）必需的麦克风访问权限。',
    group: 'system',
  },
  {
    id: 'sys.camera',
    risk: 'medium',
    defaultMode: 'ask',
    label: '摄像头',
    description: '未来视觉 / 拍照类能力的摄像头访问权限。',
    group: 'system',
  },
  {
    id: 'sys.screen_capture',
    risk: 'medium',
    defaultMode: 'ask',
    label: '屏幕录制',
    description: '屏幕截图工具底层的屏幕捕获权限。',
    group: 'system',
  },
  {
    id: 'sys.file_access',
    risk: 'medium',
    defaultMode: 'ask',
    label: '文件访问',
    description: '读写桌面 / 本地文件的文件系统权限。',
    group: 'system',
  },
  {
    id: 'sys.network',
    risk: 'low',
    defaultMode: 'always',
    label: '网络访问',
    description: '联网搜索 / 大模型通信所需的网络权限。',
    group: 'system',
  },
];

const BY_TOOL = new Map<string, CapabilityDef>();
const BY_ID = new Map<string, CapabilityDef>();
for (const cap of [...ACTION_CAPABILITIES, ...SYSTEM_CAPABILITIES]) {
  BY_ID.set(cap.id, cap);
  if (cap.toolName) BY_TOOL.set(cap.toolName, cap);
}

/** 按工具名查找能力定义 */
export function getCapabilityByTool(toolName: string): CapabilityDef | undefined {
  return BY_TOOL.get(toolName);
}

/** 按能力 id 查找 */
export function getCapabilityById(id: string): CapabilityDef | undefined {
  return BY_ID.get(id);
}

/** 未登记工具时的兜底能力（按中危每次询问处理，安全优先） */
export function adHocCapability(toolName: string): CapabilityDef {
  return {
    id: toolName,
    toolName,
    risk: 'medium',
    defaultMode: 'ask',
    label: toolName,
    description: '未在能力注册表中登记的自定义工具。',
    group: 'action',
  };
}

/** 危险命令黑名单（命中即视为高危，强制二次确认；用户可在设置页加白名单） */
export const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\brm\s+-rf\b/i, label: 'rm -rf（递归强制删除）' },
  { pattern: /\bdel\s+\/s\b/i, label: 'del /s（递归删除）' },
  { pattern: /\bformat\b/i, label: 'format（格式化磁盘）' },
  { pattern: /\brd\s+\/s\b/i, label: 'rd /s（递归删目录）' },
  { pattern: /\bshutdown\b/i, label: 'shutdown（关机）' },
  { pattern: /\breboot\b/i, label: 'reboot（重启）' },
  { pattern: /\breg\s+(add|delete)\b/i, label: 'reg add/delete（注册表写入）' },
  { pattern: /\bmkfs\b/i, label: 'mkfs（创建文件系统）' },
  { pattern: /:\s*\(\)\s*\{/i, label: 'fork 炸弹' },
  { pattern: /\btaskkill\b/i, label: 'taskkill（结束进程）' },
  { pattern: /\b(curl|wget|powershell|cmd)\s+.*\|.*(sh|bash|iex)\b/i, label: '下载并执行' },
];

/** 占位：运行时可从设置页读取用户自定义白名单（此处留接口） */
export function isCommandWhitelisted(_command: string): boolean {
  return false;
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: '低危',
  medium: '中危',
  high: '高危',
};

export const RISK_COLOR: Record<RiskLevel, string> = {
  low: '#16a34a',
  medium: '#d97706',
  high: '#dc2626',
};

export const DEFAULT_AUTH_BY_RISK: Record<RiskLevel, AuthMode> = {
  low: 'always',
  medium: 'ask',
  high: 'ask',
};
